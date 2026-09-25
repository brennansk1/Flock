/**
 * Town plan v3 (Stage 2 placement grammar). Passes that turn the platted
 * grid into a readable 1980s town: the Courthouse Square, the high-school
 * campus at the edge of town, solid Main Street frontage, and residential
 * frontage (every street-facing lot a house, interiors backyards).
 *
 * All passes are pure functions of (world, rng): seeded rng only, integer
 * math. Footprints come from footprints.ts (1 tile ≈ 15 m).
 */
import { nextRange, type RngState } from "./rng.js";
import { Lot, Terrain, type World } from "./types.js";
import { footprintOf } from "./footprints.js";

/** District ids (mirrors mapgen.Districts; kept local to avoid an import cycle). */
const D = { Suburbs: 1, College: 2, Downtown: 3, OldTown: 4, Trailer: 5, Commercial: 6, Industrial: 7, ResHigh: 8 } as const;

export const RESIDENTIAL_DISTRICTS: ReadonlySet<number> = new Set([D.Suburbs, D.College, D.OldTown, D.Trailer, D.ResHigh]);

export interface PlanTown {
  cx: number;
  cy: number;
  r: number;
  highwayY: number;
  highwayX: number;
}

const isWay = (w: World, t: number): boolean =>
  t >= 0 && t < w.terrain.length && (w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Dirt);

/** Orthogonal neighbours inside the map (no row wrap). */
export function neighbors4(w: World, t: number): number[] {
  const x = t % w.width;
  const y = (t / w.width) | 0;
  const out: number[] = [];
  if (x > 0) out.push(t - 1);
  if (x < w.width - 1) out.push(t + 1);
  if (y > 0) out.push(t - w.width);
  if (y < w.height - 1) out.push(t + w.width);
  return out;
}

/** A tile touching a Road or Dirt lane orthogonally — it has street frontage. */
export function fronts(w: World, t: number): boolean {
  for (const n of neighbors4(w, t)) if (isWay(w, n)) return true;
  return false;
}

