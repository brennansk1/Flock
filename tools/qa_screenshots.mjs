import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import {
  loadBalance,
  createSim,
  generateWorld,
  renderTown,
  Terrain,
  Lot,
  Landmark,
  Biome,
} from "../packages/sim/dist/index.js";

const OUT = process.argv[2] ?? "qa_shots";
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
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
  console.log(`wrote ${path} (${width}x${height})`);
}

const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));
const SIZE = 96;

function renderAndSave(name, sim, lod, view = null, season = "summer", timeOfDay = "day") {
  const opts = { frameTick: 0, lod, season, timeOfDay };
  if (view) {
    opts.view = view;
  }
  const { data, width, height } = renderTown(sim, opts);
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  writePNG(`${OUT}/${name}.png`, width, height, buf);
}

async function run() {
  const seeds = [11, 21, 42, 77, 99];
  
  // 1. LOD 1 full maps
  for (const seed of seeds) {
    const world = generateWorld(seed, SIZE, SIZE);
    const sim = createSim({ seed, balance, world, spawns: [], timerTicks: 0, dominationPermille: 1000 });
    renderAndSave(`map-seed-${seed}`, sim, 1);
  }

  // 2. Biome variants for seed 11
  {
    const worldNoBiomes = generateWorld(11, SIZE, SIZE, { biomes: [] });
    const simNo = createSim({ seed: 11, balance, world: worldNoBiomes, spawns: [], timerTicks: 0, dominationPermille: 1000 });
    renderAndSave("map-seed-11-no-biomes", simNo, 1);

    const worldDesertOnly = generateWorld(11, SIZE, SIZE, { biomes: ["desert"] });
    const simDesert = createSim({ seed: 11, balance, world: worldDesertOnly, spawns: [], timerTicks: 0, dominationPermille: 1000 });
    renderAndSave("map-seed-11-desert-only", simDesert, 1);
  }

  // 3. LOD 3 crops for seed 11
  {
    const seed = 11;
    const world = generateWorld(seed, SIZE, SIZE);
    const sim = createSim({ seed, balance, world, spawns: [], timerTicks: 0, dominationPermille: 1000 });

    const getCoord = (idx) => ({ x: idx % SIZE, y: Math.floor(idx / SIZE) });
    const clampView = (cx, cy) => {
      const w = 28;
      const h = 20;
      let x = cx - Math.floor(w / 2);
      let y = cy - Math.floor(h / 2);
      x = Math.max(0, Math.min(SIZE - w, x));
      y = Math.max(0, Math.min(SIZE - h, y));
      return { x, y, w, h };
    };

    // Find landmarks & districts to crop
    let townHallIdx = -1;
    let mainStIdx = -1;
    let resIdx = -1;
    let indIdx = -1;
    let railSidingIdx = -1;
    let farmIdx = -1;
    let bridgeIdx = -1;
    let lakeIdx = -1;
    let desertEcotoneIdx = -1;
    let forestIdx = -1;

    for (let t = 0; t < world.terrain.length; t++) {
      const { x, y } = getCoord(t);
      if (world.landmark[t] === Landmark.TownHall) townHallIdx = t;
      if (world.district[t] === 3 && world.terrain[t] === Terrain.Road && mainStIdx === -1) mainStIdx = t;
      if (world.district[t] === 1 && world.pop[t] >= 3 && resIdx === -1) resIdx = t;
      if (world.district[t] === 5 && world.lot[t] === Lot.Factory && indIdx === -1) indIdx = t;
      if (world.terrain[t] === Terrain.Rail && world.lot[t] === Lot.GrainElevator && railSidingIdx === -1) railSidingIdx = t;
      if (world.lot[t] === Lot.Barn && farmIdx === -1) farmIdx = t;
      // Bridge check: Road or Rail over Lake
      if ((world.terrain[t] === Terrain.Road || world.terrain[t] === Terrain.Rail) && bridgeIdx === -1) {
        // Let's check neighbors to see if it's over water
        let hasLakeNeighbor = false;
        for (const offset of [-1, 1, -SIZE, SIZE]) {
          const nt = t + offset;
          if (nt >= 0 && nt < world.terrain.length && world.terrain[nt] === Terrain.Lake) {
            hasLakeNeighbor = true;
          }
        }
        if (hasLakeNeighbor) bridgeIdx = t;
      }
      if (world.terrain[t] === Terrain.Lake && lakeIdx === -1) {
        // next to land
        let nearLand = false;
        for (const offset of [-1, 1, -SIZE, SIZE]) {
          const nt = t + offset;
          if (nt >= 0 && nt < world.terrain.length && world.terrain[nt] !== Terrain.Lake) nearLand = true;
        }
        if (nearLand) lakeIdx = t;
      }
      if (world.biome[t] === Biome.Desert && desertEcotoneIdx === -1) {
        let nearTemp = false;
        for (const offset of [-1, 1, -SIZE, SIZE]) {
          const nt = t + offset;
          if (nt >= 0 && nt < world.terrain.length && world.biome[nt] === Biome.Temperate) nearTemp = true;
        }
        if (nearTemp) desertEcotoneIdx = t;
      }
      if (world.biome[t] === Biome.Forest && forestIdx === -1) {
        let nearTemp = false;
        for (const offset of [-1, 1, -SIZE, SIZE]) {
          const nt = t + offset;
          if (nt >= 0 && nt < world.terrain.length && world.biome[nt] === Biome.Temperate) nearTemp = true;
        }
        if (nearTemp) forestIdx = t;
      }
    }

    // Fallbacks if not found
    if (townHallIdx === -1) townHallIdx = Math.floor(world.terrain.length / 2);
    if (mainStIdx === -1) mainStIdx = townHallIdx;
    if (resIdx === -1) {
      for (let t = 0; t < world.terrain.length; t++) {
        if (world.district[t] === 1) { resIdx = t; break; }
      }
    }
    if (indIdx === -1) {
      for (let t = 0; t < world.terrain.length; t++) {
        if (world.district[t] === 5) { indIdx = t; break; }
      }
    }
    if (railSidingIdx === -1) {
      for (let t = 0; t < world.terrain.length; t++) {
        if (world.terrain[t] === Terrain.Rail) { railSidingIdx = t; break; }
      }
    }
    if (farmIdx === -1) {
      for (let t = 0; t < world.terrain.length; t++) {
        if (world.terrain[t] === Terrain.Field) { farmIdx = t; break; }
      }
    }

    // Render each crop
    const cropList = [
      { name: "downtown-core", idx: townHallIdx },
      { name: "main-st-strip", idx: mainStIdx },
      { name: "residential-block", idx: resIdx },
      { name: "industrial-lobe", idx: indIdx },
      { name: "rail-siding", idx: railSidingIdx },
      { name: "farmstead", idx: farmIdx },
      { name: "river-reach-bridge", idx: bridgeIdx !== -1 ? bridgeIdx : townHallIdx },
      { name: "lake-shore", idx: lakeIdx !== -1 ? lakeIdx : townHallIdx },
      { name: "desert-ecotone", idx: desertEcotoneIdx !== -1 ? desertEcotoneIdx : townHallIdx },
      { name: "forest-edge", idx: forestIdx !== -1 ? forestIdx : townHallIdx },
    ];

    for (const crop of cropList) {
      const coord = getCoord(crop.idx);
      renderAndSave(`crop-seed-11-${crop.name}`, sim, 3, clampView(coord.x, coord.y));
    }

    // Town edges (N, S, E, W)
    // Find average center of downtown
    let sumX = 0, sumY = 0, count = 0;
    for (let t = 0; t < world.terrain.length; t++) {
      if (world.district[t] === 3) {
        const { x, y } = getCoord(t);
        sumX += x;
        sumY += y;
        count++;
      }
    }
    const tcx = count > 0 ? Math.floor(sumX / count) : 48;
    const tcy = count > 0 ? Math.floor(sumY / count) : 48;

    // Find boundary of citizen zone in each direction from tcx, tcy
    const findEdge = (dx, dy) => {
      let cx = tcx, cy = tcy;
      while (cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE) {
        const t = cy * SIZE + cx;
        if (world.terrain[t] !== Terrain.Citizen && world.district[t] === 0) {
          return { x: cx, y: cy };
        }
        cx += dx;
        cy += dy;
      }
      return { x: tcx + dx * 25, y: tcy + dy * 25 };
    };

    const edgeN = findEdge(0, -1);
    const edgeS = findEdge(0, 1);
    const edgeW = findEdge(-1, 0);
    const edgeE = findEdge(1, 0);

    renderAndSave("crop-seed-11-town-edge-n", sim, 3, clampView(edgeN.x, edgeN.y));
    renderAndSave("crop-seed-11-town-edge-s", sim, 3, clampView(edgeS.x, edgeS.y));
    renderAndSave("crop-seed-11-town-edge-w", sim, 3, clampView(edgeW.x, edgeW.y));
    renderAndSave("crop-seed-11-town-edge-e", sim, 3, clampView(edgeE.x, edgeE.y));

    // ---- 4. SEASONAL AND TIME OF DAY VARIANTS (Seed 11) --------------------
    const dtCoord = getCoord(townHallIdx !== -1 ? townHallIdx : 48);
    const dtView = clampView(dtCoord.x, dtCoord.y);

    // Overviews
    renderAndSave("map-seed-11-spring-day", sim, 1, null, "spring", "day");
    renderAndSave("map-seed-11-summer-day", sim, 1, null, "summer", "day");
    renderAndSave("map-seed-11-fall-day", sim, 1, null, "fall", "day");
    renderAndSave("map-seed-11-winter-day", sim, 1, null, "winter", "day");
    renderAndSave("map-seed-11-summer-dawn", sim, 1, null, "summer", "dawn");
    renderAndSave("map-seed-11-summer-dusk", sim, 1, null, "summer", "dusk");
    renderAndSave("map-seed-11-summer-night", sim, 1, null, "summer", "night");

    // Close-ups (Downtown Core)
    renderAndSave("crop-seed-11-downtown-spring-day", sim, 3, dtView, "spring", "day");
    renderAndSave("crop-seed-11-downtown-summer-day", sim, 3, dtView, "summer", "day");
    renderAndSave("crop-seed-11-downtown-fall-day", sim, 3, dtView, "fall", "day");
    renderAndSave("crop-seed-11-downtown-winter-day", sim, 3, dtView, "winter", "day");
    renderAndSave("crop-seed-11-downtown-summer-night", sim, 3, dtView, "summer", "night");
    renderAndSave("crop-seed-11-downtown-winter-night", sim, 3, dtView, "winter", "night");
  }
}

run().catch(console.error);
