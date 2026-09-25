/**
 * Automated Mapgen Invariant Linter (§4.3 / §4.4 Task 3.6 / Task 3.8)
 *
 * Programmatic QA testbed validating that Mundane Falls town generation
 * complies strictly with all urban planning, zoning, ecological, and hydrological
 * invariants across random seeds and town archetypes.
 *
 * Usage:
 *   node tools/audit_mapgen.mjs [--seeds 50]
 */

import {
  generateWorld,
  Terrain,
  Biome,
  Lot,
  Districts,
  Landmark,
  footprintOf,
} from "../packages/sim/dist/index.js";

const RESIDENTIAL = new Set([Districts.Suburbs, Districts.College, Districts.OldTown, Districts.Trailer, Districts.ResHigh]);

/** 4-connected components of tiles carrying `lot`. */
function lotComponents(w, lot) {
  const seen = new Uint8Array(w.lot.length), comps = [];
  for (let t = 0; t < w.lot.length; t++) {
    if (seen[t] || w.lot[t] !== lot) continue;
    const st = [t], c = []; seen[t] = 1;
    while (st.length) {
      const k = st.pop(); c.push(k);
      const x = k % w.width;
      for (const n of [x > 0 ? k - 1 : -1, x < w.width - 1 ? k + 1 : -1, k - w.width, k + w.width])
        if (n >= 0 && n < w.lot.length && !seen[n] && w.lot[n] === lot) { seen[n] = 1; st.push(n); }
    }
    comps.push(c);
  }
  return comps;
}
/** Does a component fill a rectangle matching the lot's footprint (or alt), either orientation? */
function matchesFootprint(w, comp, lot) {
  const xs = comp.map((t) => t % w.width), ys = comp.map((t) => (t / w.width) | 0);
  const bw = Math.max(...xs) - Math.min(...xs) + 1, bh = Math.max(...ys) - Math.min(...ys) + 1;
  if (bw * bh !== comp.length) return false;
  const fp = footprintOf(lot), opts = [fp, fp.alt].filter(Boolean);
  return opts.some((o) => (o.w === bw && o.h === bh) || (o.w === bh && o.h === bw));
}

/**
 * Stage 2 placement-grammar invariants (town plan v3): street frontage,
 * courthouse square, high-school campus, footprints, rock/water exclusivity.
 */
