/**
 * In-match HUD (§27) — crisp DOM UI layered over the chunky PixiJS world (the
 * contrast is the look, §30). Everything here is feed/banner/ping, never a
 * modal (§29): the only modal in the game is the end-of-match Recap Card.
 *
 * Visual language (Claude Design handoff, "Interface Testament v3.0"):
 * pixelated 1970s cult-revival — Press Start 2P / Pixelify Sans / VT323,
 * harvest-gold chrome, 3px #4a3a26 pixel borders, hard 0 4px 0 #060403 drops,
 * square corners everywhere. The player's own archetype accent re-dresses
 * armed/selected states, the signature power and the doctrine badge.
 *
 * Layout (desktop; rails collapse via the ◄/► pixel toggles):
 *   share bar   believer share of the town, own cult first (top:0, 26px)
 *   top bar     FLOCK · TREASURY · FAITH · HEAT · MATCH · LEADER
 *   left rail   STANCE (1/2/3) · POWERS (D/F/G) · SCHEME
 *   bottom      BUILD tray (click → placement mode) · DOCTRINE (badge) · minimap
 *   right rail  CONGREGATIONS (ally/mark) · key buildings · DRAMA FEED · chat
 *
 * The HUD reads the predicted sim each update() (≈10 Hz) and writes intents
 * through the session. Build/strike buttons arm a placement mode that main.ts's
 * map click consumes, so targeted actions share the world cursor.
 */

import {
  toInt,
  toFloat,
  fromInt,
  mul,
  Stance,
  MatchStatus,
  Terrain,
  TileState,
  NEUTRAL,
  Lot,
  Landmark,
  doctrinePointsAvailable,
  loveBombCostMult,
  colorForPlayer,
  buildingCost,
  streetAt,
  householdName,
  memberName,
  propertyCost,
  propertyStats,
  computeCivicControl,
  computeSiegeState,
  CIVIC_LOTS,
  CIVIC_EFFECTS,
  KIT,
  type SimState,
  type PlayerState,
  type BuildingType,
  type SiegeBar,
} from "@flock/sim";
import type { GameSession, ClientIntent } from "./net.js";

export type PlacementKind =
  | { mode: "build"; building: string; key: string }
  | { mode: "strike"; strike: string }
  | { mode: "ability"; ability: string }
  | { mode: "property" }
  // ── SCHEME actions (§13/§15/§16): every one is fully clickable, no hotkey
  //    required. Each arms a target mode; main.ts's map-click resolves it.
  | { mode: "agent"; mission: "deprogram" | "scandal" } // click a district
  | { mode: "scandal" } //                                click an enemy cult
  | { mode: "van" } //                                   click a tile
  | { mode: "close_front" } //                           click near a front
  | { mode: "cancel_build" }; //                         click your building

/** The slice of the map camera the HUD needs (minimap jump + viewport rect). */
export interface Camera {
  centerOn(tile: number): void;
  /** zoom in on a tile and flash a transient highlight ring on it */
  flashTile(tile: number, nowMs: number): void;
  getView(): { x: number; y: number; w: number; h: number };
}

/** Shared interaction state between the HUD and the map-click handler. */
export interface UiState {
  /** armed targeted action awaiting a map click, or null for default (front). */
  placement: PlacementKind | null;
}

/**
 * Archetype power metadata. `cd` is the key the sim uses in `me.cooldowns`
 * (it can differ from the ability id — Retreat Weekend cools down as
 * "retreat"). `cost` is the live resource price the sim will charge, so the
 * rail can show cost + affordability exactly the way builds/rituals do.
 */
interface PowerDef {
  id: string;
  label: string;
  cd: string;
  cost?: (me: PlayerState) => { usd?: number; faith?: number };
  /** Signature lands passively with the kit (Radiant Labs / Circle Ledger). */
  passive?: boolean;
}

const ACTIVE_D: Record<string, PowerDef> = {
  dawn: { id: "street_prophet", label: "Street Prophet", cd: "street_prophet", cost: () => ({ usd: KIT.streetProphet.cost }) },
  radiant: { id: "juice_cleanse", label: "Juice Cleanse", cd: "juice_cleanse", cost: () => ({ usd: KIT.juiceCleanse.cost }) },
  circle: { id: "seminar_blitz", label: "Seminar Blitz", cd: "seminar_blitz", cost: () => ({ usd: KIT.seminarBlitz.cost }) },
  visitors: { id: "crop_circle", label: "Crop Circle", cd: "crop_circle", cost: () => ({ usd: KIT.cropCircle.cost }) },
};
const ACTIVE_F: Record<string, PowerDef> = {
  dawn: { id: "stockpile_sermon", label: "Stockpile Sermon", cd: "stockpile_sermon", cost: () => ({ faith: KIT.stockpileSermon.cost }) },
  radiant: {
    id: "free_retreat_weekend",
    label: "Retreat Weekend",
    cd: "retreat",
    cost: (me) => ({ usd: toInt(mul(fromInt(KIT.retreat.cost), loveBombCostMult(me))) }),
  },
  circle: { id: "hostile_acquisition", label: "Hostile Takeover", cd: "hostile_acquisition", cost: () => ({ usd: KIT.hostileAcquisition.cost }) },
  visitors: { id: "radio_static", label: "Radio Static", cd: "radio_static", cost: () => ({ faith: KIT.radioStatic.faithCost }) },
};
const SIGNATURE: Record<string, PowerDef> = {
  dawn: { id: "prophecy", label: "Prophecy Countdown", cd: "" },
  radiant: { id: "labs", label: "Mass Cleanse", cd: "", passive: true },
  circle: { id: "ledger", label: "The Downline", cd: "", passive: true },
  visitors: { id: "saucer_landing", label: "Saucer Landing", cd: "saucer_landing", cost: () => ({ usd: KIT.saucerLanding.cost }) },
};

// v3 (M3.3b): the commune is the ONLY buildable — the old placeable palette
// (tower/plate/broadcast/lab) is cut; their roles fold into commune stages,
// doctrine, and money ops.
const BUILDS = [
  { id: "compound", key: "B", label: "COMMUNE", ic: "house", desc: "Your HQ. Click to UPGRADE it a stage (1→5) — each stage raises your flock cap." },
] as const;


/**
 * SCHEME actions — the PvP/ops verbs, each a clickable button. `arm` sets a
 * placement mode resolved by the next map click; `surrender` fires directly.
 * Hotkeys still work but are never required.
 */
const SCHEME: {
  label: string;
  key: string;
  ic: string;
  title: string;
  arm?: PlacementKind;
  armKey?: string;
  surrender?: boolean;
}[] = [
  { label: "PAMPHLET", key: "K", ic: "press", title: "Pamphlet Bomb — a propaganda strike on a tile (needs a Broadcast Tower). Click, then click the target.", arm: { mode: "strike", strike: "pamphlet_bomb" }, armKey: "strike:pamphlet_bomb" },
  { label: "EXPOSÉ", key: "K", ic: "antenna", title: "Prime-Time Exposé — wide propaganda strike. Click, then click the target.", arm: { mode: "strike", strike: "prime_time_expose" }, armKey: "strike:prime_time_expose" },
  { label: "MANIFESTO", key: "K", ic: "scroll", title: "Manifesto Drop — the big one. Click, then click the target.", arm: { mode: "strike", strike: "manifesto_drop" }, armKey: "strike:manifesto_drop" },
  { label: "DEPROGRAM", key: "A", ic: "eye", title: "Dispatch an Agent to deprogram a district (raid). Click, then click a district you're pressing.", arm: { mode: "agent", mission: "deprogram" }, armKey: "agent:deprogram" },
  { label: "SNOOP", key: "X", ic: "eye", title: "Dispatch an Agent to gather scandal evidence in a district. Click, then click a district.", arm: { mode: "agent", mission: "scandal" }, armKey: "agent:scandal" },
  { label: "EXPOSE", key: "P", ic: "flame", title: "Publish a Scandal against a rival cult. Click, then click one of their tiles.", arm: { mode: "scandal" }, armKey: "scandal" },
  { label: "VAN", key: "V", ic: "van", title: "Route your nearest Recruitment Van to a tile (buys one if you have none). Click, then click a tile.", arm: { mode: "van" }, armKey: "van" },
  { label: "CLOSE", key: "⇧C", ic: "flame", title: "Close your nearest front to stop the push. Click, then click near the front.", arm: { mode: "close_front" }, armKey: "close_front" },
  { label: "CANCEL", key: "Z", ic: "press", title: "Cancel a building under construction for a 50% refund. Click, then click the building.", arm: { mode: "cancel_build" }, armKey: "cancel_build" },
  { label: "SURRENDER", key: "F8", ic: "flame", title: "Surrender the match — your cult stops fighting.", surrender: true },
];

const STANCES = [
  { id: Stance.Tend, key: "1", label: "TEND", col: "#6f9b6a", ic: "candle", hint: "defend + heal dissent" },
  { id: Stance.Spread, key: "2", label: "SPREAD", col: "#d8a83a", ic: "mega", hint: "balanced growth" },
  { id: Stance.Crusade, key: "3", label: "CRUSADE", col: "#cf4b2c", ic: "flame", hint: "max pressure, +Heat" },
] as const;

/** Archetype accents (design handoff §01): own cult re-dresses the HUD. */
const ARCH_ACCENT: Record<string, { a: string; b: string }> = {
  dawn: { a: "#df5a2b", b: "#f0b53e" },
  radiant: { a: "#84a23c", b: "#c4dd72" },
  circle: { a: "#e0a422", b: "#f3cf6a" },
  visitors: { a: "#4fa3ad", b: "#8fd6dd" },
};

/** Drama-feed color keys (design FEED_COL). */
const FEED_COL: Record<string, string> = {
  scandal: "#cf4b2c",
  judas: "#b8332b",
  prophecy: "#e0a422",
  ally: "#84a23c",
  cap: "#9bbf6a",
  dead: "#8a7550",
  strike: "#df5a2b",
  schism: "#7a3da8",
};

