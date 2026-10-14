/**
 * Zoning QA map: districts as flat colours, roads grey, rail black, water
 * blue, rock brown, key lots marked — one panel per town type × seed.
 * Usage: node tools/zoning_map.mjs [seeds=11,42,77] [size=96] [out=scratch/audit/zoning.png]
 */
import { generateWorld, Terrain, Lot } from "../packages/sim/dist/index.js";
import { writePNG } from "./lib/png.mjs";
const seeds = (process.argv[2] ?? "11,42,77").split(",").map(Number);
const N = +(process.argv[3] ?? 96), out = process.argv[4] ?? "scratch/audit/zoning.png", PX = 3, GAP = 4;
const TOWNS = ["farm", "lakeside", "desert", "mountain", "oceanside"];
// district: 1 Suburbs, 2 College, 3 Downtown, 4 OldTown, 5 Trailer, 6 Commercial, 7 Industrial, 8 ResHigh
const DC = { 1: [150, 200, 120], 2: [120, 170, 220], 3: [230, 70, 60], 4: [200, 170, 90], 5: [210, 200, 170], 6: [240, 150, 50], 7: [140, 90, 160], 8: [240, 120, 150] };
const LOTC = { [Lot.Courthouse]: [255, 255, 255], [Lot.HighSchool]: [30, 60, 200], [Lot.Track]: [60, 120, 255], [Lot.Church]: [255, 240, 0], [Lot.School]: [0, 200, 255], [Lot.GrainElevator]: [60, 20, 80], [Lot.Factory]: [60, 20, 80], [Lot.Parking]: [110, 110, 110] };
const W = TOWNS.length * (N * PX + GAP), H = seeds.length * (N * PX + GAP), rgba = Buffer.alloc(W * H * 4, 24);
seeds.forEach((seed, row) => TOWNS.forEach((town, col) => {
  const w = generateWorld(seed, N, N, { townType: town });
  for (let t = 0; t < N * N; t++) {
    const tr = w.terrain[t];
    let c = tr === Terrain.Road ? [90, 90, 90] : tr === Terrain.Dirt ? [150, 120, 90] : tr === Terrain.Rail ? [20, 20, 20]
      : tr === Terrain.Lake ? [50, 90, 170] : tr === Terrain.Rock ? [110, 80, 60] : tr === Terrain.Woods ? [40, 90, 40]
      : tr === Terrain.Citizen ? (LOTC[w.lot[t]] ?? DC[w.district[t]] ?? [255, 0, 255]) : [70, 100, 60];
    if (tr === Terrain.Citizen && w.lot[t] === 0 && w.pop[t] < 3) c = c.map((v) => (v * 0.7) | 0); // backyard/vacant
    const x0 = col * (N * PX + GAP) + (t % N) * PX, y0 = row * (N * PX + GAP) + ((t / N) | 0) * PX;
    for (let dy = 0; dy < PX; dy++) for (let dx = 0; dx < PX; dx++) { const i = ((y0 + dy) * W + x0 + dx) * 4; rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255; }
  }
}));
writePNG(out, W, H, rgba);
console.log(out, "legend: red Downtown · orange Commercial · pink ResHigh · tan OldTown · green Suburbs · blue College · purple Industrial · beige Trailer · white Courthouse · dark-blue HS/Track · yellow Church · grey Parking · dim = backyard");
