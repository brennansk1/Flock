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
import { traceRoadNetwork } from "./tensorRoads.js";
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

/**
 * Minimum population the map must support: enough residents and conversion-
 * eligible lots for a full lobby's worth of cults to grow into. Below this
 * the town is regrown a notch larger; the radius cap in layoutHighwaysAndTown
 * still guarantees open country around it.
 */
const MIN_POPULATED_TILES = 700;
const MIN_TOTAL_POP = 3200;

export function generateWorld(seed: number, width: number, height: number): World {
  let w!: World;
  // grow the town until it clears the population floor (deterministic per
  // seed — same input always walks the same retry sequence).
  for (let attempt = 0; attempt < 5; attempt++) {
    const rScale = 1 + attempt * 0.12;
    const rng = seedRng((seed ^ 0x6d61_7067) + attempt); // "mapg" + retry salt
    w = createWorld(width, height);
    w.districtCoeffs = districtCoeffTable();
    w.terrain.fill(Terrain.Grass); // the whole map starts as open country

    const town = layoutHighwaysAndTown(w, rng, rScale);
    scatterExurbs(w, rng, town);
    layoutFarms(w, rng, town);
    placeNature(w, rng, town);
    placeTownBuildings(w, rng, town);
    placeLandmarks(w, town);
    rollLots(w, rng);

    if (countPopulated(w) >= MIN_POPULATED_TILES && countTotalPop(w) >= MIN_TOTAL_POP) break;
  }
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
  // Downtown: civic core + commercial strip. Every real Main Street has a
  // town hall (landmark), bank, post office, and a fire station.
  stamp(Lot.Supermarket, 2, 1, D.Downtown, 10);
  stamp(Lot.Office, 2, 2, D.Downtown, 16);
  stamp(Lot.Bank, 1, 1, D.Downtown, 6);
  stamp(Lot.PostOffice, 1, 1, D.Downtown, 5);
  stamp(Lot.FireStation, 2, 1, D.Downtown, 6);
  stamp(Lot.Diner, 1, 1, D.Downtown, 6);
  stamp(Lot.Sheriff, 1, 1, D.Downtown, 5);
  for (let i = 0; i < 6; i++) stamp(Lot.Shop, 1, 1, D.Downtown, 4 + nextRange(rng, 3));
  // College quarter
  stamp(Lot.School, 2, 2, D.College, 14);
  stamp(Lot.Library, 1, 1, D.College, 5);
  stamp(Lot.Shop, 1, 1, D.College, 4);
  // Old Town: the steepled church (a town's spiritual landmark) + diner
  stamp(Lot.Church, 1, 2, D.OldTown, 6);
  stamp(Lot.Chapel, 1, 1, D.OldTown, 4);
  stamp(Lot.Diner, 1, 1, D.OldTown, 5);
  // Suburbs: corner shops, a church, parks
  stamp(Lot.Shop, 1, 1, D.Suburbs, 4);
  stamp(Lot.Shop, 1, 1, D.Suburbs, 4);
  stamp(Lot.Church, 1, 2, D.Suburbs, 5);
  stamp(Lot.Park, 2, 2, D.Suburbs, 1, 80);
  stamp(Lot.Park, 1, 1, D.College, 1);
  // Trailer fringe: gas, and an industrial lot (the town's one factory)
  stamp(Lot.GasStation, 1, 1, D.Trailer, 3);
  stamp(Lot.Factory, 2, 2, D.Trailer, 8);

  // a roadside motel out on the highway, beside the gas stations
  let placedMotel = false;
  for (let attempt = 0; attempt < 200 && !placedMotel; attempt++) {
    const x = nextRange(rng, width);
    const y = town.highwayY + (nextRange(rng, 2) === 0 ? -2 : 3);
    if (y < 0 || y >= w.height) continue;
    const ddx = x - town.cx;
    const ddy = y - town.cy;
    if (ddx * ddx + ddy * ddy < (town.r + 8) * (town.r + 8)) continue;
    const t = y * width + x;
    if (w.terrain[t] !== Terrain.Grass || w.terrain[t + 1] !== Terrain.Grass) continue;
    if (nearestRoad(w, t, 3) < 0) continue;
    for (const n of [t, t + 1]) {
      w.terrain[n] = Terrain.Citizen;
      w.district[n] = Districts.Trailer;
      w.lot[n] = Lot.Motel;
      w.pop[n] = 3;
    }
    placedMotel = true;
  }

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

  // PARKING LOTS: big commercial/civic boxes get an adjacent asphalt apron —
  // converts one neighboring house lot, giving the building padding + a lot.
  const wantsParking = new Set<number>([
    Lot.Supermarket,
    Lot.Office,
    Lot.Factory,
    Lot.Bank,
    Lot.FireStation,
    Lot.School,
    Lot.Motel,
  ]);
  const parkSeen = new Set<number>();
  for (let t = 0; t < w.terrain.length; t++) {
    const lot = w.lot[t]!;
    if (!wantsParking.has(lot) || parkSeen.has(lot + (w.district[t]! << 8))) continue;
    // one apron per (lot type, district) cluster keeps it from over-paving
    const x = t % width;
    const y = (t / width) | 0;
    for (const [nx, ny] of [
      [x, y + 1],
      [x + 1, y],
      [x, y - 1],
      [x - 1, y],
    ] as [number, number][]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= w.height) continue;
      const n = ny * width + nx;
      if (w.terrain[n] === Terrain.Citizen && w.lot[n] === 0) {
        w.lot[n] = Lot.Parking;
        w.pop[n] = 0;
        parkSeen.add(lot + (w.district[n]! << 8));
        break;
      }
    }
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
 * Roads come from a tensor field (tensorRoads.ts — adapted from
 * ProbableTrain/MapGenerator). The TOWN SHAPE is organic, not a disc:
 * twelve noisy boundary spokes are cosine-interpolated into a lumpy edge,
 * the whole footprint stretches along the highway axis (towns grow along
 * their artery), and zoning follows real small-town logic — a commercial
 * strip hugging the highway through the center, quarters as lobes, trailers
 * at the fringe. Lots only appear with street access, so blocks take the
 * shapes the streamlines carve.
 */
function layoutHighwaysAndTown(w: World, rng: RngState, rScale = 1): TownShape {
  const { width, height } = w;
  const cx = (width >> 1) + nextRange(rng, 9) - 4;
  const cy = (height >> 1) + nextRange(rng, 9) - 4;
  // town radius scales up if a seed underpopulates (generateWorld retries),
  // but stays capped so the countryside around it never disappears.
  const base = Math.min(width, height) * 0.27 * rScale;
  const r = Math.max(16, Math.min(Math.floor(Math.min(width, height) * 0.36), Math.floor(base)));

  // lumpy boundary: 12 spokes, radius 0.62r–1.05r, cosine-interpolated
  const SPOKES = 12;
  const spokeR: number[] = [];
  for (let i = 0; i < SPOKES; i++) spokeR.push(r * (0.62 + nextRange(rng, 44) / 100));
  const radiusAt = (angle: number): number => {
    const a = ((angle / (2 * Math.PI)) * SPOKES + SPOKES) % SPOKES;
    const i0 = Math.floor(a) % SPOKES;
    const i1 = (i0 + 1) % SPOKES;
    const f = a - Math.floor(a);
    const smooth = (1 - Math.cos(f * Math.PI)) / 2;
    return spokeR[i0]! * (1 - smooth) + spokeR[i1]! * smooth;
  };
  // towns stretch along their highway: squash the north–south axis
  const inTown = (x: number, y: number): boolean => {
    const dx = x - cx;
    const dy = (y - cy) * 1.35;
    const d = Math.sqrt(dx * dx + dy * dy);
    return d <= radiusAt(Math.atan2(dy, dx));
  };

  traceRoadNetwork(w, rng, { cx, cy, r, inTown });

  // quarter lobes get random compass directions
  const quarterBase = nextRange(rng, 4); // 0..3 → which lobe is Old Town
  const sectorOf = (dx: number, dy: number): number => {
    const a = Math.atan2(dy, dx) + Math.PI; // 0..2π
    return (Math.floor((a / (2 * Math.PI)) * 4) + quarterBase) % 4;
  };

  // zone lots: street access within 2 tiles, inside the organic boundary
  const rMax = Math.ceil(r * 1.1);
  for (let y = cy - rMax; y <= cy + rMax; y++) {
    for (let x = cx - rMax; x <= cx + rMax; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const t = y * width + x;
      if (w.terrain[t] !== Terrain.Grass) continue;
      if (!inTown(x, y)) continue;
      let nearStreet = false;
      for (let oy = -2; oy <= 2 && !nearStreet; oy++) {
        for (let ox = -2; ox <= 2 && !nearStreet; ox++) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (w.terrain[ny * width + nx] === Terrain.Road) nearStreet = true;
        }
      }
      if (!nearStreet) continue;
      w.terrain[t] = Terrain.Citizen;

      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy * 1.8);
      const edge = d / radiusAt(Math.atan2(dy * 1.35, dx));
      // Main Street: the strip along the highway through the center
      let nearHighway = false;
      for (let oy = -2; oy <= 2 && !nearHighway; oy++) {
        const ny = y + oy;
        if (ny < 0 || ny >= height) continue;
        const nt = ny * width + x;
        if (w.terrain[nt] === Terrain.Road && isHighwayTile(w, nt)) nearHighway = true;
      }
      if (nearHighway && Math.abs(dx) < r * 0.55) w.district[t] = Districts.Downtown;
      else if (d < r * 0.26) w.district[t] = Districts.Downtown;
      else if (edge > 0.84) w.district[t] = Districts.Trailer;
      else {
        const sector = sectorOf(dx, dy);
        w.district[t] =
          sector === 0 ? Districts.OldTown : sector === 1 ? Districts.College : Districts.Suburbs;
      }
    }
  }

  return { cx, cy, r, highwayY: cy, highwayX: cx };
}

