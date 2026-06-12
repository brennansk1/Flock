/**
 * Map generation (§2) — Mundane Falls, an actual small American town.
 *
 * Layout: open country (grass, fields, woods stands, a lake) with a HIGHWAY
 * running the full width of the map, a second route crossing it, and a
 * compact TOWN at the junction — a street grid of house lots with a dense
 * downtown core, old town and college quarters, suburb rings, and a trailer
 * fringe. Farmsteads dot the outskirts, each with crop fields and a dirt
 * lane to the highway.
 *
 * People live on Citizen lots (town + farms); everything else is wilderness —
 * unconvertible, but buildable: cults raise their compounds out there and the
 * sim auto-carves dirt access roads to them (OpenFront-style) when they go up.
 *
 * Population is the substrate: the conversion bar, domination, and follower
 * flow count residents. Deterministic from seed via the sim's xoshiro RNG.
 */

import { fromInt, fromFloat } from "./fixed.js";
import { seedRng, nextRange, type RngState } from "./rng.js";
import { Terrain, Landmark, Lot, type World, type DistrictCoeffs } from "./types.js";
import { createWorld } from "./sim.js";

/** District ids (index into districtCoeffs). 0 = unzoned (terrain). */
export const Districts = {
  None: 0,
  Suburbs: 1,
  College: 2,
  Downtown: 3,
  OldTown: 4,
  Trailer: 5,
} as const;

/** Authoritative coefficient table (§2). */
export function districtCoeffTable(): DistrictCoeffs[] {
  const row = (conv: number, retain: number, income: number): DistrictCoeffs => ({
    conv: fromFloat(conv),
    retain: fromFloat(retain),
    income: fromFloat(income),
  });
  return [
    row(1.0, 1.0, 1.0), // None (terrain never converts anyway)
    row(1.0, 1.2, 1.0), // Suburbs
    row(1.6, 0.6, 0.7), // College Campus
    row(0.9, 1.0, 1.5), // Downtown/Strip
    row(0.5, 1.6, 1.3), // Old Town
    row(1.3, 0.9, 0.6), // Trailer/Outskirts
  ];
}

/** Household size ranges per district: [min, max] residents on a populated lot. */
const POP_RANGE: Record<number, [number, number]> = {
  [Districts.None]: [0, 0],
  [Districts.Suburbs]: [3, 6],
  [Districts.College]: [4, 9],
  [Districts.Downtown]: [6, 12],
  [Districts.OldTown]: [2, 5],
  [Districts.Trailer]: [1, 4],
};

/** Chance (in %) that a town lot is an empty yard/garden (low pop). */
const YARD_CHANCE: Record<number, number> = {
  [Districts.None]: 100,
  [Districts.Suburbs]: 28,
  [Districts.College]: 16,
  [Districts.Downtown]: 8,
  [Districts.OldTown]: 40,
  [Districts.Trailer]: 50,
};

export function generateWorld(seed: number, width: number, height: number): World {
  const rng = seedRng(seed ^ 0x6d61_7067); // "mapg"
  const w = createWorld(width, height);
  w.districtCoeffs = districtCoeffTable();

  // the whole map starts as open country
  w.terrain.fill(Terrain.Grass);

  const town = layoutHighwaysAndTown(w, rng);
  layoutFarms(w, rng, town);
  placeNature(w, rng, town);
  placeTownBuildings(w, rng, town);
  placeLandmarks(w, town);
  rollLots(w, rng);
  return w;
}

/**
 * The town's own institutions, zoned by district and sized realistically —
 * some span multiple tiles. Downtown gets the commercial strip (shops,
 * supermarket, diner, offices, the sheriff), College gets the school and
 * library, Old Town gets the chapel, the highway gets gas stations, farms get
 * barns and silos, and every quarter keeps a pocket park.
 */
