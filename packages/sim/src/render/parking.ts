/**
 * Parking (Stage 2): rear lots behind the Main St storefront rows and the
 * civic lots — striped stalls on the 3px pitch the residents' cars use,
 * a concrete curb where the lot meets anything but more lot or street,
 * a few parked 80s cars by hash (fuller by day), and a dumpster by the
 * shops' back doors. Plus DIAGONAL ON-STREET PARKING for Main Street
 * through downtown (see diagonalStall).
 */
import { Terrain, Lot, type World } from "../types.js";
import { hexToRgb, shade, type RGB } from "../palette.js";
import { RS, C, TILE_PX, pixHash, type Put } from "./core.js";
import { drawVehicle, householdVehicle, householdPaint, vehicleSize } from "./vehicles.js";

const hx = hexToRgb;
const STRIPE = hx("#bcb8ac");
const CURB = hx("#a8a298");

function occupancy(): number {
  return RS.time === "night" ? 15 : RS.time === "dusk" ? 35 : RS.time === "dawn" ? 20 : 45;
}

export function drawParkingTile(w: World, t: number, tx: number, ty: number, x0: number, y0: number, put: Put): void {
  const lotAt = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w.width || y >= w.height ? -1 : w.lot[y * w.width + x]!;
  const terr = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w.width || y >= w.height ? -1 : w.terrain[y * w.width + x]!;
  const open = (x: number, y: number): boolean => lotAt(x, y) === Lot.Parking || terr(x, y) === Terrain.Road;
  const cN = !open(tx, ty - 1), cS = !open(tx, ty + 1), cW = !open(tx - 1, ty), cE = !open(tx + 1, ty);
  const snow = RS.season === "winter";
  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      const gx = x0 + px, gy = y0 + py;
      let c: RGB = pixHash(gx, gy, 53) % 11 === 0 ? shade(C.asphalt, 1.08) : C.asphalt;
      if (snow && pixHash(gx, gy, 55) % 4 === 0) c = hx("#c8ced2"); // plowed slush
      // stall stripes: back-to-back rows (y 1..3 and 4..6), 3px pitch
      if ((px === 1 || px === 4 || px === 7) && (py === 1 || py === 2 || py === 5 || py === 6)) c = STRIPE;
      if ((cN && py === 0) || (cS && py === 7) || (cW && px === 0) || (cE && px === 7)) c = CURB;
      put(gx, gy, c);
    }
  }
  // parked cars nose-in (N–S, 2×3) in the four stalls of the tile
  const occ = occupancy();
  for (let k = 0; k < 4; k++) {
    const h = pixHash(t, k, 811);
    if (h % 100 >= occ) continue;
    // back-to-back rows: row A noses north (tail at y 3), row B south
    // (tail at y 4); 4-px kinds overhang onto the curb row
    const kind = householdVehicle(h);
    const len = vehicleSize(kind, 2).h;
    const sx = x0 + (k & 1 ? 5 : 2), sy = y0 + (k & 2 ? 4 : 4 - len);
    drawVehicle(put, kind, sx, sy, k & 2 ? 2 : 3, householdPaint(h >>> 4));
  }
  // a dumpster by the back doors when the lot backs onto storefronts
  const shop = (x: number, y: number): boolean => { const l = lotAt(x, y); return l === Lot.Shop || l === Lot.Diner || l === Lot.Supermarket; };
  if ((shop(tx, ty - 1) || shop(tx, ty + 1) || shop(tx - 1, ty) || shop(tx + 1, ty)) && pixHash(t, 7, 811) % 3 === 0) {
    const dy = shop(tx, ty - 1) ? 0 : 6;
    put(x0 + 3, y0 + dy, hx("#2f5a3a"));
    put(x0 + 4, y0 + dy, hx("#2f5a3a"));
    put(x0 + 3, y0 + dy + 1, hx("#1f3a26"));
    put(x0 + 4, y0 + dy + 1, hx("#1f3a26"));
  }
}

/**
 * Diagonal curb parking on Main Street through downtown: angled stripes in
 * the 2px curb band, with a parked car in most stalls by day. Returns the
 * colour for band pixel (gx, band row 0..1) or null for plain asphalt.
 */
export function diagonalStall(gx: number, band: number, rowKey: number): RGB | null {
  const s = Math.floor((gx + band) / 4); // stall index along the street
  const k = (gx + band) % 4;
  const h = pixHash(s, rowKey, 813);
  const parked = h % 100 < occupancy() + 20;
  if (parked && k >= 1) {
    const paint = householdPaint(h >>> 3);
    if (k === 1) return band === 0 ? shade(paint, 1.15) : paint;
    if (k === 2) return band === 0 ? hx("#2a3550") : shade(paint, 0.8);
    return band === 0 ? paint : shade(paint, 0.7);
  }
  return k === 0 ? STRIPE : null;
}
