import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import {
  loadBalance,
  createSim,
  generateWorld,
  renderTown,
  Lot,
  Terrain,
} from "../packages/sim/dist/index.js";

const OUT = "docs/assets/curated";
mkdirSync(OUT, { recursive: true });

// CRC32 helper
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
  console.log(`Rendered: ${path} (${width}x${height})`);
}

const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));
const SIZE = 96;

function renderAndSave(filename, sim, lod, view = null, season = "summer", timeOfDay = "day") {
  const opts = { frameTick: 0, lod, season, timeOfDay };
  if (view) opts.view = view;
  const { data, width, height } = renderTown(sim, opts);
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  writePNG(`${OUT}/${filename}.png`, width, height, buf);
}

async function run() {
  console.log("Generating curated visual review suite for Claude Opus 5.5...");

  // 1. Archetype Town Overviews (LOD 1)
  const archetypes = [
    { name: "archetype_farm_seed11", seed: 11, archetype: "farm" },
    { name: "archetype_lakeside_seed21", seed: 21, archetype: "lakeside" },
    { name: "archetype_desert_seed42", seed: 42, archetype: "desert" },
    { name: "archetype_mountain_seed77", seed: 77, archetype: "mountain" },
    { name: "archetype_oceanside_seed99", seed: 99, archetype: "oceanside" },
  ];

  for (const arc of archetypes) {
    const world = generateWorld(arc.seed, SIZE, SIZE, { archetype: arc.archetype });
    const sim = createSim({ seed: arc.seed, balance, world, spawns: [], timerTicks: 0, dominationPermille: 1000 });
    renderAndSave(arc.name, sim, 1);
  }

  // 2. Seasonal Palette Showcase (Seed 11, Summer/Fall/Winter/Spring)
  const world11 = generateWorld(11, SIZE, SIZE);
  const sim11 = createSim({ seed: 11, balance, world: world11, spawns: [], timerTicks: 0, dominationPermille: 1000 });
  renderAndSave("season_spring_day", sim11, 1, null, "spring", "day");
  renderAndSave("season_summer_day", sim11, 1, null, "summer", "day");
  renderAndSave("season_fall_day", sim11, 1, null, "fall", "day");
  renderAndSave("season_winter_day", sim11, 1, null, "winter", "day");

  // 3. Diurnal Lighting Cycle (Seed 11 Summer)
  renderAndSave("lighting_dawn", sim11, 1, null, "summer", "dawn");
  renderAndSave("lighting_day", sim11, 1, null, "summer", "day");
  renderAndSave("lighting_dusk", sim11, 1, null, "summer", "dusk");
  renderAndSave("lighting_night", sim11, 1, null, "summer", "night");

  // 4. Keystone Micro-Detail Crops (LOD 3)
  const clampView = (cx, cy) => {
    const w = 28;
    const h = 20;
    return {
      x: Math.max(0, Math.min(SIZE - w, cx - Math.floor(w / 2))),
      y: Math.max(0, Math.min(SIZE - h, cy - Math.floor(h / 2))),
      w,
      h,
    };
  };

  // Find locations for crops
  let downtownCoord = { x: 48, y: 48 };
  let depotCoord = { x: 48, y: 48 };
  let farmCoord = { x: 20, y: 20 };

  for (let t = 0; t < world11.lot.length; t++) {
    if (world11.lot[t] === Lot.TownHall && downtownCoord.x === 48) {
      downtownCoord = { x: t % SIZE, y: Math.floor(t / SIZE) };
    }
    if (world11.lot[t] === Lot.Depot && depotCoord.x === 48) {
      depotCoord = { x: t % SIZE, y: Math.floor(t / SIZE) };
    }
    if (world11.terrain[t] === Terrain.Field && farmCoord.x === 20) {
      farmCoord = { x: t % SIZE, y: Math.floor(t / SIZE) };
    }
  }

  renderAndSave("detail_downtown_core", sim11, 3, clampView(downtownCoord.x, downtownCoord.y), "summer", "day");
  renderAndSave("detail_train_depot", sim11, 3, clampView(depotCoord.x, depotCoord.y), "summer", "day");
  renderAndSave("detail_agriculture_tracks", sim11, 3, clampView(farmCoord.x, farmCoord.y), "summer", "day");
  renderAndSave("detail_winter_night_glow", sim11, 3, clampView(downtownCoord.x, downtownCoord.y), "winter", "night");

  console.log("Curated suite generation complete!");
}

run().catch(console.error);