/** 8×8 pixel-art glyph bitmaps (design GLYPH). */
const GLYPH: Record<string, readonly string[]> = {
  people: ["01100110", "01100110", "00000000", "11111111", "11111111", "11111111", "10111101", "10111101"],
  coin: ["00111100", "01100110", "11011011", "11011011", "11011011", "11011011", "01100110", "00111100"],
  heart: ["01100110", "11111111", "11111111", "11111111", "01111110", "00111100", "00011000", "00000000"],
  flame: ["00010000", "00011000", "00111100", "01111110", "01111110", "11111111", "11111111", "01111110"],
  clock: ["00111100", "01000010", "10011001", "10011101", "10010001", "10000001", "01000010", "00111100"],
  crown: ["10000001", "10100101", "10100101", "11111111", "11111111", "11111111", "00000000", "11111111"],
  candle: ["00011000", "00011000", "00111100", "00011000", "00111100", "00111100", "00111100", "01111110"],
  mega: ["00000011", "00001111", "00111111", "11111111", "11111111", "00111111", "00001111", "00000011"],
  house: ["00011000", "00111100", "01111110", "11111111", "11011011", "11011011", "11000011", "11011011"],
  tower: ["01111110", "01011010", "00111100", "00111100", "00111100", "00111100", "01111110", "01111110"],
  plate: ["00011000", "00000000", "10000001", "11000011", "01111110", "00111100", "00000000", "00000000"],
  antenna: ["00011000", "00011000", "10111010", "01111100", "00111000", "00111000", "00111000", "01111100"],
  phone: ["11000011", "11000011", "01000010", "00111100", "00111100", "01000010", "11000011", "11000011"],
  press: ["11111111", "10000001", "11111111", "00111100", "11111111", "11111111", "11111111", "11111111"],
  van: ["00000000", "01111110", "11111111", "11111111", "11111111", "11111111", "01011010", "00100100"],
  flask: ["00111100", "00100100", "00100100", "00100100", "01000010", "01011010", "11111111", "01111110"],
  scroll: ["01111110", "11111111", "11011011", "11111111", "11011011", "11111111", "11111111", "01111110"],
  bolt: ["00011100", "00111000", "01110000", "11111110", "00011111", "00001110", "00011100", "00110000"],
  eye: ["00000000", "00111100", "01111110", "11011011", "11011011", "01111110", "00111100", "00000000"],
  ufo: ["00011000", "00111100", "01111110", "11111111", "00111100", "01000010", "10000001", "00000000"],
  leaf: ["00010000", "00110010", "01100110", "01001100", "11011000", "01110000", "00010000", "00010000"],
  star: ["00010000", "00010000", "11111111", "00111100", "01111110", "01100110", "11000011", "00000000"],
};

/** Render an 8×8 GLYPH as a crisp inline SVG (design icon()). */
function icon(name: string, color: string, px: number): string {
  const rows = GLYPH[name] ?? [];
  let cells = "";
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < row.length; x++) {
      if (row.charAt(x) === "1") cells += `<rect x="${x}" y="${y}" width="1.05" height="1.05" fill="${color}"/>`;
    }
  }
  return `<svg width="${px}" height="${px}" viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" style="display:block;flex:none">${cells}</svg>`;
}

/** Human labels for the hover chip (place identity, §2). */
const LOT_NAMES: Record<number, string> = {
  [Lot.Shop]: "corner store",
  [Lot.Supermarket]: "supermarket",
  [Lot.Diner]: "diner",
  [Lot.School]: "the school",
  [Lot.Library]: "the library",
  [Lot.Chapel]: "the chapel",
  [Lot.GasStation]: "gas station",
  [Lot.Sheriff]: "sheriff's office",
  [Lot.Office]: "office block",
  [Lot.Barn]: "barn",
  [Lot.Silo]: "grain silo",
  [Lot.Park]: "the park",
  [Lot.Church]: "the church",
  [Lot.Bank]: "the bank",
  [Lot.PostOffice]: "post office",
  [Lot.FireStation]: "fire station",
  [Lot.Factory]: "the factory",
  [Lot.Motel]: "the motel",
  [Lot.Parking]: "parking lot",
  [Lot.Cemetery]: "the cemetery",
  [Lot.BallField]: "the ballfield",
  [Lot.Cinema]: "the picture house",
  [Lot.Playground]: "the playground",
  [Lot.Dock]: "the boat dock",
  [Lot.Greenhouse]: "greenhouse",
  [Lot.HighSchool]: "the high school",
  [Lot.Warehouse]: "warehouse",
};
const LANDMARK_NAMES: Record<number, string> = {
  [Landmark.RadioTower]: "the radio tower",
  [Landmark.Megachurch]: "the megachurch",
  [Landmark.TownHall]: "town hall",
  [Landmark.Fairground]: "the fairground",
  [Landmark.WaterTower]: "the water tower",
};
const TERRAIN_NAMES: Record<number, string> = {
  [Terrain.Woods]: "the woods",
  [Terrain.Lake]: "open water",
  [Terrain.Grass]: "open country",
  [Terrain.Field]: "crop fields",
  [Terrain.Dirt]: "a dirt lane",
  [Terrain.Path]: "a footpath",
  [Terrain.Orchard]: "an orchard",
  [Terrain.Pasture]: "pasture",
};

/** Escape user-supplied text before it touches innerHTML (XSS guard). */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n}`;
}
function fmtNum(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}
function fmtTime(ticks: number): string {
  const s = Math.max(0, Math.floor(ticks / 10));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const HUD_CSS = `
