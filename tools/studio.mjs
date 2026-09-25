/**
 * Studio View (Dual-QA Harness A) — true isolation via difference matte.
 * Each subject is rendered twice on the same scratch lot: with and without
 * the asset. Pixels identical in both are background and become flat
 * #181512 slate (with faint 1px tile guides), so only the asset — and
 * whatever it adds around itself (shadow, driveway, apron) — remains.
 * Output: labelled contact sheets, one per ROADMAP batch.
 * Usage: node tools/studio.mjs [lod=8] [season=summer] [time=day] [outDir=scratch/studio]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { loadBalance, createSim, generateWorld, renderTown, Lot, Landmark, Terrain, Districts, Biome, footprintOf } from "../packages/sim/dist/index.js";
import { encodePNG } from "./lib/png.mjs";

const [lodA = "8", season = "summer", time = "day", OUT = "scratch/studio"] = process.argv.slice(2);
const LOD = +lodA, N = 14, ROAD_Y = 9, SLATE = [0x18, 0x15, 0x12], GUIDE = [0x26, 0x22, 0x1e];
mkdirSync(OUT, { recursive: true });
const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));

/** Blank scratch world: open grass, one E–W street at ROAD_Y. */
function blank(biome = Biome.Temperate) {
  const w = generateWorld(99, N, N);
  for (let i = 0; i < w.terrain.length; i++) {
    w.terrain[i] = Math.floor(i / N) === ROAD_Y ? Terrain.Road : Terrain.Grass;
    w.lot[i] = 0; w.pop[i] = 0; w.landmark[i] = 0; w.owner[i] = 0; w.district[i] = 0; w.biome[i] = biome;
  }
  return w;
}
/** Render the subject window at LOD; stage(w) mutates the world. */
function shot(stage, fw, fh, biome, road = true, viewOverride) {
  const frames = [false, true].map((on) => {
    const w = blank(biome);
    if (!road) for (let x = 0; x < N; x++) w.terrain[ROAD_Y * N + x] = Terrain.Grass;
    if (on) stage(w);
    const sim = createSim({ seed: 99, balance, world: w, spawns: [], timerTicks: 0, dominationPermille: 1000 });
    const view = viewOverride ?? { x: 4, y: ROAD_Y - fh - 1, w: fw + 2, h: fh + 2 };
    return renderTown(sim, { frameTick: 0, lod: LOD, view, season, timeOfDay: time });
  });
  const [bg, fg] = frames, px = LOD * 8;
  const out = Buffer.from(fg.data.buffer, fg.data.byteOffset, fg.data.byteLength);
  for (let i = 0; i < out.length; i += 4) {
    if (bg.data[i] !== fg.data[i] || bg.data[i + 1] !== fg.data[i + 1] || bg.data[i + 2] !== fg.data[i + 2]) continue;
    const p = i / 4, x = p % fg.width, y = (p / fg.width) | 0;
    const c = x % px === 0 || y % px === 0 ? GUIDE : SLATE;
    out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
  }
  return encodePNG(fg.width, fg.height, out).toString("base64");
}
const at = (x, y) => y * N + x;
const X0 = 5; // subject's west column (view starts at 4 → 1-tile margin)
/** a lot stamped at its REAL footprint (footprints.ts) unless a size is given */
const lot = (id, fw0, fh0, district = Districts.Downtown, pop = 4) => {
  const fp = footprintOf(id);
  const fw = fw0 ?? fp.w, fh = fh0 ?? fp.h;
  const f = (w) => {
    for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) {
      const t = at(X0 + dx, ROAD_Y - fh + dy);
      w.terrain[t] = Terrain.Citizen; w.lot[t] = id; w.district[t] = district; w.pop[t] = pop;
    }
  };
  f.fw = fw; f.fh = fh;
  return f;
};
const houses = (district, n = 6, seedX = 0) => (w) => {
  for (let i = 0; i < n; i++) {
    const t = at(X0 + i, ROAD_Y - 1);
    w.terrain[t] = Terrain.Citizen; w.district[t] = district; w.pop[t] = 4 + ((i + seedX) % 3);
  }
};
/** A whole 5×4 block with streets on all four sides: houses face every frontage, interiors are backyards. */
const block = (district, biome) => (w) => {
  const x0 = X0, y1 = ROAD_Y - 1, y0 = ROAD_Y - 4;
  for (let y = y0 - 1; y <= ROAD_Y; y++) for (let x = x0 - 1; x <= x0 + 5; x++) {
    const t = at(x, y);
    if (y === y0 - 1 || y === ROAD_Y || x === x0 - 1 || x === x0 + 5) { w.terrain[t] = Terrain.Road; continue; }
    w.terrain[t] = Terrain.Citizen; w.district[t] = district; if (biome !== undefined) w.biome[t] = biome;
    const edge = y === y0 || y === y1 || x === x0 || x === x0 + 4;
    w.pop[t] = edge ? 3 + ((x * 5 + y * 3) % 4) : (x + y) % 3;
  }
};
const terrain = (tr, fw = 3, fh = 2) => (w) => {
  for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) w.terrain[at(X0 + dx, ROAD_Y - fh + dy)] = tr;
};
const landmark = (id) => (w) => { const t = at(X0, ROAD_Y - 1); w.terrain[t] = Terrain.Citizen; w.landmark[t] = id; w.pop[t] = 4; w.district[t] = Districts.Downtown; };

