/**
 * The 1980s vehicle fleet (Stage 2). Every car is authored as a compact
 * E-facing character matrix (columns = rear → front, rows = north flank →
 * south flank; the south row is the flank the 3/4 camera sees) and rotated
 * for the four headings. Sizes (E–W): sedan, K-car, Blazer, Beetle 3×2;
 * wagon, pickup, Camaro, van, cruiser 4×2; school bus 6×2; BMX 2×1 (N–S
 * transposed).
 *
 * Presentation only: the kind and paint are pure hashes of a household /
 * agent seed, and the cruiser's bubble light + the bus hazards flash off
 * the frame clock. Nothing here touches sim state.
 *
 * Palette keys:  B body · b body shade · R roof (lit) · G glass · g glass
 * shade · W wood-grain panel · T white hardtop · K black · k bed/cargo dark ·
 * S stripe/accent · L light bar (flashes) · H hazard lamp (blinks) · Y bus
 * yellow · y bus shade · w window band · P rider shirt · F frame ·
 * O tyre (E/W wheel row only).
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

/**
 * E-facing matrices (rear → front). Row 0 is the roof / top the camera
 * looks down on, row 1 the south flank. Silhouettes differ in LENGTH and in
 * where the glass sits: the sedan's roof is centred with trunk and hood
 * either side; the K-car is a stubby notchback (short trunk, glass right
 * behind the hood); the Blazer is tall with its white hardtop running to
 * the tailgate; the pickup's open bed shows its floor and rails; the
 * Beetle has rounded ends (transparent corners); the Camaro's long hood;
 * the van a slab-sided box with its stripe; the cruiser black-and-white
 * with the light bar on the roof; the wagon's roof runs to the tailgate
 * over a wood-grain flank.
 */
interface VSprite {
  /** E-facing body rows (rear → front); row 0 = roof, last = near (south) flank */
  body: readonly string[];
  /** near-side wheels: on E/W headings the 'O' columns of the near-flank
   * (last) row are drawn as tyres — inside the box; N/S shows none */
  wheels?: string;
  /** top-down body for N/S headings (defaults to `body`) */
  ns?: readonly string[];
}
const SPRITES: Record<VehicleKind, VSprite> = {
  sedan: { body: ["bRB", "bgb"], wheels: "O.O" },
  wagon: { body: ["RRRB", "WWWb"], wheels: "O..O" },
  kcar: { body: ["GRB", "bgB"], wheels: "O.O" },
  blazer: { body: ["TTG", "bgb"], wheels: "O.O" },
  // cab + open bed: tailgate, dark bed floor, cab (raised), hood
  pickup: { body: ["rkRG", "bbgB"], wheels: ".O.O", ns: ["rkRB", "rkRb"] },
  beetle: { body: [".RG", "bBb"], wheels: "O.O" },
  camaro: { body: ["bGBB", "bgSB"], wheels: "O..O" },
  van: { body: ["RRRG", "SSSb"], wheels: "O..O" },
  cruiser: { body: ["KTLG", "DTTD"], wheels: "O..O" },
  bus: { body: ["HYYYYy", "Hwwwwy"], wheels: ".O..O." },
  bmx: { body: ["KP"] },
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
/** tyres: near-black, a touch warmer than the black paint so they read under dark cars */
const TYRE = hexToRgb("#141312");
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
  const m = SPRITES[kind].body;
  const len = m[0]!.length, wid = m.length;
  return dir < 2 ? { w: len, h: wid } : { w: wid, h: len };
}

/**
 * Draw a vehicle with its bounding box's top-left at (x, y).
 * `flash` = frame tick for the cruiser light bar / bus hazards (-1 = off);
 * `bloom` adds the light bar's night halo (drawn outside the box).
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
  bloom = false,
): void {
  const sp = SPRITES[kind];
  const m = dir >= 2 && sp.ns ? sp.ns : sp.body;
  const len = m[0]!.length, wid = m.length;
  // work trucks never go near-black: a dark pickup reads as a hole in the
  // road, so dark paints fade to a sun-bleached mid tone
  if (kind === "pickup" && paint[0] * 77 + paint[1] * 150 + paint[2] * 29 < 110 * 256) paint = [(paint[0] + 184) >> 1, (paint[1] + 170) >> 1, (paint[2] + 150) >> 1];
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
      case "O": return TYRE;
      case "D": return hexToRgb("#48484e"); // sunlit black quarter panel (tyres read under it)
      case "k": return shade(paint, 0.62); // pickup bed floor
      case "r": return shade(paint, 1.25); // tailgate / bed rail (lit)
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
  // police light-bar BLOOM after dark: a dim halo round the bar on
  // alternating frames (red / blue) so the flash reads across the map
  if (bloom && kind === "cruiser" && tick >= 0) {
    const red = ((tick >> 2) & 1) === 0;
    const glow = red ? EMISSIVE.policeRedGlow : EMISSIVE.policeBlueGlow;
    const a = 2; // light bar column (rear → front)
    let bx: number, by: number;
    if (dir === 0) { bx = x + a; by = y; }
    else if (dir === 1) { bx = x + len - 1 - a; by = y; }
    else if (dir === 2) { bx = x + (wid - 1); by = y + a; }
    else { bx = x; by = y + len - 1 - a; }
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [0, -2]] as const) put(bx + dx, by + dy, glow);
  }
  for (let r = 0; r < wid; r++) {
    for (let a = 0; a < len; a++) {
      const tyre = dir < 2 && r === wid - 1 && sp.wheels !== undefined && sp.wheels[a] === "O";
      const c = tyre ? TYRE : pal(m[r]![a]!);
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