/** A road tile that's part of the 2-lane highway (has a parallel road row). */
function isHighwayTile(w: World, t: number): boolean {
  const x = t % w.width;
  const y = (t / w.width) | 0;
  const left = x > 0 && w.terrain[t - 1] === Terrain.Road;
  const right = x < w.width - 1 && w.terrain[t + 1] === Terrain.Road;
  const up = y > 0 && w.terrain[t - w.width] === Terrain.Road;
  const down = y < w.height - 1 && w.terrain[t + w.width] === Terrain.Road;
  return left && right && (up || down);
}

/**
 * Density falloff: a real town doesn't end at a hard line — past the last
 * subdivision the lots thin out into exurban homes strung along the roads
 * that leave town, then peter out into open country. We walk the road tiles
 * in the transition ring just beyond the town boundary and drop the occasional
 * lone house beside one, with probability decaying as you get farther out, so
 * the urban edge dissolves gradually instead of snapping to grass.
 */
function scatterExurbs(w: World, rng: RngState, town: TownShape): void {
  const { width, height } = w;
  const inner = town.r * 1.05;
  const outer = town.r * 1.6;
  for (let t = 0; t < w.terrain.length; t++) {
    if (w.terrain[t] !== Terrain.Road) continue;
    const x = t % width;
    const y = (t / width) | 0;
    const dx = x - town.cx;
    const dy = y - town.cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < inner || d > outer) continue;
    // probability fades linearly from ~35% at the edge to 0 in deep country
    const falloff = 1 - (d - inner) / (outer - inner);
    if (nextRange(rng, 100) >= Math.floor(35 * falloff)) continue;
    // drop a lone home one tile off the road, on the country side
    const offX = dx >= 0 ? 1 : -1;
    const offY = dy >= 0 ? 1 : -1;
    const hx = x + (nextRange(rng, 2) ? offX : 0);
    const hy = y + (nextRange(rng, 2) ? offY : 0);
    if (hx < 2 || hy < 2 || hx >= width - 2 || hy >= height - 2) continue;
    const ht = hy * width + hx;
    if (w.terrain[ht] !== Terrain.Grass) continue;
    // keep exurban homes from touching each other (raster-order spacing)
    if (
      (w.terrain[ht - 1] === Terrain.Citizen) ||
      (w.terrain[ht - width] === Terrain.Citizen)
    )
      continue;
    w.terrain[ht] = Terrain.Citizen;
    w.district[ht] = Districts.Trailer; // rural-fringe density coefficients
  }
}

