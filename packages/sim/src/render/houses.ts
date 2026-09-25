/**
 * Single-family houses, driveways and backyards (Stage 2).
 *
 * A house lot is one 8×8 tile. Every house is planned in a FRONTAGE-LOCAL
 * frame — lateral l (0..7) along the street, depth d (0..7) toward it, the
 * sidewalk occupying d = 7 — then mapped to the screen for whichever of
 * the four sides faces the street. The roof massing is drawn in screen
 * space so the 3/4 camera always shows the south wall face; ridges run
 * parallel to the street (gable-fronts perpendicular).
 *
 * Silhouettes: ranch (long, low hip) · split-level (two offset planes) ·
 * two-storey colonial · cape (steep gable + dormers) · foursquare/gable-
 * front with porch · desert adobe (flat roof, parapet, vigas). Siding and
 * roof palettes are chosen by hash in every district. Every fronting house
 * has a 2-px driveway to its street (the road tile cuts the curb to match —
 * see `curbCutAt`), a flagged mailbox, often a TV aerial, sometimes a
 * detached garage and/or a parked car from the 1980s fleet.
 */
import { Terrain, type World } from "../types.js";
import { hexToRgb, shade, type RGB } from "../palette.js";
import { RS, C, TILE_PX, pixHash, type Put } from "./core.js";
import { drawVehicle, householdVehicle, householdPaint, vehicleSize } from "./vehicles.js";
import { lotFrontage } from "./frontage.js";

const hx = hexToRgb;

/** 0 = S, 1 = N, 2 = E, 3 = W; -1 = no street frontage. */
export type Frontage = -1 | 0 | 1 | 2 | 3;

/** Street frontage of a 1-tile lot (priority rules in frontage.ts; houses hash ties). */
const FRONT_CACHE = new WeakMap<World, Int8Array>();
export function frontageOf(w: World, t: number, house = true): Frontage {
  // memoised per world (roads never change mid-match): [house, non-house]
  let c = FRONT_CACHE.get(w);
  if (!c) { c = new Int8Array(w.terrain.length * 2).fill(-2); FRONT_CACHE.set(w, c); }
  const k = t * 2 + (house ? 0 : 1);
  let v = c[k]!;
  if (v === -2) { v = lotFrontage(w, t % w.width, (t / w.width) | 0, 1, 1, house ? t : -1); c[k] = v; }
  return v as Frontage;
}

/** Districts whose pop≥3 plain lots are single-family houses. */
export function isHouseDistrict(d: number): boolean {
  return d === 0 || d === 1 || d === 2 || d === 4 || d === 8;
}

/** Is tile t drawn as a house (the renderer's rule, mirrored for curb cuts)? */
export function isHouseTile(w: World, t: number): boolean {
  if (w.terrain[t] !== Terrain.Citizen || w.lot[t] !== 0 || w.pop[t]! < 3) return false;
  const d = w.district[t]!;
  if (!isHouseDistrict(d)) return false;
  if (d === 8 && w.pop[t]! >= 8) return false; // ResHigh blocks
  if (d === 2 && pixHash(t, 3, 401) % 4 === 0) return false; // campus classroom block
  return true;
}

/** local (l, d) → screen offset inside the tile for a frontage. */
function toScreen(f: Frontage, l: number, d: number): [number, number] {
  switch (f) {
    case 1: return [7 - l, 7 - d];
    case 2: return [d, 7 - l];
    case 3: return [7 - d, l];
    default: return [l, d];
  }
}

/**
 * The drive runs on the local-left lot edge (lateral columns 0..1) for
 * every house, so along a street houses alternate house/drive/house and
 * never touch — the rhythm of a real platted block.
 */
export function driveLane(_t: number): number {
  return 0;
}

/** A second (static) family car sits in this drive; the commuter parks at the curb. */
export function hasParkedCar(t: number): boolean {
  return pixHash(t, 2, 401) % 3 === 0;
}

/**
 * Where the household's commuter car parks at home: in the drive (nose to
 * the street), or at the curb when the family wagon already fills it.
 * Returns a centre point + heading in the putCar convention.
 */
