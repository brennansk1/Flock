/**
 * Main Street storefronts (Stage 2): Shop / Diner / generic commercial
 * tiles drawn as a CONTINUOUS 1980s party-wall frontage. Each 1-tile shop
 * gets a trade (video rental, arcade, electronics, hardware, five-and-dime,
 * barber, record store, pharmacy, shoe store, laundromat), a façade
 * material, a painted sign band, a striped fabric awning in its own
 * colours, display windows (dark glass by day, lit at dusk/night) and a
 * door; neighbours share a dark party-wall seam. Street clutter on the
 * sidewalk edge: payphones and newspaper boxes. Neon, never LED.
 *
 * Laid out in the frontage-local frame (depth d toward the street) so a
 * shop can face any side; the 3/4 façade reads fully when it faces south.
 */
import { Terrain, Lot, type World } from "../types.js";
import { hexToRgb, shade, type RGB } from "../palette.js";
import { RS, C, pixHash, isLitHour, type Put } from "./core.js";
import { EMISSIVE } from "./grade.js";
import { frontageOf } from "./houses.js";

const hx = hexToRgb;

interface Trade {
  name: string;
  sign: RGB;
  letters: RGB;
  awnA: RGB;
  awnB: RGB;
  neon: RGB | null;
  /** window display accent (goods in the window) */
  goods: RGB;
}

const TRADES: readonly Trade[] = [
  { name: "video", sign: hx("#1f3f8a"), letters: hx("#f0d040"), awnA: hx("#1f3f8a"), awnB: hx("#e8e2d0"), neon: EMISSIVE.neonCyan, goods: hx("#d04040") },
  { name: "arcade", sign: hx("#2a1f3a"), letters: hx("#ff5ac8"), awnA: hx("#6a2a8a"), awnB: hx("#2a1f3a"), neon: EMISSIVE.neonPink, goods: hx("#50f0ff") },
  { name: "electronics", sign: hx("#c8342a"), letters: hx("#f2efe6"), awnA: hx("#c8342a"), awnB: hx("#f2efe6"), neon: EMISSIVE.neonPink, goods: hx("#9aa0a6") },
  { name: "hardware", sign: hx("#2f6a3a"), letters: hx("#f2efe6"), awnA: hx("#2f6a3a"), awnB: hx("#e8dcb0"), neon: null, goods: hx("#c87830") },
  { name: "five-and-dime", sign: hx("#b8322a"), letters: hx("#f0d040"), awnA: hx("#b8322a"), awnB: hx("#f0d040"), neon: null, goods: hx("#e8b8c8") },
  { name: "barber", sign: hx("#e8e2d0"), letters: hx("#2a4f9a"), awnA: hx("#2a4f9a"), awnB: hx("#e8e2d0"), neon: null, goods: hx("#c8342a") },
  { name: "records", sign: hx("#2a2a2e"), letters: hx("#e0782a"), awnA: hx("#e0782a"), awnB: hx("#2a2a2e"), neon: EMISSIVE.neonCyan, goods: hx("#e0782a") },
  { name: "pharmacy", sign: hx("#e8e2d0"), letters: hx("#2f7a3a"), awnA: hx("#2f7a3a"), awnB: hx("#e8e2d0"), neon: null, goods: hx("#8ab0d0") },
  { name: "shoes", sign: hx("#6a3a2a"), letters: hx("#e8dcb0"), awnA: hx("#8a5a3a"), awnB: hx("#e8dcb0"), neon: null, goods: hx("#8a5a3a") },
  { name: "laundromat", sign: hx("#3a8ab0"), letters: hx("#f2efe6"), awnA: hx("#3a8ab0"), awnB: hx("#f2efe6"), neon: EMISSIVE.neonCyan, goods: hx("#d8dee2") },
];
const DINER: Trade = { name: "diner", sign: hx("#c8342a"), letters: hx("#f2efe6"), awnA: hx("#c8342a"), awnB: hx("#f2efe6"), neon: EMISSIVE.neonPink, goods: hx("#e8c070") };

const FACADES: readonly RGB[] = ["#a8513e", "#c4a27a", "#8e5a44", "#d8cbb0", "#b8b0a0", "#c9a888", "#9a6a58"].map(hx);
const ROOF = hx("#6a6560");

export function tradeOf(t: number): string {
  return TRADES[pixHash(t, 29, 503) % TRADES.length]!.name;
}

