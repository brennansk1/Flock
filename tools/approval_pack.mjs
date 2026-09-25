/**
 * Stage-gate approval pack: for EVERY town asset, render
 *   - Studio variants (difference-matte isolation on #181512 slate): the
 *     asset fronting a street on each side (N/S/E/W), its hash variants,
 *     winter, and its desert form where one exists;
 *   - In-situ placement: a crop around the asset on a real generated map;
 * and for every map-generation aspect, the maps that show it.
 * Writes scratch/review2/img/*.png + scratch/review2/manifest.json, which
 * the approval page embeds.
 * Usage: node tools/approval_pack.mjs [outDir=scratch/review2]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  loadBalance, createSim, generateWorld, renderTown, Lot, Landmark, Terrain, Districts, Biome,
  footprintOf, drawVehicle, VEHICLE_KINDS, vehicleSize, CAR_PAINT, countTotalPop, countPopulated,
} from "../packages/sim/dist/index.js";
import { encodePNG } from "./lib/png.mjs";

const OUT = process.argv[2] ?? "scratch/review2";
mkdirSync(`${OUT}/img`, { recursive: true });
const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));
const SLATE = [0x18, 0x15, 0x12], GUIDE = [0x26, 0x22, 0x1e], GAP = 6;

// ---------------------------------------------------------------- images
const img = (rgba, w, h) => ({ rgba, w, h });
function frameImg(f) { return img(Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength), f.width, f.height); }
/** lay images side by side on slate, bottom-aligned */
function hcat(parts) {
  const W = parts.reduce((a, p) => a + p.w, 0) + GAP * (parts.length - 1);
  const H = Math.max(...parts.map((p) => p.h));
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { out[i * 4] = 0x0f; out[i * 4 + 1] = 0x0d; out[i * 4 + 2] = 0x0b; out[i * 4 + 3] = 255; }
  let x0 = 0;
  for (const p of parts) {
    const oy = H - p.h;
    for (let y = 0; y < p.h; y++) p.rgba.copy(out, ((y + oy) * W + x0) * 4, y * p.w * 4, (y + 1) * p.w * 4);
    x0 += p.w + GAP;
  }
  return img(out, W, H);
}
let fileN = 0;
function save(im, stem) {
  const f = `img/${String(++fileN).padStart(3, "0")}_${stem}.png`;
  writeFileSync(`${OUT}/${f}`, encodePNG(im.w, im.h, im.rgba));
  return f;
}

// ---------------------------------------------------------------- studio
const N = 18, LOD = 3;
function blank(biome) {
  const w = generateWorld(99, N, N);
  for (let i = 0; i < w.terrain.length; i++) {
    w.terrain[i] = Terrain.Grass; w.lot[i] = 0; w.pop[i] = 0; w.landmark[i] = 0; w.owner[i] = 0; w.district[i] = 0; w.biome[i] = biome;
  }
  return w;
}
/**
 * Studio shot: footprint fw×fh at the centre, a street along `side`
 * (N|S|E|W, or null), difference-matted against the same street alone.
 */
function studio({ place, fw, fh, side = "S", biome = Biome.Temperate, season = "summer", time = "day", tick = 0 }) {
  const x0 = (N - fw) >> 1, y0 = (N - fh) >> 1;
  const road = (w) => {
    if (!side) return;
    for (let k = -2; k < Math.max(fw, fh) + 2; k++) {
      const [x, y] = side === "S" ? [x0 + k, y0 + fh] : side === "N" ? [x0 + k, y0 - 1] : side === "E" ? [x0 + fw, y0 + k] : [x0 - 1, y0 + k];
      if (x >= 0 && y >= 0 && x < N && y < N) w.terrain[y * N + x] = Terrain.Road;
    }
  };
  const frames = [false, true].map((on) => {
    const w = blank(biome);
    road(w);
    if (on) place(w, x0, y0);
    const sim = createSim({ seed: 99, balance, world: w, spawns: [], timerTicks: 0, dominationPermille: 1000 });
    return renderTown(sim, { frameTick: tick, lod: LOD, view: { x: x0 - 2, y: y0 - 2, w: fw + 4, h: fh + 4 }, season, timeOfDay: time });
  });
  const [bg, fg] = frames, px = LOD * 8;
  const out = Buffer.from(fg.data.buffer, fg.data.byteOffset, fg.data.byteLength);
  for (let i = 0; i < out.length; i += 4) {
    const same = bg.data[i] === fg.data[i] && bg.data[i + 1] === fg.data[i + 1] && bg.data[i + 2] === fg.data[i + 2];
    if (!same) continue;
    // keep the street itself visible (dim) so the frontage reads
    const p = i / 4, x = p % fg.width, y = (p / fg.width) | 0;
    const tx = x0 - 2 + Math.floor(x / px), ty = y0 - 2 + Math.floor(y / px);
    const isRoad = side && (
      (side === "S" && ty === y0 + fh) || (side === "N" && ty === y0 - 1) || (side === "E" && tx === x0 + fw) || (side === "W" && tx === x0 - 1));
    if (isRoad) { out[i] = (out[i] * 0.45) | 0; out[i + 1] = (out[i + 1] * 0.45) | 0; out[i + 2] = (out[i + 2] * 0.45) | 0; continue; }
    const c = x % px === 0 || y % px === 0 ? GUIDE : SLATE;
    out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
  }
  return img(out, fg.width, fg.height);
}
const stampLot = (lot, district, pop = 4) => (fw, fh) => (w, x0, y0) => {
  for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) {
    const t = (y0 + dy) * N + x0 + dx;
    w.terrain[t] = Terrain.Citizen; w.lot[t] = lot; w.district[t] = district; w.pop[t] = pop;
  }
};