export function homeCarSpot(w: World, t: number): { px: number; py: number; dx: number; dy: number } | null {
  const f = frontageOf(w, t);
  if (f < 0) return null;
  const x0 = (t % w.width) * TILE_PX, y0 = ((t / w.width) | 0) * TILE_PX;
  const l0 = driveLane(t);
  if (hasParkedCar(t)) {
    // curb parking in the road's near lane, parallel to the street
    const [sx, sy] = toScreen(f, l0 === 0 ? 2 : 4, 9);
    const along = f <= 1 ? { dx: f === 0 ? 1 : -1, dy: 0 } : { dx: 0, dy: f === 2 ? 1 : -1 };
    return { px: x0 + sx, py: y0 + sy, ...along };
  }
  // drive, nose out: centre of the 2×3 footprint at depth 3..5
  const [ax, ay] = toScreen(f, l0, 5);
  const [bx, by] = toScreen(f, l0 + 1, 5);
  const px = Math.min(ax, bx), py = Math.min(ay, by);
  const out = f === 0 ? { dx: 0, dy: 1 } : f === 1 ? { dx: 0, dy: -1 } : f === 2 ? { dx: 1, dy: 0 } : { dx: -1, dy: 0 };
  return { px: x0 + px, py: y0 + py, ...out };
}

/**
 * Curb cut: for a road tile, which of its edge pixels a neighbouring
 * house's driveway crosses. Returns a 4-bit side mask per pixel index via
 * callback-free query: is road pixel (px, py) of tile `rt` a curb cut?
 */
export function curbCutAt(w: World, rt: number, px: number, py: number): boolean {
  const x = rt % w.width, y = (rt / w.width) | 0;
  // neighbour house above (it fronts S onto us), below (N), left (E), right (W)
  const check = (n: number, want: Frontage, lateralPx: number): boolean => {
    if (n < 0 || n >= w.terrain.length || !isHouseTile(w, n) || frontageOf(w, n) !== want) return false;
    const l0 = driveLane(n);
    // screen lateral px of the drive columns for that frontage
    const [ax, ay] = toScreen(want, l0, 7);
    const [bx, by] = toScreen(want, l0 + 1, 7);
    const lo = want <= 1 ? Math.min(ax, bx) : Math.min(ay, by);
    return lateralPx === lo || lateralPx === lo + 1;
  };
  if (py === 0 && y > 0 && check(rt - w.width, 0, px)) return true;
  if (py === TILE_PX - 1 && y < w.height - 1 && check(rt + w.width, 1, px)) return true;
  if (px === 0 && x > 0 && check(rt - 1, 2, py)) return true;
  if (px === TILE_PX - 1 && x < w.width - 1 && check(rt + 1, 3, py)) return true;
  return false;
}

// ------------------------------------------------------------ palettes

const SIDING: readonly RGB[] = [
  "#ece6d6", // white clapboard
  "#f0ebdf", // bright white
  "#e4d39a", // pale yellow
  "#b6c09a", // sage
  "#aec2d2", // powder blue
  "#8e6b4d", // brown / stained cedar
  "#cdb58f", // tan
  "#c9d3b1", // pale green
  "#b9b5aa", // dove grey
].map(hx);
const OLD_SIDING: readonly RGB[] = ["#9c4c3e", "#c8b8c6", "#ece6d6", "#b6c09a", "#e4d39a"].map(hx);
const ROOFS: readonly RGB[] = [
  "#5c5d62", // charcoal
  "#7a5642", // brown
  "#5e7052", // green
  "#9a4838", // red
  "#8c877e", // weathered grey
  "#a08c6c", // tan shingle
].map(hx);
const ADOBE_WALL: readonly RGB[] = ["#d4ae80", "#c79c6c", "#dfbd92"].map(hx);
const ADOBE_ROOF: readonly RGB[] = ["#b98e62", "#a87e55"].map(hx);
const DRIVE = hx("#b1aa9c");
const DRIVE_D = hx("#9d9688");

type Style = "ranch" | "split" | "colonial" | "cape" | "foursquare" | "adobe";

