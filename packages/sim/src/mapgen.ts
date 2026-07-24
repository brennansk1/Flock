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
import { seedRng, nextRange, nextU32, type RngState } from "./rng.js";
import { Terrain, Biome, Landmark, Lot, type World, type DistrictCoeffs } from "./types.js";
import { traceGridRoads } from "./gridRoads.js";
import { pickTownName, type Street } from "./names.js";
import { createWorld } from "./sim.js";

/** Deterministic position hash for walk jitter (no rng thread needed). */
function pixHash32(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * TERRAIN FIELDS v2 (§2 rev. 6, reviewer finding #8): a coarse elevation +
 * moisture pair generated FIRST, driving hydrology (the river descends the
 * terrain), biomes (dry tail → desert, wet tail → forest), and vegetation
 * (stands seek moisture, the lake seeks low ground). Value noise on the
 * pixHash lattice with smoothstep bilinear interpolation — multiplies and
 * adds only, so every JS engine computes the fields bit-identically.
 * Generation-local: never stored on World, never hashed, never snapshotted.
 */
interface TerrainFields {
  elev: Float64Array;
  moist: Float64Array;
}

function fieldOctave(salt: number, x: number, y: number, cell: number): number {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = x / cell - gx;
  const fy = y / cell - gy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const h = (ix: number, iy: number): number => pixHash32(ix, iy, salt) / 4294967296;
  const a = h(gx, gy);
  const b = h(gx + 1, gy);
  const c = h(gx, gy + 1);
  const d = h(gx + 1, gy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function buildFields(w: World, rng: RngState): TerrainFields {
  const { width, height } = w;
  const eSalt = nextU32(rng) | 1;
  const mSalt = nextU32(rng) | 1;
  const elev = new Float64Array(width * height);
  const moist = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = y * width + x;
      // headwaters north, outflow south: a gentle valley grade the drainage
      // follows, roughened by two octaves of coarse noise
      const grade = 1 - y / height;
      const eNoise = 0.7 * fieldOctave(eSalt, x, y, 24) + 0.3 * fieldOctave(eSalt ^ 0x9e37, x, y, 9);
      elev[t] = 0.55 * grade + 0.45 * eNoise;
      moist[t] = 0.72 * fieldOctave(mSalt, x, y, 22) + 0.28 * fieldOctave(mSalt ^ 0x85eb, x, y, 8);
    }
  }
  return { elev, moist };
}

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
  [Districts.Suburbs]: [4, 8],
  [Districts.College]: [5, 10],
  [Districts.Downtown]: [7, 13],
  [Districts.OldTown]: [3, 6],
  [Districts.Trailer]: [2, 5],
  [Districts.Commercial]: [4, 8], // clerks + upstairs flats
  [Districts.Industrial]: [3, 6], // shift crews
  [Districts.ResHigh]: [9, 15], // apartment blocks
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

/**
 * Scale the population floors with map area (§18 pacing): the 96×96 classic
 * carries ~2900 souls — the number the conversion-rate + match-length math is
 * tuned around (8–20 min, DESIGN Part I). A 64×64 skirmish town shrinks
 * proportionally (faster match), a 128×128 large town grows (longer match),
 * so souls-per-cult stays roughly constant across sizes.
 */
function popFloors(width: number, height: number): { tiles: number; pop: number } {
  const scale = (width * height) / (96 * 96);
  return {
    tiles: Math.max(280, Math.round(MIN_POPULATED_TILES * scale)),
    pop: Math.max(1300, Math.round(MIN_TOTAL_POP * scale)),
  };
}

/** Biome names accepted by `MapOpts.biomes` (order-independent, deduped). */
export type BiomeName = "desert" | "forest" | "autumn";

/**
 * Town archetypes (§2A): a coherent package of geography + economy +
 * signature assets. "farm" is the default and reproduces the classic
 * generator byte-for-byte (the archetype pass is skipped entirely).
 */
export type TownType = "farm" | "oceanside" | "desert" | "mountain" | "lakeside";

/** Map-generation options — the user-configurable knobs (§2 rev. 3). */
export interface MapOpts {
  /**
   * Which accent biomes may spawn as blobs in the open country. Defaults to
   * both. Pass `[]` for a pure temperate map. (Server: FLOCK_BIOMES env.)
   */
  biomes?: BiomeName[];
  /** Town archetype (§2A). Defaults to "farm" — the classic generator. */
  townType?: TownType;
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
    // §2 rev. 6: elevation + moisture come FIRST — geography before geometry
    const fields = buildFields(w, rng);

    const town = layoutHighwaysAndTown(w, rng, rScale);
    layoutRail(w, rng, town); // the railroad the town was built on (§2 rev. 5)
    // archetype (§2A): desert/mountain towns sit inside a dominant biome
    const townType: TownType = opts.townType ?? "farm";
    const dominant =
      townType === "desert" ? Biome.Desert : townType === "mountain" ? Biome.Forest : -1;
    paintBiomes(w, rng, town, opts.biomes ?? ["desert", "forest", "autumn"], dominant, fields);
    const riverPath = carveRiver(w, rng, town, fields);
    scatterExurbs(w, rng, town);
    // nature FIRST, then farming: forests must never chew through planted
    // parcels — fields wrap around standing timber, not the reverse (QA S1-B)
    placeNature(w, rng, town, riverPath, fields);
    if (riverPath) connectLakesToRiver(w, riverPath); // no disconnected lakes
    layoutFarms(w, rng, town);
    fillFarmBelt(w, rng, town); // contiguous working farmland, not islands
    placeTownBuildings(w, rng, town);
    placeDocks(w, rng, town);
    // RAIL SPUR (§5): a stub track branches from the main line into the
    // industrial lobe — the works get their own siding
    {
      let done = false;
      for (let t = 0; t < w.terrain.length && !done; t++) {
        if (w.terrain[t] !== Terrain.Rail) continue;
        const x = t % width;
        const y = (t / width) | 0;
        if (x < 6 || x >= width - 6) continue;
        for (const dir of [-1, 1]) {
          // an industrial lot within 5 rows of the line?
          for (let step = 2; step <= 5; step++) {
            const n = (y + dir * step) * width + x;
            if (n < 0 || n >= w.terrain.length) break;
            if (w.district[n] === Districts.Industrial && w.terrain[n] === Terrain.Citizen) {
              // carve the stub up to (not into) the lot
              let ok = true;
              for (let s = 1; s < step; s++) {
                const st = (y + dir * s) * width + x;
                const tr = w.terrain[st];
                if (tr !== Terrain.Grass && tr !== Terrain.Field && tr !== Terrain.Dirt) ok = false;
              }
              if (!ok) break;
              for (let s = 1; s < step; s++) w.terrain[(y + dir * s) * width + x] = Terrain.Rail;
              done = true;
              break;
            }
          }
          if (done) break;
        }
      }
    }
    // TRAILER COURT (§6): the fringe isn't just scattered singles — one
    // proper court: a short dirt lane off a street with trailers flanking it
    {
      let courtDone = false;
      for (let t = 0; t < w.terrain.length && !courtDone; t++) {
        if (w.district[t] !== Districts.Trailer || w.terrain[t] !== Terrain.Citizen) continue;
        const x = t % width;
        const y = (t / width) | 0;
        if (x < 6 || y < 6 || x >= width - 6 || y >= height - 6) continue;
        // a road to hang the court off?
        let roadDir = 0;
        if (w.terrain[t - width] === Terrain.Road) roadDir = 1; // court runs south
        else if (w.terrain[t + width] === Terrain.Road) roadDir = -1; // runs north
        if (roadDir === 0) continue;
        // room for a 4-tile lane with clear flanks?
        let clear = true;
        for (let s = 0; s < 4 && clear; s++) {
          const ly = y + roadDir * s;
          for (const lx of [x - 1, x, x + 1]) {
            const n = ly * width + lx;
            if (n < 0 || n >= w.terrain.length) { clear = false; break; }
            const tr = w.terrain[n];
            if (tr !== Terrain.Grass && tr !== Terrain.Citizen && tr !== Terrain.Field) clear = false;
          }
        }
        if (!clear) continue;
        for (let s = 0; s < 4; s++) {
          const ly = y + roadDir * s;
          w.terrain[ly * width + x] = Terrain.Dirt; // the court lane
          for (const lx of [x - 1, x + 1]) {
            const n = ly * width + lx;
            w.terrain[n] = Terrain.Citizen;
            w.district[n] = Districts.Trailer;
            if (w.lot[n] === 0) w.pop[n] = 3; // a trailer household
          }
        }
        courtDone = true;
      }
    }
    // §2A: the archetype reshapes geography/economy; "farm" skips entirely
    if (townType !== "farm") applyTownArchetype(w, rng, town, townType, riverPath);
    // §2A oceanside: the harbor, not the elevator, anchors the economy —
    // the grain elevator (and its boxcars) yields to a second cannery house
    if (townType === "oceanside") {
      for (let t = 0; t < w.terrain.length; t++) {
        if (w.lot[t] === Lot.GrainElevator) w.lot[t] = Lot.Cannery;
      }
    }
    // QUARRY SCAR (§11): one gravel pit gouged into deep country, off-road
    for (let attempt = 0; attempt < 40; attempt++) {
      const qx = 8 + nextRange(rng, width - 16);
      const qy = 8 + nextRange(rng, height - 16);
      const ddx = qx - town.cx;
      const ddy = qy - town.cy;
      if (ddx * ddx + ddy * ddy < (town.r + 14) * (town.r + 14)) continue;
      let clear = true;
      for (let dy = -1; dy <= 3 && clear; dy++)
        for (let dx = -1; dx <= 4 && clear; dx++) {
          const t = (qy + dy) * width + qx + dx;
          if (w.terrain[t] !== Terrain.Grass || w.biome[t] === Biome.Desert) clear = false;
        }
      if (!clear) continue;
      for (let dy = 0; dy <= 2; dy++)
        for (let dx = 0; dx <= 3 - (dy === 2 ? 1 : 0); dx++)
          w.terrain[(qy + dy) * width + qx + dx] = Terrain.Dirt;
      // HAUL ROAD (quality pass): a working pit ships gravel — carve the
      // access lane so the pit joins the path network instead of floating
      // as an orphan dirt pocket (the B1.4.19 connectivity dips)
      carveDirtLane(w, qy * width + qx);
      break;
    }
    // Alleys behind Main Street commerce: Horizontal dirt/gravel lanes at hy-2 and hy+3 (#1)
    {
      const hy = town.highwayY;
      const startX = town.cx - town.r;
      const endX = town.cx + town.r;
      for (const y of [hy - 2, hy + 3]) {
        if (y > 1 && y < w.height - 2) {
          for (let x = startX + 4; x <= endX - 4; x++) {
            const t = y * w.width + x;
            if (w.terrain[t] === Terrain.Grass || w.terrain[t] === Terrain.Field) {
              w.terrain[t] = Terrain.Dirt;
            }
          }
        }
      }
    }
    placeLandmarks(w, town);
    orthogonalizePaths(w); // safety net: bridge any corner-only path contact
    extendEdgeRoads(w);
    connectRoadComponents(w); // stitch orphan road islands into the main grid
    pruneRoadStubs(w); // erase whatever still leads nowhere
    pruneAllDeadEnds(w); // …including dirt lanes and orphaned spurs
    clearEnclosedFarmland(w); // no lone crop patch stranded inside a wood
    carveBlockAlleys(w); // dirt service alleys thread the deep block interiors
    rollLots(w, rng);
    enforceRoadFrontage(w); // houses FRONT the street; interiors are yards
    infillToFloor(w, rng); // yards become modest homes until the pop floor holds

    const floors = popFloors(width, height);
    if (countPopulated(w) >= floors.tiles && countTotalPop(w) >= floors.pop) break;
  }
  return w;
}

/**
 * The RAILROAD (§2 rev. 5, review finding #2): farm towns exist because of
 * the rail line. One straight alignment parallels the highway a few blocks
 * off, running the full map width; roads keep their pavement where they
 * cross (level crossings — the renderer draws the tracks over the asphalt
 * and posts the crossbucks). The grain elevator and depot anchor a siding
 * where the line passes the industrial edge of town.
 */
function layoutRail(w: World, rng: RngState, town: TownShape): void {
  const { width, height } = w;
  // candidate rows on both sides of the highway; take the one that crosses
  // the fewest streets — a right-of-way never runs ALONG an avenue
  const preferred = nextRange(rng, 2) === 0 ? -1 : 1;
  let railY = -1;
  let bestRoads = Infinity;
  for (const sd of [preferred, -preferred]) {
    for (let off = 5; off <= 9; off++) {
      const y = Math.max(3, Math.min(height - 4, town.highwayY + sd * off));
      let roads = 0;
      for (let x = 0; x < width; x++) if (w.terrain[y * width + x] === Terrain.Road) roads++;
      if (roads < bestRoads) {
        bestRoads = roads;
        railY = y;
      }
    }
  }
  const side = railY > town.highwayY ? 1 : -1;
  for (let x = 0; x < width; x++) {
    const t = railY * width + x;
    const tr = w.terrain[t];
    // the right-of-way predates the houses: it claims open ground AND
    // unbuilt town lots; only pavement (level crossings) and water (trestle
    // approaches stay rail via the grass check upstream) interrupt it
    if (tr === Terrain.Grass || tr === Terrain.Field || (tr === Terrain.Citizen && w.lot[t] === 0)) {
      w.terrain[t] = Terrain.Rail;
    }
  }
  // the SIDING: a short parallel spur one row off, at the town's edge —
  // try both ends of town until the elevator AND depot both stand
  const sideY = railY + side;
  const plant = (lotKind: number, x: number, y: number, wide: number, workers: number): number => {
    let placed = 0;
    for (let dx = 0; dx < wide; dx++) {
      const xx = x + dx;
      if (xx < 1 || xx >= width - 1 || y < 1 || y >= height - 1) continue;
      const t = y * width + xx;
      const tr = w.terrain[t];
      // open ground or an unbuilt lot — the works claim their ground
      if (tr !== Terrain.Grass && tr !== Terrain.Field && !(tr === Terrain.Citizen && w.lot[t] === 0))
        continue;
      w.terrain[t] = Terrain.Citizen;
      w.district[t] = Districts.Industrial;
      w.lot[t] = lotKind;
      w.pop[t] = Math.min(15, Math.max(2, workers));
      placed++;
    }
    return placed;
  };
  if (sideY > 2 && sideY < height - 3) {
    const firstEnd = nextRange(rng, 2) === 0 ? -1 : 1;
    for (const end of [firstEnd, -firstEnd]) {
      const sx0 = town.cx + end * (town.r - 2);
      const buildY = sideY + side; // one further row off the siding
      if (buildY <= 1 || buildY >= height - 2) continue;
      const elev = plant(Lot.GrainElevator, sx0 - 1, buildY, 2, 6);
      const depot = plant(Lot.Depot, sx0 + 2, buildY, 2, 4);
      if (elev === 0 && depot === 0) continue; // this end is blocked — try the other
      for (let x = sx0 - 4; x <= sx0 + 4; x++) {
        if (x < 1 || x >= width - 1) continue;
        const t = sideY * width + x;
        const tr = w.terrain[t];
        if (tr === Terrain.Grass || tr === Terrain.Field || (tr === Terrain.Citizen && w.lot[t] === 0))
          w.terrain[t] = Terrain.Rail;
      }
      carveDirtLane(w, buildY * width + sx0);
      if (elev > 0 && depot > 0) break;
    }
  }
}

/**
 * Biome blobs (§2 rev. 3): user-configurable accent biomes stamped as organic
 * blobs in the open country, well clear of the town. The biome layer reskins
 * the land in the renderer (desert sand + cacti, deep forest) and steers
 * nature/farm placement — farms stay out of the desert, forests grow thicker
 * in forest biome.
 */
function paintBiomes(
  w: World,
  rng: RngState,
  town: TownShape,
  biomes: BiomeName[],
  dominant: number = -1,
  fields: TerrainFields,
): void {
  const { width, height } = w;
  const rimSalt = nextU32(rng) | 1; // drawn unconditionally: stable stream shape
  // ARCHETYPE DOMINANT BIOME (§2A): desert/mountain towns sit INSIDE their
  // biome — one mega-blob covers the whole countryside; the town core and a
  // working margin around it stay temperate (the oasis/valley the town holds).
  if (dominant >= 0) {
    const clear = town.r + 5;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const ddx = x - town.cx;
        const ddy = y - town.cy;
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        // fringe wobble so the valley rim never reads as a circle —
        // field noise instead of sine harmonics (no transcendentals)
        const rim = clear * (1 + 0.6 * (fieldOctave(rimSalt, x, y, 7) - 0.5));
        if (d > rim) w.biome[y * width + x] = dominant;
      }
    }
    return;
  }
  // MOISTURE-GATED BIOMES (§2 rev. 6): the dry tail of the moisture field is
  // desert, the wet tail is forest, a mid-wet band turns autumn — coherent
  // low-frequency patches, sized by countryside quantiles to match the old
  // blob footprint. Fixed processing order keeps the config deterministic.
  const wanted = new Set([...new Set(biomes)].sort());
  if (!wanted.size) return;
  const margin2 = (town.r + 6) * (town.r + 6);
  const vals: number[] = [];
  for (let t = 0; t < w.biome.length; t++) {
    const x = t % width;
    const y = (t / width) | 0;
    const ddx = x - town.cx;
    const ddy = y - town.cy;
    if (ddx * ddx + ddy * ddy < margin2) continue;
    vals.push(fields.moist[t]!);
  }
  if (!vals.length) return;
  vals.sort((a, b) => a - b);
  const q = (p: number): number => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))]!;
  const dryMax = q(0.06);
  const autLo = q(0.7);
  const autHi = q(0.76);
  const wetMin = q(0.94);
  for (let t = 0; t < w.biome.length; t++) {
    const x = t % width;
    const y = (t / width) | 0;
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
    const ddx = x - town.cx;
    const ddy = y - town.cy;
    if (ddx * ddx + ddy * ddy < margin2) continue; // the town holds temperate ground
    const m = fields.moist[t]!;
    if (wanted.has("desert") && m <= dryMax) w.biome[t] = Biome.Desert;
    else if (wanted.has("forest") && m >= wetMin) w.biome[t] = Biome.Forest;
    else if (wanted.has("autumn") && m >= autLo && m <= autHi) w.biome[t] = Biome.Autumn;
  }
}

