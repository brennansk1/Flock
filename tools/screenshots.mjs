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
  renderTown,
  IntentType,
  NEUTRAL,
  Terrain,
  MatchStatus,
  toInt,
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
// The shared town renderer (same pixels as the PixiJS client).

const UP = 1; // townRender draws at 8px/tile already (96 tiles → 768px)

function renderFrame(sim) {
  const { data, width, height } = renderTown(sim, { frameTick: sim.tick });
  return { buf: Buffer.from(data.buffer, data.byteOffset, data.byteLength), width, height };
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
