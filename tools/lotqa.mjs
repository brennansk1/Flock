/**
 * Lot QA sheet (renderer): each named lot at its main footprint fronting a
 * street on S / N / E / W, then its alt size, winter and night — one row
 * per lot on a grass studio lot with the street kept, so ground blending
 * reads. Usage: node tools/lotqa.mjs <out.png> <Lot,Lot,...> [lod=4] [district] [tick=0]
 */
import { readFileSync } from "node:fs";
import { loadBalance, createSim, generateWorld, renderTown, Lot, Terrain, Districts, footprintOf } from "../packages/sim/dist/index.js";
import { encodePNG } from "./lib/png.mjs";
import { writeFileSync } from "node:fs";

const [out = "scratch/lotqa.png", names = "Bank", lodA = "4", distA = "", tickA = "0"] = process.argv.slice(2);
const LOD = +lodA, TICK = +tickA;
const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));
const DEF_DIST = { Barn: Districts.Trailer, Greenhouse: Districts.Trailer, Silo: Districts.Trailer, Lighthouse: Districts.Trailer, Cannery: Districts.Trailer, Dock: Districts.Trailer,
  Sawmill: Districts.Industrial, GrainElevator: Districts.Industrial, Substation: Districts.Industrial, Factory: Districts.Industrial, Warehouse: Districts.Industrial,
  School: Districts.Suburbs, Playground: Districts.Suburbs, Park: Districts.Suburbs, WaterTower: Districts.Suburbs, Cemetery: Districts.OldTown, Chapel: Districts.OldTown, Church: Districts.OldTown,
  HighSchool: Districts.College, Library: Districts.College, Megachurch: Districts.Suburbs, Fairground: Districts.Trailer, RadioTower: Districts.Trailer };
function shot(lot, fw, fh, side, season, time, dist, extra) {
  const N = Math.max(fw, fh) + 4;
  const w = generateWorld(99, N, N);
  for (let i = 0; i < w.terrain.length; i++) { w.terrain[i] = Terrain.Grass; w.lot[i] = 0; w.pop[i] = 0; w.landmark[i] = 0; w.owner[i] = 0; w.district[i] = 0; w.biome[i] = 0; }
  const x0 = 2, y0 = 2;
  for (let k = 0; k < N; k++) {
    const [x, y] = side === "S" ? [k, y0 + fh] : side === "N" ? [k, y0 - 1] : side === "E" ? [x0 + fw, k] : [x0 - 1, k];
    w.terrain[y * N + x] = Terrain.Road;
  }
  for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) { const t = (y0 + dy) * N + x0 + dx; w.terrain[t] = Terrain.Citizen; w.lot[t] = lot; w.district[t] = dist; w.pop[t] = 4; }
  if (extra) extra(w, N, x0, y0);
  const sim = createSim({ seed: 99, balance, world: w, spawns: [], timerTicks: 0, dominationPermille: 1000 });
  const f = renderTown(sim, { frameTick: TICK, lod: LOD, view: { x: 1, y: 1, w: fw + 2, h: fh + 2 }, season, timeOfDay: time });
  return { w: f.width, h: f.height, d: f.data };
}
const rows = [];
for (const name of names.split(",")) {
  const lot = Lot[name]; const fp = footprintOf(lot);
  const dist = distA !== "" ? +distA : (DEF_DIST[name] ?? Districts.Downtown);
  const ONLY = process.env.ONLY ?? "";
  const SIDES = ONLY.startsWith("side:") ? ONLY.slice(5).split("") : ["S", "N", "E", "W"];
  const parts = ONLY === "var" ? [] : SIDES.map((s) => shot(lot, fp.w, fp.h, s, "summer", "day", dist));
  if (ONLY.startsWith("side:")) { rows.push(parts); continue; }
  if (ONLY === "facing") { rows.push(parts); continue; }
  if (fp.alt) { parts.push(shot(lot, fp.alt.w, fp.alt.h, "S", "summer", "day", dist)); parts.push(shot(lot, fp.alt.h, fp.alt.w, "E", "summer", "day", dist)); }
  parts.push(shot(lot, fp.w, fp.h, "S", "winter", "day", dist));
  parts.push(shot(lot, fp.w, fp.h, "S", "fall", "night", dist));
  rows.push(parts);
}
const GAP = 4;
const W = Math.max(...rows.map((r) => r.reduce((a, p) => a + p.w + GAP, 0)));
const H = rows.reduce((a, r) => a + Math.max(...r.map((p) => p.h)) + GAP, 0);
const buf = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { buf[i * 4] = 24; buf[i * 4 + 1] = 21; buf[i * 4 + 2] = 18; buf[i * 4 + 3] = 255; }
let oy = 0;
for (const r of rows) {
  let ox = 0; const rh = Math.max(...r.map((p) => p.h));
  for (const p of r) { for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) { const s = (y * p.w + x) * 4, d = ((oy + y) * W + ox + x) * 4; buf[d] = p.d[s]; buf[d + 1] = p.d[s + 1]; buf[d + 2] = p.d[s + 2]; } ox += p.w + GAP; }
  oy += rh + GAP;
}
writeFileSync(out, encodePNG(W, H, buf));
console.log(out, W, H);