function placeTownBuildings(w: World, rng: RngState, town: TownShape): void {
  const width = w.width;

  /** stamp a wLots×hLots building if every covered tile is a citizen lot in `district` */
  const stamp = (
    lotKind: number,
    wLots: number,
    hLots: number,
    district: number,
    workers: number,
    tries = 60,
  ): boolean => {
    for (let attempt = 0; attempt < tries; attempt++) {
      const x = town.cx - town.r + nextRange(rng, town.r * 2);
      const y = town.cy - town.r + nextRange(rng, town.r * 2);
      let ok = true;
      for (let dy = 0; dy < hLots && ok; dy++) {
        for (let dx = 0; dx < wLots && ok; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= w.height) ok = false;
          else {
            const t = yy * width + xx;
            if (w.terrain[t] !== Terrain.Citizen || w.district[t] !== district || w.lot[t] !== 0)
              ok = false;
          }
        }
      }
      // commercial frontage: must touch a road
      if (ok) {
        let frontage = false;
        for (let dx = 0; dx < wLots && !frontage; dx++) {
          const below = (y + hLots) * width + x + dx;
          const above = (y - 1) * width + x + dx;
          if (y + hLots < w.height && w.terrain[below] === Terrain.Road) frontage = true;
          if (y - 1 >= 0 && w.terrain[above] === Terrain.Road) frontage = true;
        }
        if (!frontage) ok = false;
      }
      if (!ok) continue;
      for (let dy = 0; dy < hLots; dy++) {
        for (let dx = 0; dx < wLots; dx++) {
          const t = (y + dy) * width + x + dx;
          w.lot[t] = lotKind;
          w.pop[t] = Math.min(15, Math.max(2, Math.floor(workers / (wLots * hLots))));
        }
      }
      return true;
    }
    return false;
  };

  const D = Districts;
  // Downtown commercial strip
  stamp(Lot.Supermarket, 2, 1, D.Downtown, 10);
  stamp(Lot.Office, 2, 2, D.Downtown, 16);
  stamp(Lot.Diner, 1, 1, D.Downtown, 6);
  stamp(Lot.Sheriff, 1, 1, D.Downtown, 5);
  for (let i = 0; i < 6; i++) stamp(Lot.Shop, 1, 1, D.Downtown, 4 + nextRange(rng, 3));
  // College quarter
  stamp(Lot.School, 2, 2, D.College, 14);
  stamp(Lot.Library, 1, 1, D.College, 5);
  stamp(Lot.Shop, 1, 1, D.College, 4);
  // Old Town
  stamp(Lot.Chapel, 1, 1, D.OldTown, 4);
  stamp(Lot.Diner, 1, 1, D.OldTown, 5);
  // Suburbs: corner shops + parks
  stamp(Lot.Shop, 1, 1, D.Suburbs, 4);
  stamp(Lot.Shop, 1, 1, D.Suburbs, 4);
  stamp(Lot.Park, 2, 2, D.Suburbs, 1, 80);
  stamp(Lot.Park, 1, 1, D.College, 1);
  // Trailer fringe
  stamp(Lot.GasStation, 1, 1, D.Trailer, 3);

  // gas stations along the highway, outside town
  let placedGas = 0;
  for (let attempt = 0; attempt < 200 && placedGas < 2; attempt++) {
    const x = nextRange(rng, width);
    const y = town.highwayY + (nextRange(rng, 2) === 0 ? -1 : 2);
    if (y < 0 || y >= w.height) continue;
    const ddx = x - town.cx;
    const ddy = y - town.cy;
    if (ddx * ddx + ddy * ddy < (town.r + 6) * (town.r + 6)) continue;
    const t = y * width + x;
    if (w.terrain[t] !== Terrain.Grass) continue;
    w.terrain[t] = Terrain.Citizen;
    w.district[t] = Districts.Trailer;
    w.lot[t] = Lot.GasStation;
    w.pop[t] = 3;
    placedGas++;
  }

  // barns + silos at farmsteads (next to existing farm houses)
  for (let t = 0; t < w.terrain.length; t++) {
    if (w.terrain[t] !== Terrain.Citizen || w.district[t] !== Districts.Trailer) continue;
    const x = t % width;
    const y = (t / width) | 0;
    const ddx = x - town.cx;
    const ddy = y - town.cy;
    if (ddx * ddx + ddy * ddy < (town.r + 4) * (town.r + 4)) continue; // farms only
    if (nextRange(rng, 4) !== 0) continue;
    // try to grow a barn (and maybe silo) on adjacent grass
    const spots = [t + 1, t - 1, t + width, t - width];
    for (const n of spots) {
      if (n < 0 || n >= w.terrain.length) continue;
      if (w.terrain[n] === Terrain.Grass && w.lot[n] === 0) {
        w.terrain[n] = Terrain.Citizen;
        w.district[n] = Districts.Trailer;
        w.lot[n] = nextRange(rng, 3) === 0 ? Lot.Silo : Lot.Barn;
        w.pop[n] = 1 + nextRange(rng, 2);
        break;
      }
    }
  }
}

