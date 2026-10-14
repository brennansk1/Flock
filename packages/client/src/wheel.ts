/**
 * The MISSION WHEEL (v3 M6 · DESIGN_MISSIONS §6) — the real SEND control.
 *
 * Right-click a tile or key building and a radial menu blooms at the cursor:
 * three arcs — SPREAD / TEND / CRUSADE — ring a %-of-flock slider and a readout
 * of the place you're aiming at. Click an arc to commit that share of your
 * flock in that mode; the % is remembered across the session. Esc, a
 * click-away, or a fresh right-click dismisses it. When you've no flock free or
 * every cohort is already out, the arcs grey and the center says why.
 *
 * Dressed to match the HUD's stance rail exactly — same colors (§STANCES),
 * same candle/mega/flame pixel glyphs (§GLYPH), same VT323 / Press Start / hard
 * #060403 offset-shadow pixel look. Pure client feature: it just emits
 * MISSION_SEND{tile, permille, mode}; the sim floors the inner circle and caps
 * cohorts.
 */

import { Stance } from "@flock/sim";
import { GLYPH } from "./hud.js";

type SendMode = typeof Stance.Spread | typeof Stance.Tend | typeof Stance.Crusade;

/** Everything the wheel needs to know to bloom at a spot. */
export interface WheelCtx {
  tile: number;
  screenX: number;
  screenY: number;
  label: string; // target readout ("the school", "Elm St")
  canSend: boolean; // flock available AND a cohort slot free
  reason: string; // shown in the hub when !canSend
}

interface Arc {
  mode: SendMode;
  name: string;
  glyph: string;
  color: string;
  a0: number;
  a1: number;
  mid: number;
}

const DEG = Math.PI / 180;
const CX = 120;
const CY = 120;
const R_OUT = 112;
const R_IN = 58;
const R_LABEL = (R_OUT + R_IN) / 2;
const INK = "#19110a"; // dark text on a lit arc — same as .fk-stance.on

// Three 120° sectors with a 6° gap, centered top / lower-right / lower-left so
// SPREAD (the default, balanced verb) sits at 12 o'clock under the cursor.
// Colors + glyphs mirror the HUD stance rail (STANCES): TEND green candle,
// SPREAD gold megaphone, CRUSADE red flame.
const HALF = (120 - 6) / 2;
const ARCS: Arc[] = [
  { mode: Stance.Spread, name: "SPREAD", glyph: "mega", color: "#d8a83a", a0: (-90 - HALF) * DEG, a1: (-90 + HALF) * DEG, mid: -90 * DEG },
  { mode: Stance.Crusade, name: "CRUSADE", glyph: "flame", color: "#cf4b2c", a0: (30 - HALF) * DEG, a1: (30 + HALF) * DEG, mid: 30 * DEG },
  { mode: Stance.Tend, name: "TEND", glyph: "candle", color: "#6f9b6a", a0: (150 - HALF) * DEG, a1: (150 + HALF) * DEG, mid: 150 * DEG },
];

function sectorPath(rIn: number, rOut: number, a0: number, a1: number): string {
  const at = (r: number, a: number): string => `${(CX + r * Math.cos(a)).toFixed(2)} ${(CY + r * Math.sin(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${at(rOut, a0)} A${rOut} ${rOut} 0 ${large} 1 ${at(rOut, a1)} L${at(rIn, a1)} A${rIn} ${rIn} 0 ${large} 0 ${at(rIn, a0)} Z`;
}

/** An 8×8 GLYPH rendered as crisp <rect>s centered at (cx,cy) in wheel space. */
function glyphCells(name: string, color: string, cx: number, cy: number, size: number): string {
  const rows = GLYPH[name] ?? [];
  const s = size / 8;
  const ox = cx - size / 2;
  const oy = cy - size / 2;
  let cells = "";
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < row.length; x++) {
      if (row.charAt(x) === "1")
        cells += `<rect x="${(ox + x * s).toFixed(2)}" y="${(oy + y * s).toFixed(2)}" width="${(s * 1.06).toFixed(2)}" height="${(s * 1.06).toFixed(2)}" fill="${color}"/>`;
    }
  }
  return cells;
}