/**
 * Farmsteads: real farms cluster in a belt on the rural edge of town, not
 * scattered to the map's corners. We pick a few "farm road" anchors out in
 * the countryside ring around town and grow a small group of farmsteads at
 * each — every one a few houses, a barn-ready yard, big crop fields, and a
 * dirt lane back to the nearest road. Fields border each other so the belt
 * reads as contiguous agricultural land rather than floating plots.
 */
function layoutFarms(w: World, rng: RngState, town: TownShape): void {
  const { width, height } = w;
  const beltInner = town.r + 6;
  const beltOuter = Math.min(width, height) * 0.46;
  const clusters = 3 + nextRange(rng, 3);

  const placeFarm = (fx: number, fy: number): void => {
    if (fx < 5 || fy < 5 || fx >= width - 5 || fy >= height - 5) return;
    const ddx = fx - town.cx;
    const ddy = fy - town.cy;
    if (ddx * ddx + ddy * ddy < beltInner * beltInner) return; // out of town only

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
    // big crop fields flanking the farmstead (both sides → contiguous belt)
    for (const side of [1, -1]) {
      const fieldW = 4 + nextRange(rng, 5);
      const fieldH = 3 + nextRange(rng, 4);
      const offX = side === 1 ? 2 : -fieldW - 1;
      for (let dy = 0; dy < fieldH; dy++) {
        for (let dx = 0; dx < fieldW; dx++) {
          const x = fx + offX + dx;
          const y = fy + dy - 1;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const t = y * width + x;
          if (w.terrain[t] === Terrain.Grass) w.terrain[t] = Terrain.Field;
        }
      }
    }
    carveDirtLane(w, fy * width + fx);
  };

  for (let c = 0; c < clusters; c++) {
    const angle = (nextRange(rng, 360) * Math.PI) / 180;
    const dist = beltInner + nextRange(rng, Math.max(4, Math.floor(beltOuter - beltInner)));
    const ax = Math.round(town.cx + Math.cos(angle) * dist);
    const ay = Math.round(town.cy + Math.sin(angle) * dist);
    const farmsHere = 2 + nextRange(rng, 3);
    for (let f = 0; f < farmsHere; f++) {
      placeFarm(ax + nextRange(rng, 13) - 6, ay + nextRange(rng, 13) - 6);
    }
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
/**
 * Stamp one organic blob: instead of a hard circle, the boundary radius is
 * modulated per-angle by a few sine harmonics with random phases (a cheap
 * 1-D value-noise rim), and each tile gets a small radial-noise wobble so the
 * edge frays rather than reading as a clean arc. Forests grow denser toward
 * the core (canopy), thinning to scattered scrub at the rim.
 */
function organicBlob(
  w: World,
  rng: RngState,
  bx: number,
  by: number,
  r: number,
  kind: Terrain,
): void {
  const { width, height } = w;
  // three harmonics give a lumpy-but-coherent outline
  const h1 = 0.18 + nextRange(rng, 18) / 100; // ±18–36%
  const h2 = 0.1 + nextRange(rng, 12) / 100;
  const h3 = 0.06 + nextRange(rng, 8) / 100;
  const p1 = (nextRange(rng, 628) / 100);
  const p2 = (nextRange(rng, 628) / 100);
  const p3 = (nextRange(rng, 628) / 100);
  const k1 = 2 + nextRange(rng, 2);
  const k2 = 3 + nextRange(rng, 3);
  const k3 = 5 + nextRange(rng, 4);
  const reach = Math.ceil(r * 1.4);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const x = bx + dx;
      const y = by + dy;
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.5) {
        // always fill the very center
      }
      const ang = Math.atan2(dy, dx);
      const rim =
        r *
        (1 +
          h1 * Math.sin(k1 * ang + p1) +
          h2 * Math.sin(k2 * ang + p2) +
          h3 * Math.sin(k3 * ang + p3));
      // edge fray: tiles near the rim drop out probabilistically
      const margin = rim - dist;
      if (margin < 0) continue;
      const t = y * width + x;
      if (w.terrain[t] !== Terrain.Grass && w.terrain[t] !== Terrain.Field) continue;
      if (kind === Terrain.Woods) {
        // thinning canopy near the rim: chance scales with depth
        const depth = margin / (r * 0.5);
        if (depth < 1 && nextRange(rng, 100) > 30 + depth * 60) continue;
      } else {
        if (margin < 1.2 && nextRange(rng, 100) < 45) continue;
      }
      w.terrain[t] = kind;
      w.district[t] = Districts.None;
    }
  }
}