function styleFor(t: number, district: number, desert: boolean): Style {
  const r = pixHash(t, 34, 401) % 20;
  if (desert) return r < 14 ? "adobe" : "ranch";
  switch (district) {
    case 1: return r < 7 ? "ranch" : r < 13 ? "split" : r < 16 ? "colonial" : "cape";
    case 4: return r < 6 ? "colonial" : r < 12 ? "foursquare" : r < 17 ? "cape" : "ranch";
    case 2: return r < 6 ? "foursquare" : r < 12 ? "cape" : r < 17 ? "colonial" : "split";
    case 8: return r < 8 ? "colonial" : r < 14 ? "foursquare" : "split";
    default: return (["ranch", "split", "colonial", "cape", "foursquare"] as const)[r % 5]!;
  }
}

interface Mass {
  l0: number; l1: number; d0: number; d1: number;
  /** wall rows showing below the roof (the 3/4 south face) */
  wall: number;
  roof: "hip" | "gable" | "front" | "flat";
  tone: number; // roof shade multiplier
}

function massesFor(style: Style): Mass[] {
  // the house band is lateral 2..7 (the drive holds 0..1); depth 0..5,
  // front yard d=6, sidewalk d=7
  switch (style) {
    case "ranch": return [{ l0: 2, l1: 7, d0: 2, d1: 5, wall: 1, roof: "hip", tone: 1 }];
    case "split": return [
      { l0: 2, l1: 4, d0: 1, d1: 5, wall: 2, roof: "gable", tone: 1 },
      { l0: 5, l1: 7, d0: 2, d1: 5, wall: 1, roof: "gable", tone: 0.84 },
    ];
    case "colonial": return [{ l0: 2, l1: 6, d0: 0, d1: 5, wall: 2, roof: "gable", tone: 1 }];
    case "cape": return [{ l0: 2, l1: 7, d0: 1, d1: 5, wall: 1, roof: "gable", tone: 1 }];
    case "foursquare": return [{ l0: 3, l1: 7, d0: 0, d1: 5, wall: 2, roof: "front", tone: 1 }];
    case "adobe": return [
      { l0: 2, l1: 7, d0: 2, d1: 5, wall: 1, roof: "flat", tone: 1 },
      { l0: 5, l1: 7, d0: 0, d1: 2, wall: 0, roof: "flat", tone: 0.9 },
    ];
  }
}

// ------------------------------------------------------------ drawing

