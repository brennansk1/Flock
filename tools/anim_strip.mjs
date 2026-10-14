/**
 * Animation QA strip: render one map window at N ticks and lay the frames
 * side by side, to judge micro-animations (ripples, surf, beacons, smoke…).
 * Usage: node tools/anim_strip.mjs <seed> <town> <cx|LotName|LandmarkName|terrain:Name> <cy>
 *        [w=12] [h=10] [lod=3] [season=summer] [time=day] [t0=0] [dt=3] [n=6] [out=scratch/anim.png]
 */
import { readFileSync } from "node:fs";
import { loadBalance, createSim, generateWorld, renderTown, Lot, Landmark, Terrain } from "../packages/sim/dist/index.js";
import { writePNG } from "./lib/png.mjs";

const [seed = "11", town = "farm", cxA = "48", cyA = "0", w = "12", h = "10", lod = "3",
  season = "summer", time = "day", t0 = "0", dt = "3", n = "6", out = "scratch/anim.png"] = process.argv.slice(2);
const SIZE = 96;
const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));
const world = generateWorld(+seed, SIZE, SIZE, { townType: town });
let cx = +cxA, cy = +cyA;
if (Number.isNaN(cx)) {
  const t = cxA.startsWith("terrain:") ? world.terrain.indexOf(Terrain[cxA.slice(8)])
    : cxA in Lot ? world.lot.indexOf(Lot[cxA]) : world.landmark.indexOf(Landmark[cxA]);
  if (t < 0) throw new Error(`no ${cxA} on this map`);
  cx = t % SIZE; cy = Math.floor(t / SIZE) + (+cyA || 0);
}
const sim = createSim({ seed: +seed, balance, world, spawns: [], timerTicks: 0, dominationPermille: 1000 });
const view = { x: Math.max(0, Math.min(SIZE - +w, cx - (+w >> 1))), y: Math.max(0, Math.min(SIZE - +h, cy - (+h >> 1))), w: +w, h: +h };
const frames = [];
for (let i = 0; i < +n; i++) frames.push(renderTown(sim, { frameTick: +t0 + i * +dt, lod: +lod, view, season, timeOfDay: time }));
const fw = frames[0].width, fh = frames[0].height, gap = 4, W = fw * frames.length + gap * (frames.length - 1);
const rgba = Buffer.alloc(W * fh * 4, 0x18);
frames.forEach((f, i) => {
  for (let y = 0; y < fh; y++) Buffer.from(f.data.buffer, f.data.byteOffset + y * fw * 4, fw * 4).copy(rgba, (y * W + i * (fw + gap)) * 4);
});
writePNG(out, W, fh, rgba);
console.log(`${out} ${W}x${fh} view=${JSON.stringify(view)}`);
