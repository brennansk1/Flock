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
/** centre of the matching component nearest the courthouse (the typical example, not a fringe outlier) */
function findIn(towns, pred) { for (const town of towns) { const c = findCentre(town, pred); if (c) return { ...c, town }; } return null; }
function findCentre(town, pred, seed = 42) {
  const { w } = world(town, seed);
  const court = w.lot.indexOf(Lot.Courthouse);
  const cx = court >= 0 ? court % w.width : w.width >> 1, cy = court >= 0 ? (court / w.width) | 0 : w.height >> 1;
  const seen = new Uint8Array(w.lot.length);
  let best = null;
  for (let t0 = 0; t0 < w.lot.length; t0++) {
    if (seen[t0] || !pred(w, t0)) continue;
    let sx = 0, sy = 0, n = 0;
    const st = [t0]; seen[t0] = 1;
    while (st.length) {
      const t = st.pop(); sx += t % w.width; sy += (t / w.width) | 0; n++;
      for (const nb of [t - 1, t + 1, t - w.width, t + w.width]) if (nb >= 0 && nb < w.lot.length && !seen[nb] && pred(w, nb)) { seen[nb] = 1; st.push(nb); }
    }
    const c = { x: Math.round(sx / n), y: Math.round(sy / n), n };
    const d = (c.x - cx) ** 2 + (c.y - cy) ** 2;
    if (!best || d < best.d) best = { ...c, d };
  }
  return best;
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
  ["Downtown & Main Street", "Bank", D.Downtown, 5, "farm", "Downtown or Commercial, street frontage, paired parking. Neoclassical: granite columns, pediment, clock."],
  ["Downtown & Main Street", "PostOffice", D.Downtown, 5, "farm", "Downtown or Commercial frontage (also drawn into the Main St run). USPS blue trim and sign, flag."],
  ["Downtown & Main Street", "Office", D.Downtown, 5, "farm", "Downtown/Commercial frontage, paired parking."],
  ["Downtown & Main Street", "Cinema", D.Commercial, 6, "farm", "Commercial strip or Downtown, street frontage, paired lot. At night the marquee, chaser bulbs and blade sign light up for the late show."],
  ["Downtown & Main Street", "Supermarket", D.Commercial, 6, "farm", "Highway strip toward the town entrance (Commercial), customer lot in front. Green 1980s grocery sign band."],
  ["Downtown & Main Street", "GasStation", D.Commercial, 3, "farm", "Highway strip / trailer fringe, on the road."],
  ["Downtown & Main Street", "Motel", D.Commercial, 4, "farm", "Highway strip, strip of rooms with its lot."],
  ["Downtown & Main Street", "Sheriff", D.Downtown, 5, "farm", "Downtown/Commercial, 3×2 station with a fenced lot of 2–3 black-and-white cruisers, bubble lights flashing."],
  ["Downtown & Main Street", "FireStation", D.Downtown, 5, "farm", "Downtown/Commercial, apron onto the street."],
  ["Downtown & Main Street", "Parking", D.Downtown, 0, "farm", "Rear lots behind every storefront row (with a driveway to a side street), paved interiors of commercial blocks, customer lots beside strip businesses and civic anchors, apartment lots."],
  ["Residential & School", "HighSchool", D.College, 6, "farm", "Edge-of-town campus, touching town, ≥6 tiles from industry: school + bus lot on the street, a 2×2 student lot beside it, stadium behind."],
  ["Residential & School", "Track", D.College, 1, "farm", "Behind the high school on its campus (football field, cinder track, bleachers, chain-link)."],
  ["Residential & School", "School", D.Suburbs, 6, "farm", "Residential quarter (College/Suburbs/ResHigh), with playground and lot; ≥6 tiles from industry."],
  ["Residential & School", "Playground", D.Suburbs, 1, "farm", "Right beside the elementary school (linted); neighbourhood parks carry their own."],
  ["Residential & School", "Library", D.College, 4, "farm", "School quarter or downtown."],
  ["Residential & School", "Church", D.OldTown, 5, "farm", "Old Town / Suburbs / Downtown with churchyard + lot; ≥6 tiles from industry. Drawn correctly from every side (steeple, nave, entry)."],
  ["Residential & School", "Chapel", D.OldTown, 4, "farm", "Old Town. 2×2 white clapboard chapel: steep gable, steeple, round-headed windows."],
  ["Residential & School", "Cemetery", D.OldTown, 1, "farm", "4×3 at the edge of town on a road, never by water; gated, gravel drives, rows of headstones, cedars."],
  ["Residential & School", "Park", D.Suburbs, 1, "farm", "The square's lawn, one neighbourhood park per quarter on a corner lot facing streets, never on an interior scrap or an institution's frontage."],
  ["Residential & School", "BallField", D.College, 1, "farm", "Little-league diamond beside a school (linted)."],
  ["Industry & Countryside", "Factory", D.Industrial, 5, "farm", "Industrial quarter on the works side along the rail; ≥6 tiles from schools/churches."],
  ["Industry & Countryside", "Warehouse", D.Industrial, 4, "farm", "Industrial quarter by the rail and highway end, with its own truck lot."],
  ["Industry & Countryside", "GrainElevator", D.Industrial, 3, "farm", "On the rail siding (farm towns)."],
  ["Industry & Countryside", "Depot", D.Industrial, 3, "farm", "Beside the main line."],
  ["Industry & Countryside", "Substation", D.Industrial, 1, "farm", "Open ground at the edge of town beside a road, nearest the works; its transmission pole line runs out over open land."],
  ["Industry & Countryside", "Sawmill", D.Industrial, 3, "mountain", "Mountain towns: 2–3 on the rail and at woods edges, with log decks."],
  ["Industry & Countryside", "Cannery", D.Trailer, 3, "oceanside", "Oceanside: on the shore at the root of its own 5-tile working pier."],
  ["Industry & Countryside", "Lighthouse", D.Trailer, 1, "oceanside", "Oceanside: at the seaward end of a stone jetty 3+ tiles out into the sea (Cape Cod style); night beam sweeps."],
  ["Industry & Countryside", "Dock", D.Trailer, 1, "lakeside", "Two sizes: a small single pier and a big 2-wide marina with slips and boats, on lake and ocean shores."],
  ["Industry & Countryside", "Dam", D.Trailer, 1, "farm", "Concrete dam across the river: crest road bank to bank, spillway, a brick powerhouse on the bank with its access road."],
  ["Industry & Countryside", "Powerhouse", D.Trailer, 2, "farm", "Beside the dam on the riverbank, with a road lane out to the network."],
  ["Industry & Countryside", "Barn", D.Trailer, 2, "farm", "Farmsteads fronting section roads: house, barn(s), silo, windbreak; pasture beside the barn, fields behind."],
  ["Industry & Countryside", "Silo", D.Trailer, 2, "farm", "Farmsteads: a tall stave silo (1×2) beside the barn."],
  ["Industry & Countryside", "Greenhouse", D.Trailer, 2, "farm", "Farmsteads."],
  ["Industry & Countryside", "WaterTower", D.Suburbs, 1, "farm", "Suburbs (the town tank) and the landmark tank out in the country: a classic bowl-and-legs tower rising over the back of its 2×3 lot."],
  ["Landmarks", "Megachurch", D.Suburbs, 5, "farm", "Town edge: a 6×4 1980s Missouri-style megachurch (dome auditorium, glass atrium, spire) with a huge striped lot beside it that fills on Sunday morning; landmark on its centre tile (own it for Revelation)."],
  ["Landmarks", "Fairground", D.Suburbs, 2, "farm", "Town edge: county fairground compound fronting a street on its N or S side only; landmark on its centre tile."],
  ["Landmarks", "RadioTower", D.Trailer, 2, "farm", "Out in the country: a tall red/white AM mast (3×4) with guy wires and transmitter shack; its lane runs around the compound, never through it; landmark on its centre tile."],
];
const LMK = { Megachurch: Landmark.Megachurch, Fairground: Landmark.Fairground, RadioTower: Landmark.RadioTower };
for (const [group, name, district, pop, town, rule] of LOTS) {
  const lot = Lot[name], fp = footprintOf(lot);
  const fw = fp.w, fh = fp.h;
  const base = stampLot(lot, district, pop)(fw, fh);
  const place = LMK[name] ? (w, x0, y0) => { base(w, x0, y0); w.landmark[(y0 + (fh >> 1)) * N + x0 + (fw >> 1)] = LMK[name]; } : base;
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
  ["Trailers · fringe", D.Trailer, Biome.Temperate, "One trailer park on the fringe: a single gate off a road, a gravel loop lane, trailers on both sides."],
  ["Adobe · desert town", D.Suburbs, Biome.Desert, "Desert towns: every home is adobe/stucco (flat roofs, vigas, several variants); a third of the frontage stays vacant."],
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
  ["Woods", Terrain.Woods, [Biome.Temperate, Biome.Forest, Biome.Autumn], "Organic stands in open country; forest skirts on mountain slopes; never through planted fields. Seasonal canopy: summer greens, autumn reds/golds, bare snowy winter, spring blossom."],
  ["Rock (ridges & mesas)", Terrain.Rock, [Biome.Temperate, Biome.Desert], "Mountain: two ridge bands walling the valley (≥8% rock, ragged scree edge, slope-shaded relief); desert: 4–6 mesas plus a buttes range. Never on roads, rail, water, town or landmarks."],
  ["Lake / pond", Terrain.Lake, [Biome.Temperate, Biome.Desert], "Lakes drained to the river; lakeside town wraps its lake; 1-tile setback for farms and buildings."],
  ["Field", Terrain.Field, [Biome.Temperate], "Farm belt: 6×5 parcels behind farmsteads on the section roads; center-pivot circles on some farm/lakeside maps; never in woods (linted)."],
  ["Orchard", Terrain.Orchard, [Biome.Temperate], "Whole farm-belt parcels with a margin, never overlapping, with a lane to a road (linted)."],
  ["Pasture", Terrain.Pasture, [Biome.Temperate], "Every pasture adjoins its farmstead's barn (linted); grazing cows."],
  ["Dirt lane", Terrain.Dirt, [Biome.Temperate], "Section roads every 22 tiles out in the county; farm lanes to every field block; landmark and dock lanes; trailer-park loop; mid-block alleys."],
  ["Rail", Terrain.Rail, [Biome.Temperate], "Main line through town + siding into the works; a scheduled freight train runs it and flashes the crossing lights."],
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
    lakeside: "The lake overlaps the town's long side; roads it cuts are rejoined by bridges; sand beaches on the town shore; a marina and a small dock; farmland ≥3 tiles back from the water.",
    desert: "Wider, sparser blocks of adobe on sand with an irrigated core; 4–6 red mesas and a buttes range; zoned sand tones (dunes, caliche, red soil).",
    mountain: "Long, narrow valley town; two rock ridge bands with a graded forest skirt and ragged scree, slope-shaded; thin valley-floor farming; 2–3 sawmills.",
    oceanside: "A fishing town: continuous boardwalk and Shore Drive, a marina and fishing piers, the cannery on its own pier, a lighthouse at the end of a stone jetty; only a few truck farms.",
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
  MG.push({ id: "mg-residential", name: "Residential blocks (frontage grammar)", placement: "Perimeter blocks: every street-facing lot a house facing its street with driveway + curb cut; interiors are backyards, deep blocks get a mid-block alley; frontage gaps ≤12% (desert ≤50%) — linted.", images: [{ label: "In situ · farm 42 suburbs", file: save(crop("farm", r.x, r.y, 24, 14, { lod: 2 }), "resid") }] });
  const t = findCentre("farm", (w2, tt) => w2.lot[tt] === Lot.Track);
  MG.push({ id: "mg-campus", name: "High-school campus", placement: "Edge of town, touching town, ≤½ of its site taken from fringe yards, ≥6 tiles from industry. School 3×2 + bus lot 2×1 on the street; stadium 6×4 behind; lawn only inside the fence.", images: [{ label: "In situ · farm 42", file: save(crop("farm", t.x, t.y, 20, 12, { lod: 2 }), "campus") }, { label: "Same · winter", file: save(crop("farm", t.x, t.y, 20, 12, { lod: 2, season: "winter" }), "campus_w") }] });
  const g = findCentre("farm", (w2, tt) => w2.lot[tt] === Lot.GrainElevator);
  MG.push({ id: "mg-industry", name: "Industry & rail", placement: "Main line through town; siding into the works; industry within 2 tiles of the rail on the works side and at the highway end; 6-tile buffer from schools/churches (linted).", images: [{ label: "In situ · farm 42", file: save(crop("farm", g.x, g.y, 24, 12, { lod: 2 }), "industry") }] });
  const p = findCentre("farm", (w2, tt) => w2.lot[tt] === Lot.Parking && w2.district[tt] === D.Commercial);
  if (p) MG.push({ id: "mg-parking", name: "Parking plan", placement: "Rear lots behind storefront rows (with driveways), paved commercial-block interiors, customer lots on the strip, apartment lots, civic anchor lots. Farm 42: 139 parking tiles.", images: [{ label: "In situ · highway strip (farm 42)", file: save(crop("farm", p.x, p.y, 24, 12, { lod: 2 }), "parking_strip") }] });
  const f = findCentre("farm", (w2, tt) => w2.terrain[tt] === Terrain.Field);
  MG.push({ id: "mg-farms", name: "Farms & countryside", placement: "Section roads every 22 tiles; 12–16 farmsteads fronting them with fields behind and lanes to every block; pivots on some maps; a fringe ring spaces farms from town on some maps; farming thins on mountain and oceanside maps.", images: [{ label: "In situ · farm 42", file: save(crop("farm", f.x, f.y, 28, 16, { lod: 2 }), "farms") }] });
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
{
  // AGRICULTURE placement aspects (Stage 2b farm belt)
  const fs = findCentre("farm", (w2, tt) => w2.lot[tt] === Lot.Barn);
  const pv = findIn(["farm", "lakeside"], (w2, tt) => (w2.flags[tt] & 2) !== 0);
  const dp = findCentre("desert", (w2, tt) => (w2.flags[tt] & 2) !== 0);
  const mv = findCentre("mountain", (w2, tt) => w2.lot[tt] === Lot.Barn || w2.lot[tt] === Lot.Silo);
  const edge = findCentre("farm", (w2, tt) => w2.terrain[tt] === Terrain.Field && (w2.terrain[tt - 3] === Terrain.Woods || w2.terrain[tt + 3] === Terrain.Woods));
  const imgs = [];
  if (fs) imgs.push({ label: "Farmstead on its section road: house, barns, silo, windbreak, pasture, fields behind (farm 42)", file: save(crop("farm", fs.x, fs.y, 24, 14, { lod: 2 }), "ag_farmstead") });
  if (pv) imgs.push({ label: `Center-pivot circles on the section grid (${pv?.town} 42)`, file: save(crop(pv.town, pv.x, pv.y, 26, 16, { lod: 2 }), "ag_pivot_farm") });
  if (edge) imgs.push({ label: "Where farmland meets woods (farm 42)", file: save(crop("farm", edge.x, edge.y, 22, 12, { lod: 2 }), "ag_edge") });
  if (mv) imgs.push({ label: "Valley-floor farm (mountain 42)", file: save(crop("mountain", mv.x, mv.y, 22, 12, { lod: 2 }), "ag_mountain") });
  if (dp) imgs.push({ label: "Irrigated pivots by the river (desert 42)", file: save(crop("desert", dp.x, dp.y, 18, 12, { lod: 2 }), "ag_pivot") });
  MG.push({ id: "mg-agriculture", name: "Agriculture placement", placement: "The county the way it surrounded a 1980s town: a gravel section-road grid every 22 tiles; farmsteads front those roads (house, barn(s), tall silo, windbreak) with the pasture beside the barn and 6×5 fields and orchards behind, reached by farm lanes; center-pivot circles on some farm and lakeside maps; on some maps a fringe ring of acreages and woodlots spaces farmland from town. Never in woods (0% linted), set back from lakes. Farming thins on mountain and oceanside maps; desert irrigates by the river.", images: imgs });
}
{
  // WATERFRONT, DAM, TRAILER PARK, ALLEYS, CEMETERY, SUBSTATION (Stage 2b)
  const lh = findCentre("oceanside", (w2, tt) => w2.lot[tt] === Lot.Jetty);
  const cn = findCentre("oceanside", (w2, tt) => w2.lot[tt] === Lot.Cannery);
  const wet = (w2, k) => w2.lot[k] === Lot.Dock && w2.terrain[k] === Terrain.Lake;
  const mr = findCentre("lakeside", (w2, tt) => wet(w2, tt) && (wet(w2, tt - 1) || wet(w2, tt + 1)) && (wet(w2, tt - w2.width) || wet(w2, tt + w2.width)));
  const bch = findCentre("lakeside", (w2, tt) => w2.biome[tt] === Biome.Ocean && w2.terrain[tt] !== Terrain.Lake);
  const wf = [];
  if (lh) wf.push({ label: "Lighthouse jetty · day (oceanside 42)", file: save(crop("oceanside", lh.x, lh.y, 20, 12, { lod: 2 }), "wf_jetty") }, { label: "Same · night (beam)", file: save(crop("oceanside", lh.x, lh.y, 20, 12, { lod: 2, time: "night" }), "wf_jetty_n") });
  if (cn) wf.push({ label: "Cannery on its pier, boardwalk (oceanside 42)", file: save(crop("oceanside", cn.x, cn.y, 20, 12, { lod: 2 }), "wf_cannery") });
  if (mr) wf.push({ label: "Lake marina (2-wide pier with slips) + small dock (lakeside 42)", file: save(crop("lakeside", mr.x + 4, mr.y + 2, 24, 12, { lod: 2 }), "wf_marina") });
  if (bch) wf.push({ label: "Town beach (lakeside 42)", file: save(crop("lakeside", bch.x, bch.y, 20, 12, { lod: 2 }), "wf_beach") });
  MG.push({ id: "mg-waterfront", name: "Waterfront: boardwalk, piers, marina, jetty, beaches", placement: "Oceanside: continuous boardwalk and Shore Drive, up to 3 fishing piers (the first a 2-wide marina), the cannery at the root of its own pier, the lighthouse at the end of a stone jetty. Lakeside: sand beaches on the town shore, bridges where the lake cut a road, a marina and a small dock.", images: wf });
  const dm = findIn(["farm", "lakeside", "mountain", "desert"], (w2, tt) => w2.lot[tt] === Lot.Powerhouse);
  if (dm) MG.push({ id: "mg-dam", name: "Dam & powerhouse", placement: "A concrete dam across the river with a crest road bank to bank, a spillway, and a brick powerhouse on the bank with a road out to the network.", images: [{ label: "In situ · seed 42", file: save(crop(dm.town ?? "farm", dm.x, dm.y, 18, 12, { lod: 2 }), "dam") }] });
  const tp = findCentre("farm", (w2, tt) => (w2.flags[tt] & 4) !== 0);
  if (tp) MG.push({ id: "mg-trailerpark", name: "Trailer park", placement: "One park on the fringe: a single gate off a road, a gravel loop lane, trailers on both sides.", images: [{ label: "In situ · farm 42", file: save(crop("farm", tp.x, tp.y, 16, 10, { lod: 2 }), "trailerpark") }] });
  const al = findIn(["lakeside", "farm", "mountain", "oceanside"], (w2, tt) => w2.terrain[tt] === Terrain.Dirt && w2.district[tt - 1] !== 0 &&
    ((w2.terrain[tt - 1] === Terrain.Citizen && w2.terrain[tt + 1] === Terrain.Citizen) || (w2.terrain[tt - w2.width] === Terrain.Citizen && w2.terrain[tt + w2.width] === Terrain.Citizen)));
  if (al) MG.push({ id: "mg-alleys", name: "Mid-block alleys", placement: "Deep all-residential blocks (5×5+) get a gravel alley down the middle; the lots behind the houses become backyards and garages off it, so no block has an empty hole.", images: [{ label: `In situ · ${al.town} 42`, file: save(crop(al.town, al.x, al.y, 18, 10, { lod: 2 }), "alleys") }] });
  const ce = findCentre("farm", (w2, tt) => w2.lot[tt] === Lot.Cemetery);
  const ss = findCentre("farm", (w2, tt) => w2.lot[tt] === Lot.Substation);
  const pk = [];
  if (ce) pk.push({ label: "Cemetery at the town edge (farm 42)", file: save(crop("farm", ce.x, ce.y, 18, 10, { lod: 2 }), "edge_cemetery") });
  if (ss) pk.push({ label: "Substation at the town edge with its pole line (farm 42)", file: save(crop("farm", ss.x, ss.y, 20, 14, { lod: 2 }), "edge_substation") });
  MG.push({ id: "mg-edge", name: "Edge-of-town uses: cemetery, substation", placement: "The cemetery (4×3, gated) and the substation sit on open ground at the edge of town beside a road; the substation is nearest the works and its pole line runs out over fields.", images: pk });
}
for (const m of MG) items.push({ group: "Map Generation", footprint: "", scale: "", ...m });

writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ generated: "Stage 2b", items }, null, 1));
console.log(`\n${items.length} items → ${OUT}/manifest.json`);