export function drawHouse(
  w: World,
  t: number,
  x0: number,
  y0: number,
  district: number,
  put: Put,
  frameTick: number,
): void {
  const fr = frontageOf(w, t);
  const f: Frontage = fr < 0 ? 0 : fr;
  const desert = w.biome[t] === 1;
  const style = styleFor(t, district, desert);
  const snow = RS.season === "winter";
  const night = RS.time === "night" || RS.time === "dusk";
  const P = (l: number, d: number, c: RGB): void => {
    const [sx, sy] = toScreen(f, l, d);
    put(x0 + sx, y0 + sy, c);
  };

  // palettes (every district gets the full variety)
  const siding = style === "adobe"
    ? ADOBE_WALL[pixHash(t, 2, 401) % ADOBE_WALL.length]!
    : district === 4 && pixHash(t, 9, 401) % 2 === 0
      ? OLD_SIDING[pixHash(t, 2, 401) % OLD_SIDING.length]!
      : SIDING[pixHash(t, 2, 401) % SIDING.length]!;
  const roofBase = style === "adobe" ? ADOBE_ROOF[pixHash(t, 3, 401) % 2]! : ROOFS[pixHash(t, 3, 401) % ROOFS.length]!;

  const l0 = driveLane(t);
  const hasFront = fr >= 0;

  // ---- driveway (+ over the sidewalk), before the house so eaves overlap
  if (hasFront) {
    for (let d = 1; d <= 7; d++) {
      for (let k = 0; k < 2; k++) {
        const stain = d === 4 && k === 1 && pixHash(t, 5, 401) % 2 === 0;
        P(l0 + k, d, d >= 7 ? DRIVE_D : stain ? shade(DRIVE, 0.85) : DRIVE);
      }
    }
  }

  // ---- detached / attached garage at the back of the drive
  const garage = hasFront ? pixHash(t, 7, 401) % 3 : 0; // 0 none · 1 garage · 2 carport-less
  if (garage === 1) {
    const gRoof = pixHash(t, 8, 401) % 2 === 0 ? roofBase : hx("#8c8a84");
    const gRoofC = snow ? hx("#e8eef2") : gRoof;
    for (let k = 0; k < 2; k++) {
      P(l0 + k, 0, shade(gRoofC, 1.08));
      P(l0 + k, 1, gRoofC);
    }
    // the roll door shows on the street face when that face is screen-south
    if (f === 0) { P(l0, 2, hx("#ddd6c6")); P(l0 + 1, 2, hx("#c8c0ae")); }
  }

  // ---- the house massing, drawn in screen space
  const masses = massesFor(style);
  let doorSX = -1, doorSY = -1; // screen px of the front door (S frontage)
  for (const m of masses) {
    const [ax, ay] = toScreen(f, m.l0, m.d0);
    const [bx, by] = toScreen(f, m.l1, m.d1);
    const sx0 = Math.min(ax, bx), sx1 = Math.max(ax, bx);
    const sy0 = Math.min(ay, by), sy1 = Math.max(ay, by);
    const wallY = sy1 - m.wall + 1; // first wall row
    const ridgeH = f === 0 || f === 1 ? m.roof !== "front" : m.roof === "front"; // ridge runs E–W on screen
    const roof = shade(roofBase, m.tone);
    const midY = (sy0 + wallY - 1) / 2;
    const midX = (sx0 + sx1) / 2;
    for (let y = sy0; y < wallY; y++) {
      for (let x = sx0; x <= sx1; x++) {
        let lit: number; // -1 shade · 0 flat · 1 lit · 2 ridge
        if (m.roof === "flat") {
          lit = x === sx0 || y === sy0 || x === sx1 || y === wallY - 1 ? 1 : 0; // parapet
        } else if (m.roof === "hip") {
          const k = y - sy0, kb = wallY - 1 - y;
          const hipW = x - sx0 < Math.min(k, kb) + 1 && sx1 - sx0 > 2;
          const hipE = sx1 - x < Math.min(k, kb) + 1 && sx1 - sx0 > 2;
          lit = hipW ? 1 : hipE ? -1 : y < midY ? 1 : y > midY ? -1 : 2;
        } else if (ridgeH) {
          lit = Math.abs(y - midY) < 0.5 ? 2 : y < midY ? 1 : -1;
        } else {
          lit = Math.abs(x - midX) < 0.5 ? 2 : x < midX ? 1 : -1;
        }
        let c: RGB;
        if (snow) c = lit === -1 ? hx("#c9d4dc") : lit === 0 ? hx("#e3eaef") : hx("#f2f6f8");
        else c = lit === 2 ? shade(roof, 1.22) : lit === 1 ? shade(roof, 1.1) : lit === -1 ? shade(roof, 0.84) : roof;
        put(x0 + x, y0 + y, c);
      }
    }
    // wall face rows
    for (let y = wallY; y <= sy1; y++) {
      for (let x = sx0; x <= sx1; x++) {
        let c = x === sx1 ? shade(siding, 0.86) : siding;
        if (y === wallY && m.wall >= 1 && style !== "adobe") c = shade(c, 0.92); // eave shadow line
        put(x0 + x, y0 + y, c);
      }
      // two windows per wall row (never the door column)
      if (sx1 - sx0 >= 2) {
        for (const x of sx1 - sx0 >= 4 ? [sx0 + 1, sx1 - 1] : [sx0 + 1]) {
          if (f === 0 && y === sy1 && x === ((sx0 + sx1) >> 1)) continue;
          const lit = night && pixHash(t, x * 8 + y, 403) % 3 !== 0;
          put(x0 + x, y0 + y, lit ? C.windowLit : C.windowDark);
        }
      }
    }
    // adobe vigas: dark beam-ends poking out under the parapet
    if (m.roof === "flat" && m.wall > 0) {
      for (let x = sx0; x <= sx1; x += 2) put(x0 + x, y0 + wallY, hx("#5a3e26"));
    }
    if (doorSX < 0 && m.wall > 0 && f === 0) {
      doorSX = (sx0 + sx1) >> 1;
      doorSY = sy1;
    }
    // cape dormers
    if (style === "cape" && ridgeH && !snow) {
      const dy = Math.floor(midY) + 1;
      if (dy < wallY) { put(x0 + sx0 + 1, y0 + dy, shade(siding, 0.95)); put(x0 + sx1 - 1, y0 + dy, shade(siding, 0.95)); }
    }
  }
  // front porch deck on the frontage side (whatever the orientation)
  const porch = hasFront && (style === "foursquare" || style === "cape");
  if (porch) {
    const p0 = style === "foursquare" ? 3 : 2; // porch spans the house band
    for (let l = p0; l <= 7; l++) P(l, 6, l === p0 || l === 7 ? siding : C.plank);
  }
  // door + stoop: the front door shows on the wall face only for S; other
  // frontages get a stoop on the street side of the massing
  if (f === 0 && doorSX >= 0) {
    put(x0 + doorSX, y0 + doorSY, C.door);
    if (!porch) put(x0 + doorSX, y0 + doorSY + 1, hx("#b8b0a2"));
  } else if (hasFront && !porch) {
    P(4, 6, hx("#b8b0a2"));
  }

  // ---- chimney (+ winter smoke), TV aerial on most roofs
  const main = masses[0]!;
  if (style !== "adobe") {
    const cl = pixHash(t, 11, 401) & 1 ? main.l0 : main.l1;
    const [cx, cy] = toScreen(f, cl, main.d0 + 1);
    const chim = hx("#7a4a3a");
    put(x0 + cx, y0 + cy, chim);
    drawSmoke(put, x0 + cx, y0 + cy - 1, t, frameTick);
    if (pixHash(t, 12, 401) % 5 < 3) {
      // TV aerial: a mast pixel + a crossbar, silvered
      const [ax2, ay2] = toScreen(f, cl === main.l0 ? main.l1 - 1 : main.l0 + 1, main.d0);
      put(x0 + ax2, y0 + ay2, hx("#a8aeb4"));
      put(x0 + ax2 + 1, y0 + ay2, hx("#8a9096"));
    }
  }

  // ---- mailbox with a flag at the curb (every fronting house)
  if (hasFront) {
    const ml = 2;
    const [mx, my] = toScreen(f, ml, 6);
    put(x0 + mx, y0 + my, hx("#6a6660")); // box on its post
    if (pixHash(t, 13, 401) % 5 === 0) {
      const [fx, fy] = toScreen(f, ml + 1, 6);
      put(x0 + fx, y0 + fy, hx("#c8352a")); // flag up: outgoing mail
    }
  }

  // ---- the family car in the drive (nose to the street)
  if (hasFront && hasParkedCar(t)) {
    const kind = householdVehicle(pixHash(t, 14, 401));
    const paint = householdPaint(pixHash(t, 15, 401));
    // nose toward the street at depth 5 (6 in front of a garage); longer
    // kinds (wagon / pickup / van: 4 px) reach further back up the drive
    const len = vehicleSize(kind, 0).w;
    const nose = garage === 1 ? 6 : 5;
    const [ax, ay] = toScreen(f, l0, nose - len + 1);
    const [bx, by] = toScreen(f, l0 + 1, nose);
    const dir = f === 0 ? 2 : f === 1 ? 3 : f === 2 ? 0 : 1;
    drawVehicle(put, kind, x0 + Math.min(ax, bx), y0 + Math.min(ay, by), dir, paint);
  }
}