/**
 * Houses FRONT the street (§2 rev. 4): a lot only carries a full household if
 * it touches a Road orthogonally — like a real plat, homes line the block
 * edges and the block interiors are backyards. Anything deeper is demoted to
 * a yard/garden. (The old footpath corridors are gone: no more gray path
 * tiles cutting through blocks.)
 */
function enforceRoadFrontage(w: World): void {
  const { width, height } = w;
  const road = (t: number): boolean =>
    t >= 0 && t < w.terrain.length && (w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Dirt);
  for (let t = 0; t < w.terrain.length; t++) {
    if (w.terrain[t] !== Terrain.Citizen || w.pop[t]! < 3 || w.lot[t] !== 0) continue;
    const x = t % width;
    const y = (t / width) | 0;
    const fronted =
      (x > 0 && road(t - 1)) ||
      (x < width - 1 && road(t + 1)) ||
      (y > 0 && road(t - width)) ||
      (y < height - 1 && road(t + width));
    if (!fronted) w.pop[t] = 1 + (((t * 2654435761) >>> 0) % 2); // backyard
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

  /** is the wLots×hLots footprint at (x,y) all-citizen, in-district, lot-free? */
  const fits = (x: number, y: number, wLots: number, hLots: number, district: number): boolean => {
    for (let dy = 0; dy < hLots; dy++) {
      for (let dx = 0; dx < wLots; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 1 || yy < 1 || xx >= width - 1 || yy >= w.height - 1) return false;
        const t = yy * width + xx;
        if (w.terrain[t] !== Terrain.Citizen || w.district[t] !== district || w.lot[t] !== 0)
          return false;
      }
    }
    return true;
  };

  /** commercial frontage: the footprint touches a road on ANY side */
  const fronted = (x: number, y: number, wLots: number, hLots: number): boolean => {
    for (let dx = 0; dx < wLots; dx++) {
      const below = (y + hLots) * width + x + dx;
      const above = (y - 1) * width + x + dx;
      if (y + hLots < w.height && w.terrain[below] === Terrain.Road) return true;
      if (y - 1 >= 0 && w.terrain[above] === Terrain.Road) return true;
    }
    for (let dy = 0; dy < hLots; dy++) {
      const left = (y + dy) * width + x - 1;
      const right = (y + dy) * width + x + wLots;
      if (x - 1 >= 0 && w.terrain[left] === Terrain.Road) return true;
      if (x + wLots < width && w.terrain[right] === Terrain.Road) return true;
    }
    return false;
  };

  const claim = (x: number, y: number, wLots: number, hLots: number, lotKind: number, workers: number): void => {
    for (let dy = 0; dy < hLots; dy++) {
      for (let dx = 0; dx < wLots; dx++) {
        const t = (y + dy) * width + x + dx;
        w.lot[t] = lotKind;
        w.pop[t] = Math.min(15, Math.max(2, Math.floor(workers / (wLots * hLots))));
      }
    }
  };

  /**
   * Stamp a wLots×hLots building on a road-fronting, in-district footprint.
   * `scan=true` (keystones/anchors) enumerates EVERY valid placement and
   * rng-picks one — random throws almost never hit the couple of legal
   * anchor spots in a 25-tile downtown, which quietly shrank every civic
   * anchor to 1×1. Flavor lots keep cheap random sampling.
   */
  const stamp = (
    lotKind: number,
    wLots: number,
    hLots: number,
    district: number,
    workers: number,
    tries = 60,
    scan = false,
  ): boolean => {
    if (scan) {
      const spots: Array<[number, number]> = [];
      for (let y = 1; y < w.height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          if (fits(x, y, wLots, hLots, district) && fronted(x, y, wLots, hLots)) spots.push([x, y]);
        }
      }
      if (spots.length === 0) return false;
      const [x, y] = spots[nextRange(rng, spots.length)]!;
      claim(x, y, wLots, hLots, lotKind, workers);
      return true;
    }
    for (let attempt = 0; attempt < tries; attempt++) {
      const x = town.cx - town.r + nextRange(rng, town.r * 2);
      const y = town.cy - town.r + nextRange(rng, town.r * 2);
      if (!fits(x, y, wLots, hLots, district) || !fronted(x, y, wLots, hLots)) continue;
      claim(x, y, wLots, hLots, lotKind, workers);
      return true;
    }
    return false;
  };

  /**
   * FRONT-LOT STAMP (§2 rev. 6): the big civic anchors park IN FRONT — the
   * building sets back one row and a Parking strip spans its whole frontage,
   * touching the street, exactly like a real school/grocery/firehall. Tries
   * placements where the footprint sits one row off a road with the strip
   * between them; prefers a south frontage (the drawn facade faces south).
   */
  const stampFront = (
    lotKind: number,
    wLots: number,
    hLots: number,
    district: number,
    workers: number,
  ): boolean => {
    // sides in preference order: S (facade faces the viewer), E, W, N
    const SIDES: Array<[number, number]> = [
      [0, 1],
      [1, 0],
      [-1, 0],
      [0, -1],
    ];
    /** valid strip for footprint (x,y) on side s, or null */
    const stripFor = (x: number, y: number, sdx: number, sdy: number): number[] | null => {
      const span = sdy !== 0 ? wLots : hLots;
      const strip: number[] = [];
      let roadTouch = 0;
      for (let i = 0; i < span; i++) {
        const sx = sdy !== 0 ? x + i : sdx > 0 ? x + wLots : x - 1;
        const sy = sdx !== 0 ? y + i : sdy > 0 ? y + hLots : y - 1;
        if (sx < 1 || sy < 1 || sx >= width - 1 || sy >= w.height - 1) return null;
        const st = sy * width + sx;
        if (w.terrain[st] !== Terrain.Citizen || w.lot[st] !== 0) return null;
        strip.push(st);
        const beyond = (sy + sdy) * width + (sx + sdx);
        if (beyond >= 0 && beyond < w.terrain.length && w.terrain[beyond] === Terrain.Road)
          roadTouch++;
      }
      // jittered plats fray corners: a majority of the strip on asphalt is
      // a real curb cut; zero road contact is a parking lot to nowhere
      return roadTouch >= (span + 1) >> 1 ? strip : null;
    };
    // full scan (random throws can't find the couple of legal spots in a
    // small district); candidates grouped by side so south frontage wins
    const tiers: Array<Array<{ x: number; y: number; strip: number[] }>> = [[], [], [], []];
    for (let y = 1; y < w.height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (!fits(x, y, wLots, hLots, district)) continue;
        for (let si = 0; si < SIDES.length; si++) {
          const strip = stripFor(x, y, SIDES[si]![0], SIDES[si]![1]);
          if (strip) {
            tiers[si]!.push({ x, y, strip });
            break;
          }
        }
      }
    }
    for (const tier of tiers) {
      if (tier.length === 0) continue;
      const pick = tier[nextRange(rng, tier.length)]!;
      claim(pick.x, pick.y, wLots, hLots, lotKind, workers);
      for (const st of pick.strip) {
        w.lot[st] = Lot.Parking;
        w.pop[st] = 0;
      }
      return true;
    }
    return false;
  };

  /** The anchors whose parking belongs on their frontage, not beside them. */
  const FRONT_LOT = new Set<number>([
    Lot.Supermarket,
    Lot.School,
    Lot.HighSchool,
    Lot.Sheriff,
    Lot.FireStation,
    Lot.Cinema,
    Lot.Factory,
    Lot.Office,
  ]);

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
    // shrink gracefully: full size, then 2×2 / 2×1 — a smaller anchor with a
    // real footprint beats collapsing straight to a 1×1 nobody can read
    const sizes: Array<[number, number]> = [[wLots, hLots]];
    if (wLots * hLots > 4) sizes.push([2, 2]);
    if (wLots * hLots > 2) sizes.push([2, 1]);
    // front-lot anchors try the setback-with-frontage-parking placement first
    if (FRONT_LOT.has(lotKind)) {
      for (const [sw, sh] of sizes) {
        for (const d of districts) {
          if (stampFront(lotKind, sw, sh, d, workers)) return;
        }
      }
    }
    for (const [sw, sh] of sizes) {
      for (const d of districts) {
        if (stamp(lotKind, sw, sh, d, workers, 60, true)) return;
      }
    }
    // shrink to 1×1 and try again before brute force
    for (const d of districts) {
      if (stamp(lotKind, 1, 1, d, workers, 60, true)) return;
    }
    // force-place: NEAREST road-fronting, lot-free citizen tile to the town
    // center (the old raster scan started at the map corner, so a grocery
    // could land on a farmstead 30 tiles out — QA DowntownSweep S1)
    for (let radius = 0; radius < Math.max(width, w.height); radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const x = town.cx + dx;
          const y = town.cy + dy;
          if (x < 1 || y < 1 || x >= width - 1 || y >= w.height - 1) continue;
          const t = y * width + x;
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
      }
    }
  };

  /**
   * DOWNTOWN CORE GUARANTEE (quality sweep): the flavor anchors a real Main
   * Street cannot be missing — bank, post office, the works. Try each size
   * across the district fallback chain; a smaller footprint downtown beats
   * a perfect footprint nowhere (pre-sweep: Factory missing on 4/6 seeds,
   * PostOffice on 5/6). No brute force: a cinema in a cornfield is worse
   * than no cinema, so a full miss stays a miss — the test gate will say so.
   */
  const anchor = (
    lotKind: number,
    sizes: Array<[number, number]>,
    districts: number[],
    workers: number,
  ): void => {
    if (FRONT_LOT.has(lotKind)) {
      for (const [aw, ah] of sizes) {
        for (const d of districts) {
          if (stampFront(lotKind, aw, ah, d, workers)) return;
        }
      }
    }
    for (const [aw, ah] of sizes) {
      for (const d of districts) {
        if (stamp(lotKind, aw, ah, d, workers, 60, true)) return;
      }
    }
    // deterministic last resort: random throws rarely hit the few free
    // tiles of a 28-tile district — scan for the nearest free road-fronted
    // tile IN a listed district instead. Only a genuinely full district
    // chain leaves the anchor missing.
    let bestT = -1;
    let bestD2 = Infinity;
    for (let t = 0; t < w.terrain.length; t++) {
      if (w.terrain[t] !== Terrain.Citizen || w.lot[t] !== 0) continue;
      if (!districts.includes(w.district[t]!)) continue;
      let fronted = false;
      for (const n of [t - 1, t + 1, t - width, t + width]) {
        if (n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Road) fronted = true;
      }
      if (!fronted) continue;
      const x = t % width;
      const y = (t / width) | 0;
      const d2 = (x - town.cx) * (x - town.cx) + (y - town.cy) * (y - town.cy);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestT = t;
      }
    }
    if (bestT >= 0) {
      w.lot[bestT] = lotKind;
      w.pop[bestT] = Math.min(15, Math.max(2, workers));
    }
  };

  const D = Districts;
  // KEYSTONES first — they claim ground before the flavor lots do, and they
  // are BIG: the civic anchors read at map scale (§2 rev. 3).
  keystone(Lot.Supermarket, 3, 2, [D.Commercial, D.Downtown], 12); // the grocery
  keystone(Lot.Sheriff, 2, 2, [D.Downtown, D.Commercial], 6); // the police station
  keystone(Lot.School, 3, 2, [D.College, D.Suburbs, D.ResHigh], 16); // elementary
  // the high school is the biggest institutional building in a small town — it
  // was the same 3×2 as the elementary, so the two read as the same place
  keystone(Lot.HighSchool, 4, 2, [D.College, D.Suburbs, D.ResHigh], 20);
  keystone(Lot.Church, 2, 2, [D.OldTown, D.Suburbs, D.Downtown], 6);
  keystone(Lot.FireStation, 2, 2, [D.Downtown, D.Commercial], 8);
  keystone(Lot.GasStation, 2, 1, [D.Commercial, D.Trailer], 4);

  // COMPANION TILES: some anchors keep a sidekick lot (§7 note 3). The
  // elementary school gets its playground on an adjacent free lot; the
  // high school prefers a ballfield.
  const companion = (hostKind: number, mateKind: number, mateWorkers: number): void => {
    for (let t = 0; t < w.lot.length; t++) {
      if (w.lot[t] !== hostKind) continue;
      const x = t % width;
      const y = (t / width) | 0;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as [number, number][]) {
        if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= w.height - 1) continue;
        const n = ny * width + nx;
        if (w.terrain[n] === Terrain.Citizen && w.lot[n] === 0) {
          w.lot[n] = mateKind;
          w.pop[n] = mateWorkers;
          return;
        }
      }
    }
  };
  companion(Lot.School, Lot.Playground, 1);
  companion(Lot.HighSchool, Lot.BallField, 1);

  // Downtown: civic core. Every real Main Street has a town hall (landmark),
  // bank, post office — ANCHORED with size + district fallbacks so they
  // actually exist (pre-sweep they missed more seeds than they hit)
  anchor(Lot.Office, [[2, 2], [2, 1], [1, 1]], [D.Downtown, D.Commercial], 16);
  anchor(Lot.Bank, [[2, 1], [1, 1]], [D.Downtown, D.Commercial], 6);
  anchor(Lot.PostOffice, [[2, 1], [1, 1]], [D.Downtown, D.Commercial, D.OldTown], 5);
  anchor(Lot.Diner, [[1, 1]], [D.Downtown, D.Commercial, D.OldTown], 6);
  for (let i = 0; i < 3; i++) stamp(Lot.Shop, 1, 1, D.Downtown, 4 + nextRange(rng, 3));
  // the town green: a civic square in the heart of downtown
  stamp(Lot.Park, 2, 2, D.Downtown, 1, 90);
  // Commercial strip: shops, diner, cinema, offices along Main Street
  anchor(Lot.Cinema, [[2, 1], [1, 1]], [D.Commercial, D.Downtown], 8);
  stamp(Lot.Diner, 1, 1, D.Commercial, 6);
  stamp(Lot.Office, 2, 1, D.Commercial, 10);
  for (let i = 0; i < 5; i++) stamp(Lot.Shop, 1, 1, D.Commercial, 4 + nextRange(rng, 3));
  // Industrial quarter: the works — factory + warehouses + a yard. A farm
  // town without its works is a postcard, not a town: the factory falls
  // back through smaller footprints and the fringe before giving up
  anchor(Lot.Factory, [[3, 2], [2, 2], [2, 1]], [D.Industrial, D.Trailer], 14);
  keystone(Lot.Warehouse, 3, 2, [D.Industrial, D.Trailer, D.Commercial], 6); // deep, not a thin strip
  stamp(Lot.Warehouse, 2, 1, D.Industrial, 6);
  stamp(Lot.GasStation, 1, 1, D.Industrial, 3);
  stamp(Lot.Substation, 1, 1, D.Industrial, 1);
  // College quarter
  anchor(Lot.Library, [[2, 1], [1, 1]], [D.College, D.Downtown, D.Suburbs], 5);
  stamp(Lot.Shop, 1, 1, D.College, 4);
  stamp(Lot.BallField, 2, 2, D.College, 1, 70); // the school ballpark
  // Old Town: chapel + diner + the old churchyard
  stamp(Lot.Chapel, 1, 1, D.OldTown, 4);
  stamp(Lot.Diner, 1, 1, D.OldTown, 5);
  stamp(Lot.Cemetery, 2, 2, D.OldTown, 1, 70);
  // Suburbs (low-density): corner shops, a second church, parks, playground
  stamp(Lot.Shop, 1, 1, D.Suburbs, 4);
  stamp(Lot.Church, 2, 2, D.Suburbs, 5);
  stamp(Lot.Park, 2, 2, D.Suburbs, 1, 80);
  stamp(Lot.Playground, 1, 1, D.Suburbs, 1, 70);
  stamp(Lot.Playground, 1, 1, D.ResHigh, 1, 70);
  stamp(Lot.Park, 1, 1, D.College, 1);
  stamp(Lot.WaterTower, 1, 1, D.Suburbs, 2);

  // PARSONAGE (§7): every church keeps its house next door — the first
  // orthogonal empty Citizen lot beside a church becomes a full household
  for (let t = 0; t < w.terrain.length; t++) {
    if (w.lot[t] !== Lot.Church && w.lot[t] !== Lot.Chapel) continue;
    for (const n of [t - 1, t + 1, t - width, t + width]) {
      if (n < 0 || n >= w.terrain.length) continue;
      if (w.terrain[n] === Terrain.Citizen && w.lot[n] === 0 && (w.pop[n] ?? 0) < 3) {
        w.pop[n] = 4; // the parsonage household
        break;
      }
    }
  }

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
    Lot.Church,
    Lot.Chapel,
    Lot.Library,
    Lot.Diner,
    Lot.Depot,
  ]);
  const parkCount = new Map<number, number>();
  // front-lot strips already placed by stampFront satisfy the budget — a
  // school with frontage parking doesn't also need a side apron
  for (let t = 0; t < w.terrain.length; t++) {
    const lot = w.lot[t]!;
    if (!wantsParking.has(lot)) continue;
    for (const n of [t - 1, t + 1, t - width, t + width]) {
      if (n >= 0 && n < w.lot.length && w.lot[n] === Lot.Parking) {
        parkCount.set(lot + (w.district[t]! << 8), 99);
        break;
      }
    }
  }
  // a parking apron is only real if cars can reach it: the paved tile must
  // itself touch a road orthogonally. Front (south) neighbors are tried
  // first so the lot lands where the player is looking.
  const touchesRoad = (n: number): boolean => {
    const nx = n % width;
    const ny = (n / width) | 0;
    return (
      (nx > 0 && w.terrain[n - 1] === Terrain.Road) ||
      (nx < width - 1 && w.terrain[n + 1] === Terrain.Road) ||
      (ny > 0 && w.terrain[n - width] === Terrain.Road) ||
      (ny < w.height - 1 && w.terrain[n + width] === Terrain.Road)
    );
  };
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
      if (w.terrain[n] === Terrain.Citizen && w.lot[n] === 0 && touchesRoad(n)) {
        w.lot[n] = Lot.Parking;
        w.pop[n] = 0;
        parkCount.set(key, (parkCount.get(key) ?? 0) + 1);
        break;
      }
    }
  }

  // GUARANTEE: every civic anchor that should have a parking lot HAS one —
  // if the opportunistic pass found no free lot beside it, clear one (a yard
  // makes way, or fresh ground is paved).
  const mustPark = [Lot.Supermarket, Lot.School, Lot.HighSchool, Lot.Sheriff, Lot.Cinema, Lot.FireStation, Lot.Factory];
  for (const lotKind of mustPark) {
    // does ANY tile of this lot type have an adjacent parking tile?
    let has = false;
    let anchor = -1;
    for (let t = 0; t < w.lot.length && !has; t++) {
      if (w.lot[t] !== lotKind) continue;
      if (anchor < 0) anchor = t;
      for (const n of [t - 1, t + 1, t - width, t + width]) {
        if (n >= 0 && n < w.lot.length && w.lot[n] === Lot.Parking) has = true;
      }
    }
    if (has || anchor < 0) continue;
    // scan the WHOLE footprint's neighbors (south sides first across all
    // tiles), and only pave ground that itself touches a road
    const candidates: number[] = [];
    for (let t = anchor; t < w.lot.length; t++) {
      if (w.lot[t] !== lotKind) continue;
      const ax = t % width;
      const ay = (t / width) | 0;
      for (const [nx, ny] of [
        [ax, ay + 1],
        [ax + 1, ay],
        [ax, ay - 1],
        [ax - 1, ay],
      ] as [number, number][]) {
        if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= w.height - 1) continue;
        const n = ny * width + nx;
        const tr = w.terrain[n];
        if (((tr === Terrain.Citizen && w.lot[n] === 0) || tr === Terrain.Grass) && touchesRoad(n)) {
          candidates.push(n);
        }
      }
    }
    const pick = candidates[0];
    if (pick !== undefined) {
      w.terrain[pick] = Terrain.Citizen;
      if (w.district[pick] === 0) w.district[pick] = w.district[anchor]!;
      w.lot[pick] = Lot.Parking;
      w.pop[pick] = 0;
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
 * Town archetypes (§2A): reshape geography + economy + signature assets as a
 * coherent package. Runs AFTER the classic pipeline (so every core guarantee
 * still holds) and only when townType !== "farm" — the default stays
 * byte-identical to the classic generator.
 */
function applyTownArchetype(
  w: World,
  rng: RngState,
  town: TownShape,
  kind: TownType,
  riverPath: number[] | null,
): void {
  const { width, height } = w;
  const plantLot = (t: number, lot: Lot, district: number, pop: number): void => {
    w.terrain[t] = Terrain.Citizen;
    w.district[t] = district;
    w.lot[t] = lot;
    w.pop[t] = pop;
  };

  if (kind === "oceanside") {
    // ---- OCEAN (§2A): a sea along the roomier map edge, wavy coastline ----
    const side = town.cx <= width / 2 ? 1 : -1;
    let coastBase = side === 1 ? width - 9 - nextRange(rng, 4) : 9 + nextRange(rng, 4);
    // the river becomes the ESTUARY: if it runs on the sea's side, the coast
    // advances past it so the channel reads as drowned river mouth, not a
    // second waterway cluttering the beach
    if (riverPath) {
      let riverExtent = riverPath[0]!;
      for (const cx of riverPath)
        riverExtent = side === 1 ? Math.min(riverExtent, cx) : Math.max(riverExtent, cx);
      const riverOnSeaSide = side === 1 ? riverExtent > town.cx : riverExtent < town.cx;
      if (riverOnSeaSide) {
        coastBase =
          side === 1
            ? Math.min(coastBase, Math.max(town.cx + town.r + 4, riverExtent - 3))
            : Math.max(coastBase, Math.min(town.cx - town.r - 4, riverExtent + 3));
      }
    }
    const p1 = nextRange(rng, 628) / 100;
    const coastX: number[] = [];
    for (let y = 0; y < height; y++) {
      const wobble = 2.5 * Math.sin(0.07 * y + p1) + 1.4 * Math.sin(0.19 * y);
      coastX.push(Math.round(coastBase + side * wobble));
    }
    for (let y = 0; y < height; y++) {
      const cx = coastX[y]!;
      const from = side === 1 ? cx : 0;
      const to = side === 1 ? width : cx + 1;
      for (let x = from; x < to; x++) {
        const t = y * width + x;
        // the sea swallows everything but reads as open water
        w.terrain[t] = Terrain.Lake;
        w.lot[t] = 0;
        w.pop[t] = 0;
        w.biome[t] = Biome.Ocean;
      }
      // beach strip: 2 tiles of sand-biome ground landward of the surf.
      // ALL cultivation is cleared — no crops, paddocks, or orchards in the
      // surf zone (quality pass: the old check missed pasture/orchard, which
      // put fence lines on the dunes and starved the lighthouse of shore
      // grass once smallholdings reached the coast)
      for (let b = 1; b <= 2; b++) {
        const x = cx - side * b;
        if (x < 1 || x >= width - 1) continue;
        const t = y * width + x;
        const tr = w.terrain[t];
        if (tr === Terrain.Grass || tr === Terrain.Field || tr === Terrain.Orchard || tr === Terrain.Pasture) {
          if (tr !== Terrain.Grass) w.terrain[t] = Terrain.Grass;
          w.biome[t] = Biome.Ocean;
        }
      }
    }
    // one road becomes THE pier: keep the highway stub 4 tiles into the surf,
    // trim every other road/rail dead into open water
    const pierY = town.highwayY;
    for (let y = 0; y < height; y++) {
      const cx = coastX[y]!;
      for (let x = 0; x < width; x++) {
        const inSea = side === 1 ? x > cx : x < cx;
        if (!inSea) continue;
        const t = y * width + x;
        if (w.terrain[t] !== Terrain.Road && w.terrain[t] !== Terrain.Rail && w.terrain[t] !== Terrain.Dirt) continue;
        const pierReach = side === 1 ? x <= cx + 4 : x >= cx - 4;
        if ((y === pierY || y === pierY + 1) && pierReach) continue; // the pier
        w.terrain[t] = Terrain.Lake;
        w.biome[t] = Biome.Ocean;
      }
    }
    // lighthouse on a shore point north of the pier — strict pass wants
    // shore grass; the relaxed pass widens the search south and fells a
    // shore tree if it must. A working coast ALWAYS has its light.
    let lit = false;
    for (const strict of [true, false]) {
      if (lit) break;
      const yFrom = Math.max(4, pierY - 18);
      const yTo = strict ? pierY - 4 : Math.min(height - 4, pierY + 24);
      for (let y = yFrom; y < yTo && !lit; y++) {
        const x = coastX[y]! - side;
        if (x < 2 || x >= width - 2) continue;
        const t = y * width + x;
        if (w.terrain[t] === Terrain.Grass || (!strict && w.terrain[t] === Terrain.Woods)) {
          plantLot(t, Lot.Lighthouse, Districts.None, 1);
          lit = true;
        }
      }
    }
    // cannery + fish docks working the shore south of the pier
    let cannery = 0;
    for (let y = pierY + 3; y < Math.min(height - 4, pierY + 20) && cannery < 2; y++) {
      const x = coastX[y]! - side * (2 + cannery);
      if (x < 2 || x >= width - 2) continue;
      const t = y * width + x;
      if (w.terrain[t] === Terrain.Grass) {
        plantLot(t, cannery === 0 ? Lot.Cannery : Lot.Dock, Districts.Trailer, 2);
        carveDirtLane(w, t);
        cannery++;
      }
    }
    return;
  }

  if (kind === "mountain") {
    // ---- TIMBER COUNTRY (§2A): conifer walls + a sawmill on the rail ----
    // heavy stands wall in the valley on every side; the floor stays open.
    // Fields already planted out in the timber get reclaimed by the stands.
    for (let i = 0; i < 16; i++) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const bx = nextRange(rng, width);
        const by = nextRange(rng, height);
        const ddx = bx - town.cx;
        const ddy = by - town.cy;
        const r = 7 + nextRange(rng, 5);
        if (ddx * ddx + ddy * ddy < (town.r + r + 2) * (town.r + r + 2)) continue;
        organicBlob(w, rng, bx, by, r, Terrain.Woods);
        break;
      }
    }
    // farmland doesn't climb the slopes: any parcel out in the forest biome
    // reverts to forest floor (the valley-rim farms survive)
    for (let t = 0; t < w.terrain.length; t++) {
      if (w.biome[t] !== Biome.Forest) continue;
      const tr = w.terrain[t];
      if (tr === Terrain.Field || tr === Terrain.Orchard || tr === Terrain.Pasture)
        w.terrain[t] = pixHash32(t % width, (t / width) | 0, 77) % 3 === 0 ? Terrain.Woods : Terrain.Grass;
    }
    // the sawmill: beside the rail line at a woods edge, with a log yard.
    // Strict pass wants grass below the line with woods in reach; if no rail
    // frontage qualifies (dense seeds), relax: try either side of the line
    // and let the mill fell into the stands — a timber town ALWAYS has one.
    let milled = false;
    for (const strict of [true, false]) {
      if (milled) break;
      for (let t = 0; t < w.terrain.length && !milled; t++) {
        if (w.terrain[t] !== Terrain.Rail) continue;
        const x = t % width;
        if (x < 6 || x >= width - 6) continue;
        const ddx = x - town.cx;
        if (Math.abs(ddx) < town.r + 4) continue; // outside town
        for (const dir of strict ? [1] : [1, -1]) {
          const site = t + dir * width;
          const yard = site + dir * width;
          if (site < 0 || yard < 0 || site + 1 >= w.terrain.length || yard >= w.terrain.length) continue;
          const buildable = (n: number): boolean =>
            w.terrain[n] === Terrain.Grass || (!strict && w.terrain[n] === Terrain.Woods);
          if (!buildable(site) || !buildable(site + 1)) continue;
          if (strict) {
            let woodsNear = false;
            for (let dx = -4; dx <= 4 && !woodsNear; dx++) {
              const n = site + dx;
              if (n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Woods) woodsNear = true;
            }
            if (!woodsNear) continue;
          }
          plantLot(site, Lot.Sawmill, Districts.None, 2);
          plantLot(site + 1, Lot.Sawmill, Districts.None, 2);
          if (w.terrain[yard] === Terrain.Grass || w.terrain[yard] === Terrain.Woods)
            w.terrain[yard] = Terrain.Dirt; // the log yard
          carveDirtLane(w, site);
          milled = true;
          break;
        }
      }
    }
    return;
  }

  if (kind === "lakeside") {
    // ---- THE LAKE TOWN (§2A): a big water body right at the town's edge ----
    const side = town.cx <= width / 2 ? 1 : -1;
    const lakeR = 14 + nextRange(rng, 5);
    const lx = town.cx + side * (town.r + lakeR - 2);
    const ly = town.cy + (nextRange(rng, 2) === 0 ? -1 : 1) * nextRange(rng, 6);
    organicBlob(w, rng, Math.max(16, Math.min(width - 17, lx)), Math.max(16, Math.min(height - 17, ly)), lakeR, Terrain.Lake);
    if (riverPath) connectLakesToRiver(w, riverPath);
    // resort shore: cabins + docks + a boat ramp on the town-facing shore
    let cabins = 0;
    let docks = 0;
    for (let t = 0; t < w.terrain.length && (cabins < 5 || docks < 3); t++) {
      if (w.terrain[t] !== Terrain.Grass || w.lot[t] !== 0) continue;
      const x = t % width;
      const y = (t / width) | 0;
      if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) continue;
      const waterN = w.terrain[t - width] === Terrain.Lake;
      const waterS = w.terrain[t + width] === Terrain.Lake;
      const waterE = w.terrain[t + 1] === Terrain.Lake;
      const waterW = w.terrain[t - 1] === Terrain.Lake;
      const touches = (waterN ? 1 : 0) + (waterS ? 1 : 0) + (waterE ? 1 : 0) + (waterW ? 1 : 0);
      if (touches !== 1) continue;
      const ddx = x - town.cx;
      const ddy = y - town.cy;
      if (Math.sqrt(ddx * ddx + ddy * ddy) > town.r + 24) continue;
      if (pixHash32(x, y, 211) % 3 === 0 && docks < 3) {
        plantLot(t, Lot.Dock, Districts.Trailer, 2);
        carveDirtLane(w, t);
        docks++;
      } else if (cabins < 5) {
        plantLot(t, 0 as Lot, Districts.Suburbs, 3); // a shore cabin household
        carveDirtLane(w, t);
        cabins++;
      }
    }
    return;
  }
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

  // the crossing sits OFF the town's center (#14) — real grids grow lopsided
  const highwayY = cy + nextRange(rng, 5) - 2;
  const highwayX = cx + (nextRange(rng, 2) === 0 ? -1 : 1) * (2 + nextRange(rng, 5));
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
      
      let nearHighway = false;
      for (let oy = -2; oy <= 2 && !nearHighway; oy++) {
        const ny = y + oy;
        if (ny < 0 || ny >= height) continue;
        const nt = ny * width + x;
        if (w.terrain[nt] === Terrain.Road && isHighwayTile(w, nt)) nearHighway = true;
      }

      // Zoning Suitability Pass
      const highwayAccessScore = nearHighway ? 100 : 0;
      const centerProximityScore = Math.max(0, 100 - (d / (r * 0.5)) * 100);
      const edgeProximityScore = edge * 100;
      
      const isIndustrialTarget = nearHighway && indSide * dx > r * 0.5;

      if (isIndustrialTarget) {
        w.district[t] = Districts.Industrial;
      } else if (highwayAccessScore > 50 && centerProximityScore > 60) {
        w.district[t] = Districts.Downtown;
      } else if (highwayAccessScore > 50 && centerProximityScore > 30) {
        w.district[t] = Districts.Commercial;
      } else if (centerProximityScore > 40) {
        w.district[t] = Districts.ResHigh; // Buffer ring
      } else if (edgeProximityScore > 84) {
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
    // probability fades linearly from ~50% at the edge to 0 in deep country
    // (§11: the fringe gradient must read on every compass side)
    const falloff = 1 - (d - inner) / (outer - inner);
    if (nextRange(rng, 100) >= Math.floor(50 * falloff)) continue;
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

    // farmstead: Farmhouse, Barn, and Silo set back from the road with a driveway
    const homeSide = nextRange(rng, 2) === 0 ? 1 : -1;
    const setBack = 2; // tiles away from the road
    for (let h = 0; h < 3; h++) {
      const x = horiz ? ax + h : ax + homeSide * setBack;
      const y = horiz ? ay + homeSide * setBack : ay + h;
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      const t = y * width + x;
      if (w.terrain[t] === Terrain.Grass) {
        w.terrain[t] = Terrain.Citizen;
        if (h === 0) {
          w.district[t] = Districts.Suburbs;
          w.pop[t] = 3; // Ensure a house is actually built
        } else if (h === 1) {
          w.district[t] = Districts.None;
          w.lot[t] = Lot.Barn;
        } else {
          w.district[t] = Districts.None;
          w.lot[t] = Lot.Silo;
        }
        
        // Draw the dirt driveway from the road to the building
        for (let d = 1; d <= setBack; d++) {
          const dx = horiz ? ax + h : ax + homeSide * (setBack - d);
          const dy = horiz ? ay + homeSide * (setBack - d) : ay + h;
          const dt = dy * width + dx;
          if (dt >= 0 && dt < w.terrain.length) {
            const tr = w.terrain[dt];
            if (tr === Terrain.Grass || tr === Terrain.Field || tr === Terrain.Pasture || tr === Terrain.Orchard) {
              w.terrain[dt] = Terrain.Dirt;
            }
          }
        }
      }
    }

    // SHELTERBELT (#12): the windbreak tree row on the farmstead's north side (moved back to prevent overlap)
    for (let sxx = -1; sxx <= 3; sxx++) {
      const x = horiz ? ax + sxx : ax + homeSide * (setBack + 2);
      const y = horiz ? ay + homeSide * (setBack + 2) : ay + sxx;
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      const t = y * width + x;
      if (w.terrain[t] === Terrain.Grass) w.terrain[t] = Terrain.Woods;
    }

    // field parcels: 2 per side of the road, aligned, 1-tile baulks between;
    // a 1-tile grass shoulder always separates pavement from crop (#13)
    for (const side of [1, -1]) {
      let offset = 2; // the roadside shoulder
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
              const isBackEdge = d === deep - 1;
              if (isBackEdge && nextRange(rng, 2) === 0) {
                w.terrain[t] = Terrain.Woods; // field shelterbelt row!
              } else {
                w.terrain[t] = kind;
              }
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
 * The working countryside (#3): in real farm country every plowable acre is
 * plowed — cultivated land is contiguous, not islands in decorative grass.
 * Tile the rural band with quarter-section parcels along a coarse lattice,
 * skipping water margins, woods, desert, rail, roads (plus a shoulder), and
 * a construction ring near town where cults buy property. ~1/3 of cells stay
 * meadow so pasture/hay ground still breathes.
 */
function fillFarmBelt(w: World, rng: RngState, town: TownShape): void {
  const { width, height } = w;
  // QUALITY PASS (upgrade sweep): the belt used to hold back 10 tiles from
  // town, leaving a bare no-man's-ring — real farm towns have fields against
  // the last street. The setback shrinks to 4; the first ring [r+4, r+12]
  // fills as SMALLHOLDINGS: half the cells stay open grass (founding and
  // property purchases still need room — the construction-ring contract),
  // the rest are small paddocks and orchards, the market gardens that
  // actually ring a rural town. Quarter-sections take over further out.
  const inner = town.r + 4;
  const nearBand = town.r + 12;
  const CELL_W = 11;
  const CELL_H = 9;
  for (let cy = 2; cy < height - 2; cy += CELL_H) {
    for (let cx2 = 2; cx2 < width - 2; cx2 += CELL_W) {
      const ddx = cx2 + CELL_W / 2 - town.cx;
      const ddy = cy + CELL_H / 2 - town.cy;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < inner * inner) continue; // town core stays clear
      const near = d2 < nearBand * nearBand;
      const roll = nextRange(rng, 12);
      if (roll < (near ? 6 : 2)) continue; // near town: half the ring stays open
      const kind: Terrain = near
        ? roll < 9
          ? Terrain.Pasture
          : Terrain.Orchard
        : roll < 9
          ? Terrain.Field
          : roll < 11
            ? Terrain.Pasture
            : Terrain.Orchard;
      // break the lattice read (QA S1-C): every parcel gets its own extent
      // and offset inside the cell, so edges stop aligning map-wide;
      // smallholding plots run garden-sized, quarter-sections full-sized
      const pw = near ? 4 + nextRange(rng, 3) : 7 + nextRange(rng, 3);
      const ph = near ? 3 + nextRange(rng, 3) : 5 + nextRange(rng, 3);
      const offX = nextRange(rng, Math.max(1, CELL_W - pw));
      const offY = nextRange(rng, Math.max(1, CELL_H - ph));

      // Check if the center of the parcel is in the desert. If so, skip it entirely.
      if (w.biome[(cy + offY + Math.floor(ph / 2)) * width + (cx2 + offX + Math.floor(pw / 2))] === Biome.Desert) continue;

      for (let dy = 0; dy < ph; dy++) {
        for (let dx = 0; dx < pw; dx++) {
          const x = cx2 + offX + dx;
          const y = cy + offY + dy;
          if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
          const t = y * width + x;
          
          if (w.biome[t] === Biome.Desert) continue;
          
          const tr = w.terrain[t];
          if (tr !== Terrain.Grass && tr !== Terrain.Woods) continue; // fields overwrite woods!

          // shoulder from pavement/rail, margin from water
          let blocked = false;
          for (const n of [t - 1, t + 1, t - width, t + width]) {
            if (n < 0 || n >= w.terrain.length) continue;
            const neighbor = w.terrain[n];
            if (neighbor === Terrain.Road || neighbor === Terrain.Rail || neighbor === Terrain.Lake || neighbor === Terrain.Dirt)
              blocked = true;
          }
          if (blocked) continue;
          
          w.terrain[t] = kind;
        }
      }
    }
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
function carveRiver(w: World, rng: RngState, town: TownShape, fields: TerrainFields): number[] | null {
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
  if (room < town.r + 8) return null; // town fills this side: no room for a river
  const off = Math.min(town.r + 6 + jitter, room - 6);
  if (off <= town.r + 2) return null; // would cut through the streets
  const baseX = town.cx + side * off;
  if (baseX < 4 || baseX > width - 5) return null;
  // pass 1: DRAINAGE DESCENT (§2 rev. 6): the channel walks downhill row by
  // row — |Δx| ≤ 1 per row — on a blend of the elevation field and its own
  // medium-wavelength thalweg noise (coarse elevation alone reads as a
  // canal: the channel locks one wide valley and runs straight). A gentle
  // corridor pull keeps the meander out of the streets.
  const rSalt = nextU32(rng) | 1;
  const cxs: number[] = [];
  let cx = baseX;
  for (let y = 0; y < height; y++) {
    cxs.push(cx);
    if (y === height - 1) break;
    let best = cx;
    let bestScore = Infinity;
    for (const nx of [cx, cx - 1, cx + 1]) {
      if (nx < 4 || nx > width - 5) continue;
      if (Math.abs(nx - baseX) > 11) continue; // stay in the valley
      const score =
        0.4 * fields.elev[(y + 1) * width + nx]! +
        0.6 * fieldOctave(rSalt, nx, y + 1, 9) +
        Math.abs(nx - baseX) * 0.005;
      if (score < bestScore) {
        bestScore = score;
        best = nx;
      }
    }
    cx = best;
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
      if (x < 0 || x >= width) continue;
      if (w.terrain[y * width + x] === Terrain.Road) roadHere = true;
    }
    if (!roadHere) continue;
    for (let oy = -2; oy <= 2; oy++) {
      const yy = y + oy;
      if (yy >= 0 && yy < height) cxs[yy] = cx;
    }
  }
  // DOWNSTREAM WIDENING (#7): the channel is a creek at the top of the map
  // and a river at the bottom, stepping up in width at each confluence.
  const join1 = Math.floor(height * 0.28) + nextRange(rng, 6);
  const join2 = Math.floor(height * 0.58) + nextRange(rng, 6);
  for (let y = 0; y < height; y++) {
    const cx = cxs[y]!;
    const hw = y < join1 ? 0 : y < join2 ? 1 : 1; // 1-wide → 3-wide
    const extra = y >= join2 ? 1 : 0; // below the second confluence: 4-wide
    for (let dx = -hw; dx <= hw + extra; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= width) continue;
      const t = y * width + x;
      const tr = w.terrain[t];
      // never destroy roads (bridge), rail, or town lots
      if (tr !== Terrain.Citizen && tr !== Terrain.Road && tr !== Terrain.Rail) w.terrain[t] = Terrain.Lake;
    }
  }

  // MILLPOND & DAM (#5): Place a low dam/weir upstream of town with a millpond
  const y_dam = Math.max(12, Math.floor(town.cy - town.r - 5));
  for (let y = y_dam - 4; y < y_dam; y++) {
    const cx = cxs[y]!;
    for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx;
      if (x >= 0 && x < width) {
        w.terrain[y * width + x] = Terrain.Lake;
      }
    }
  }
  const cx_dam = cxs[y_dam]!;
  for (let dx = -2; dx <= 2; dx++) {
    const x = cx_dam + dx;
    if (x >= 0 && x < width) {
      const t = y_dam * width + x;
      w.terrain[t] = Terrain.Lake;
      w.lot[t] = Lot.Dam;
    }
  }

  // TRIBUTARIES (#5): creeks rise in the open country on the RIVER'S side of
  // the map — never across the town — and wander down to their confluence.
  // A creek that cannot reach the river erases itself (QA S1-A: no stubs).
  const riverSide = side; // which side of town the river runs on
  for (const [i, joinY] of [join1, join2].entries()) {
    const srcY = Math.max(2, joinY - 18 - nextRange(rng, 10));
    // source sits between the river and the map edge on the river's side
    const away = 8 + nextRange(rng, 16);
    let srcX = cxs[srcY]! + riverSide * away;
    srcX = Math.max(3, Math.min(width - 4, srcX));
    carveCreek(w, rng, srcX, srcY, cxs, joinY, i);
  }

  // LAKE OUTLET (#6): the drainage hookup runs again after placeNature has
  // stamped the lake (generateWorld holds the returned path).
  connectLakesToRiver(w, cxs);
  return cxs;
}

/**
 * Walk a 1-tile creek from (x,y) toward the river's (cxs[joinY], joinY).
 * Never runs straight for long (QA S1-D) and never leaves a stub: if the
 * walk fails to reach the river the whole channel is erased (QA S1-A).
 */
function carveCreek(
  w: World,
  rng: RngState,
  x0: number,
  y0: number,
  cxs: number[],
  joinY: number,
  salt: number,
): void {
  const { width, height } = w;
  let x = x0;
  let y = y0;
  const painted: number[] = [];
  const paint = (t: number): void => {
    const tr = w.terrain[t];
    // Carve through nature and dirt to ensure creeks don't dead-end
    if (tr !== Terrain.Citizen && tr !== Terrain.Road && tr !== Terrain.Rail) {
      w.terrain[t] = Terrain.Lake;
      painted.push(t);
    }
  };
  // RUN-LENGTH WALK (quality pass): a creek reads as REACHES joined by
  // elbows, not a per-tile zigzag — the old 50/50 alternation stair-stepped
  // at a machine rhythm. Each iteration commits to one axis for a 2–6 tile
  // reach (down-reaches run longer: water wants the valley floor).
  for (let guard = 0; guard < width; guard++) {
    if (y >= height - 2) break;
    const targetX = cxs[Math.min(joinY, y)]!;
    if (Math.abs(x - targetX) <= 1 && y >= joinY - 2) return; // joined — keep
    const wantX = targetX - x;
    const roll = nextRange(rng, 10 + salt);
    const goDown = y < joinY && (roll < 6 || wantX === 0);
    const run = 2 + nextRange(rng, goDown ? 5 : 3);
    for (let s = 0; s < run; s++) {
      if (y >= height - 2) break;
      const tx = cxs[Math.min(joinY, y)]!;
      if (Math.abs(x - tx) <= 1 && y >= joinY - 2) return; // joined mid-reach
      if (goDown) {
        y = Math.min(height - 2, y + 1);
      } else {
        const wx = tx - x;
        if (wx === 0) break; // aligned over the join: end the lateral reach
        x = Math.max(1, Math.min(width - 2, x + (wx > 0 ? 1 : -1)));
      }
      paint(y * width + x);
    }
  }
  // never joined: a creek to nowhere is worse than no creek — erase it
  for (const t of painted) w.terrain[t] = Terrain.Grass;
}

/**
 * Every standing lake links to the river with a 1-tile outlet channel — no
 * disconnected puddles in a drainage basin (#6). Component-based: flood-fill
 * the water reachable from the river; any unreached lake body gets an outlet
 * carved from its lowest tile. EXCEPTION: a lake inside the desert biome is
 * a playa — endorheic by nature — and stays landlocked (QA LOD-1 pass).
 */
function connectLakesToRiver(w: World, cxs: number[]): void {
  const { width, height } = w;
  const n = width * height;
  const reached = new Uint8Array(n);
  const queue: number[] = [];
  // seeds: the river channel band itself
  for (let y = 0; y < height; y++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x = cxs[y]! + dx;
      if (x < 0 || x >= width) continue;
      const t = y * width + x;
      if (w.terrain[t] === Terrain.Lake && !reached[t]) {
        reached[t] = 1;
        queue.push(t);
      }
    }
  }
  while (queue.length > 0) {
    const c = queue.pop()!;
    const x = c % width;
    const y = (c / width) | 0;
    const isPavement = w.terrain[c] === Terrain.Road || w.terrain[c] === Terrain.Rail;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const t = ny * width + nx;
      if (w.terrain[t] === Terrain.Lake && !reached[t]) {
        reached[t] = 1;
        queue.push(t);
      } else if (!isPavement && (w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Rail) && !reached[t]) {
        // water flows under bridges/culverts: jump the pavement
        reached[t] = 1;
        queue.push(t);
      }
    }
  }
  // find disconnected components; carve an outlet for the non-desert ones
  const seen = new Uint8Array(n);
  for (let t0 = 0; t0 < n; t0++) {
    if (w.terrain[t0] !== Terrain.Lake || reached[t0] || seen[t0]) continue;
    // collect this component
    const comp: number[] = [t0];
    seen[t0] = 1;
    for (let i = 0; i < comp.length; i++) {
      const c = comp[i]!;
      const x = c % width;
      const y = (c / width) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const t = ny * width + nx;
        if (w.terrain[t] === Terrain.Lake && !seen[t] && !reached[t]) {
          seen[t] = 1;
          comp.push(t);
        }
      }
    }
    // desert playa: landlocked is the realistic state
    let desertTiles = 0;
    for (const t of comp) if (w.biome[t] === Biome.Desert) desertTiles++;
    if (desertTiles * 2 > comp.length) continue;
    // rim-fray droplets aren't ponds: a tiny detached component dries up
    // instead of carving its own outlet (QA sprint-1: parallel-staircase smear)
    if (comp.length < 5) {
      for (const t of comp) w.terrain[t] = Terrain.Grass;
      continue;
    }
    // carve from the component's lowest tile toward the river
    let start = comp[0]!;
    for (const t of comp) if (((t / width) | 0) > ((start / width) | 0)) start = t;
    let x = start % width;
    let y = (start / width) | 0;
    // RUN-LENGTH WALK (quality pass): the outlet reads as reaches + elbows,
    // like the creeks — the old per-tile jitter stair-stepped metronomically.
    let runDown = false;
    let runLeft = 0;
    for (let guard = 0; guard < width * 2; guard++) {
      const targetX = cxs[y]!;
      if (Math.abs(x - targetX) <= 1) break; // reached the river
      let nx = x;
      let ny = y;
      if (runLeft <= 0) {
        runDown = pixHash32(x, y, 137) % 5 < 2 && y < height - 2;
        runLeft = runDown ? 2 + (pixHash32(x, y, 251) % 4) : 2 + (pixHash32(x, y, 397) % 3);
      }
      runLeft--;
      const down = runDown && y < height - 2;
      if (down) ny++;
      else nx += targetX > x ? 1 : -1;
      if (nx < 0 || nx >= width || ny >= height) break;
      const t = ny * width + nx;
      const tr = w.terrain[t];
      if (tr === Terrain.Citizen) {
        // never through a lot: divert downhill around the settlement
        if (y < height - 2) {
          y++;
          const dt = y * width + x;
          const dtr = w.terrain[dt];
          if (
            dtr === Terrain.Grass ||
            dtr === Terrain.Field ||
            dtr === Terrain.Orchard ||
            dtr === Terrain.Pasture ||
            dtr === Terrain.Woods
          )
            w.terrain[dt] = Terrain.Lake;
        } else {
          x += targetX > x ? 1 : -1;
        }
        continue;
      }
      x = nx;
      y = ny;
      // the outlet cuts through vegetation and farmland; pavement stays (a
      // culvert) and the channel resumes on the far side
      if (
        tr === Terrain.Grass ||
        tr === Terrain.Field ||
        tr === Terrain.Orchard ||
        tr === Terrain.Pasture ||
        tr === Terrain.Woods
      )
        w.terrain[t] = Terrain.Lake;
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
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
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
      if (kind === Terrain.Woods && w.biome[t] === Biome.Desert) continue;
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

function placeNature(
  w: World,
  rng: RngState,
  town: TownShape,
  riverPath: number[] | null = null,
  fields: TerrainFields,
): void {
  const { width, height } = w;
  // a couple of generous forests, several smaller copses, one irregular lake
  const forests = 2 + nextRange(rng, 2);
  const copses = 5 + nextRange(rng, 4);
  const nearWater = (x: number, y: number, r2: number): boolean => {
    for (let dy = -r2; dy <= r2; dy += 2) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -r2; dx <= r2; dx += 2) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        if (w.terrain[yy * width + xx] === Terrain.Lake) return true;
      }
    }
    return false;
  };
  const tryPlace = (r: number, kind: Terrain, wantBiome = -1): void => {
    for (let attempt = 0; attempt < 14; attempt++) {
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
      // RIPARIAN BIAS (#9) + WETNESS (§2 rev. 6): the first attempts insist
      // on hugging water OR wet ground — surviving woodland lives in the
      // floodplain and the damp hollows, not on prime cropland
      if (
        kind === Terrain.Woods &&
        wantBiome < 0 &&
        attempt < 8 &&
        !nearWater(bx, by, 8) &&
        fields.moist[by * width + bx]! < 0.55
      )
        continue;
      // the lake pools in low country, not on a hilltop (§2 rev. 6)
      if (kind === Terrain.Lake && attempt < 8 && fields.elev[by * width + bx]! > 0.45) continue;
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
  // AUTUMN biome dense stands
  let hasAutumnBiome = false;
  for (let t = 0; t < w.biome.length; t += 7) {
    if (w.biome[t] === Biome.Autumn) {
      hasAutumnBiome = true;
      break;
    }
  }
  if (hasAutumnBiome) {
    for (let i = 0; i < 3; i++) tryPlace(6 + nextRange(rng, 5), Terrain.Woods, Biome.Autumn);
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

  // RIPARIAN FRINGE (#9): trees line the banks — a broken gallery forest
  // along the river, denser away from town, never in the desert.
  if (riverPath) {
    for (let t = 0; t < w.terrain.length; t++) {
      if (w.terrain[t] !== Terrain.Lake) continue;
      const x = t % width;
      const y = (t / width) | 0;
      const ddx = x - town.cx;
      const ddy = y - town.cy;
      if (ddx * ddx + ddy * ddy < (town.r + 4) * (town.r + 4)) continue;
      for (const n of [t - 1, t + 1, t - width, t + width]) {
        if (n < 0 || n >= w.terrain.length) continue;
        if (w.terrain[n] !== Terrain.Grass || w.biome[n] === Biome.Desert) continue;
        if (((n * 2654435761) >>> 0) % 3 === 0) w.terrain[n] = Terrain.Woods;
      }
    }
  }
}

/**
 * BLOCK ALLEYS (§2 rev. 6): the widened blocks left interiors that read as
 * holes. A real small town threads them with dirt service alleys — any
 * corridor of non-fronting yard tiles that connects two streets becomes an
 * alley, and the yards on either side become alley-served (garages, sheds,
 * homes can front them via enforceRoadFrontage's Dirt clause). Corridors
 * next to an existing road or alley are skipped so alleys never run
 * double-wide.
 */
function carveBlockAlleys(w: World): void {
  const { width, height } = w;
  const road = (t: number): boolean =>
    w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Dirt;
  const interior = (t: number): boolean => {
    if (w.terrain[t] !== Terrain.Citizen || w.lot[t] !== 0) return false;
    const x = t % width;
    const y = (t / width) | 0;
    // not already street-served on any side
    if (x > 0 && road(t - 1)) return false;
    if (x < width - 1 && road(t + 1)) return false;
    if (y > 0 && road(t - width)) return false;
    if (y < height - 1 && road(t + width)) return false;
    return true;
  };
  const carved = new Set<number>();
  // horizontal corridors first (blocks are wider than tall), then vertical
  for (const axis of [0, 1] as const) {
    for (let b = 2; b < (axis === 0 ? height : width) - 2; b++) {
      for (let a = 2; a < (axis === 0 ? width : height) - 2; a++) {
        const at = (ax: number): number => (axis === 0 ? b * width + ax : ax * width + b);
        if (!interior(at(a))) continue;
        // walk the corridor to its ends
        let lo = a;
        while (lo - 1 >= 1 && interior(at(lo - 1))) lo--;
        let hi = a;
        while (hi + 1 < (axis === 0 ? width : height) - 1 && interior(at(hi + 1))) hi++;
        const len = hi - lo + 1;
        // both ends must open onto a street (through the non-interior tile)
        const before = at(lo - 1);
        const after = at(hi + 1);
        const opens = (t: number): boolean =>
          road(t) || (w.terrain[t] === Terrain.Citizen && w.lot[t] === 0);
        if (len >= 2 && len <= 12 && opens(before) && opens(after)) {
          for (let i = lo; i <= hi; i++) {
            w.terrain[at(i)] = Terrain.Dirt;
            carved.add(at(i));
          }
          // punch the throat tiles too when they're yards, so the alley
          // actually meets the pavement instead of stopping one short
          for (const throat of [before, after]) {
            if (w.terrain[throat] === Terrain.Citizen && w.lot[throat] === 0 && w.pop[throat] === 0) {
              w.terrain[throat] = Terrain.Dirt;
              carved.add(throat);
            }
          }
        }
        a = hi; // skip past this corridor
      }
    }
  }
  // eat back alley stubs that ended on a yard instead of pavement — only
  // tiles THIS pass carved (never pre-existing farm/landmark lanes)
  for (let pass = 0; pass < 8; pass++) {
    let removed = 0;
    for (const t of carved) {
      if (w.terrain[t] !== Terrain.Dirt) continue;
      let deg = 0;
      for (const n of [t - 1, t + 1, t - width, t + width]) {
        if (n >= 0 && n < w.terrain.length && road(n)) deg++;
      }
      if (deg <= 1) {
        w.terrain[t] = Terrain.Citizen;
        carved.delete(t);
        removed++;
      }
    }
    if (removed === 0) break;
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
/**
 * Farm/wood siting hygiene (§9). "Nature before farms" (B1.4.16.3) makes fields
 * wrap standing timber rather than the reverse, and in bulk it works — but a
 * handful of cultivated tiles per map still end up ringed by trees. Measured
 * before this pass at 96²: 9–28 tiles per seed (0.8–3.1% of farmland). Tiny
 * counts, outsized visual cost — an isolated gold patch inside a dark stand is
 * exactly what the eye lands on, and no real farmer clears a plot they cannot
 * drive a tractor to.
 *
 * Any field tile with most of its neighbourhood wooded reverts to grass: the
 * clearing simply never got cut. Neighbour counts are read from a snapshot
 * taken before any edit, so the result does not depend on iteration order.
 */
function clearEnclosedFarmland(w: World): void {
  const before = Uint8Array.from(w.terrain as unknown as Uint8Array);
  const isWood = (t: number): boolean => before[t] === Terrain.Woods;
  for (let t = 0; t < w.terrain.length; t++) {
    if (before[t] !== Terrain.Field) continue;
    const x = t % w.width;
    const y = (t / w.width) | 0;
    let wooded = 0;
    for (const [dx, dy] of NEIGHBORS8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.width || ny >= w.height) continue;
      if (isWood(ny * w.width + nx)) wooded++;
    }
    if (wooded >= 5) w.terrain[t] = Terrain.Grass;
  }
}

/** Fixed 8-neighbour order — deterministic iteration for the hygiene passes. */
const NEIGHBORS8: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

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
  const popFloor = popFloors(w.width, w.height).pop;
  const way = (t: number): boolean =>
    t >= 0 &&
    t < w.terrain.length &&
    (w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Dirt);
  for (let t = 0; t < w.terrain.length && pop < popFloor; t++) {
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

/**
 * Realism pass: any street run ending near the map boundary (within 8 tiles)
 * is extended off the edge to connect the town grid to the outside world.
 */
function extendEdgeRoads(w: World): void {
  const { width, height } = w;
  const THRESHOLD = 8;

  // Extend horizontal roads to left/right boundaries
  for (let y = 1; y < height - 1; y++) {
    // left edge
    let xFirst = -1;
    for (let x = 0; x < width; x++) {
      if (w.terrain[y * width + x] === Terrain.Road) {
        xFirst = x;
        break;
      }
    }
    if (xFirst > 0 && xFirst <= THRESHOLD) {
      if (w.terrain[y * width + xFirst + 1] === Terrain.Road) {
        for (let x = 0; x < xFirst; x++) {
          w.terrain[y * width + x] = Terrain.Road;
        }
      }
    }

    // right edge
    let xLast = -1;
    for (let x = width - 1; x >= 0; x--) {
      if (w.terrain[y * width + x] === Terrain.Road) {
        xLast = x;
        break;
      }
    }
    if (xLast >= 0 && xLast < width - 1 && (width - 1 - xLast) <= THRESHOLD) {
      if (w.terrain[y * width + xLast - 1] === Terrain.Road) {
        for (let x = xLast + 1; x < width; x++) {
          w.terrain[y * width + x] = Terrain.Road;
        }
      }
    }
  }

  // Extend vertical roads to top/bottom boundaries
  for (let x = 1; x < width - 1; x++) {
    // top edge
    let yFirst = -1;
    for (let y = 0; y < height; y++) {
      if (w.terrain[y * width + x] === Terrain.Road) {
        yFirst = y;
        break;
      }
    }
    if (yFirst > 0 && yFirst <= THRESHOLD) {
      if (w.terrain[(yFirst + 1) * width + x] === Terrain.Road) {
        for (let y = 0; y < yFirst; y++) {
          w.terrain[y * width + x] = Terrain.Road;
        }
      }
    }

    // bottom edge
    let yLast = -1;
    for (let y = height - 1; y >= 0; y--) {
      if (w.terrain[y * width + x] === Terrain.Road) {
        yLast = y;
        break;
      }
    }
    if (yLast >= 0 && yLast < height - 1 && (height - 1 - yLast) <= THRESHOLD) {
      if (w.terrain[(yLast - 1) * width + x] === Terrain.Road) {
        for (let y = yLast + 1; y < height; y++) {
          w.terrain[y * width + x] = Terrain.Road;
        }
      }
    }
  }
}