const STYLE = `
.fk-wheel{position:fixed;z-index:60;transform:translate(-50%,-50%);
  display:flex;flex-direction:column;align-items:center;gap:7px;
  font-family:'Pixelify Sans',ui-monospace,monospace;color:#efe3c6;-webkit-user-select:none;user-select:none}
.fk-wheel svg{display:block;overflow:visible;filter:drop-shadow(0 5px 0 #060403)}
.fk-wheel .sector{cursor:pointer}
.fk-wheel .sector:hover .wedge{filter:brightness(1.18)}
.fk-wheel .glab{font-family:'Press Start 2P',monospace;font-size:6.5px;letter-spacing:.5px;
  fill:${INK};text-anchor:middle;dominant-baseline:middle;pointer-events:none}
.fk-wheel.dim .sector{cursor:not-allowed}
.fk-wheel.dim .wedge{filter:saturate(.2) brightness(.5)}
.fk-wheel.dim .sector:hover .wedge{filter:saturate(.2) brightness(.5)}
.fk-wheel.dim .glab{opacity:.5}
.fk-wheel-hub{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  width:96px;text-align:center;pointer-events:none}
.fk-wheel-hub .tgt{font-family:'VT323',monospace;font-size:16px;line-height:1;color:#c4ad82;
  min-height:19px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.fk-wheel-hub .pct{font-family:'VT323',monospace;font-size:34px;line-height:.85;color:#f3cf6a}
.fk-wheel-hub .sub{font-family:'Press Start 2P',monospace;font-size:6px;letter-spacing:1px;color:#8a7550;margin-top:3px}
.fk-wheel-hub .why{font-family:'VT323',monospace;font-size:16px;line-height:1.05;color:#cf4b2c}
.fk-wheel-svgwrap{position:relative}
.fk-wheel-slider{-webkit-appearance:none;appearance:none;width:150px;height:8px;
  background:#0e0a05;box-shadow:inset 0 0 0 1px #4a3a26,0 2px 0 #060403;cursor:pointer;margin:2px 0 0}
.fk-wheel-slider::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:18px;
  background:#e0a422;box-shadow:0 2px 0 #060403,inset 0 0 0 1px #f3cf6a;cursor:pointer}
.fk-wheel-slider::-moz-range-thumb{width:12px;height:18px;border:0;border-radius:0;
  background:#e0a422;box-shadow:0 2px 0 #060403;cursor:pointer}
.fk-wheel.dim .fk-wheel-slider{opacity:.3;pointer-events:none}
.fk-wheel-hint{font-family:'VT323',monospace;font-size:14px;color:#8a7550;letter-spacing:.3px}
`;

export class MissionWheel {
  private el: HTMLDivElement;
  private hub: HTMLDivElement;
  private slider: HTMLInputElement;
  private tile = -1;
  private permille = 400; // remembered across the session (default 40%)
  private open_ = false;