// ---------------------------------------------------------------- worlds
const WORLDS = new Map();
function world(town, seed = 42, size = 96) {
  const k = `${town}:${seed}:${size}`;
  if (!WORLDS.has(k)) {
    const w = generateWorld(seed, size, size, { townType: town });
    WORLDS.set(k, { w, sim: createSim({ seed, balance, world: w, spawns: [], timerTicks: 0, dominationPermille: 1000 }) });
  }
  return WORLDS.get(k);
}
function crop(town, cx, cy, vw = 14, vh = 9, opts = {}) {
  const { w, sim } = world(town, opts.seed ?? 42);
  const view = { x: Math.max(0, Math.min(w.width - vw, cx - (vw >> 1))), y: Math.max(0, Math.min(w.height - vh, cy - (vh >> 1))), w: vw, h: vh };
  return frameImg(renderTown(sim, { frameTick: opts.tick ?? 300, lod: opts.lod ?? 3, view, season: opts.season ?? "summer", timeOfDay: opts.time ?? "day" }));
}
/** centre of the first component of tiles matching pred */
function findCentre(town, pred, seed = 42) {
  const { w } = world(town, seed);
  const t0 = w.lot.findIndex((_, t) => pred(w, t));
  if (t0 < 0) return null;
  let sx = 0, sy = 0, n = 0;
  const seen = new Set([t0]), st = [t0];
  while (st.length) {
    const t = st.pop(); sx += t % w.width; sy += (t / w.width) | 0; n++;
    for (const nb of [t - 1, t + 1, t - w.width, t + w.width]) if (nb >= 0 && nb < w.lot.length && !seen.has(nb) && pred(w, nb)) { seen.add(nb); st.push(nb); }
  }
  return { x: Math.round(sx / n), y: Math.round(sy / n), n };
}

// ---------------------------------------------------------------- manifest
const items = [];
function add(group, id, name, fields) { items.push({ group, id, name, ...fields }); process.stdout.write("."); }