/**
 * Chimney smoke: winter always (most chimneys), fall evenings sometimes.
 * lod ≥ 2 draws a rising, drifting 2–3 px puff; lod 1 a single pixel.
 */
export function drawSmoke(put: Put, x: number, y: number, t: number, tick: number): void {
  const burning = RS.season === "winter" ? pixHash(t, 6, 59) % 4 !== 0 : RS.season === "fall" && (RS.time === "dusk" || RS.time === "night") && pixHash(t, 6, 59) % 3 === 0;
  if (!burning) return;
  const phase = ((tick >> 2) + t * 3) % 12; // 0..11 rise cycle
  const puffA = hx("#a9a9a6"); // wood smoke reads grey against snowy roofs
  const puffB = hx("#8f908e");
  if (RS.lod < 2) {
    put(x + (phase > 6 ? 1 : 0), y - (phase >> 2), puffA);
    return;
  }
  // two puffs a half-cycle apart, each rising 4 px and drifting east
  for (const off of [0, 6]) {
    const ph = (phase + off) % 12;
    const rise = ph >> 1; // 0..5
    const px = x + (rise >> 1);
    const py = y - rise;
    const c = rise < 3 ? puffA : puffB;
    put(px, py, c);
    if (rise >= 1 && rise <= 4) put(px + 1, py, c);
    if (rise >= 2 && rise <= 3) put(px, py - 1, puffB);
  }
}

