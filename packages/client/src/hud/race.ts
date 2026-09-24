/**
 * VICTORY RACE (STAGE1_DESIGN §3/§9.1) — the one rule, made visible.
 *
 * Every cult's best path to victory with a progress bar, its soul share, and
 * a live Ascension countdown the moment any cult meets a condition. The
 * ascension strip (center column) is the loud, streamable version: red pulse
 * for a rival, gold for you, with the counterplay (EXPOSE / JUMP) one click
 * away.
 *
 * Cost model: `computeRace` is a full world pass (refreshVictoryStats) and runs
 * at ~2 Hz; the countdown text reads the live PlayerState every tick.
 */
import {
  refreshVictoryStats,
  victoryPaths,
  dominationThreshold,
  exposeBlocker,
  exposeCost,
  colorForPlayer,
  toInt,
  type PathStatus,
  type PlayerState,
} from "@flock/sim";
import type { GameSession, ClientIntent } from "../net.js";
import { esc, fmtMoney, fmtSecs, homeTile, seatName, type Camera } from "./common.js";

export interface RaceRow {
  id: number;
  souls: number;
  best: PathStatus | null;
  alive: boolean;
}
export interface RaceModel {
  /** Domination Tipping Point right now (‰). */
  threshold: number;
  rows: RaceRow[];
  /** path id → display name (universal + every cult present). */
  pathNames: Map<string, string>;
}

/** Universal + terminal outcomes that aren't "paths" but still name an ending. */
const OUTCOME_NAMES: Record<string, string> = {
  domination: "Domination",
  revelation: "Revelation",
  last_standing: "Last Cult Standing",
  timer: "Time's Up",
};

export function computeRace(g: GameSession): RaceModel {
  const s = g.sim;
  const st = refreshVictoryStats(s);
  const threshold = dominationThreshold(s, g.balance);
  const pathNames = new Map<string, string>(Object.entries(OUTCOME_NAMES));
  const rows: RaceRow[] = [];
  for (const p of s.players) {
    if (!p.spawned) continue;
    const paths = victoryPaths(s, p, g.balance, st);
    for (const x of paths) pathNames.set(x.id, x.name);
    let best: PathStatus | null = null;
    for (const x of paths) {
      if (p.ascendPath === x.id) {
        best = x;
        break;
      }
      if (!best || x.progress > best.progress) best = x;
    }
    rows.push({ id: p.id, souls: p.soulsPermille, best, alive: p.alive });
  }
  rows.sort((a, z) => z.souls - a.souls || a.id - z.id);
  return { threshold, rows, pathNames };
}

interface RowEls {
  root: HTMLElement;
  souls: HTMLElement;
  path: HTMLElement;
  fill: HTMLElement;
  cd: HTMLElement;
  tag: HTMLElement;
  act: HTMLElement | null;
}

