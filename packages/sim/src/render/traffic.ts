/**
 * Ambient town traffic (Stage 2), all a pure function of (world, tick):
 *  - THROUGH TRAFFIC on the long streets (the highway / Main Street): out-
 *    of-towners and locals passing through, dense at the morning and
 *    evening rush, thin at night. Each car's lap is hash-gated at the
 *    density of the moment it entered the map, so nobody pops mid-street.
 *  - the SHERIFF's cruisers: one parked on the apron (bubble light
 *    flashing through a call window and after dark), one on patrol.
 *  - the SCHOOL BUS: parked in the campus bus lot, hazards blinking while
 *    kids load at the start and end of the school day, running its route
 *    through the neighbourhoods in between.
 *  - BMX KIDS riding the streets after school and into the evening.
 * Presentation only; never touches sim state.
 */
import { Terrain, Lot, type World } from "../types.js";
import type { RGB } from "../palette.js";
import { TILE_PX, pixHash, type Put } from "./core.js";
import { drawVehicle, householdVehicle, householdPaint, vehicleSize, type VehicleKind } from "./vehicles.js";
import { isHouseTile } from "./houses.js";

export interface Leg { x0: number; y0: number; x1: number; y1: number; len: number; onRoad: boolean }
export interface RouteKit {
  build: (w: World, fromT: number, toT: number, fx: number, fy: number, tx: number, ty: number) => Leg[];
  point: (legs: Leg[], d: number, driving: boolean) => { px: number; py: number };
  len: (legs: Leg[]) => number;
}

const DAY = 2400;

interface Plan {
  through: Array<{ axis: 0 | 1; at: number; from: number; to: number; double: boolean }>;
  sheriff: number; // anchor tile of the first Sheriff lot, -1 none
  busLot: number; // parking tile nearest the high school, -1 none
  school: number;
  houses: number[]; // house tiles (for bus stops / BMX errands)
}
const PLANS = new WeakMap<World, Plan>();
const ROUTES = new WeakMap<World, Map<number, Leg[]>>();