// ------------------------------------------------------------ backyards

/**
 * A block-interior backyard: fence on the property line, and by hash one
 * or two pieces of 80s yard life — shed, above-ground pool, swing set,
 * clothesline, garden plot, C-band satellite dish, doghouse, picnic table.
 * Ground is left to the caller (biome ground); no random speckle.
 */
/**
 * Which house owns a backyard tile: the nearest street-facing house whose
 * lot runs back to it (a house facing S owns the yard tiles north of it,
 * etc.). Property lines are drawn only between different owners — so a
 * block reads as a row of deep lots, not a dotted grid. Cached per world.
 */
const OWNER = new WeakMap<World, Int32Array>();
function yardOwner(w: World, t: number): number {
  let o = OWNER.get(w);
  if (!o) { o = new Int32Array(w.terrain.length).fill(-2); OWNER.set(w, o); }
  let v = o[t]!;
  if (v !== -2) return v;
  v = -1;
  const W = w.width, x = t % W, y = (t / W) | 0;
  let best = 99;
  // look toward each street: a house at distance k facing away from us
  const probes: [number, number, Frontage][] = [[0, 1, 0], [0, -1, 1], [1, 0, 2], [-1, 0, 3]];
  for (const [dx, dy, want] of probes) {
    for (let k = 1; k <= 3 && k < best; k++) {
      const xx = x + dx * k, yy = y + dy * k;
      if (xx < 0 || yy < 0 || xx >= W || yy >= w.height) break;
      const n = yy * W + xx;
      if (w.terrain[n] !== Terrain.Citizen) break;
      if (isHouseTile(w, n)) {
        if (frontageOf(w, n) === want) { best = k; v = n; }
        break;
      }
      if (w.lot[n] !== 0) break;
    }
  }
  o[t] = v;
  return v;
}

