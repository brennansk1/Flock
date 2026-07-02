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
import { Terrain, Biome, Landmark, Lot, type World, type DistrictCoeffs } from "./types.js";
import { traceGridRoads } from "./gridRoads.js";
import { pickTownName, type Street } from "./names.js";
import { createWorld } from "./sim.js";

/**
 * District ids (index into districtCoeffs). 0 = unzoned (terrain).
 * Zoning v2 (§2 rev. 3): the classic quarters PLUS explicit land-use zones —
 * Suburbs = low-density residential, ResHigh = high-density apartments,
 * Commercial = the Main Street strip, Industrial = the working edge of town.
 */
export const Districts = {
  None: 0,
  Suburbs: 1, // low-density residential
  College: 2,
  Downtown: 3, // dense mixed civic core
  OldTown: 4,
  Trailer: 5, // rural fringe
  Commercial: 6, // strip along Main Street
  Industrial: 7, // factory/warehouse quarter by the highway
  ResHigh: 8, // high-density residential ring around downtown
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
    row(1.0, 1.2, 1.0), // Suburbs (low-density residential)
    row(1.6, 0.6, 0.7), // College Campus
    row(0.9, 1.0, 1.5), // Downtown core
    row(0.5, 1.6, 1.3), // Old Town
    row(1.3, 0.9, 0.6), // Trailer/Outskirts
    row(0.8, 1.0, 1.7), // Commercial strip — money, not souls
    row(1.1, 0.8, 1.1), // Industrial — shift workers, loose ties
    row(1.2, 0.9, 0.9), // ResHigh — apartment renters, transient
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
  [Districts.Commercial]: [3, 7], // clerks + upstairs flats
  [Districts.Industrial]: [2, 5], // shift crews
  [Districts.ResHigh]: [8, 14], // apartment blocks
};

/** Chance (in %) that a town lot is an empty yard/garden (low pop). */
const YARD_CHANCE: Record<number, number> = {
  [Districts.None]: 100,
  [Districts.Suburbs]: 28,
  [Districts.College]: 16,
  [Districts.Downtown]: 8,
  [Districts.OldTown]: 40,
  [Districts.Trailer]: 50,
  [Districts.Commercial]: 12,
  [Districts.Industrial]: 35, // yards between works
  [Districts.ResHigh]: 6,
};

/**
 * Minimum population the map must support: enough residents and conversion-
 * eligible lots for a full lobby's worth of cults to grow into. Below this
 * the town is regrown a notch larger; the radius cap in layoutHighwaysAndTown
 * still guarantees open country around it.
 */
const MIN_POPULATED_TILES = 640;
const MIN_TOTAL_POP = 2900;

/** Biome names accepted by `MapOpts.biomes` (order-independent, deduped). */
export type BiomeName = "desert" | "forest";

/** Map-generation options — the user-configurable knobs (§2 rev. 3). */
export interface MapOpts {
  /**
   * Which accent biomes may spawn as blobs in the open country. Defaults to
   * both. Pass `[]` for a pure temperate map. (Server: FLOCK_BIOMES env.)
   */
  biomes?: BiomeName[];
}

export function generateWorld(seed: number, width: number, height: number, opts: MapOpts = {}): World {
  let w!: World;
  // grow the town until it clears the population floor (deterministic per
  // seed — same input always walks the same retry sequence).
  for (let attempt = 0; attempt < 5; attempt++) {
    const rScale = 1 + attempt * 0.12;
    // golden-ratio stride keeps every (seed, attempt) rng stream distinct —
    // a plain `+ attempt` salt collides across adjacent seeds and, with the
    // radius cap flattening rScale, can produce bit-identical towns.
    const rng = seedRng(seed ^ ((0x6d61_7067 + Math.imul(attempt, 0x9e37_79b9)) | 0));
    w = createWorld(width, height);
    w.districtCoeffs = districtCoeffTable();
    w.terrain.fill(Terrain.Grass); // the whole map starts as open country
    w.townName = pickTownName(rng); // a fresh fake town, every seed

    const town = layoutHighwaysAndTown(w, rng, rScale);
    paintBiomes(w, rng, town, opts.biomes ?? ["desert", "forest"]);
    carveRiver(w, rng, town);
    scatterExurbs(w, rng, town);
    layoutFarms(w, rng, town);
    placeNature(w, rng, town);
    placeTownBuildings(w, rng, town);
    placeDocks(w, rng, town);
    placeLandmarks(w, town);
    orthogonalizePaths(w); // safety net: bridge any corner-only path contact
    connectRoadComponents(w); // stitch orphan road islands into the main grid
    pruneRoadStubs(w); // erase whatever still leads nowhere
    pruneAllDeadEnds(w); // …including dirt lanes and orphaned spurs
    rollLots(w, rng);
    ensureHomeAccess(w); // footpaths: no home without a way to the street
    infillToFloor(w, rng); // yards become modest homes until the pop floor holds

    if (countPopulated(w) >= MIN_POPULATED_TILES && countTotalPop(w) >= MIN_TOTAL_POP) break;
  }
  return w;
}

/**
 * Biome blobs (§2 rev. 3): user-configurable accent biomes stamped as organic
 * blobs in the open country, well clear of the town. The biome layer reskins
 * the land in the renderer (desert sand + cacti, deep forest) and steers
 * nature/farm placement — farms stay out of the desert, forests grow thicker
 * in forest biome.
 */