function planFor(w: World): Plan {
  let p = PLANS.get(w);
  if (p) return p;
  const road = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w.width && y < w.height && w.terrain[y * w.width + x] === Terrain.Road;
  const through: Plan["through"] = [];
  const seen = new Set<string>();
  for (const st of w.streets ?? []) {
    const span = st.to - st.from + 1;
    const dim = st.axis === 0 ? w.width : w.height;
    if (span < dim * 0.5) continue;
    const key = `${st.axis}:${st.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mid = (st.from + st.to) >> 1;
    const double = st.axis === 0 ? road(mid, st.at + 1) && road(mid, st.at) : road(st.at + 1, mid) && road(st.at, mid);
    through.push({ axis: st.axis, at: st.at, from: st.from, to: st.to, double });
  }
  let sheriff = -1, school = -1;
  const houses: number[] = [];
  for (let t = 0; t < w.lot.length; t++) {
    if (sheriff < 0 && w.lot[t] === Lot.Sheriff) sheriff = t;
    if (school < 0 && w.lot[t] === Lot.HighSchool) school = t;
    if (isHouseTile(w, t)) houses.push(t);
  }
  if (school < 0) for (let t = 0; t < w.lot.length && school < 0; t++) if (w.lot[t] === Lot.School) school = t;
  let busLot = -1;
  if (school >= 0) {
    const sx = school % w.width, sy = (school / w.width) | 0;
    let best = 1e9;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 8; dx++) {
      const x = sx + dx, y = sy + dy;
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
      const t = y * w.width + x;
      if (w.lot[t] !== Lot.Parking) continue;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; busLot = t; }
    }
  }
  p = { through, sheriff, busLot, school, houses };
  PLANS.set(w, p);
  return p;
}

function route(kit: RouteKit, w: World, a: number, b: number, ax: number, ay: number, bx: number, by: number): Leg[] {
  let m = ROUTES.get(w);
  if (!m) { m = new Map(); ROUTES.set(w, m); }
  const key = a * 1_000_003 + b;
  let r = m.get(key);
  if (!r) { r = kit.build(w, a, b, ax, ay, bx, by); m.set(key, r); }
  return r;
}

/** through-traffic density (cars per ~tile of lane) by time of day */
function density(day: number): number {
  if (day < 200) return 0.03; // small hours
  if (day < 700) return 0.32; // morning rush
  if (day < 1350) return 0.1; // midday
  if (day < 1850) return 0.34; // evening rush
  if (day < 2150) return 0.08;
  return 0.03;
}

/** heading + box for a centre point, then draw */
function drawAt(put: Put, kind: VehicleKind, px: number, py: number, hdx: number, hdy: number, paint: RGB, tick: number, hazards = false): void {
  const dir = hdy === 0 ? (hdx >= 0 ? 0 : 1) : hdy > 0 ? 2 : 3;
  const { w, h } = vehicleSize(kind, dir);
  drawVehicle(put, kind, px - (w >> 1), py - (h >> 1), dir, paint, tick, hazards);
}

export function drawAmbientTraffic(w: World, tick: number, fog: Uint8Array | null, put: Put, kit: RouteKit): void {
  const plan = planFor(w);
  const visible = (px: number, py: number): boolean => {
    const tx = (px / TILE_PX) | 0, ty = (py / TILE_PX) | 0;
    if (tx < 0 || ty < 0 || tx >= w.width || ty >= w.height) return false;
    return !fog || fog[ty * w.width + tx] === 1;
  };
  const onRoad = (px: number, py: number): boolean => {
    const tx = (px / TILE_PX) | 0, ty = (py / TILE_PX) | 0;
    return tx >= 0 && ty >= 0 && tx < w.width && ty < w.height && w.terrain[ty * w.width + tx] === Terrain.Road;
  };
  const day = tick % DAY;

  // ---- through traffic --------------------------------------------------
  const SPEED = 2.5; // px / tick
  const PITCH = 20; // px between potential cars in a lane
  for (let si = 0; si < plan.through.length; si++) {
    const st = plan.through[si]!;
    const lenPx = (st.to - st.from + 1) * TILE_PX;
    const slots = Math.ceil(lenPx / PITCH);
    for (let dirI = 0; dirI < 2; dirI++) {
      const fwd = dirI === 0; // east / south
      for (let k = 0; k < slots; k++) {
        const s = tick * SPEED + k * PITCH + si * 7 + dirI * 11;
        const lap = Math.floor(s / lenPx);
        const along = s - lap * lenPx;
        // the lap's density = the density when this car entered the map
        const enteredDay = (((tick - Math.floor(along / SPEED)) % DAY) + DAY) % DAY;
        const hsh = pixHash(k, lap, 601 + si * 13 + dirI);
        if ((hsh % 1000) / 1000 >= density(enteredDay) * (PITCH / TILE_PX) * 0.5) continue;
        const pos = fwd ? along : lenPx - 1 - along;
        // lane: the double highway splits directions by row; a plain
        // street keeps to the right half of its single row
        let px: number, py: number;
        const inner = hsh % 3 !== 0;
        if (st.axis === 0) {
          px = st.from * TILE_PX + pos;
          const row = st.double ? (fwd ? st.at + 1 : st.at) : st.at;
          py = row * TILE_PX + (st.double ? (fwd ? (inner ? 2 : 5) : (inner ? 5 : 2)) : fwd ? 5 : 2);
        } else {
          py = st.from * TILE_PX + pos;
          const col = st.double ? (fwd ? st.at : st.at + 1) : st.at;
          px = col * TILE_PX + (st.double ? (fwd ? (inner ? 5 : 2) : (inner ? 2 : 5)) : fwd ? 2 : 5);
        }
        if (!onRoad(px, py) || !visible(px, py)) continue;
        const kind = householdVehicle(hsh);
        const hdx = st.axis === 0 ? (fwd ? 1 : -1) : 0;
        const hdy = st.axis === 1 ? (fwd ? 1 : -1) : 0;
        drawAt(put, kind, px, py, hdx, hdy, householdPaint(hsh >>> 3), tick);
      }
    }
  }

  // ---- sheriff's cruisers -------------------------------------------------
  if (plan.sheriff >= 0) {
    const sx = plan.sheriff % w.width, sy = (plan.sheriff / w.width) | 0;
    // anchor the lot rectangle
    let ax = sx; while (ax > 0 && w.lot[sy * w.width + ax - 1] === Lot.Sheriff) ax--;
    const apX = ax * TILE_PX + 3, apY = sy * TILE_PX + 5;
    const call = (day >= 1000 && day < 1150) || day >= 2000 || day < 150;
    if (visible(apX, apY)) drawAt(put, "cruiser", apX + 1, apY, 1, 0, [30, 29, 28], call ? tick : -1);
    // the patrol car: a loop from the station to a hashed house and back,
    // a fresh destination every patrol
    if (plan.houses.length > 0) {
      const PATROL = 700;
      const lapN = Math.floor(tick / PATROL);
      const ph = tick - lapN * PATROL;
      const dest = plan.houses[pixHash(lapN, 3, 607) % plan.houses.length]!;
      const legs = route(kit, w, plan.sheriff, dest, apX, apY, (dest % w.width) * TILE_PX + 4, ((dest / w.width) | 0) * TILE_PX + 4);
      const L = kit.len(legs);
      if (L > 0) {
        const dist = (ph * 2.2) % (2 * L);
        const d = dist < L ? dist : 2 * L - dist;
        const back = dist >= L;
        const pt = kit.point(legs, d, true);
        const ah = kit.point(legs, Math.min(L, d + 2), true);
        let hdx = Math.sign(ah.px - pt.px), hdy = Math.sign(ah.py - pt.py);
        if (back) { hdx = -hdx; hdy = -hdy; }
        if (hdx === 0 && hdy === 0) hdx = 1;
        if (onRoad(pt.px, pt.py) && visible(pt.px, pt.py)) drawAt(put, "cruiser", pt.px, pt.py, hdx, hdy, [30, 29, 28], tick);
      }
    }
  }

  // ---- the school bus -----------------------------------------------------
  if (plan.busLot >= 0) {
    const bx = (plan.busLot % w.width) * TILE_PX + 5, by = ((plan.busLot / w.width) | 0) * TILE_PX + 3;
    const MORNING0 = 260, MORNING1 = 600, AFTER0 = 1300, AFTER1 = 1640;
    const onRoute = (day >= MORNING0 && day < MORNING1) || (day >= AFTER0 && day < AFTER1);
    const loading = (day >= MORNING1 && day < MORNING1 + 80) || (day >= AFTER0 - 80 && day < AFTER0);
    if (!onRoute) {
      if (visible(bx, by)) drawAt(put, "bus", bx + 1, by, 1, 0, [232, 176, 32], tick, loading);
    } else if (plan.houses.length > 0) {
      const t0 = day < MORNING1 ? MORNING0 : AFTER0;
      const ph = day - t0;
      const stop = plan.houses[pixHash(Math.floor(tick / DAY), t0, 611) % plan.houses.length]!;
      const legs = route(kit, w, plan.busLot, stop, bx, by, (stop % w.width) * TILE_PX + 4, ((stop / w.width) | 0) * TILE_PX + 4);
      const L = kit.len(legs);
      if (L > 0) {
        const span = MORNING1 - MORNING0;
        // out, a stop with hazards at the far end, and back
        const tOut = span * 0.45;
        let d: number, back = false, stopped = false;
        if (ph < tOut) d = (ph / tOut) * L;
        else if (ph < span * 0.55) { d = L; stopped = true; }
        else { d = (1 - (ph - span * 0.55) / (span * 0.45)) * L; back = true; }
        const pt = kit.point(legs, d, true);
        const ah = kit.point(legs, Math.min(L, d + 2), true);
        let hdx = Math.sign(ah.px - pt.px), hdy = Math.sign(ah.py - pt.py);
        if (back || stopped) { hdx = -hdx; hdy = -hdy; }
        if (hdx === 0 && hdy === 0) hdx = 1;
        if (visible(pt.px, pt.py)) drawAt(put, "bus", pt.px, pt.py, hdx, hdy, [232, 176, 32], tick, stopped);
      }
    }
  }

  // ---- BMX kids after school ------------------------------------------------
  if (day >= 1300 && day < 1950 && plan.houses.length > 8) {
    const kids = Math.min(14, plan.houses.length >> 4);
    for (let k = 0; k < kids; k++) {
      const a = plan.houses[pixHash(k, 1, 613) % plan.houses.length]!;
      const b = plan.houses[pixHash(k, 2, 613) % plan.houses.length]!;
      if (a === b) continue;
      const legs = route(kit, w, a, b, (a % w.width) * TILE_PX + 3, ((a / w.width) | 0) * TILE_PX + 6, (b % w.width) * TILE_PX + 3, ((b / w.width) | 0) * TILE_PX + 6);
      const L = kit.len(legs);
      if (L <= 0) continue;
      const dist = ((day - 1300 + pixHash(k, 3, 613) % 200) * 1.4) % (2 * L);
      const d = dist < L ? dist : 2 * L - dist;
      const pt = kit.point(legs, d, false);
      const ah = kit.point(legs, Math.min(L, d + 2), false);
      let hdx = Math.sign(ah.px - pt.px), hdy = Math.sign(ah.py - pt.py);
      if (dist >= L) { hdx = -hdx; hdy = -hdy; }
      if (!visible(pt.px, pt.py)) continue;
      const shirt: RGB = [[200, 60, 50], [60, 110, 190], [230, 190, 60], [70, 150, 80], [230, 230, 220]][pixHash(k, 4, 613) % 5] as RGB;
      if (hdx === 0 && hdy === 0) hdx = 1;
      const dir = hdy === 0 ? (hdx >= 0 ? 0 : 1) : hdy > 0 ? 2 : 3;
      drawVehicle(put, "bmx", pt.px, pt.py, dir, shirt);
    }
  }
}