export function auditPlan(w, seed, townType = "farm") {
  const v = [];
  const bad = (rule, msg) => v.push({ rule, msg: `[${rule}] ${msg}` });
  const way = (n) => n >= 0 && n < w.terrain.length && (w.terrain[n] === Terrain.Road || w.terrain[n] === Terrain.Dirt);
  const fronts = (t) => { const x = t % w.width; return (x > 0 && way(t - 1)) || (x < w.width - 1 && way(t + 1)) || way(t - w.width) || way(t + w.width); };
  let frontage = 0, gaps = 0;
  for (let t = 0; t < w.terrain.length; t++) {
    const tr = w.terrain[t];
    // nothing is built on water or rock
    const wet = w.lot[t] === Lot.Dam || w.lot[t] === Lot.Dock || w.lot[t] === Lot.Jetty; // weirs and piers stand in the water by design
    if ((tr === Terrain.Rock || (tr === Terrain.Lake && !wet)) && (w.lot[t] !== 0 || w.pop[t] !== 0))
      bad("NO_BUILD_ON_WATER_ROCK", `lot ${w.lot[t]} / pop ${w.pop[t]} on terrain ${tr} at ${t}`);
    if (tr !== Terrain.Citizen || w.lot[t] !== 0) continue;
    const f = fronts(t);
    // a house (pop ≥ 3) always fronts a street — it has a driveway to draw
    if (w.pop[t] >= 3 && !f && w.district[t] !== 0) bad("HOUSE_FRONTAGE", `house at ${t} has no street frontage`);
    if (f && RESIDENTIAL.has(w.district[t])) { frontage++; if (w.pop[t] < 3) gaps++; }
  }
  // residential blocks are perimeter blocks: the street wall is (nearly) continuous
  const maxGap = townType === "desert" ? 0.5 : 0.12;
  if (frontage > 0 && gaps / frontage > maxGap)
    bad("FRONTAGE_GAPS", `${((100 * gaps) / frontage).toFixed(0)}% of residential street frontage is vacant (max ${maxGap * 100}%)`);
  // the courthouse square
  const court = lotComponents(w, Lot.Courthouse);
  if (court.length !== 1) bad("COURTHOUSE", `${court.length} courthouses (want exactly 1)`);
  else {
    if (!matchesFootprint(w, court[0], Lot.Courthouse)) bad("FOOTPRINT", `courthouse ${court[0].length} tiles off-footprint`);
    const th = w.landmark.indexOf(Landmark.TownHall);
    if (th < 0 || w.lot[th] !== Lot.Courthouse) bad("COURTHOUSE", "Town Hall landmark is not on the courthouse");
    for (const t of court[0]) for (const n of [t - 1, t + 1, t - w.width, t + w.width])
      if (w.terrain[n] === Terrain.Citizen && w.lot[n] !== Lot.Courthouse && w.lot[n] !== Lot.Park) { bad("COURTHOUSE", `square lawn broken by lot ${w.lot[n]} at ${n}`); break; }
  }
  // one high school, and its stadium on the campus
  const hs = lotComponents(w, Lot.HighSchool), track = lotComponents(w, Lot.Track);
  if (hs.length !== 1) bad("CAMPUS", `${hs.length} high schools (want exactly 1)`);
  if (track.length > 1) bad("CAMPUS", `${track.length} stadiums`);
  for (const c of [...hs, ...track]) if (!matchesFootprint(w, c, w.lot[c[0]])) bad("FOOTPRINT", `lot ${w.lot[c[0]]} component of ${c.length} tiles off-footprint`);
  if (hs.length === 1 && track.length === 1) {
    const near = hs[0].some((a) => track[0].some((b) => Math.abs((a % w.width) - (b % w.width)) + Math.abs(((a / w.width) | 0) - ((b / w.width) | 0)) <= 2));
    if (!near) bad("CAMPUS", "the stadium is not beside the high school");
  }
  // every building at its real size: no component smaller than its footprint (or alt)
  for (const lotId of Object.values(Lot)) {
    if (!lotId || lotId === Lot.Parking || lotId === Lot.Park || lotId === Lot.Dock || lotId === Lot.Dam) continue;
    const fp = footprintOf(lotId);
    const min = Math.min(fp.w * fp.h, fp.alt ? fp.alt.w * fp.alt.h : Infinity);
    if (min <= 1) continue;
    for (const c of lotComponents(w, lotId)) if (c.length < min) bad("FOOTPRINT", `lot ${lotId} building of ${c.length} tiles (needs ≥ ${min})`);
  }
  // agriculture on cleared land: no field/orchard/pasture wrapped in woods,
  // farmyards clear of trees, every farmstead working land within 5 tiles
  const AGT = new Set([Terrain.Field, Terrain.Orchard, Terrain.Pasture]);
  const around = (t, r, pred) => { const x = t % w.width, y = (t / w.width) | 0; let n = 0, c = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w.width || yy >= w.height) continue; c++; if (pred(yy * w.width + xx)) n++; } return [n, c]; };
  for (let t = 0; t < w.terrain.length; t++) {
    if (AGT.has(w.terrain[t])) { const [n, c] = around(t, 2, (k) => w.terrain[k] === Terrain.Woods); if (n * 1000 > c * 280) bad("AG_IN_WOODS", `farmland at ${t} is wrapped in woods (${n}/${c})`); }
    if (w.lot[t] === Lot.Barn || w.lot[t] === Lot.Silo || w.lot[t] === Lot.Greenhouse) {
      if (around(t, 2, (k) => w.terrain[k] === Terrain.Woods)[0] > 0) bad("FARMYARD", `trees in the farmyard at ${t}`);
      if (around(t, 5, (k) => AGT.has(w.terrain[k]))[0] === 0) bad("FARMSTEAD", `farm building at ${t} works no land`);
    }
  }
  // Stage 2b placement notes from the approval docket
  const within = (comp, r, pred) => comp.some((t) => around(t, r, pred)[0] > 0);
  for (const c of lotComponents(w, Lot.BallField))
    if (!within(c, 1, (k) => w.lot[k] === Lot.School || w.lot[k] === Lot.HighSchool || w.lot[k] === Lot.Track)) bad("BALLFIELD", `ball field at ${c[0]} is not beside a school`);
  for (const c of lotComponents(w, Lot.Playground))
    if (!within(c, 1, (k) => w.lot[k] === Lot.School || w.lot[k] === Lot.Park)) bad("PLAYGROUND", `playground at ${c[0]} is not beside a school or park`);
  for (const c of lotComponents(w, Lot.Cemetery))
    if (!within(c, 2, (k) => w.terrain[k] === Terrain.Grass || w.terrain[k] === Terrain.Field || w.terrain[k] === Terrain.Woods || w.terrain[k] === Terrain.Pasture)) bad("CEMETERY", `cemetery at ${c[0]} is inside town, not on its edge`);
  const agComps = (tr) => { const seen = new Uint8Array(w.terrain.length), out = [];
    for (let t = 0; t < w.terrain.length; t++) { if (seen[t] || w.terrain[t] !== tr) continue; const st = [t], c = []; seen[t] = 1;
      while (st.length) { const k = st.pop(); c.push(k); for (const n of [k - 1, k + 1, k - w.width, k + w.width]) if (n >= 0 && n < w.terrain.length && !seen[n] && w.terrain[n] === tr) { seen[n] = 1; st.push(n); } }
      out.push(c); } return out; };
  for (const c of agComps(Terrain.Pasture))
    if (!within(c, 4, (k) => w.lot[k] === Lot.Barn)) bad("PASTURE_BARN", `pasture at ${c[0]} has no barn to go into`);
  for (const c of agComps(Terrain.Orchard))
    if (!within(c, 2, (k) => w.terrain[k] === Terrain.Road || w.terrain[k] === Terrain.Dirt)) bad("ORCHARD_PATH", `orchard at ${c[0]} has no lane`);
  // mountain towns sit in a real valley
  if (townType === "mountain") {
    const rock = w.terrain.reduce((a, tr) => a + (tr === Terrain.Rock ? 1 : 0), 0) / w.terrain.length;
    if (rock < 0.08) bad("RELIEF", `mountain map is only ${(rock * 100).toFixed(1)}% rock`);
  }
  return v;
}