function paintBiomes(w: World, rng: RngState, town: TownShape, biomes: BiomeName[]): void {
  const { width, height } = w;
  // fixed processing order keeps the rng stream deterministic per config
  const wanted = [...new Set(biomes)].sort();
  const id = (b: BiomeName): number => (b === "desert" ? Biome.Desert : Biome.Forest);
  for (const name of wanted) {
    const blobs = 1 + nextRange(rng, 2);
    for (let i = 0; i < blobs; i++) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const bx = nextRange(rng, width);
        const by = nextRange(rng, height);
        const ddx = bx - town.cx;
        const ddy = by - town.cy;
        const rr = 9 + nextRange(rng, 8);
        if (ddx * ddx + ddy * ddy < (town.r + rr + 4) * (town.r + rr + 4)) continue;
        // lumpy rim, same recipe as organicBlob
        const h1 = 0.2 + nextRange(rng, 16) / 100;
        const h2 = 0.1 + nextRange(rng, 10) / 100;
        const p1 = nextRange(rng, 628) / 100;
        const p2 = nextRange(rng, 628) / 100;
        const reach = Math.ceil(rr * 1.35);
        for (let dy = -reach; dy <= reach; dy++) {
          for (let dx = -reach; dx <= reach; dx++) {
            const x = bx + dx;
            const y = by + dy;
            if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const ang = Math.atan2(dy, dx);
            const rim = rr * (1 + h1 * Math.sin(3 * ang + p1) + h2 * Math.sin(5 * ang + p2));
            if (dist > rim) continue;
            w.biome[y * width + x] = id(name);
          }
        }
        break;
      }
    }
  }
}

/**
 * No home without a way to the street (§2 rev. 3): every populated house lot
 * must touch a Road/Dirt/Path tile. Block interiors get FOOTPATHS — we BFS
 * from each cut-off home through yards and grass to the street net and pave
 * the corridor as Terrain.Path (a sidewalk). A home nothing can reach
 * downgrades to a garden, so the invariant is absolute.
 */
