import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { generateWorld, renderTown, createSim } from "../packages/sim/dist/index.js";

const OUT_DIR = "QA gallery/Final_Release_QA";
mkdirSync(OUT_DIR, { recursive: true });

// CRC32 helper for PNG
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function writePNG(path, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  console.log(`Saved: ${path}`);
}

const SEEDS = [11, 21, 42, 77, 99];
const ARCHETYPES = ["farm", "oceanside", "desert", "mountain", "lakeside"];

console.log("Generating full-map renders for 5 seeds × 5 archetypes...");

for (const seed of SEEDS) {
  for (const townType of ARCHETYPES) {
    const world = generateWorld(seed, 96, 96, { townType });
    const sim = createSim({ seed, world, spawns: [] });
    const { data, width, height } = renderTown(sim);
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    writePNG(`${OUT_DIR}/map-seed-${seed}-${townType}.png`, width, height, buf);
  }
}

console.log("QA Gallery generation complete!");
