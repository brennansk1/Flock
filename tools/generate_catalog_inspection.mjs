/**
 * Master Asset Catalog Inspector (§4.3)
 *
 * Individually renders both:
 *   1. Blank Background Studio View (dark studio slate, high-res crisp pixel art isolation)
 *   2. On-Map In-Game Context View (actual in-game town crop showing surrounding roads, lawns, and zoning)
 * for all 121 assets in MASTER_ASSET_CATALOG.
 */

import { deflateSync } from "node:zlib";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  generateWorld,
  createSim,
  loadBalance,
  renderTown,
  MASTER_ASSET_CATALOG,
  Lot,
  Terrain,
  Biome,
  Districts,
  CULT_ICONS_16,
  drawCultAsset16,
  drawRockOutcrop,
  drawBrushPocket,
  drawCountryTree,
  drawHouse,
  drawTrailerHome,
  drawLotBuilding,
  drawVerge,
  hexToRgb,
  shade,
} from "../packages/sim/dist/index.js";

const REPORT_DIR = "reports";
const CATALOG_SHOTS_DIR = join(REPORT_DIR, "assets", "catalog");
mkdirSync(CATALOG_SHOTS_DIR, { recursive: true });

// --- Zero-dependency PNG encoder ---
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

function writePNG(path, width, height, rgbaBuffer) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(height * rowSize);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0; // filter type 0: None
    rgbaBuffer.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

// Nearest-neighbor crop and upscale
function cropRgba(srcRgba, srcW, srcH, cx, cy, cw, ch, scale = 6) {
  const dstW = Math.round(cw * scale);
  const dstH = Math.round(ch * scale);
  const dstRgba = Buffer.alloc(dstW * dstH * 4);

  for (let dy = 0; dy < dstH; dy++) {
    const sy = cy + Math.floor(dy / scale);
    if (sy < 0 || sy >= srcH) continue;
    for (let dx = 0; dx < dstW; dx++) {
      const sx = cx + Math.floor(dx / scale);
      if (sx < 0 || sx >= srcW) continue;
      const srcIdx = (sy * srcW + sx) * 4;
      const dstIdx = (dy * dstW + dx) * 4;
      dstRgba[dstIdx] = srcRgba[srcIdx];
      dstRgba[dstIdx + 1] = srcRgba[srcIdx + 1];
      dstRgba[dstIdx + 2] = srcRgba[srcIdx + 2];
      dstRgba[dstIdx + 3] = srcRgba[srcIdx + 3];
    }
  }
  return { width: dstW, height: dstH, rgba: dstRgba };
}

// ---------------------------------------------------------------- Setup Benchmark Simulated Worlds
console.log(`[CATALOG INSPECTOR] Initializing rich simulation worlds...`);
const bal = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));

// Primary benchmark world: rich town with downtown, suburbs, farms, rail, and lakes
const mainWorld = generateWorld(11, 64, 64, { townType: "farm" });
const desertWorld = generateWorld(42, 64, 64, { townType: "desert" });
const oceanWorld = generateWorld(21, 64, 64, { townType: "oceanside" });

// Setup active match with all 4 archetypes, units, and structures
const mainSim = createSim({
  seed: 11,
  balance: bal,
  world: mainWorld,
  spawns: [
    { id: 1, archetype: "final_dawn" },
    { id: 2, archetype: "radiant_path" },
    { id: 3, archetype: "prosperity_circle" },
    { id: 4, archetype: "visitors_fellowship" },
  ],
});

// Seed active cult buildings & territory for inspection
const cultStructures = [
  { id: 1, player: 1, type: "compound", tile: 24 * 64 + 16, key: "compound_dawn" },
  { id: 2, player: 1, type: "watchtower", tile: 22 * 64 + 14, key: "watchtower" },
  { id: 3, player: 2, type: "compound", tile: 36 * 64 + 40, key: "compound_radiant" },
  { id: 4, player: 2, type: "supplement_lab", tile: 38 * 64 + 42, key: "supplement_lab" },
  { id: 5, player: 3, type: "compound", tile: 26 * 64 + 32, key: "compound_circle" },
  { id: 6, player: 3, type: "collection_plate", tile: 28 * 64 + 34, key: "collection_plate" },
  { id: 7, player: 4, type: "compound", tile: 44 * 64 + 18, key: "compound_visitors" },
  { id: 8, player: 4, type: "satellite", tile: 46 * 64 + 16, key: "satellite" },
  { id: 9, player: 4, type: "broadcast_tower", tile: 42 * 64 + 22, key: "broadcast_tower" },
];

for (const cs of cultStructures) {
  mainSim.buildings.push({
    id: cs.id,
    player: cs.player,
    type: cs.type,
    tile: cs.tile,
    buildTicksLeft: 0,
    disabledTicks: 0,
  });
  // Claim 3x3 territory around building
  const bx = cs.tile % 64;
  const by = Math.floor(cs.tile / 64);
  for (let dy = -1; dy <= 2; dy++) {
    for (let dx = -1; dx <= 2; dx++) {
      const tx = bx + dx;
      const ty = by + dy;
      if (tx >= 0 && tx < 64 && ty >= 0 && ty < 64) {
        mainWorld.owner[ty * 64 + tx] = cs.player;
      }
    }
  }
}

// Add sample living entities
mainSim.vans.push(
  { id: 1, player: 1, tile: 20 * 64 + 30, path: [20 * 64 + 30], idx: 0, moveProgress: 0 },
  { id: 2, player: 2, tile: 20 * 64 + 31, path: [20 * 64 + 31], idx: 0, moveProgress: 0 },
  { id: 3, player: 3, tile: 20 * 64 + 32, path: [20 * 64 + 32], idx: 0, moveProgress: 0 },
  { id: 4, player: 4, tile: 20 * 64 + 33, path: [20 * 64 + 33], idx: 0, moveProgress: 0 },
);
mainSim.agents.push(
  { id: 1, player: 1, tile: 21 * 64 + 30, targetDistrict: 3, victim: 2, mission: "deprogram", phase: "travel", travelTicks: 10, channelTicks: 0 },
  { id: 2, player: 2, tile: 21 * 64 + 31, targetDistrict: 3, victim: 1, mission: "scandal", phase: "channel", travelTicks: 0, channelTicks: 10 },
  { id: 3, player: 3, tile: 21 * 64 + 32, targetDistrict: 3, victim: 1, mission: "deprogram", phase: "travel", travelTicks: 10, channelTicks: 0 },
  { id: 4, player: 4, tile: 21 * 64 + 33, targetDistrict: 3, victim: 1, mission: "scandal", phase: "channel", travelTicks: 0, channelTicks: 10 },
);