export function drawBackyard(w: World, t: number, tx: number, ty: number, x0: number, y0: number, put: Put): void {
  const winter = RS.season === "winter";
  const yardish = (n: number): boolean =>
    n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Citizen && w.lot[n] === 0 && !isHouseTile(w, n);
  const fence = hx(w.district[t] === 5 ? "#a8a49a" : "#a8977a"); // chain-link in the trailer fringe
  const post = shade(fence, 0.78);
  // PROPERTY LINES: a solid 1-px fence run on the N / W seam only where the
  // neighbouring yard belongs to a different house; a 2-px gate gap by hash
  const me = yardOwner(w, t);
  const gate = 2 + (pixHash(t, 9, 409) % 4);
  const hasGate = pixHash(t, 10, 409) % 3 === 0;
  if (ty > 0 && yardish(t - w.width) && yardOwner(w, t - w.width) !== me) {
    for (let x = 0; x < TILE_PX; x++) if (!hasGate || x < gate || x > gate + 1) put(x0 + x, y0, x % 4 === 0 ? post : fence);
  }
  if (tx > 0 && yardish(t - 1) && yardOwner(w, t - 1) !== me) {
    for (let y = 0; y < TILE_PX; y++) put(x0, y0 + y, y % 4 === 0 ? post : fence);
  }
  // fewer, clearer yard items: half the yards are plain mown lawn
  const roll = pixHash(t, 4, 409) % 24;
  const ox = x0 + 1 + (pixHash(t, 5, 409) % 2);
  const oy = y0 + 1 + (pixHash(t, 6, 409) % 2);
  const box = (x: number, y: number, ww: number, hh: number, c: RGB): void => {
    for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) put(x + i, y + j, c);
  };
  switch (roll) {
    case 0: case 1: {
      // garden shed: gambrel roof, door, shadow
      const roof = winter ? hx("#e6ecf0") : pixHash(t, 7, 409) % 2 ? hx("#8a3c32") : hx("#6a6a62");
      box(ox + 1, oy + 1, 3, 1, roof);
      box(ox + 1, oy + 2, 3, 1, shade(roof, 0.85));
      box(ox + 1, oy + 3, 3, 1, hx("#c8b89a"));
      put(ox + 2, oy + 3, C.door);
      box(ox + 2, oy + 4, 3, 1, C.shadow);
      break;
    }
    case 2: {
      // above-ground pool (round, 4×4 with a 2×2+ water face), winter tarp
      const water = winter ? hx("#6a7e8a") : hx("#5fb4d8");
      const rim = hx("#d8dcdc");
      box(ox + 1, oy + 1, 2, 1, rim); box(ox, oy + 2, 1, 2, rim); box(ox + 3, oy + 2, 1, 2, rim); box(ox + 1, oy + 4, 2, 1, hx("#a4aaac"));
      box(ox + 1, oy + 2, 2, 2, water);
      if (!winter) put(ox + 1, oy + 2, hx("#9fdcf0"));
      put(ox + 4, oy + 3, hx("#a4aaac")); // ladder
      break;
    }
    case 4: {
      // swing set: A-frame top bar, legs, two seats
      const steel = hx("#c05a3a");
      box(ox, oy + 1, 5, 1, steel);
      put(ox, oy + 2, steel); put(ox + 4, oy + 2, steel);
      put(ox + 1, oy + 3, hx("#3a3632")); put(ox + 3, oy + 3, hx("#3a3632"));
      put(ox + 2, oy + 4, C.dirt);
      break;
    }
    case 5: {
      // clothesline: two T-posts, laundry flapping on the tick
      const post = hx("#7e6244");
      put(ox, oy + 1, post); put(ox, oy + 2, post); put(ox + 5, oy + 1, post); put(ox + 5, oy + 2, post);
      if (!winter) {
        const flap = (RS.tick >> 4) & 1;
        put(ox + 1, oy + 1 + flap, hx("#f0ece0")); put(ox + 2, oy + 1, hx("#4a70a8"));
        put(ox + 3, oy + 1 + (1 - flap), hx("#c05048")); put(ox + 4, oy + 1, hx("#e8d27a"));
      } else for (let i = 1; i < 5; i++) put(ox + i, oy + 1, hx("#9a948a"));
      break;
    }
    case 3: case 6: case 7: {
      // vegetable garden plot: tilled rows (bare in winter/spring)
      const soil = hx("#6b523b");
      const leaf = RS.season === "summer" ? hx("#5f9a3a") : RS.season === "fall" ? hx("#a08a3a") : soil;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) put(ox + i, oy + j, winter ? hx("#d8dfe4") : j % 2 === 0 ? soil : leaf);
      break;
    }
    case 8: {
      // C-band satellite dish on its pole — the 1984 status symbol
      const dish = hx("#d8d8d2");
      box(ox + 1, oy, 3, 1, dish); box(ox, oy + 1, 5, 1, shade(dish, 0.9)); box(ox + 1, oy + 2, 3, 1, shade(dish, 0.75));
      put(ox + 2, oy + 1, hx("#6a6a66")); // feed horn
      put(ox + 2, oy + 3, hx("#5a5a58"));
      put(ox + 3, oy + 3, C.shadow);
      break;
    }
    case 9: {
      // doghouse + a picnic table
      put(ox, oy + 1, hx("#8a3c32")); put(ox + 1, oy + 1, hx("#8a3c32"));
      put(ox, oy + 2, hx("#b8946a")); put(ox + 1, oy + 2, hx("#3a2a20"));
      box(ox + 3, oy + 3, 3, 1, C.plank); put(ox + 3, oy + 4, C.plankDark); put(ox + 5, oy + 4, C.plankDark);
      break;
    }
    case 10: {
      // a big backyard shade tree + a sandbox
      const leaf = winter ? hx("#6a5a44") : RS.season === "fall" ? hx("#b06f33") : hx("#3f7a2c");
      box(ox + 1, oy, 3, 3, leaf); put(ox + 1, oy, shade(leaf, 1.2)); put(ox + 3, oy + 2, shade(leaf, 0.8));
      put(ox + 2, oy + 3, C.trunk); put(ox + 3, oy + 3, C.shadow);
      break;
    }
    case 11:
      // open lawn with a picnic table (or a snowman in winter)
      if (winter) { put(ox + 2, oy + 2, hx("#fafafa")); put(ox + 2, oy + 3, hx("#f0f0f4")); put(ox + 2, oy + 1, C.iconDark); put(ox + 3, oy + 2, hx("#c8352a")); }
      else { box(ox + 1, oy + 2, 3, 1, C.plank); put(ox + 1, oy + 3, C.plankDark); put(ox + 3, oy + 3, C.plankDark); }
      break;
    default:
      break; // plain mown back lawn
  }
}

