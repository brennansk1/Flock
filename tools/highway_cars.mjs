/**
 * Highway Traffic Visual Inspection Tool
 * Renders a full stretch of 4-lane highway filled with all car color variants,
 * headlights, windshield glints, taillights, and lane markings.
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
const SIZE = 40;
const world = generateWorld(77, SIZE, SIZE);

for (let t = 0; t < SIZE * SIZE; t++) {
  world.terrain[t] = Terrain.Grass;
  world.pop[t] = 0;
  world.lot[t] = 0;
  world.owner[t] = 0;
  world.landmark[t] = 0;
  world.state[t] = 0;
}

// Lay down 4-lane Highway (Row 4 & Row 5) across the entire width
for (let x = 0; x < SIZE; x++) {
  world.terrain[4 * SIZE + x] = Terrain.Road;
  world.terrain[5 * SIZE + x] = Terrain.Road;
}
// Lay down a second Highway stretch (Row 10 & Row 11)
for (let x = 0; x < SIZE; x++) {
  world.terrain[10 * SIZE + x] = Terrain.Road;
  world.terrain[11 * SIZE + x] = Terrain.Road;
}

// Vertical connecting road
for (let y = 0; y < SIZE; y++) {
  world.terrain[y * SIZE + 8] = Terrain.Road;
  world.terrain[y * SIZE + 24] = Terrain.Road;
}

const sim = createSim({
  seed: 77,
  balance,
  world,
  spawns: [{ id: 1, archetype: "dawn" }],
  foundingTicks: 0,
  timerTicks: 0,
});

// Render highway render at frameTick 48
const frame = renderTown(sim, {
  frameTick: 48,
  viewer: 1,
  lod: 6,
  view: { x: 0, y: 1, w: 32, h: 14 },
});

const artifactsDir = process.env.ARTIFACT_DIR || "./qa_shots";
mkdirSync(artifactsDir, { recursive: true });
mkdirSync("QA gallery", { recursive: true });

const rgbaBuffer = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);

writePNG(join(artifactsDir, "highway_cars.png"), frame.width, frame.height, rgbaBuffer);
writePNG(join("QA gallery", "highway_cars.png"), frame.width, frame.height, rgbaBuffer);
