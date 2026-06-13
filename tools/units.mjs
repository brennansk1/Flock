/**
 * Unit-sprite preview: injects one of each unit onto a small map and renders a
 * zoomed close-up so the procedural sprites can be eyeballed. Dev QA only.
 *
 * Usage: node tools/units.mjs [out.png]
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, readFileSync } from "node:fs";
import {
  loadBalance, createSim, generateWorld, renderTown, IntentType, step, Terrain,
} from "../packages/sim/dist/index.js";

const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const o = Buffer.alloc(8 + d.length + 4); o.writeUInt32BE(d.length, 0); o.write(t, 4, "ascii"); d.copy(o, 8); o.writeUInt32BE(crc32(o.subarray(4, 8 + d.length)), 8 + d.length); return o; };
function writePNG(path, width, height, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
  writeFileSync(path, Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
  console.log(`wrote ${path} (${width}×${height})`);
}

const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));
const SIZE = 24;
const world = generateWorld(7, SIZE, SIZE);
// flatten a patch to road/citizen so units sit on a clean backdrop
for (let y = 8; y < 16; y++) for (let x = 4; x < 20; x++) world.terrain[y * SIZE + x] = (y % 3 === 0) ? Terrain.Road : Terrain.Citizen;
const sim = createSim({ seed: 7, balance, world, spawns: [{ id: 1, archetype: "dawn" }], foundingTicks: 0, timerTicks: 0 });
step(sim, { n: 0, intents: [{ t: IntentType.SPAWN, player: 1, tile: 11 * SIZE + 11 }], seedSlice: 1 }, balance);

// clear a clean asphalt lane so the sprites read without house clutter
const row = 10 * SIZE;
for (let x = 0; x < SIZE; x++) { const t = row + x; world.terrain[t] = Terrain.Road; world.pop[t] = 0; world.lot[t] = 0; world.owner[t] = 0; world.landmark[t] = 0; }

// inject one of each unit at known tiles, mid-stride where it matters
sim.couriers.push({ id: 1, player: 1, plateA: 0, plateB: 0, path: [row + 5, row + 6], idx: 0, moveProgress: 32768, carrying: 0 });
sim.vans.push({ id: 2, player: 1, tile: row + 9, path: [row + 9, row + 10], idx: 0, moveProgress: 32768, ticksLeft: 0 });
sim.pylons.push({ player: 1, tile: row + 13, ticksLeft: 100 });
sim.pickets.push({ target: 1, tile: row + 16, ticksLeft: 100 });
sim.agents.push({ id: 3, player: 1, tile: row + 19, district: 1, mission: "deprogram", phase: "act", travelTicksLeft: 0, exposureTicks: 0 });
sim.auras.push({ player: 1, tile: 12 * SIZE + 11, radius: 5, ticksLeft: 100, kind: "festival" });

// render at LOD 6 so the 8px tiles blow up for inspection
const view = { x: 3, y: 8, w: 18, h: 6 };
const frame = renderTown(sim, { frameTick: sim.tick, viewer: 1, lod: 6, view });
writePNG(process.argv[2] ?? "shots/units.png", frame.width, frame.height, Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength));