/** Connected Citizen block containing `t` (4-connected, bounded by anything else). */
function blockOf(w: World, t: number, seen: Uint8Array): number[] {
  const out: number[] = [];
  const stack = [t];
  seen[t] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    out.push(c);
    for (const n of neighbors4(w, c)) {
      if (seen[n] || w.terrain[n] !== Terrain.Citizen) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return out;
}

export interface SquareInfo {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * COURTHOUSE SQUARE: the rectangular downtown block nearest the Main St ×
 * county-route crossing becomes the square — the courthouse (3×3, or 3×2 on
 * a shallow block) centred on a lawn filling the whole block. Runs before
 * any other building is stamped, so nothing else can claim the block.
 */
export function platCourthouseSquare(w: World, town: PlanTown): SquareInfo | null {
  const { width } = w;
  const seen = new Uint8Array(w.terrain.length);
  let best: SquareInfo | null = null;
  let bestScore = Infinity;
  const reach = Math.max(8, ((town.r * 6) / 10) | 0);
  for (let y = Math.max(1, town.highwayY - reach); y <= Math.min(w.height - 2, town.highwayY + reach); y++) {
    for (let x = Math.max(1, town.highwayX - reach); x <= Math.min(width - 2, town.highwayX + reach); x++) {
      const t = y * width + x;
      if (seen[t] || w.terrain[t] !== Terrain.Citizen) continue;
      const blk = blockOf(w, t, seen);
      let x0 = width, y0 = w.height, x1 = -1, y1 = -1;
      let free = true;
      for (const b of blk) {
        const bx = b % width;
        const by = (b / width) | 0;
        if (bx < x0) x0 = bx;
        if (bx > x1) x1 = bx;
        if (by < y0) y0 = by;
        if (by > y1) y1 = by;
        if (w.lot[b] !== 0 || w.landmark[b] !== 0) free = false;
      }
      const bw = x1 - x0 + 1;
      const bh = y1 - y0 + 1;
      // a true rectangular city block, big enough for the courthouse + lawn
      if (!free || blk.length !== bw * bh || bw < 3 || bh < 3 || bw > 7 || bh > 7) continue;
      let ringed = true; // a real square is bounded by street on every side
      for (let xx = x0; xx <= x1 && ringed; xx++) {
        if (!isWay(w, (y0 - 1) * width + xx) || !isWay(w, (y1 + 1) * width + xx)) ringed = false;
      }
      for (let yy = y0; yy <= y1 && ringed; yy++) {
        if (!isWay(w, yy * width + x0 - 1) || !isWay(w, yy * width + x1 + 1)) ringed = false;
      }
      if (!ringed) continue;
      const mx = (x0 + x1) >> 1;
      const my = (y0 + y1) >> 1;
      const dx = mx - town.highwayX;
      const dy = my - town.highwayY;
      // prefer the block on Main St, square-ish, near the crossing
      const score = dx * dx + dy * dy * 2 + Math.abs(bw - bh) * 6 - (bw >= 4 && bh >= 4 ? 20 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { x0, y0, x1, y1 };
      }
    }
  }
  if (!best) return null;
  const bw = best.x1 - best.x0 + 1;
  const bh = best.y1 - best.y0 + 1;
  for (let y = best.y0; y <= best.y1; y++) {
    for (let x = best.x0; x <= best.x1; x++) {
      const t = y * width + x;
      w.lot[t] = Lot.Park;
      w.district[t] = D.Downtown;
      w.pop[t] = 1;
    }
  }
  const fp = footprintOf(Lot.Courthouse);
  const cw = fp.w;
  const ch = bh >= fp.h ? fp.h : fp.alt!.h;
  const cx0 = best.x0 + ((bw - cw) >> 1);
  const cy0 = best.y0 + ((bh - ch) >> 1);
  for (let y = cy0; y < cy0 + ch; y++) {
    for (let x = cx0; x < cx0 + cw; x++) {
      w.lot[y * width + x] = Lot.Courthouse;
      w.pop[y * width + x] = 5; // county clerks, judges, the sheriff's deputies
    }
  }
  return best;
}

/** Centre tile of the courthouse (TownHall landmark anchor), or -1. */
export function courthouseCentre(w: World): number {
  let sx = 0, sy = 0, n = 0;
  for (let t = 0; t < w.lot.length; t++) {
    if (w.lot[t] !== Lot.Courthouse) continue;
    sx += t % w.width;
    sy += (t / w.width) | 0;
    n++;
  }
  if (n === 0) return -1;
  const t = Math.round(sy / n) * w.width + Math.round(sx / n);
  return w.lot[t] === Lot.Courthouse ? t : -1;
}

/**
 * HIGH-SCHOOL CAMPUS on the edge of town: a superblock of open country
 * fronting a town street — the school (3×2) and its bus lot (2×1) on the
 * street, the stadium (Track 6×4: field + track + bleachers) behind them.
 * Kept ≥ 6 tiles from the industrial quarter. Returns false if no site fits
 * (the caller falls back to an in-town parcel).
 */
export function placeHighSchoolCampus(w: World, rng: RngState, town: PlanTown): boolean {
  const { width, height } = w;
  const hs = footprintOf(Lot.HighSchool);
  const trk = footprintOf(Lot.Track);
  const pk = footprintOf(Lot.Parking);
  // campus layout in "street-up" local coords: row 0 touches the street
  const variants: { tw: number; th: number }[] = [{ tw: trk.w, th: trk.h }];
  if (trk.alt) variants.push({ tw: trk.alt.w, th: trk.alt.h });
  // open country, or the fringe lots of a residential quarter (the campus
  // is the edge of town — it may take a few yards on the way)
  const FRINGE: ReadonlySet<number> = new Set([D.Suburbs, D.College, D.Trailer, D.OldTown]);
  const open = (t: number): boolean => {
    if (w.landmark[t] !== 0) return false;
    const tr = w.terrain[t];
    if (tr === Terrain.Grass || tr === Terrain.Field || tr === Terrain.Orchard || tr === Terrain.Pasture) return true;
    return tr === Terrain.Citizen && w.lot[t] === 0 && FRINGE.has(w.district[t]!);
  };
  const candidates: { t0: number; dir: number; score: number; tw: number; th: number }[] = [];
  const r2lo = (((town.r * 55) / 100) | 0) ** 2;
  const r2hi = (((town.r * 140) / 100) | 0) ** 2;
  for (const { tw, th } of variants) {
    const depth = hs.h + th; // school row(s) + stadium behind
    const span = Math.max(tw, hs.w + pk.w);
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const road = y * width + x;
        if (w.terrain[road] !== Terrain.Road) continue;
        const ddx = x - town.cx;
        const ddy = y - town.cy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < r2lo || d2 > r2hi) continue;
        // dir: 0 = campus north of the road, 1 = south, 2 = west, 3 = east
        for (let dir = 0; dir < 4; dir++) {
          const vertical = dir < 2;
          const sgn = dir === 0 || dir === 2 ? -1 : 1;
          let ok = true;
          const tiles: number[] = [];
          for (let a = 0; a < span && ok; a++) {
            // the frontage run must be street all along
            const rx = vertical ? x + a : x;
            const ry = vertical ? y : y + a;
            if (rx >= width - 1 || ry >= height - 1 || w.terrain[ry * width + rx] !== Terrain.Road) ok = false;
            for (let b = 1; b <= depth && ok; b++) {
              const cx = vertical ? rx : x + sgn * b;
              const cy = vertical ? y + sgn * b : ry;
              if (cx < 1 || cy < 1 || cx >= width - 1 || cy >= height - 1) { ok = false; break; }
              const t = cy * width + cx;
              if (!open(t)) ok = false;
              tiles.push(t);
            }
          }
          if (!ok) continue;
          // an EDGE-of-town campus: it may take a few fringe yards, but the
          // fewer homes it displaces the better (and it must touch town)
          let taken = 0;
          for (const t of tiles) if (w.terrain[t] === Terrain.Citizen) taken++;
          let touches = taken > 0;
          for (let a = 0; a < span && !touches; a++) {
            const fx = vertical ? x + a : x - sgn;
            const fy = vertical ? y - sgn : y + a;
            if (fx >= 0 && fy >= 0 && fx < width && fy < height && w.terrain[fy * width + fx] === Terrain.Citizen) touches = true;
          }
          if (!touches || taken * 2 > tiles.length) continue;
          // zoning buffer + no water right against the campus
          for (const t of tiles) {
            const tx = t % width;
            const ty = (t / width) | 0;
            for (let oy = -6; oy <= 6 && ok; oy++) {
              for (let ox = -6; ox <= 6 && ok; ox++) {
                const nx = tx + ox;
                const ny = ty + oy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                const n = ny * width + nx;
                if (w.terrain[n] === Terrain.Citizen && w.district[n] === D.Industrial) ok = false;
                if (w.lot[n] === Lot.Factory || w.lot[n] === Lot.Warehouse) ok = false;
                if (Math.abs(ox) <= 1 && Math.abs(oy) <= 1 && w.terrain[n] === Terrain.Lake) ok = false;
              }
            }
            if (!ok) break;
          }
          if (!ok) continue;
          // closer to town is better; a little rng breaks ties between sides
          candidates.push({ t0: road, dir, score: d2 + taken * 6 + nextRange(rng, 16), tw, th });
        }
      }
    }
    if (candidates.length) break; // full-size stadium fits somewhere — don't downsize
  }
  if (!candidates.length) return false;
  candidates.sort((a, b) => a.score - b.score || a.t0 - b.t0 || a.dir - b.dir);
  const c = candidates[0]!;
  const x = c.t0 % width;
  const y = (c.t0 / width) | 0;
  const vertical = c.dir < 2;
  const sgn = c.dir === 0 || c.dir === 2 ? -1 : 1;
  const put = (a: number, b: number, lot: number, pop: number): void => {
    const tx = vertical ? x + a : x + sgn * b;
    const ty = vertical ? y + sgn * b : y + a;
    const t = ty * width + tx;
    w.terrain[t] = Terrain.Citizen;
    w.district[t] = D.College;
    w.lot[t] = lot;
    w.pop[t] = pop;
  };
  const span = Math.max(c.tw, hs.w + pk.w);
  // front rows: school + bus lot, lawn on any leftover frontage
  for (let a = 0; a < span; a++) {
    for (let b = 1; b <= hs.h; b++) {
      if (a < hs.w) put(a, b, Lot.HighSchool, 6);
      else if (a < hs.w + pk.w && b === 1) put(a, b, Lot.Parking, 0);
      else put(a, b, Lot.Park, 1);
    }
  }
  // back rows: the stadium
  for (let a = 0; a < span; a++) {
    for (let b = hs.h + 1; b <= hs.h + c.th; b++) put(a, b, a < c.tw ? Lot.Track : Lot.Park, 1);
  }
  return true;
}

