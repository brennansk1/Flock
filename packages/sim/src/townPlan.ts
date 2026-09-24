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
  const SHOPS = [Lot.Shop, Lot.Shop, Lot.Shop, Lot.Shop, Lot.Diner, Lot.Shop, Lot.Shop, Lot.PostOffice];
  for (let t = 0; t < w.terrain.length; t++) {
    if (w.terrain[t] !== Terrain.Citizen || w.lot[t] !== 0 || w.landmark[t] !== 0) continue;
    const d = w.district[t]!;
    const core = d === D.Downtown || d === D.Commercial;
    let onMain = false;
    if (core) for (const n of neighbors4(w, t)) if (w.terrain[n] === Terrain.Road && isHighway(n)) onMain = true;
    if (onMain || facesSquare(t)) {
      w.lot[t] = SHOPS[nextRange(rng, SHOPS.length)]!;
      w.district[t] = core ? d : D.Downtown;
      w.pop[t] = 4 + nextRange(rng, 3);
    } else if (core && d === D.Downtown && !fronts(w, t)) {
      w.lot[t] = Lot.Parking; // rear lot behind the storefronts
      w.pop[t] = 0;
    }
  }
}
