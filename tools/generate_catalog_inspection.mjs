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
function createStudioRender(setupFn, scale = 10) {
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

  const xMin = Math.floor(W * 0.28);
  const xMax = Math.ceil(W * 0.72);
  const yMin = Math.floor(H * 0.28);
  const yMax = Math.ceil(H * 0.72);

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

    switch (asset.category) {
      case "Terrain": {
        if (asset.id === "ENV-09" || asset.id === "ENV-10" || asset.id === "ENV-11" || asset.id === "ENV-12") {
          targetWorld = desertWorld;
          targetRgba = desertRgba;
          mapTile = findTileMatching(desertWorld, (w, t) => w.biome[t] === 1);
        } else if (asset.id === "ENV-06" || asset.id === "ENV-07" || asset.id === "ENV-08") {
          mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Lake);
        } else if (asset.id === "ENV-04" || asset.id === "ENV-05") {
          mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Woods);
        } else {
          mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Grass);
        }

        studioSetup = (w, sim, t) => {
          if (asset.id.includes("ENV-06") || asset.id.includes("ENV-07") || asset.id.includes("ENV-08")) {
            w.terrain[t] = Terrain.Lake;
          } else if (asset.id.includes("ENV-04") || asset.id.includes("ENV-05")) {
            w.terrain[t] = Terrain.Woods;
          } else if (asset.id.includes("ENV-09") || asset.id.includes("ENV-10")) {
            w.biome[t] = 1; // Desert
            w.terrain[t] = Terrain.Grass;
          } else {
            w.terrain[t] = Terrain.Grass;
          }
        };
        break;
      }

      case "Infrastructure": {
        if (asset.id === "ST-01") {
          mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Road && (w.terrain[t + 64] === Terrain.Road || w.terrain[t - 64] === Terrain.Road));
          studioSetup = (w, sim, t) => {
            w.terrain[t] = Terrain.Road;
            w.terrain[t + 16] = Terrain.Road; // 4-lane highway pair
          };
        } else if (asset.id === "ST-04") {
          mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Dirt);
          studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Dirt; };
        } else if (asset.id === "ST-10" || asset.id === "ST-11" || asset.id === "ST-12" || asset.id === "ST-13") {
          mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Rail);
          studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Rail; };
        } else if (asset.id === "ST-17") {
          mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Dam);
          studioSetup = (w, sim, t) => { w.lot[t] = Lot.Dam; w.terrain[t] = Terrain.Citizen; w.pop[t] = 5; };
        } else {
          mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Road);
          studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Road; };
        }
        break;
      }

      case "Residential": {
        if (asset.id === "RES-05" || asset.id === "RES-06") {
          mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Trailer || w.district[t] === Districts.Trailer);
          studioSetup = (w, sim, t) => { w.lot[t] = Lot.Trailer; w.district[t] = Districts.Trailer; w.terrain[t] = Terrain.Citizen; w.pop[t] = 3; };
        } else {
          mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Citizen && w.pop[t] >= 3 && w.lot[t] === 0);
          studioSetup = (w, sim, t) => {
            w.terrain[t] = Terrain.Citizen;
            w.district[t] = Districts.Suburbs;
            w.pop[t] = 5;
          };
        }
        break;
      }

      case "Commercial": {
        const lotMap = {
          "COM-01": Lot.Shop,
          "COM-02": Lot.Shop,
          "COM-03": Lot.Diner,
          "COM-04": Lot.GasStation,
          "COM-05": Lot.Shop,
          "COM-06": Lot.Cinema,
          "COM-07": Lot.Bank,
          "COM-08": Lot.PostOffice,
          "COM-09": Lot.Office,
          "COM-10": Lot.Motel,
          "COM-11": Lot.Motel,
          "COM-12": Lot.Factory,
          "COM-13": Lot.Warehouse,
          "COM-14": Lot.Depot,
        };
        const targetLot = lotMap[asset.id] || Lot.Shop;
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === targetLot);
        if (mapTile === -1) {
          mapTile = findTileMatching(mainWorld, (w, t) => w.district[t] === Districts.Downtown && w.terrain[t] === Terrain.Citizen);
          if (mapTile !== -1) mainWorld.lot[mapTile] = targetLot;
        }
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Citizen;
          w.district[t] = Districts.Downtown;
          w.lot[t] = targetLot;
          w.pop[t] = 5;
        };
        break;
      }

      case "Civic": {
        const civicMap = {
          "CIV-01": Lot.TownHall,
          "CIV-02": Lot.Sheriff,
          "CIV-03": Lot.HighSchool,
          "CIV-04": Lot.BallField,
          "CIV-05": Lot.School,
          "CIV-06": Lot.School,
          "CIV-07": Lot.Playground,
          "CIV-08": Lot.Supermarket,
          "CIV-09": Lot.Church,
          "CIV-10": Lot.Cemetery,
          "CIV-11": Lot.FireStation,
          "CIV-12": Lot.WaterTower,
        };
        const targetLot = civicMap[asset.id] || Lot.Church;
        mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === targetLot);
        if (mapTile === -1) {
          mapTile = findTileMatching(mainWorld, (w, t) => w.district[t] === Districts.Downtown && w.terrain[t] === Terrain.Citizen);
          if (mapTile !== -1) mainWorld.lot[mapTile] = targetLot;
        }
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Citizen;
          w.district[t] = Districts.Downtown;
          w.lot[t] = targetLot;
          w.pop[t] = 5;
        };
        break;
      }

      case "Agriculture": {
        if (asset.id === "AGR-06") {
          mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Barn);
          studioSetup = (w, sim, t) => { w.lot[t] = Lot.Barn; w.terrain[t] = Terrain.Citizen; w.pop[t] = 5; };
        } else if (asset.id === "AGR-07") {
          mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Silo);
          studioSetup = (w, sim, t) => { w.lot[t] = Lot.Silo; w.terrain[t] = Terrain.Citizen; w.pop[t] = 5; };
        } else if (asset.id === "AGR-08") {
          mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.GrainElevator);
          studioSetup = (w, sim, t) => { w.lot[t] = Lot.GrainElevator; w.terrain[t] = Terrain.Citizen; w.pop[t] = 5; };
        } else {
          mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Field);
          studioSetup = (w, sim, t) => { w.terrain[t] = Terrain.Field; };
        }
        break;
      }

      case "Landmarks": {
        if (asset.id === "LMK-01") {
          mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Chapel);
          studioSetup = (w, sim, t) => { w.lot[t] = Lot.Chapel; w.terrain[t] = Terrain.Citizen; w.pop[t] = 5; };
        } else if (asset.id === "LMK-03") {
          mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.Park);
          studioSetup = (w, sim, t) => { w.lot[t] = Lot.Park; w.terrain[t] = Terrain.Citizen; w.pop[t] = 5; };
        } else if (asset.id === "LMK-04") {
          mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.WaterTower);
          studioSetup = (w, sim, t) => { w.lot[t] = Lot.WaterTower; w.terrain[t] = Terrain.Citizen; w.pop[t] = 5; };
        } else {
          mapTile = findTileMatching(mainWorld, (w, t) => w.lot[t] === Lot.TownHall);
          studioSetup = (w, sim, t) => { w.lot[t] = Lot.TownHall; w.terrain[t] = Terrain.Citizen; w.pop[t] = 5; };
        }
        break;
      }

      case "Cults": {
        const cultIdMap = {
          "CLT-01": { type: "compound", player: 1 },
          "CLT-02": { entity: "van", player: 1 },
          "CLT-03": { entity: "agent", player: 1 },
          "CLT-04": { type: "watchtower", player: 1 },
          "CLT-05": { territory: 1 },
          "CLT-06": { conquered: 1 },

          "CLT-07": { type: "compound", player: 2 },
          "CLT-08": { entity: "van", player: 2 },
          "CLT-09": { entity: "agent", player: 2 },
          "CLT-10": { type: "supplement_lab", player: 2 },
          "CLT-11": { territory: 2 },
          "CLT-12": { conquered: 2 },

          "CLT-13": { type: "compound", player: 3 },
          "CLT-14": { entity: "van", player: 3 },
          "CLT-15": { entity: "agent", player: 3 },
          "CLT-16": { type: "collection_plate", player: 3 },
          "CLT-17": { territory: 3 },
          "CLT-18": { conquered: 3 },

          "CLT-19": { type: "compound", player: 4 },
          "CLT-20": { entity: "van", player: 4 },
          "CLT-21": { entity: "agent", player: 4 },
          "CLT-22": { type: "satellite", player: 4 },
          "CLT-23": { territory: 4 },
          "CLT-24": { conquered: 4 },
        };
        const cultDef = cultIdMap[asset.id] || { type: "compound", player: 1 };
        if (cultDef.type) {
          const bd = mainSim.buildings.find(b => b.player === cultDef.player && b.type === cultDef.type);
          if (bd) mapTile = bd.tile;
          studioSetup = (w, sim, t) => {
            sim.buildings.push({ id: 99, player: cultDef.player, type: cultDef.type, tile: t, buildTicksLeft: 0, disabledTicks: 0 });
            w.owner[t] = cultDef.player;
          };
        } else if (cultDef.entity === "van") {
          const v = mainSim.vans.find(vn => vn.player === cultDef.player);
          if (v) mapTile = v.tile;
          studioSetup = (w, sim, t) => {
            w.terrain[t] = Terrain.Road;
            sim.vans.push({ id: 99, player: cultDef.player, tile: t, path: [t], idx: 0, moveProgress: 0 });
          };
        } else if (cultDef.entity === "agent") {
          const a = mainSim.agents.find(ag => ag.player === cultDef.player);
          if (a) mapTile = a.tile;
          studioSetup = (w, sim, t) => {
            w.terrain[t] = Terrain.Road;
            sim.agents.push({ id: 99, player: cultDef.player, tile: t, targetDistrict: 3, victim: 1, mission: "deprogram", phase: "travel", travelTicks: 10, channelTicks: 0 });
          };
        } else {
          mapTile = findTileMatching(mainWorld, (w, t) => w.owner[t] === cultDef.territory || w.owner[t] === cultDef.conquered);
          studioSetup = (w, sim, t) => {
            w.terrain[t] = Terrain.Grass;
            w.owner[t] = cultDef.territory || cultDef.conquered || 1;
          };
        }
        break;
      }

      case "LivingEntities": {
        mapTile = findTileMatching(mainWorld, (w, t) => w.terrain[t] === Terrain.Road);
        studioSetup = (w, sim, t) => {
          w.terrain[t] = Terrain.Road;
          sim.vans.push({ id: 99, player: 1, tile: t, path: [t], idx: 0, moveProgress: 0 });
        };
        break;
      }
    }

    if (mapTile === -1) mapTile = 20 * 64 + 20;

    // 1. Studio Render
    const studio = createStudioRender(studioSetup, 10);
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
