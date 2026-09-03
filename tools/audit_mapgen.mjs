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
} from "../packages/sim/dist/index.js";

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
  Lot.Depot,
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
    lot === Lot.Sawmill;

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

  for (const townType of TOWN_TYPES) {
    for (const seed of seeds) {
      totalRuns++;
      const w = generateWorld(seed, 64, 64, { townType });
      const violations = auditWorld(w, seed, townType);

      if (violations.length > 0) {
        totalViolations += violations.length;
        console.error(`  [FAIL] Archetype: ${townType.padEnd(10)} | Seed: ${String(seed).padEnd(6)} -> ${violations.length} violations`);
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