.fk-hud{position:absolute;inset:0;pointer-events:none;font-family:'Pixelify Sans',ui-monospace,monospace;color:#efe3c6;z-index:20;--fk-acc:#e0a422;--fk-acc2:#f3cf6a}
.fk-hud button{pointer-events:auto;cursor:pointer;font-family:inherit;border:0;color:#efe3c6;background:none;padding:0}
.fk-hud .ic{display:block;flex:none;line-height:0}
@keyframes fkHeat{0%,100%{text-shadow:0 0 0 transparent}50%{text-shadow:0 0 9px currentColor}}
@keyframes fkDrop{from{transform:translate(-50%,-16px);opacity:0}to{transform:translate(-50%,0);opacity:1}}
@keyframes fkIn{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:none}}
@keyframes fkBlink{50%{opacity:.3}}
@keyframes fkFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
/* ---- believer share bar (top:0, OpenFront-style) ---- */
.fk-share{position:absolute;top:0;left:0;right:0;height:26px;display:flex;background:#0e0a05;border-bottom:2px solid #4a3a26;box-shadow:0 2px 0 rgba(0,0,0,.5);font-size:11px;font-weight:600;z-index:6;overflow:hidden}
.fk-share .seg{height:100%;display:flex;align-items:center;justify-content:center;gap:5px;overflow:hidden;box-shadow:inset -1px 0 0 rgba(0,0,0,.45);color:#f3ead4;white-space:nowrap;flex:none}
.fk-share .seg.me{color:#19110a}
.fk-share .seg .snm{overflow:hidden;text-overflow:ellipsis;max-width:110px}
.fk-share .seg .spc{opacity:.8}
/* ---- top stat strip ---- */
.fk-top{position:absolute;top:36px;left:50%;transform:translateX(-50%);display:flex;gap:2px;background:#1a130b;border:3px solid #4a3a26;box-shadow:0 4px 0 #060403,inset 0 0 0 1px #6b563a;z-index:6;white-space:nowrap}
.fk-stat{display:flex;align-items:center;gap:9px;padding:9px 15px;border-right:1px solid #36291a;line-height:1}
.fk-stat:last-child{border-right:0}
.fk-stat .v{font-family:'VT323',monospace;font-size:25px;letter-spacing:.5px;color:#efe3c6}
.fk-stat .sub{font-family:'VT323',monospace;font-size:13px;color:#8a7550;margin-left:2px}
.fk-stat .l{display:block;font-family:'Press Start 2P',monospace;font-size:7px;letter-spacing:1px;color:#8a7550;margin-top:3px}
.fk-heat .ic{color:#c0744a}
.fk-heat .v{color:#caa07a}
.fk-heat.hot .ic{color:var(--fk-acc2)}
.fk-heat.hot .v{color:#ff7a3a;animation:fkHeat 1s infinite}
/* ---- pixel panels ---- */
.fk-grp{background:#1a130b;border:3px solid #4a3a26;box-shadow:0 4px 0 #060403;padding:9px}
.fk-grp h4{margin:0 0 8px;font-family:'Press Start 2P',monospace;font-size:7px;letter-spacing:1px;color:#8a7550;font-weight:400;text-transform:uppercase}
.fk-foldh{cursor:pointer;display:flex;align-items:center;gap:5px;user-select:none}
.fk-foldh:hover{color:#e0a422}
.fk-foldh .cv{color:#e0a422;font-size:8px}
.fk-foldsub{margin-left:auto;font-size:6px;color:#6b563a;letter-spacing:1px}
/* ---- rail buttons ---- */
.fk-btn{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:7px 9px;font-size:12px;font-weight:500;letter-spacing:.3px;text-align:left;color:#efe3c6;background:#241c12;box-shadow:inset 0 0 0 1px #36291a,0 3px 0 #060403;margin:3px 0}
.fk-btn:hover{box-shadow:inset 0 0 0 1px #6b563a,0 3px 0 #060403}
.fk-btn .lb{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fk-btn .k{font-family:'Press Start 2P',monospace;font-size:8px;color:#a08a64;background:#0e0a05;padding:3px 4px;box-shadow:inset 0 0 0 1px #4a3a26;flex:none}
.fk-btn .cost{font-family:'VT323',monospace;font-size:15px;color:#9bbf6a;flex:none;white-space:nowrap}
.fk-btn.cd{opacity:.7}
.fk-btn.cd .cost{color:#e6be8a}
.fk-btn.cant{opacity:.4;filter:grayscale(.8)}
.fk-btn.arm{background:var(--fk-acc);color:#19110a;box-shadow:inset 0 0 0 2px var(--fk-acc2),0 3px 0 #060403}
.fk-btn.arm .ic,.fk-btn.arm .k,.fk-btn.arm .cost{color:#19110a}
/* stances: colored icon, selected = colored bg + ink text */
.fk-stance{font-size:13px;font-weight:600;letter-spacing:.5px;padding:8px 9px}
.fk-stance .ic{color:var(--st-col)}
.fk-stance.on{background:var(--st-col);color:#19110a;box-shadow:inset 0 0 0 2px var(--st-col),0 3px 0 #060403}
.fk-stance.on .ic,.fk-stance.on .k{color:#19110a}
/* powers: D/F rows + G signature in the cult accent */
.fk-pow .ic{color:var(--fk-acc2)}
.fk-sig{background:var(--fk-acc);color:#19110a;font-weight:700;letter-spacing:.5px;padding:9px;box-shadow:inset 0 0 0 2px var(--fk-acc2),0 3px 0 #060403}
.fk-sig:hover{box-shadow:inset 0 0 0 2px var(--fk-acc2),0 3px 0 #060403}
.fk-sig .ic,.fk-sig .k,.fk-sig .cost{color:#19110a}
/* ---- rails + collapse toggles ---- */
.fk-rail{position:absolute;left:16px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:6px;z-index:6}
.fk-rail-stack{width:182px;display:flex;flex-direction:column;gap:11px;max-height:calc(100vh - 140px);overflow:auto}
.fk-collapse{width:20px;height:66px;display:flex;align-items:center;justify-content:center;font-family:'Press Start 2P',monospace;font-size:9px;color:#e0a422;background:#1a130b;border:3px solid #4a3a26;box-shadow:0 4px 0 #060403;padding:0;flex:none}
.fk-collapse.h{width:66px;height:20px}
.fk-right{position:absolute;right:16px;top:74px;display:flex;align-items:flex-start;gap:6px;z-index:6}
.fk-right-stack{width:236px;display:flex;flex-direction:column;gap:11px;max-height:calc(100vh - 130px)}
.fk-players{overflow:auto;max-height:230px}
.fk-prow{display:flex;flex-wrap:wrap;align-items:center;gap:7px;font-size:12px;padding:4px 5px}
.fk-prow.me{background:color-mix(in srgb,var(--fk-acc) 15%,transparent);box-shadow:inset 0 0 0 1px var(--fk-acc)}
.fk-prow.dead{opacity:.45}
.fk-prow .sw{width:13px;height:13px;flex:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,.5)}
.fk-prow .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fk-prow .tg{font-size:13px;flex:none}
.fk-prow .tl{font-family:'VT323',monospace;font-size:17px;color:#c4ad82;min-width:34px;text-align:right}
.fk-prow .hold{color:#a08a64;font-size:11px}
.fk-prow .act{pointer-events:auto;cursor:pointer;font-size:10px;color:#a08a64;background:#0e0a05;box-shadow:inset 0 0 0 1px #4a3a26;padding:1px 5px;flex:none}
.fk-prow .siege{flex-basis:100%;height:5px;background:#0e0a05;box-shadow:inset 0 0 0 1px #4a3a26;overflow:hidden}
.fk-prow .siege .fill{height:100%;box-shadow:inset -1px 0 0 rgba(0,0,0,.4)}
.fk-prow .siege.contested .fill{animation:fkBlink 1s step-start infinite}
.fk-prow .act:hover{color:#efe3c6;box-shadow:inset 0 0 0 1px #6b563a}
/* ---- drama feed ---- */
.fk-feed{overflow:auto;flex:1;min-height:110px;font-size:12px;line-height:1.35;display:flex;flex-direction:column}
.fk-feed-h{font-family:'Press Start 2P',monospace;font-size:7px;letter-spacing:1px;color:#cf4b2c;margin-bottom:8px;animation:fkBlink 1.4s infinite}
.fk-feed .e{display:flex;align-items:flex-start;gap:7px;color:#d8c8a6;animation:fkIn .35s ease-out;padding:2px 0}
.fk-feed .e .kq{width:9px;height:9px;flex:none;margin-top:3px;box-shadow:0 0 0 1px rgba(0,0,0,.4)}
.fk-feed .act{pointer-events:auto;cursor:pointer;text-decoration:underline;color:#c4dd72}
/* ---- bottom tray ---- */
.fk-bottom{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;z-index:6}
.fk-tray{display:flex;gap:9px;align-items:stretch;background:#1a130b;border:3px solid #4a3a26;box-shadow:0 4px 0 #060403;padding:8px 9px}
.fk-builds-wrap{display:flex;flex-direction:column;gap:6px}
.fk-builds-lbl{font-family:'Press Start 2P',monospace;font-size:7px;letter-spacing:1px;color:#8a7550}
.fk-builds{display:flex;gap:5px}
.fk-build{display:block;width:58px;box-sizing:border-box;padding:7px 5px;text-align:center;color:#efe3c6;background:#241c12;box-shadow:inset 0 0 0 1px #36291a,0 3px 0 #060403}
.fk-build:hover{box-shadow:inset 0 0 0 1px #6b563a,0 3px 0 #060403}
.fk-build .r1{display:flex;align-items:center;justify-content:center;gap:4px}
.fk-build .ic{color:var(--fk-acc2)}
.fk-build .k{font-family:'Press Start 2P',monospace;font-size:8px;color:#a08a64;background:#0e0a05;padding:3px 4px;box-shadow:inset 0 0 0 1px #4a3a26}
.fk-build .cost{display:block;font-family:'VT323',monospace;font-size:13px;color:#9bbf6a;text-align:center;margin-top:3px;line-height:1}
.fk-build.arm{background:var(--fk-acc);color:#19110a;box-shadow:inset 0 0 0 2px var(--fk-acc2),0 3px 0 #060403}
.fk-build.arm .ic,.fk-build.arm .k,.fk-build.arm .cost{color:#19110a}
.fk-build.cant{opacity:.4;filter:grayscale(.8)}
.fk-scheme{display:grid;grid-template-columns:1fr 1fr;gap:4px}
.fk-scm{display:flex;align-items:center;gap:5px;box-sizing:border-box;padding:5px 6px;text-align:left;color:#efe3c6;background:#241c12;box-shadow:inset 0 0 0 1px #36291a,0 3px 0 #060403;cursor:pointer;border:0}
.fk-scm:hover{box-shadow:inset 0 0 0 1px #cf4b2c,0 3px 0 #060403}
.fk-scm .ic{color:#df5a2b;flex:none}
.fk-scm .lb{flex:1;font-family:'Pixelify Sans',ui-monospace,monospace;font-size:10px;font-weight:600;letter-spacing:.3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fk-scm .k{font-family:'Press Start 2P',monospace;font-size:7px;color:#a08a64;background:#0e0a05;padding:2px 3px;box-shadow:inset 0 0 0 1px #4a3a26;flex:none}
.fk-scm.arm{background:#cf4b2c;color:#fff3df;box-shadow:inset 0 0 0 2px #f0b53e,0 3px 0 #060403}
.fk-scm.arm .ic,.fk-scm.arm .k{color:#fff3df}
.fk-scm.wide{grid-column:span 2;justify-content:center}
.fk-scm.wide .lb{flex:none}
.fk-doc{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px 16px;color:#efe3c6;background:#241c12;box-shadow:inset 0 0 0 2px #4a3a26,0 4px 0 #060403}
.fk-doc:hover{box-shadow:inset 0 0 0 2px #6b563a,0 4px 0 #060403}
.fk-doc .ic{color:var(--fk-acc2)}
.fk-doc .dl{font-size:12px;font-weight:600;letter-spacing:.5px;margin-top:4px}
.fk-doc .badge{position:absolute;top:-9px;right:-9px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-family:'Press Start 2P',monospace;font-size:9px;color:#19110a;background:#f0b53e;box-shadow:0 2px 0 #060403;animation:fkFloat 1.6s infinite}
.fk-mini{display:flex;align-items:center}
.fk-mini canvas{width:118px;height:75px;image-rendering:pixelated;box-shadow:inset 0 0 0 1px #4a3a26}
/* ---- banner (freeze-frame moments, §25.3) ---- */
.fk-banner{position:absolute;top:96px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;background:#cf4b2c;color:#fff3df;border:3px solid #f0b53e;box-shadow:0 5px 0 #060403,inset 0 0 0 2px #8a2a18;padding:12px 26px;font-family:'Press Start 2P',monospace;font-size:13px;letter-spacing:1px;animation:fkDrop .3s ease-out;text-shadow:2px 2px 0 #7a1f10;z-index:7;max-width:70vw}
.fk-banner .bx{font-size:18px;flex:none}
/* ---- help square ---- */
.fk-helpbtn{position:absolute;top:40px;right:16px;width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-family:'Press Start 2P',monospace;font-size:13px;color:#e0a422;background:#1a130b;border:3px solid #4a3a26;box-shadow:0 4px 0 #060403;cursor:help;padding:0;z-index:6}
.fk-helpbtn:hover{border-color:#e0a422}
/* ---- hover chip + chat ---- */
.fk-hoverchip{position:absolute;left:16px;bottom:16px;background:#1a130b;border:3px solid #4a3a26;box-shadow:0 4px 0 #060403;padding:6px 10px;font-size:12px;line-height:1.5;max-width:220px;pointer-events:none;z-index:6}
.fk-hoverchip .pl{font-weight:700}
.fk-hoverchip .st{color:#a08a64;font-family:'VT323',monospace;font-size:15px}
.fk-chatin{pointer-events:auto;width:100%;box-sizing:border-box;background:#241c12;color:#efe3c6;border:0;box-shadow:inset 0 0 0 1px #36291a,0 3px 0 #060403;padding:7px 9px;font-size:12px;font-family:'Pixelify Sans',ui-monospace,monospace}
.fk-chatin:focus{outline:none;box-shadow:inset 0 0 0 1px var(--fk-acc),0 3px 0 #060403;background:#2a2014}
.fk-chatin::placeholder{color:#8a7550}
/* match controls (EXIT / PAUSE, mounted from main.ts) */
.fk-ctl{display:flex;align-items:center;gap:7px;font-family:'Pixelify Sans',ui-monospace,monospace;font-size:12px;font-weight:600;letter-spacing:.5px;color:#efe3c6;background:#1a130b;border:3px solid #4a3a26;box-shadow:0 4px 0 #060403;padding:9px 13px;cursor:pointer}
.fk-ctl:hover{background:#2a1812;border-color:#cf4b2c}
.fk-ctl .x{color:#cf4b2c;font-size:14px;line-height:1}
/* accessibility (§28): reduced motion kills pulses/animations; mute hides chat */
.fk-reduced-motion .fk-heat.hot .v{animation:none}
.fk-reduced-motion .fk-feed .e{animation:none}
.fk-reduced-motion .fk-feed-h{animation:none}
.fk-reduced-motion .fk-banner{animation:none}
.fk-reduced-motion .fk-doc .badge{animation:none}
.fk-mute-chat .fk-chat{display:none}
.fk-mute-chat .fk-chatin{display:none}
@media(max-width:1100px){.fk-rail-stack{width:150px}.fk-right-stack{width:190px}.fk-build{width:50px}}
`;

/**
 * Cache of HUD elements. Named keys are declared (so reads are non-undefined
 * under noUncheckedIndexedAccess); the index signature keeps the dynamic
 * `stat()` setters typed.
 */
interface ElCache {
  share: HTMLElement;
  followers: HTMLElement;
  usd: HTMLElement;
  faith: HTMLElement;
  heat: HTMLElement;
  heat_box: HTMLElement;
  heat_sub: HTMLElement;
  timer: HTMLElement;
  leader: HTMLElement;
  stanceGroup: HTMLElement;
  actD: HTMLElement;
  actF: HTMLElement;
  actG: HTMLElement;
  builds: HTMLElement;
  doc: HTMLElement;
  docBadge: HTMLElement;
  players: HTMLElement;
  feed: HTMLElement;
  civics: HTMLElement;
  [k: string]: HTMLElement;
}

export class Hud {
  readonly ui: UiState = { placement: null };
  private readonly root: HTMLDivElement;
  private readonly el = {} as ElCache;
  private readonly mini: HTMLCanvasElement;
  private readonly miniCtx: CanvasRenderingContext2D;
  private prev = { followers: 0, usd: 0, tick: 0 };
  private usdPerSec = 0;
  private folTrend = 0;
  private feed: { tick: number; text: string; tag: string }[] = [];
  private seen = { scandals: 0, prophecies: 0, betrayals: 0, alliances: 0, dead: new Set<number>(), threats: new Set<string>() };
  private banner: { text: string; until: number } | null = null;
  showDissent = false;
  private lastMiniTick = -999;
  private miniImg: ImageData | null = null;
  private chatIn!: HTMLInputElement;
  private hoverChip!: HTMLDivElement;
  private hoverPlace!: HTMLElement;
  private hoverStreet!: HTMLElement;
  private lastHover = -2;
  /** archetype whose accent vars are currently applied to the root. */
  private accentFor = "";
  /** Global Enter → focus the chat box (unless already typing somewhere). */
  private readonly focusChatKey = (ev: KeyboardEvent): void => {
    if (ev.key !== "Enter") return;
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
    ev.preventDefault();
    this.chatIn.focus();
  };

  constructor(
    private readonly g: GameSession,
    private readonly camera: Camera | null = null,
  ) {
    if (!document.getElementById("fk-hud-css")) {
      const style = document.createElement("style");
      style.id = "fk-hud-css";
      style.textContent = HUD_CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement("div");
    this.root.className = "fk-hud";
    this.mini = document.createElement("canvas");
    this.mini.width = 118;
    this.mini.height = 75;
    this.miniCtx = this.mini.getContext("2d")!;
    // click the minimap to jump the camera there (fast navigation on big maps)
    if (this.camera) {
      this.mini.style.cursor = "pointer";
      this.mini.style.pointerEvents = "auto";
      this.mini.onclick = (e) => {
        const r = this.mini.getBoundingClientRect();
        const tx = Math.floor(((e.clientX - r.left) / r.width) * g.sim.world.width);
        const ty = Math.floor(((e.clientY - r.top) / r.height) * g.sim.world.height);
        this.camera!.centerOn(ty * g.sim.world.width + tx);
      };
    }
    this.build();
    document.getElementById("app")!.appendChild(this.root);
  }

  private me(): PlayerState | undefined {
    return this.g.sim.players.find((p) => p.id === this.g.playerId);
  }

  private send(intent: ClientIntent): void {
    this.g.sendIntent(intent);
  }

  /** Arm a targeted action; the next map click resolves it (main.ts). */
  arm(p: PlacementKind | null): void {
    this.ui.placement = p;
  }

  /** The data-scheme key for an armed placement, so the button can light up. */
  private schemeKey(p: PlacementKind | null): string | null {
    if (!p) return null;
    switch (p.mode) {
      case "strike": return `strike:${p.strike}`;
      case "agent": return `agent:${p.mission}`;
      case "scandal": return "scandal";
      case "van": return "van";
      case "close_front": return "close_front";
      case "cancel_build": return "cancel_build";
      default: return null;
    }
  }

  /**
   * Place-identity chip (§2 flavor): whose house, which street, what lot the
   * cursor rests on. Names are static seed data (names.ts) — nothing here
   * leaks live game state through the fog.
   */
  setHover(tile: number): void {
    if (tile === this.lastHover) return;
    this.lastHover = tile;
    const w = this.g.sim.world;
    if (tile < 0 || tile >= w.terrain.length) {
      this.hoverChip.style.display = "none";
      return;
    }
    const terrain = w.terrain[tile]!;
    let place = "";
    if (w.landmark[tile] !== 0) {
      place = LANDMARK_NAMES[w.landmark[tile]!] ?? "a landmark";
    } else if (terrain === Terrain.Citizen) {
      const lot = w.lot[tile]!;
      const pop = w.pop[tile]!;
      if (lot !== 0) place = LOT_NAMES[lot] ?? "a lot";
      else if (pop >= 3) place = `the ${householdName(tile)} place · ${pop} souls`;
      else if (pop >= 1) place = `${memberName(tile, 0)}'s garden`;
      else place = "an empty lot";
    } else {
      place = TERRAIN_NAMES[terrain] ?? "";
    }
    const street = streetAt(w.streets, w.width, tile);
    if (!place && !street) {
      this.hoverChip.style.display = "none";
      return;
    }
    this.hoverPlace.textContent = place;
    this.hoverPlace.style.display = place ? "block" : "none";
    this.hoverStreet.textContent = street ?? "";
    this.hoverStreet.style.display = street ? "block" : "none";
    this.hoverChip.style.display = "block";
  }

  /** Row button: [icon] label ·· (cost) [key chip]. */
  private btn(label: string, key: string | null, onClick: () => void, opts: { ic?: string; cls?: string; cost?: boolean } = {}): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = `fk-btn${opts.cls ? ` ${opts.cls}` : ""}`;
    b.innerHTML =
      `${opts.ic ? `<i class="ic">${icon(opts.ic, "currentColor", 17)}</i>` : ""}` +
      `<span class="lb">${label}</span>` +
      `${opts.cost ? `<span class="cost"></span>` : ""}` +
      `${key ? `<span class="k">${key}</span>` : ""}`;
    b.onclick = onClick;
    return b;
  }

  private group(title: string): HTMLDivElement {
    const d = document.createElement("div");
    d.className = "fk-grp";
    d.innerHTML = `<h4>${title}</h4>`;
    return d;
  }

  /**
   * A group whose header toggles its body — used to fold ADVANCED tools away
   * so a first-timer isn't hit with a wall of buttons (§26 ease-of-play). The
   * header shows a ▸/▾ caret and the body starts collapsed by default.
   */
  private foldGroup(title: string, sub: string): { group: HTMLDivElement; body: HTMLDivElement } {
    const d = document.createElement("div");
    d.className = "fk-grp fk-fold";
    const h = document.createElement("h4");
    h.className = "fk-foldh";
    h.innerHTML = `<span class="cv">▸</span>${title} <span class="fk-foldsub">${sub}</span>`;
    const body = document.createElement("div");
    body.style.display = "none";
    h.onclick = () => {
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "";
      const cv = h.querySelector<HTMLElement>(".cv");
      if (cv) cv.textContent = open ? "▸" : "▾";
    };
    d.append(h, body);
    return { group: d, body };
  }

  /** ◄/► pixel collapse toggle wired to show/hide a rail stack. */
  private collapse(stack: HTMLElement, openChar: string, closedChar: string, horizontal = false): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = `fk-collapse${horizontal ? " h" : ""}`;
    b.textContent = openChar;
    b.title = "collapse / expand";
    b.onclick = () => {
      const open = stack.style.display !== "none";
      stack.style.display = open ? "none" : "";
      b.textContent = open ? closedChar : openChar;
    };
    return b;
  }

  private build(): void {
    // ---- believer share bar (top:0) --------------------------------------
    const share = document.createElement("div");
    share.className = "fk-share";
    this.el.share = share;
    this.root.appendChild(share);

    // ---- top bar ---------------------------------------------------------
    const top = document.createElement("div");
    top.className = "fk-top";
    // Plain-language tips so a first-timer learns the board by hovering (§26).
    const STAT_TIP: Record<string, string> = {
      followers: "FLOCK — your followers. This is your strength AND your health: fronts spend them, and losing them all eliminates you.",
      usd: "TREASURY — cash from tithes. Spend it on buildings, land, and vans.",
      faith: "FAITH — your conviction (0–100, drifts to 50). Bank it with TEND missions, then spend it on DOCTRINE (the B.I.T.E. tree).",
      heat: "HEAT — how much the town suspects you (0–100). Crusade and strikes raise it. Above 60 the Concerned Parents show up to harass you.",
      timer: "MATCH — time left. When it hits zero the biggest cult wins.",
      leader: "LEADER — the largest cult's share of the whole town. Convert 72% to win outright.",
    };
    const stat = (id: string, label: string, ic: string, icColor: string, cls = ""): HTMLElement => {
      const s = document.createElement("div");
      s.className = `fk-stat ${cls}`;
      s.title = STAT_TIP[id] ?? label;
      s.innerHTML = `<i class="ic"${icColor ? ` style="color:${icColor}"` : ""}>${icon(ic, "currentColor", 16)}</i><div><span class="v" id="${id}">—</span><span class="sub"></span><span class="l">${label}</span></div>`;
      this.el[id] = s.querySelector(".v")!;
      this.el[`${id}_sub`] = s.querySelector(".sub")!;
      if (cls) this.el[`${id}_box`] = s;
      return s;
    };
    top.append(
      stat("followers", "FLOCK", "people", "#cdbf9c"),
      stat("usd", "TREASURY", "coin", "#e8c45a"),
      stat("faith", "FAITH", "heart", "#d98aa0"),
      stat("heat", "HEAT", "flame", "", "fk-heat"),
      stat("timer", "MATCH", "clock", "#bdb39a"),
      stat("leader", "LEADER", "crown", "#e8c45a"),
    );
    this.el.faith_sub!.textContent = "/100";
    this.root.appendChild(top);

    // ---- left rail: stance / powers / scheme + collapse -------------------
    const rail = document.createElement("div");
    rail.className = "fk-rail";
    const railStack = document.createElement("div");
    railStack.className = "fk-rail-stack";

    const stanceG = this.group("STANCE");
    for (const s of STANCES) {
      const b = this.btn(s.label, s.key, () => this.send({ t: "SET_STANCE", stance: s.id }), { ic: s.ic, cls: "fk-stance" });
      b.title = s.hint;
      b.dataset.stance = s.id;
      b.style.setProperty("--st-col", s.col);
      stanceG.appendChild(b);
    }
    this.el.stanceGroup = stanceG;

    const actG = this.group("POWERS");
    this.el.actD = this.btn("—", "D", () => this.fireActive("D"), { ic: "eye", cls: "fk-pow", cost: true });
    this.el.actF = this.btn("—", "F", () => this.fireActive("F"), { ic: "flask", cls: "fk-pow", cost: true });
    this.el.actG = this.btn("—", "G", () => this.fireSignature(), { ic: "bolt", cls: "fk-sig", cost: true });
    actG.append(this.el.actD, this.el.actF, this.el.actG);

    // ---- SCHEME: every PvP/ops action as a clickable button (no hotkey
    //      required). Targeted ones arm a placement mode; SURRENDER is direct.
    //      Folded away by default — these are advanced tools a new player
    //      doesn't need in their first minute (§26 ease-of-play).
    const { group: schemeG, body: schemeBody } = this.foldGroup("SCHEME", "advanced");
    const schemeGrid = document.createElement("div");
    schemeGrid.className = "fk-scheme";
    const schemeBtn = (
      label: string,
      key: string,
      ic: string,
      title: string,
      onClick: () => void,
      armKey?: string,
    ): void => {
      const b = document.createElement("button");
      b.className = label === "SURRENDER" ? "fk-scm wide" : "fk-scm";
      b.title = title;
      b.innerHTML = `<i class="ic">${icon(ic, "currentColor", 15)}</i><span class="lb">${label}</span><span class="k">${key}</span>`;
      b.onclick = onClick;
      if (armKey) b.dataset.scheme = armKey;
      schemeGrid.appendChild(b);
    };
    for (const sc of SCHEME) {
      schemeBtn(sc.label, sc.key, sc.ic, sc.title, () => {
        if (sc.arm) {
          if (JSON.stringify(this.ui.placement) === JSON.stringify(sc.arm)) this.arm(null);
          else this.arm(sc.arm as PlacementKind);
        } else if (sc.surrender) {
          if (confirm("Surrender this match? Your cult stops fighting.")) this.send({ t: "SURRENDER" } as never);
        }
      }, sc.armKey);
    }
    schemeBody.appendChild(schemeGrid);
    this.el.scheme = schemeGrid;

    railStack.append(stanceG, actG, schemeG);
    rail.append(railStack, this.collapse(railStack, "◄", "►"));
    this.root.appendChild(rail);

    // ---- bottom tray: builds + doctrine + minimap (collapsible) ------------
    const bottom = document.createElement("div");
    bottom.className = "fk-bottom";
    const tray = document.createElement("div");
    tray.className = "fk-tray";

    const buildsWrap = document.createElement("div");
    buildsWrap.className = "fk-builds-wrap";
    buildsWrap.innerHTML = `<div class="fk-builds-lbl">BUILD ▸ tap a tool, then a tile</div>`;
    const builds = document.createElement("div");
    builds.className = "fk-builds";
    const buildBtn = (label: string, key: string, ic: string, title: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.className = "fk-build";
      b.title = title;
      b.innerHTML = `<div class="r1"><i class="ic">${icon(ic, "currentColor", 16)}</i><span class="k">${key}</span></div><span class="cost"></span>`;
      b.onclick = onClick;
      return b;
    };
    for (const bd of BUILDS) {
      const b = buildBtn(bd.label, bd.key, bd.ic, `${bd.label} — ${bd.desc} (click, then click a tile to place)`, () =>
        this.armBuild(bd.id, bd.key),
      );
      b.dataset.build = bd.id;
      builds.appendChild(b);
    }
    // BUY LAND (§18 rev.): claim a parcel of open country to expand onto
    const land = buildBtn(
      "BUY LAND",
      "N",
      "leaf",
      "Buy Land — claim a parcel of open country for your compound to grow into (click, then click open ground)",
      () => {
        if (this.ui.placement?.mode === "property") this.arm(null);
        else this.arm({ mode: "property" });
      },
    );
    land.dataset.land = "1";
    builds.appendChild(land);
    buildsWrap.appendChild(builds);
    this.el.builds = builds;

    const doc = document.createElement("button");
    doc.className = "fk-doc";
    doc.title =
      "DOCTRINE — spend milestone points (earned as your flock grows) on permanent upgrades. A glowing number means points are waiting. Picks are forever.";
    doc.innerHTML = `<i class="ic">${icon("scroll", "currentColor", 22)}</i><span class="dl">DOCTRINE</span><span class="badge" id="docbadge" style="display:none">0</span>`;
    doc.onclick = () => this.openDoctrine();
    this.el.doc = doc;
    this.el.docBadge = doc.querySelector("#docbadge")!;

    const dis = document.createElement("button");
    dis.className = "fk-doc";
    dis.id = "fk-dissent-overlay";
    dis.title =
      "DISSENT MAP — toggle a heat-map of unrest in your territory. Red = disgruntled tiles; too much dissent lets a chunk of your cult break away (a Schism). Cool it with the TEND stance or a Public Apology.";
    dis.innerHTML = `<i class="ic">${icon("eye", "currentColor", 22)}</i><span class="dl">DISSENT [H]</span>`;
    dis.onclick = () => this.toggleDissentOverlay();
    this.el.dissentOverlay = dis;

    const miniWrap = document.createElement("div");
    miniWrap.className = "fk-mini";
    miniWrap.appendChild(this.mini);

    tray.append(buildsWrap, doc, dis, miniWrap);
    bottom.append(this.collapse(tray, "▼", "▲", true), tray);
    this.root.appendChild(bottom);

    // ---- right rail: congregations + civics + drama feed + chat ------------
    const right = document.createElement("div");
    right.className = "fk-right";
    const rightStack = document.createElement("div");
    rightStack.className = "fk-right-stack";
    const players = document.createElement("div");
    players.className = "fk-grp fk-players";
    this.el.players = players;
    const feed = document.createElement("div");
    feed.className = "fk-grp fk-feed";
    feed.innerHTML = `<div class="fk-feed-h">● DRAMA FEED</div>`;
    this.el.feed = feed;

    // chat input (§27/§30): Enter focuses (global listener), Enter sends,
    // Esc cancels. Keystrokes never reach the game keybinds while typing —
    // the input swallows propagation and main.ts ignores typing targets.
    const chatIn = document.createElement("input");
    chatIn.className = "fk-chatin";
    chatIn.maxLength = 200;
    chatIn.placeholder = "Enter to chat…";
    chatIn.setAttribute("aria-label", "match chat");
    chatIn.onkeydown = (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") {
        const text = chatIn.value.trim();
        if (text) this.g.sendChat(text); // server moderates + relays (§30)
        chatIn.value = "";
        chatIn.blur();
      } else if (ev.key === "Escape") {
        chatIn.value = "";
        chatIn.blur();
      }
    };
    this.chatIn = chatIn;
    window.addEventListener("keydown", this.focusChatKey);

    // CIVICS: the key buildings and who holds them (§13 rev.) — click one to
    // jump the camera there and plan the takeover.
    const civicsBox = document.createElement("div");
    civicsBox.className = "fk-grp";
    civicsBox.innerHTML = `<h4>Key Buildings</h4>`;
    this.el.civics = civicsBox;

    rightStack.append(players, civicsBox, feed, chatIn);
    right.append(this.collapse(rightStack, "►", "◄"), rightStack);
    this.root.appendChild(right);

    // place-identity chip (bottom-left): what & where the cursor is over.
    // textContent only — names come from the corpus but stay XSS-inert anyway.
    const chip = document.createElement("div");
    chip.className = "fk-hoverchip";
    chip.style.display = "none";
    const pl = document.createElement("div");
    pl.className = "pl";
    const st = document.createElement("div");
    st.className = "st";
    chip.append(pl, st);
    this.hoverPlace = pl;
    this.hoverStreet = st;
    this.hoverChip = chip;
    this.root.appendChild(chip);

    // help square (top-right) → controls reference
    const help = document.createElement("button");
    help.className = "fk-helpbtn";
    help.textContent = "?";
    help.title =
      "Controls — 1/2/3 stance · D/F powers · G signature · B/T/C/Y/L build · N buy land · H dissent map · Esc cancel (click for the full sheet)";
    help.onclick = () => this.toggleHelp();
    this.root.appendChild(help);
  }

  /** Controls reference overlay (§28 discoverability), toggled by ? button/key. */
  toggleHelp(): void {
    const existing = this.root.querySelector(".fk-help");
    if (existing) {
      existing.remove();
      return;
    }
    const panel = document.createElement("div");
    panel.className = "fk-help";
    panel.style.cssText =
      "position:absolute;inset:0;z-index:45;display:flex;align-items:center;justify-content:center;background:rgba(10,7,4,.82);pointer-events:auto";
    panel.innerHTML = `<div style="background:#1a130b;border:3px solid #6b563a;box-shadow:0 8px 0 #060403,inset 0 0 0 2px #36291a;padding:22px 28px;max-width:540px;line-height:1.8;font-size:14px;color:#d8c8a6">
      <div style="font-family:'Press Start 2P',monospace;font-size:13px;letter-spacing:1px;color:#efe3c6;margin-bottom:12px">HOW TO PLAY</div>
      <b style="color:#e0a422">Goal</b> — convert the town. Watch the bar up top; reach the win % to dominate.<br/>
      <b style="color:#e0a422">Map</b> — click a tile to open a front there · drag to pan · wheel to zoom · click the minimap to jump.<br/>
      <b style="color:#e0a422">Stance</b> — 1 Tend (defend) · 2 Spread (grow) · 3 Crusade (push hard, +Heat).<br/>
      <b style="color:#e0a422">Faith</b> — bank it with TEND missions, spend it on the DOCTRINE tree.<br/>
      <b style="color:#e0a422">Powers</b> — D / F archetype actives · G signature (your big play).<br/>
      <b style="color:#e0a422">Build</b> — click a palette button then a tile, or press B/T/C/Y/L. N buys land · H toggles the dissent map. Greyed = can't afford.<br/>
      <b style="color:#e0a422">Scheme</b> — click a SCHEME button then a target (or hotkeys: A raid · X snoop · P scandal · K strike · V van · O/I alliances). Esc cancels.<br/>
      <div style="color:#8a7550;margin-top:10px;font-family:'VT323',monospace;font-size:16px">▸ click anywhere to close</div>
    </div>`;
    panel.onclick = () => panel.remove();
    this.root.appendChild(panel);
  }

  private armBuild(building: string, key: string): void {
    // v3: the COMMUNE isn't placed — it upgrades in place. Click = spend to
    // raise a stage (no armed placement).
    if (building === "compound") {
      this.send({ t: "UPGRADE_COMMUNE" } as never);
      return;
    }
    if (this.ui.placement?.mode === "build" && this.ui.placement.building === building) {
      this.arm(null); // toggle off
    } else {
      this.arm({ mode: "build", building, key });
    }
  }

  private fireActive(slot: "D" | "F"): void {
    const me = this.me();
    if (!me) return;
    const a = (slot === "D" ? ACTIVE_D : ACTIVE_F)[me.archetype]!;
    // targeted actives are placed via map click; others fire on self
    const placed = ["street_prophet", "juice_cleanse", "crop_circle", "radio_static", "free_retreat_weekend", "seminar_blitz"];
    if (placed.includes(a.id)) this.arm({ mode: "ability", ability: a.id });
    else this.send({ t: "ABILITY", ability: a.id });
  }

  private fireSignature(): void {
    const me = this.me();
    if (me?.archetype === "visitors") this.arm({ mode: "ability", ability: "saucer_landing" });
    else this.send({ t: "SIGNATURE" });
  }

  private openDoctrine(): void {
    showDoctrinePanel(this.g);
  }

  toggleDissentOverlay(): void {
    this.showDissent = !this.showDissent;
    const el = this.el.dissentOverlay;
    if (el) {
      el.style.background = this.showDissent ? (ARCH_ACCENT[this.me()?.archetype ?? "dawn"]?.a ?? "#e0a422") : "";
      el.style.color = this.showDissent ? "#19110a" : "";
    }
  }

  /** Push a drama-feed line and (for big moments) a freeze-frame banner (§25.3). */
  private pushFeed(text: string, banner = false, tag = "cap"): void {
    this.feed.unshift({ tick: this.g.sim.tick, text, tag });
    if (this.feed.length > 40) this.feed.pop();
    if (banner) this.banner = { text, until: this.g.sim.tick + 25 };
  }

  /** Scan sim state for new dramatic events since last update (the kill-feed). */
  private collectDrama(s: SimState): void {
    const name = (id: number): string => esc(this.g.players.find((p) => p.id === id)?.name ?? `Cult #${id}`);

    const published = s.scandals.filter((x) => x.published).length;
    if (published > this.seen.scandals) {
      for (const sc of s.scandals.filter((x) => x.published).slice(this.seen.scandals)) {
        this.pushFeed(`${name(sc.attacker)} EXPOSED ${name(sc.victim)}`, true, "scandal");
      }
      this.seen.scandals = published;
    }
    if (s.prophecies.length > this.seen.prophecies) {
      for (const pr of s.prophecies.slice(this.seen.prophecies)) {
        this.pushFeed(`${name(pr.player)} declared a PROPHECY`, true, "prophecy");
      }
      this.seen.prophecies = s.prophecies.length;
    }
    const traitors = s.players.filter((p) => p.traitor).length;
    if (traitors > this.seen.betrayals) {
      for (const p of s.players.filter((x) => x.traitor).slice(this.seen.betrayals)) {
        this.pushFeed(`JUDAS — ${name(p.id)} betrayed an ally`, true, "judas");
      }
      this.seen.betrayals = traitors;
    }
    if (s.alliances.length > this.seen.alliances) {
      const al = s.alliances[s.alliances.length - 1]!;
      this.pushFeed(`${name(al.a)} allied with ${name(al.b)}`, false, "ally");
      this.seen.alliances = s.alliances.length;
    }
    for (const p of s.players) {
      if (p.spawned && !p.alive && !this.seen.dead.has(p.id)) {
        this.seen.dead.add(p.id);
        this.pushFeed(`${name(p.id)} was eliminated`, false, "dead");
      }
    }

    // §29 readability SLA: any aggression against ME pings within a tick.
    const me = this.g.playerId;
    const w = s.world;
    // incoming propaganda strike (10s warning window, §8)
    for (const st of s.strikes) {
      if (st.warningTicksLeft <= 0) continue;
      const atMe = st.victim === me || (w.owner[st.target] === me && st.player !== me);
      if (!atMe) continue;
      const key = `strike:${st.player}:${st.type}:${st.target}`;
      if (this.seen.threats.has(key)) continue;
      this.seen.threats.add(key);
      const label = st.type === "pamphlet_bomb" ? "PAMPHLET BOMB" : st.type === "prime_time_expose" ? "PRIME-TIME EXPOSÉ" : "MANIFESTO DROP";
      this.pushFeed(`INCOMING ${label} from ${name(st.player)}!`, true, "strike");
    }
    // scandal evidence reaching the 50% notify threshold on me (§15.2)
    for (const sc of s.scandals) {
      if (sc.victim !== me || !sc.notified || sc.published) continue;
      const key = `scandal:${sc.attacker}`;
      if (this.seen.threats.has(key)) continue;
      this.seen.threats.add(key);
      this.pushFeed(`${name(sc.attacker)} is digging up dirt on you…`, true, "scandal");
    }
    // deprogramming raids channeling on us (§13 tell)
    const DISTRICT_NAMES: Record<number, string> = {
      0: "Old Town",
      1: "Suburbs",
      2: "College Campus",
      3: "Downtown",
      4: "Trailer Park",
    };
    for (const a of s.agents) {
      if (a.victim === me && a.phase === "channel") {
        const key = `raid:${a.id}`;
        if (!this.seen.threats.has(key)) {
          this.seen.threats.add(key);
          const nameStr = DISTRICT_NAMES[w.district[a.tile]!] ?? "Outskirts";
          this.pushFeed(`Suspicious activity reported in ${nameStr}!`, true, "scandal");
        }
      }
    }
    // Economic win (Circle-only) telegraph once it passes 60% of target
    const econTarget = 1_200_000;
    for (const p of s.players) {
      if (p.archetype === "circle" && p.alive) {
        const val = toFloat(p.usd);
        if (val >= 0.6 * econTarget) {
          const key = `economic:${p.id}:${Math.floor(val / 100_000)}`;
          if (!this.seen.threats.has(key)) {
            this.seen.threats.add(key);
            const pct = Math.floor((val / econTarget) * 100);
            this.pushFeed(`${name(p.id)} Ledger progress: ${pct}% ($${Math.floor(val).toLocaleString()})! Stop them!`, true, "prophecy");
          }
        }
      }
    }
  }

  /**
   * BELIEVER SHARE BAR (design §02): each cult's share of the town's souls —
   * own cult first, then rivals descending, then the unconverted remainder.
   * Called from main.ts at the same 5-tick cadence the old Pixi bar used.
   */
  renderShareBar(): void {
    const s = this.g.sim;
    const w = s.world;
    const popByOwner = new Map<number, number>();
    for (let t = 0; t < w.owner.length; t++) {
      const o = w.owner[t]!;
      if (o === NEUTRAL || w.state[t] !== TileState.Believer) continue;
      popByOwner.set(o, (popByOwner.get(o) ?? 0) + w.pop[t]!);
    }
    const total = Math.max(1, s.totalPop);
    const meId = this.g.playerId;
    const nameOf = (id: number): string => this.g.players.find((p) => p.id === id)?.name ?? `Cult #${id}`;
    const segs: { color: string; pct: number; label: string; me: boolean }[] = [];
    segs.push({ color: colorForPlayer(meId), pct: ((popByOwner.get(meId) ?? 0) / total) * 100, label: nameOf(meId), me: true });
    const rivals = [...popByOwner.entries()].filter(([id]) => id !== meId).sort((a, z) => z[1] - a[1]);
    for (const [id, pop] of rivals) {
      segs.push({ color: colorForPlayer(id), pct: (pop / total) * 100, label: nameOf(id), me: false });
    }
    const restPct = Math.max(0, 100 - segs.reduce((t, sg) => t + sg.pct, 0));
    segs.push({ color: "#3a2e1c", pct: restPct, label: "unconverted", me: false });
    const html = segs
      .map(
        (sg) =>
          `<div class="seg${sg.me ? " me" : ""}" style="width:${sg.pct.toFixed(3)}%;background:${sg.color}">${
            sg.pct >= 9 ? `<span class="snm">${esc(sg.label)}</span><span class="spc">${Math.round(sg.pct)}%</span>` : ""
          }</div>`,
      )
      .join("");
    if (this.el.share.dataset.h !== html) {
      this.el.share.innerHTML = html;
      this.el.share.dataset.h = html;
    }
  }

  update(): void {
    const s = this.g.sim;
    const me = this.me();
    if (!me) return;

    // apply the cult's accent (armed/selected states, signature, badge)
    if (this.accentFor !== me.archetype) {
      this.accentFor = me.archetype;
      const acc = ARCH_ACCENT[me.archetype] ?? ARCH_ACCENT["circle"]!;
      this.root.style.setProperty("--fk-acc", acc.a);
      this.root.style.setProperty("--fk-acc2", acc.b);
    }

    // derive $/sec + follower trend at sim rate
    if (s.tick !== this.prev.tick) {
      const dt = (s.tick - this.prev.tick) / 10;
      if (dt > 0) {
        this.usdPerSec = (toInt(me.usd) - this.prev.usd) / dt;
        this.folTrend = toInt(me.followers) - this.prev.followers;
      }
      this.prev = { followers: toInt(me.followers), usd: toInt(me.usd), tick: s.tick };
    }

    const fol = toInt(me.followers);
    const arrow = this.folTrend > 1 ? " ▲" : this.folTrend < -1 ? " ▼" : "";
    this.el.followers.textContent = fmtNum(fol) + arrow;
    this.el.usd.textContent = fmtMoney(toInt(me.usd));
    this.el.usd.title = `${this.usdPerSec >= 0 ? "+" : ""}${fmtMoney(Math.round(this.usdPerSec))}/s`;
    this.el.faith.textContent = `${toFloat(me.faith).toFixed(0)}`;
    const heat = toFloat(me.heat);
    this.el.heat.textContent = `${heat.toFixed(0)}`;
    const hot = heat >= 50;
    this.el.heat_box?.classList.toggle("hot", hot);
    this.el.heat_sub.textContent = hot ? "◆" : "";
    this.el.timer.textContent = s.timerTicks > 0 ? fmtTime(s.timerTicks - s.tick) : fmtTime(s.tick);

    const leader = [...s.players].filter((p) => p.spawned).sort((a, b) => b.ownedTiles - a.ownedTiles)[0];
    const leaderPct = leader && s.populated > 0 ? (leader.ownedTiles * 100) / s.populated : 0;
    this.el.leader.textContent = `${leaderPct.toFixed(0)}%`;
    this.el.leader.title = leader ? `${this.g.players.find((p) => p.id === leader.id)?.name ?? "—"} leads` : "";

    // stance highlight
    this.el.stanceGroup.querySelectorAll<HTMLElement>("[data-stance]").forEach((b) => {
      b.classList.toggle("on", b.dataset.stance === me.stance);
    });

    // powers: labels, live costs, affordability greying, cooldown countdowns —
    // the same treatment builds get (§27)
    const usd = toInt(me.usd);
    const faith = toFloat(me.faith);
    const powers = [
      { el: this.el.actD, def: ACTIVE_D[me.archetype]!, key: "D", role: "archetype power; some target a tile" },
      { el: this.el.actF, def: ACTIVE_F[me.archetype]!, key: "F", role: "archetype power; some target a tile" },
      { el: this.el.actG, def: SIGNATURE[me.archetype]!, key: "G", role: "your signature, the big play" },
    ] as const;
    for (const { el, def, key, role } of powers) {
      el.querySelector<HTMLElement>(".lb")!.textContent = def.label;
      const cd = def.cd ? (me.cooldowns[def.cd] ?? 0) : 0;
      const c = def.cost?.(me);
      const needUsd = c?.usd ?? 0;
      const needFaith = c?.faith ?? 0;
      let cant = cd <= 0 && ((needUsd > 0 && usd < needUsd) || (needFaith > 0 && faith < needFaith));
      let costText = needUsd ? fmtMoney(needUsd) : needFaith ? `${needFaith}✛` : "";
      let hint = needUsd ? ` (costs ${fmtMoney(needUsd)})` : needFaith ? ` (costs ${needFaith} Faith)` : "";
      if (def.id === "prophecy") {
        // Prophecy is gated by territory + once-per-match, not resources (§11.1)
        const minTiles = Math.min(KIT.prophecy.minTiles, Math.max(1, Math.floor(s.populated * KIT.prophecy.minShareOfPopulated)));
        cant = me.prophecyUsed || me.ownedTiles < minTiles;
        costText = me.prophecyUsed ? "used" : `${me.ownedTiles}/${minTiles}⬢`;
        hint = ` — needs ${minTiles} tiles, once per match`;
      } else if (def.passive) {
        costText = "passive";
        cant = false;
        hint = " — lands passively with your kit";
      }
      el.classList.toggle("cd", cd > 0);
      el.classList.toggle("cant", cant);
      const costEl = el.querySelector<HTMLElement>(".cost");
      if (costEl) costEl.textContent = cd > 0 ? `${Math.ceil(cd / 10)}s` : costText;
      el.title = `${def.label} (${key}) — ${role}${hint}`;
    }

    // build palette: live cost, affordability greying, armed highlight
    // (civic control passed so a held sawmill shows its discounted price)
    const civicsNow = computeCivicControl(s);
    this.el.builds.querySelectorAll<HTMLElement>("[data-build]").forEach((b) => {
      const type = b.dataset.build as BuildingType;
      const cost = toInt(buildingCost(s, me.id, type, civicsNow, this.g.balance));
      const armed = this.ui.placement?.mode === "build" && this.ui.placement.building === type;
      b.classList.toggle("arm", armed);
      b.classList.toggle("cant", usd < cost && !armed);
      const costEl = b.querySelector<HTMLElement>(".cost");
      if (costEl) costEl.textContent = fmtMoney(cost);
    });

    // SCHEME buttons: light up whichever action is armed
    if (this.el.scheme) {
      const armedKey = this.schemeKey(this.ui.placement);
      this.el.scheme.querySelectorAll<HTMLElement>("[data-scheme]").forEach((b) => {
        b.classList.toggle("arm", b.dataset.scheme === armedKey);
      });
    }

    // BUY LAND: live escalating price + affordability
    {
      const landBtn = this.el.builds.querySelector<HTMLElement>("[data-land]");
      if (landBtn) {
        const cost = toInt(propertyCost(me, this.g.balance));
        const armed = this.ui.placement?.mode === "property";
        landBtn.classList.toggle("arm", armed);
        landBtn.classList.toggle("cant", usd < cost && !armed);
        const costEl = landBtn.querySelector<HTMLElement>(".cost");
        if (costEl) costEl.textContent = fmtMoney(cost);
      }
    }

    // CROWDING (§18 rev.): flag the follower readout when land runs out
    {
      const stats = propertyStats(s, me.id);
      const crowded = stats.tiles > 0 && stats.free < 3;
      if (crowded) {
        this.el.followers.textContent += " ⚠";
        this.el.followers.title = "Crowded! Your land is full — buy property (N) or your flock stops growing.";
      } else {
        this.el.followers.title = `${stats.free} free parcel tiles`;
      }
    }

    // CIVICS panel: who holds the key buildings (refresh ~1/s)
    if (s.tick % 10 === 0) this.renderCivics(s);

    // doctrine badge
    const pts = doctrinePointsAvailable(me);
    (this.el.docBadge as HTMLElement).style.display = pts > 0 ? "flex" : "none";
    this.el.docBadge.textContent = `${pts}`;

    this.renderPlayers(s);
    this.collectDrama(s);
    this.renderFeed(s);
    this.renderBanner(s);
    this.renderMinimap(s);
  }

  private renderPlayers(s: SimState): void {
    const rows = [...s.players].filter((p) => p.spawned).sort((a, b) => b.ownedTiles - a.ownedTiles);
    const allies = new Set<number>();
    for (const al of s.alliances) {
      if (al.a === this.g.playerId) allies.add(al.b);
      if (al.b === this.g.playerId) allies.add(al.a);
    }
    const html =
      `<h4>Congregations</h4>` +
      rows
        .map((p) => {
          const nm = esc(this.g.players.find((q) => q.id === p.id)?.name ?? `Cult #${p.id}`);
          const me = p.id === this.g.playerId;
          const tags = `${p.traitor ? "🗡" : ""}${allies.has(p.id) ? "🤝" : ""}${!p.alive ? "☠" : ""}`;
          const acts =
            me || !p.alive
              ? ""
              : `<span class="act" data-ally="${p.id}" title="${allies.has(p.id) ? "break the alliance" : "propose an alliance"}">${allies.has(p.id) ? "✕" : "ally"}</span>`;
          return `<div class="fk-prow${me ? " me" : ""}${!p.alive ? " dead" : ""}">
          <span class="sw" style="background:${colorForPlayer(p.id)}"></span>
          <span class="nm" title="${nm}">${nm}</span>
          <span class="tg">${tags}</span>
          <span class="tl" title="households held">${p.ownedTiles}</span>${acts}</div>`;
        })
        .join("");
    if (this.el.players.dataset.h !== html) {
      this.el.players.innerHTML = html;
      this.el.players.dataset.h = html;
      this.el.players.querySelectorAll<HTMLElement>("[data-ally]").forEach((a) => {
        a.onclick = () => {
          const target = Number(a.dataset.ally);
          const allied = allies.has(target);
          this.send({ t: allied ? "ALLY_BREAK" : "ALLY_PROPOSE", target } as ClientIntent);
        };
      });
    }
  }

  private renderFeed(s: SimState): void {
    const kq = (col: string): string => `<span class="kq" style="background:${col}"></span>`;
    const offers = s.allianceOffers
      .filter((o) => o.to === this.g.playerId)
      .map((o) => {
        const nm = esc(this.g.players.find((p) => p.id === o.from)?.name ?? `Cult #${o.from}`);
        return `<div class="e">${kq(FEED_COL["ally"]!)}<span>✉ ${nm} offers alliance — <span class="act" data-accept="${o.from}">accept</span></span></div>`;
      })
      .join("");
    const lines = this.feed
      .map((f) => `<div class="e">${kq(FEED_COL[f.tag] ?? "#a08a64")}<span>${f.text}</span></div>`)
      .join("");
    // chat (server-moderated) — hidden when muted via the .fk-mute-chat class
    const chat = this.g.chat
      .slice(-8)
      .map((c) => {
        const nm = this.g.players.find((p) => p.id === c.from)?.name ?? `Cult #${c.from}`;
        return `<div class="e fk-chat">${kq("#8a7550")}<span style="color:#a08a64">💬 ${esc(nm)}: ${esc(c.msg)}</span></div>`;
      })
      .join("");
    const html = `<div class="fk-feed-h">● DRAMA FEED</div>${offers}${lines}${chat}`;
    if (this.el.feed.dataset.h !== html) {
      this.el.feed.innerHTML = html;
      this.el.feed.dataset.h = html;
      this.el.feed.querySelectorAll<HTMLElement>("[data-accept]").forEach((a) => {
        a.onclick = () => this.send({ t: "ALLY_ACCEPT", target: Number(a.dataset.accept) } as ClientIntent);
      });
    }
  }

  private renderBanner(s: SimState): void {
    const existing = this.root.querySelector(".fk-banner");
    if (this.banner && s.tick < this.banner.until) {
      if (!existing) {
        const b = document.createElement("div");
        b.className = "fk-banner";
        // feed text is pre-escaped (names run through esc()), safe for innerHTML
        b.innerHTML = `<span class="bx">‼</span><span>${this.banner.text}</span>`;
        this.root.appendChild(b);
      }
    } else if (existing) {
      existing.remove();
      this.banner = null;
    }
  }

  /** Throttled minimap: territory colors + fog, sampled straight from owner[]. */
  private renderMinimap(s: SimState): void {
    const w = s.world;
    const W = this.mini.width;
    const H = this.mini.height;
    // territory (throttled — the expensive part), cached on an offscreen image
    if (s.tick - this.lastMiniTick >= 5 || !this.miniImg) {
      this.lastMiniTick = s.tick;
      const img = this.miniCtx.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        const sy = ((y * w.height) / H) | 0;
        for (let x = 0; x < W; x++) {
          const sx = ((x * w.width) / W) | 0;
          const t = sy * w.width + sx;
          const o = w.owner[t]!;
          let r = 26,
            g = 22,
            b = 18;
          if (o !== 0) {
            const hex = colorForPlayer(o);
            r = parseInt(hex.slice(1, 3), 16);
            g = parseInt(hex.slice(3, 5), 16);
            b = parseInt(hex.slice(5, 7), 16);
          }
          const i = (y * W + x) * 4;
          img.data[i] = r;
          img.data[i + 1] = g;
          img.data[i + 2] = b;
          img.data[i + 3] = 255;
        }
      }
      this.miniImg = img;
    }
    this.miniCtx.putImageData(this.miniImg, 0, 0);
    // live viewport rectangle so you know where you're looking
    if (this.camera) {
      const v = this.camera.getView();
      if (v.w > 0 && v.w < w.width) {
        this.miniCtx.strokeStyle = "rgba(255,255,255,0.85)";
        this.miniCtx.lineWidth = 1;
        this.miniCtx.strokeRect(
          (v.x / w.width) * W + 0.5,
          (v.y / w.height) * H + 0.5,
          (v.w / w.width) * W,
          (v.h / w.height) * H,
        );
      }
    }
  }

  /** Key-buildings panel (§13 rev.): holder swatch + effect, click to jump. */
  private renderCivics(s: SimState): void {
    const w = s.world;
    const control = computeCivicControl(s);
    const siege = new Map<number, SiegeBar>(computeSiegeState(s).map((b) => [b.lot, b]));
    const NAMES: Record<number, string> = {
      [Lot.Sheriff]: "Police",
      [Lot.School]: "Elementary",
      [Lot.HighSchool]: "High School",
      [Lot.Supermarket]: "Grocery",
      [Lot.Church]: "Church",
      [Lot.GrainElevator]: "Grain Elevator",
      [Lot.Cannery]: "Cannery",
      [Lot.Sawmill]: "Sawmill",
      [Lot.Lighthouse]: "Lighthouse",
    };
    // §2A anchors only exist on their archetype's map — list what THIS town has
    const present = new Set<number>();
    for (let t = 0; t < w.lot.length; t++) if (w.lot[t] !== 0) present.add(w.lot[t]!);
    let html = `<h4>Key Buildings</h4>`;
    for (const lot of CIVIC_LOTS) {
      if (!present.has(lot)) continue;
      const holder = control.get(lot) ?? 0;
      const mine = holder === this.g.playerId;
      const holderName =
        holder === 0
          ? ""
          : esc(this.g.players.find((p) => p.id === holder)?.name ?? `Cult #${holder}`);
      const sw =
        holder === 0
          ? `<span class="sw" style="background:#4a3a26"></span>`
          : `<span class="sw" style="background:${colorForPlayer(holder)}"></span>`;
      const bar = siege.get(lot);
      const leaderFill = bar?.leaderFill ?? 0;
      const leaderColor = bar && bar.leader !== 0 ? colorForPlayer(bar.leader) : "#4a3a26";
      const contested = bar?.contested ?? false;
      const siegeBar = `<div class="siege${contested ? " contested" : ""}" data-fill="${leaderFill.toFixed(3)}" data-contested="${contested}">
        <div class="fill" style="width:${(leaderFill * 100).toFixed(1)}%;background:${leaderColor}"></div></div>`;
      html += `<div class="fk-prow${mine ? " me" : ""}" data-civic="${lot}" style="cursor:pointer;pointer-events:auto" title="${esc(CIVIC_EFFECTS[lot] ?? "")}">
        ${sw}<span class="nm">${NAMES[lot] ?? "?"}</span>
        <span class="hold">${holder === 0 ? "unclaimed" : holderName}</span>${siegeBar}</div>`;
    }
    if (this.el.civics.dataset.h !== html) {
      this.el.civics.innerHTML = html;
      this.el.civics.dataset.h = html;
      this.el.civics.querySelectorAll<HTMLElement>("[data-civic]").forEach((row) => {
        row.onclick = () => {
          const lot = Number(row.dataset.civic);
          // jump to the controlling instance if held, else the first on the map
          const holderNow = computeCivicControl(this.g.sim).get(lot) ?? 0;
          let target = -1;
          for (let t = 0; t < w.lot.length; t++) {
            if (w.lot[t] !== lot) continue;
            if (target < 0) target = t;
            if (holderNow !== 0 && w.owner[t] === holderNow) {
              target = t;
              break;
            }
          }
          if (target >= 0) this.camera?.flashTile(target, performance.now());
        };
      });
    }
  }

  destroy(): void {
    window.removeEventListener("keydown", this.focusChatKey);
    this.root.remove();
  }
}

/** Doctrine columns (design B.I.T.E.): branch accent + pixel glyph. */
const DOC_COLS: { br: string; title: string; accent: string; ic: string }[] = [
  { br: "B", title: "BEHAVIOR", accent: "#df5a2b", ic: "tower" },
  { br: "I", title: "INFORMATION", accent: "#4fa3ad", ic: "eye" },
  { br: "T", title: "THOUGHT", accent: "#e0a422", ic: "mega" },
  { br: "E", title: "EMOTIONAL", accent: "#84a23c", ic: "heart" },
];

/**
 * Doctrine picker (§28): the 4-column BITE grid as a transient panel (not a
 * blocking modal — click-away closes it). Real numbers shown per node.
 */
function showDoctrinePanel(g: GameSession): void {
  document.querySelector(".fk-doc-panel")?.remove();
  const me = g.sim.players.find((p) => p.id === g.playerId);
  if (!me) return;
  const pts = doctrinePointsAvailable(me);
  const NODES: Record<string, string[]> = {
    B: ["Tithing Drill +10% tithe", "Uniforms +15% home def", "Curfew −dissent", "Total Discipline"],
    I: ["Newsletter +Heat vis", "Wiretap intercept", "Strong Signal strikes", "Total Surveillance"],
    T: ["Better Pamphlets +10% R₀", "Loaded Language", "Us vs Them", "Sacred Science"],
    E: ["Welcome Basket −30%", "Love Bombing", "Shunning", "Unshakeable"],
  };
  const panel = document.createElement("div");
  panel.className = "fk-doc-panel";
  panel.style.cssText =
    "position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;" +
    "background:rgba(10,7,4,.82);font-family:'Pixelify Sans',ui-monospace,monospace;color:#efe3c6";
  const grid = DOC_COLS.map((col) => {
    const cells = (NODES[col.br] ?? [])
      .map((label, i) => {
        const node = `${col.br}${i + 1}`;
        const have = me.doctrine.includes(node);
        const style = have
          ? `background:${col.accent};color:#19110a;box-shadow:inset 0 0 0 2px ${col.accent},0 3px 0 #060403;cursor:default`
          : `background:#241c12;color:#efe3c6;box-shadow:inset 0 0 0 1px #36291a,0 3px 0 #060403;cursor:pointer`;
        return `<button class="fk-doc-node" data-node="${node}"
          style="display:block;width:100%;margin:0 0 5px;padding:8px 9px;text-align:left;border:0;font-family:inherit;${style}">
          <div style="font-weight:700;font-size:12px;letter-spacing:.5px">${node}</div>
          <div style="font-size:11px;opacity:.82;margin-top:2px;line-height:1.2">${label}</div></button>`;
      })
      .join("");
    return `<div style="width:196px">
      <div style="font-family:'Press Start 2P',monospace;font-size:8px;letter-spacing:1px;color:${col.accent};margin-bottom:8px;display:flex;align-items:center;gap:6px">${icon(col.ic, col.accent, 11)}${col.title}</div>
      ${cells}</div>`;
  }).join("");
  panel.innerHTML = `<div style="background:#1a130b;border:3px solid #6b563a;box-shadow:0 8px 0 #060403,inset 0 0 0 2px #36291a;padding:22px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:16px">
      <div style="font-family:'Press Start 2P',monospace;font-size:13px;letter-spacing:1px;color:#efe3c6">DOCTRINE ▸ B.I.T.E.</div>
      <div style="font-family:'VT323',monospace;font-size:20px;color:#f0b53e">${pts} POINT${pts === 1 ? "" : "S"}</div>
    </div><div style="display:flex;gap:12px">${grid}</div>
    <div style="text-align:center;margin-top:14px;font-size:12px;color:#8a7550">irreversible · real numbers · click outside to close · <b>shift-click an owned node to share it with your ally (§16 pact)</b></div></div>`;
  panel.onclick = (e) => {
    if (e.target === panel) panel.remove();
  };
  panel.querySelectorAll<HTMLElement>("[data-node]").forEach((b) => {
    b.onclick = (ev) => {
      const node = b.dataset.node!;
      const meNow = g.sim.players.find((p) => p.id === g.playerId);
      if ((ev as MouseEvent).shiftKey) {
        // Ecumenical Pact (§16): share an OWNED node with your ally
        if (meNow?.doctrine.includes(node)) {
          g.sendIntent({ t: "PACT_PICK", node } as ClientIntent);
        }
        return;
      }
      if (meNow?.doctrine.includes(node)) return; // owned: pick is a no-op
      g.sendIntent({ t: "DOCTRINE_PICK", node } as ClientIntent);
      setTimeout(() => {
        panel.remove();
        showDoctrinePanel(g); // reopen to reflect the pick
      }, 60);
    };
  });
  document.getElementById("app")!.appendChild(panel);
}