export const RACE_CSS = `
.fk-race{overflow:auto;max-height:238px}
.fk-race h4{display:flex;justify-content:space-between}
.fk-race h4 .tp{color:#f0b53e;letter-spacing:0}
.fk-rrow{pointer-events:auto;cursor:pointer;padding:4px 5px 5px;margin-bottom:2px;box-shadow:inset 0 0 0 1px transparent}
.fk-rrow:hover{box-shadow:inset 0 0 0 1px #6b563a}
.fk-rrow.me{background:color-mix(in srgb,var(--fk-acc) 15%,transparent);box-shadow:inset 0 0 0 1px var(--fk-acc)}
.fk-rrow.dead{opacity:.45}
.fk-rrow .r1{display:flex;align-items:center;gap:6px;font-size:12px}
.fk-rrow .sw{width:12px;height:12px;flex:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,.5)}
.fk-rrow .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fk-rrow .tg{font-size:12px;flex:none}
.fk-rrow .sp{font-family:'VT323',monospace;font-size:17px;color:#efe3c6;min-width:34px;text-align:right}
.fk-rrow .act{pointer-events:auto;cursor:pointer;font-size:10px;color:#a08a64;background:#0e0a05;box-shadow:inset 0 0 0 1px #4a3a26;padding:1px 5px;flex:none}
.fk-rrow .act:hover{color:#efe3c6;box-shadow:inset 0 0 0 1px #6b563a}
.fk-rrow .r2{display:flex;align-items:center;gap:6px;margin-top:3px}
.fk-rrow .pn{font-family:'VT323',monospace;font-size:15px;color:#a08a64;width:100px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fk-rrow .bar{flex:1;height:6px;background:#0e0a05;box-shadow:inset 0 0 0 1px #4a3a26;overflow:hidden}
.fk-rrow .fill{height:100%;background:#a08a64;transition:width .4s}
.fk-rrow .cd{font-family:'VT323',monospace;font-size:15px;color:#8a7550;min-width:30px;text-align:right}
.fk-rrow.met .fill{background:#f0b53e}
.fk-rrow.asc{animation:fkAscRed 1s infinite}
.fk-rrow.asc .cd{color:#ff7a5a}
.fk-rrow.asc.me{animation:fkAscGold 1s infinite}
.fk-rrow.asc.me .cd{color:#f3cf6a}
@keyframes fkAscRed{0%,100%{background:rgba(207,75,44,.12)}50%{background:rgba(207,75,44,.38)}}
@keyframes fkAscGold{0%,100%{background:rgba(240,181,62,.12)}50%{background:rgba(240,181,62,.36)}}
.fk-asc{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:8px 14px;border:3px solid #f0b53e;box-shadow:0 4px 0 #060403;font-family:'Press Start 2P',monospace;font-size:10px;letter-spacing:1px;line-height:1.5;color:#fff3df;background:#8a2a18;animation:fkAscPulse 1s infinite;white-space:nowrap}
.fk-asc.me{background:#6b4a0c;color:#fff3df;border-color:#f3cf6a;animation:fkAscPulseG 1s infinite}
.fk-asc .t{font-family:'VT323',monospace;font-size:30px;letter-spacing:1px;line-height:1;color:#fff;min-width:54px;text-align:right}
.fk-asc .who{max-width:300px;overflow:hidden;text-overflow:ellipsis}
.fk-asc .sub{display:block;font-family:'Pixelify Sans',monospace;font-size:11px;letter-spacing:.3px;color:#f7d9b0;white-space:normal}
.fk-asc button{font-family:'Pixelify Sans',monospace;font-size:11px;font-weight:700;padding:5px 9px;background:#f0b53e;color:#19110a;box-shadow:0 2px 0 #060403}
.fk-asc button.ghost{background:#241c12;color:#efe3c6;box-shadow:inset 0 0 0 1px #6b563a,0 2px 0 #060403}
.fk-asc button[disabled]{opacity:.45;cursor:not-allowed}
@keyframes fkAscPulse{0%,100%{background:#8a2a18}50%{background:#cf4b2c}}
@keyframes fkAscPulseG{0%,100%{background:#6b4a0c}50%{background:#a8781a}}
.fk-tip{position:absolute;top:0;height:30px;width:0;border-left:2px dashed #fff3df;z-index:7;pointer-events:none;transition:left .6s}
.fk-tip span{position:absolute;top:27px;left:-2px;transform:translateX(-50%);white-space:nowrap;font-family:'Press Start 2P',monospace;font-size:6px;letter-spacing:.5px;color:#19110a;background:#f0b53e;padding:2px 4px;box-shadow:0 2px 0 #060403}
.fk-reduced-motion .fk-rrow.asc,.fk-reduced-motion .fk-asc{animation:none}
`;

/** The right-rail Victory Race panel (replaces the old tiles scoreboard). */
export class RacePanel {
  readonly el: HTMLDivElement;
  private readonly tp: HTMLElement;
  private readonly list: HTMLDivElement;
  private rows = new Map<number, RowEls>();
  private idsKey = "";
  private model: RaceModel | null = null;