const D = Districts;
const FACING = ["S", "N", "E", "W"];
const LOTS = [
  // [group, Lot, district, pop, town-for-in-situ, placement rule]
  ["Downtown & Main Street", "Courthouse", D.Downtown, 5, "farm", "Centre of the Courthouse Square: the street-ringed block nearest the Main St × county-route crossing; the rest of the block is lawn. Carries the Town Hall landmark."],
  ["Downtown & Main Street", "Shop", D.Downtown, 5, "farm", "Every open lot facing Main St through Downtown/Commercial, and every lot facing the square across its street — a continuous party-wall run. 10 trades by hash."],
  ["Downtown & Main Street", "Diner", D.Downtown, 5, "farm", "Main St / Commercial strip / Old Town corner; part of the storefront run."],
  ["Downtown & Main Street", "Bank", D.Downtown, 5, "farm", "Downtown or Commercial, street frontage, paired parking."],
  ["Downtown & Main Street", "PostOffice", D.Downtown, 5, "farm", "Downtown or Commercial frontage (also drawn into the Main St run)."],
  ["Downtown & Main Street", "Office", D.Downtown, 5, "farm", "Downtown/Commercial frontage, paired parking."],
  ["Downtown & Main Street", "Cinema", D.Commercial, 6, "farm", "Commercial strip or Downtown, street frontage, paired lot."],
  ["Downtown & Main Street", "Supermarket", D.Commercial, 6, "farm", "Highway strip toward the town entrance (Commercial), customer lot in front."],
  ["Downtown & Main Street", "GasStation", D.Commercial, 3, "farm", "Highway strip / trailer fringe, on the road."],
  ["Downtown & Main Street", "Motel", D.Commercial, 4, "farm", "Highway strip, strip of rooms with its lot."],
  ["Downtown & Main Street", "Sheriff", D.Downtown, 5, "farm", "Downtown/Commercial, cruiser apron beside it."],
  ["Downtown & Main Street", "FireStation", D.Downtown, 5, "farm", "Downtown/Commercial, apron onto the street."],
  ["Downtown & Main Street", "Parking", D.Downtown, 0, "farm", "Rear lots behind every storefront row (with a driveway to a side street), paved interiors of commercial blocks, customer lots beside strip businesses and civic anchors, apartment lots."],
  ["Residential & School", "HighSchool", D.College, 6, "farm", "Edge-of-town campus, touching town, ≥6 tiles from industry: school + bus lot on the street, stadium behind."],
  ["Residential & School", "Track", D.College, 1, "farm", "Behind the high school on its campus (football field, cinder track, bleachers, chain-link)."],
  ["Residential & School", "School", D.Suburbs, 6, "farm", "Residential quarter (College/Suburbs/ResHigh), with playground and lot; ≥6 tiles from industry."],
  ["Residential & School", "Playground", D.Suburbs, 1, "farm", "Beside the elementary school and in suburban blocks."],
  ["Residential & School", "Library", D.College, 4, "farm", "School quarter or downtown."],
  ["Residential & School", "Church", D.OldTown, 5, "farm", "Old Town / Suburbs / Downtown with churchyard + lot; ≥6 tiles from industry."],
  ["Residential & School", "Chapel", D.OldTown, 4, "farm", "Old Town."],
  ["Residential & School", "Cemetery", D.OldTown, 1, "farm", "Beside the church / Old Town. (Art is Stage 3.)"],
  ["Residential & School", "Park", D.Suburbs, 1, "farm", "Pocket parks in the quarters; the square's lawn; campus filler."],
  ["Residential & School", "BallField", D.College, 1, "farm", "Little-league diamond in the school quarter."],
  ["Industry & Countryside", "Factory", D.Industrial, 5, "farm", "Industrial quarter on the works side along the rail; ≥6 tiles from schools/churches."],
  ["Industry & Countryside", "Warehouse", D.Industrial, 4, "farm", "Industrial quarter by the rail and highway end."],
  ["Industry & Countryside", "GrainElevator", D.Industrial, 3, "farm", "On the rail siding (farm towns)."],
  ["Industry & Countryside", "Depot", D.Industrial, 3, "farm", "Beside the main line."],
  ["Industry & Countryside", "Substation", D.Industrial, 1, "farm", "Industrial quarter."],
  ["Industry & Countryside", "Sawmill", D.Industrial, 3, "mountain", "Mountain towns: on the rail at a woods edge, with log yard."],
  ["Industry & Countryside", "Cannery", D.Trailer, 3, "oceanside", "Oceanside: on the shore south of the pier."],
  ["Industry & Countryside", "Lighthouse", D.Trailer, 1, "oceanside", "Oceanside: on the shore / boardwalk north of the pier."],
  ["Industry & Countryside", "Dock", D.Trailer, 1, "lakeside", "Lake and river shores near a road; oceanside fish docks."],
  ["Industry & Countryside", "Dam", D.Trailer, 1, "farm", "Weir across the river upstream (millpond)."],
  ["Industry & Countryside", "Barn", D.Trailer, 2, "farm", "Farmsteads along rural roads."],
  ["Industry & Countryside", "Silo", D.Trailer, 2, "farm", "Farmsteads."],
  ["Industry & Countryside", "Greenhouse", D.Trailer, 2, "farm", "Farmsteads."],
  ["Industry & Countryside", "WaterTower", D.Suburbs, 1, "farm", "Suburbs (town tank)."],
];
for (const [group, name, district, pop, town, rule] of LOTS) {
  const lot = Lot[name], fp = footprintOf(lot);
  const fw = fp.w, fh = fp.h;
  const place = stampLot(lot, district, pop)(fw, fh);
  const parts = FACING.map((side) => studio({ place, fw, fh, side }));
  const images = [{ label: "Studio · street on S / N / E / W", file: save(hcat(parts), `${name}_facing`) }];
  const alt = [studio({ place, fw, fh, side: "S", season: "winter" }), studio({ place, fw, fh, side: "S", time: "night" })];
  if (fp.alt) alt.unshift(studio({ place: stampLot(lot, district, pop)(fp.alt.w, fp.alt.h), fw: fp.alt.w, fh: fp.alt.h, side: "S" }));
  images.push({ label: `Studio · ${fp.alt ? `alt ${fp.alt.w}×${fp.alt.h} · ` : ""}winter · night`, file: save(hcat(alt), `${name}_variants`) });
  const c = findCentre(town, (w, t) => w.lot[t] === lot);
  if (c) images.push({ label: `In situ · ${town} seed 42`, file: save(crop(town, c.x, c.y, Math.max(14, fw + 8), Math.max(9, fh + 6)), `${name}_situ`) });
  add(group, `lot-${name}`, name, { footprint: `${fw}×${fh}${fp.alt ? ` (alt ${fp.alt.w}×${fp.alt.h})` : ""}`, scale: fp.real, placement: rule, images, missingInSitu: !c });
}

