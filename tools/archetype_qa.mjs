/**
 * B1.4.14.7 — Town-archetype sample-set QA renders (QA_MAPGEN.md protocol).
 * Renders every §2A archetype across seeds: the full map plus a magnified
 * crop centered on the archetype's anchor asset (lighthouse/cannery, sawmill,
 * resort dock, town oasis). Seeds are baked into filenames so every sample is
 * reproducible.
 *
 * Usage: node tools/archetype_qa.mjs [outDir]
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import {
  loadBalance,
  createSim,
  generateWorld,
  renderTown,
  Lot,
} from "../packages/sim/dist/index.js";

const OUT = process.argv[2] ?? "QA gallery/Archetypes_2026-07-05";
mkdirSync(OUT, { recursive: true });

const balance = loadBalance(JSON.parse(readFileSync("balance.json", "utf8")));

// ---- PNG writer (same encoder as screenshots.mjs) --------------------------
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
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1,
    );
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  console.log(`${path}  ${width}x${height}`);
}

// ---- render ----------------------------------------------------------------
const SEEDS = [11, 42, 99];
const SIZE = 96;
const ANCHORS = {
  oceanside: [Lot.Lighthouse, Lot.Cannery],
  mountain: [Lot.Sawmill],
  lakeside: [Lot.Dock],
  desert: [], // crop on the town center oasis instead
};

function findLot(w, kinds) {
  for (const kind of kinds) {
    for (let t = 0; t < w.lot.length; t++) if (w.lot[t] === kind) return t;
  }
  return -1;
}

for (const townType of Object.keys(ANCHORS)) {
  for (const seed of SEEDS) {
    const world = generateWorld(seed, SIZE, SIZE, { townType });
    const sim = createSim({ seed, balance, world, spawns: [] });

    const full = renderTown(sim, { frameTick: 0 });
    writePNG(`${OUT}/${townType}_seed${seed}_full.png`, full.width, full.height, full.data);

    // magnified crop (lod 3) centered on the archetype anchor
    let anchor = findLot(world, ANCHORS[townType]);
    if (anchor < 0) anchor = Math.floor((SIZE / 2) * SIZE + SIZE / 2); // desert: town core
    const ax = anchor % SIZE;
    const ay = Math.floor(anchor / SIZE);
    const CROP = 28;
    const view = {
      x: Math.max(0, Math.min(SIZE - CROP, ax - CROP / 2)),
      y: Math.max(0, Math.min(SIZE - CROP, ay - CROP / 2)),
      w: CROP,
      h: CROP,
    };
    const crop = renderTown(sim, { frameTick: 0, lod: 3, view });
    writePNG(`${OUT}/${townType}_seed${seed}_anchor.png`, crop.width, crop.height, crop.data);
  }
}
console.log("done — seeds baked into filenames for reproducibility");