function ensureHomeAccess(w: World): void {
  const { width, height } = w;
  const isWay = (t: number): boolean =>
    w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Dirt || w.terrain[t] === Terrain.Path;
  const hasAccess = (t: number): boolean => {
    const x = t % width;
    const y = (t / width) | 0;
    if (x > 0 && isWay(t - 1)) return true;
    if (x < width - 1 && isWay(t + 1)) return true;
    if (y > 0 && isWay(t - width)) return true;
    if (y < height - 1 && isWay(t + width)) return true;
    return false;
  };
  // walkable corridor tiles a footpath may pave over: yards + open grass
  const paveable = (t: number): boolean =>
    (w.terrain[t] === Terrain.Citizen && w.lot[t] === 0 && w.pop[t]! <= 2) ||
    w.terrain[t] === Terrain.Grass;

  for (let t = 0; t < w.terrain.length; t++) {
    if (w.terrain[t] !== Terrain.Citizen || w.pop[t]! < 3 || w.lot[t] !== 0) continue;
    if (hasAccess(t)) continue;
    // BFS ≤ 6 steps through paveable tiles to any way tile
    const parent = new Map<number, number>();
    const queue: number[] = [t];
    const depth = new Map<number, number>([[t, 0]]);
    let exit = -1;
    while (queue.length > 0 && exit < 0) {
      const c = queue.shift()!;
      const d = depth.get(c)!;
      if (d >= 6) continue;
      const x = c % width;
      const y = (c / width) | 0;
      for (const n of [x > 0 ? c - 1 : -1, x < width - 1 ? c + 1 : -1, y > 0 ? c - width : -1, y < height - 1 ? c + width : -1]) {
        if (n < 0 || depth.has(n)) continue;
        if (isWay(n)) {
          exit = c; // c is the last paveable tile before the street
          parent.set(n, c);
          break;
        }
        if (!paveable(n)) continue;
        depth.set(n, d + 1);
        parent.set(n, c);
        queue.push(n);
      }
    }
    if (exit < 0) {
      w.pop[t] = 2; // unreachable: the "home" is really a garden plot
      continue;
    }
    // pave the corridor back from the exit to (but not including) the home
    let c: number | undefined = exit;
    while (c !== undefined && c !== t) {
      w.terrain[c] = Terrain.Path;
      w.pop[c] = 0;
      w.lot[c] = 0;
      c = parent.get(c);
    }
  }
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

  /**
   * KEYSTONE GUARANTEE: some civic anchors exist in every real town — and the
   * civics engine (§13 rev.) depends on them being present. Try the preferred
   * district first, then fall back through others, then force-place on any
   * road-fronting citizen lot. Returns true iff the lot exists afterwards.
   */
  const keystone = (
    lotKind: number,
    wLots: number,
    hLots: number,
    districts: number[],
    workers: number,
  ): void => {
    for (const d of districts) {
      if (stamp(lotKind, wLots, hLots, d, workers)) return;
    }
    // shrink to 1×1 and try again before brute force
    for (const d of districts) {
      if (stamp(lotKind, 1, 1, d, workers)) return;
    }
    // force-place: first road-fronting, lot-free citizen tile in raster order
    for (let t = 0; t < w.terrain.length; t++) {
      if (w.terrain[t] !== Terrain.Citizen || w.lot[t] !== 0) continue;
      let fronted = false;
      for (const n of [t - 1, t + 1, t - width, t + width]) {
        if (n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Road) fronted = true;
      }
      if (!fronted) continue;
      w.lot[t] = lotKind;
      w.pop[t] = Math.min(15, Math.max(2, workers));
      return;
    }
  };

  const D = Districts;
  // KEYSTONES first — they claim ground before the flavor lots do, and they
  // are BIG: the civic anchors read at map scale (§2 rev. 3).
  keystone(Lot.Supermarket, 3, 2, [D.Commercial, D.Downtown], 12); // the grocery
  keystone(Lot.Sheriff, 2, 1, [D.Downtown, D.Commercial], 6); // the police station
  keystone(Lot.School, 3, 2, [D.College, D.Suburbs, D.ResHigh], 16); // elementary
  keystone(Lot.HighSchool, 3, 2, [D.College, D.Suburbs, D.ResHigh], 20);
  keystone(Lot.Church, 1, 2, [D.OldTown, D.Suburbs, D.Downtown], 6);
  keystone(Lot.FireStation, 2, 2, [D.Downtown, D.Commercial], 8);
  keystone(Lot.GasStation, 2, 1, [D.Commercial, D.Trailer], 4);

  // Downtown: civic core. Every real Main Street has a town hall (landmark),
  // bank, post office.
  stamp(Lot.Office, 2, 2, D.Downtown, 16);
  stamp(Lot.Bank, 1, 1, D.Downtown, 6);
  stamp(Lot.PostOffice, 1, 1, D.Downtown, 5);
  stamp(Lot.Diner, 1, 1, D.Downtown, 6);
  for (let i = 0; i < 3; i++) stamp(Lot.Shop, 1, 1, D.Downtown, 4 + nextRange(rng, 3));
  // the town green: a civic square in the heart of downtown
  stamp(Lot.Park, 2, 2, D.Downtown, 1, 90);
  // Commercial strip: shops, diner, cinema, offices along Main Street
  stamp(Lot.Cinema, 2, 1, D.Commercial, 8);
  stamp(Lot.Diner, 1, 1, D.Commercial, 6);
  stamp(Lot.Office, 2, 1, D.Commercial, 10);
  for (let i = 0; i < 5; i++) stamp(Lot.Shop, 1, 1, D.Commercial, 4 + nextRange(rng, 3));
  // Industrial quarter: the works — factory + warehouses + a yard
  stamp(Lot.Factory, 3, 2, D.Industrial, 14);
  keystone(Lot.Warehouse, 3, 1, [D.Industrial, D.Trailer, D.Commercial], 6);
  stamp(Lot.Warehouse, 2, 1, D.Industrial, 6);
  stamp(Lot.GasStation, 1, 1, D.Industrial, 3);
  // College quarter
  stamp(Lot.Library, 1, 1, D.College, 5);
  stamp(Lot.Shop, 1, 1, D.College, 4);
  stamp(Lot.BallField, 2, 2, D.College, 1, 70); // the school ballpark
  // Old Town: chapel + diner + the old churchyard
  stamp(Lot.Chapel, 1, 1, D.OldTown, 4);
  stamp(Lot.Diner, 1, 1, D.OldTown, 5);
  stamp(Lot.Cemetery, 2, 2, D.OldTown, 1, 70);
  // Suburbs (low-density): corner shops, a second church, parks, playground
  stamp(Lot.Shop, 1, 1, D.Suburbs, 4);
  stamp(Lot.Church, 1, 2, D.Suburbs, 5);
  stamp(Lot.Park, 2, 2, D.Suburbs, 1, 80);
  stamp(Lot.Playground, 1, 1, D.Suburbs, 1, 70);
  stamp(Lot.Playground, 1, 1, D.ResHigh, 1, 70);
  stamp(Lot.Park, 1, 1, D.College, 1);

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
    Lot.HighSchool,
    Lot.Sheriff,
    Lot.Cinema,
    Lot.Warehouse,
    Lot.Motel,
  ]);
  const parkCount = new Map<number, number>();
  for (let t = 0; t < w.terrain.length; t++) {
    const lot = w.lot[t]!;
    if (!wantsParking.has(lot)) continue;
    const key = lot + (w.district[t]! << 8);
    // civic anchors earn a 2-tile lot; the rest get one apron per cluster
    const budget = lot === Lot.Supermarket || lot === Lot.School || lot === Lot.HighSchool || lot === Lot.Cinema ? 2 : 1;
    if ((parkCount.get(key) ?? 0) >= budget) continue;
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
        parkCount.set(key, (parkCount.get(key) ?? 0) + 1);
        break;
      }
    }
  }

  // barns + silos + the odd greenhouse at farmsteads (next to farm houses)
  for (let t = 0; t < w.terrain.length; t++) {
    if (w.terrain[t] !== Terrain.Citizen || w.district[t] !== Districts.Trailer) continue;
    const x = t % width;
    const y = (t / width) | 0;
    const ddx = x - town.cx;
    const ddy = y - town.cy;
    if (ddx * ddx + ddy * ddy < (town.r + 4) * (town.r + 4)) continue; // farms only
    if (nextRange(rng, 4) !== 0) continue;
    // try to grow a barn (or silo, or greenhouse) on adjacent grass
    const spots = [t + 1, t - 1, t + width, t - width];
    for (const n of spots) {
      if (n < 0 || n >= w.terrain.length) continue;
      if (w.terrain[n] === Terrain.Grass && w.lot[n] === 0) {
        w.terrain[n] = Terrain.Citizen;
        w.district[n] = Districts.Trailer;
        const roll = nextRange(rng, 6);
        w.lot[n] = roll === 0 ? Lot.Silo : roll === 1 ? Lot.Greenhouse : Lot.Barn;
        w.pop[n] = 1 + nextRange(rng, 2);
        break;
      }
    }
  }
}