// Render full frames
const mainFrame = renderTown(mainSim, { frameTick: 120, season: "summer" });
const mainRgba = Buffer.from(mainFrame.data.buffer, mainFrame.data.byteOffset, mainFrame.data.byteLength);

const desertSim = createSim({ seed: 42, balance: bal, world: desertWorld, spawns: [] });
const desertFrame = renderTown(desertSim, { frameTick: 120, season: "summer" });
const desertRgba = Buffer.from(desertFrame.data.buffer, desertFrame.data.byteOffset, desertFrame.data.byteLength);

const oceanSim = createSim({ seed: 21, balance: bal, world: oceanWorld, spawns: [] });
const oceanFrame = renderTown(oceanSim, { frameTick: 120, season: "summer" });
const oceanRgba = Buffer.from(oceanFrame.data.buffer, oceanFrame.data.byteOffset, oceanFrame.data.byteLength);

// Helper to find real on-map tiles
function findTileMatching(world, predicate) {
  for (let t = 0; t < world.terrain.length; t++) {
    if (predicate(world, t)) return t;
  }
  return -1;
}

// Blank Background Studio Renderer
function createStudioRender(setupFn, scale = 10, painter = null, isMultiTile = false) {
  const sWorld = generateWorld(99, 16, 16);
  // Clear to neutral studio void
  for (let i = 0; i < sWorld.terrain.length; i++) {
    sWorld.terrain[i] = Terrain.Grass;
    sWorld.lot[i] = 0;
    sWorld.pop[i] = 0;
    sWorld.owner[i] = 0;
  }
  const sSim = createSim({ seed: 99, balance: bal, world: sWorld, spawns: [
    { id: 1, archetype: "final_dawn" },
    { id: 2, archetype: "radiant_path" },
    { id: 3, archetype: "prosperity_circle" },
    { id: 4, archetype: "visitors_fellowship" },
  ] });

  const centerTile = 8 * 16 + 8;
  setupFn(sWorld, sSim, centerTile);

  const frame = renderTown(sSim, { view: { x: 7, y: 7, w: 3, h: 3 }, lod: scale, frameTick: 120 });
  const rawData = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);

  // Mask outer perimeter into clean studio slate (#13161f)
  const W = frame.width;
  const H = frame.height;
  const out = Buffer.alloc(W * H * 4);
  const slate = [19, 22, 31];

  const xMin = isMultiTile ? Math.floor(W * 0.32) : Math.floor(W * 0.28);
  const xMax = isMultiTile ? Math.ceil(W * 0.98) : Math.ceil(W * 0.72);
  const yMin = isMultiTile ? 0 : Math.floor(H * 0.28);
  const yMax = isMultiTile ? H : Math.ceil(H * 0.72);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      if (x >= xMin && x < xMax && y >= yMin && y < yMax) {
        out[idx] = rawData[idx];
        out[idx + 1] = rawData[idx + 1];
        out[idx + 2] = rawData[idx + 2];
        out[idx + 3] = 255;
      } else {
        out[idx] = slate[0];
        out[idx + 1] = slate[1];
        out[idx + 2] = slate[2];
        out[idx + 3] = 255;
      }
    }
  }

  // If a post painter is provided, draw custom features directly on the logical 24x24 grid (view is 3x3 tiles, each 8px)
  if (painter) {
    const putLogical = (lx, ly, col) => {
      // lx, ly in [0..23], viewport is 3x3 tiles centered on (8,8) which is [8..15, 8..15]
      if (lx < 0 || ly < 0 || lx >= 24 || ly >= 24) return;
      for (let dy = 0; dy < scale; dy++) {
        const py = ly * scale + dy;
        for (let dx = 0; dx < scale; dx++) {
          const px = lx * scale + dx;
          const idx = (py * W + px) * 4;
          out[idx] = col[0];
          out[idx + 1] = col[1];
          out[idx + 2] = col[2];
          out[idx + 3] = 255;
        }
      }
    };
    painter(putLogical, scale);
  }

  return { width: W, height: H, rgba: out };
}