/**
 * MAIN STREET & SQUARE FRONTAGE (after keystones): every open lot facing the
 * highway through Downtown/Commercial, or facing the Courthouse Square across
 * its street, is a storefront; open Downtown/Commercial interiors are rear
 * parking lots. The party-wall strip reads as one continuous Main Street.
 */
export function platMainStreet(
  w: World,
  rng: RngState,
  square: SquareInfo | null,
  isHighway: (t: number) => boolean,
): void {
  const { width } = w;
  const inSquare = (t: number): boolean => {
    if (!square) return false;
    const x = t % width;
    const y = (t / width) | 0;
    return x >= square.x0 && x <= square.x1 && y >= square.y0 && y <= square.y1;
  };
  const facesSquare = (t: number): boolean => {
    if (!square) return false;
    const x = t % width;
    const y = (t / width) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      // across one street (1–2 road rows) sits the square
      for (let s = 1; s <= 3; s++) {
        const nx = x + dx * s;
        const ny = y + dy * s;
        if (nx < 0 || ny < 0 || nx >= width || ny >= w.height) break;
        const n = ny * width + nx;
        if (inSquare(n)) {
          if (s > 1) return true;
          break;
        }
        if (w.terrain[n] !== Terrain.Road) break;
      }
    }
    return false;
  };
  // storefronts are 1 lot wide, 2 deep (footprints.ts): sales floor + back room
  for (let t = 0; t < w.terrain.length; t++) {
    if (w.terrain[t] !== Terrain.Citizen || w.lot[t] !== 0 || w.landmark[t] !== 0) continue;
    const d = w.district[t]!;
    const core = d === D.Downtown || d === D.Commercial;
    let onMain = false;
    if (core) for (const n of neighbors4(w, t)) if (w.terrain[n] === Terrain.Road && isHighway(n)) onMain = true;
    if (onMain || facesSquare(t)) {
      w.lot[t] = Lot.Shop;
      w.district[t] = core ? d : D.Downtown;
      w.pop[t] = 4 + nextRange(rng, 3);
      // the back room: the lot directly behind, away from the street
      for (const n of neighbors4(w, t)) {
        if (!isWay(w, n)) continue;
        const r = t + (t - n);
        if (r < 0 || r >= w.terrain.length || Math.abs((r % width) - (t % width)) > 1) continue;
        if (w.terrain[r] === Terrain.Citizen && w.lot[r] === 0 && w.landmark[r] === 0 && !fronts(w, r)) {
          w.lot[r] = Lot.Shop;
          w.district[r] = w.district[t]!;
          w.pop[r] = w.pop[t]!;
        }
        break;
      }
    } else if (core && !fronts(w, t)) {
      w.lot[t] = Lot.Parking; // municipal / rear lot behind the storefronts
      w.pop[t] = 0;
    }
  }
  platParking(w, rng);
}