/**
 * Waterfront docks: where the lake or river shore comes near a road, a wooden
 * dock reaches into the water — a fishing spot, a boat launch. Small pop, big
 * flavor: the shoreline reads lived-in instead of untouched.
 */
function placeDocks(w: World, rng: RngState, town: TownShape): void {
  void town;
  const { width, height } = w;
  let placed = 0;
  for (let attempt = 0; attempt < 400 && placed < 3; attempt++) {
    const x = 2 + nextRange(rng, width - 4);
    const y = 2 + nextRange(rng, height - 4);
    const t = y * width + x;
    if (w.terrain[t] !== Terrain.Grass || w.lot[t] !== 0) continue;
    // must touch water on exactly one side and have a road/lane within reach
    const water =
      (w.terrain[t + 1] === Terrain.Lake ? 1 : 0) +
      (w.terrain[t - 1] === Terrain.Lake ? 1 : 0) +
      (w.terrain[t + width] === Terrain.Lake ? 1 : 0) +
      (w.terrain[t - width] === Terrain.Lake ? 1 : 0);
    if (water === 0 || water > 2) continue;
    if (nearestRoad(w, t, 10) < 0) continue;
    w.terrain[t] = Terrain.Citizen;
    w.district[t] = Districts.Trailer; // rural-fringe coefficients
    w.lot[t] = Lot.Dock;
    w.pop[t] = 2;
    carveDirtLane(w, t);
    placed++;
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
 * The TOWN: an organic footprint (twelve noisy boundary spokes, cosine-
 * interpolated into a lumpy edge, stretched along the highway) PLATTED with a
 * strictly axis-aligned street grid (gridRoads.ts) — real city blocks, no
 * diagonals. Zoning follows small-town logic: a commercial strip hugging Main
 * Street through the center, quarters as lobes, trailers at the fringe. Every
 * street is named. Lots only appear with street access, so blocks fill in
 * along the grid the way a county plat map reads.
 */
function layoutHighwaysAndTown(w: World, rng: RngState, rScale = 1): TownShape {
  const { width, height } = w;
  const cx = (width >> 1) + nextRange(rng, 9) - 4;
  const cy = (height >> 1) + nextRange(rng, 9) - 4;
  // town radius scales up if a seed underpopulates (generateWorld retries),
  // but stays capped so the countryside around it never disappears.
  // a smaller, denser footprint leaves a wide ring of open country around town
  // — room for cults to place compounds and assets strategically.
  const base = Math.min(width, height) * 0.26 * rScale;
  const r = Math.max(15, Math.min(Math.floor(Math.min(width, height) * 0.3), Math.floor(base)));

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

  const highwayY = cy + nextRange(rng, 5) - 2;
  const highwayX = cx + nextRange(rng, 5) - 2;
  const streets: Street[] = traceGridRoads(w, rng, { cx, cy, r, highwayY, highwayX, inTown });
  w.streets = streets;

  // quarter lobes get random compass directions
  const quarterBase = nextRange(rng, 4); // 0..3 → which lobe is Old Town
  const sectorOf = (dx: number, dy: number): number => {
    const a = Math.atan2(dy, dx) + Math.PI; // 0..2π
    return (Math.floor((a / (2 * Math.PI)) * 4) + quarterBase) % 4;
  };
  // the industrial quarter sits on ONE side of the highway at the town edge —
  // real towns keep the works downwind of the houses
  const indSide = nextRange(rng, 2) === 0 ? -1 : 1; // west or east end of Main St

  // zone lots: street access within 3 tiles, inside the organic boundary.
  // Zoning v2 (§2 rev. 3), inside-out like a real plat:
  //   Main St strip → Commercial · core → Downtown · first ring → ResHigh ·
  //   industrial lobe by the highway end · quarters as lobes · Trailer fringe
  const rMax = Math.ceil(r * 1.1);
  for (let y = cy - rMax; y <= cy + rMax; y++) {
    for (let x = cx - rMax; x <= cx + rMax; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const t = y * width + x;
      if (w.terrain[t] !== Terrain.Grass) continue;
      if (!inTown(x, y)) continue;
      let nearStreet = false;
      for (let oy = -3; oy <= 3 && !nearStreet; oy++) {
        for (let ox = -3; ox <= 3 && !nearStreet; ox++) {
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
      // industrial lobe: the far end of Main Street on the chosen side
      if (nearHighway && indSide * dx > r * 0.5) {
        w.district[t] = Districts.Industrial;
      } else if (nearHighway && Math.abs(dx) < r * 0.55) {
        // the strip itself is commercial; the very center blends into downtown
        w.district[t] = Math.abs(dx) < r * 0.2 ? Districts.Downtown : Districts.Commercial;
      } else if (d < r * 0.26) {
        w.district[t] = Districts.Downtown;
      } else if (d < r * 0.45) {
        w.district[t] = Districts.ResHigh; // apartments ring the core
      } else if (edge > 0.84) {
        w.district[t] = Districts.Trailer;
      } else {
        const sector = sectorOf(dx, dy);
        w.district[t] =
          sector === 0 ? Districts.OldTown : sector === 1 ? Districts.College : Districts.Suburbs;
      }
    }
  }

  return { cx, cy, r, highwayY, highwayX };
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
 * Farming v2 (§2 rev. 3): real farms sit ON the road. We collect the rural
 * road tiles (outside town, off the highway through-lanes), pick a few
 * ANCHORS along them, and at each anchor raise a farmstead beside the road —
 * then lay RECTANGULAR field parcels aligned to the road's axis on both
 * sides, separated by one-tile grass baulks, the way section land actually
 * divides. Parcels roll their use: crop fields, orchards (tree rows), or
 * fenced livestock pasture. Farms skip the desert biome.
 */
function layoutFarms(w: World, rng: RngState, town: TownShape): void {
  const { width, height } = w;
  const beltInner = town.r + 6;

  // candidate anchors: rural road/dirt tiles in raster order (deterministic)
  const candidates: number[] = [];
  for (let t = 0; t < w.terrain.length; t++) {
    if (w.terrain[t] !== Terrain.Road && w.terrain[t] !== Terrain.Dirt) continue;
    const x = t % width;
    const y = (t / width) | 0;
    if (x < 8 || y < 8 || x >= width - 8 || y >= height - 8) continue;
    const ddx = x - town.cx;
    const ddy = y - town.cy;
    if (ddx * ddx + ddy * ddy < beltInner * beltInner) continue;
    if (w.biome[t] === Biome.Desert) continue; // nothing grows out there
    // farmland hugging the riverbank reads wrong — keep a dry margin
    let nearWater = false;
    for (let oy = -5; oy <= 5 && !nearWater; oy++) {
      for (let ox = -5; ox <= 5 && !nearWater; ox++) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (w.terrain[ny * width + nx] === Terrain.Lake) nearWater = true;
      }
    }
    if (nearWater) continue;
    candidates.push(t);
  }
  if (candidates.length === 0) return;

  const farms = 3 + nextRange(rng, 3);
  const used: number[] = [];
  for (let f = 0; f < farms; f++) {
    // pick an anchor at least 14 tiles from other farms
    let anchor = -1;
    for (let attempt = 0; attempt < 20 && anchor < 0; attempt++) {
      const c = candidates[nextRange(rng, candidates.length)]!;
      const cx = c % width;
      const cy = (c / width) | 0;
      const clear = used.every((u) => {
        const ux = u % width;
        const uy = (u / width) | 0;
        return Math.abs(ux - cx) + Math.abs(uy - cy) >= 14;
      });
      if (clear) anchor = c;
    }
    if (anchor < 0) continue;
    used.push(anchor);

    const ax = anchor % width;
    const ay = (anchor / width) | 0;
    // road axis at the anchor: fields align to it
    const horiz =
      (ax > 0 && (w.terrain[anchor - 1] === Terrain.Road || w.terrain[anchor - 1] === Terrain.Dirt)) ||
      (ax < width - 1 && (w.terrain[anchor + 1] === Terrain.Road || w.terrain[anchor + 1] === Terrain.Dirt));

    // farmstead: 2–3 house lots directly beside the road on one side
    const homeSide = nextRange(rng, 2) === 0 ? 1 : -1;
    const houses = 2 + nextRange(rng, 2);
    for (let h = 0; h < houses; h++) {
      const x = horiz ? ax + h : ax + homeSide;
      const y = horiz ? ay + homeSide : ay + h;
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      const t = y * width + x;
      if (w.terrain[t] === Terrain.Grass) {
        w.terrain[t] = Terrain.Citizen;
        w.district[t] = Districts.Trailer;
      }
    }

    // field parcels: 2 per side of the road, aligned, 1-tile baulks between
    for (const side of [1, -1]) {
      let offset = side === homeSide ? 2 : 1; // clear the farmstead row
      for (let parcel = 0; parcel < 2; parcel++) {
        const along = 5 + nextRange(rng, 4); // length along the road
        const deep = 3 + nextRange(rng, 3); // depth away from it
        const roll = nextRange(rng, 10);
        const kind: Terrain =
          roll < 6 ? Terrain.Field : roll < 8 ? Terrain.Orchard : Terrain.Pasture;
        for (let a = 0; a < along; a++) {
          for (let d = 0; d < deep; d++) {
            const x = horiz ? ax - 2 + a : ax + side * (offset + d);
            const y = horiz ? ay + side * (offset + d) : ay - 2 + a;
            if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
            const t = y * width + x;
            if (w.terrain[t] === Terrain.Grass && w.biome[t] !== Biome.Desert) {
              w.terrain[t] = kind;
            }
          }
        }
        offset += deep + 1; // the grass baulk between parcels
      }
    }
    carveDirtLane(w, anchor);
  }
}

/**
 * Bridge corner-only diagonals across the whole path network (roads AND dirt
 * lanes together). Two path tiles that touch only at a corner don't read or
 * walk as connected; we fill one of the two open corner tiles so every
 * diagonal becomes a proper side-by-side elbow. Runs after all roads and lanes
 * are placed, so it also stitches dirt lanes into the paved grid. The bridge
 * tile takes the humbler class (Dirt unless both neighbours are paved Road).
 */
function orthogonalizePaths(w: World): void {
  const { width, height } = w;
  const isPath = (t: number): boolean =>
    w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Dirt;
  const passable = (t: number): boolean =>
    w.terrain[t] === Terrain.Grass ||
    w.terrain[t] === Terrain.Field ||
    w.terrain[t] === Terrain.Orchard ||
    w.terrain[t] === Terrain.Pasture;
  const fill = (t: number, a: number, b: number): void => {
    w.terrain[t] =
      w.terrain[a] === Terrain.Road && w.terrain[b] === Terrain.Road
        ? Terrain.Road
        : Terrain.Dirt;
  };
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const a = y * width + x;
      const b = a + 1;
      const c = a + width;
      const d = c + 1;
      // ↘ : a & d are path, b & c open → bridge through one corner
      if (isPath(a) && isPath(d) && !isPath(b) && !isPath(c)) {
        if (passable(b)) fill(b, a, d);
        else if (passable(c)) fill(c, a, d);
      }
      // ↙ : b & c are path, a & d open
      if (isPath(b) && isPath(c) && !isPath(a) && !isPath(d)) {
        if (passable(a)) fill(a, b, c);
        else if (passable(d)) fill(d, b, c);
      }
    }
  }
}

/** Label every 4-connected road/dirt tile by component; returns labels + sizes. */
function roadComponents(w: World): { label: Int32Array; sizes: number[] } {
  const { width, height } = w;
  const label = new Int32Array(width * height).fill(-1);
  const isPath = (t: number): boolean =>
    w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Dirt;
  const sizes: number[] = [];
  for (let t = 0; t < label.length; t++) {
    if (!isPath(t) || label[t]! >= 0) continue;
    const id = sizes.length;
    const stack = [t];
    label[t] = id;
    let n = 0;
    while (stack.length) {
      const c = stack.pop()!;
      n++;
      const x = c % width;
      const y = (c / width) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nt = ny * width + nx;
        if (isPath(nt) && label[nt]! < 0) {
          label[nt] = id;
          stack.push(nt);
        }
      }
    }
    sizes.push(n);
  }
  return { label, sizes };
}

/**
 * Stitch orphan road islands into the network. Streamline tracing and farm
 * lanes can leave a whole segment (a farm road, a stranded street, a length of
 * highway cut off by a gap) that never touches the main grid — it reads as a
 * road floating in a field. We find the largest component (the real network)
 * and, for every other one, carve the SHORTEST corridor back to it via a BFS
 * that routes around houses (so we never bulldoze a home) through open
 * country, painting Dirt over land and a Road bridge over water. Pathfinding
 * guarantees a connection wherever any clear route exists, so every road
 * actually goes somewhere.
 */
function connectRoadComponents(w: World): void {
  const { width, height } = w;
  const n = width * height;
  for (let guard = 0; guard < 16; guard++) {
    const { label, sizes } = roadComponents(w);
    if (sizes.length <= 1) return;
    let main = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i]! > sizes[main]!) main = i;

    // multi-source BFS outward from the main network across every tile a road
    // could be carved through (anything but a house lot).
    const dist = new Int32Array(n).fill(-1);
    const parent = new Int32Array(n).fill(-1);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    for (let t = 0; t < n; t++) {
      if (label[t] === main) {
        dist[t] = 0;
        queue[tail++] = t;
      }
    }
    while (head < tail) {
      const c = queue[head++]!;
      const x = c % width;
      const y = (c / width) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nt = ny * width + nx;
        if (dist[nt]! >= 0) continue;
        if (w.terrain[nt] === Terrain.Citizen) continue; // never route through a home
        dist[nt] = dist[c]! + 1;
        parent[nt] = c;
        queue[tail++] = nt;
      }
    }

    // the orphan road tile reachable in the fewest steps from the network
    let bestT = -1;
    let bestD = Infinity;
    for (let t = 0; t < n; t++) {
      const id = label[t]!;
      if (id < 0 || id === main || dist[t]! < 0) continue;
      if (dist[t]! < bestD) {
        bestD = dist[t]!;
        bestT = t;
      }
    }
    if (bestT < 0) return; // remaining orphans are walled off; prune handles them

    // backtrack to the network, paving the land tiles of the corridor
    let c = parent[bestT]!;
    while (c >= 0 && dist[c]! > 0) {
      const tr = w.terrain[c];
      if (
        tr === Terrain.Grass ||
        tr === Terrain.Field ||
        tr === Terrain.Woods ||
        tr === Terrain.Orchard ||
        tr === Terrain.Pasture
      )
        w.terrain[c] = Terrain.Dirt;
      else if (tr === Terrain.Lake) w.terrain[c] = Terrain.Road; // bridge water
      c = parent[c]!;
    }
  }
}