  constructor(
    private root: HTMLElement,
    private onSend: (tile: number, permille: number, mode: SendMode) => void,
  ) {
    if (!document.getElementById("fk-wheel-style")) {
      const s = document.createElement("style");
      s.id = "fk-wheel-style";
      s.textContent = STYLE;
      document.head.appendChild(s);
    }

    const sectors = ARCS.map((a) => {
      const lx = (CX + R_LABEL * Math.cos(a.mid)).toFixed(1);
      const ly = CY + R_LABEL * Math.sin(a.mid);
      return `<g class="sector" data-mode="${a.mode}">
        <path class="wedge" d="${sectorPath(R_IN, R_OUT, a.a0, a.a1)}" fill="${a.color}" stroke="#17100a" stroke-width="3"/>
        ${glyphCells(a.glyph, INK, Number(lx), ly - 10, 15)}
        <text class="glab" x="${lx}" y="${(ly + 11).toFixed(1)}">${a.name}</text>
      </g>`;
    }).join("");

    // dark hub disc keeps the readout legible over busy terrain; hairline ring
    // ties it to the panel look
    const hubDisc = `<circle cx="${CX}" cy="${CY}" r="${R_IN - 3}" fill="rgba(10,7,4,.9)" stroke="#4a3a26" stroke-width="2"/>`;

    this.el = document.createElement("div");
    this.el.className = "fk-wheel";
    this.el.style.display = "none";
    this.el.innerHTML = `
      <div class="fk-wheel-svgwrap">
        <svg width="240" height="240" viewBox="0 0 240 240">${sectors}${hubDisc}</svg>
        <div class="fk-wheel-hub">
          <div class="tgt"></div>
          <div class="pct"></div>
          <div class="sub">OF YOUR FLOCK</div>
        </div>
      </div>
      <input class="fk-wheel-slider" type="range" min="100" max="900" step="50" value="${this.permille}">
      <div class="fk-wheel-hint">right-click to move · Esc to cancel</div>`;
    this.root.appendChild(this.el);

    this.hub = this.el.querySelector(".fk-wheel-hub")!;
    this.slider = this.el.querySelector(".fk-wheel-slider")!;

    this.slider.addEventListener("input", () => {
      this.permille = Number(this.slider.value);
      this.refreshPct();
    });
    // keep drags/clicks on the wheel from reaching the map underneath
    this.el.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
    this.el.addEventListener("click", (e) => {
      const g = (e.target as HTMLElement).closest(".sector") as HTMLElement | null;
      if (!g || this.el.classList.contains("dim")) return;
      const mode = g.dataset.mode as SendMode;
      this.commit(mode);
    });
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(ctx: WheelCtx): void {
    this.tile = ctx.tile;
    this.el.style.left = `${ctx.screenX}px`;
    this.el.style.top = `${ctx.screenY}px`;
    this.el.classList.toggle("dim", !ctx.canSend);
    (this.hub.querySelector(".tgt") as HTMLElement).textContent = ctx.canSend ? ctx.label : "";
    const pct = this.hub.querySelector(".pct") as HTMLElement;
    const sub = this.hub.querySelector(".sub") as HTMLElement;
    if (ctx.canSend) {
      pct.className = "pct";
      sub.style.display = "";
      this.refreshPct();
    } else {
      pct.className = "why";
      pct.textContent = ctx.reason;
      sub.style.display = "none";
    }
    this.el.style.display = "flex";
    this.open_ = true;
    // nudge fully on-screen if the cursor was near an edge
    requestAnimationFrame(() => this.clampIntoView());
  }

  close(): void {
    if (!this.open_) return;
    this.el.style.display = "none";
    this.open_ = false;
    this.tile = -1;
  }

  /** Keyboard fallback: 1 Tend · 2 Spread · 3 Crusade (§6). */
  pickByKey(key: string): boolean {
    if (!this.open_ || this.el.classList.contains("dim")) return false;
    const mode = key === "1" ? Stance.Tend : key === "2" ? Stance.Spread : key === "3" ? Stance.Crusade : null;
    if (mode === null) return false;
    this.commit(mode);
    return true;
  }

  private commit(mode: SendMode): void {
    if (this.tile < 0) return;
    this.onSend(this.tile, this.permille, mode);
    this.close();
  }

  private refreshPct(): void {
    (this.hub.querySelector(".pct") as HTMLElement).textContent = `${Math.round(this.permille / 10)}%`;
  }

  private clampIntoView(): void {
    const r = this.el.getBoundingClientRect();
    const m = 8;
    let dx = 0;
    let dy = 0;
    if (r.left < m) dx = m - r.left;
    else if (r.right > innerWidth - m) dx = innerWidth - m - r.right;
    if (r.top < m) dy = m - r.top;
    else if (r.bottom > innerHeight - m) dy = innerHeight - m - r.bottom;
    if (dx || dy) {
      this.el.style.left = `${parseFloat(this.el.style.left) + dx}px`;
      this.el.style.top = `${parseFloat(this.el.style.top) + dy}px`;
    }
  }
}
