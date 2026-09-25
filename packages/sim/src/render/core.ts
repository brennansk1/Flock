/**
 * Renderer core: shared palette state, deterministic hashes and noise, and
 * the per-frame render state. Every render module imports from here so the
 * split modules draw from one palette and one clock. Presentation only —
 * nothing here ever touches simulation state.
 */
import { hexToRgb, COLOR_APOSTATE, type RGB } from "../palette.js";

export const TILE_PX = 8;

/** A logical-pixel writer (8 px per tile). */
export type Put = (gx: number, gy: number, rgb: RGB) => void;

/** Per-frame render state (set by renderTown before drawing). */
export const RS = {
  season: "summer" as "spring" | "summer" | "fall" | "winter",
  time: "day" as "dawn" | "day" | "dusk" | "night",
  /** output pixels per logical pixel */
  lod: 1,
  tick: 0,
};

export const DEFAULT_COLORS = {
  asphalt: hexToRgb("#6f6b66"),
  asphaltDash: hexToRgb("#b9b3a6"),
  sidewalk: hexToRgb("#9a958e"),
  wall: hexToRgb("#ddd2bd"),
  wallShade: hexToRgb("#c4b9a4"),
  door: hexToRgb("#5d4a33"),
  windowLit: hexToRgb("#ffd76a"),
  windowDark: hexToRgb("#3c4654"),
  block: hexToRgb("#8e8a84"),
  blockShade: hexToRgb("#7a766f"),
  iconDark: hexToRgb("#1c1c1c"),
  iconAccent: hexToRgb("#ffd76a"),
  landmarkGold: hexToRgb("#e9c46a"),
  personNeutral: hexToRgb("#7a6a58"), // warm putty — reads on asphalt AND lawn
  scorched: hexToRgb(COLOR_APOSTATE),
  waterDeep: hexToRgb("#33506e"),
  waterRipple: hexToRgb("#456c92"),
  canopy: hexToRgb("#3a5a30"),
  canopyLight: hexToRgb("#4f7440"),
  trunk: hexToRgb("#4a3a26"),
  meadow: hexToRgb("#829c5e"),
  meadowLight: hexToRgb("#90aa6c"),
  scrub: hexToRgb("#8d9a6a"),
  cropGold: hexToRgb("#c9a84c"),
  cropRow: hexToRgb("#a98c3a"),
  dirt: hexToRgb("#9a8164"),
  dirtEdge: hexToRgb("#86704f"),
  highwayLine: hexToRgb("#e0c34a"),
  sand: hexToRgb("#d8c89a"),
  waterGlint: hexToRgb("#9fc6e0"),
  canopyDark: hexToRgb("#2e4a26"),
  shoulder: hexToRgb("#8a8378"),
  flowerY: hexToRgb("#e8d24a"),
  flowerW: hexToRgb("#e8e4d8"),
  fence: hexToRgb("#8a7a5c"),
  grassHigh: hexToRgb("#a0ba7a"),
  grassLow: hexToRgb("#6e884d"),
  unitGlass: hexToRgb("#2a3550"),
  unitShadow: hexToRgb("#33302a"),
  rock: hexToRgb("#cbd0d4"), // Cool slate shore grey
  rockShade: hexToRgb("#8c9296"), // Weathered shore stone shadow
  bush: hexToRgb("#5a7340"),
  shadow: hexToRgb("#6f7a52"),
  plank: hexToRgb("#8a6f4d"),
  plankDark: hexToRgb("#745a3c"),
  rail: hexToRgb("#5d4a33"),
  crosswalk: hexToRgb("#d8d4c8"),
  glass: hexToRgb("#cfe8e2"),
  glassFrame: hexToRgb("#8fb0a8"),
  sandBg: hexToRgb("#d9c791"),
  sandDark: hexToRgb("#c9b57e"),
  sandScrub: hexToRgb("#a89a68"),
  cactus: hexToRgb("#4e7a3a"),
  cactusDark: hexToRgb("#3c6030"),
  forestFloor: hexToRgb("#8ba06c"),
  pathStone: hexToRgb("#b8b2a4"),
  pathEdge: hexToRgb("#9a958e"),
  cowWhite: hexToRgb("#e8e4d8"),
  cowBrown: hexToRgb("#8a5a3a"),
  wire: hexToRgb("#3a352e"),
  ballast: hexToRgb("#8a8178"),
  tie: hexToRgb("#5a4634"),
  railSteel: hexToRgb("#4a4a52"),
  boxcarA: hexToRgb("#8a4a3a"),
  boxcarB: hexToRgb("#6a6e54"),
  elevator: hexToRgb("#c8c2b4"),
  willowL: hexToRgb("#8eb85c"),
  willowD: hexToRgb("#628a38"),
};

