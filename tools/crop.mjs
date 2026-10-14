/**
 * In-situ crop (Dual-QA Harness B, fast path): render one zoomed map window.
 * Usage: node tools/crop.mjs <seed> <town> <cx> <cy> [w=32] [h=24] [lod=3]
 *        [season=summer] [time=day] [tick=0] [out=scratch/crop.png]
 * cx/cy may be a Lot name (e.g. TownHall, HighSchool) to centre on its first tile.
 */
import { readFileSync } from "node:fs";
import { loadBalance, createSim, generateWorld, renderTown, Lot, Landmark } from "../packages/sim/dist/index.js";
import { writePNG } from "./lib/png.mjs";

const [seed = "11", town = "farm", cxA = "48", cyA = "48", w = "32", h = "24", lod = "3",
  season = "summer", time = "day", tick = "0", out = "scratch/crop.png"] = process.argv.slice(2);
const SIZE = 96;
const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));
const world = generateWorld(+seed, SIZE, SIZE, { townType: town });
let cx = +cxA, cy = +cyA;
if (Number.isNaN(cx)) {
  const t = cxA in Lot ? world.lot.indexOf(Lot[cxA]) : world.landmark.indexOf(Landmark[cxA]);
  if (t < 0) throw new Error(`no ${cxA} on this map`);
  cx = t % SIZE; cy = Math.floor(t / SIZE) + (Number.isNaN(+cyA) ? 0 : +cyA);
}
const sim = createSim({ seed: +seed, balance, world, spawns: [], timerTicks: 0, dominationPermille: 1000 });
const view = { x: Math.max(0, Math.min(SIZE - +w, cx - (+w >> 1))), y: Math.max(0, Math.min(SIZE - +h, cy - (+h >> 1))), w: +w, h: +h };
const { data, width, height } = renderTown(sim, { frameTick: +tick, lod: +lod, view, season, timeOfDay: time });
writePNG(out, width, height, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
console.log(`${out} ${width}x${height} view=${JSON.stringify(view)}`);