const S = (name, stage, fw = stage.fw ?? 1, fh = stage.fh ?? 1, biome, road) => ({ name, stage, fw, fh, biome, road });
/**
 * The SAME lot (same tile, so the same hashed style) with its street on
 * each side in turn — N, S, E, W — for the orientation check.
 */
const QX = 6, QY = 5;
const oneSide = (side, setup) => (w) => {
  for (let x = 0; x < N; x++) w.terrain[ROAD_Y * N + x] = Terrain.Grass;
  const [rx, ry] = side === "N" ? [QX, QY - 1] : side === "S" ? [QX, QY + 1] : side === "E" ? [QX + 1, QY] : [QX - 1, QY];
  for (let k = -2; k <= 2; k++) {
    const x = side === "N" || side === "S" ? rx + k : rx, y = side === "N" || side === "S" ? ry : ry + k;
    w.terrain[at(x, y)] = Terrain.Road;
  }
  setup(w, at(QX, QY));
};
const QUAD_VIEW = { x: QX - 1, y: QY - 1, w: 3, h: 3 };
const Q = (name, setup) => ({ name, quad: ["N", "S", "E", "W"].map((side) => oneSide(side, setup)) });
const shopLot = (w, t) => { w.terrain[t] = Terrain.Citizen; w.lot[t] = Lot.Shop; w.district[t] = Districts.Downtown; w.pop[t] = 4; };
const houseLot = (w, t) => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Suburbs; w.pop[t] = 5; };
const aptLot = (w, t) => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.ResHigh; w.pop[t] = 9; };
const apartments = (n = 4) => (w) => {
  for (let i = 0; i < n; i++) { const t = at(X0 + i, ROAD_Y - 1); w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.ResHigh; w.pop[t] = 9 + i; }
};
const D = Districts;
const BATCHES = {
  "2_downtown_commercial": [
    S("Courthouse 3x3", lot(Lot.Courthouse, 3, 3), 3, 3), S("Courthouse 3x2", lot(Lot.Courthouse, 3, 2), 3, 2), S("TownHall landmark", landmark(Landmark.TownHall)),
    S("Shop", lot(Lot.Shop)), S("Shop row x4", lot(Lot.Shop, 4, 1), 4, 1), S("Diner", lot(Lot.Diner)), S("Bank", lot(Lot.Bank)),
    S("PostOffice", lot(Lot.PostOffice)), S("Office 2x1", lot(Lot.Office, 2, 1), 2, 1), S("Supermarket 2x2", lot(Lot.Supermarket, 2, 2), 2, 2),
    S("Cinema 2x2", lot(Lot.Cinema, 2, 2), 2, 2), S("GasStation 2x1", lot(Lot.GasStation, 2, 1, D.Commercial), 2, 1),
    S("Motel 2x1", lot(Lot.Motel, 2, 1, D.Commercial), 2, 1), S("Sheriff 2x1", lot(Lot.Sheriff, 2, 1), 2, 1),
    S("FireStation 2x2", lot(Lot.FireStation, 2, 2), 2, 2), S("Parking 2x1", lot(Lot.Parking, 2, 1), 2, 1),
  ],
  "1_orientation": [
    Q("Shop · street N / S / E / W", shopLot), Q("House · street N / S / E / W", houseLot), Q("Apartment · street N / S / E / W", aptLot),
    S("ResHigh apartments x4", apartments(4), 4, 1),
  ],
  "3_residential_school": [
    S("Suburbs houses", houses(D.Suburbs), 6, 1), S("OldTown houses", houses(D.OldTown, 6, 1), 6, 1),
    S("ResHigh houses", houses(D.ResHigh, 6, 2), 6, 1), S("College houses", houses(D.College), 6, 1),
    S("Trailer homes", houses(D.Trailer), 6, 1),
    S("Suburb block (all frontages)", block(D.Suburbs), 5, 5), S("OldTown block", block(D.OldTown), 5, 5),
    S("College block", block(D.College), 5, 5), S("Desert adobe block", block(D.Suburbs, Biome.Desert), 5, 5), S("Desert adobe", houses(D.Suburbs), 6, 1, Biome.Desert),
    S("HighSchool 3x2", lot(Lot.HighSchool, 3, 2, D.College, 8), 3, 2), S("School 2x2", lot(Lot.School, 2, 2, D.Suburbs, 8), 2, 2),
    S("BallField 2x2", lot(Lot.BallField, 2, 2, D.College), 2, 2), S("Track 6x4", lot(Lot.Track, 6, 4, D.College), 6, 4), S("Track 5x3", lot(Lot.Track, 5, 3, D.College), 5, 3),
    S("Playground", lot(Lot.Playground, undefined, undefined, D.Suburbs)), S("Park 2x2", lot(Lot.Park, 2, 2, D.Suburbs), 2, 2),
    S("Library", lot(Lot.Library, undefined, undefined, D.College)), S("Church 2x2", lot(Lot.Church, 2, 2, D.OldTown), 2, 2),
    S("Chapel", lot(Lot.Chapel, undefined, undefined, D.OldTown)), S("Cemetery 2x1", lot(Lot.Cemetery, 2, 1, D.OldTown), 2, 1),
  ],
  "4_industrial_rural": [
    S("Factory 2x2", lot(Lot.Factory, 2, 2, D.Industrial), 2, 2), S("Warehouse 2x2", lot(Lot.Warehouse, 2, 2, D.Industrial), 2, 2),
    S("GrainElevator 2x2", lot(Lot.GrainElevator, 2, 2, D.Industrial), 2, 2), S("Depot 2x1", lot(Lot.Depot, 2, 1, D.Industrial), 2, 1),
    S("Sawmill 2x2", lot(Lot.Sawmill, 2, 2, D.Industrial), 2, 2), S("Cannery 2x2", lot(Lot.Cannery, 2, 2, D.Industrial), 2, 2),
    S("Substation", lot(Lot.Substation, undefined, undefined, D.Industrial)), S("WaterTower lot", lot(Lot.WaterTower, undefined, undefined, D.Industrial)),
    S("Barn", lot(Lot.Barn, undefined, undefined, D.Trailer)), S("Silo", lot(Lot.Silo, undefined, undefined, D.Trailer)), S("Greenhouse", lot(Lot.Greenhouse, undefined, undefined, D.Trailer)),
    S("Dam", lot(Lot.Dam, undefined, undefined, D.Trailer)), S("Lighthouse", lot(Lot.Lighthouse, undefined, undefined, D.Trailer)), S("Dock", lot(Lot.Dock, undefined, undefined, D.Trailer)),
    S("Field 3x2", terrain(Terrain.Field), 3, 2, undefined, false), S("Orchard 3x2", terrain(Terrain.Orchard), 3, 2, undefined, false),
    S("Pasture 3x2", terrain(Terrain.Pasture), 3, 2, undefined, false), S("Rail 3x1", terrain(Terrain.Rail, 3, 1), 3, 1, undefined, false),
    S("Megachurch compound", lot(Lot.Megachurch, undefined, undefined, D.Suburbs)), S("RadioTower compound", lot(Lot.RadioTower, undefined, undefined, D.Trailer)),
    S("Fairground compound", lot(Lot.Fairground, undefined, undefined, D.Trailer)), S("WaterTower compound", lot(Lot.WaterTower, undefined, undefined, D.Suburbs)),
  ],
  "5_nature_hydro": [
    S("Woods 3x2", terrain(Terrain.Woods), 3, 2, undefined, false), S("Lake 3x2", terrain(Terrain.Lake), 3, 2, undefined, false),
    S("Rock 3x2", terrain(Terrain.Rock), 3, 2, undefined, false),
    S("Rock ridge 7x5", terrain(Terrain.Rock, 7, 5), 7, 5, undefined, false), S("Rock mesa 7x5 (desert)", terrain(Terrain.Rock, 7, 5), 7, 5, Biome.Desert, false), S("Dirt lane 3x1", terrain(Terrain.Dirt, 3, 1), 3, 1, undefined, false),
    S("Path 3x1", terrain(Terrain.Path, 3, 1), 3, 1, undefined, false),
    S("Woods (forest biome)", terrain(Terrain.Woods), 3, 2, Biome.Forest, false), S("Woods (autumn)", terrain(Terrain.Woods), 3, 2, Biome.Autumn, false),
    S("Lake (desert)", terrain(Terrain.Lake), 3, 2, Biome.Desert, false), S("Lake (ocean biome)", terrain(Terrain.Lake), 3, 2, Biome.Ocean, false),
  ],
};
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 400 } });
for (const [batch, subjects] of Object.entries(BATCHES)) {
  const cells = subjects.map((s) => {
    let img;
    try {
      img = s.quad
        ? `<div style="display:flex;gap:6px">${s.quad.map((st) => `<img src="data:image/png;base64,${shot(st, 1, 1, undefined, false, QUAD_VIEW)}">`).join("")}</div>`
        : `<img src="data:image/png;base64,${shot(s.stage, s.fw, s.fh, s.biome, s.road)}">`;
    }
    catch (e) { img = `<b>ERROR ${String(e.message).slice(0, 60)}</b>`; }
    return `<figure>${img}<figcaption>${s.name}</figcaption></figure>`;
  }).join("");
  await page.setContent(`<style>body{margin:0;background:#0d0b09;color:#ddd;font:13px monospace;display:flex;flex-wrap:wrap;gap:10px;padding:8px;width:1580px}
    figure{margin:0}img{image-rendering:pixelated;display:block;max-width:760px}</style>${cells}`);
  await page.screenshot({ path: `${OUT}/${batch}_${season}_${time}.png`, fullPage: true });
  console.log(`${OUT}/${batch}_${season}_${time}.png`);
}
await browser.close();
