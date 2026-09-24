/**
 * In-match HUD (§27, STAGE1_DESIGN §9) — crisp DOM UI layered over the chunky
 * PixiJS world. Everything here is feed/banner/ping, never a modal (§29).
 *
 * Visual language (Claude Design handoff, "Interface Testament v3.0"):
 * pixelated cult-revival — Press Start 2P / Pixelify Sans / VT323,
 * harvest-gold chrome, 3px #4a3a26 pixel borders, hard 0 4px 0 #060403 drops,
 * square corners everywhere. The player's own archetype accent re-dresses
 * armed/selected states, the signature power and the doctrine badge.
 *
 * Layout (desktop; rails collapse via the ◄/► pixel toggles):
 *   share bar    soul share of the town, own cult first + TIPPING POINT marker
 *   top bar      FLOCK · TREASURY · FAITH · HEAT · MATCH · LEADER (souls)
 *   center col   ASCENSION strips · banner · status prompt · active buffs
 *   left rail    MISSIONS n/3 · POWERS (from the archetype registry)
 *   threat lane  incoming strikes, CPA, rival Ascensions, Exposes (click = jump)
 *   bottom       coach nudge · COMMUNE [B] · LAND [N] · RECRUIT [R] · DOCTRINE · DISSENT [H] · minimap
 *   right rail   VICTORY RACE · KEY BUILDINGS (+ decrees) · DRAMA FEED · chat
 *
 * Verbs: SEND = right-click town (mission wheel) · SPEND = the tray + powers ·
 * SCHEME = right-click a rival's ground (hud/scheme.ts). Left-click inspects.
 *
 * The HUD reads the predicted sim each update() (≈10 Hz) and writes intents
 * through the session. Targeted powers arm a placement that main.ts's map
 * click consumes, so they share the world cursor.
 */

import {
  toInt,
  toFloat,
  Terrain,
  Lot,
  Landmark,
  MAX_COHORTS,
  COMMUNE_MAX_STAGE,
  DOCTRINE_FAITH_COST,
  doctrinePointsAvailable,
  colorForPlayer,
  buildingCost,
  streetAt,
  householdName,
  memberName,
  propertyCost,
  propertyStats,
  followerCap,
  computeCivicControl,
  computeMonopolies,
  canExecuteCivicDecree,
  ownsLandmark,
  CivicDecreeId,
  CIVIC_DECREES,
  computeSiegeState,
  CIVIC_LOTS,
  CIVIC_EFFECTS,
  EXPOSE,
  type SimState,
  type PlayerState,
  type SiegeBar,
} from "@flock/sim";
import type { GameSession, ClientIntent } from "./net.js";
import { playFactionTheme, playCivicDecreeSfx, playMonopolyUnlockSfx } from "./audio.js";
import { GLYPH, icon, esc, fmtMoney, fmtNum, fmtTime, archAccent, seatName, type Camera } from "./hud/common.js";
import { RacePanel, AscensionStrip, computeRace, RACE_CSS } from "./hud/race.js";
import { ThreatLane, THREAT_CSS } from "./hud/threats.js";
import { PowersPanel, type PowerEntry } from "./hud/powers.js";
import { SchemeMenu, SCHEME_CSS } from "./hud/scheme.js";
import { Coach, COACH_CSS, coachEnabled } from "./hud/coach.js";
import { END_CSS } from "./hud/endgame.js";

export { GLYPH, type Camera };

export type PlacementKind =
  | { mode: "build"; building: string; key: string }
  | { mode: "strike"; strike: string }
  | { mode: "ability"; ability: string }
  | { mode: "property" };

/** Shared interaction state between the HUD and the map-click handler. */
export interface UiState {
  /** armed targeted action awaiting a map click, or null for default. */
  placement: PlacementKind | null;
}

/** Mission-mode dress (wheel + missions list share it). */
export const MODES = [
  { id: "tend", label: "TEND", col: "#6f9b6a", ic: "candle" },
  { id: "spread", label: "SPREAD", col: "#d8a83a", ic: "mega" },
  { id: "crusade", label: "CRUSADE", col: "#cf4b2c", ic: "flame" },
] as const;

/**
 * Civic decree hotkeys — one digit per decree, shown on the held Key
 * Buildings row next to the price. main.ts binds exactly these.
 */
export const DECREE_KEYS: Record<string, string> = {
  [CivicDecreeId.TownCurfew]: "5",
  [CivicDecreeId.PepRally]: "6",
  [CivicDecreeId.ParentTeacherNight]: "7",
  [CivicDecreeId.FoodRationing]: "8",
  [CivicDecreeId.EvangelicalRevival]: "9",
  [CivicDecreeId.MunicipalInjunction]: "0",
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
  asc: "#f0b53e",
};

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

/**
 * Short place label for a tile — the mission wheel's center readout (M6).
 * Prefers a named landmark or civic lot, then a household, then the terrain.
 * Kept in sync with the hover-chip vocabulary above so a right-click names
 * the same place the pointer just did.
 */
export function targetName(sim: SimState, tile: number): string {
  const w = sim.world;
  if (tile < 0 || tile >= w.terrain.length) return "the map";
  if (w.landmark[tile] !== 0) return LANDMARK_NAMES[w.landmark[tile]!] ?? "a landmark";
  const terrain = w.terrain[tile]!;
  if (terrain === Terrain.Citizen) {
    const lot = w.lot[tile]!;
    const pop = w.pop[tile]!;
    if (lot !== 0) return LOT_NAMES[lot] ?? "a lot";
    if (pop >= 3) return `the ${householdName(tile)} place`;
    return "a quiet lot";
  }
  const street = streetAt(w.streets, w.width, tile);
  if (street) return street;
  return TERRAIN_NAMES[terrain] ?? "the edge of town";
}

