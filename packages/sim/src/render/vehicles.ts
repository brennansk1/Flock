/**
 * The 1980s vehicle fleet (Stage 2). Every car is authored as a compact
 * E-facing character matrix (columns = rear → front, rows = north flank →
 * south flank; the south row is the flank the 3/4 camera sees) and rotated
 * for the four headings. Sizes follow SPRITE_SCALE: cars 3×2 (E–W) / 2×3
 * (N–S), the school bus 6×2, a BMX + rider 2×1.
 *
 * Presentation only: the kind and paint are pure hashes of a household /
 * agent seed, and the cruiser's bubble light + the bus hazards flash off
 * the frame clock. Nothing here touches sim state.
 *
 * Palette keys:  B body · b body shade · R roof (lit) · G glass · g glass
 * shade · W wood-grain panel · T white hardtop · K black · k bed/cargo dark ·
 * S stripe/accent · L light bar (flashes) · H hazard lamp (blinks) · Y bus
 * yellow · y bus shade · w window band · P rider shirt · F frame.
 */
import { hexToRgb, shade, type RGB } from "../palette.js";
import type { Put } from "./core.js";
import { EMISSIVE } from "./grade.js";

export const VEHICLE_KINDS = [
  "sedan", // boxy full-size (Caprice / LTD)
  "wagon", // wood-panel Country Squire
  "kcar", // K-car compact (Reliant / Aries)
  "blazer", // Chevy Blazer / Bronco, white hardtop
  "pickup", // square-body C10 / F-150
  "beetle", // VW Beetle
  "camaro", // Camaro / Trans Am, long hood + hood bird
  "van", // Econoline with a 70s side stripe
  "cruiser", // black-and-white police cruiser, bubble light
  "bus", // conventional-nose yellow school bus (6×2)
  "bmx", // kid on a BMX (2×1)
] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];

/** E-facing matrices (rear → front). */
const SPRITES: Record<VehicleKind, readonly string[]> = {
  sedan: ["BRG", "bbg"],
  wagon: ["RRG", "WWg"],
  kcar: ["RRG", "bBg"],
  blazer: ["TTG", "bBg"],
  pickup: ["kRG", "bbg"],
  beetle: ["bRb", "KBK"],
  camaro: ["RGS", "bbB"],
  van: ["RRR", "SSG"],
  cruiser: ["KLG", "TTK"],
  bus: ["HYYYYy", "Hwwwwy"],
  bmx: ["KP"],
};

/** 80s Kodachrome paint: warm, sun-faded, slightly desaturated. */
export const CAR_PAINT: readonly RGB[] = [
  "#b8b2a6", // silver-beige
  "#e4ded0", // cream white
  "#34322f", // black
  "#9a3a2c", // cherry, faded
  "#40597e", // medium blue
  "#566a44", // avocado green
  "#b0955e", // harvest gold / tan
  "#6a2f36", // maroon
  "#8a6a48", // copper brown
  "#7f9cb4", // powder blue
].map(hexToRgb);

const GLASS = hexToRgb("#2a3550");
const WOOD = hexToRgb("#7a5230");
const WHITE = hexToRgb("#ece8dc");
const BLACK = hexToRgb("#1e1d1c");
const BUS = hexToRgb("#e8b020");

/** Stable fleet pick for a household seed (never the cruiser / bus / bmx). */
export function householdVehicle(seed: number): VehicleKind {
  // weights: sedan 4, wagon 3, kcar 2, blazer 2, pickup 3, beetle 1, camaro 1, van 1
  const TABLE: VehicleKind[] = ["sedan", "sedan", "sedan", "sedan", "wagon", "wagon", "wagon", "kcar", "kcar", "blazer", "blazer", "pickup", "pickup", "pickup", "beetle", "camaro", "van"];
  return TABLE[(seed >>> 5) % TABLE.length]!;
}

export function householdPaint(seed: number): RGB {
  return CAR_PAINT[(seed >>> 13) % CAR_PAINT.length]!;
}

/** Box dimensions for a kind + heading (dir 0=E 1=W 2=S 3=N). */
export function vehicleSize(kind: VehicleKind, dir: number): { w: number; h: number } {
  const m = SPRITES[kind];
  const len = m[0]!.length, wid = m.length;
  return dir < 2 ? { w: len, h: wid } : { w: wid, h: len };
}

/**
 * Draw a vehicle with its bounding box's top-left at (x, y).
 * `flash` = frame tick for the cruiser light bar / bus hazards (-1 = off).
 */
export function drawVehicle(
  put: Put,
  kind: VehicleKind,
  x: number,
  y: number,
  dir: number,
  paint: RGB,
  tick = -1,
  hazards = false,
): void {
  const m = SPRITES[kind];
  const len = m[0]!.length, wid = m.length;
  const lightbar = tick >= 0 && ((tick >> 2) & 1) === 0 ? EMISSIVE.policeRed : EMISSIVE.policeBlue;
  const hazardOn = hazards && tick >= 0 && ((tick >> 3) & 1) === 0;
  const pal = (ch: string): RGB | null => {
    switch (ch) {
      case "B": return paint;
      case "b": return shade(paint, 0.78);
      case "R": return shade(paint, 1.16);
      case "G": return GLASS;
      case "g": return shade(GLASS, 0.8);
      case "W": return WOOD;
      case "T": return WHITE;
      case "K": return BLACK;
      case "k": return shade(paint, 0.5);
      case "S": return kind === "camaro" ? hexToRgb("#d8a830") : hexToRgb("#b8642c");
      case "L": return tick >= 0 ? lightbar : hexToRgb("#8a2020");
      case "H": return hazardOn ? EMISSIVE.hazard : shade(BUS, 0.7);
      case "Y": return BUS;
      case "y": return shade(BUS, 0.82);
      case "w": return hexToRgb("#2c2c30");
      case "P": return paint;
      default: return null;
    }
  };
  for (let r = 0; r < wid; r++) {
    for (let a = 0; a < len; a++) {
      const c = pal(m[r]![a]!);
      if (!c) continue;
      // along index a: 0 = rear … len-1 = front
      let px: number, py: number;
      if (dir === 0) { px = x + a; py = y + r; }
      else if (dir === 1) { px = x + len - 1 - a; py = y + r; }
      else if (dir === 2) { px = x + (wid - 1 - r); py = y + a; }
      else { px = x + r; py = y + len - 1 - a; }
      put(px, py, c);
    }
  }
}

/** Heading index from a unit step. */
export function dirOf(dx: number, dy: number): number {
  if (dy === 0) return dx >= 0 ? 0 : 1;
  return dy > 0 ? 2 : 3;
}