  constructor(
    private readonly g: GameSession,
    private readonly camera: Camera | null,
    private readonly send: (i: ClientIntent) => void,
  ) {
    this.el = document.createElement("div");
    this.el.className = "fk-grp fk-race";
    this.el.title =
      "VICTORY RACE — every cult's closest route to victory. Meet ANY condition and a public 45s ASCENSION countdown starts; hold it to zero to win. Rivals break it by taking ground back or EXPOSING you (resets the clock).";
    this.el.innerHTML = `<h4><span>Victory Race</span><span class="tp"></span></h4>`;
    this.tp = this.el.querySelector(".tp")!;
    this.list = document.createElement("div");
    this.el.appendChild(this.list);
  }

  get current(): RaceModel | null {
    return this.model;
  }

  /** ~2 Hz: recompute paths and restyle rows (text/width only). */
  refresh(model: RaceModel, allies: Set<number>): void {
    this.model = model;
    this.tp.textContent = `TIP ${Math.round(model.threshold / 10)}%`;
    this.tp.title = "THE TIPPING POINT — hold this share of the town's souls to start a Domination Ascension. It slides from 65% to 50% between 8:00 and 12:00.";
    const key = model.rows.map((r) => r.id).join(",");
    if (key !== this.idsKey) this.rebuild(model);
    const me = this.g.playerId;
    for (const r of model.rows) {
      const e = this.rows.get(r.id);
      if (!e) continue;
      e.souls.textContent = `${(r.souls / 10).toFixed(0)}%`;
      const best = r.best;
      e.path.textContent = best ? best.name : "—";
      e.fill.style.width = `${best ? Math.min(100, best.progress / 10).toFixed(1) : 0}%`;
      e.root.classList.toggle("met", !!best?.met);
      e.root.classList.toggle("dead", !r.alive);
      e.root.title = best
        ? `${seatName(this.g.players, r.id)} — ${(r.souls / 10).toFixed(1)}% of souls · closest route: ${best.name} (${Math.round(best.progress / 10)}%)${best.met ? " — CONDITION MET" : ""}`
        : "";
      const tags = `${this.g.sim.players.find((p) => p.id === r.id)?.traitor ? "🗡" : ""}${allies.has(r.id) ? "🤝" : ""}${!r.alive ? "☠" : ""}`;
      if (e.tag.textContent !== tags) e.tag.textContent = tags;
      if (e.act && r.id !== me) {
        const txt = allies.has(r.id) ? "✕" : "ally";
        if (e.act.textContent !== txt) e.act.textContent = txt;
        e.act.title = allies.has(r.id) ? "break the alliance" : "propose an alliance";
        e.act.dataset.allied = allies.has(r.id) ? "1" : "";
      }
    }
    this.tick();
  }

  /** Every tick: Ascension countdowns are live. */
  tick(): void {
    for (const p of this.g.sim.players) {
      const e = this.rows.get(p.id);
      if (!e) continue;
      const asc = p.ascendPath !== "" && p.alive;
      e.root.classList.toggle("asc", asc);
      const txt = asc ? fmtSecs(p.ascendTicks) : "";
      if (e.cd.textContent !== txt) e.cd.textContent = txt;
      if (asc) {
        const nm = this.model?.pathNames.get(p.ascendPath) ?? p.ascendPath;
        e.path.textContent = nm;
      }
    }
  }

  private rebuild(model: RaceModel): void {
    this.idsKey = model.rows.map((r) => r.id).join(",");
    this.list.innerHTML = "";
    this.rows.clear();
    const me = this.g.playerId;
    for (const r of model.rows) {
      const root = document.createElement("div");
      root.className = `fk-rrow${r.id === me ? " me" : ""}`;
      const nm = esc(seatName(this.g.players, r.id));
      root.innerHTML =
        `<div class="r1"><span class="sw" style="background:${colorForPlayer(r.id)}"></span><span class="nm">${r.id === me ? `${nm} (you)` : nm}</span>` +
        `<span class="tg"></span><span class="sp"></span>${r.id === me ? "" : `<span class="act">ally</span>`}</div>` +
        `<div class="r2"><span class="pn"></span><div class="bar"><div class="fill"></div></div><span class="cd"></span></div>`;
      const act = root.querySelector<HTMLElement>(".act");
      if (act) {
        act.onclick = (ev) => {
          ev.stopPropagation();
          this.send({ t: act.dataset.allied ? "ALLY_BREAK" : "ALLY_PROPOSE", target: r.id } as ClientIntent);
        };
      }
      root.onclick = () => {
        const t = homeTile(this.g.sim, r.id);
        if (t >= 0) this.camera?.flashTile(t, performance.now());
      };
      this.rows.set(r.id, {
        root,
        souls: root.querySelector(".sp")!,
        path: root.querySelector(".pn")!,
        fill: root.querySelector(".fill")!,
        cd: root.querySelector(".cd")!,
        tag: root.querySelector(".tg")!,
        act,
      });
      this.list.appendChild(root);
    }
  }
}