// houses per district: 8 hash variants in a row + the 4 facings + winter
const HOUSES = [
  ["Houses · Suburbs", D.Suburbs, Biome.Temperate, "Post-war ring: ranch, split-level, two-storey, bungalow; every street-facing lot is a house, interiors are backyards."],
  ["Houses · Old Town", D.OldTown, Biome.Temperate, "Pre-war grid around downtown (inside ~62% of the town radius)."],
  ["Apartments · ResHigh", D.ResHigh, Biome.Temperate, "One ring of walk-up flats hugging downtown; parking out back."],
  ["Houses · School quarter", D.College, Biome.Temperate, "The College lobe of the suburbs, around the schools."],
  ["Trailers · fringe", D.Trailer, Biome.Temperate, "Far fringe on the works side / along the highway; one trailer court."],
  ["Adobe · desert town", D.Suburbs, Biome.Desert, "Desert towns: homes on sand; a third of the frontage stays vacant."],
];
for (const [name, district, biome, rule] of HOUSES) {
  const row = (w, x0, y0) => { for (let i = 0; i < 8; i++) { const t = y0 * N + x0 + i; w.terrain[t] = Terrain.Citizen; w.district[t] = district; w.pop[t] = district === D.ResHigh ? 11 : 4 + (i % 3); } };
  const one = (w, x0, y0) => { const t = y0 * N + x0; w.terrain[t] = Terrain.Citizen; w.district[t] = district; w.pop[t] = district === D.ResHigh ? 11 : 5; };
  const images = [
    { label: "Studio · 8 neighbours (hash variants)", file: save(studio({ place: row, fw: 8, fh: 1, side: "S", biome }), `${district}_row`) },
    { label: "Studio · street on S / N / E / W", file: save(hcat(FACING.map((side) => studio({ place: one, fw: 1, fh: 1, side, biome }))), `${district}_facing`) },
    { label: "Studio · winter row", file: save(studio({ place: row, fw: 8, fh: 1, side: "S", biome, season: "winter" }), `${district}_winter`) },
  ];
  const town = biome === Biome.Desert ? "desert" : "farm";
  const c = findCentre(town, (w, t) => w.terrain[t] === Terrain.Citizen && w.lot[t] === 0 && w.pop[t] >= 3 && w.district[t] === district && (biome !== Biome.Desert || w.biome[t] === Biome.Desert));
  if (c) images.push({ label: `In situ · ${town} seed 42`, file: save(crop(town, c.x, c.y, 16, 10), `${district}_situ`) });
  add("Residential & School", `house-${district}-${biome}`, name, { footprint: "1×1 lot", scale: "house ~12×10 m on a 15 m lot", placement: rule, images });
}
// backyards
{
  const blk = (w, x0, y0) => { for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) { const t = (y0 + y) * N + x0 + x; w.terrain[t] = Terrain.Citizen; w.district[t] = D.Suburbs; w.pop[t] = (y === 3 ? 5 : 1 + ((x + y) % 2)); } };
  add("Residential & School", "backyards", "Backyards", {
    footprint: "1×1 interior lot", scale: "fenced yard", placement: "Every interior (non-street-facing) lot of a residential block: fence line, shed / pool / swing-set / clothesline / garden by hash.",
    images: [{ label: "Studio · a block row (houses on the street, yards behind)", file: save(studio({ place: blk, fw: 5, fh: 4, side: "S" }), "backyards") }],
  });
}