/** Key Buildings row labels. */
const CIVIC_NAMES: Record<number, string> = {
  [Lot.Sheriff]: "Police",
  [Lot.School]: "Elementary",
  [Lot.HighSchool]: "High School",
  [Lot.Supermarket]: "Grocery",
  [Lot.Church]: "Church",
  [Lot.Bank]: "Bank",
  [Lot.GrainElevator]: "Grain Elevator",
  [Lot.Cannery]: "Cannery",
  [Lot.Sawmill]: "Sawmill",
  [Lot.Lighthouse]: "Lighthouse",
};

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
/* ---- sleek compact active civic & monopoly status tray (Task 2.5) ---- */
.fk-civic-tray{position:absolute;top:92px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:6px;min-height:28px;background:rgba(26,19,11,0.88);border:2px solid #4a3a26;border-radius:4px;box-shadow:0 3px 0 #060403;padding:2px 8px;z-index:6;pointer-events:none;transition:all .15s ease-in-out;backdrop-filter:blur(3px)}
.fk-civic-tray.collapsed{min-height:14px;padding:1px 5px;background:rgba(26,19,11,0.65)}
.fk-civic-tray.collapsed .fk-badge-list{display:none}
.fk-civic-toggle{pointer-events:auto;cursor:pointer;font-size:9px;color:#8a7550;display:flex;align-items:center;justify-content:center;width:14px;height:20px;border-radius:2px;background:#140e08;border:1px solid #36291a;padding:0}
.fk-civic-toggle:hover{color:#e0a422;border-color:#6b563a}
.fk-badge-list{display:flex;align-items:center;gap:6px}
.fk-buff-badge{pointer-events:auto;position:relative;display:flex;align-items:center;gap:5px;height:22px;padding:0 6px 0 3px;border-radius:3px;background:#140e08;border:1px solid var(--badge-border,#6b563a);box-shadow:0 0 6px var(--badge-glow,rgba(234,179,8,0.25));cursor:help;transition:transform .1s}
.fk-buff-badge:hover{transform:translateY(-1px);box-shadow:0 0 10px var(--badge-glow,rgba(234,179,8,0.5))}
.fk-buff-pie{position:relative;width:16px;height:16px;border-radius:50%;background:conic-gradient(var(--badge-col,#eab308) var(--pie-pct,100%), #2a2015 0%);display:flex;align-items:center;justify-content:center}
.fk-buff-pie::after{content:'';position:absolute;width:12px;height:12px;border-radius:50%;background:#140e08}
.fk-buff-pie .ic{position:relative;z-index:1;color:var(--badge-col,#eab308)}
.fk-buff-time{font-family:'VT323',monospace;font-size:14px;color:#efe3c6;line-height:1}
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
/* active missions list (v3) */
.fk-missions{display:flex;flex-direction:column;gap:4px}
.fk-nomissions{font-family:'VT323',monospace;font-size:13px;color:#8a7550;line-height:1.15;padding:2px 1px}
.fk-mrow{display:flex;align-items:center;gap:6px;pointer-events:auto;cursor:pointer;background:#160f07;box-shadow:inset 0 0 0 1px #36291a;padding:5px 7px}
.fk-mrow:hover{background:#20160c;box-shadow:inset 0 0 0 1px var(--fk-acc)}
.fk-mrow.recalling{opacity:.55}
.fk-mrow .mic{flex:none;display:flex}
.fk-mrow .mnm{flex:1;font-family:'Pixelify Sans',ui-monospace,monospace;font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fk-mrow .mms{font-family:'VT323',monospace;font-size:15px;color:#c4ad82;flex:none}
.fk-mrow .mrecall{flex:none;pointer-events:auto;cursor:pointer;font-family:'VT323',monospace;font-size:15px;color:#e0894a;background:#0e0a05;box-shadow:inset 0 0 0 1px #4a3a26;width:20px;height:20px;line-height:1;padding:0}
.fk-mrow .mrecall:hover{background:var(--fk-acc);color:#19110a}
/* powers: D/F rows + G signature in the cult accent */
.fk-pow .ic{color:var(--fk-acc2)}
.fk-sig{background:var(--fk-acc);color:#19110a;font-weight:700;letter-spacing:.5px;padding:9px;box-shadow:inset 0 0 0 2px var(--fk-acc2),0 3px 0 #060403}
.fk-sig:hover{box-shadow:inset 0 0 0 2px var(--fk-acc2),0 3px 0 #060403}
.fk-sig .ic,.fk-sig .k,.fk-sig .cost{color:#19110a}
/* ---- rails + collapse toggles ---- */
.fk-left{position:absolute;left:16px;top:92px;display:flex;flex-direction:column;gap:8px;z-index:6;pointer-events:none;max-height:calc(100vh - 190px)}
.fk-rail{display:flex;align-items:flex-start;gap:6px}
.fk-rail-stack{width:198px;display:flex;flex-direction:column;gap:11px;overflow:auto}
.fk-collapse{width:20px;height:66px;display:flex;align-items:center;justify-content:center;font-family:'Press Start 2P',monospace;font-size:9px;color:#e0a422;background:#1a130b;border:3px solid #4a3a26;box-shadow:0 4px 0 #060403;padding:0;flex:none}
.fk-collapse.h{width:66px;height:20px}
.fk-right{position:absolute;right:16px;top:88px;display:flex;align-items:flex-start;gap:6px;z-index:6}
.fk-right-stack{width:236px;display:flex;flex-direction:column;gap:11px;max-height:calc(100vh - 110px)}
.fk-hud ::-webkit-scrollbar{width:6px;height:6px}
.fk-hud ::-webkit-scrollbar-thumb{background:#4a3a26}
.fk-hud ::-webkit-scrollbar-track{background:#140e08}
.fk-civics{overflow-x:hidden}
.fk-civics{overflow:auto;max-height:212px}
.fk-prow .dec{pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:4px;margin-left:auto;font-family:'VT323',monospace;font-size:14px;line-height:1;color:#19110a;background:var(--fk-acc);box-shadow:0 2px 0 #060403;padding:2px 5px;flex:none}
.fk-prow .dec .k{font-family:'Press Start 2P',monospace;font-size:6px;background:#19110a;color:var(--fk-acc2);padding:2px 3px}
.fk-prow .dec.off{background:#241c12;color:#8a7550;box-shadow:inset 0 0 0 1px #4a3a26}
.fk-prow .dec:hover:not(.off){filter:brightness(1.12)}
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
@media(max-width:900px){
  .fk-top{padding:0 4px;gap:0}
  .fk-stat{padding:6px 9px;gap:6px}
  .fk-stat .v{font-size:20px}
  .fk-stat .l{font-size:6px}
  .fk-rail-stack{width:130px}
  .fk-right-stack{width:160px}
  .fk-hoverchip{max-width:160px;font-size:10px}
}
@media(max-width:680px){
  .fk-top{top:30px}
  .fk-civic-tray{top:80px}
  .fk-left{left:4px}
  .fk-right{right:4px}
  .fk-bottom{bottom:6px}
}
/* ---- center column: ascension · banner · prompt · buffs · tutorial ---- */
.fk-center{position:absolute;top:104px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;z-index:7;pointer-events:none;width:max-content;max-width:min(640px,56vw)}
.fk-center .fk-civic-tray{position:static;transform:none}
.fk-center .fk-banner{position:static;transform:none;animation:fkIn .3s ease-out;max-width:100%}
.fk-prompt{font-family:'Press Start 2P',monospace;font-size:10px;letter-spacing:1px;line-height:1.7;color:#f0b53e;text-align:center;background:#1a130b;border:3px solid #4a3a26;box-shadow:0 4px 0 #060403,inset 0 0 0 1px #6b563a;padding:11px 20px}
.fk-hoverchip .hint{font-family:'VT323',monospace;font-size:14px;color:#e0a422}
.fk-grp h4 .cnt{float:right;color:#efe3c6;letter-spacing:0}
.fk-grp h4 .cnt.full{color:#e0894a}
.fk-mhint{font-family:'VT323',monospace;font-size:13px;color:#6b563a;margin-top:5px;line-height:1.1}
@media(max-width:1100px){.fk-threats{width:150px}}
`;

/**
 * Cache of HUD elements. Named keys are declared (so reads are non-undefined
 * under noUncheckedIndexedAccess); the index signature keeps the dynamic
 * `stat()` setters typed.
 */
interface ElCache {
  share: HTMLElement;
  tip: HTMLElement;
  followers: HTMLElement;
  usd: HTMLElement;
  faith: HTMLElement;
  heat: HTMLElement;
  heat_box: HTMLElement;
  heat_sub: HTMLElement;
  timer: HTMLElement;
  leader: HTMLElement;
  leader_sub: HTMLElement;
  missions: HTMLElement;
  missionsCnt: HTMLElement;
  builds: HTMLElement;
  doc: HTMLElement;
  docBadge: HTMLElement;
  feed: HTMLElement;
  civics: HTMLElement;
  prompt: HTMLElement;
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
  private seen = {
    scandals: 0,
    prophecies: 0,
    betrayals: 0,
    alliances: 0,
    dead: new Set<number>(),
    threats: new Set<string>(),
    decrees: new Set<number>(),
    monopolies: new Set<string>(),
    asc: new Set<string>(),
  };
  private banner: { text: string; until: number } | null = null;
  showDissent = false;
  private lastMiniTick = -999;
  private miniImg: ImageData | null = null;
  private chatIn!: HTMLInputElement;
  private hoverChip!: HTMLDivElement;
  private hoverPlace!: HTMLElement;
  private hoverStreet!: HTMLElement;
  private hoverHint!: HTMLElement;
  private lastHover = -2;
  private accentFor = "";
  private lastRaceTick = -99;
  /** the center column (ascension strips, banner, prompt, buffs, tutorial) */
  readonly center: HTMLDivElement;
  private readonly race: RacePanel;
  private readonly ascStrip: AscensionStrip;
  private readonly threats: ThreatLane;
  private readonly powers: PowersPanel;
  readonly scheme: SchemeMenu;
  private coach: Coach | null = null;
  private readonly focusChatKey = (ev: KeyboardEvent): void => {
    if (ev.key !== "Enter") return;
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
    ev.preventDefault();
    this.chatIn.focus();
  };

  constructor(
    private readonly g: GameSession,
    private readonly camera: Camera | null = null,
    opts: { openWheel?: (tile: number, x: number, y: number) => void; coach?: boolean } = {},
  ) {
    if (!document.getElementById("fk-hud-css")) {
      const style = document.createElement("style");
      style.id = "fk-hud-css";
      style.textContent = HUD_CSS + RACE_CSS + THREAT_CSS + SCHEME_CSS + COACH_CSS + END_CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement("div");
    this.root.className = "fk-hud";
    this.mini = document.createElement("canvas");
    this.mini.width = 118;
    this.mini.height = 75;
    this.miniCtx = this.mini.getContext("2d")!;
    if (this.camera) {
      this.mini.style.cursor = "pointer";
      this.mini.style.pointerEvents = "auto";
      this.mini.title = "Minimap — click to jump the camera";
      this.mini.onclick = (e) => {
        const r = this.mini.getBoundingClientRect();
        const tx = Math.floor(((e.clientX - r.left) / r.width) * g.sim.world.width);
        const ty = Math.floor(((e.clientY - r.top) / r.height) * g.sim.world.height);
        this.camera!.centerOn(ty * g.sim.world.width + tx);
      };
    }
    const send = (i: ClientIntent): void => this.send(i);
    const pathName = (id: string): string => this.race.current?.pathNames.get(id) ?? id;
    this.race = new RacePanel(g, camera, send);
    this.ascStrip = new AscensionStrip(g, camera, send, pathName);
    this.threats = new ThreatLane(g, camera, pathName);
    this.powers = new PowersPanel((e) => this.firePower(e, -1));
    this.scheme = new SchemeMenu(g, send, (t, x, y) => opts.openWheel?.(t, x, y));
    this.center = document.createElement("div");
    this.center.className = "fk-center";
    if (opts.coach && coachEnabled()) this.coach = new Coach(g, this.powers);
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

  /** Center status line (founding / paused / eliminated); "" hides it. */
  setPrompt(msg: string): void {
    if (this.el.prompt.textContent !== msg) this.el.prompt.textContent = msg;
    this.el.prompt.style.display = msg ? "block" : "none";
  }

  /** Fire a power from the rail or its hotkey (hover tile targets hotkeys). */
  firePower(e: PowerEntry, hover: number): void {
    const a = PowersPanel.action(e, hover);
    if (a.t === "send-signature") this.send({ t: "SIGNATURE" } as ClientIntent);
    else if (a.t === "send-ability")
      this.send({ t: "ABILITY", ability: a.ability, ...(a.target !== undefined ? { target: a.target } : {}) } as ClientIntent);
    else if (this.ui.placement?.mode === "ability" && this.ui.placement.ability === a.ability) this.arm(null);
    else this.arm({ mode: "ability", ability: a.ability });
  }

  /** D / F / G hotkeys. */
  firePowerKey(key: "D" | "F" | "G", hover: number): void {
    const e = this.powers.byKey(key);
    if (e) this.firePower(e, hover);
  }

  /** Digit hotkeys → the decree bound to it (only if you hold the institution). */
  fireDecreeKey(key: string): boolean {
    const id = Object.keys(DECREE_KEYS).find((d) => DECREE_KEYS[d] === key);
    if (!id) return false;
    this.send({ t: "CIVIC_DECREE", decree: id as CivicDecreeId } as ClientIntent);
    return true;
  }

  /** B — raise the commune a stage. */
  upgradeCommune(): void {
    this.send({ t: "UPGRADE_COMMUNE" } as ClientIntent);
  }

  /** N — arm/disarm Buy Land. */
  toggleLand(): void {
    if (this.ui.placement?.mode === "property") this.arm(null);
    else this.arm({ mode: "property" });
  }

  /**
   * Place-identity chip (§2 flavor) + what RIGHT-CLICK will do here — the one
   * consistent lesson: left looks, right acts.
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
    const districtId = w.district[tile] ?? 0;
    const distName = ["Old Town", "Suburbs", "College", "Downtown", "Trailer"][districtId] ?? "Town";
    const owner = w.owner[tile]!;
    if (w.landmark[tile] !== 0) {
      place = `${LANDMARK_NAMES[w.landmark[tile]!] ?? "a landmark"} · ${distName}`;
    } else if (terrain === Terrain.Citizen) {
      const lot = w.lot[tile]!;
      const pop = w.pop[tile]!;
      const ownerName = owner === 0 ? "Neutral" : seatName(this.g.players, owner);
      if (lot !== 0) place = `${(LOT_NAMES[lot] ?? "a lot").toUpperCase()} · ${distName} (${ownerName})`;
      else if (pop >= 3) place = `the ${householdName(tile)} place · ${pop} souls · ${distName}`;
      else if (pop >= 1) place = `${memberName(tile, 0)}'s garden · ${distName}`;
      else place = `an empty lot · ${distName}`;
    } else {
      place = TERRAIN_NAMES[terrain] ?? "";
    }
    const street = streetAt(w.streets, w.width, tile);
    this.hoverPlace.textContent = place;
    this.hoverPlace.style.display = place ? "block" : "none";
    this.hoverStreet.textContent = street ?? "";
    this.hoverStreet.style.display = street ? "block" : "none";
    const me = this.me();
    let hint = "";
    if (me?.spawned && this.g.sim.foundingTicksLeft === 0) {
      if (owner !== 0 && owner !== this.g.playerId) hint = `▸ right-click: scheme vs ${seatName(this.g.players, owner)}`;
      else hint = owner === this.g.playerId ? "▸ right-click: send a mission (Tend holds)" : "▸ right-click: send a mission";
    }
    this.hoverHint.textContent = hint;
    this.hoverHint.style.display = hint ? "block" : "none";
    this.hoverChip.style.display = place || street || hint ? "block" : "none";
  }

  private group(title: string): HTMLDivElement {
    const d = document.createElement("div");
    d.className = "fk-grp";
    d.innerHTML = `<h4>${title}</h4>`;
    return d;
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
    // ---- soul share bar (top:0) + Tipping Point marker --------------------
    const share = document.createElement("div");
    share.className = "fk-share";
    this.el.share = share;
    this.root.appendChild(share);
    const tip = document.createElement("div");
    tip.className = "fk-tip";
    tip.innerHTML = `<span>TIPPING POINT</span>`;
    tip.style.display = "none";
    this.el.tip = tip;
    this.root.appendChild(tip);

    // ---- top bar ---------------------------------------------------------
    const top = document.createElement("div");
    top.className = "fk-top";
    const STAT_TIP: Record<string, string> = {
      followers: "FLOCK — your followers: strength AND health. Missions carry them into town; lose them all and you're out.",
      usd: "TREASURY — tithe cash. Spend it on the COMMUNE, RECRUITMENT DRIVES, POWERS, DECREES and EXPOSES.",
      faith: `FAITH (0–100) — bank it with TEND missions; each DOCTRINE pick costs ${DOCTRINE_FAITH_COST} Faith. Some powers spend it too.`,
      heat: "HEAT — how loud you are. Every conversion raises it (Crusade doubly). At 25+ rivals can EXPOSE you · 60 the CPA pickets you · 85 deprogrammer raids.",
      timer: "MATCH — time left. At zero the cult with the most souls wins.",
      leader: "LEADER — the biggest cult's share of the town's SOULS. Reach the TIPPING POINT (marker on the top bar) to start a Domination Ascension.",
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

    // ---- center column ---------------------------------------------------
    this.center.appendChild(this.ascStrip.el);
    const bannerSlot = document.createElement("div");
    this.el.bannerSlot = bannerSlot;
    const prompt = document.createElement("div");
    prompt.className = "fk-prompt";
    prompt.style.display = "none";
    this.el.prompt = prompt;
    const civicTray = document.createElement("div");
    civicTray.className = "fk-civic-tray";
    civicTray.style.display = "none";
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "fk-civic-toggle";
    toggleBtn.textContent = "▲";
    toggleBtn.title = "collapse / expand active buffs";
    toggleBtn.onclick = () => {
      const isCol = civicTray.classList.toggle("collapsed");
      toggleBtn.textContent = isCol ? "▼" : "▲";
    };
    const badgeList = document.createElement("div");
    badgeList.className = "fk-badge-list";
    civicTray.append(toggleBtn, badgeList);
    this.el.civicTray = civicTray;
    this.el.badgeList = badgeList;
    this.center.append(bannerSlot, prompt, civicTray);
    this.root.appendChild(this.center);

    // ---- left rail: missions + powers -------------------------------------
    const rail = document.createElement("div");
    rail.className = "fk-rail";
    const railStack = document.createElement("div");
    railStack.className = "fk-rail-stack";
    const missionsG = document.createElement("div");
    missionsG.className = "fk-grp fk-missions-g";
    missionsG.innerHTML = `<h4>Missions <span class="cnt">0/${MAX_COHORTS}</span></h4>`;
    missionsG.title = `Up to ${MAX_COHORTS} cohorts can be out at once. Recall one (⟲ or Shift+C for the oldest) to free a slot — they walk home first.`;
    this.el.missionsCnt = missionsG.querySelector(".cnt")!;
    const missionsList = document.createElement("div");
    missionsList.className = "fk-missions";
    missionsG.appendChild(missionsList);
    const mh = document.createElement("div");
    mh.className = "fk-mhint";
    mh.textContent = "right-click town: send · ⟲ / ⇧C: recall";
    missionsG.appendChild(mh);
    this.el.missions = missionsList;
    railStack.append(missionsG, this.powers.el);
    rail.append(railStack, this.collapse(railStack, "◄", "►"));
    // ---- threat lane: stacked under the rail so neither ever moves the other's buttons
    const left = document.createElement("div");
    left.className = "fk-left";
    left.append(rail, this.threats.el);
    this.root.appendChild(left);

    // ---- bottom: coach nudge + tray (commune · land · recruit · doctrine · dissent · minimap)
    const bottom = document.createElement("div");
    bottom.className = "fk-bottom";
    const tray = document.createElement("div");
    tray.className = "fk-tray";
    const buildsWrap = document.createElement("div");
    buildsWrap.className = "fk-builds-wrap";
    buildsWrap.innerHTML = `<div class="fk-builds-lbl">SPEND ▸ grow the cult</div>`;
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
    const commune = buildBtn("COMMUNE", "B", "house", "", () => this.upgradeCommune());
    commune.dataset.build = "compound";
    const land = buildBtn(
      "BUY LAND",
      "N",
      "leaf",
      "BUY LAND [N] — claim a parcel of open country beside your land for the commune to grow into (click, then click open ground). Crowded land stops flock growth.",
      () => this.toggleLand(),
    );
    land.dataset.land = "1";
    const drive = buildBtn(
      "RECRUIT",
      "R",
      "people",
      "RECRUITMENT DRIVE [R] — spend cash to add flock (a batch scaled to your size, capped by your commune). Money → members → missions.",
      () => this.send({ t: "BUY_RECRUITS" } as ClientIntent),
    );
    drive.dataset.recruit = "1";
    builds.append(commune, land, drive);
    buildsWrap.appendChild(builds);
    this.el.builds = builds;

    const doc = document.createElement("button");
    doc.className = "fk-doc";
    doc.title = `DOCTRINE — permanent B.I.T.E. upgrades. Each pick costs ${DOCTRINE_FAITH_COST} Faith (bank Faith with TEND missions). The badge = picks you can afford now. Picks are forever.`;
    doc.innerHTML = `<i class="ic">${icon("scroll", "currentColor", 22)}</i><span class="dl">DOCTRINE</span><span class="badge" style="display:none">0</span>`;
    doc.onclick = () => showDoctrinePanel(this.g);
    this.el.doc = doc;
    this.el.docBadge = doc.querySelector(".badge")!;

    const dis = document.createElement("button");
    dis.className = "fk-doc";
    dis.id = "fk-dissent-overlay";
    dis.title = "DISSENT MAP [H] — heat-map of unrest on your ground. Too much and part of your cult splits away (a Schism). Cool it with TEND missions.";
    dis.innerHTML = `<i class="ic">${icon("eye", "currentColor", 22)}</i><span class="dl">DISSENT [H]</span>`;
    dis.onclick = () => this.toggleDissentOverlay();
    this.el.dissentOverlay = dis;

    const miniWrap = document.createElement("div");
    miniWrap.className = "fk-mini";
    miniWrap.appendChild(this.mini);

    tray.append(buildsWrap, doc, dis, miniWrap);
    if (this.coach) bottom.appendChild(this.coach.el);
    bottom.append(this.collapse(tray, "▼", "▲", true), tray);
    this.root.appendChild(bottom);

    // ---- right rail: victory race + key buildings + drama feed + chat -------
    const right = document.createElement("div");
    right.className = "fk-right";
    const rightStack = document.createElement("div");
    rightStack.className = "fk-right-stack";
    const feed = document.createElement("div");
    feed.className = "fk-grp fk-feed";
    feed.innerHTML = `<div class="fk-feed-h">● DRAMA FEED</div>`;
    this.el.feed = feed;
    const chatIn = document.createElement("input");
    chatIn.className = "fk-chatin";
    chatIn.maxLength = 200;
    chatIn.placeholder = "Enter to chat…";
    chatIn.setAttribute("aria-label", "match chat");
    chatIn.onkeydown = (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") {
        const text = chatIn.value.trim();
        if (text) this.g.sendChat(text);
        chatIn.value = "";
        chatIn.blur();
      } else if (ev.key === "Escape") {
        chatIn.value = "";
        chatIn.blur();
      }
    };
    this.chatIn = chatIn;
    window.addEventListener("keydown", this.focusChatKey);
    const civicsBox = document.createElement("div");
    civicsBox.className = "fk-grp fk-civics";
    civicsBox.innerHTML = `<h4>Key Buildings</h4>`;
    this.el.civics = civicsBox;
    rightStack.append(this.race.el, civicsBox, feed, chatIn);
    right.append(this.collapse(rightStack, "►", "◄"), rightStack);
    this.root.appendChild(right);

    // ---- place-identity chip (bottom-left) ---------------------------------
    const chip = document.createElement("div");
    chip.className = "fk-hoverchip";
    chip.style.display = "none";
    const pl = document.createElement("div");
    pl.className = "pl";
    const st = document.createElement("div");
    st.className = "st";
    const hn = document.createElement("div");
    hn.className = "hint";
    chip.append(pl, st, hn);
    this.hoverPlace = pl;
    this.hoverStreet = st;
    this.hoverHint = hn;
    this.hoverChip = chip;
    this.root.appendChild(chip);

    // ---- help square (top-right) -------------------------------------------
    const help = document.createElement("button");
    help.className = "fk-helpbtn";
    help.textContent = "?";
    help.title = "How to play & controls [?]";
    help.onclick = () => this.toggleHelp();
    this.root.appendChild(help);
  }

  /** Controls reference overlay (§28), toggled by the ? button/key. */
  toggleHelp(): void {
    const existing = this.root.querySelector(".fk-help");
    if (existing) {
      existing.remove();
      return;
    }
    const b = (t: string): string => `<b style="color:#e0a422">${t}</b>`;
    const k = (t: string): string =>
      `<span style="font-family:'Press Start 2P',monospace;font-size:8px;color:#a08a64;background:#0e0a05;padding:2px 4px;box-shadow:inset 0 0 0 1px #4a3a26">${t}</span>`;
    const panel = document.createElement("div");
    panel.className = "fk-help";
    panel.style.cssText =
      "position:absolute;inset:0;z-index:45;display:flex;align-items:center;justify-content:center;background:rgba(10,7,4,.82);pointer-events:auto";
    panel.innerHTML = `<div style="background:#1a130b;border:3px solid #6b563a;box-shadow:0 8px 0 #060403,inset 0 0 0 2px #36291a;padding:20px 26px;max-width:620px;max-height:86vh;overflow:auto;line-height:1.75;font-size:14px;color:#d8c8a6">
      <div style="font-family:'Press Start 2P',monospace;font-size:13px;letter-spacing:1px;color:#efe3c6;margin-bottom:10px">HOW TO PLAY</div>
      ${b("Win")} — meet ANY route in the VICTORY RACE (right panel): Domination (souls ≥ the Tipping Point), Revelation (Megachurch + Faith 90), or your cult's own route. That starts a public 45s ASCENSION — hold it to zero. Rivals break it by taking ground back or by EXPOSING you (resets the clock). At the bell, most souls wins.<br/>
      ${b("Send")} — RIGHT-CLICK the town → mission wheel: SPREAD converts, CRUSADE burns (double Heat), TEND holds, heals and banks Faith. ${k("1")} ${k("2")} ${k("3")} pick inside the wheel. Max ${MAX_COHORTS} cohorts out; recall with ⟲ or ${k("⇧C")}.<br/>
      ${b("Spend")} — ${k("B")} upgrade COMMUNE (flock cap) · ${k("R")} recruitment drive · ${k("N")} buy land · ${k("D")} ${k("F")} ${k("G")} cult powers · DOCTRINE (${DOCTRINE_FAITH_COST} Faith per pick) · decrees on held Key Buildings ${k("5")}–${k("0")}.<br/>
      ${b("Scheme")} — RIGHT-CLICK a RIVAL's ground → EXPOSE (needs their Heat ≥ ${EXPOSE.minVictimHeat}) or STRIKE. Loud cults are exposable — including you.<br/>
      ${b("Heat")} — every conversion raises it; bigger cults heat faster. 60 = CPA pickets, 85 = deprogrammer raids.<br/>
      ${b("Look")} — left-click/drag pans · wheel zooms · minimap jumps · threat cards &amp; race rows jump the camera · ${k("H")} dissent map · ${k("Enter")} chat · ${k("F8")} surrender · ${k("Esc")} cancel.
      <div style="color:#8a7550;margin-top:10px;font-family:'VT323',monospace;font-size:16px">▸ click anywhere to close</div>
    </div>`;
    panel.onclick = () => panel.remove();
    this.root.appendChild(panel);
  }

  toggleDissentOverlay(): void {
    this.showDissent = !this.showDissent;
    const el = this.el.dissentOverlay;
    if (el) {
      el.style.background = this.showDissent ? archAccent(this.me()?.archetype ?? "").a : "";
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
    const name = (id: number): string => esc(seatName(this.g.players, id));
    const sc = s.recap.scandals;
    if (sc.length > this.seen.scandals) {
      for (const x of sc.slice(this.seen.scandals)) {
        this.pushFeed(`${name(x.attacker)} EXPOSED ${name(x.victim)}`, true, "scandal");
      }
      this.seen.scandals = sc.length;
    }
    if (s.prophecies.length > this.seen.prophecies) {
      for (const pr of s.prophecies.slice(this.seen.prophecies)) {
        this.pushFeed(`${name(pr.player)} declared a PROPHECY`, true, "prophecy");
      }
    }
    this.seen.prophecies = s.prophecies.length;
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
    }
    this.seen.alliances = s.alliances.length;
    for (const p of s.players) {
      if (p.spawned && !p.alive && !this.seen.dead.has(p.id)) {
        this.seen.dead.add(p.id);
        this.pushFeed(`${name(p.id)} was eliminated`, false, "dead");
      }
      // Ascension starts are headline news
      if (p.alive && p.ascendPath !== "") {
        const k0 = `${p.id}:${p.ascendPath}`;
        if (!this.seen.asc.has(k0)) {
          this.seen.asc.add(k0);
          const path = esc(this.race.current?.pathNames.get(p.ascendPath) ?? p.ascendPath);
          this.pushFeed(p.id === this.g.playerId ? `YOU began ASCENDING — ${path}` : `${name(p.id)} is ASCENDING — ${path}!`, false, "asc");
        }
      } else {
        for (const k of this.seen.asc) if (k.startsWith(`${p.id}:`)) this.seen.asc.delete(k);
      }
    }
    // incoming propaganda strike (10s warning window, §8) — banner once
    const me = this.g.playerId;
    for (const st of s.strikes) {
      if (st.warningTicksLeft <= 0 || st.chargeTicksLeft > 0) continue;
      if (!(st.victim === me || (s.world.owner[st.target] === me && st.player !== me))) continue;
      const key = `strike:${st.id}`;
      if (this.seen.threats.has(key)) continue;
      this.seen.threats.add(key);
      const label = st.type === "pamphlet_bomb" ? "PAMPHLET BOMB" : st.type === "prime_time_expose" ? "PRIME-TIME EXPOSÉ" : "MANIFESTO DROP";
      this.pushFeed(`INCOMING ${label} from ${name(st.player)}!`, true, "strike");
    }
  }

  /**
   * SOUL SHARE BAR (design §02): each cult's share of the town's souls (the
   * same number every win rule reads), own cult first, then rivals, then the
   * unconverted remainder. The dashed TIPPING POINT marker sits at the
   * Domination threshold — your segment reaching it starts an Ascension.
   */
  renderShareBar(): void {
    const s = this.g.sim;
    const meId = this.g.playerId;
    const segs: { color: string; pct: number; label: string; me: boolean }[] = [];
    const me = s.players.find((p) => p.id === meId);
    segs.push({ color: colorForPlayer(meId), pct: (me?.soulsPermille ?? 0) / 10, label: seatName(this.g.players, meId), me: true });
    const rivals = s.players.filter((p) => p.id !== meId && p.soulsPermille > 0).sort((a, z) => z.soulsPermille - a.soulsPermille);
    for (const p of rivals) segs.push({ color: colorForPlayer(p.id), pct: p.soulsPermille / 10, label: seatName(this.g.players, p.id), me: false });
    const restPct = Math.max(0, 100 - segs.reduce((t, sg) => t + sg.pct, 0));
    segs.push({ color: "#3a2e1c", pct: restPct, label: "unconverted", me: false });
    const html = segs
      .map(
        (sg) =>
          `<div class="seg${sg.me ? " me" : ""}" style="width:${sg.pct.toFixed(2)}%;background:${sg.color}">${
            sg.pct >= 9 ? `<span class="snm">${esc(sg.label)}</span><span class="spc">${Math.round(sg.pct)}%</span>` : ""
          }</div>`,
      )
      .join("");
    if (this.el.share.dataset.h !== html) {
      this.el.share.innerHTML = html;
      this.el.share.dataset.h = html;
    }
    const model = this.race.current;
    if (model && model.threshold < 1000) {
      const pct = model.threshold / 10;
      this.el.tip.style.display = "block";
      this.el.tip.style.left = `${pct.toFixed(2)}%`;
      const lbl = `TIPPING POINT ${Math.round(pct)}%`;
      const span = this.el.tip.firstElementChild as HTMLElement;
      if (span.textContent !== lbl) span.textContent = lbl;
    } else this.el.tip.style.display = "none";
  }

  update(): void {
    const s = this.g.sim;
    const me = this.me();
    if (!me) return;

    if (this.accentFor !== me.archetype) {
      this.accentFor = me.archetype;
      const acc = archAccent(me.archetype);
      this.root.style.setProperty("--fk-acc", acc.a);
      this.root.style.setProperty("--fk-acc2", acc.b);
      playFactionTheme(me.archetype);
    }

    if (s.tick !== this.prev.tick) {
      const dt = (s.tick - this.prev.tick) / 10;
      if (dt > 0) {
        this.usdPerSec = (toInt(me.usd) - this.prev.usd) / dt;
        this.folTrend = toInt(me.followers) - this.prev.followers;
      }
      this.prev = { followers: toInt(me.followers), usd: toInt(me.usd), tick: s.tick };
    }

    // ---- Victory Race (2 Hz full pass) ------------------------------------
    if (s.tick - this.lastRaceTick >= 5 || s.tick < this.lastRaceTick) {
      this.lastRaceTick = s.tick;
      const allies = new Set<number>();
      for (const al of s.alliances) {
        if (al.a === this.g.playerId) allies.add(al.b);
        if (al.b === this.g.playerId) allies.add(al.a);
      }
      this.race.refresh(computeRace(this.g), allies);
    } else this.race.tick();
    this.ascStrip.tick();
    this.threats.tick();

    // ---- top bar ----------------------------------------------------------
    const fol = toInt(me.followers);
    const arrow = this.folTrend > 1 ? " ▲" : this.folTrend < -1 ? " ▼" : "";
    let folTxt = fmtNum(fol) + arrow;
    const stats = propertyStats(s, me.id);
    const crowded = stats.tiles > 0 && stats.free < 3;
    if (crowded) folTxt += " ⚠";
    if (this.el.followers.textContent !== folTxt) this.el.followers.textContent = folTxt;
    this.el.followers.title = crowded
      ? "Crowded! Your land is full — BUY LAND [N] or your flock stops growing."
      : `${fmtNum(fol)} of ${fmtNum(toInt(followerCap(me, this.g.balance, s)))} cap · ${stats.free} free parcel tiles`;
    this.el.usd.textContent = fmtMoney(toInt(me.usd));
    this.el.usd.title = `${this.usdPerSec >= 0 ? "+" : ""}${fmtMoney(Math.round(this.usdPerSec))}/s`;
    this.el.faith.textContent = `${toFloat(me.faith).toFixed(0)}`;
    const heat = toFloat(me.heat);
    this.el.heat.textContent = `${heat.toFixed(0)}`;
    const hot = heat >= 50;
    this.el.heat_box?.classList.toggle("hot", hot);
    this.el.heat_sub.textContent = heat >= 25 ? "◆" : "";
    this.el.heat_sub.title = heat >= 25 ? "exposable — rivals can EXPOSE you" : "";
    this.el.timer.textContent = s.timerTicks > 0 ? fmtTime(s.timerTicks - s.tick) : fmtTime(s.tick);

    let leader: PlayerState | undefined;
    for (const p of s.players) if (p.spawned && (!leader || p.soulsPermille > leader.soulsPermille)) leader = p;
    const leaderPct = leader ? leader.soulsPermille / 10 : 0;
    this.el.leader.textContent = `${leaderPct.toFixed(0)}%`;
    const tp = this.race.current?.threshold ?? 1000;
    this.el.leader_sub.textContent = tp < 1000 ? `/${Math.round(tp / 10)}` : "";
    this.el.leader.title = leader ? `${seatName(this.g.players, leader.id)} leads with ${leaderPct.toFixed(1)}% of souls` : "";

    this.renderMissions(s, me);
    this.powers.update(me, s, this.ui.placement?.mode === "ability" ? this.ui.placement.ability : null);

    // ---- SPEND tray: live prices, affordability, armed highlight -----------
    const usdF = me.usd;
    const civicsNow = computeCivicControl(s);
    {
      const b = this.el.builds.querySelector<HTMLElement>("[data-build]")!;
      const maxed = me.compounds >= COMMUNE_MAX_STAGE;
      const cost = buildingCost(s, me.id, "compound", civicsNow, this.g.balance);
      b.classList.toggle("cant", maxed || usdF < cost);
      const txt = maxed ? "MAX" : fmtMoney(toInt(cost));
      const costEl = b.querySelector<HTMLElement>(".cost")!;
      if (costEl.textContent !== txt) costEl.textContent = txt;
      b.title = maxed
        ? `COMMUNE — stage ${me.compounds}/${COMMUNE_MAX_STAGE} (maxed).`
        : `COMMUNE [B] — stage ${me.compounds}/${COMMUNE_MAX_STAGE}. Upgrade for ${fmtMoney(toInt(cost))} to raise your flock cap (now ${fmtNum(toInt(followerCap(me, this.g.balance, s)))}).`;
    }
    {
      const landBtn = this.el.builds.querySelector<HTMLElement>("[data-land]")!;
      const cost = propertyCost(me, this.g.balance);
      const armed = this.ui.placement?.mode === "property";
      landBtn.classList.toggle("arm", armed);
      landBtn.classList.toggle("cant", usdF < cost && !armed);
      landBtn.querySelector<HTMLElement>(".cost")!.textContent = fmtMoney(toInt(cost));
    }
    {
      const btn = this.el.builds.querySelector<HTMLElement>("[data-recruit]")!;
      const econ = this.g.balance.economy;
      const room = toInt(followerCap(me, this.g.balance, s)) - fol;
      let gained = Math.floor((fol * econ.recruitDrivePermille) / 1000);
      if (gained > room) gained = Math.max(0, room);
      const cost = gained * toInt(econ.recruitCostPer);
      btn.classList.toggle("cant", gained <= 0 || toInt(usdF) < cost);
      btn.querySelector<HTMLElement>(".cost")!.textContent = gained > 0 ? `+${gained} ${fmtMoney(cost)}` : "cap";
    }

    if (s.tick % 10 === 0 || !this.el.civics.dataset.h) this.renderCivics(s, me);

    const pts = doctrinePointsAvailable(me);
    this.el.docBadge.style.display = pts > 0 ? "flex" : "none";
    this.el.docBadge.textContent = `${pts}`;

    this.collectDrama(s);
    this.renderFeed(s);
    this.renderBanner(s);
    this.renderCivicTray(s, me);
    this.renderMinimap(s);
    if (this.coach && s.tick % 10 === 0) this.coach.update();
  }

  private renderFeed(s: SimState): void {
    const kq = (col: string): string => `<span class="kq" style="background:${col}"></span>`;
    const offers = s.allianceOffers
      .filter((o) => o.to === this.g.playerId)
      .map((o) => `<div class="e">${kq(FEED_COL["ally"]!)}<span>✉ ${esc(seatName(this.g.players, o.from))} offers alliance — <span class="act" data-accept="${o.from}">accept</span></span></div>`)
      .join("");
    const lines = this.feed.map((f) => `<div class="e">${kq(FEED_COL[f.tag] ?? "#a08a64")}<span>${f.text}</span></div>`).join("");
    const chat = this.g.chat
      .slice(-8)
      .map((c) => `<div class="e fk-chat">${kq("#8a7550")}<span style="color:#a08a64">💬 ${esc(seatName(this.g.players, c.from))}: ${esc(c.msg)}</span></div>`)
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
    const slot = this.el.bannerSlot!;
    const existing = slot.firstElementChild;
    if (this.banner && s.tick < this.banner.until) {
      if (!existing || (existing as HTMLElement).dataset.t !== this.banner.text) {
        slot.innerHTML = "";
        const b = document.createElement("div");
        b.className = "fk-banner";
        b.dataset.t = this.banner.text;
        b.innerHTML = `<span class="bx">‼</span><span>${this.banner.text}</span>`;
        slot.appendChild(b);
      }
    } else if (existing) {
      slot.innerHTML = "";
      this.banner = null;
    }
  }

  /** Active-missions panel: n/3 cohorts, what each is doing, recall. */
  private renderMissions(s: SimState, me: PlayerState): void {
    const cohorts = me.cohorts;
    const cnt = `${cohorts.length}/${MAX_COHORTS}`;
    if (this.el.missionsCnt.textContent !== cnt) this.el.missionsCnt.textContent = cnt;
    this.el.missionsCnt.classList.toggle("full", cohorts.length >= MAX_COHORTS);
    if (cohorts.length === 0) {
      const empty = `<div class="fk-nomissions">no cohorts out — RIGHT-CLICK the town to send your flock</div>`;
      if (this.el.missions.dataset.h !== empty) {
        this.el.missions.innerHTML = empty;
        this.el.missions.dataset.h = empty;
      }
      return;
    }
    let html = "";
    cohorts.forEach((c, i) => {
      const md = MODES.find((x) => x.id === c.mode) ?? MODES[1];
      const where = targetName(s, c.target);
      const mass = Math.max(0, Math.round(toFloat(c.mass)));
      html += `<div class="fk-mrow${c.recalling ? " recalling" : ""}" data-tile="${c.target}" title="${md.label} · ${mass} flock ${c.recalling ? "walking home" : `working ${esc(where)}`} — click to look">
        <i class="mic" style="color:${md.col}">${icon(md.ic, "currentColor", 12)}</i>
        <span class="mnm">${esc(where)}</span><span class="mms">${mass}</span>
        ${c.recalling ? "" : `<button class="mrecall" data-slot="${i}" title="Recall this cohort home (frees the slot when they arrive)">⟲</button>`}</div>`;
    });
    if (this.el.missions.dataset.h !== html) {
      this.el.missions.innerHTML = html;
      this.el.missions.dataset.h = html;
      this.el.missions.querySelectorAll<HTMLElement>(".fk-mrow").forEach((row) => {
        row.onclick = (e) => {
          if ((e.target as HTMLElement).closest(".mrecall")) return;
          const t = Number(row.dataset.tile);
          if (t >= 0) this.camera?.flashTile(t, performance.now());
        };
      });
      this.el.missions.querySelectorAll<HTMLElement>(".mrecall").forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          this.send({ t: "MISSION_RECALL", slot: Number(btn.dataset.slot) } as ClientIntent);
        };
      });
    }
  }

  /**
   * Key Buildings (§13 rev.): holder swatch + siege bar, click to jump; rows
   * you HOLD grow a decree button with its hotkey and live price.
   */
  private renderCivics(s: SimState, me: PlayerState): void {
    const w = s.world;
    const control = computeCivicControl(s);
    const siege = new Map<number, SiegeBar>(computeSiegeState(s).map((b: SiegeBar) => [b.lot, b]));
    const present = new Set<number>();
    for (let t = 0; t < w.lot.length; t++) if (w.lot[t] !== 0) present.add(w.lot[t]!);
    const landmarks = new Set<number>();
    for (let t = 0; t < w.landmark.length; t++) if (w.landmark[t] !== 0) landmarks.add(w.landmark[t]!);
    const presentLots = CIVIC_LOTS.filter((lot) => present.has(lot));
    const held = presentLots.filter((lot) => control.get(lot) === me.id).length;
    const momentumPct = Math.round(held * toFloat(this.g.balance.civics.civicMomentumPer) * 100);
    const momoColor = held > 0 ? "#9bbf6a" : "#8a7550";
    const decreeFor = (lot: number, landmark: boolean): string => {
      for (const d of Object.values(CIVIC_DECREES)) {
        if (d.lot !== lot || d.isLandmark !== landmark) continue;
        const can = canExecuteCivicDecree(s, me.id, d.id);
        const cd = me.cooldowns[`decree_${d.id}`] ?? 0;
        const price = [d.costUsd > 0 ? fmtMoney(d.costUsd) : "", d.costFaith > 0 ? `${d.costFaith}✛` : ""].filter(Boolean).join(" ") || "free";
        const key = DECREE_KEYS[d.id];
        const label = cd > 0 ? `${Math.ceil(cd / 10)}s` : price;
        const why = can.ok ? "" : ` — ${can.reason ?? "unavailable"}`;
        return `<button class="dec${can.ok ? "" : " off"}" data-decree="${d.id}" title="${esc(`${d.name}${key ? ` [${key}]` : ""} — ${d.description} · ${price}${why}`)}">${key ? `<span class="k">${key}</span>` : ""}${esc(label)}</button>`;
      }
      return "";
    };
    let html = `<h4>Key Buildings</h4>`;
    html += `<div style="font-family:'VT323',monospace;font-size:14px;color:${momoColor};margin:-4px 0 7px;line-height:1.1">you hold ${held}/${presentLots.length} · <span style="color:#f3cf6a">+${momentumPct}%</span> conversion</div>`;
    const row = (key: string, holder: number, nm: string, effect: string, bar: SiegeBar | undefined, dec: string): string => {
      const mine = holder === me.id;
      const holderName = holder === 0 ? "unclaimed" : esc(seatName(this.g.players, holder));
      const sw = `<span class="sw" style="background:${holder === 0 ? "#4a3a26" : colorForPlayer(holder)}"></span>`;
      const fill = bar?.leaderFill ?? 0;
      const lc = bar && bar.leader !== 0 ? colorForPlayer(bar.leader) : "#4a3a26";
      const siegeBar = bar
        ? `<div class="siege${bar.contested ? " contested" : ""}"><div class="fill" style="width:${(fill * 100).toFixed(1)}%;background:${lc}"></div></div>`
        : "";
      return `<div class="fk-prow${mine ? " me" : ""}" data-civic="${key}" style="cursor:pointer;pointer-events:auto" title="${esc(effect)} — click to look">
        ${sw}<span class="nm">${nm}</span>${mine && dec ? dec : `<span class="hold">${holderName}</span>`}${siegeBar}</div>`;
    };
    for (const lot of CIVIC_LOTS) {
      if (!present.has(lot)) continue;
      const holder = control.get(lot) ?? 0;
      html += row(`l${lot}`, holder, CIVIC_NAMES[lot] ?? "?", CIVIC_EFFECTS[lot] ?? "", siege.get(lot), decreeFor(lot, false));
    }
    for (const [lm, nm] of [[Landmark.TownHall, "Town Hall"], [Landmark.RadioTower, "Radio Tower"]] as const) {
      if (!landmarks.has(lm)) continue;
      const holder = s.players.find((p) => ownsLandmark(s, p.id, lm))?.id ?? 0;
      const dec = Object.values(CIVIC_DECREES).find((d) => d.isLandmark && d.lot === lm);
      html += row(`m${lm}`, holder, nm, dec ? `Decree: ${dec.name} — ${dec.description}` : "", undefined, decreeFor(lm, true));
    }
    if (this.el.civics.dataset.h !== html) {
      this.el.civics.innerHTML = html;
      this.el.civics.dataset.h = html;
      this.el.civics.querySelectorAll<HTMLElement>("[data-decree]").forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          this.send({ t: "CIVIC_DECREE", decree: b.dataset.decree as CivicDecreeId } as ClientIntent);
        };
      });
      this.el.civics.querySelectorAll<HTMLElement>("[data-civic]").forEach((r) => {
        r.onclick = () => {
          const key = r.dataset.civic!;
          const n = Number(key.slice(1));
          const isLm = key.startsWith("m");
          const arr = isLm ? w.landmark : w.lot;
          const holderNow = isLm ? 0 : (computeCivicControl(this.g.sim).get(n) ?? 0);
          let target = -1;
          for (let t = 0; t < arr.length; t++) {
            if (arr[t] !== n) continue;
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

  /**
   * Compact Civic & Monopoly Active Buff Tray (Sprint 2 Task 2.5).
   * Sleek 28px tray docked under the top bar.
   * Displays 20×20 glowing badges for active decrees and monopolies with radial pie countdown sweeps,
   * 1-click collapse toggle, and transparent click-through gutters.
   */
  private renderCivicTray(s: SimState, me: PlayerState): void {
    if (!this.el.badgeList) return;

    interface ActiveBuff {
      id: string;
      label: string;
      icon: string;
      color: string;
      glow: string;
      pct: number;
      timeText: string;
      tooltip: string;
    }

    const buffs: ActiveBuff[] = [];

    // 1. Check Active Municipal Decrees
    for (const d of s.activeDecrees) {
      const def = CIVIC_DECREES[d.decree];
      if (!def) continue;
      const isMine = d.player === me.id;
      const remainingSec = Math.ceil(d.ticksLeft / 10);
      const pct = Math.max(0, Math.min(100, (d.ticksLeft / def.durTicks) * 100));

      let iconName = "clock";
      let color = "#f59e0b";
      let glow = "rgba(245,158,11,0.35)";

      switch (d.decree) {
        case CivicDecreeId.TownCurfew:
          iconName = "clock";
          color = "#f59e0b";
          glow = "rgba(245,158,11,0.4)";
          break;
        case CivicDecreeId.MunicipalInjunction:
          iconName = "press";
          color = "#ef4444";
          glow = "rgba(239,68,68,0.4)";
          break;
        case CivicDecreeId.EmergencyJam:
          iconName = "antenna";
          color = "#a855f7";
          glow = "rgba(168,85,247,0.4)";
          break;
        case CivicDecreeId.FoodRationing:
          iconName = "house";
          color = "#10b981";
          glow = "rgba(16,185,129,0.4)";
          break;
        case CivicDecreeId.ParentTeacherNight:
          iconName = "eye";
          color = "#3b82f6";
          glow = "rgba(59,130,246,0.4)";
          break;
        case CivicDecreeId.PepRally:
          iconName = "crown";
          color = "#ec4899";
          glow = "rgba(236,72,153,0.4)";
          break;
        case CivicDecreeId.EvangelicalRevival:
          iconName = "cross";
          color = "#eab308";
          glow = "rgba(234,179,8,0.4)";
          break;
      }

      if (!this.seen.decrees.has(d.id)) {
        this.seen.decrees.add(d.id);
        playCivicDecreeSfx();
      }

      buffs.push({
        id: `decree_${d.id}`,
        label: def.name,
        icon: iconName,
        color,
        glow,
        pct,
        timeText: `${remainingSec}s`,
        tooltip: `${def.name.toUpperCase()} (${isMine ? "YOUR DECREE" : "RIVAL DECREE"})\nDistrict: ${d.district || "Town-wide"}\n${def.description}\nRemaining: ${remainingSec}s`,
      });
    }

    // 2. Check Municipal Monopolies held by me
    const monopolies = computeMonopolies(s, me.id);
    if (monopolies.townMachine) {
      if (!this.seen.monopolies.has("townMachine")) {
        this.seen.monopolies.add("townMachine");
        playMonopolyUnlockSfx();
        this.pushFeed("Town Machine Monopoly achieved! Sheriff under full control.", true, "ally");
      }
      buffs.push({
        id: "mono_machine",
        label: "TOWN MACHINE",
        icon: "crown",
        color: "#eab308",
        glow: "rgba(234,179,8,0.45)",
        pct: 100,
        timeText: "∞",
        tooltip: "TOWN MACHINE MONOPOLY (Controlled: Sheriff's Office)\n• +20 CPA harassment threshold\n• Automated arrest of rival agents entering your turf",
      });
    }
    if (monopolies.indoctrinationPipeline) {
      if (!this.seen.monopolies.has("indoctrinationPipeline")) {
        this.seen.monopolies.add("indoctrinationPipeline");
        playMonopolyUnlockSfx();
        this.pushFeed("Indoctrination Pipeline Monopoly achieved! Youth recruitment locked.", true, "ally");
      }
      buffs.push({
        id: "mono_indoctrination",
        label: "INDOCTRINATION",
        icon: "mega",
        color: "#ec4899",
        glow: "rgba(236,72,153,0.45)",
        pct: 100,
        timeText: "∞",
        tooltip: "INDOCTRINATION PIPELINE (Controlled: Elementary & High School)\n• +20% follower growth rate\n• +25 bonus followers on every neutral tile flip",
      });
    }
    if (monopolies.foodAndFuelCartel) {
      if (!this.seen.monopolies.has("foodAndFuelCartel")) {
        this.seen.monopolies.add("foodAndFuelCartel");
        playMonopolyUnlockSfx();
        this.pushFeed("Food & Fuel Cartel Monopoly achieved! Logistics cornered.", true, "ally");
      }
      buffs.push({
        id: "mono_cartel",
        label: "CARTEL",
        icon: "van",
        color: "#06b6d4",
        glow: "rgba(6,182,212,0.45)",
        pct: 100,
        timeText: "∞",
        tooltip: "FOOD & FUEL CARTEL (Controlled: Supermarket & Gas Station)\n• +35% recruitment van transit speed\n• Rival building construction costs +30%",
      });
    }
    if (monopolies.sacredCanopy) {
      if (!this.seen.monopolies.has("sacredCanopy")) {
        this.seen.monopolies.add("sacredCanopy");
        playMonopolyUnlockSfx();
        this.pushFeed("Sacred Canopy Monopoly achieved! Pulpits secured.", true, "ally");
      }
      buffs.push({
        id: "mono_canopy",
        label: "SACRED CANOPY",
        icon: "candle",
        color: "#8b5cf6",
        glow: "rgba(139,92,246,0.45)",
        pct: 100,
        timeText: "∞",
        tooltip: "SACRED CANOPY MONOPOLY (Controlled: Church & Chapel)\n• Faith floor permanently locked at 50\n• +50% Faith generation from Sermons",
      });
    }

    // Render badges
    let html = "";
    this.el.civicTray!.style.display = buffs.length === 0 ? "none" : "flex";
    {
      for (const b of buffs) {
        html += `<div class="fk-buff-badge" title="${esc(b.tooltip)}" style="--badge-col:${b.color};--badge-glow:${b.glow};--badge-border:${b.color}">
          <div class="fk-buff-pie" style="--pie-pct:${b.pct.toFixed(1)}%"><i class="ic">${icon(b.icon, "currentColor", 10)}</i></div>
          <span class="fk-buff-time">${b.timeText}</span>
        </div>`;
      }
    }

    if (this.el.badgeList.dataset.h !== html) {
      this.el.badgeList.innerHTML = html;
      this.el.badgeList.dataset.h = html;
    }
  }

  destroy(): void {
    window.removeEventListener("keydown", this.focusChatKey);
    this.scheme.close();
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

/** Node copy — the real effects (doctrine.ts + STAGE1_DESIGN §8). */
const DOC_NODES: Record<string, string[]> = {
  B: ["Tithing Drill · +10% tithe", "Uniforms · +15% home defense", "Curfews · −40% self-dissent", "Total Devotion · −50% defense attrition"],
  I: ["Rumor Mill · Expose −40%, works at Heat 15", "Counter-Narrative · Exposes vs you halved, no reset", "Strong Signal · strikes +30% radius, −20% cost", "Official Story · Heat decays 2× below 60"],
  T: ["Better Pamphlets · +10% R₀", "Whisper Network · +60% ambient creep", "Forgiveness · lost-tile scars heal 2× faster", "Irresistible Word · ignore half of district defense"],
  E: ["Welcome Basket · love-bomb powers −30%", "Family Now · raids vs you −50%", "Clean Image · −30% Heat gain", "Unshakeable · shrug off one mass apostasy"],
};

/**
 * Doctrine picker (§28): the 4-column BITE grid as a transient panel (not a
 * blocking modal — click-away closes it). Shows price, tier locks and Faith.
 */
function showDoctrinePanel(g: GameSession): void {
  document.querySelector(".fk-doc-panel")?.remove();
  const me = g.sim.players.find((p) => p.id === g.playerId);
  if (!me) return;
  const pts = doctrinePointsAvailable(me);
  const faith = Math.floor(toFloat(me.faith));
  const panel = document.createElement("div");
  panel.className = "fk-doc-panel";
  panel.style.cssText =
    "position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;" +
    "background:rgba(10,7,4,.82);font-family:'Pixelify Sans',ui-monospace,monospace;color:#efe3c6";
  const grid = DOC_COLS.map((col) => {
    const inBranch = me.doctrine.filter((n) => n[0] === col.br).length;
    const cells = (DOC_NODES[col.br] ?? [])
      .map((label, i) => {
        const node = `${col.br}${i + 1}`;
        const have = me.doctrine.includes(node);
        const locked = (i === 2 && inBranch < 2) || (i === 3 && inBranch < 3);
        const poor = faith < DOCTRINE_FAITH_COST;
        const style = have
          ? `background:${col.accent};color:#19110a;box-shadow:inset 0 0 0 2px ${col.accent},0 3px 0 #060403;cursor:default`
          : locked || poor
            ? `background:#1a130b;color:#8a7550;box-shadow:inset 0 0 0 1px #36291a,0 3px 0 #060403;cursor:not-allowed`
            : `background:#241c12;color:#efe3c6;box-shadow:inset 0 0 0 1px #36291a,0 3px 0 #060403;cursor:pointer`;
        const tag = have ? "OWNED" : locked ? `🔒 ${i === 2 ? 2 : 3} in branch` : `${DOCTRINE_FAITH_COST}✛`;
        return `<button class="fk-doc-node" data-node="${node}"
          style="display:block;width:100%;margin:0 0 5px;padding:8px 9px;text-align:left;border:0;font-family:inherit;${style}">
          <div style="display:flex;justify-content:space-between;font-weight:700;font-size:12px;letter-spacing:.5px"><span>${node}</span><span style="font-family:'VT323',monospace;font-size:14px;font-weight:400">${tag}</span></div>
          <div style="font-size:11px;opacity:.85;margin-top:2px;line-height:1.2">${label}</div></button>`;
      })
      .join("");
    return `<div style="width:196px">
      <div style="font-family:'Press Start 2P',monospace;font-size:8px;letter-spacing:1px;color:${col.accent};margin-bottom:8px;display:flex;align-items:center;gap:6px">${icon(col.ic, col.accent, 11)}${col.title}</div>
      ${cells}</div>`;
  }).join("");
  panel.innerHTML = `<div style="background:#1a130b;border:3px solid #6b563a;box-shadow:0 8px 0 #060403,inset 0 0 0 2px #36291a;padding:22px;max-width:92vw;max-height:88vh;overflow:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:16px">
      <div style="font-family:'Press Start 2P',monospace;font-size:13px;letter-spacing:1px;color:#efe3c6">DOCTRINE ▸ B.I.T.E.</div>
      <div style="font-family:'VT323',monospace;font-size:20px;color:#f0b53e">${faith} FAITH · ${DOCTRINE_FAITH_COST} per pick · ${pts} affordable</div>
    </div><div style="display:flex;gap:12px">${grid}</div>
    <div style="text-align:center;margin-top:14px;font-size:12px;color:#8a7550">picks are forever · tier 3 needs 2 picks in its branch, tier 4 needs 3 · bank Faith with TEND missions · click outside to close<br/>shift-click an OWNED node to share it with your ally (pact)</div></div>`;
  panel.onclick = (e) => {
    if (e.target === panel) panel.remove();
  };
  panel.querySelectorAll<HTMLElement>("[data-node]").forEach((b) => {
    b.onclick = (ev) => {
      const node = b.dataset.node!;
      const meNow = g.sim.players.find((p) => p.id === g.playerId);
      if ((ev as MouseEvent).shiftKey) {
        if (meNow?.doctrine.includes(node)) g.sendIntent({ t: "PACT_PICK", node } as ClientIntent);
        return;
      }
      if (meNow?.doctrine.includes(node)) return;
      g.sendIntent({ t: "DOCTRINE_PICK", node } as ClientIntent);
      setTimeout(() => {
        panel.remove();
        showDoctrinePanel(g);
      }, 120);
    };
  });
  document.getElementById("app")!.appendChild(panel);
}
