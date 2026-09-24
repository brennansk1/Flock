/**
 * Shared HUD primitives: the 8×8 pixel glyph set, formatting helpers and the
 * per-archetype accent lookup. Leaf module — imported by hud.ts and every
 * hud/* panel so nothing here may import them back.
 */
import { hasArchetype, getArchetype, type SimState } from "@flock/sim";

/** 8×8 pixel-art glyph bitmaps (design GLYPH). Exported so the mission wheel
 *  (§6) can render the exact same candle/mega/flame icons as the stance rail. */
export const GLYPH: Record<string, readonly string[]> = {
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
  cross: ["00011000", "00011000", "11111111", "11111111", "00011000", "00011000", "00011000", "00011000"],
  skull: ["00111100", "01111110", "11011011", "11011011", "01111110", "00111100", "00100100", "00000000"],
  star: ["00010000", "00010000", "11111111", "00111100", "01111110", "01100110", "11000011", "00000000"],
};

/** Render an 8×8 GLYPH as a crisp inline SVG (design icon()). */
export function icon(name: string, color: string, px: number): string {
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

/** Escape user-supplied text before it touches innerHTML (XSS guard). */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n}`;
}
export function fmtNum(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}
export function fmtTime(ticks: number): string {
  const s = Math.max(0, Math.floor(ticks / 10));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}


/** Seconds readout for a tick countdown (10 ticks = 1 s). */
export function fmtSecs(ticks: number): string {
  const s = Math.max(0, Math.ceil(ticks / 10));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

/** Archetype accents (design handoff §01): own cult re-dresses the HUD.
 *  Built-ins carry a hand-tuned highlight; DLC cults fall back to theme.accent. */
const ACCENT2: Record<string, string> = {
  dawn: "#f0b53e",
  radiant: "#c4dd72",
  circle: "#f3cf6a",
  visitors: "#8fd6dd",
};
export function archAccent(id: string): { a: string; b: string } {
  const a = hasArchetype(id) ? getArchetype(id).theme.accent : "#e0a422";
  return { a, b: ACCENT2[id] ?? a };
}

/** The slice of the map camera the HUD needs (minimap jump + viewport rect). */
export interface Camera {
  centerOn(tile: number): void;
  /** zoom in on a tile and flash a transient highlight ring on it */
  flashTile(tile: number, nowMs: number): void;
  getView(): { x: number; y: number; w: number; h: number };
}

/** Where a cult "lives" for camera jumps: its commune, else any held tile. */
export function homeTile(s: SimState, pid: number): number {
  for (const b of s.buildings) if (b.player === pid && b.type === "compound") return b.tile;
  const own = s.world.owner;
  for (let t = 0; t < own.length; t++) if (own[t] === pid) return t;
  return -1;
}

/** Display name for a seat (wire roster first; splinters get a generic tag). */
export function seatName(players: readonly { id: number; name: string }[], id: number): string {
  const known = players.find((p) => p.id === id)?.name;
  if (known) return known;
  return id >= 900 ? `Splinter Sect #${id}` : `Cult #${id}`;
}