/**
 * PARKING (Stage 2): a 1980s town is built around the car. Beyond the rear
 * lots behind Main St (above):
 *  - every strip business on the Commercial highway (and every standalone
 *    civic/industrial anchor) without an adjacent lot gets one next door;
 *  - apartment blocks (ResHigh) park out back: interior lots become the
 *    tenants' lot where they touch a street-facing building;
 * Only open lots (no building, no house) are ever paved.
 */
export function platParking(w: World, rng: RngState): void {
  const { width } = w;
  const NEEDS: ReadonlySet<number> = new Set([
    Lot.Shop, Lot.Diner, Lot.Motel, Lot.Cinema, Lot.Bank, Lot.PostOffice, Lot.Office, Lot.Supermarket,
    Lot.Factory, Lot.Warehouse, Lot.Library, Lot.Church, Lot.FireStation, Lot.Sheriff, Lot.School, Lot.Courthouse,
  ]);
  const open = (t: number): boolean =>
    w.terrain[t] === Terrain.Citizen && w.lot[t] === 0 && w.landmark[t] === 0 && w.pop[t]! < 3;
  const hasLotNear = (t: number, r: number): boolean => {
    const x = t % width;
    const y = (t / width) | 0;
    for (let oy = -r; oy <= r; oy++)
      for (let ox = -r; ox <= r; ox++) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= w.height) continue;
        if (w.lot[ny * width + nx] === Lot.Parking) return true;
      }
    return false;
  };
  // commercial blocks pave their interior: where most of a block's street
  // frontage is storefronts, everything behind them is the shared lot
  const SHOPFRONT: ReadonlySet<number> = new Set([
    Lot.Shop, Lot.Diner, Lot.Bank, Lot.PostOffice, Lot.Office, Lot.Cinema, Lot.Supermarket, Lot.Motel,
    Lot.Sheriff, Lot.FireStation, Lot.GasStation, Lot.Parking,
  ]);
  const seen = new Uint8Array(w.terrain.length);
  for (let t = 0; t < w.terrain.length; t++) {
    if (seen[t] || w.terrain[t] !== Terrain.Citizen) continue;
    const blk = blockOf(w, t, seen);
    if (blk.length > 64) continue; // not a city block (fringe / country)
    let front = 0;
    let shops = 0;
    for (const b of blk) {
      if (!fronts(w, b)) continue;
      front++;
      if (SHOPFRONT.has(w.lot[b]!)) shops++;
    }
    if (front === 0 || shops * 5 < front * 2) continue; // < 40% commercial frontage
    for (const b of blk) {
      if (fronts(w, b) || w.lot[b] !== 0 || w.landmark[b] !== 0) continue;
      w.lot[b] = Lot.Parking;
      w.pop[b] = 0;
    }
  }
  // and every storefront row gets its rear lot: the open interior tile
  // directly behind a shop (opposite its street) is paved for deliveries
  // and staff — the "behind Main St" lot every 1980s downtown had
  for (let t = 0; t < w.terrain.length; t++) {
    if (w.terrain[t] !== Terrain.Citizen || !SHOPFRONT.has(w.lot[t]!) || w.lot[t] === Lot.Parking) continue;
    const x = t % width;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const sx = x - dx;
      const sy = ((t / width) | 0) - dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= w.height || !isWay(w, sy * width + sx)) continue;
      // street on the (−dx,−dy) side → the rear is (+dx,+dy)
      const rx = x + dx;
      const ry = ((t / width) | 0) + dy;
      if (rx < 0 || ry < 0 || rx >= width || ry >= w.height) continue;
      const r = ry * width + rx;
      if (w.terrain[r] === Terrain.Citizen && w.lot[r] === 0 && w.landmark[r] === 0 && !fronts(w, r)) {
        w.lot[r] = Lot.Parking;
        w.pop[r] = 0;
      }
    }
  }
  for (let t = 0; t < w.terrain.length; t++) {
    if (w.terrain[t] !== Terrain.Citizen) continue;
    const d = w.district[t]!;
    const lot = w.lot[t]!;
    // commercial strip / anchors: customer lot beside the building
    if (NEEDS.has(lot) && d !== D.Downtown && !hasLotNear(t, 2)) {
      for (const n of neighbors4(w, t)) {
        if (open(n) || (w.terrain[n] === Terrain.Citizen && w.lot[n] === 0 && w.landmark[n] === 0 && d === D.Commercial)) {
          w.lot[n] = Lot.Parking;
          w.pop[n] = 0;
          break;
        }
      }
    }
    // apartments park out back: interior (non-frontage) ResHigh lots
    if (d === D.ResHigh && lot === 0 && !fronts(w, t) && nextRange(rng, 100) < 60) {
      w.lot[t] = Lot.Parking;
      w.pop[t] = 0;
    }
  }
  // every lot needs a way in: a landlocked lot paves one open neighbouring
  // lot that touches a street — its driveway (unreachable lots get pruned)
  const done = new Uint8Array(w.terrain.length);
  for (let t = 0; t < w.terrain.length; t++) {
    if (done[t] || w.lot[t] !== Lot.Parking) continue;
    const comp: number[] = [];
    const st = [t];
    done[t] = 1;
    while (st.length) {
      const c = st.pop()!;
      comp.push(c);
      for (const n of neighbors4(w, c)) {
        if (!done[n] && w.lot[n] === Lot.Parking) {
          done[n] = 1;
          st.push(n);
        }
      }
    }
    if (comp.some((c) => fronts(w, c))) continue;
    let paved = false;
    for (const c of comp) {
      for (const n of neighbors4(w, c)) {
        if (w.terrain[n] === Terrain.Citizen && w.lot[n] === 0 && w.landmark[n] === 0 && fronts(w, n)) {
          w.lot[n] = Lot.Parking;
          w.pop[n] = 0;
          done[n] = 1;
          paved = true;
          break;
        }
      }
      if (paved) break;
    }
  }
}