/** local (l, d) → screen for a frontage (0 S, 1 N, 2 E, 3 W). */
function toScreen(f: number, l: number, d: number): [number, number] {
  switch (f) {
    case 1: return [7 - l, 7 - d];
    case 2: return [d, 7 - l];
    case 3: return [7 - d, l];
    default: return [l, d];
  }
}

const isBuiltFront = (w: World, n: number): boolean =>
  n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Citizen && (w.lot[n] !== 0 || w.pop[n]! >= 3);

export function drawStorefront(w: World, t: number, x0: number, y0: number, put: Put, diner = false): void {
  const fr = frontageOf(w, t, false);
  const f = fr < 0 ? 0 : fr;
  const trade = diner ? DINER : TRADES[pixHash(t, 29, 503) % TRADES.length]!;
  const facade = diner ? hx("#d6d6dc") : FACADES[pixHash(t, 31, 503) % FACADES.length]!;
  const lit = isLitHour();
  const snow = RS.season === "winter";
  const P = (l: number, d: number, c: RGB): void => {
    const [sx, sy] = toScreen(f, l, d);
    put(x0 + sx, y0 + sy, c);
  };
  // lateral neighbours (along the frontage) for the party-wall seam
  const x = t % w.width;
  const lateralNeighbour = f <= 1 ? (f === 0 ? t - 1 : t + 1) : f === 2 ? t + w.width : t - w.width;
  const seamLeft = x > 0 && isBuiltFront(w, lateralNeighbour);
  const roof = snow ? hx("#e2e9ee") : ROOF;
  const southFacing = f === 0;
  // depth plan (S-facing): 0..2 roof · 3 cornice · 4 sign band · 5 awning · 6 windows+door
  // other frontages: 0..4 roof · 5 sign/cornice · 6 awning (seen from above)
  for (let d = 0; d <= 6; d++) {
    for (let l = 0; l < 8; l++) {
      let c: RGB;
      if (southFacing) {
        if (d <= 2) c = d === 0 ? shade(roof, 0.9) : (pixHash(t, l + d * 8, 505) % 7 === 0 ? shade(roof, 0.88) : roof);
        else if (d === 3) c = shade(facade, 1.12); // cornice / parapet cap
        else if (d === 4) c = (l >= 1 && l <= 6 && (l + (pixHash(t, 7, 503) & 1)) % 2 === 0) ? trade.letters : trade.sign;
        else if (d === 5) c = l % 2 === 0 ? trade.awnA : trade.awnB;
        else {
          // display windows + door (door on a hashed side)
          const doorL = pixHash(t, 9, 503) % 2 === 0 ? 1 : 6;
          if (l === doorL) c = diner ? hx("#8ab0c8") : C.door;
          else if (l === 0 || l === 7) c = facade;
          else if (lit) c = l % 3 === 0 ? trade.goods : C.windowLit;
          else c = l % 3 === 0 ? trade.goods : l % 3 === 1 ? C.windowDark : hx("#4a5a6a");
        }
      } else {
        if (d <= 4) c = pixHash(t, l + d * 8, 505) % 7 === 0 ? shade(roof, 0.88) : roof;
        else if (d === 5) c = (l + (pixHash(t, 7, 503) & 1)) % 2 === 0 ? trade.letters : trade.sign;
        else c = l % 2 === 0 ? trade.awnA : trade.awnB;
        // the N-facing shop shows its rear wall to the camera
        if (f === 1 && d === 0) c = l === 3 ? C.door : shade(facade, 0.85);
      }
      P(l, d, c);
    }
  }
  // party-wall seam on the shared side; the façade's own east edge shaded
  if (seamLeft) for (let d = 0; d <= 6; d++) P(0, d, shade(facade, 0.55));
  // rooftop HVAC / sign-back on some roofs
  if (pixHash(t, 11, 503) % 3 === 0) { P(2 + (pixHash(t, 12, 503) % 4), 1, hx("#9aa0a6")); }
  // NEON: after dark a bright tube traces the sign band
  if (lit && trade.neon) {
    const nd = southFacing ? 4 : 5;
    P(1, nd, trade.neon); P(6, nd, trade.neon);
    if (((RS.tick >> 4) + t) % 5 !== 0) P(3, nd, trade.neon); // one letter flickers
  }
  // N-facing: the camera sees the BACK wall — service door, AC unit, cans
  if (f === 1) {
    P(5, 0, hx("#9aa0a6")); // AC unit
    P(1, 0, hx("#3a4a3a")); // trash cans
    P(6, 0, hx("#6a6660")); // meters
  }
  // E/W-facing: the south face is a SIDE wall (end of the row only)
  if (f >= 2) {
    const southN = t + w.width;
    if (!isBuiltFront(w, southN)) {
      for (let d = 0; d <= 5; d++) {
        const [sx] = toScreen(f, 0, d);
        put(x0 + sx, y0 + 7, d % 3 === 1 ? C.windowDark : shade(facade, 0.9));
      }
    }
  }
  // barber pole by the door
  if (trade.name === "barber") { P(0, 6, hx("#c8342a")); }
  // sidewalk clutter at the curb (row 7 is the sidewalk): payphone,
  // newspaper boxes — never on every shop
  const clutter = pixHash(t, 13, 503) % 6;
  if (clutter === 0) { P(5, 7, hx("#9aa0a6")); P(6, 7, hx("#2a4f9a")); } // payphone booth
  else if (clutter === 1) { P(4, 7, hx("#c8342a")); P(5, 7, hx("#2a6ab0")); } // newspaper boxes
  void Lot;
}