export const C = { ...DEFAULT_COLORS };

export function pixHash(x: number, y: number, z = 0): number {
  let h = (x * 374761393 + y * 668265263 + z * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// Quantized cosine-ease table: valueNoise is the single hottest function in
// a full-map render (49% of CPU in profile, two Math.cos per pixel); a 1024-
// step lookup is visually identical and ~5× cheaper.
const EASE_N = 1024;
const EASE: Float64Array = (() => {
  const t = new Float64Array(EASE_N + 1);
  for (let i = 0; i <= EASE_N; i++) t[i] = (1 - Math.cos((i / EASE_N) * Math.PI)) / 2;
  return t;
})();

/** Smooth 0..1 value noise over a coarse lattice (cosine-eased via table).
 * (A lattice-corner Map memo was tried and measured SLOWER than recomputing:
 * pixHash is three imuls; Map traffic on 4 corners/call lost to it.) */
export function valueNoise(x: number, y: number, cell: number, z = 0): number {
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = EASE[((gx - x0) * EASE_N) | 0]!;
  const fy = EASE[((gy - y0) * EASE_N) | 0]!;
  const a = (pixHash(x0, y0, z) % 1000) / 1000;
  const b = (pixHash(x0 + 1, y0, z) % 1000) / 1000;
  const c = (pixHash(x0, y0 + 1, z) % 1000) / 1000;
  const d = (pixHash(x0 + 1, y0 + 1, z) % 1000) / 1000;
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}


/**
 * Declarative sprite stamp: `rows` is a character matrix, `pal` maps a
 * character to a colour (missing / null = transparent). Drawn at (x0, y0).
 */
export function stamp(put: Put, x0: number, y0: number, rows: readonly string[], pal: Record<string, RGB | null | undefined>): void {
  for (let y = 0; y < rows.length; y++) {
    const r = rows[y]!;
    for (let x = 0; x < r.length; x++) {
      const c = pal[r[x]!];
      if (c) put(x0 + x, y0 + y, c);
    }
  }
}

/** Is it dark enough for lamps and lit windows? */
export function isLitHour(): boolean {
  return RS.time === "night" || RS.time === "dusk";
}

/**
 * Parking-lot occupancy (%) by the civic clock: frameTick through a
 * 2400-tick day — empty small hours, a morning fill, busy midday, an
 * evening ebb — capped low when the frame is lit as night.
 */
export function lotOccupancy(bias = 0): number {
  const tod = ((RS.tick % 2400) + 2400) % 2400;
  let o = tod < 240 ? 8 : tod < 640 ? 8 + ((tod - 240) * 52) / 400 : tod < 1400 ? 60 : tod < 1900 ? 60 - ((tod - 1400) * 35) / 500 : 25 - ((tod - 1900) * 15) / 500;
  if (RS.time === "night") o = Math.min(o, 18);
  else if (RS.time === "dusk") o = Math.min(o, 40);
  return Math.max(0, Math.min(95, o + bias));
}

/**
 * Cars COME AND GO: a stall's visits are a pure function of frameTick and
 * the stall's hash — each stall cycles on its own period with a hashed
 * phase, holding a car for the occupancy share of that period. Returns the
 * current visitor's seed (a different car each visit), or -1 when empty.
 */
export function stallVisit(key: number, occ: number): number {
  const h = pixHash(key, 3, 8117);
  const P = 360 + (h % 480);
  const t = RS.tick + ((h >>> 9) % P);
  const v = Math.floor(t / P);
  const hv = pixHash(key, v, 8119);
  // per-visit jitter so neighbouring stalls don't fill in lockstep
  const share = (occ + ((hv % 21) - 10)) / 100;
  return t - v * P < P * share ? hv : -1;
}