/** Lots that live out in the open country (may grow over grass/farmland). */
const RURAL: ReadonlySet<number> = new Set([
  Lot.Barn, Lot.Silo, Lot.Greenhouse, Lot.Lighthouse, Lot.Cannery, Lot.Sawmill, Lot.WaterTower,
  Lot.Substation, Lot.GrainElevator, Lot.Depot, Lot.RadioTower, Lot.Fairground, Lot.Megachurch,
  Lot.GasStation, Lot.Motel, Lot.Diner, Lot.Factory, Lot.Warehouse,
  Lot.Church, Lot.Chapel, Lot.School, // country churches and schools stand on open ground
]);
const OPEN_GROUND: ReadonlySet<number> = new Set([Terrain.Grass, Terrain.Field, Terrain.Orchard, Terrain.Pasture]);

/** Works that stand at the water's edge by trade (exempt from the setback). */
const WATERSIDE: ReadonlySet<number> = new Set([Lot.Dock, Lot.Depot, Lot.Lighthouse, Lot.Cannery, Lot.Sawmill, Lot.Dam]);

/** Footprint orientations to try, biggest first: w×h, h×w, alt, alt rotated. */
function shapes(lot: number): [number, number][] {
  const fp = footprintOf(lot as Lot);
  const out: [number, number][] = [[fp.w, fp.h], [fp.h, fp.w]];
  if (fp.alt) out.push([fp.alt.w, fp.alt.h], [fp.alt.h, fp.alt.w]);
  return out;
}