/**
 * The BACK ROOM of a 1×2 Shop lot: the tile directly behind a storefront
 * (away from its street). The party walls run on through the depth; a
 * lower tar roof with a vent, a skylight and the AC, and — where the camera
 * sees it (street N: the back room's south wall is screen-south) — the
 * service door, trash cans and the electric meter on the back wall facing
 * the rear lot. `f` is the storefront's frontage, `front` its tile.
 */
export function drawBackRoom(w: World, t: number, front: number, f: number, x0: number, y0: number, put: Put): void {
  const facade = FACADES[pixHash(front, 31, 503) % FACADES.length]!;
  const snow = RS.season === "winter";
  const tar = snow ? hx("#dde4ea") : hx("#5f5a55");
  const P = (l: number, d: number, c: RGB): void => {
    const [sx, sy] = toScreen(f, l, d);
    put(x0 + sx, y0 + sy, c);
  };
  // lateral neighbour back rooms continue the party wall
  const lat = f <= 1 ? (f === 0 ? t - 1 : t + 1) : f === 2 ? t + w.width : t - w.width;
  const seam = lat >= 0 && lat < w.lot.length && w.lot[lat] === Lot.Shop;
  // local d: 7 = against the storefront, 0 = the rear lot line
  for (let d = 1; d <= 7; d++) {
    for (let l = 0; l < 8; l++) {
      let c: RGB;
      if (d === 1) c = shade(facade, 1.08); // parapet cap on the rear wall
      else if (d === 7) c = shade(tar, 0.8); // step down from the shop's roof
      else c = pixHash(t, l + d * 8, 509) % 9 === 0 ? shade(tar, 0.9) : tar;
      P(l, d, c);
    }
  }
  if (seam) for (let d = 1; d <= 7; d++) P(0, d, shade(facade, 0.55));
  // roof dressing: a vent stack + a skylight or an AC unit by hash
  const r = pixHash(t, 3, 509);
  P(2 + (r % 3), 3, hx("#9aa0a6"));
  if (r % 2) { P(5, 5, hx("#8ab0c8")); P(6, 5, hx("#8ab0c8")); }
  else { P(5, 4, hx("#b8bcc0")); P(6, 4, hx("#9aa0a6")); }
  // the back wall when it faces the camera (the rear lot is screen-south)
  if (f === 1) {
    for (let l = 0; l < 8; l++) P(l, 0, l === 3 ? C.door : l === 6 ? hx("#6a6660") : shade(facade, 0.85));
    P(1, 0, hx("#3a4a3a")); // trash cans
  } else {
    // otherwise a service door on the lot line (seen from above as a stoop)
    P(3, 0, hx("#8a857c"));
  }
}

/**
 * Which storefront a Shop tile belongs to: the tile itself when it touches
 * its street, or the street-touching Shop directly in front of it (the
 * tile is its back room). Returns [frontTile, frontage] or null.
 */
export function shopFrontOf(w: World, t: number): [number, number] | null {
  const f = frontageOf(w, t, false);
  if (f >= 0) return null; // a storefront itself
  const W = w.width;
  const x = t % W;
  // neighbour in front of us, and the frontage it must have for us to be its back
  const cands: [number, number][] = [
    [t + W, 0], // storefront to the S facing S
    [t - W, 1], // to the N facing N
    [x < W - 1 ? t + 1 : -1, 2], // to the E facing E
    [x > 0 ? t - 1 : -1, 3], // to the W facing W
  ];
  for (const [n, want] of cands) {
    if (n < 0 || n >= w.lot.length || w.lot[n] !== Lot.Shop) continue;
    if (frontageOf(w, n, false) === want) return [n, want];
  }
  return null;
}