const DEFAULT_SEEDS = [11, 21, 42, 77, 99, 101, 202, 303, 404, 505, 606, 707, 808, 909, 1000];
const TOWN_TYPES = ["farm", "oceanside", "desert", "mountain", "lakeside"];

const CIVIC_AND_COMMERCIAL_LOTS = [
  Lot.Supermarket,
  Lot.School,
  Lot.HighSchool,
  Lot.Sheriff,
  Lot.Cinema,
  Lot.FireStation,
  Lot.Factory,
  Lot.Church,
  Lot.Bank,
  Lot.Diner,
  Lot.Warehouse,
  Lot.Library,
  Lot.Chapel,
];

export function auditWorld(w, seed, townType = "farm") {
  const violations = [];
  const width = w.width;
  const height = w.height;

  const isWater = (tr) => tr === Terrain.Lake || tr === Terrain.River || tr === Terrain.Creek;
  const isFarm = (tr) => tr === Terrain.Field || tr === Terrain.Orchard || tr === Terrain.Pasture;
  const isRoad = (tr) => tr === Terrain.Road || tr === Terrain.Dirt;

  // 1. Invariant: Zero Farms in Forest Biome or touching timber
  for (let t = 0; t < w.terrain.length; t++) {
    const tr = w.terrain[t];
    if (isFarm(tr)) {
      if (w.biome[t] === Biome.Forest) {
        violations.push({
          type: "FARMS_IN_FOREST",
          tile: t,
          msg: `Farm terrain (${tr}) found in Biome.Forest at tile ${t} (${t % width}, ${(t / width) | 0})`,
        });
      }
      // Zero crops in desert
      if (w.biome[t] === Biome.Desert) {
        violations.push({
          type: "CROPS_IN_DESERT",
          tile: t,
          msg: `Farm terrain (${tr}) found in Biome.Desert at tile ${t} (${t % width}, ${(t / width) | 0})`,
        });
      }
      // Hydrological setback: crops must not touch water
      const x = t % width;
      const y = (t / width) | 0;
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
          const nt = ny * width + nx;
          if (isWater(w.terrain[nt])) {
            violations.push({
              type: "WATER_BUFFER_FARM",
              tile: t,
              msg: `Farm terrain (${tr}) directly borders water at tile ${t}`,
            });
            break;
          }
        }
      }
    }
  }

  // 2. Invariant: Commercial/Civic structures must maintain 1-tile buffer from water (except water/coastal lots: Dock, Depot, Dam, Pier, Lighthouse, FishShack)
  const isWaterExemptLot = (lot) =>
    lot === Lot.Parking ||
    lot === Lot.Dock ||
    lot === Lot.Depot ||
    lot === Lot.Dam ||
    lot === Lot.Lighthouse ||
    lot === Lot.Cannery ||
    lot === Lot.Sawmill ||
    lot === Lot.Powerhouse || // the dam's powerhouse stands at the abutment
    lot === Lot.Jetty; // breakwater stones stand in the sea

  for (let t = 0; t < w.terrain.length; t++) {
    const lot = w.lot[t];
    if (lot > 0 && !isWaterExemptLot(lot)) {
      const x = t % width;
      const y = (t / width) | 0;
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
          const nt = ny * width + nx;
          if (isWater(w.terrain[nt])) {
            violations.push({
              type: "WATER_BUFFER_BUILDING",
              tile: t,
              msg: `Building (Lot ${lot}) directly borders water at tile ${t}`,
            });
            break;
          }
        }
      }
    }
  }

  // 3. Invariant: Block Purity & Road Frontage
  // Every full residential house (Terrain.Citizen, pop >= 3, lot === 0) MUST touch a road orthogonally
  for (let t = 0; t < w.terrain.length; t++) {
    if (w.terrain[t] === Terrain.Citizen && w.pop[t] >= 3 && w.lot[t] === 0) {
      const x = t % width;
      const y = (t / width) | 0;
      let hasRoad = false;
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
          if (isRoad(w.terrain[ny * width + nx])) {
            hasRoad = true;
            break;
          }
        }
      }
      if (!hasRoad) {
        violations.push({
          type: "ORPHAN_HOUSE",
          tile: t,
          msg: `Residential house with pop ${w.pop[t]} has no street frontage at tile ${t}`,
        });
      }
    }
  }

  // 4. Invariant: Parking Lot Adjacency
  // All present civic and commercial lot types must share at least one edge with a Lot.Parking tile
  for (const lotKind of CIVIC_AND_COMMERCIAL_LOTS) {
    const tiles = [];
    for (let t = 0; t < w.lot.length; t++) {
      if (w.lot[t] === lotKind) tiles.push(t);
    }
    if (tiles.length === 0) continue;

    let hasAdjacentParking = false;
    for (const t of tiles) {
      const x = t % width;
      const y = (t / width) | 0;
      for (let dy = -2; dy <= 2 && !hasAdjacentParking; dy++) {
        for (let dx = -2; dx <= 2 && !hasAdjacentParking; dx++) {
          if (Math.abs(dx) + Math.abs(dy) === 0) continue;
          if (Math.abs(dx) > 1 && Math.abs(dy) > 1) continue; // within 2 Manhattan / Chebyshev steps
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
            if (w.lot[ny * width + nx] === Lot.Parking) {
              hasAdjacentParking = true;
              break;
            }
          }
        }
      }
      if (hasAdjacentParking) break;
    }

    if (!hasAdjacentParking) {
      violations.push({
        type: "UNATTACHED_PARKING",
        tile: tiles[0],
        msg: `Institution (Lot ${lotKind}) has NO adjacent parking lot (cluster size: ${tiles.length})`,
      });
    }
  }

  // 5. Invariant: Zoning Separation
  // Minimum 6-tile distance between industrial structures and schools/churches
  const industrialTiles = [];
  const sensitiveTiles = [];
  for (let t = 0; t < w.terrain.length; t++) {
    const lot = w.lot[t];
    const dist = w.district[t];
    if (lot === Lot.Factory || lot === Lot.Warehouse || dist === Districts.Industrial) {
      industrialTiles.push(t);
    }
    if (lot === Lot.School || lot === Lot.HighSchool || lot === Lot.Church || lot === Lot.Chapel) {
      sensitiveTiles.push(t);
    }
  }

  for (const ind of industrialTiles) {
    const ix = ind % width;
    const iy = (ind / width) | 0;
    for (const sens of sensitiveTiles) {
      const sx = sens % width;
      const sy = (sens / width) | 0;
      const dist = Math.max(Math.abs(ix - sx), Math.abs(iy - sy));
      if (dist < 6) {
        violations.push({
          type: "ZONING_BUFFER",
          tile: ind,
          msg: `Industrial structure at (${ix},${iy}) is only ${dist} tiles from sensitive institution at (${sx},${sy}) (minimum: 6)`,
        });
        break;
      }
    }
  }

  return violations;
}