/**
 * FOOTPRINT ENFORCEMENT (Stage 2 scale): every building occupies its real
 * footprint (footprints.ts). A lot stamped smaller (legacy 1×1 placements,
 * fallbacks, farm buildings, shore works) grows into adjacent open lots —
 * town yards/houses for town lots, open ground for rural ones — to the
 * largest footprint (or its alt) that fits around it and still touches a
 * street or lane. Growth never takes another building, a landmark, water,
 * rock or a road.
 */
export function enforceFootprints(w: World, relocate = false): void {
  const { width, height } = w;
  if (width < 48 || height < 48) return; // micro test grids keep legacy 1-tile lots
  const seen = new Uint8Array(w.terrain.length);
  for (let t0 = 0; t0 < w.terrain.length; t0++) {
    const lot = w.lot[t0]!;
    if (seen[t0] || lot === 0 || lot === Lot.Parking || lot === Lot.Park || lot === Lot.Dock || lot === Lot.Dam) continue;
    // the component of this lot
    const comp: number[] = [];
    const st = [t0];
    seen[t0] = 1;
    while (st.length) {
      const c = st.pop()!;
      comp.push(c);
      for (const n of neighbors4(w, c)) if (!seen[n] && w.lot[n] === lot) { seen[n] = 1; st.push(n); }
    }
    const opts = shapes(lot);
    const minArea = Math.min(...opts.map(([a, b]) => a * b));
    if (comp.length >= minArea) continue;
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (const c of comp) {
      const x = c % width;
      const y = (c / width) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const rural = RURAL.has(lot);
    // a bigger building may take yards and houses, a parking lot, or a
    // couple of storefronts (never another institution, never the square)
    const YIELDS: ReadonlySet<number> = new Set([0, Lot.Parking, Lot.Shop]);
    const waterside = WATERSIDE.has(lot);
    const claim = (t: number): boolean => {
      if (w.lot[t] === lot) return true;
      if (w.landmark[t] !== 0) return false;
      if (!waterside) for (const n of neighbors4(w, t)) if (w.terrain[n] === Terrain.Lake) return false; // setback
      if (w.terrain[t] === Terrain.Citizen) return YIELDS.has(w.lot[t]!) && (lot !== Lot.Shop || w.lot[t] === 0);
      return rural && (OPEN_GROUND.has(w.terrain[t]!) || w.terrain[t] === Terrain.Woods) && w.landmark[t] === 0; // rural works clear a few trees
    };
    let grown = false;
    for (const [fw, fh] of opts) {
      if (fw * fh <= comp.length) break;
      // every placement of an fw×fh rect that contains the component's bbox
      for (let ry = y1 - fh + 1; ry <= y0 && !grown; ry++) {
        for (let rx = x1 - fw + 1; rx <= x0 && !grown; rx++) {
          if (rx < 1 || ry < 1 || rx + fw >= width || ry + fh >= height) continue;
          let ok = true;
          let street = false;
          for (let dy = 0; dy < fh && ok; dy++)
            for (let dx = 0; dx < fw && ok; dx++) {
              const t = (ry + dy) * width + rx + dx;
              if (!claim(t)) ok = false;
              else if (fronts(w, t)) street = true;
            }
          if (!ok || (!street && !rural)) continue;
          const pop = w.pop[t0]!;
          const district = w.district[t0]!;
          for (let dy = 0; dy < fh; dy++)
            for (let dx = 0; dx < fw; dx++) {
              const t = (ry + dy) * width + rx + dx;
              if (w.lot[t] === lot) continue;
              w.terrain[t] = Terrain.Citizen;
              w.lot[t] = lot;
              w.district[t] = district;
              w.pop[t] = Math.max(1, pop);
              seen[t] = 1;
            }
          grown = true;
        }
      }
      if (grown) break;
    }
    if (!grown && relocate) relocateBuilding(w, lot, comp, claim, rural);
  }
}

/** Lots the town can do without a duplicate of (dropped if no site fits). */
const EXPENDABLE: ReadonlySet<number> = new Set([
  Lot.GasStation, Lot.Motel, Lot.Warehouse, Lot.Office, Lot.Diner, Lot.Greenhouse, Lot.Silo, Lot.Barn, Lot.Substation,
]);

/**
 * A building with no room to reach its footprint moves: the nearest site
 * (spiral out to 24 tiles) where the full footprint (or alt) fits on
 * claimable ground and touches a street. Its old tiles revert to yards. A
 * duplicate of an expendable kind with no site anywhere is dropped.
 */
function relocateBuilding(w: World, lot: number, comp: number[], claim: (t: number) => boolean, rural: boolean): void {
  const { width, height } = w;
  const cx = comp[0]! % width;
  const cy = (comp[0]! / width) | 0;
  const pop = w.pop[comp[0]!]!;
  const district = w.district[comp[0]!]!;
  const clear = (): void => {
    for (const c of comp) {
      w.lot[c] = 0;
      w.pop[c] = 2;
    }
  };
  for (const [fw, fh] of shapes(lot)) {
    for (let r = 1; r <= 24; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const rx = cx + dx;
          const ry = cy + dy;
          if (rx < 2 || ry < 2 || rx + fw >= width - 2 || ry + fh >= height - 2) continue;
          let ok = true;
          let street = false;
          for (let yy = ry; yy < ry + fh && ok; yy++)
            for (let xx = rx; xx < rx + fw && ok; xx++) {
              const t = yy * width + xx;
              if (w.lot[t] === lot || !claim(t) || (!rural && w.terrain[t] !== Terrain.Citizen)) ok = false;
              else if (fronts(w, t)) street = true;
            }
          if (!ok || !street) continue;
          clear();
          for (let yy = ry; yy < ry + fh; yy++)
            for (let xx = rx; xx < rx + fw; xx++) {
              const t = yy * width + xx;
              w.terrain[t] = Terrain.Citizen;
              w.lot[t] = lot;
              w.pop[t] = Math.max(1, pop);
              w.district[t] = district;
            }
          return;
        }
      }
    }
  }
  if (EXPENDABLE.has(lot)) {
    let others = 0;
    for (let t = 0; t < w.lot.length; t++) if (w.lot[t] === lot) others++;
    if (others > comp.length) clear();
  }
}