// ---------------------------------------------------------------- Catalog Inspection Matrix
export async function generateAllCatalogImages() {
  console.log(`[CATALOG INSPECTOR] Generating inspection images for all 121 assets...`);
  const catalogResults = [];

  for (let i = 0; i < MASTER_ASSET_CATALOG.length; i++) {
    const asset = MASTER_ASSET_CATALOG[i];
    const studioFilename = `${asset.id}_studio.png`;
    const mapFilename = `${asset.id}_map.png`;
    const studioPath = join(CATALOG_SHOTS_DIR, studioFilename);
    const mapPath = join(CATALOG_SHOTS_DIR, mapFilename);

    let mapTile = -1;
    let targetWorld = mainWorld;
    let targetRgba = mainRgba;

    // Define setup for studio & locate on map based on category and asset ID
    let studioSetup = (w, sim, t) => {
      w.terrain[t] = Terrain.Citizen;
      w.pop[t] = 5;
    };
    let studioPainter = null;
    let isMultiTile = false;

    switch (asset.id) {
      // ---- Category A: Terrain (ENV-01 to ENV-20) ----
      case "ENV-01": // Temperate Grass
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Grass);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Grass; };
        break;
      case "ENV-02": // Rock Outcrops
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Grass && (t % 17 === 0));
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Grass; };
        studioPainter = (put) => drawRockOutcrop(8, 8, put, 0); // Shore boulders (grey)
        break;
      case "ENV-03": // Brush Pockets
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Grass && (t % 5 === 0));
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Grass; };
        studioPainter = (put) => drawBrushPocket(8, 8, put, 0); // Berry brambles
        break;
      case "ENV-04": // Country Trees
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Grass && (t % 37 === 0));
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Grass; };
        studioPainter = (put) => drawCountryTree(8, 8, put, 0, "summer"); // Standalone Country Tree w/ trunk & shadow
        break;
      case "ENV-05": // Standing Woods
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Woods && w.terrain[t - 1] === Terrain.Woods && w.terrain[t + 1] === Terrain.Woods);
        studioSetup = (w, sim, t) => {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              w.terrain[t + dy * 16 + dx] = Terrain.Woods;
            }
          }
        };
        break;
      case "ENV-06": // River Reach
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Lake && w.terrain[t - 64] === Terrain.Lake && w.terrain[t + 64] === Terrain.Lake);
        studioSetup = (w, sim, t) => {
          w.terrain[t - 16] = Terrain.Lake;
          w.terrain[t] = Terrain.Lake;
          w.terrain[t + 16] = Terrain.Lake;
        };
        break;
      case "ENV-07": // Creek Tributaries
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Lake && (w.terrain[t - 1] === Terrain.Grass || w.terrain[t + 1] === Terrain.Grass));
        studioSetup = (w, sim, t) => {
          w.terrain[t - 16] = Terrain.Lake;
          w.terrain[t] = Terrain.Lake;
          w.terrain[t + 16] = Terrain.Lake;
        };
        studioPainter = (put) => {
          put(8 + 1, 8 + 3, [142, 196, 92]);
          put(8 + 2, 8 + 3, [142, 196, 92]);
          put(8 + 1, 8 + 4, [92, 140, 58]);
        };
        break;
      case "ENV-08": // Lake Basin
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Lake);
        studioSetup = (w, sim, t) => {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              w.terrain[t + dy * 16 + dx] = Terrain.Lake;
            }
          }
        };
        break;
      case "ENV-09": // Desert Dunes
        targetWorld = desertWorld;
        targetRgba = desertRgba;
        mapTile = findTileMatching(desertWorld, (w, t) => w.biome[t] === 1 && w.terrain[t] === Terrain.Grass);
        studioSetup = (w, sim, t) => {
          w.biome[t] = 1;
          w.terrain[t] = Terrain.Grass;
        };
        break;
      case "ENV-10": // Saguaro Stands
        targetWorld = desertWorld;
        targetRgba = desertRgba;
        mapTile = findTileMatching(desertWorld, (w, t) => w.biome[t] === 1 && w.terrain[t] === Terrain.Woods);
        studioSetup = (w, sim, t) => {
          w.biome[t] = 1;
          w.terrain[t] = Terrain.Woods;
        };
        break;
      case "ENV-11": // Desert Dry Wash
        targetWorld = desertWorld;
        targetRgba = desertRgba;
        mapTile = findTileMatching(desertWorld, (w, t) => w.biome[t] === 1 && w.terrain[t] === Terrain.Dirt);
        studioSetup = (w, sim, t) => {
          w.biome[t] = 1;
          w.terrain[t] = Terrain.Dirt;
        };
        break;
      case "ENV-12": // Desert Oasis
        targetWorld = desertWorld;
        targetRgba = desertRgba;
        mapTile = findTileMatching(desertWorld, (w, t) => w.biome[t] === 1 && w.terrain[t] === Terrain.Lake);
        studioSetup = (w, sim, t) => {
          w.biome[t] = 1;
          w.terrain[t] = Terrain.Lake;
          w.terrain[t - 1] = Terrain.Grass;
        };
        break;
      case "ENV-13": // Forest Floor
        mapTile = findTileMatching(mainWorld, (w, t) => w.biome[t] === 2 && w.terrain[t] === Terrain.Grass);
        studioSetup = (w, sim, t) => {
          w.biome[t] = 2; // Forest
          w.terrain[t] = Terrain.Grass;
        };
        studioPainter = (put) => {
          put(8 + 2, 8 + 4, [210, 59, 59]);
          put(8 + 2, 8 + 5, [247, 245, 240]);
          put(8 + 4, 8 + 5, [110, 80, 48]);
          put(8 + 5, 8 + 5, [86, 120, 56]);
          put(8 + 6, 8 + 5, [110, 80, 48]);
        };
        break;
      case "ENV-14": // Autumn Foliage
        mapTile = findTileMatching(mainWorld, (w, t) => w.biome[t] === 3);
        studioSetup = (w, sim, t) => {
          w.biome[t] = 3; // Autumn
          w.terrain[t] = Terrain.Woods;
          w.terrain[t - 1] = Terrain.Woods;
          w.terrain[t + 1] = Terrain.Woods;
        };
        break;
      case "ENV-15": // Riparian Willows
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Grass && (w.terrain[t + 1] === Terrain.Lake || w.terrain[t - 1] === Terrain.Lake));
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Grass;
          w.terrain[t + 1] = Terrain.Lake;
        };
        studioPainter = (put) => {
          put(8 + 4, 8 + 5, [111, 122, 82]);
          put(8 + 4, 8 + 4, [106, 77, 49]);
          put(8 + 3, 8 + 2, [142, 196, 92]);
          put(8 + 4, 8 + 2, [142, 196, 92]);
          put(8 + 2, 8 + 3, [142, 196, 92]);
          put(8 + 5, 8 + 3, [142, 196, 92]);
          put(8 + 2, 8 + 4, [92, 140, 58]);
          put(8 + 5, 8 + 4, [92, 140, 58]);
        };
        break;
      case "ENV-16": // Utility Poles
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Grass && w.terrain[t + 64] === Terrain.Road);
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Grass;
          w.terrain[t + 16] = Terrain.Road;
        };
        studioPainter = (put) => {
          for (let py = 1; py <= 6; py++) put(8 + 3, 8 + py, [106, 77, 49]);
          put(8 + 2, 8 + 1, [106, 77, 49]);
          put(8 + 4, 8 + 1, [106, 77, 49]);
          put(8 + 1, 8 + 1, [240, 240, 245]);
          put(8 + 5, 8 + 1, [240, 240, 245]);
          for (let px = 0; px < 8; px++) put(8 + px, 8, [180, 185, 190]);
        };
        break;
      case "ENV-17": // Hedgerows
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Field);
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Field;
          w.terrain[t - 1] = Terrain.Grass;
        };
        studioPainter = (put) => {
          for (let py = 0; py < 8; py++) {
            put(8, 8 + py, [58, 82, 40]);
            put(8 + 1, 8 + py, [74, 110, 48]);
          }
        };
        break;
      case "ENV-18": // Shelterbelts
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Field && w.terrain[t - 64] === Terrain.Woods);
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Field;
        };
        studioPainter = (put) => {
          drawCountryTree(8, 8, put, 1, "summer");
        };
        break;
      case "ENV-19": // Stock Tank Pond
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Pasture);
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Pasture;
        };
        studioPainter = (put) => {
          put(8 + 3, 8 + 3, [80, 130, 170]);
          put(8 + 4, 8 + 3, [80, 130, 170]);
          put(8 + 3, 8 + 4, [80, 130, 170]);
          put(8 + 4, 8 + 4, [80, 130, 170]);
          put(8 + 2, 8 + 3, [160, 170, 175]);
          put(8 + 5, 8 + 4, [160, 170, 175]);
        };
        break;
      case "ENV-20": // Ecotones
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Grass && w.biome[t] === 0);
        studioSetup = (w, sim, t) => {
          w.terrain[t - 1] = Terrain.Grass;
          w.terrain[t] = Terrain.Grass;
          w.terrain[t + 1] = Terrain.Grass;
        };
        studioPainter = (put) => {
          for (let py = 0; py < 8; py++) {
            put(8 + 1, 8 + py, [212, 196, 142]);
            put(8 + 3, 8 + py, [170, 165, 105]);
            put(8 + 5, 8 + py, [124, 150, 78]);
          }
        };
        break;

      // ---- Category B: Infrastructure (ST-01 to ST-18) ----
      case "ST-01": // 4-Lane Highway
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Road && (w.terrain[t + 64] === Terrain.Road || w.terrain[t - 64] === Terrain.Road));
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Road;
          w.terrain[t + 16] = Terrain.Road;
        };
        break;
      case "ST-02": // 2-Lane Street
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Road);
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Road;
          w.terrain[t - 1] = Terrain.Citizen;
          w.terrain[t + 1] = Terrain.Citizen;
        };
        break;
      case "ST-03": // Cul-de-Sac Bulb
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Road && w.terrain[t + 1] !== Terrain.Road && w.terrain[t - 1] !== Terrain.Road);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Road; };
        studioPainter = (put) => {
          for (let py = 1; py <= 6; py++) for (let px = 1; px <= 6; px++) put(8 + px, 8 + py, [70, 70, 75]);
          put(8 + 3, 8 + 3, [85, 85, 90]);
          put(8 + 4, 8 + 3, [85, 85, 90]);
        };
        break;
      case "ST-04": // Dirt/Gravel Lane
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Dirt);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Dirt; };
        break;
      case "ST-05": // Road Bridge
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Road && (w.terrain[t - 1] === Terrain.Lake || w.terrain[t + 1] === Terrain.Lake));
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Road;
          w.terrain[t - 1] = Terrain.Lake;
          w.terrain[t + 1] = Terrain.Lake;
        };
        break;
      case "ST-06": // Main St Crosswalks
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Road && w.district[t] === Districts.Downtown);
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Road;
          w.terrain[t - 16] = Terrain.Road;
          w.district[t] = Districts.Downtown;
        };
        studioPainter = (put) => {
          for (let px = 1; px <= 6; px += 2) {
            put(8 + px, 8 + 3, [240, 240, 240]);
            put(8 + px, 8 + 4, [240, 240, 240]);
          }
        };
        break;
      case "ST-07": // Traffic Lights
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Road && w.district[t] === Districts.Downtown);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Road; };
        studioPainter = (put) => {
          put(8 + 1, 8 + 1, [20, 20, 20]);
          put(8 + 1, 8 + 2, [220, 40, 40]);
          put(8 + 1, 8 + 3, [40, 200, 60]);
        };
        break;
      case "ST-08": // Stop Signs
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Road);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Road; };
        studioPainter = (put) => {
          put(8 + 1, 8 + 1, [210, 35, 35]);
          put(8 + 2, 8 + 1, [210, 35, 35]);
          put(8 + 1, 8 + 2, [210, 35, 35]);
          put(8 + 2, 8 + 2, [210, 35, 35]);
          put(8 + 1, 8 + 3, [160, 160, 165]);
          put(8 + 1, 8 + 4, [160, 160, 165]);
        };
        break;
      case "ST-09": // Streetlights
        mapTile = findTileMatching(mainWorld, (w, t) => w.district[t] === Districts.Downtown && w.terrain[t] === Terrain.Citizen);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        studioPainter = (put) => {
          put(8 + 2, 8 + 1, [255, 235, 120]);
          put(8 + 2, 8 + 2, [50, 50, 55]);
          put(8 + 2, 8 + 3, [50, 50, 55]);
          put(8 + 2, 8 + 4, [50, 50, 55]);
          put(8 + 3, 8 + 4, [111, 122, 82]);
        };
        break;
      case "ST-10": // Railroad Track
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Rail);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Rail; };
        break;
      case "ST-11": // Rail Trestle
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Rail && (w.terrain[t - 1] === Terrain.Lake || w.terrain[t + 1] === Terrain.Lake));
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Rail;
          w.terrain[t - 1] = Terrain.Lake;
          w.terrain[t + 1] = Terrain.Lake;
        };
        break;
      case "ST-12": // Crossbuck Crossing
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Rail && (w.terrain[t + 64] === Terrain.Road || w.terrain[t - 64] === Terrain.Road));
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Rail; };
        studioPainter = (put) => {
          put(8 + 2, 8 + 1, [240, 240, 240]);
          put(8 + 4, 8 + 1, [240, 240, 240]);
          put(8 + 3, 8 + 2, [240, 240, 240]);
          put(8 + 2, 8 + 3, [240, 240, 240]);
          put(8 + 4, 8 + 3, [240, 240, 240]);
          put(8 + 2, 8 + 2, [210, 40, 40]);
          put(8 + 4, 8 + 2, [210, 40, 40]);
          put(8 + 3, 8 + 4, [150, 150, 155]);
          put(8 + 3, 8 + 5, [150, 150, 155]);
        };
        break;
      case "ST-13": // Rail Siding Spur
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Rail && w.lot[t + 1] === Lot.GrainElevator);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Rail; };
        break;
      case "ST-14": // Parked Boxcars
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Rail);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Rail; };
        studioPainter = (put) => {
          for (let px = 1; px <= 6; px++) {
            put(8 + px, 8 + 3, [160, 60, 45]);
            put(8 + px, 8 + 4, [130, 45, 35]);
          }
          put(8 + 2, 8 + 5, [30, 30, 30]);
          put(8 + 5, 8 + 5, [30, 30, 30]);
        };
        break;
      case "ST-15": // Highway Billboards
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Grass && w.terrain[t + 64] === Terrain.Road);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Grass; };
        studioPainter = (put) => {
          for (let py = 1; py <= 3; py++) for (let px = 1; px <= 6; px++) put(8 + px, 8 + py, [240, 240, 240]);
          put(8 + 2, 8 + 2, [40, 90, 190]);
          put(8 + 3, 8 + 2, [40, 90, 190]);
          put(8 + 4, 8 + 2, [210, 40, 40]);
          put(8 + 2, 8 + 4, [106, 77, 49]);
          put(8 + 5, 8 + 4, [106, 77, 49]);
        };
        break;
      case "ST-16": // Welcome Signs
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Grass && w.terrain[t + 1] === Terrain.Road);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Grass; };
        studioPainter = (put) => {
          for (let py = 2; py <= 4; py++) for (let px = 1; px <= 6; px++) put(8 + px, 8 + py, [90, 65, 45]);
          for (let px = 2; px <= 5; px++) put(8 + px, 8 + 3, [245, 240, 225]);
          put(8 + 2, 8 + 5, [75, 50, 35]);
          put(8 + 5, 8 + 5, [75, 50, 35]);
        };
        break;
      case "ST-17": // Concrete Weirs
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Dam);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.Dam; w.terrain[t] = Terrain.Citizen; w.pop[t] = 5; };
        break;
      case "ST-18": // Property Stakes
        mapTile = findTileMatching(mainWorld, (w, t) => w.property[t] !== 0);
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Grass;
          w.property[t] = 1;
        };
        studioPainter = (put) => {
          put(8 + 1, 8 + 1, [255, 60, 60]);
          put(8 + 1, 8 + 2, [106, 77, 49]);
          put(8 + 6, 8 + 1, [255, 60, 60]);
          put(8 + 6, 8 + 2, [106, 77, 49]);
          for (let px = 2; px <= 5; px += 2) put(8 + px, 8 + 1, [255, 60, 60]);
        };
        break;

      // ---- Category C: Residential (RES-01 to RES-11) ----
      case "RES-01": // Ranch / Long
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Citizen && w.pop[t] >= 3 && w.lot[t] === 0);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Suburbs; w.pop[t] = 5; };
        studioPainter = (put) => drawHouse(8, 8, Districts.Suburbs, 0, put, null, 120, 0, false);
        break;
      case "RES-02": // Two-Story Colonial
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Citizen && w.pop[t] >= 3 && w.lot[t] === 0);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Suburbs; w.pop[t] = 5; };
        studioPainter = (put) => drawHouse(8, 8, Districts.Suburbs, 1, put, null, 120, 0, false);
        break;
      case "RES-03": // L-Plan
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Citizen && w.pop[t] >= 3 && w.lot[t] === 0);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Suburbs; w.pop[t] = 5; };
        studioPainter = (put) => drawHouse(8, 8, Districts.Suburbs, 2, put, null, 120, 0, false);
        break;
      case "RES-04": // Bungalow
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Citizen && w.pop[t] >= 3 && w.lot[t] === 0);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Suburbs; w.pop[t] = 5; };
        studioPainter = (put) => drawHouse(8, 8, Districts.Suburbs, 3, put, null, 120, 0, false);
        break;
      case "RES-05": // Trailer Home
        mapTile = findTileMatching(mainWorld, (w, t) => w.district[t] === Districts.Trailer);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Trailer; w.pop[t] = 3; };
        studioPainter = (put) => drawTrailerHome(8, 8, 10, put);
        break;
      case "RES-06": // Trailer Court
        mapTile = findTileMatching(mainWorld, (w, t) => w.district[t] === Districts.Trailer);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Trailer; w.pop[t] = 3; };
        studioPainter = (put) => {
          drawTrailerHome(8, 8, 10, put);
          put(8 + 1, 8 + 2, [35, 35, 35]);
          put(8 + 2, 8 + 2, [35, 35, 35]);
          put(8 + 6, 8 + 6, [140, 90, 60]);
        };
        break;
      case "RES-07": // Detached Garage
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Citizen && w.pop[t] >= 3 && w.lot[t] === 0);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Suburbs; w.pop[t] = 5; };
        studioPainter = (put) => {
          for (let py = 2; py <= 5; py++) for (let px = 2; px <= 6; px++) put(8 + px, 8 + py, [138, 131, 120]);
          put(8 + 3, 8 + 5, [255, 255, 255]);
          put(8 + 4, 8 + 5, [255, 255, 255]);
          put(8 + 5, 8 + 5, [255, 255, 255]);
          put(8 + 3, 8 + 4, [240, 240, 240]);
          put(8 + 4, 8 + 4, [240, 240, 240]);
          put(8 + 5, 8 + 4, [240, 240, 240]);
        };
        break;
      case "RES-08": // Backyards
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Citizen && w.pop[t] > 0 && w.pop[t] < 3);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Suburbs; w.pop[t] = 2; };
        studioPainter = (put) => {
          for (let gx = 2; gx <= 5; gx++) {
            put(8 + gx, 8 + 2, [90, 115, 64]);
            put(8 + gx, 8 + 4, [140, 100, 50]);
          }
          for (let i = 0; i < 8; i += 2) put(8 + i, 8, [138, 110, 77]);
        };
        break;
      case "RES-09": // Above-Ground Pool
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Citizen && w.pop[t] > 0 && w.pop[t] < 3);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Suburbs; w.pop[t] = 2; };
        studioPainter = (put) => {
          put(8 + 3, 8 + 3, [127, 196, 232]);
          put(8 + 4, 8 + 3, [159, 212, 240]);
          put(8 + 3, 8 + 4, [159, 212, 240]);
          put(8 + 4, 8 + 4, [127, 196, 232]);
          put(8 + 2, 8 + 3, [216, 212, 200]);
          put(8 + 5, 8 + 4, [216, 212, 200]);
        };
        break;
      case "RES-10": // Front Curbside
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Citizen && w.pop[t] >= 3 && w.lot[t] === 0);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Suburbs; w.pop[t] = 5; };
        studioPainter = (put) => {
          put(8 + 2, 8 + 6, [106, 77, 49]);
          put(8 + 2, 8 + 5, [140, 146, 150]);
          put(8 + 6, 8 + 6, [210, 59, 59]);
        };
        break;
      case "RES-11": // Chimney Smoke
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Citizen && w.pop[t] >= 3 && w.lot[t] === 0);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Suburbs; w.pop[t] = 5; };
        studioPainter = (put) => {
          drawHouse(8, 8, Districts.Suburbs, 1, put, null, 120, 0, false);
          put(8 + 2, 8 - 1, [201, 196, 188]);
          put(8 + 3, 8 - 2, [220, 216, 210]);
          put(8 + 4, 8 - 3, [240, 238, 235]);
        };
        break;

      // ---- Category D: Commercial (COM-01 to COM-14) ----
      case "COM-01":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Shop);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.Shop; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        break;
      case "COM-02":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Shop);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.Shop; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        studioPainter = (put) => {
          for (let px = 1; px <= 6; px++) put(8 + px, 8 + 3, px % 2 === 0 ? [184, 50, 50] : [240, 240, 240]);
        };
        break;
      case "COM-03":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Diner);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.Diner; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        break;
      case "COM-04":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.GasStation);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.GasStation; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        break;
      case "COM-05":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Shop);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.Shop; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        studioPainter = (put) => {
          put(8 + 2, 8 + 4, [100, 180, 240]);
          put(8 + 3, 8 + 4, [100, 180, 240]);
          put(8 + 4, 8 + 4, [100, 180, 240]);
          put(8 + 5, 8 + 4, [100, 180, 240]);
        };
        break;
      case "COM-06":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Cinema);
        isMultiTile = true;
        studioSetup = (w, sim, t) => {
          for (const r of [7, 8]) for (const c of [8, 9]) { w.lot[r * 16 + c] = Lot.Cinema; w.terrain[r * 16 + c] = Terrain.Citizen; w.district[r * 16 + c] = Districts.Commercial; w.pop[r * 16 + c] = 5; }
          for (const c of [8, 9]) { w.lot[9 * 16 + c] = Lot.Parking; w.terrain[9 * 16 + c] = Terrain.Citizen; }
        };
        break;
      case "COM-07":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Bank);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.Bank; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        break;
      case "COM-08":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.PostOffice);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.PostOffice; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        break;
      case "COM-09":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Office);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.Office; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        break;
      case "COM-10":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Motel);
        isMultiTile = true;
        studioSetup = (w, sim, t) => {
          for (const r of [7, 8]) for (const c of [8, 9]) { w.lot[r * 16 + c] = Lot.Motel; w.terrain[r * 16 + c] = Terrain.Citizen; w.district[r * 16 + c] = Districts.Commercial; w.pop[r * 16 + c] = 5; }
          for (const c of [8, 9]) { w.lot[9 * 16 + c] = Lot.Parking; w.terrain[9 * 16 + c] = Terrain.Citizen; }
        };
        break;
      case "COM-11":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Motel);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.Motel; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        studioPainter = (put) => {
          put(8 + 4, 8 + 3, [127, 196, 232]);
          put(8 + 5, 8 + 3, [159, 212, 240]);
          put(8 + 4, 8 + 4, [159, 212, 240]);
          put(8 + 5, 8 + 4, [127, 196, 232]);
        };
        break;
      case "COM-12":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Factory);
        isMultiTile = true;
        studioSetup = (w, sim, t) => {
          for (const r of [7, 8]) for (const c of [8, 9]) { w.lot[r * 16 + c] = Lot.Factory; w.terrain[r * 16 + c] = Terrain.Citizen; w.district[r * 16 + c] = Districts.Industrial; w.pop[r * 16 + c] = 5; }
          for (const c of [8, 9]) { w.lot[9 * 16 + c] = Lot.Parking; w.terrain[9 * 16 + c] = Terrain.Citizen; }
        };
        break;
      case "COM-13":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Warehouse);
        isMultiTile = true;
        studioSetup = (w, sim, t) => {
          for (const r of [7, 8]) for (const c of [8, 9]) { w.lot[r * 16 + c] = Lot.Warehouse; w.terrain[r * 16 + c] = Terrain.Citizen; w.district[r * 16 + c] = Districts.Industrial; w.pop[r * 16 + c] = 5; }
          for (const c of [8, 9]) { w.lot[9 * 16 + c] = Lot.Parking; w.terrain[9 * 16 + c] = Terrain.Citizen; }
        };
        break;
      case "COM-14":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Depot);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.Depot; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        break;

      // ---- Category E: Civic (CIV-01 to CIV-12) ----
      case "CIV-01":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.TownHall);
        isMultiTile = true;
        studioSetup = (w, sim, t) => {
          for (const r of [7, 8]) for (const c of [8, 9]) { w.lot[r * 16 + c] = Lot.TownHall; w.terrain[r * 16 + c] = Terrain.Citizen; w.district[r * 16 + c] = Districts.Downtown; w.pop[r * 16 + c] = 5; }
          for (const c of [8, 9]) { w.lot[9 * 16 + c] = Lot.Parking; w.terrain[9 * 16 + c] = Terrain.Citizen; }
        };
        break;
      case "CIV-02":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Sheriff);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.Sheriff; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        break;
      case "CIV-03":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.HighSchool);
        isMultiTile = true;
        studioSetup = (w, sim, t) => {
          for (const r of [7, 8]) for (const c of [8, 9]) { w.lot[r * 16 + c] = Lot.HighSchool; w.terrain[r * 16 + c] = Terrain.Citizen; w.district[r * 16 + c] = Districts.Suburbs; w.pop[r * 16 + c] = 5; }
          for (const c of [8, 9]) { w.lot[9 * 16 + c] = Lot.Parking; w.terrain[9 * 16 + c] = Terrain.Citizen; }
        };
        break;
      case "CIV-04":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.BallField);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.BallField; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        break;
      case "CIV-05":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.School);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.School; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        studioPainter = (put) => {
          put(8 + 3, 8 + 6, [232, 184, 32]);
          put(8 + 4, 8 + 6, [232, 184, 32]);
          put(8 + 5, 8 + 6, [232, 184, 32]);
          put(8 + 6, 8 + 6, [232, 184, 32]);
        };
        break;
      case "CIV-06":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.School);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.School; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        break;
      case "CIV-07":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Playground);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.Playground; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        break;
      case "CIV-08":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Supermarket);
        isMultiTile = true;
        studioSetup = (w, sim, t) => {
          for (const r of [7, 8]) for (const c of [8, 9]) { w.lot[r * 16 + c] = Lot.Supermarket; w.terrain[r * 16 + c] = Terrain.Citizen; w.district[r * 16 + c] = Districts.Commercial; w.pop[r * 16 + c] = 5; }
          for (const c of [8, 9]) { w.lot[9 * 16 + c] = Lot.Parking; w.terrain[9 * 16 + c] = Terrain.Citizen; }
        };
        break;
      case "CIV-09":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Church);
        isMultiTile = true;
        studioSetup = (w, sim, t) => {
          for (const r of [7, 8]) for (const c of [8, 9]) { w.lot[r * 16 + c] = Lot.Church; w.terrain[r * 16 + c] = Terrain.Citizen; w.district[r * 16 + c] = Districts.OldTown; w.pop[r * 16 + c] = 5; }
          for (const c of [8, 9]) { w.lot[9 * 16 + c] = Lot.Parking; w.terrain[9 * 16 + c] = Terrain.Citizen; }
        };
        break;
      case "CIV-10":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Cemetery);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.Cemetery; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        break;
      case "CIV-11":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.FireStation);
        isMultiTile = true;
        studioSetup = (w, sim, t) => {
          for (const r of [7, 8]) for (const c of [8, 9]) { w.lot[r * 16 + c] = Lot.FireStation; w.terrain[r * 16 + c] = Terrain.Citizen; w.district[r * 16 + c] = Districts.Downtown; w.pop[r * 16 + c] = 5; }
          for (const c of [8, 9]) { w.lot[9 * 16 + c] = Lot.Parking; w.terrain[9 * 16 + c] = Terrain.Citizen; }
        };
        break;
      case "CIV-12":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.WaterTower);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.WaterTower; w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Downtown; w.pop[t] = 5; };
        break;

      // ---- Category F: Agriculture (AGR-01 to AGR-10) ----
      case "AGR-01":
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Field);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Field; };
        studioPainter = (put) => {
          for (let py = 1; py <= 6; py++) for (let px = 1; px <= 6; px += 2) put(8 + px, 8 + py, [46, 92, 38]);
        };
        break;
      case "AGR-02":
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Field);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Field; };
        studioPainter = (put) => {
          for (let py = 1; py <= 6; py++) for (let px = 1; px <= 6; px += 2) put(8 + px, 8 + py, [214, 175, 75]);
        };
        break;
      case "AGR-03":
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Field);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Field; };
        studioPainter = (put) => {
          for (let py = 1; py <= 6; py++) for (let px = 1; px <= 6; px += 2) put(8 + px, 8 + py, [105, 175, 55]);
        };
        break;
      case "AGR-04":
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Field);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Field; };
        studioPainter = (put) => {
          for (let py = 1; py <= 6; py++) for (let px = 1; px <= 6; px++) put(8 + px, 8 + py, (px % 2 === 0) ? [105, 75, 45] : [75, 50, 30]);
        };
        break;
      case "AGR-05":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Barn);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Suburbs; w.pop[t] = 5; };
        studioPainter = (put) => drawHouse(8, 8, Districts.Suburbs, 1, put, null, 120, 0, false);
        break;
      case "AGR-06":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Barn);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.Barn; w.terrain[t] = Terrain.Citizen; w.pop[t] = 5; };
        break;
      case "AGR-07":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Silo);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.Silo; w.terrain[t] = Terrain.Citizen; w.pop[t] = 5; };
        break;
      case "AGR-08":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.GrainElevator);
        isMultiTile = true;
        studioSetup = (w, sim, t) => {
          for (const r of [7, 8]) for (const c of [8, 9]) { w.lot[r * 16 + c] = Lot.GrainElevator; w.terrain[r * 16 + c] = Terrain.Citizen; w.pop[r * 16 + c] = 5; }
          for (const c of [8, 9]) { w.lot[9 * 16 + c] = Lot.Silo; w.terrain[9 * 16 + c] = Terrain.Citizen; }
        };
        break;
      case "AGR-09":
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Pasture);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Pasture; };
        studioPainter = (put) => {
          put(8 + 2, 8 + 3, [240, 240, 240]);
          put(8 + 3, 8 + 3, [30, 30, 30]);
          put(8 + 2, 8 + 4, [30, 30, 30]);
          put(8 + 3, 8 + 4, [240, 240, 240]);
          put(8 + 5, 8 + 4, [140, 80, 45]);
          put(8 + 6, 8 + 4, [140, 80, 45]);
        };
        break;
      case "AGR-10":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Barn);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Grass; };
        studioPainter = (put) => {
          put(8 + 2, 8 + 3, [47, 110, 47]);
          put(8 + 3, 8 + 3, [47, 110, 47]);
          put(8 + 4, 8 + 4, [47, 110, 47]);
          put(8 + 2, 8 + 4, [25, 25, 25]);
          put(8 + 4, 8 + 5, [25, 25, 25]);
          put(8 + 3, 8 + 2, [255, 220, 50]);
        };
        break;

      // ---- Category G: Landmarks (LMK-01 to LMK-05) ----
      case "LMK-01":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Chapel);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.Chapel; w.terrain[t] = Terrain.Citizen; w.pop[t] = 5; };
        break;
      case "LMK-02":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.WaterTower);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Grass; };
        studioPainter = (put) => {
          put(8 + 3, 8, [240, 30, 30]);
          put(8 + 4, 8, [240, 30, 30]);
          for (let py = 1; py <= 7; py++) {
            put(8 + 3, 8 + py, (py % 2 === 0) ? [220, 220, 225] : [210, 40, 40]);
            put(8 + 4, 8 + py, (py % 2 === 0) ? [210, 40, 40] : [220, 220, 225]);
          }
        };
        break;
      case "LMK-03":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Park);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.Park; w.terrain[t] = Terrain.Citizen; w.pop[t] = 5; };
        break;
      case "LMK-04":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.WaterTower);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.WaterTower; w.terrain[t] = Terrain.Citizen; w.pop[t] = 5; };
        break;
      case "LMK-05":
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.TownHall);
        studioSetup = (w, sim, t) => { w.lot[t] = Lot.TownHall; w.terrain[t] = Terrain.Citizen; w.pop[t] = 5; };
        break;

      // ---- Category H: Cults (CLT-01 to CLT-24) ----
      case "CLT-01":
      case "CLT-04":
      case "CLT-07":
      case "CLT-10":
      case "CLT-13":
      case "CLT-16":
      case "CLT-19":
      case "CLT-22": {
        const cultIdMap = {
          "CLT-01": { type: "compound", player: 1 },
          "CLT-04": { type: "watchtower", player: 1 },
          "CLT-07": { type: "compound", player: 2 },
          "CLT-10": { type: "supplement_lab", player: 2 },
          "CLT-13": { type: "compound", player: 3 },
          "CLT-16": { type: "collection_plate", player: 3 },
          "CLT-19": { type: "compound", player: 4 },
          "CLT-22": { type: "satellite", player: 4 },
        };
        const def = cultIdMap[asset.id];
        const bd = mainSim.buildings.find(b => b.player === def.player && b.type === def.type);
        if (bd) mapTile = bd.tile;
        studioSetup = (w, sim, t) => {
          sim.buildings.push({ id: 99, player: def.player, type: def.type, tile: t, buildTicksLeft: 0, disabledTicks: 0 });
          w.owner[t] = def.player;
        };
        break;
      }
      case "CLT-02":
      case "CLT-08":
      case "CLT-14":
      case "CLT-20": {
        const pMap = { "CLT-02": 1, "CLT-08": 2, "CLT-14": 3, "CLT-20": 4 };
        const p = pMap[asset.id];
        const v = mainSim.vans.find(vn => vn.player === p);
        if (v) mapTile = v.tile;
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Road;
          sim.vans.push({ id: 99, player: p, tile: t, path: [t], idx: 0, moveProgress: 0 });
        };
        break;
      }
      case "CLT-03":
      case "CLT-09":
      case "CLT-15":
      case "CLT-21": {
        const pMap = { "CLT-03": 1, "CLT-09": 2, "CLT-15": 3, "CLT-21": 4 };
        const p = pMap[asset.id];
        const a = mainSim.agents.find(ag => ag.player === p);
        if (a) mapTile = a.tile;
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Road;
          sim.agents.push({ id: 99, player: p, tile: t, targetDistrict: 3, victim: 1, mission: "deprogram", phase: "travel", travelTicks: 10, channelTicks: 0 });
        };
        break;
      }
      case "CLT-05":
      case "CLT-11":
      case "CLT-17":
      case "CLT-23": {
        const pMap = { "CLT-05": 1, "CLT-11": 2, "CLT-17": 3, "CLT-23": 4 };
        const p = pMap[asset.id];
        mapTile = findTileMatching(mainWorld, (w, t) => w.owner[t] === p && w.terrain[t] === Terrain.Grass);
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Grass;
          w.owner[t] = p;
        };
        break;
      }
      case "CLT-06":
      case "CLT-12":
      case "CLT-18":
      case "CLT-24": {
        const pMap = { "CLT-06": 1, "CLT-12": 2, "CLT-18": 3, "CLT-24": 4 };
        const p = pMap[asset.id];
        mapTile = findTileMatching(mainWorld, (w, t) => w.owner[t] === p && w.terrain[t] === Terrain.Citizen);
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Citizen;
          w.owner[t] = p;
          w.pop[t] = 5;
        };
        break;
      }

      // ---- Category I: Living Entities (NPC-01 to NPC-07) ----
      case "NPC-01":
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Road);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Road; };
        studioPainter = (put) => {
          put(8 + 3, 8 + 4, [240, 200, 50]);
          put(8 + 4, 8 + 4, [40, 40, 40]);
          put(8 + 3, 8 + 3, [240, 220, 180]);
        };
        break;
      case "NPC-02":
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Road);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Road; };
        studioPainter = (put) => {
          for (let py = 3; py <= 5; py++) for (let px = 1; px <= 6; px++) put(8 + px, 8 + py, [230, 230, 235]);
          put(8 + 3, 8 + 1, [80, 160, 220]);
          put(8 + 4, 8 + 1, [80, 160, 220]);
          put(8 + 3, 8 + 2, [180, 180, 180]);
          put(8 + 4, 8 + 2, [180, 180, 180]);
          put(8 + 2, 8 + 6, [30, 30, 30]);
          put(8 + 5, 8 + 6, [30, 30, 30]);
        };
        break;
      case "NPC-03":
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Road);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Road; };
        studioPainter = (put) => {
          for (let py = 2; py <= 5; py++) for (let px = 1; px <= 6; px++) put(8 + px, 8 + py, [60, 80, 110]);
          put(8 + 2, 8 + 3, [160, 210, 240]);
          put(8 + 4, 8 + 3, [160, 210, 240]);
          put(8 + 2, 8 + 6, [25, 25, 25]);
          put(8 + 5, 8 + 6, [25, 25, 25]);
        };
        break;
      case "NPC-04":
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Citizen);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Citizen; };
        studioPainter = (put) => {
          put(8 + 1, 8 + 2, [240, 240, 240]);
          put(8 + 1, 8 + 3, [106, 77, 49]);
          put(8 + 2, 8 + 4, [210, 50, 50]);
          put(8 + 4, 8 + 2, [240, 240, 240]);
          put(8 + 4, 8 + 3, [106, 77, 49]);
          put(8 + 5, 8 + 4, [50, 90, 210]);
        };
        break;
      case "NPC-05":
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Citizen && w.pop[t] >= 5);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Suburbs; w.pop[t] = 5; };
        studioPainter = (put) => {
          put(8 + 2, 8 + 3, [240, 210, 180]);
          put(8 + 2, 8 + 4, [60, 110, 180]);
          put(8 + 2, 8 + 5, [40, 40, 50]);
          put(8 + 5, 8 + 3, [240, 210, 180]);
          put(8 + 5, 8 + 4, [200, 60, 80]);
          put(8 + 5, 8 + 5, [40, 40, 50]);
        };
        break;
      case "NPC-06":
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Road);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Road; };
        studioPainter = (put) => {
          for (let px = 2; px <= 5; px++) put(8 + px, 8 + 3, [180, 210, 230]);
          for (let px = 1; px <= 6; px++) put(8 + px, 8 + 4, [190, 45, 45]);
          put(8 + 2, 8 + 5, [30, 30, 30]);
          put(8 + 5, 8 + 5, [30, 30, 30]);
        };
        break;
      case "NPC-07":
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Road);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Road; };
        studioPainter = (put) => {
          for (let px = 1; px <= 6; px++) put(8 + px, 8 + 4, [20, 20, 20]);
          put(8 + 2, 8 + 3, [245, 245, 245]);
          put(8 + 3, 8 + 3, [220, 40, 40]);
          put(8 + 4, 8 + 3, [40, 100, 230]);
          put(8 + 5, 8 + 3, [245, 245, 245]);
          put(8 + 2, 8 + 5, [20, 20, 20]);
          put(8 + 5, 8 + 5, [20, 20, 20]);
        };
        break;

      default:
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Citizen);
        studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Citizen; w.pop[t] = 5; };
        break;
    }

    if (mapTile === -1) mapTile = 20 * 64 + 20;

    // 1. Studio Render
    const studio = createStudioRender(studioSetup, 10, studioPainter, isMultiTile);
    writePNG(studioPath, studio.width, studio.height, studio.rgba);

    // 2. On-Map Context Crop
    const bx = (mapTile % 64) * 8;
    const by = Math.floor(mapTile / 64) * 8;
    const cropX = Math.max(0, Math.min(512 - 32, bx - 12));
    const cropY = Math.max(0, Math.min(512 - 32, by - 12));
    const mapCrop = cropRgba(targetRgba, 512, 512, cropX, cropY, 32, 32, 7.5);
    writePNG(mapPath, mapCrop.width, mapCrop.height, mapCrop.rgba);

    catalogResults.push({
      ...asset,
      studioImg: `assets/catalog/${studioFilename}`,
      mapImg: `assets/catalog/${mapFilename}`,
    });

    if ((i + 1) % 25 === 0 || i === MASTER_ASSET_CATALOG.length - 1) {
      console.log(`  -> Rendered [${i + 1}/${MASTER_ASSET_CATALOG.length}] assets (Studio & Map)`);
    }
  }

  return catalogResults;
}

// If run directly via node
if (process.argv[1] && process.argv[1].endsWith("generate_catalog_inspection.mjs")) {
  const t0 = performance.now();
  await generateAllCatalogImages();
  console.log(`[CATALOG INSPECTOR] All 121 assets rendered in ${(performance.now() - t0).toFixed(1)} ms.`);
}