function placeNature(w: World, rng: RngState, town: TownShape): void {
  const { width, height } = w;
  // a couple of generous forests, several smaller copses, one irregular lake
  const forests = 2 + nextRange(rng, 2);
  const copses = 5 + nextRange(rng, 4);
  let lakePlaced = false;
  const tryPlace = (r: number, kind: Terrain): void => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const bx = nextRange(rng, width);
      const by = nextRange(rng, height);
      const ddx = bx - town.cx;
      const ddy = by - town.cy;
      // keep a clear margin around the town so there's room to build
      if (ddx * ddx + ddy * ddy < (town.r + r + 6) * (town.r + r + 6)) continue;
      organicBlob(w, rng, bx, by, r, kind);
      return;
    }
  };
  // lake first so forests can hug it
  tryPlace(6 + nextRange(rng, 5), Terrain.Lake);
  lakePlaced = true;
  for (let i = 0; i < forests; i++) tryPlace(8 + nextRange(rng, 6), Terrain.Woods);
  for (let i = 0; i < copses; i++) tryPlace(3 + nextRange(rng, 3), Terrain.Woods);
  void lakePlaced;
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

    const x = t % width;
    const y = (t / width) | 0;
    // Detached-lot spacing: in the low-density residential districts a real
    // house needs a yard, so a full house can't sit directly beside another
    // (raster order means west/north neighbors are already finalized). This
    // gives every home a minimum lot footprint instead of wall-to-wall infill.
    const lowDensity = d === Districts.Suburbs || d === Districts.OldTown || d === Districts.Trailer;
    const crowded =
      lowDensity &&
      ((x > 0 && w.district[t - 1] === d && w.pop[t - 1]! >= 3) ||
        (y > 0 && w.district[t - width] === d && w.pop[t - width]! >= 3));

    if (crowded || nextRange(rng, 100) < (YARD_CHANCE[d] ?? 40)) {
      w.pop[t] = nextRange(rng, 2); // 0–1: a yard, a garden
    } else {
      let pop = lo + nextRange(rng, Math.max(1, hi - lo + 1));
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