// vehicles
{
  const Z = 6, CELL = 8;
  const cell = (kind, dir, paint, tick, hz) => {
    const W = CELL * Z, rgba = Buffer.alloc(W * W * 4);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const c = x % Z === 0 && y % Z === 0 ? GUIDE : SLATE; const o = (y * W + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255; }
    const { w, h } = vehicleSize(kind, dir); const ox = (CELL - w) >> 1, oy = (CELL - h) >> 1;
    drawVehicle((x, y, rgb) => { for (let sy = 0; sy < Z; sy++) for (let sx = 0; sx < Z; sx++) { const o = (((y + oy) * Z + sy) * W + (x + ox) * Z + sx) * 4; rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2]; } }, kind, 0, 0, dir, paint, tick, hz);
    return img(rgba, W, W);
  };
  const NOTES = {
    sedan: "Boxy full-size sedan (Caprice/LTD).", wagon: "Wood-panel station wagon.", kcar: "K-car compact.", blazer: "Chevy Blazer / Bronco.",
    pickup: "Square-body C10 / F-150.", beetle: "VW Beetle.", camaro: "Camaro / Trans Am.", van: "Econoline van.",
    cruiser: "Black-and-white police cruiser, red/blue bubble light alternating.", bus: "Conventional yellow school bus, hazards blink at the school day's start/end.", bmx: "BMX kid, after school and evenings.",
  };
  VEHICLE_KINDS.forEach((kind, i) => {
    const paints = kind === "bmx" ? [[200, 60, 50], [40, 90, 200], [230, 200, 40]] : kind === "bus" ? [[232, 176, 32]] : kind === "cruiser" ? [[30, 29, 28]] : [0, 3, 6, 9].map((k) => CAR_PAINT[(i * 3 + k) % CAR_PAINT.length]);
    const frames = kind === "cruiser" ? [0, 4] : kind === "bus" ? [0, 8] : [-1];
    const parts = [];
    for (const tick of frames) for (let d = 0; d < 4; d++) parts.push(cell(kind, d, paints[0], tick, kind === "bus"));
    const paintParts = paints.slice(1).map((p) => cell(kind, 0, p, -1, false));
    add("1980s Vehicle Fleet", `veh-${kind}`, kind, {
      footprint: "sprite", scale: `${vehicleSize(kind, 0).w}×${vehicleSize(kind, 0).h} px (E–W)`,
      placement: `${NOTES[kind] ?? ""} Drives the street network (rush hour on Main St), parks in driveways, lots and diagonal Main St stalls.`,
      images: [
        { label: `Studio · E / W / S / N${frames.length > 1 ? " · animation frames" : ""}`, file: save(hcat(parts), `veh_${kind}`) },
        ...(paintParts.length ? [{ label: "Studio · paint variants", file: save(hcat(paintParts), `veh_${kind}_paint`) }] : []),
      ],
    });
  });
  // in-situ traffic (shared)
  const { w } = world("farm");
  const court = w.lot.indexOf(Lot.Courthouse);
  items.at(-1).images.push({ label: "In situ · Main St at rush hour (farm 42)", file: save(crop("farm", court % 96, ((court / 96) | 0) + 3, 16, 8, { tick: 700 }), "traffic") });
}

