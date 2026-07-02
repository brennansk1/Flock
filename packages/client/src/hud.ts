/**
 * In-match HUD (§27) — crisp DOM UI layered over the chunky PixiJS world (the
 * contrast is the look, §30). Everything here is feed/banner/ping, never a
 * modal (§29): the only modal in the game is the end-of-match Recap Card.
 *
 * Layout (desktop; rails collapse on narrow viewports via CSS):
 *   top bar     followers (cap + arrow) · $ (/sec) · faith dial · heat gauge ·
 *               timer + leader %
 *   left rail   stance trio (1/2/3) · rituals (Q/W/E/R) · actives (D/F) · sig (G)
 *   bottom      build palette (click → placement mode) · doctrine (badge) · minimap
 *   right rail   player list (ally/mark) · drama feed (the kill-feed)
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
  doctrinePointsAvailable,
  loveBombCostMult,
  colorForPlayer,
  buildingCost,
  KIT,
  type SimState,
  type PlayerState,
  type BuildingType,
} from "@flock/sim";
import type { GameSession, ClientIntent } from "./net.js";

export type PlacementKind =
  | { mode: "build"; building: string; key: string }
  | { mode: "strike"; strike: string }
  | { mode: "ritual"; ritual: string }
  | { mode: "ability"; ability: string };

/** The slice of the map camera the HUD needs (minimap jump + viewport rect). */
export interface Camera {
  centerOn(tile: number): void;
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

const RITUALS = [
  { id: "sermon", key: "Q", label: "Sermon", targeted: false, desc: "Spend Faith for a town-wide +5% conversion buff." },
  { id: "midnight_festival", key: "W", label: "Festival", targeted: true, desc: "Place a 2× neutral-conversion aura. Click a tile to anchor it." },
  { id: "the_offering", key: "E", label: "Offering", targeted: true, desc: "Sacrifice followers in a district for a Faith surge. Click to choose." },
  { id: "day_of_atonement", key: "R", label: "Atonement", targeted: false, desc: "Freeze your fronts; purge dissent ×4 for a while." },
] as const;

const BUILDS = [
  { id: "compound", key: "B", label: "Compound", desc: "Your HQ. Raises the follower cap and anchors territory." },
  { id: "watchtower", key: "T", label: "Watchtower", desc: "5× fort defense + reveals enemy agents nearby." },
  { id: "collection_plate", key: "C", label: "Plate", desc: "Tithe node. Couriers carry its income — and can be robbed." },
  { id: "broadcast_tower", key: "Y", label: "Broadcast", desc: "Required for Propaganda Strikes (K)." },
  { id: "hotline_center", key: "U", label: "Hotline", desc: "75% chance to intercept incoming strikes." },
  { id: "print_shop", key: "H", label: "Print Shop", desc: "Cheaper pamphlets — boosts conversion pressure." },
  { id: "garage", key: "J", label: "Garage", desc: "Raises your Recruitment Van capacity." },
  { id: "supplement_lab", key: "L", label: "Lab", desc: "Converts Faith into steady income (Radiant)." },
] as const;

/** Ritual Faith costs (base; Sermon gains Faith instead of spending it). */
const RITUAL_FAITH: Record<string, number> = {
  sermon: 0,
  midnight_festival: KIT.festival.cost,
  the_offering: KIT.offering.faithCost,
  day_of_atonement: KIT.atonement.cost,
};

const STANCES = [
  { id: Stance.Tend, key: "1", label: "TEND", hint: "defend + heal dissent" },
  { id: Stance.Spread, key: "2", label: "SPREAD", hint: "balanced growth" },
  { id: Stance.Crusade, key: "3", label: "CRUSADE", hint: "max pressure, +Heat" },
] as const;

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
.fk-hud{position:absolute;inset:0;pointer-events:none;font-family:'Segoe UI',system-ui,sans-serif;color:#f0e6d0;z-index:20}
.fk-hud button{pointer-events:auto;cursor:pointer;font-family:inherit}
.fk-top{position:absolute;top:26px;left:50%;transform:translateX(-50%);display:flex;gap:18px;
  background:rgba(20,16,12,.82);border:1px solid #5a4a30;border-radius:8px;padding:7px 16px;
  backdrop-filter:blur(3px);align-items:center;white-space:nowrap}
.fk-stat{display:flex;flex-direction:column;align-items:center;min-width:64px;line-height:1.1}
.fk-stat .v{font-size:17px;font-weight:700}
.fk-stat .l{font-size:9px;letter-spacing:1px;opacity:.6;text-transform:uppercase}
.fk-heat .v{color:#ff7a4a}
.fk-rail{position:absolute;left:10px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:10px;width:128px}
.fk-grp{background:rgba(20,16,12,.78);border:1px solid #5a4a30;border-radius:8px;padding:7px}
.fk-grp h4{margin:0 0 5px;font-size:9px;letter-spacing:1.5px;opacity:.55;text-transform:uppercase}
.fk-btn{display:flex;justify-content:space-between;align-items:center;width:100%;box-sizing:border-box;
  background:#241c14;color:#f0e6d0;border:1px solid #4a3c28;border-radius:4px;padding:5px 7px;font-size:12px;margin:2px 0}
.fk-btn:hover{background:#33271a;border-color:#7a5a30}
.fk-btn .k{font-size:9px;opacity:.5;border:1px solid #5a4a30;border-radius:3px;padding:0 3px;margin-left:5px}
.fk-btn.on{background:#c89858;color:#1a1410;border-color:#e6be8a;font-weight:700}
.fk-btn.cd{opacity:.55;filter:grayscale(.5)}
.fk-btn.cant{opacity:.4;filter:grayscale(.8)}
.fk-btn.arm{outline:2px solid #ffd36a;outline-offset:1px}
.fk-btn .cost{font-size:9px;opacity:.75;margin-left:5px;white-space:nowrap}
.fk-btn.cant .cost{color:#e08a6a;opacity:1}
.fk-btn .cd-t{font-size:9px;color:#e6be8a;margin-left:5px}
.fk-bottom{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:10px;align-items:flex-end}
.fk-builds{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;background:rgba(20,16,12,.78);
  border:1px solid #5a4a30;border-radius:8px;padding:8px;width:336px}
.fk-doc{position:relative;background:#241c14;border:1px solid #5a4a30;border-radius:8px;color:#f0e6d0;
  padding:10px 14px;font-size:12px;align-self:stretch}
.fk-doc .badge{position:absolute;top:-6px;right:-6px;background:#ffcf4a;color:#1a1410;border-radius:50%;
  width:18px;height:18px;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
.fk-mini{background:rgba(20,16,12,.78);border:1px solid #5a4a30;border-radius:8px;padding:6px;line-height:0}
.fk-mini canvas{image-rendering:pixelated;border-radius:3px}
.fk-right{position:absolute;right:10px;top:60px;width:210px;display:flex;flex-direction:column;gap:10px;max-height:80vh}
.fk-players{background:rgba(20,16,12,.78);border:1px solid #5a4a30;border-radius:8px;padding:7px;overflow:auto}
.fk-prow{display:flex;align-items:center;gap:6px;font-size:12px;padding:3px 2px;border-radius:4px}
.fk-prow .sw{width:11px;height:11px;border-radius:2px;flex:none}
.fk-prow .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fk-prow .act{pointer-events:auto;cursor:pointer;font-size:10px;opacity:.6;border:1px solid #4a3c28;border-radius:3px;padding:0 4px}
.fk-prow .act:hover{opacity:1;background:#33271a}
.fk-feed{background:rgba(20,16,12,.78);border:1px solid #5a4a30;border-radius:8px;padding:7px;overflow:auto;flex:1;
  font-size:11px;line-height:1.45}
.fk-feed .e{opacity:0;animation:fkfade .4s forwards;padding:1px 0}
@keyframes fkfade{to{opacity:1}}
.fk-banner{position:absolute;top:90px;left:50%;transform:translateX(-50%);background:rgba(120,30,30,.92);
  border:1px solid #ff8a6a;border-radius:6px;padding:10px 24px;font-size:18px;font-weight:700;letter-spacing:1px;
  animation:fkdrop .3s ease-out;text-shadow:0 1px 2px #000}
@keyframes fkdrop{from{transform:translate(-50%,-12px);opacity:0}to{transform:translate(-50%,0);opacity:1}}
.fk-heat.hot .v{animation:fkpulse 1s infinite}
@keyframes fkpulse{50%{text-shadow:0 0 10px #ff5a2a}}
@media(max-width:900px){.fk-rail{width:96px}.fk-right{width:150px}.fk-builds{width:200px}}
.fk-chatin{pointer-events:auto;width:100%;box-sizing:border-box;background:#241c14;color:#f0e6d0;
  border:1px solid #4a3c28;border-radius:4px;padding:5px 7px;font-size:12px;font-family:inherit}
.fk-chatin:focus{outline:none;border-color:#c89858;background:#2a2118}
.fk-chatin::placeholder{color:#f0e6d0;opacity:.35}
/* accessibility (§28): reduced motion kills pulses/animations; mute hides chat */
.fk-reduced-motion .fk-heat.hot .v{animation:none}
.fk-reduced-motion .fk-feed .e{animation:none;opacity:1}
.fk-reduced-motion .fk-banner{animation:none}
.fk-mute-chat .fk-chat{display:none}
.fk-mute-chat .fk-chatin{display:none}
`;

/**
 * Cache of HUD elements. Named keys are declared (so reads are non-undefined
 * under noUncheckedIndexedAccess); the index signature keeps the dynamic
 * `stat()` setters typed.
 */
interface ElCache {
  followers: HTMLElement;
  usd: HTMLElement;
  faith: HTMLElement;
  heat: HTMLElement;
  heat_box: HTMLElement;
  timer: HTMLElement;
  leader: HTMLElement;
  stanceGroup: HTMLElement;
  ritualGroup: HTMLElement;
  actD: HTMLElement;
  actF: HTMLElement;
  actG: HTMLElement;
  builds: HTMLElement;
  doc: HTMLElement;
  docBadge: HTMLElement;
  players: HTMLElement;
  feed: HTMLElement;
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
  private feed: { tick: number; text: string }[] = [];
  private seen = { scandals: 0, prophecies: 0, betrayals: 0, alliances: 0, dead: new Set<number>(), threats: new Set<string>() };
  private banner: { text: string; until: number } | null = null;
  private lastMiniTick = -999;
  private miniImg: ImageData | null = null;
  private chatIn!: HTMLInputElement;
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
    this.mini.width = Math.min(120, g.sim.world.width);
    this.mini.height = Math.min(120, g.sim.world.height);
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

  private btn(label: string, key: string | null, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "fk-btn";
    b.innerHTML = `<span>${label}</span>${key ? `<span class="k">${key}</span>` : ""}`;
    b.onclick = onClick;
    return b;
  }

  private group(title: string): HTMLDivElement {
    const d = document.createElement("div");
    d.className = "fk-grp";
    d.innerHTML = `<h4>${title}</h4>`;
    return d;
  }

  private build(): void {
    // ---- top bar -------------------------------------------------------
    const top = document.createElement("div");
    top.className = "fk-top";
    const stat = (id: string, label: string, cls = ""): HTMLElement => {
      const s = document.createElement("div");
      s.className = `fk-stat ${cls}`;
      s.innerHTML = `<span class="v" id="${id}">—</span><span class="l">${label}</span>`;
      this.el[id] = s.querySelector(".v")!;
      if (cls) this.el[`${id}_box`] = s;
      return s;
    };
    top.append(
      stat("followers", "Followers"),
      stat("usd", "Treasury"),
      stat("faith", "Faith"),
      stat("heat", "Heat", "fk-heat"),
      stat("timer", "Match"),
      stat("leader", "Leader"),
    );
    this.root.appendChild(top);

    // ---- left rail -----------------------------------------------------
    const rail = document.createElement("div");
    rail.className = "fk-rail";

    const stanceG = this.group("Stance");
    for (const s of STANCES) {
      const b = this.btn(s.label, s.key, () => this.send({ t: "SET_STANCE", stance: s.id }));
      b.title = s.hint;
      b.dataset.stance = s.id;
      stanceG.appendChild(b);
    }
    this.el.stanceGroup = stanceG;

    const ritualG = this.group("Rituals");
    for (const r of RITUALS) {
      const b = this.btn(r.label, r.key, () =>
        r.targeted ? this.arm({ mode: "ritual", ritual: r.id }) : this.send({ t: "RITUAL", ritual: r.id as never }),
      );
      b.dataset.cd = r.id;
      const fc = RITUAL_FAITH[r.id] ?? 0;
      b.title = `${r.label} — ${r.desc}${fc ? ` (costs ${fc} Faith)` : " (free)"}`;
      const cost = document.createElement("span");
      cost.className = "cost";
      cost.textContent = fc ? `${fc}✛` : "";
      b.appendChild(cost);
      ritualG.appendChild(b);
    }
    this.el.ritualGroup = ritualG;

    const actG = this.group("Powers");
    this.el.actD = this.btn("—", "D", () => this.fireActive("D"));
    this.el.actF = this.btn("—", "F", () => this.fireActive("F"));
    this.el.actG = this.btn("—", "G", () => this.fireSignature());
    for (const el of [this.el.actD, this.el.actF, this.el.actG]) {
      const cost = document.createElement("span");
      cost.className = "cost";
      el.appendChild(cost);
    }
    actG.append(this.el.actD, this.el.actF, this.el.actG);

    rail.append(stanceG, ritualG, actG);
    this.root.appendChild(rail);

    // ---- bottom: builds + doctrine + minimap ---------------------------
    const bottom = document.createElement("div");
    bottom.className = "fk-bottom";

    const builds = document.createElement("div");
    builds.className = "fk-builds";
    for (const bd of BUILDS) {
      const b = this.btn(bd.label, bd.key, () => this.armBuild(bd.id, bd.key));
      b.dataset.build = bd.id;
      b.title = `${bd.label} — ${bd.desc} (click, then click a tile to place)`;
      const cost = document.createElement("span");
      cost.className = "cost";
      b.appendChild(cost);
      builds.appendChild(b);
    }
    this.el.builds = builds;

    const doc = document.createElement("button");
    doc.className = "fk-doc fk-btn";
    doc.style.cssText += "flex-direction:column;justify-content:center";
    doc.innerHTML = `DOCTRINE<span class="badge" id="docbadge" style="display:none">0</span>`;
    doc.onclick = () => this.openDoctrine();
    this.el.doc = doc;
    this.el.docBadge = doc.querySelector("#docbadge")!;

    const miniWrap = document.createElement("div");
    miniWrap.className = "fk-mini";
    miniWrap.appendChild(this.mini);

    bottom.append(builds, doc, miniWrap);
    this.root.appendChild(bottom);

    // ---- right rail: players + feed ------------------------------------
    const right = document.createElement("div");
    right.className = "fk-right";
    const players = document.createElement("div");
    players.className = "fk-players";
    this.el.players = players;
    const feed = document.createElement("div");
    feed.className = "fk-feed";
    feed.innerHTML = `<div style="opacity:.5;font-size:9px;letter-spacing:1px">DRAMA FEED</div>`;
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

    right.append(players, feed, chatIn);
    this.root.appendChild(right);

    // help button (top-right) → controls reference
    const help = document.createElement("button");
    help.className = "fk-btn";
    help.textContent = "?";
    help.title = "Controls & how to play";
    help.style.cssText = "position:absolute;top:30px;right:10px;width:34px;height:34px;font-size:18px;border-radius:50%;padding:0";
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
      "position:absolute;inset:0;z-index:45;display:flex;align-items:center;justify-content:center;background:rgba(10,8,6,.8);pointer-events:auto";
    panel.innerHTML = `<div style="background:rgba(20,16,12,.97);border:1px solid #5a4a30;border-radius:10px;padding:22px 28px;max-width:520px;line-height:1.8;font-size:14px">
      <div style="font-size:18px;letter-spacing:2px;margin-bottom:10px">HOW TO PLAY</div>
      <b>Goal</b> — convert the town. Watch the bar up top; reach the win % to dominate.<br/>
      <b>Map</b> — click a tile to open a front there · drag to pan · wheel to zoom · click the minimap to jump.<br/>
      <b>Stance</b> — 1 Tend (defend) · 2 Spread (grow) · 3 Crusade (push hard, +Heat).<br/>
      <b>Rituals</b> — Q Sermon · W Festival · E Offering · R Atonement (spend Faith).<br/>
      <b>Powers</b> — D / F archetype actives · G signature (your big play).<br/>
      <b>Build</b> — click a palette button then a tile, or press B/T/C/Y/U/H/J/L. Greyed = can't afford.<br/>
      <b>Scheme</b> — A raid · X snoop · P publish scandal · K strike · V van · O/I alliances · Esc cancels.<br/>
      <div style="opacity:.55;margin-top:10px;font-size:12px">click anywhere to close</div>
    </div>`;
    panel.onclick = () => panel.remove();
    this.root.appendChild(panel);
  }

  private armBuild(building: string, key: string): void {
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

  /** Push a drama-feed line and (for big moments) a freeze-frame banner (§25.3). */
  private pushFeed(text: string, banner = false): void {
    this.feed.unshift({ tick: this.g.sim.tick, text });
    if (this.feed.length > 40) this.feed.pop();
    if (banner) this.banner = { text, until: this.g.sim.tick + 25 };
  }

  /** Scan sim state for new dramatic events since last update (the kill-feed). */
  private collectDrama(s: SimState): void {
    const name = (id: number): string => esc(this.g.players.find((p) => p.id === id)?.name ?? `Cult #${id}`);

    const published = s.scandals.filter((x) => x.published).length;
    if (published > this.seen.scandals) {
      for (const sc of s.scandals.filter((x) => x.published).slice(this.seen.scandals)) {
        this.pushFeed(`📰 ${name(sc.attacker)} EXPOSED ${name(sc.victim)}`, true);
      }
      this.seen.scandals = published;
    }
    if (s.prophecies.length > this.seen.prophecies) {
      for (const pr of s.prophecies.slice(this.seen.prophecies)) {
        this.pushFeed(`⏳ ${name(pr.player)} declared a PROPHECY`, true);
      }
      this.seen.prophecies = s.prophecies.length;
    }
    const traitors = s.players.filter((p) => p.traitor).length;
    if (traitors > this.seen.betrayals) {
      for (const p of s.players.filter((x) => x.traitor).slice(this.seen.betrayals)) {
        this.pushFeed(`🗡 JUDAS — ${name(p.id)} betrayed an ally`, true);
      }
      this.seen.betrayals = traitors;
    }
    if (s.alliances.length > this.seen.alliances) {
      const al = s.alliances[s.alliances.length - 1]!;
      this.pushFeed(`🤝 ${name(al.a)} allied with ${name(al.b)}`);
      this.seen.alliances = s.alliances.length;
    }
    for (const p of s.players) {
      if (p.spawned && !p.alive && !this.seen.dead.has(p.id)) {
        this.seen.dead.add(p.id);
        this.pushFeed(`☠ ${name(p.id)} was eliminated`);
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
      this.pushFeed(`⚠ INCOMING ${label} from ${name(st.player)}!`, true);
    }
    // scandal evidence reaching the 50% notify threshold on me (§15.2)
    for (const sc of s.scandals) {
      if (sc.victim !== me || !sc.notified || sc.published) continue;
      const key = `scandal:${sc.attacker}`;
      if (this.seen.threats.has(key)) continue;
      this.seen.threats.add(key);
      this.pushFeed(`⚠ ${name(sc.attacker)} is digging up dirt on you…`, true);
    }
  }

  update(): void {
    const s = this.g.sim;
    const me = this.me();
    if (!me) return;

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
    this.el.heat_box?.classList.toggle("hot", heat >= 50);
    this.el.timer.textContent = s.timerTicks > 0 ? fmtTime(s.timerTicks - s.tick) : fmtTime(s.tick);

    const leader = [...s.players].filter((p) => p.spawned).sort((a, b) => b.ownedTiles - a.ownedTiles)[0];
    const leaderPct = leader && s.populated > 0 ? (leader.ownedTiles * 100) / s.populated : 0;
    this.el.leader.textContent = `${leaderPct.toFixed(0)}%`;
    this.el.leader.title = leader ? `${this.g.players.find((p) => p.id === leader.id)?.name ?? "—"} leads` : "";

    // stance highlight
    this.el.stanceGroup.querySelectorAll<HTMLElement>("[data-stance]").forEach((b) => {
      b.classList.toggle("on", b.dataset.stance === me.stance);
    });

    // ritual cooldowns + Faith affordability + numeric countdown
    const faith = toFloat(me.faith);
    this.el.ritualGroup.querySelectorAll<HTMLElement>("[data-cd]").forEach((b) => {
      const id = b.dataset.cd!;
      const cd = me.cooldowns[id] ?? 0;
      const fc = RITUAL_FAITH[id] ?? 0;
      b.classList.toggle("cd", cd > 0);
      b.classList.toggle("cant", cd <= 0 && fc > 0 && faith < fc);
      const costEl = b.querySelector<HTMLElement>(".cost");
      if (costEl) costEl.textContent = cd > 0 ? `${Math.ceil(cd / 10)}s` : fc ? `${fc}✛` : "";
    });

    // powers: labels, live costs, affordability greying, cooldown countdowns —
    // the same treatment builds/rituals get (§27)
    const usd = toInt(me.usd);
    const powers = [
      { el: this.el.actD, def: ACTIVE_D[me.archetype]!, key: "D", role: "archetype power; some target a tile" },
      { el: this.el.actF, def: ACTIVE_F[me.archetype]!, key: "F", role: "archetype power; some target a tile" },
      { el: this.el.actG, def: SIGNATURE[me.archetype]!, key: "G", role: "your signature, the big play" },
    ] as const;
    for (const { el, def, key, role } of powers) {
      el.querySelector("span")!.textContent = def.label;
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
    this.el.builds.querySelectorAll<HTMLElement>("[data-build]").forEach((b) => {
      const type = b.dataset.build as BuildingType;
      const cost = toInt(buildingCost(s, me.id, type));
      const armed = this.ui.placement?.mode === "build" && this.ui.placement.building === type;
      b.classList.toggle("arm", armed);
      b.classList.toggle("cant", usd < cost && !armed);
      const costEl = b.querySelector<HTMLElement>(".cost");
      if (costEl) costEl.textContent = fmtMoney(cost);
    });

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
    const html = rows
      .map((p) => {
        const nm = esc(this.g.players.find((q) => q.id === p.id)?.name ?? `Cult #${p.id}`);
        const me = p.id === this.g.playerId;
        const tags = `${p.traitor ? "🗡" : ""}${allies.has(p.id) ? "🤝" : ""}${!p.alive ? "☠" : ""}`;
        const acts = me || !p.alive ? "" : `<span class="act" data-ally="${p.id}">${allies.has(p.id) ? "✕" : "ally"}</span>`;
        return `<div class="fk-prow" style="${me ? "background:rgba(200,152,88,.18)" : ""}">
          <span class="sw" style="background:${colorForPlayer(p.id)}"></span>
          <span class="nm">${nm} ${tags}</span>
          <span style="opacity:.6;font-size:11px">${p.ownedTiles}</span>${acts}</div>`;
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
    const offers = s.allianceOffers
      .filter((o) => o.to === this.g.playerId)
      .map((o) => {
        const nm = esc(this.g.players.find((p) => p.id === o.from)?.name ?? `Cult #${o.from}`);
        return `<div class="e" style="color:#9be6c0">✉ ${nm} offers alliance — <span class="act" data-accept="${o.from}" style="pointer-events:auto;cursor:pointer;text-decoration:underline">accept</span></div>`;
      })
      .join("");
    const lines = this.feed.map((f) => `<div class="e">${f.text}</div>`).join("");
    // chat (server-moderated) — hidden when muted via the .fk-mute-chat class
    const chat = this.g.chat
      .slice(-8)
      .map((c) => {
        const nm = this.g.players.find((p) => p.id === c.from)?.name ?? `Cult #${c.from}`;
        return `<div class="e fk-chat" style="opacity:.85">💬 ${esc(nm)}: ${esc(c.msg)}</div>`;
      })
      .join("");
    const html = `<div style="opacity:.5;font-size:9px;letter-spacing:1px">DRAMA FEED</div>${offers}${lines}${chat}`;
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
        b.textContent = this.banner.text;
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

  destroy(): void {
    window.removeEventListener("keydown", this.focusChatKey);
    this.root.remove();
  }
}

/**
 * Doctrine picker (§28): the 4-column BITE grid as a transient panel (not a
 * blocking modal — click-away closes it). Real numbers shown per node.
 */
function showDoctrinePanel(g: GameSession): void {
  document.querySelector(".fk-doc-panel")?.remove();
  const me = g.sim.players.find((p) => p.id === g.playerId);
  if (!me) return;
  const pts = doctrinePointsAvailable(me);
  const COLS: [string, string, string[]][] = [
    ["B", "BEHAVIOR", ["B1 Tithing Drill +10% tithe", "B2 Uniforms +15% home def", "B3 Curfew −dissent", "B4 Total Discipline"]],
    ["I", "INFORMATION", ["I1 Newsletter +Heat vis", "I2 Wiretap intercept", "I3 Strong Signal strikes", "I4 Total Surveillance"]],
    ["T", "THOUGHT", ["T1 Better Pamphlets +10% R₀", "T2 Loaded Language", "T3 Us vs Them", "T4 Sacred Science"]],
    ["E", "EMOTIONAL", ["E1 Welcome Basket −30%", "E2 Love Bombing", "E3 Shunning", "E4 Unshakeable"]],
  ];
  const panel = document.createElement("div");
  panel.className = "fk-doc-panel";
  panel.style.cssText =
    "position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;" +
    "background:rgba(10,8,6,.7);font-family:'Segoe UI',sans-serif;color:#f0e6d0";
  const grid = COLS.map(([br, title, nodes]) => {
    const cells = nodes
      .map((label, i) => {
        const node = `${br}${i + 1}`;
        const have = me.doctrine.includes(node);
        const bg = have ? "#c89858;color:#1a1410" : "#241c14";
        return `<button class="fk-doc-node" data-node="${node}" ${have ? "disabled" : ""}
          style="display:block;width:100%;margin:4px 0;padding:8px;text-align:left;font-size:11px;
          background:${bg};border:1px solid #5a4a30;border-radius:4px;cursor:${have ? "default" : "pointer"}">${label}</button>`;
      })
      .join("");
    return `<div style="width:190px"><h4 style="margin:0 0 6px;letter-spacing:1px;font-size:11px;opacity:.7">${title}</h4>${cells}</div>`;
  }).join("");
  panel.innerHTML = `<div style="background:rgba(20,16,12,.96);border:1px solid #5a4a30;border-radius:10px;padding:18px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <b style="letter-spacing:2px">DOCTRINE — BITE</b><span style="opacity:.7">${pts} point${pts === 1 ? "" : "s"} available</span>
    </div><div style="display:flex;gap:12px">${grid}</div>
    <div style="margin-top:12px;opacity:.5;font-size:11px;text-align:center">click a node to commit · irreversible · click outside to close</div></div>`;
  panel.onclick = (e) => {
    if (e.target === panel) panel.remove();
  };
  panel.querySelectorAll<HTMLElement>("[data-node]").forEach((b) => {
    b.onclick = () => {
      g.sendIntent({ t: "DOCTRINE_PICK", node: b.dataset.node! } as ClientIntent);
      setTimeout(() => {
        panel.remove();
        showDoctrinePanel(g); // reopen to reflect the pick
      }, 60);
    };
  });
  document.getElementById("app")!.appendChild(panel);
}