/**
 * LANDMARK COMPOUNDS (Stage 2): the Megachurch, Fairground, Radio Tower and
 * the town's landmark Water Tower are real multi-tile compounds. The
 * compound's lot covers its footprint; the Landmark id stays on ONE anchor
 * tile at its heart (ownership rules are unchanged). Searches outward from
 * (ax, ay) for a site; returns the anchor tile or -1.
 */
export function placeLandmarkCompound(
  w: World,
  landmark: number,
  lot: number,
  ax: number,
  ay: number,
  inTown: boolean,
  pop: number,
): number {
  const { width, height } = w;
  const ok = (t: number): boolean => {
    if (w.landmark[t] !== 0 || w.lot[t] !== 0) return false;
    const tr = w.terrain[t];
    if (inTown && tr === Terrain.Citizen) return w.district[t] !== D.Downtown && w.pop[t]! < 16;
    return OPEN_GROUND.has(tr!);
  };
  for (const [fw, fh] of shapes(lot)) {
    for (let r = 0; r < Math.max(width, height) / 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const rx = ax + dx - (fw >> 1);
          const ry = ay + dy - (fh >> 1);
          if (rx < 2 || ry < 2 || rx + fw >= width - 2 || ry + fh >= height - 2) continue;
          let good = true;
          let street = false;
          let wet = false;
          for (let yy = ry - 1; yy <= ry + fh && good; yy++)
            for (let xx = rx - 1; xx <= rx + fw && good; xx++) {
              const t = yy * width + xx;
              const inside = xx >= rx && xx < rx + fw && yy >= ry && yy < ry + fh;
              if (inside) { if (!ok(t)) good = false; }
              else {
                if (w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Dirt) street = true;
                if (w.terrain[t] === Terrain.Lake || w.terrain[t] === Terrain.Rock) wet = true;
              }
            }
          if (!good || wet || (inTown && !street)) continue;
          for (let yy = ry; yy < ry + fh; yy++)
            for (let xx = rx; xx < rx + fw; xx++) {
              const t = yy * width + xx;
              w.terrain[t] = Terrain.Citizen;
              w.lot[t] = lot;
              w.pop[t] = pop;
              if (!inTown || w.district[t] === 0) w.district[t] = inTown ? D.Suburbs : D.Trailer;
            }
          const anchor = (ry + (fh >> 1)) * width + rx + (fw >> 1);
          w.landmark[anchor] = landmark;
          return anchor;
        }
      }
    }
  }
  return -1;
}