interface TownShape {
  cx: number;
  cy: number;
  r: number;
  highwayY: number;
  highwayX: number;
}

/**
 * The highway runs the full width with gentle jogs; a county route crosses it.
 * The town grows at the junction: a street grid only inside the town radius,
 * zoned downtown core → quarters → suburb ring → trailer fringe.
 */
function layoutHighwaysAndTown(w: World, rng: RngState): TownShape {
  const { width, height } = w;
  const cx = (width >> 1) + nextRange(rng, 9) - 4;
  const cy = (height >> 1) + nextRange(rng, 9) - 4;
  const r = Math.max(14, Math.floor(Math.min(width, height) * 0.24));

  // HIGHWAY (2 lanes wide, west–east, jogging every ~16 tiles)
  let hy = cy + nextRange(rng, 7) - 3;
  for (let x = 0; x < width; x++) {
    if (x % 16 === 0 && x > 0) hy += nextRange(rng, 3) - 1;
    hy = Math.max(2, Math.min(height - 3, hy));
    w.terrain[hy * width + x] = Terrain.Road;
    w.terrain[(hy + 1) * width + x] = Terrain.Road;
  }

  // county route (north–south through town)
  let hx = cx + nextRange(rng, 5) - 2;
  for (let y = 0; y < height; y++) {
    if (y % 20 === 0 && y > 0) hx += nextRange(rng, 3) - 1;
    hx = Math.max(2, Math.min(width - 3, hx));
    w.terrain[y * width + hx] = Terrain.Road;
  }

  // wandering country roads out of town — momentum walks rather than grid
  // lines (a light take on tensor-field street growth à la
  // github.com/probabletrain/mapgenerator; full streamline tracing is a
  // future mapgen-tool upgrade)
  const countryRoads = 2 + nextRange(rng, 2);
  for (let i = 0; i < countryRoads; i++) {
    // leave the town edge at a random angle
    const angle = (nextRange(rng, 360) * Math.PI) / 180;
    let fx = cx + Math.cos(angle) * (r + 1);
    let fy = cy + Math.sin(angle) * (r + 1);
    let heading = angle;
    for (let step = 0; step < width; step++) {
      const x = Math.round(fx);
      const y = Math.round(fy);
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) break;
      w.terrain[y * width + x] = Terrain.Road;
      // gentle deterministic drift gives the road its curve
      heading += (nextRange(rng, 21) - 10) / 80;
      fx += Math.cos(heading);
      fy += Math.sin(heading);
    }
  }

  // town streets: a modest grid that exists ONLY inside the town circle
  const r2 = r * r;
  let sx = cx - r + 2 + nextRange(rng, 3);
  while (sx < cx + r) {
    for (let y = cy - r; y <= cy + r; y++) {
      if (y < 0 || y >= height) continue;
      const dx = sx - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      w.terrain[y * width + sx] = Terrain.Road;
    }
    sx += 5 + nextRange(rng, 3);
  }
  let sy = cy - r + 2 + nextRange(rng, 3);
  while (sy < cy + r) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || x >= width) continue;
      const dx = x - cx;
      const dy = sy - cy;
      if (dx * dx + dy * dy > r2) continue;
      w.terrain[sy * width + x] = Terrain.Road;
    }
    sy += 5 + nextRange(rng, 3);
  }

  // zone the town: lots become Citizen with a district
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const t = y * width + x;
      if (w.terrain[t] !== Terrain.Grass) continue;
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      w.terrain[t] = Terrain.Citizen;
      const dist = Math.sqrt(d2) / r;
      if (dist < 0.32) w.district[t] = Districts.Downtown;
      else if (dist > 0.82) w.district[t] = Districts.Trailer;
      else if (dx < 0 && dy < 0) w.district[t] = Districts.OldTown; // NW quarter
      else if (dx > 0 && dy < 0) w.district[t] = Districts.College; // NE quarter
      else w.district[t] = Districts.Suburbs;
    }
  }

  return { cx, cy, r, highwayY: hy, highwayX: hx };
}

