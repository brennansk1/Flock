/**
 * Headless gameplay/map screenshot tool. Runs a fully simulated bot match on
 * the real @flock/sim (same code the server and client run), renders frames
 * with the shared palette/pattern module, and writes PNGs — no browser needed.
 *
 * Usage: node tools/screenshots.mjs [outDir]
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import {
  loadBalance,
  createSim,
  generateWorld,
  step,
  seedRng,
  nextRange,
  nextU32,
  newPlayer,
  generateRecap,
  IntentType,
  NEUTRAL,
  Terrain,
  TileState,
  MatchStatus,
  toInt,
  hexToRgb,
  shade,
  territoryPixel,
  colorForPlayer,
  NEUTRAL_BY_DISTRICT,
  TERRAIN_COLORS,
  COLOR_APOSTATE,
  COLOR_APOSTATE_ALT,
  ENTITY_COLORS,
} from "../packages/sim/dist/index.js";

const OUT = process.argv[2] ?? "shots";
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- PNG writer

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
  // scanlines with filter byte 0
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
  console.log(`wrote ${path} (${width}×${height}, ${(png.length / 1024).toFixed(0)} KB)`);
}

// ---------------------------------------------------------------- renderer
// Mirrors the client's render.ts pixel logic via the shared palette module.

const PX = 4; // pixels per tile
const UP = 2; // final upscale

function renderFrame(sim) {
  const w = sim.world;
  const W = w.width * PX;
  const H = w.height * PX;
  const buf = Buffer.alloc(W * H * 4);
  const arch = new Map(sim.players.map((p) => [p.id, p.archetype]));

  const put = (gx, gy, rgb) => {
    const o = (gy * W + gx) * 4;
    buf[o] = rgb[0];
    buf[o + 1] = rgb[1];
    buf[o + 2] = rgb[2];
    buf[o + 3] = 255;
  };

  for (let ty = 0; ty < w.height; ty++) {
    for (let tx = 0; tx < w.width; tx++) {
      const t = ty * w.width + tx;
      for (let py = 0; py < PX; py++) {
        for (let px = 0; px < PX; px++) {
          const gx = tx * PX + px;
          const gy = ty * PX + py;
          put(gx, gy, pixel(sim, arch, t, gx, gy));
        }
      }
    }
  }

  // entities
  const sprite = (t, body, trim) => {
    const x = (t % w.width) * PX;
    const y = ((t / w.width) | 0) * PX;
    for (let py = 0; py < PX; py++)
      for (let px = 0; px < PX; px++) {
        const edge = px === 0 || py === 0 || px === PX - 1 || py === PX - 1;
        put(x + px, y + py, edge ? trim : body);
      }
  };
  const dot2 = (t, rgb) => {
    const x = (t % w.width) * PX + 1;
    const y = ((t / w.width) | 0) * PX + 1;
    put(x, y, rgb);
    put(x + 1, y, rgb);
    put(x, y + 1, rgb);
    put(x + 1, y + 1, rgb);
  };
  for (let t = 0; t < w.landmark.length; t++) {
    if (w.landmark[t] !== 0)
      sprite(t, hexToRgb(ENTITY_COLORS.landmark), hexToRgb(ENTITY_COLORS.landmarkTrim));
  }
  for (const bd of sim.buildings) {
    const body =
      bd.type === "satellite"
        ? hexToRgb(ENTITY_COLORS.satellite)
        : bd.disabledTicks > 0
          ? hexToRgb(ENTITY_COLORS.buildingDown)
          : bd.buildTicksLeft > 0
            ? hexToRgb(ENTITY_COLORS.buildingSite)
            : hexToRgb(ENTITY_COLORS.buildingBody);
    sprite(bd.tile, body, hexToRgb(ENTITY_COLORS.buildingTrim));
  }
  for (const c of sim.couriers) dot2(c.path[c.idx], hexToRgb(ENTITY_COLORS.courier));
  for (const v of sim.vans) dot2(v.tile, hexToRgb(ENTITY_COLORS.van));
  for (const py of sim.pylons) dot2(py.tile, hexToRgb(ENTITY_COLORS.pylon));
  for (const pk of sim.pickets) dot2(pk.tile, hexToRgb(ENTITY_COLORS.picket));

  // upscale
  const buf2 = Buffer.alloc(W * UP * H * UP * 4);
  for (let y = 0; y < H * UP; y++) {
    for (let x = 0; x < W * UP; x++) {
      const so = (((y / UP) | 0) * W + ((x / UP) | 0)) * 4;
      const dorig = (y * W * UP + x) * 4;
      buf2[dorig] = buf[so];
      buf2[dorig + 1] = buf[so + 1];
      buf2[dorig + 2] = buf[so + 2];
      buf2[dorig + 3] = 255;
    }
  }
  return { buf: buf2, width: W * UP, height: H * UP };
}

function pixel(sim, arch, t, gx, gy) {
  const w = sim.world;
  switch (w.terrain[t]) {
    case Terrain.Woods:
      return hexToRgb((gx + gy) % 5 === 0 ? TERRAIN_COLORS.woodsAlt : TERRAIN_COLORS.woods);
    case Terrain.Lake:
      return hexToRgb(gy % 6 === 0 ? TERRAIN_COLORS.lakeAlt : TERRAIN_COLORS.lake);
    case Terrain.Road: {
      const mid = gy % PX === PX / 2 || gx % PX === PX / 2;
      return hexToRgb(mid ? TERRAIN_COLORS.roadLine : TERRAIN_COLORS.road);
    }
  }
  if (w.state[t] === TileState.Apostate) {
    return hexToRgb((gx + gy) % 3 === 0 ? COLOR_APOSTATE_ALT : COLOR_APOSTATE);
  }
  const owner = w.owner[t];
  if (owner === NEUTRAL) {
    const base = hexToRgb(NEUTRAL_BY_DISTRICT[w.district[t] % NEUTRAL_BY_DISTRICT.length]);
    return (gx * 7 + gy * 13) % 11 === 0 ? shade(base, 0.95) : base;
  }
  const base = hexToRgb(colorForPlayer(owner));
  return owner >= 900 ? shade(base, 0.95) : territoryPixel(base, arch.get(owner) ?? "dawn", gx, gy);
}

// ---------------------------------------------------------------- bot match

const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));
const SEED = Number(process.env.SEED ?? 20260612);
const SIZE = 96;
const ARCHETYPES = ["dawn", "radiant", "circle", "visitors"];

const sim = createSim({
  seed: SEED,
  balance,
  world: generateWorld(SEED, SIZE, SIZE),
  spawns: [],
  timerTicks: 0,
  dominationPermille: 1000,
});

// pure-map shots first (two seeds)
writeFrame("map-seed-A", createSim({ seed: SEED, balance, world: generateWorld(SEED, SIZE, SIZE), spawns: [] }));
writeFrame("map-seed-B", createSim({ seed: 777, balance, world: generateWorld(777, SIZE, SIZE), spawns: [] }));

// 8 bots, ring spawns
const botRng = seedRng(SEED ^ 0xb07);
const bots = [];
for (let i = 0; i < 8; i++) {
  const id = i + 1;
  sim.players.push(newPlayer(id, ARCHETYPES[i % 4], balance));
  bots.push({ id, cadence: 25 + nextRange(botRng, 30) });
}
const pendingByTick = new Map();
const queue = (tick, intent) => {
  const arr = pendingByTick.get(tick) ?? [];
  arr.push(intent);
  pendingByTick.set(tick, arr);
};
for (let i = 0; i < bots.length; i++) {
  const angle = (i / 8) * Math.PI * 2;
  const r = Math.floor(SIZE * 0.33);
  const cx = (SIZE >> 1) + Math.round(Math.cos(angle) * r);
  const cy = (SIZE >> 1) + Math.round(Math.sin(angle) * r);
  // nudge to citizen tile
  let tile = cy * SIZE + cx;
  outer: for (let rad = 0; rad < SIZE; rad++) {
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
        if (sim.world.terrain[y * SIZE + x] === Terrain.Citizen) {
          tile = y * SIZE + x;
          break outer;
        }
      }
  }
  queue(0, { t: IntentType.SPAWN, player: bots[i].id, tile });
}

const turnRng = seedRng(SEED ^ 0x5eed);
function runBotBrains() {
  for (const bot of bots) {
    if ((sim.tick + bot.id * 7) % bot.cadence !== 0) continue;
    const p = sim.players.find((pl) => pl.id === bot.id);
    if (!p || !p.alive || !p.spawned) continue;
    const w = sim.world;
    let origin = -1;
    for (let i = 0; i < 30; i++) {
      const t = nextRange(botRng, w.owner.length);
      if (w.owner[t] === bot.id) {
        origin = t;
        break;
      }
    }
    if (origin < 0) continue;
    const dir = nextRange(botRng, 4);
    const dx = dir === 0 ? 3 : dir === 1 ? -3 : 0;
    const dy = dir === 2 ? 3 : dir === 3 ? -3 : 0;
    const cx = (origin % w.width) + dx;
    const cy = ((origin / w.width) | 0) + dy;
    const tiles = [];
    for (let oy = -2; oy <= 2; oy++)
      for (let ox = -2; ox <= 2; ox++) {
        const x = cx + ox, y = cy + oy;
        if (x >= 0 && y >= 0 && x < w.width && y < w.height) tiles.push(y * w.width + x);
      }
    if (nextRange(botRng, 12) === 0)
      queue(sim.tick, {
        t: IntentType.SET_STANCE,
        player: bot.id,
        stance: nextRange(botRng, 3) === 0 ? "crusade" : "spread",
      });
    queue(sim.tick, { t: IntentType.OPEN_FRONT, player: bot.id, tiles });
    if (toInt(p.usd) > 40_000 && nextRange(botRng, 6) === 0) {
      const builds = ["compound", "collection_plate", "watchtower"];
      queue(sim.tick, {
        t: IntentType.BUILD,
        player: bot.id,
        building: builds[nextRange(botRng, builds.length)],
        tile: origin,
      });
    }
    if (nextRange(botRng, 40) === 0)
      queue(sim.tick, { t: IntentType.RITUAL, player: bot.id, ritual: "sermon" });
    // drama: agents + the occasional pamphlet money allowing
    if (toInt(p.usd) > 20_000 && nextRange(botRng, 10) === 0) {
      const enemyTile = [...Array(30)].map(() => nextRange(botRng, w.owner.length)).find(
        (t) => w.owner[t] !== NEUTRAL && w.owner[t] !== bot.id,
      );
      if (enemyTile !== undefined)
        queue(sim.tick, {
          t: IntentType.AGENT_DISPATCH,
          player: bot.id,
          district: w.district[enemyTile],
          mission: nextRange(botRng, 3) === 0 ? "scandal" : "deprogram",
        });
    }
  }
}

function writeFrame(name, state) {
  const { buf, width, height } = renderFrame(state);
  writePNG(`${OUT}/${name}.png`, width, height, buf);
}

// scripted drama: bot 1 (dawn) declares prophecy mid-game once it's big
let prophecyTried = false;

const SHOT_AT = new Map([
  [10, "match-1-founding"],
  [1200, "match-2-early-2min"],
  [3600, "match-3-mid-6min"],
  [7200, "match-4-late-12min"],
]);

console.log("simulating a 12-minute, 8-cult bot match…");
const t0 = Date.now();
for (let n = 0; n <= 7200; n++) {
  runBotBrains();
  if (!prophecyTried && sim.tick > 3000) {
    const dawn = sim.players.find((p) => p.archetype === "dawn" && p.alive);
    if (dawn && dawn.ownedTiles > sim.populated / 10) {
      queue(sim.tick, { t: IntentType.SIGNATURE, player: dawn.id });
      prophecyTried = true;
    }
  }
  const intents = pendingByTick.get(sim.tick) ?? [];
  step(sim, { n: sim.tick, intents, seedSlice: nextU32(turnRng) }, balance);
  const shot = SHOT_AT.get(n);
  if (shot) writeFrame(shot, sim);
  if (sim.status === MatchStatus.Ended) {
    writeFrame("match-5-victory", sim);
    break;
  }
}
console.log(`simulated ${sim.tick} ticks in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const recap = generateRecap(sim);
console.log("RECAP:", JSON.stringify(recap, null, 1).slice(0, 1500));
writeFileSync(`${OUT}/recap.json`, JSON.stringify(recap, null, 2));