// terrain / nature assets
const TERRAIN = [
  ["Woods", Terrain.Woods, [Biome.Temperate, Biome.Forest, Biome.Autumn], "Organic stands in open country; forest skirts on mountain slopes; never through planted fields."],
  ["Rock (ridges & mesas)", Terrain.Rock, [Biome.Temperate, Biome.Desert], "Mountain: two ridge bands walling the valley; desert: 2–4 mesas. Never on roads, rail, water, town or landmarks."],
  ["Lake / pond", Terrain.Lake, [Biome.Temperate, Biome.Desert], "Lakes drained to the river; lakeside town wraps its lake; 1-tile setback for farms and buildings."],
  ["Field", Terrain.Field, [Biome.Temperate], "Farm belt parcels (compressed 6×6) around farmsteads."],
  ["Orchard", Terrain.Orchard, [Biome.Temperate], "Farm belt. (Art is Stage 3.)"],
  ["Pasture", Terrain.Pasture, [Biome.Temperate], "Farm belt, with grazing cows."],
  ["Dirt lane", Terrain.Dirt, [Biome.Temperate], "Access lanes to farms, landmarks, docks; trailer court."],
  ["Rail", Terrain.Rail, [Biome.Temperate], "Main line through town + siding into the works."],
];
for (const [name, tr, biomes, rule] of TERRAIN) {
  const place = (w, x0, y0) => { for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) w.terrain[(y0 + y) * N + x0 + x] = tr; };
  const parts = biomes.map((b) => studio({ place, fw: 5, fh: 3, side: null, biome: b }));
  parts.push(studio({ place, fw: 5, fh: 3, side: null, biome: biomes[0], season: "winter" }));
  const town = tr === Terrain.Rock ? "mountain" : tr === Terrain.Lake ? "lakeside" : "farm";
  const c = findCentre(town, (w, t) => w.terrain[t] === tr);
  const images = [{ label: `Studio · ${biomes.map((b) => Object.keys(Biome).find((k) => Biome[k] === b)).join(" / ")} / winter`, file: save(hcat(parts), `terr_${tr}`) }];
  if (c) images.push({ label: `In situ · ${town} seed 42`, file: save(crop(town, c.x, c.y, 18, 10, { lod: 2 }), `terr_${tr}_situ`) });
  if (tr === Terrain.Rock) { const d = findCentre("desert", (w, t) => w.terrain[t] === tr); if (d) images.push({ label: "In situ · desert mesa", file: save(crop("desert", d.x, d.y, 18, 10, { lod: 2 }), "mesa_situ") }); }
  add("Hydrology, Terrain & Foliage", `terr-${tr}`, name, { footprint: "terrain", scale: "per tile", placement: rule, images });
}
// water features in situ (river, coast, boardwalk, causeway)
{
  const { w: fw } = world("farm");
  const dam = fw.lot.indexOf(Lot.Dam);
  add("Hydrology, Terrain & Foliage", "river", "River (ripples, gravel bars, bridges)", {
    footprint: "terrain", scale: "1–4 tiles wide", placement: "Meanders down the roomier side of the map; widens downstream; square bridges at road crossings; weir upstream.",
    images: dam < 0 ? [] : [{ label: "In situ · 3 frames (ripples)", file: save(hcat([0, 6, 12].map((tk) => crop("farm", dam % 96, ((dam / 96) | 0) + 6, 10, 8, { tick: tk }))), "river") }],
  });
  const { w: ow } = world("oceanside");
  const lh = ow.lot.indexOf(Lot.Lighthouse);
  add("Hydrology, Terrain & Foliage", "coast", "Coast · surf, beach, boardwalk, Shore Drive", {
    footprint: "terrain", scale: "sand 2 tiles + boardwalk + drive", placement: "Oceanside: the surf runs 5 tiles past the town's sea-side edge; boardwalk (plank Path) on the sand, Shore Drive behind it; pier off Main St.",
    images: [{ label: "In situ · 3 frames (surf rolling in)", file: save(hcat([0, 5, 10].map((tk) => crop("oceanside", lh % 96, (lh / 96) | 0, 12, 9, { tick: tk }))), "surf") },
      { label: "In situ · town waterfront", file: save(crop("oceanside", lh % 96, ((lh / 96) | 0) + 12, 22, 12, { lod: 2 }), "waterfront") }],
  });
  const { w: lw } = world("lakeside");
  let cz = -1;
  for (let t = 96; t < lw.terrain.length - 96 && cz < 0; t++) if (lw.terrain[t] === Terrain.Road && lw.terrain[t - 96] === Terrain.Lake && lw.terrain[t + 96] === Terrain.Lake) cz = t;
  if (cz >= 0) add("Hydrology, Terrain & Foliage", "causeway", "Lake causeway", {
    footprint: "road", scale: "highway over water", placement: "Lakeside: where the lake overlaps the town, the highway survives as a causeway.",
    images: [{ label: "In situ · lakeside seed 42", file: save(crop("lakeside", cz % 96, (cz / 96) | 0, 16, 9), "causeway") }],
  });
}
// animations
{
  const strip = (town, pred, n, dt, t0, opts, stem) => {
    const c = findCentre(town, pred); if (!c) return null;
    return save(hcat(Array.from({ length: n }, (_, i) => crop(town, c.x, c.y, 8, 6, { ...opts, tick: t0 + i * dt }))), stem);
  };
  const A = [
    ["Police bubble lights", "farm", (w, t) => w.lot[t] === Lot.Sheriff, 4, 2, 0, { time: "night" }, "Cruisers at the sheriff (and on patrol) alternate red/blue."],
    ["School bus hazards", "farm", (w, t) => w.lot[t] === Lot.HighSchool, 4, 4, 230, {}, "Bus lot at the start/end of the school day."],
    ["Radio-tower beacon", "farm", (w, t) => w.landmark[t] === Landmark.RadioTower, 4, 6, 0, { time: "night" }, "Red beacon blink, visible day and night."],
    ["Chimney smoke (winter)", "farm", (w, t) => w.terrain[t] === Terrain.Citizen && w.lot[t] === 0 && w.pop[t] >= 3 && w.district[t] === D.Suburbs, 4, 6, 0, { season: "winter" }, "Winter chimneys puff grey smoke."],
    ["Grazing cows", "farm", (w, t) => w.terrain[t] === Terrain.Pasture, 4, 30, 0, {}, "Cows step and turn slowly in pastures."],
    ["Walkers & BMX", "farm", (w, t) => w.lot[t] === Lot.School, 4, 8, 1560, {}, "Residents walk to work/school; BMX kids ride after school."],
  ];
  for (const [name, town, pred, n, dt, t0, opts, rule] of A) {
    const f = strip(town, pred, n, dt, t0, opts, `anim_${name.replace(/\W+/g, "_")}`);
    if (f) add("Micro-animations", `anim-${name}`, name, { footprint: "animation", scale: `${n} frames, ${dt} ticks apart`, placement: rule, images: [{ label: `In situ · frames t0…t${n - 1}`, file: f }] });
  }
}
// landmarks (icon badges — Stage 3 world sprites)
for (const name of ["Megachurch", "RadioTower", "Fairground", "WaterTower"]) {
  const lm = Landmark[name];
  const place = (w, x0, y0) => { const t = y0 * N + x0; w.terrain[t] = Terrain.Citizen; w.landmark[t] = lm; w.pop[t] = 4; w.district[t] = D.Downtown; };
  const c = findCentre("farm", (w, t) => w.landmark[t] === lm);
  const images = [{ label: "Studio", file: save(studio({ place, fw: 1, fh: 1, side: "S" }), `lmk_${name}`) }];
  if (c) images.push({ label: "In situ · farm seed 42", file: save(crop("farm", c.x, c.y, 12, 8), `lmk_${name}_situ`) });
  add("Landmarks", `lmk-${name}`, name, { footprint: "1×1 badge", scale: "icon (world sprite planned for Stage 3)", placement: name === "Megachurch" ? "Town edge (east)." : name === "Fairground" ? "Town edge (west)." : "Out in the country with a dirt lane.", images });
}

