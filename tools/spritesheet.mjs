/**
 * Sprite-sheet inventory: render every building icon, landmark icon, and lot
 * building in a clean grid so the procedural pixel art can be audited at once.
 * Dev QA only — drives the same renderTown the game uses.
 *
 * Usage: node tools/spritesheet.mjs [out.png]
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, readFileSync } from "node:fs";
import {
  loadBalance, createSim, generateWorld, renderTown, IntentType, step, Terrain, Lot,
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
const SIZE = 32;
const world = generateWorld(11, SIZE, SIZE);
// clean grass canvas, no pop/lots/landmarks
for (let t = 0; t < SIZE * SIZE; t++) { world.terrain[t] = Terrain.Grass; world.pop[t] = 0; world.lot[t] = 0; world.owner[t] = 0; world.landmark[t] = 0; world.state[t] = 0; }
const sim = createSim({ seed: 11, balance, world, spawns: [{ id: 1, archetype: "dawn" }], foundingTicks: 0, timerTicks: 0 });
step(sim, { n: 0, intents: [{ t: IntentType.SPAWN, player: 1, tile: 0 }], seedSlice: 1 }, balance);
sim.buildings.length = 0; // drop the auto compound from spawn

const BUILD_TYPES = ["compound","collection_plate","watchtower","broadcast_tower","hotline_center","print_shop","garage","supplement_lab","satellite"];
// row 2: buildings (owner-coloured icons)
BUILD_TYPES.forEach((type, i) => {
  sim.buildings.push({ id: i + 1, player: 1, type, tile: 2 * SIZE + 2 + i * 2, buildTicksLeft: 0, disabledTicks: 0 });
});
// row 6: landmarks (gold icons): RadioTower..WaterTower = 1..5
for (let lm = 1; lm <= 5; lm++) world.landmark[6 * SIZE + 2 + (lm - 1) * 2] = lm;
// rows 10,12: every lot building
const LOTS = Object.entries(Lot).filter(([, v]) => v > 0);
LOTS.forEach(([, v], i) => {
  const col = i % 10, rowi = (i / 10) | 0;
  const t = (10 + rowi * 2) * SIZE + 2 + col * 2;
  world.terrain[t] = Terrain.Citizen; world.lot[t] = v; world.pop[t] = 5;
});

const frame = renderTown(sim, { frameTick: sim.tick, viewer: 1, lod: 6, view: { x: 1, y: 1, w: 22, h: 16 } });
writePNG(process.argv[2] ?? "shots/spritesheet.png", frame.width, frame.height, Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength));
