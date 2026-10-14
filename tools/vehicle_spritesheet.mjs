/**
 * Vehicle Asset Spritesheet Generator
 * Renders an audited, high-resolution inventory of all FLOCK vehicle assets.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  loadBalance, createSim, generateWorld, renderTown, Terrain, Lot,
} from "../packages/sim/dist/index.js";

const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const o = Buffer.alloc(8 + d.length + 4); o.writeUInt32BE(d.length, 0); o.write(t, 4, "ascii"); d.copy(o, 8); o.writeUInt32BE(crc32(o.subarray(4, 8 + d.length)), 8 + d.length); return o; };

function writePNG(path, width, height, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]));
  console.log(`Saved PNG: ${path} (${width}×${height})`);
}

const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));
const SIZE = 32;
const world = generateWorld(42, SIZE, SIZE);

for (let t = 0; t < SIZE * SIZE; t++) {
  world.terrain[t] = Terrain.Grass;
  world.pop[t] = 0;
  world.lot[t] = 0;
  world.owner[t] = 0;
  world.landmark[t] = 0;
  world.state[t] = 0;
}

// 2-lane Highway & 2-lane Local Streets
for (let x = 2; x < 28; x++) {
  world.terrain[2 * SIZE + x] = Terrain.Road;
  world.terrain[3 * SIZE + x] = Terrain.Road; // 2-lane highway
  world.terrain[5 * SIZE + x] = Terrain.Road;
}
for (let y = 1; y < 14; y++) {
  world.terrain[y * SIZE + 4] = Terrain.Road;
}

// Civic lots with parked vehicles
world.terrain[7 * SIZE + 8] = Terrain.Citizen; world.lot[7 * SIZE + 8] = Lot.School;
world.terrain[7 * SIZE + 12] = Terrain.Citizen; world.lot[7 * SIZE + 12] = Lot.Barn;
world.terrain[7 * SIZE + 16] = Terrain.Rail; world.terrain[7 * SIZE + 17] = Terrain.Rail; world.terrain[7 * SIZE + 18] = Terrain.Rail;
world.terrain[7 * SIZE + 19] = Terrain.Citizen; world.lot[7 * SIZE + 19] = Lot.GrainElevator;
world.terrain[9 * SIZE + 8] = Terrain.Citizen; world.lot[9 * SIZE + 8] = Lot.Parking;
world.terrain[9 * SIZE + 10] = Terrain.Citizen; world.lot[9 * SIZE + 10] = Lot.Motel;

const sim = createSim({
  seed: 42,
  balance,
  world,
  spawns: [
    { id: 1, archetype: "dawn" },
    { id: 2, archetype: "radiant" },
    { id: 3, archetype: "circle" },
    { id: 4, archetype: "visitors" },
  ],
  foundingTicks: 0,
  timerTicks: 0,
});

sim.vans.push(
  { id: 1, player: 1, tile: 11 * SIZE + 6, path: [11 * SIZE + 6, 11 * SIZE + 7], idx: 0, moveProgress: { val: 0.5 }, health: 100, stance: 0 },
  { id: 2, player: 2, tile: 11 * SIZE + 10, path: [11 * SIZE + 10, 11 * SIZE + 11], idx: 0, moveProgress: { val: 0.5 }, health: 100, stance: 0 },
  { id: 3, player: 3, tile: 11 * SIZE + 14, path: [11 * SIZE + 14, 11 * SIZE + 15], idx: 0, moveProgress: { val: 0.5 }, health: 100, stance: 0 },
  { id: 4, player: 4, tile: 11 * SIZE + 18, path: [11 * SIZE + 18, 11 * SIZE + 19], idx: 0, moveProgress: { val: 0.5 }, health: 100, stance: 0 },
);

sim.couriers.push(
  { id: 1, player: 1, path: [13 * SIZE + 6, 13 * SIZE + 7], idx: 0, moveProgress: { val: 0.5 }, amount: 50 },
  { id: 2, player: 3, path: [13 * SIZE + 14, 13 * SIZE + 15], idx: 0, moveProgress: { val: 0.5 }, amount: 150 },
);

const frame = renderTown(sim, {
  frameTick: 24,
  viewer: 1,
  lod: 6,
  view: { x: 0, y: 0, w: 26, h: 15 },
});

const artifactsDir = "scratch";
mkdirSync(artifactsDir, { recursive: true });
mkdirSync("QA gallery", { recursive: true });

const rgbaBuffer = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);

writePNG(join(artifactsDir, "vehicle_spritesheet.png"), frame.width, frame.height, rgbaBuffer);
writePNG(join("QA gallery", "vehicle_spritesheet.png"), frame.width, frame.height, rgbaBuffer);