// ---------------------------------------------------------------- map generation aspects
import { chromium } from "playwright";
async function shotHTML(html, stem, width = 1600) {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width, height: 300 } });
  await page.setContent(html);
  const f = `img/${String(++fileN).padStart(3, "0")}_${stem}.png`;
  await page.screenshot({ path: `${OUT}/${f}`, fullPage: true });
  await browser.close();
  return f;
}
const b64 = (im) => encodePNG(im.w, im.h, im.rgba).toString("base64");
const TYPES = ["farm", "lakeside", "desert", "mountain", "oceanside"];
const ov = (town, seed, season = "summer", time = "day") => {
  const { sim } = world(town, seed);
  const f = renderTown(sim, { frameTick: 0, lod: 1, season, timeOfDay: time });
  return frameImg(f);
};
async function grid(cells, stem, cols = 3) {
  const html = `<style>body{margin:0;background:#0f0d0b;color:#e8e0d0;font:13px monospace;display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px;padding:4px}figure{margin:0}img{width:100%;image-rendering:pixelated;display:block}</style>` +
    cells.map(([cap, im]) => `<figure><img src="data:image/png;base64,${b64(im)}"><figcaption>${cap}</figcaption></figure>`).join("");
  return shotHTML(html, stem);
}
const MG = [];
for (const town of TYPES) {
  const cells = [11, 42, 77].map((s) => [`${town} · seed ${s}`, ov(town, s)]);
  const desc = {
    farm: "Classic county-seat grid anchored on the Courthouse Square and the grain-elevator siding, in a sea of fields and farmsteads.",
    lakeside: "The lake is laid before any building and overlaps the town's long side; blocks it covers become water, the highway crosses as a causeway; docks and shore cabins.",
    desert: "Wider, sparser blocks; the town sits on sand (adobe) with only the irrigated core green; 2–4 red mesas in open country.",
    mountain: "Long, narrow valley town; two rock ridge bands (forest skirt → 10–18 tiles of rock → timber high country); roads and rivers cut passes and gorges.",
    oceanside: "Town shifted inland; the surf runs just past its sea-side edge: sand, boardwalk, Shore Drive; pier off Main St; lighthouse and cannery on the shore.",
  }[town];
  MG.push({ id: `mg-type-${town}`, name: `Town type · ${town}`, placement: desc, images: [{ label: "Seeds 11 / 42 / 77 · 96² · summer day", file: await grid(cells, `type_${town}`) }] });
}
{
  // zoning maps
  const { execFileSync } = await import("node:child_process");
  execFileSync("node", ["tools/zoning_map.mjs", "11,42,77", "96", `${OUT}/img/zoning.png`]);
  MG.push({ id: "mg-zoning", name: "Zoning (districts)", placement: "Downtown around the square (red) · highway-strip Commercial toward the entrances (orange) · Industry along the rail on the works side (purple) · one ring of flats (pink) · Old Town (tan) · Suburbs (green) with the school quarter (blue) · trailer fringe (beige). White = courthouse, dark blue = HS campus, yellow = churches, grey = parking, dim = backyards.", images: [{ label: "District map · rows = seeds 11/42/77 · columns = farm / lakeside / desert / mountain / oceanside", file: "img/zoning.png" }] });
}
{
  const { w } = world("farm"); const c = w.lot.indexOf(Lot.Courthouse);
  MG.push({ id: "mg-square", name: "Courthouse Square & Main Street", placement: "The street-ringed block nearest the Main St × county-route crossing becomes the square; storefronts face it and line Main St in a continuous run; rear lots behind every storefront row; diagonal on-street parking downtown.",
    images: [{ label: "In situ · farm 42 · summer day", file: save(crop("farm", c % 96, (c / 96) | 0, 32, 16, { lod: 2 }), "square") },
      { label: "Same · dusk", file: save(crop("farm", c % 96, (c / 96) | 0, 32, 16, { lod: 2, time: "dusk" }), "square_dusk") }] });
  const r = findCentre("farm", (w2, t) => w2.district[t] === D.Suburbs && w2.terrain[t] === Terrain.Citizen && w2.lot[t] === 0);
  MG.push({ id: "mg-residential", name: "Residential blocks (frontage grammar)", placement: "Perimeter blocks: every street-facing lot a house facing its street with driveway + curb cut; interiors are backyards; frontage gaps ≤12% (desert ≤50%) — linted.", images: [{ label: "In situ · farm 42 suburbs", file: save(crop("farm", r.x, r.y, 24, 14, { lod: 2 }), "resid") }] });
  const t = findCentre("farm", (w2, tt) => w2.lot[tt] === Lot.Track);
  MG.push({ id: "mg-campus", name: "High-school campus", placement: "Edge of town, touching town, ≤½ of its site taken from fringe yards, ≥6 tiles from industry. School 3×2 + bus lot 2×1 on the street; stadium 6×4 behind; lawn only inside the fence.", images: [{ label: "In situ · farm 42", file: save(crop("farm", t.x, t.y, 20, 12, { lod: 2 }), "campus") }, { label: "Same · winter", file: save(crop("farm", t.x, t.y, 20, 12, { lod: 2, season: "winter" }), "campus_w") }] });
  const g = findCentre("farm", (w2, tt) => w2.lot[tt] === Lot.GrainElevator);
  MG.push({ id: "mg-industry", name: "Industry & rail", placement: "Main line through town; siding into the works; industry within 2 tiles of the rail on the works side and at the highway end; 6-tile buffer from schools/churches (linted).", images: [{ label: "In situ · farm 42", file: save(crop("farm", g.x, g.y, 24, 12, { lod: 2 }), "industry") }] });
  const p = findCentre("farm", (w2, tt) => w2.lot[tt] === Lot.Parking && w2.district[tt] === D.Commercial);
  if (p) MG.push({ id: "mg-parking", name: "Parking plan", placement: "Rear lots behind storefront rows (with driveways), paved commercial-block interiors, customer lots on the strip, apartment lots, civic anchor lots. Farm 42: 139 parking tiles.", images: [{ label: "In situ · highway strip (farm 42)", file: save(crop("farm", p.x, p.y, 24, 12, { lod: 2 }), "parking_strip") }] });
  const f = findCentre("farm", (w2, tt) => w2.terrain[tt] === Terrain.Field);
  MG.push({ id: "mg-farms", name: "Farms & countryside", placement: "4–6 farmsteads on rural roads (house, barn, silo, shelterbelt) + the farm belt of compressed 6×6 parcels; woods first, fields wrap around them; quarry scar in deep country.", images: [{ label: "In situ · farm 42", file: save(crop("farm", f.x, f.y, 28, 16, { lod: 2 }), "farms") }] });
}
{
  const cells = [["spring · day", ov("farm", 42, "spring")], ["summer · day", ov("farm", 42, "summer")], ["fall · day", ov("farm", 42, "fall")], ["winter · day", ov("farm", 42, "winter")],
    ["summer · dawn", ov("farm", 42, "summer", "dawn")], ["summer · dusk", ov("farm", 42, "summer", "dusk")], ["summer · night", ov("farm", 42, "summer", "night")], ["winter · dusk", ov("farm", 42, "winter", "dusk")]];
  MG.push({ id: "mg-seasons", name: "Seasons & lighting", placement: "4 seasons × 4 times of day; snow on every biome; windows light only at dusk/night; dusk warm, never a colour cast on the whole map.", images: [{ label: "farm 42 · seasons and times of day", file: await grid(cells, "seasons", 4) }] });
}
{
  const rows = [];
  for (const size of [64, 96, 128]) for (const town of TYPES) {
    let pop = 0, tiles = 0; for (const s of [11, 42, 77]) { const w = generateWorld(s, size, size, { townType: town }); pop += countTotalPop(w); tiles += countPopulated(w); }
    rows.push({ size, town, pop: Math.round(pop / 3), tiles: Math.round(tiles / 3) });
  }
  MG.push({ id: "mg-balance", name: "Population & pacing across town types", placement: "Population floor per map size, ceiling at floor +12% so every town type plays at one pace. 30-match bot telemetry on the new maps: every cult wins (Radiant 11, Circle 8, Dawn 6, Visitors 5), matches 12–16 min, the 5:00 leader wins 30% (was 67%).", table: rows, images: [] });
}
for (const m of MG) items.push({ group: "Map Generation", footprint: "", scale: "", ...m });

writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ generated: "Stage 2", items }, null, 1));
console.log(`\n${items.length} items → ${OUT}/manifest.json`);