/** Farmsteads in the outskirts: a few houses, crop fields, a dirt lane to a road. */
function layoutFarms(w: World, rng: RngState, town: TownShape): void {
  const { width, height } = w;
  const farms = 10 + nextRange(rng, 5);
  for (let i = 0; i < farms; i++) {
    const fx = 4 + nextRange(rng, width - 8);
    const fy = 4 + nextRange(rng, height - 8);
    const ddx = fx - town.cx;
    const ddy = fy - town.cy;
    if (ddx * ddx + ddy * ddy < (town.r + 5) * (town.r + 5)) continue; // out of town only

    // farmhouse cluster (2–4 lots)
    const houses = 2 + nextRange(rng, 3);
    for (let h = 0; h < houses; h++) {
      const x = fx + nextRange(rng, 3) - 1;
      const y = fy + nextRange(rng, 3) - 1;
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      const t = y * width + x;
      if (w.terrain[t] === Terrain.Grass) {
        w.terrain[t] = Terrain.Citizen;
        w.district[t] = Districts.Trailer;
      }
    }
    // crop fields beside the farm
    const fieldW = 3 + nextRange(rng, 4);
    const fieldH = 2 + nextRange(rng, 3);
    const offX = nextRange(rng, 2) === 0 ? 2 : -fieldW - 1;
    for (let dy = 0; dy < fieldH; dy++) {
      for (let dx = 0; dx < fieldW; dx++) {
        const x = fx + offX + dx;
        const y = fy + dy - 1;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const t = y * width + x;
        if (w.terrain[t] === Terrain.Grass) w.terrain[t] = Terrain.Field;
      }
    }
    // dirt lane to the nearest road
    carveDirtLane(w, fy * width + fx);
  }
}

/** Bresenham a dirt lane from `from` to the nearest road tile, painting grass only. */
export function carveDirtLane(w: World, from: number): void {
  const target = nearestRoad(w, from, 40);
  if (target < 0) return;
  let x0 = from % w.width;
  let y0 = (from / w.width) | 0;
  const x1 = target % w.width;
  const y1 = (target / w.width) | 0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (x0 !== x1 || y0 !== y1) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
    const t = y0 * w.width + x0;
    if (w.terrain[t] === Terrain.Grass || w.terrain[t] === Terrain.Field) {
      w.terrain[t] = Terrain.Dirt;
    }
  }
}

export function nearestRoad(w: World, from: number, maxR: number): number {
  const x0 = from % w.width;
  const y0 = (from / w.width) | 0;
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
        const t = y * w.width + x;
        if (w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Dirt) return t;
      }
    }
  }
  return -1;
}

/** Woods stands and the lake in the open country. */
function placeNature(w: World, rng: RngState, town: TownShape): void {
  const { width, height } = w;
  const blobs = 7 + nextRange(rng, 5);
  let lakePlaced = false;
  for (let i = 0; i < blobs; i++) {
    const bx = nextRange(rng, width);
    const by = nextRange(rng, height);
    const ddx = bx - town.cx;
    const ddy = by - town.cy;
    if (ddx * ddx + ddy * ddy < town.r * town.r) continue; // keep town clear
    const r = 3 + nextRange(rng, Math.max(3, width >> 4));
    const kind = !lakePlaced && i > 1 ? Terrain.Lake : Terrain.Woods;
    if (kind === Terrain.Lake) lakePlaced = true;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = bx + dx;
        const y = by + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const t = y * width + x;
        if (w.terrain[t] === Terrain.Grass || w.terrain[t] === Terrain.Field) {
          w.terrain[t] = kind;
          w.district[t] = Districts.None;
        }
      }
    }
  }
}