/**
 * Remove paved "roads to nowhere": streamline tracing can leave a road
 * dead-ending in an empty field or against a forest it couldn't cross. A real
 * road always goes somewhere — it serves lots, joins another road, reaches a
 * lane, or runs off the map. We iteratively erase any Road tile that is a
 * dead-end (≤1 road neighbour) AND serves nothing: not on the map border, no
 * adjacent house lot, and not touching a dirt lane. Eating these back to the
 * last useful tile leaves only connected, purposeful streets. Cults don't rely
 * on these — their compounds auto-carve their own dirt access lanes.
 */
function pruneRoadStubs(w: World): void {
  const { width, height } = w;
  const isRoad = (t: number): boolean => w.terrain[t] === Terrain.Road;
  // enough passes to eat an entire dangling spur back to its junction
  const maxPasses = width + height;
  for (let pass = 0; pass < maxPasses; pass++) {
    let removed = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const t = y * width + x;
        if (!isRoad(t)) continue;
        // road-degree: orthogonal road neighbours
        let deg = 0;
        for (const n of [t - 1, t + 1, t - width, t + width]) if (isRoad(n)) deg++;
        if (deg >= 2) continue; // through-tile or junction — keep
        // a road running off the map edge is a legit through-route (highway,
        // county road) — keep its approach.
        if (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2) continue;
        // does this endpoint serve anything?
        let serves = false;
        for (let dy = -1; dy <= 1 && !serves; dy++) {
          for (let dx = -1; dx <= 1 && !serves; dx++) {
            const n = (y + dy) * width + (x + dx);
            if (w.terrain[n] === Terrain.Citizen || w.terrain[n] === Terrain.Dirt) serves = true;
          }
        }
        if (serves) continue;
        w.terrain[t] = Terrain.Grass; // pointless stub → back to country
        removed++;
      }
    }
    if (removed === 0) break;
  }
}