/**
 * The loud version: one strip per ascending cult in the center column.
 * Rebuilt only when the set of ascending cults/paths changes; the timer text
 * updates every tick.
 */
export class AscensionStrip {
  readonly el: HTMLDivElement;
  private key = "";
  private timers = new Map<number, HTMLElement>();
  private exposeBtns = new Map<number, HTMLButtonElement>();

  constructor(
    private readonly g: GameSession,
    private readonly camera: Camera | null,
    private readonly send: (i: ClientIntent) => void,
    private readonly pathName: (id: string) => string,
  ) {
    this.el = document.createElement("div");
    this.el.style.cssText = "display:flex;flex-direction:column;gap:6px;align-items:center";
  }

  tick(): void {
    const s = this.g.sim;
    const asc = s.players.filter((p) => p.alive && p.ascendPath !== "");
    const key = asc.map((p) => `${p.id}:${p.ascendPath}`).join("|");
    if (key !== this.key) this.rebuild(asc);
    const me = s.players.find((p) => p.id === this.g.playerId);
    for (const p of asc) {
      const t = this.timers.get(p.id);
      if (t) {
        const txt = fmtSecs(p.ascendTicks);
        if (t.textContent !== txt) t.textContent = txt;
      }
      const b = this.exposeBtns.get(p.id);
      if (b && me) {
        const why = exposeBlocker(s, me, p);
        b.disabled = why !== "";
        b.textContent = `EXPOSE ${fmtMoney(toInt(exposeCost(me)))}`;
        b.title = why ? `Can't expose: ${why}` : "Publish their dirty laundry — resets their Ascension to 45s.";
      }
    }
  }

  private rebuild(asc: PlayerState[]): void {
    this.key = asc.map((p) => `${p.id}:${p.ascendPath}`).join("|");
    this.el.innerHTML = "";
    this.timers.clear();
    this.exposeBtns.clear();
    for (const p of asc) {
      const mine = p.id === this.g.playerId;
      const d = document.createElement("div");
      d.className = `fk-asc${mine ? " me" : ""}`;
      const path = esc(this.pathName(p.ascendPath)).toUpperCase();
      const who = esc(seatName(this.g.players, p.id));
      d.innerHTML = mine
        ? `<span>★</span><span><span class="who">YOU ARE ASCENDING · ${path}</span><span class="sub">Hold the condition until zero. An Expose resets the clock.</span></span><span class="t"></span>`
        : `<span>⚠</span><span><span class="who">${who} ASCENDING · ${path}</span><span class="sub">Break the condition or Expose them before zero.</span></span><span class="t"></span>`;
      this.timers.set(p.id, d.querySelector(".t")!);
      if (!mine) {
        const ex = document.createElement("button");
        ex.onclick = () => this.send({ t: "PUBLISH_SCANDAL", target: p.id } as ClientIntent);
        this.exposeBtns.set(p.id, ex);
        const jump = document.createElement("button");
        jump.className = "ghost";
        jump.textContent = "JUMP";
        jump.onclick = () => {
          const t = homeTile(this.g.sim, p.id);
          if (t >= 0) this.camera?.flashTile(t, performance.now());
        };
        d.append(ex, jump);
      }
      this.el.appendChild(d);
    }
  }
}