/** Residents per lot + susceptibility (§2). Street-front lots run denser. */
function rollLots(w: World, rng: RngState): void {
  const { width, height } = w;
  for (let t = 0; t < w.terrain.length; t++) {
    if (w.terrain[t] !== Terrain.Citizen) {
      w.pop[t] = 0;
      w.susceptibility[t] = 0;
      continue;
    }
    const d = w.district[t]!;
    const [lo, hi] = POP_RANGE[d] ?? [2, 4];

    if (w.lot[t] !== 0) {
      // town buildings set their own worker counts; just roll S below
      const sum0 =
        nextRange(rng, 32) + nextRange(rng, 32) + nextRange(rng, 32) + nextRange(rng, 32);
      let s0 = 50 + (sum0 - 62);
      if (d === Districts.College) s0 += 12;
      else if (d === Districts.OldTown) s0 -= 8;
      w.susceptibility[t] = fromInt(s0 < 5 ? 5 : s0 > 95 ? 95 : s0);
      continue;
    }

    if (nextRange(rng, 100) < (YARD_CHANCE[d] ?? 40)) {
      w.pop[t] = nextRange(rng, 2); // 0–1: a yard, a garden
    } else {
      let pop = lo + nextRange(rng, Math.max(1, hi - lo + 1));
      const x = t % width;
      const y = (t / width) | 0;
      const facing =
        (x > 0 && w.terrain[t - 1] === Terrain.Road) ||
        (x < width - 1 && w.terrain[t + 1] === Terrain.Road) ||
        (y > 0 && w.terrain[t - width] === Terrain.Road) ||
        (y < height - 1 && w.terrain[t + width] === Terrain.Road);
      if (facing) pop += 1;
      w.pop[t] = Math.min(15, Math.max(1, pop));
    }

    // ~Normal(50, 18) susceptibility via 4 uniform draws in [0,31] (§2)
    const sum =
      nextRange(rng, 32) + nextRange(rng, 32) + nextRange(rng, 32) + nextRange(rng, 32);
    let s = 50 + (sum - 62);
    if (d === Districts.College) s += 12;
    else if (d === Districts.OldTown) s -= 8;
    s = s < 5 ? 5 : s > 95 ? 95 : s;
    w.susceptibility[t] = fromInt(s);
  }
}

/**
 * Landmarks (§2 rule 2): Town Hall downtown; Megachurch and Fairground at the
 * town edge; Radio Tower and Water Tower out in the country (with dirt lanes).
 */
function placeLandmarks(w: World, town: TownShape): void {
  const place = (kind: number, x: number, y: number, wantCitizen: boolean): void => {
    const anchor = Math.max(0, Math.min(w.terrain.length - 1, y * w.width + x));
    const t = wantCitizen ? nearestOf(w, anchor, Terrain.Citizen) : nearestOf(w, anchor, Terrain.Grass);
    if (t < 0) return;
    w.landmark[t] = kind;
    if (!wantCitizen) carveDirtLane(w, t); // country landmarks get an access lane
  };
  place(Landmark.TownHall, town.cx, town.cy, true);
  place(Landmark.Megachurch, town.cx + town.r - 2, town.cy + 3, true);
  place(Landmark.Fairground, town.cx - town.r + 2, town.cy - 3, true);
  place(Landmark.RadioTower, Math.floor(w.width * 0.15), Math.floor(w.height * 0.15), false);
  place(Landmark.WaterTower, Math.floor(w.width * 0.85), Math.floor(w.height * 0.85), false);
}

function nearestOf(w: World, from: number, terrain: number): number {
  const x0 = from % w.width;
  const y0 = (from / w.width) | 0;
  for (let r = 0; r < Math.max(w.width, w.height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
        const t = y * w.width + x;
        if (w.terrain[t] === terrain) return t;
      }
    }
  }
  return -1;
}

/** Count conversion-eligible citizen tiles — the balance unit (§1). */
export function countPopulated(w: World): number {
  let n = 0;
  for (let t = 0; t < w.terrain.length; t++) if (w.terrain[t] === Terrain.Citizen) n++;
  return n;
}

/** Total residents — the conversion-bar denominator. */
export function countTotalPop(w: World): number {
  let n = 0;
  for (let t = 0; t < w.pop.length; t++) n += w.pop[t]!;
  return n;
}