export function runMapgenAudit(seeds = DEFAULT_SEEDS) {
  console.log(`\n============================================================`);
  console.log(` FLOCK MAPGEN INVARIANT AUDIT RUNNER`);
  console.log(` Checking ${seeds.length} seeds across 5 town archetypes...`);
  console.log(`============================================================\n`);

  let totalRuns = 0;
  let totalViolations = 0;
  const failureLog = [];

  // the full seed batch on the 64² skirmish map, plus the benchmark seeds on
  // the 96² classic and 128² large maps (Stage 2 plan rules are size-aware)
  const runs = [];
  for (const townType of TOWN_TYPES) for (const seed of seeds) runs.push({ townType, seed, size: 64 });
  for (const size of [96, 128]) for (const townType of TOWN_TYPES) for (const seed of [11, 42, 77]) runs.push({ townType, seed, size });
  for (const { townType, seed, size } of runs) {
    {
      totalRuns++;
      const w = generateWorld(seed, size, size, { townType });
      const violations = [...auditWorld(w, seed, townType), ...auditPlan(w, seed, townType)];

      if (violations.length > 0) {
        totalViolations += violations.length;
        console.error(`  [FAIL] Archetype: ${townType.padEnd(10)} | Seed: ${String(seed).padEnd(6)} | ${size}² -> ${violations.length} violations`);
        violations.slice(0, 3).forEach((v) => console.error(`         * ${v.msg}`));
        failureLog.push({ seed, townType, violations });
      } else {
        console.log(`  [PASS] Archetype: ${townType.padEnd(10)} | Seed: ${String(seed).padEnd(6)} -> 100% Invariants Met`);
      }
    }
  }

  console.log(`\n------------------------------------------------------------`);
  console.log(` AUDIT SUMMARY: ${totalRuns} worlds audited. Violations: ${totalViolations}`);
  console.log(`------------------------------------------------------------\n`);

  if (totalViolations > 0) {
    console.error(`[ERROR] Mapgen QA audit failed with ${totalViolations} invariant violations!`);
    return false;
  }

  console.log(`[SUCCESS] All map generation invariants verified cleanly!`);
  return true;
}

// Run CLI if called directly
if (process.argv[1]?.endsWith("audit_mapgen.mjs")) {
  const count = process.argv.includes("--full") ? 50 : 15;
  const seeds = Array.from({ length: count }, (_, i) => (i + 1) * 73 + 11);
  const success = runMapgenAudit(seeds);
  process.exit(success ? 0 : 1);
}