// ------------------------------------------------------------ apartments

const APT_WALLS: readonly RGB[] = ["#9a5a44", "#b06a4c", "#8a4e3c", "#c8b89a", "#b8a888", "#a8a49a"].map(hx);
const APT_ROOFS: readonly RGB[] = ["#6a6660", "#5a5854", "#7a746a"].map(hx);

/**
 * ResHigh walk-up: a 2–3 storey brick / siding apartment block, one per
 * tile, with a flat parapet roof, rooftop HVAC, an exterior metal stair on
 * one end and a 1px side-yard gap so neighbouring buildings count apart.
 * Oriented to its street like the houses (3/4 camera shows the south face).
 */
export function drawApartment(w: World, t: number, x0: number, y0: number, put: Put): void {
  const fr = frontageOf(w, t, false);
  const f: Frontage = fr < 0 ? 0 : fr;
  const P = (l: number, d: number, c: RGB): void => {
    const [sx, sy] = toScreen(f, l, d);
    put(x0 + sx, y0 + sy, c);
  };
  const wall = APT_WALLS[pixHash(t, 2, 409) % APT_WALLS.length]!;
  const roof = RS.season === "winter" ? hx("#e2e9ee") : APT_ROOFS[pixHash(t, 3, 409) % APT_ROOFS.length]!;
  const storeys = 2 + (pixHash(t, 4, 409) % 2);
  const night = RS.time === "night" || RS.time === "dusk";
  // massing: lateral 1..7 (l=0 is the side-yard gap), depth 0..5
  const [ax, ay] = toScreen(f, 1, 0);
  const [bx, by] = toScreen(f, 7, 5);
  const sx0 = Math.min(ax, bx), sx1 = Math.max(ax, bx);
  const sy0 = Math.min(ay, by), sy1 = Math.max(ay, by);
  const wallRows = storeys === 3 ? 3 : 2;
  const wallY = Math.max(sy0 + 2, sy1 - wallRows + 1);
  for (let y = sy0; y < wallY; y++) {
    for (let x = sx0; x <= sx1; x++) {
      const edge = x === sx0 || x === sx1 || y === sy0 || y === wallY - 1;
      put(x0 + x, y0 + y, edge ? shade(roof, 1.25) : pixHash(t, x + y * 8, 411) % 6 === 0 ? shade(roof, 0.9) : roof);
    }
  }
  // rooftop HVAC box + a stair bulkhead
  put(x0 + sx0 + 2, y0 + sy0 + 1, hx("#b8bcc0"));
  if (wallY - sy0 > 3) put(x0 + sx1 - 2, y0 + sy0 + 2, shade(roof, 0.7));
  // brick south face: a window per bay per storey
  for (let y = wallY; y <= sy1; y++) {
    for (let x = sx0; x <= sx1; x++) {
      let c = x === sx1 ? shade(wall, 0.84) : wall;
      if ((x - sx0) % 2 === 1 && x < sx1) c = night && pixHash(t, x * 8 + y, 413) % 3 !== 0 ? C.windowLit : C.windowDark;
      put(x0 + x, y0 + y, c);
    }
  }
  // exterior metal stair zig-zagging down one end of the face
  const stairX = pixHash(t, 5, 409) & 1 ? sx0 : sx1;
  for (let y = wallY; y <= sy1; y++) put(x0 + stairX + ((y - wallY) & 1 ? 0 : 0), y0 + y, (y - wallY) % 2 === 0 ? hx("#3a3a3e") : hx("#6a6a70"));
  // entrance: a door + stoop on the street side
  if (f === 0) {
    const dx = (sx0 + sx1) >> 1;
    put(x0 + dx, y0 + sy1, C.door);
    put(x0 + dx, y0 + sy1 + 1, hx("#b8b0a2"));
  } else if (fr >= 0) {
    P(4, 6, hx("#b8b0a2"));
  }
  // the building's own outline: a shade seam along the gap side
  for (let d = 0; d <= 5; d++) P(0, d, shade(C.shadow, 0.9));
}