/**
 * Carve a dirt lane from `from` to the nearest road tile as an L-PATH: one
 * straight run per axis with a single 90° elbow, exactly how a real farm
 * driveway meets a section road. No diagonals anywhere — the lane is two
 * axis-aligned runs, 4-connected by construction. Elbow orientation (x-first
 * vs y-first) is a pure hash of the endpoints, so it's deterministic and
 * varies lane to lane.
 */
export function carveDirtLane(w: World, from: number): void {
  const target = nearestRoad(w, from, 40);
  if (target < 0) return;
  const x0 = from % w.width;
  const y0 = (from / w.width) | 0;
  const x1 = target % w.width;
  const y1 = (target / w.width) | 0;
  const paint = (x: number, y: number): void => {
    const t = y * w.width + x;
    const tr = w.terrain[t];
    if (tr === Terrain.Grass || tr === Terrain.Field || tr === Terrain.Orchard || tr === Terrain.Pasture) {
      w.terrain[t] = Terrain.Dirt;
    }
  };
  const xFirst = ((from * 2654435761) >>> 0) % 2 === 0;
  if (xFirst) {
    for (let x = x0; x !== x1; x += Math.sign(x1 - x0)) paint(x, y0);
    for (let y = y0; y !== y1; y += Math.sign(y1 - y0)) paint(x1, y);
  } else {
    for (let y = y0; y !== y1; y += Math.sign(y1 - y0)) paint(x0, y);
    for (let x = x0; x !== x1; x += Math.sign(x1 - x0)) paint(x, y1);
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

/**
 * A meandering river down one side of the valley. Real towns sit on water —
 * we route a creek across the full map at a fixed offset to one side of the
 * town centre (so it never floods the streets), letting it wander with a few
 * sine harmonics, 1–2 tiles wide. Where it crosses an existing road we leave
 * the road intact: that gap reads as a BRIDGE. Banks meet land as sand
 * shoreline in the renderer, so the creek reads as flowing water, not a pond.
 */
function carveRiver(w: World, rng: RngState, town: TownShape): void {
  const { width, height } = w;
  // run roughly vertically (crossing the horizontal highway) down whichever
  // side has more room, offset well clear of the town footprint.
  const jitter = nextRange(rng, 8);
  // run the channel down whichever side of town has more open country, far
  // enough out to clear the streets but clamped to stay on the map.
  const rightRoom = width - town.cx;
  const leftRoom = town.cx;
  const side = rightRoom >= leftRoom ? 1 : -1;
  const room = side === 1 ? rightRoom : leftRoom;
  if (room < town.r + 8) return; // town fills this side: no room for a river
  const off = Math.min(town.r + 6 + jitter, room - 6);
  if (off <= town.r + 2) return; // would cut through the streets
  const baseX = town.cx + side * off;
  if (baseX < 4 || baseX > width - 5) return;
  const a1 = 4 + nextRange(rng, 5); // meander amplitudes
  const a2 = 2 + nextRange(rng, 3);
  const k1 = 0.05 + nextRange(rng, 4) / 100;
  const k2 = 0.13 + nextRange(rng, 6) / 100;
  const p1 = nextRange(rng, 628) / 100;
  const drift = (nextRange(rng, 21) - 10) / 100; // slow lateral lean
  // pass 1: the meander path
  const cxs: number[] = [];
  for (let y = 0; y < height; y++) {
    const cxF = baseX + a1 * Math.sin(k1 * y + p1) + a2 * Math.sin(k2 * y) + drift * (y - height / 2);
    cxs.push(Math.round(cxF));
  }
  // pass 2: STRAIGHTEN THE CHANNEL THROUGH ROAD CROSSINGS. A meander that
  // shifts columns mid-crossing staggers the bridge deck into a diagonal;
  // real bridges cross the water square-on. Wherever a road row intersects
  // the channel, freeze the channel column for the rows around it.
  for (let y = 0; y < height; y++) {
    const cx = cxs[y]!;
    let roadHere = false;
    for (let dx = -2; dx <= 2 && !roadHere; dx++) {
      const x = cx + dx;
      if (x < 1 || x >= width - 1) continue;
      if (w.terrain[y * width + x] === Terrain.Road) roadHere = true;
    }
    if (!roadHere) continue;
    for (let oy = -2; oy <= 2; oy++) {
      const yy = y + oy;
      if (yy >= 0 && yy < height) cxs[yy] = cx;
    }
  }
  for (let y = 0; y < height; y++) {
    const cx = cxs[y]!;
    const hw = 1; // 3-tile-wide channel
    for (let dx = -hw; dx <= hw; dx++) {
      const x = cx + dx;
      if (x < 1 || x >= width - 1) continue;
      const t = y * width + x;
      const tr = w.terrain[t];
      // never destroy roads (bridge), town lots, or existing nature
      if (tr === Terrain.Grass || tr === Terrain.Field) w.terrain[t] = Terrain.Lake;
    }
  }
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
  const tryPlace = (r: number, kind: Terrain, wantBiome = -1): void => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const bx = nextRange(rng, width);
      const by = nextRange(rng, height);
      const ddx = bx - town.cx;
      const ddy = by - town.cy;
      // keep a clear margin around the town so there's room to build
      if (ddx * ddx + ddy * ddy < (town.r + r + 6) * (town.r + r + 6)) continue;
      const bio = w.biome[by * width + bx]!;
      // woods stay out of the desert (sparse cactus stands come later); a
      // targeted placement keeps trying until it lands in the wanted biome
      if (kind === Terrain.Woods && bio === Biome.Desert) continue;
      if (wantBiome >= 0 && bio !== wantBiome) continue;
      organicBlob(w, rng, bx, by, r, kind);
      return;
    }
  };
  // lake first so forests can hug it
  tryPlace(6 + nextRange(rng, 5), Terrain.Lake);
  for (let i = 0; i < forests; i++) tryPlace(8 + nextRange(rng, 6), Terrain.Woods);
  for (let i = 0; i < copses; i++) tryPlace(3 + nextRange(rng, 3), Terrain.Woods);
  // FOREST biome earns its name: extra dense stands inside its blobs
  let hasForestBiome = false;
  for (let t = 0; t < w.biome.length; t += 7) {
    if (w.biome[t] === Biome.Forest) {
      hasForestBiome = true;
      break;
    }
  }
  if (hasForestBiome) {
    for (let i = 0; i < 3; i++) tryPlace(6 + nextRange(rng, 5), Terrain.Woods, Biome.Forest);
  }
  // DESERT gets sparse cactus stands (rendered as cacti, not canopy)
  let hasDesert = false;
  for (let t = 0; t < w.biome.length; t += 7) {
    if (w.biome[t] === Biome.Desert) {
      hasDesert = true;
      break;
    }
  }
  if (hasDesert) {
    for (let i = 0; i < 4; i++) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const bx = nextRange(rng, width);
        const by = nextRange(rng, height);
        const t = by * width + bx;
        if (w.biome[t] !== Biome.Desert || w.terrain[t] !== Terrain.Grass) continue;
        // a small stand: center + a couple of neighbors
        w.terrain[t] = Terrain.Woods;
        if (bx + 2 < width && w.terrain[t + 2]! === Terrain.Grass) w.terrain[t + 2] = Terrain.Woods;
        if (by + 1 < height && w.terrain[t + width]! === Terrain.Grass) w.terrain[t + width] = Terrain.Woods;
        break;
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

/**
 * Final dead-end sweep (§2 rev. 3): after everything is placed, iteratively
 * eat back ANY path tile (road or dirt) that dead-ends without purpose — not
 * at the map edge, no adjacent lot/landmark, no building. Cul-de-sac bulbs
 * survive (their end tiles have degree ≥ 2 and homes around them); farm and
 * dock lanes survive (they end at lots). What disappears is the literal
 * "street to nowhere".
 */
function pruneAllDeadEnds(w: World): void {
  const { width, height } = w;
  const isPath = (t: number): boolean =>
    w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Dirt;
  for (let pass = 0; pass < width + height; pass++) {
    let removed = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const t = y * width + x;
        if (!isPath(t)) continue;
        let deg = 0;
        for (const n of [t - 1, t + 1, t - width, t + width]) if (isPath(n)) deg++;
        if (deg >= 2) continue;
        if (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2) continue; // map-edge exits live
        let serves = false;
        for (let dy = -1; dy <= 1 && !serves; dy++) {
          for (let dx = -1; dx <= 1 && !serves; dx++) {
            const n = (y + dy) * width + (x + dx);
            if (w.terrain[n] === Terrain.Citizen || w.landmark[n] !== 0) serves = true;
          }
        }
        if (serves) continue;
        w.terrain[t] = Terrain.Grass;
        removed++;
      }
    }
    if (removed === 0) break;
  }
}