/** Institutions that must have a parking lot directly beside them. */
const NEEDS_LOT: ReadonlySet<number> = new Set([
  Lot.Supermarket, Lot.School, Lot.HighSchool, Lot.Sheriff, Lot.Cinema, Lot.FireStation, Lot.Factory,
  Lot.Church, Lot.Bank, Lot.Diner, Lot.Warehouse, Lot.Library, Lot.Chapel,
]);

/**
 * Last word on parking: every institution touches a lot of its own. One
 * without paves an adjacent open lot (preferring one on a street), so the
 * lot is where the building's visitors actually park.
 */
export function ensureAdjacentParking(w: World): void {
  const seen = new Uint8Array(w.lot.length);
  for (let t0 = 0; t0 < w.lot.length; t0++) {
    const lot = w.lot[t0]!;
    if (seen[t0] || !NEEDS_LOT.has(lot)) continue;
    const comp: number[] = [];
    const st = [t0];
    seen[t0] = 1;
    while (st.length) {
      const c = st.pop()!;
      comp.push(c);
      for (const n of neighbors4(w, c)) if (!seen[n] && w.lot[n] === lot) { seen[n] = 1; st.push(n); }
    }
    let has = false;
    let best = -1;
    let bestStreet = false;
    for (const c of comp)
      for (const n of neighbors4(w, c)) {
        if (w.lot[n] === Lot.Parking) has = true;
        if (w.terrain[n] === Terrain.Citizen && w.lot[n] === 0 && w.landmark[n] === 0) {
          const street = fronts(w, n);
          if (best < 0 || (street && !bestStreet)) { best = n; bestStreet = street; }
        }
      }
    if (has || best < 0 || !bestStreet) continue; // a lot needs a curb cut onto a street
    w.lot[best] = Lot.Parking;
    w.pop[best] = 0;
  }
}

/** A parking lot no street reaches is just a yard: drop landlocked remnants. */
export function pruneLandlockedParking(w: World): void {
  const seen = new Uint8Array(w.lot.length);
  for (let t0 = 0; t0 < w.lot.length; t0++) {
    if (seen[t0] || w.lot[t0] !== Lot.Parking) continue;
    const comp: number[] = [];
    const st = [t0];
    seen[t0] = 1;
    while (st.length) {
      const c = st.pop()!;
      comp.push(c);
      for (const n of neighbors4(w, c)) if (!seen[n] && w.lot[n] === Lot.Parking) { seen[n] = 1; st.push(n); }
    }
    // a curb cut onto a paved street (an alley alone isn't access)
    if (comp.some((c) => neighbors4(w, c).some((n) => w.terrain[n] === Terrain.Road))) continue;
    for (const c of comp) { w.lot[c] = 0; w.pop[c] = 1; }
  }
}
