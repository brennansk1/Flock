/**
 * B1.4.19 — Mapgen quality-metrics harness (PROCGEN rule §4).
 *
 * Measures map QUALITY beyond pass/fail invariants, per seed batch, so
 * generator changes can be judged by delta instead of eyeball:
 *
 *   roadConnectivity  largest road component / all road+dirt tiles (→ 1.0)
 *   blockCount/median/p90  city-block granularity inside the town plat
 *   lotVariety        distinct lot kinds + Shannon entropy (bits) of the mix
 *   nameUniqueness    unique street names / named streets
 *   farmShare         cultivated share of open country (fields+orchard+pasture)
 *   waterShare        lake/river share of the map
 *
 * Usage: node tools/mapmetrics.mjs [townType] [size]
 *   e.g.  node tools/mapmetrics.mjs            # farm 96
 *         node tools/mapmetrics.mjs oceanside  # archetype batch
 */

import { generateWorld, Terrain, Lot } from "../packages/sim/dist/index.js";

const townType = process.argv[2] ?? "farm";
const SIZE = Number(process.argv[3] ?? 96);
const SEEDS = [1, 2, 3, 42, 99];

function components(pass, n, width) {
  // 4-connected component sizes over `pass(t)` tiles
  const label = new Int32Array(n).fill(-1);
  const sizes = [];
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (label[s] !== -1 || !pass(s)) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const t = stack.pop();
      size++;
      const x = t % width;
      for (const nb of [t - width, t + width, x > 0 ? t - 1 : -1, x < width - 1 ? t + 1 : -1]) {
        if (nb < 0 || nb >= n || label[nb] !== -1 || !pass(nb)) continue;
        label[nb] = id;
        stack.push(nb);
      }
    }
    sizes.push(size);
  }
  return sizes;
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

const batch = [];
for (const seed of SEEDS) {
  const w = generateWorld(seed, SIZE, SIZE, townType === "farm" ? {} : { townType });
  const n = w.terrain.length;

  // --- road connectivity -----------------------------------------------
  const isPath = (t) => w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Dirt;
  const roadComps = components(isPath, n, w.width).sort((a, b) => b - a);
  const pathTotal = roadComps.reduce((a, b) => a + b, 0);
  const roadConnectivity = pathTotal ? (roadComps[0] ?? 0) / pathTotal : 0;

  // --- block granularity: non-path, non-water pockets inside the plat ---
  // bounding box of the Road network approximates the platted town + rural grid
  let minX = w.width, maxX = 0, minY = w.height, maxY = 0, roadTiles = 0;
  for (let t = 0; t < n; t++) {
    if (w.terrain[t] !== Terrain.Road) continue;
    roadTiles++;
    const x = t % w.width, y = (t / w.width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const inBox = (t) => {
    const x = t % w.width, y = (t / w.width) | 0;
    return x > minX && x < maxX && y > minY && y < maxY;
  };
  const blockSizes = components(
    (t) => inBox(t) && !isPath(t) && w.terrain[t] !== Terrain.Lake && w.terrain[t] !== Terrain.Rail,
    n,
    w.width,
  )
    .filter((s) => s >= 4 && s <= 400) // ignore slivers and the open country
    .sort((a, b) => a - b);

  // --- lot variety --------------------------------------------------------
  const lotCounts = new Map();
  let lots = 0;
  for (let t = 0; t < n; t++) {
    const l = w.lot[t];
    if (l === 0) continue;
    lots++;
    lotCounts.set(l, (lotCounts.get(l) ?? 0) + 1);
  }
  let entropy = 0;
  for (const c of lotCounts.values()) {
    const p = c / lots;
    entropy -= p * Math.log2(p);
  }

  // --- name uniqueness ----------------------------------------------------
  const names = w.streets.map((s) => s.name).filter(Boolean);
  const nameUniqueness = names.length ? new Set(names).size / names.length : 0;

  // --- land use -------------------------------------------------------------
  let cultivated = 0, water = 0, open = 0;
  for (let t = 0; t < n; t++) {
    const tr = w.terrain[t];
    if (tr === Terrain.Field || tr === Terrain.Orchard || tr === Terrain.Pasture) cultivated++;
    if (tr === Terrain.Lake) water++;
    if (tr === Terrain.Grass || tr === Terrain.Woods) open++;
  }

  batch.push({
    seed,
    roadConnectivity: +roadConnectivity.toFixed(4),
    blockCount: blockSizes.length,
    blockMedian: quantile(blockSizes, 0.5),
    blockP90: quantile(blockSizes, 0.9),
    lotKinds: lotCounts.size,
    lotEntropyBits: +entropy.toFixed(2),
    nameUniqueness: +nameUniqueness.toFixed(3),
    farmShare: +(cultivated / (cultivated + open)).toFixed(3),
    waterShare: +(water / n).toFixed(3),
  });
}

const avg = (k) => +(batch.reduce((a, r) => a + r[k], 0) / batch.length).toFixed(3);
console.log(`\nMAPGEN QUALITY METRICS — ${townType} ${SIZE}×${SIZE}, seeds ${SEEDS.join("/")}\n`);
console.table(batch);
console.log("batch means:", {
  roadConnectivity: avg("roadConnectivity"),
  blockCount: avg("blockCount"),
  blockMedian: avg("blockMedian"),
  lotKinds: avg("lotKinds"),
  lotEntropyBits: avg("lotEntropyBits"),
  nameUniqueness: avg("nameUniqueness"),
  farmShare: avg("farmShare"),
  waterShare: avg("waterShare"),
});