/**
 * Infill housing: if a seed's town comes up short of the population floor,
 * convert yard/garden lots (pop below their district's household minimum)
 * into modest homes, in raster order, until the floor holds. Real towns do
 * exactly this — empty parcels fill in as the town needs the housing — and
 * it keeps map generation from ballooning the footprint on unlucky seeds.
 */
function infillToFloor(w: World, rng: RngState): void {
  let pop = countTotalPop(w);
  const way = (t: number): boolean =>
    t >= 0 &&
    t < w.terrain.length &&
    (w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Dirt || w.terrain[t] === Terrain.Path);
  for (let t = 0; t < w.terrain.length && pop < MIN_TOTAL_POP; t++) {
    if (w.terrain[t] !== Terrain.Citizen || w.lot[t] !== 0) continue;
    // infill homes must have street/path access — never recreate orphans
    const x = t % w.width;
    const y = (t / w.width) | 0;
    const hasWay =
      (x > 0 && way(t - 1)) ||
      (x < w.width - 1 && way(t + 1)) ||
      (y > 0 && way(t - w.width)) ||
      (y < w.height - 1 && way(t + w.width));
    if (!hasWay) continue;
    const d = w.district[t]!;
    const [lo, hi] = POP_RANGE[d] ?? [2, 4];
    if (lo > 0 && w.pop[t]! < lo) {
      const target = Math.min(15, lo + nextRange(rng, Math.max(1, hi - lo)));
      pop += target - w.pop[t]!;
      w.pop[t] = target;
    }
  }
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
