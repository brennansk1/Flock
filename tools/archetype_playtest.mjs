/**
 * Archetype playtest campaign (Prime Directive 1: PLAYABILITY) — the first
 * matches ever run on §2A archetype worlds. Answers, with numbers:
 *
 *   1. FOUNDING     — do all players get on the board? (the sea/forest eats
 *                     the spawn ring; production spiral must recover)
 *   2. COMPLETION   — do matches end (domination or timer), no stalls?
 *   3. PACING       — does the archetype move match length / decisiveness?
 *   4. SPREAD       — territory spread at end (dominant-strategy smell test)
 *
 * Founding mirrors the PRODUCTION path: spawnTileFor from matchWorker.ts
 * (ring anchor → spiral to unclaimed grass with citizens within 9 tiles).
 *
 * Usage: node tools/archetype_playtest.mjs [matchesPerType=6]
 */

import { readFileSync } from "node:fs";
import {
  loadBalance,
  createSim,
  generateWorld,
  step,
  seedRng,
  botTurn,
  botShouldAct,
  IntentType,
  Terrain,
} from "../packages/sim/dist/index.js";

const N = Number(process.argv[2] ?? 6);
const TYPES = ["farm", "oceanside", "mountain", "lakeside", "desert"];
const ARCHES = ["dawn", "radiant", "circle", "visitors"];
const TPS = 10;
const TIMER = 12 * 60 * TPS;
const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));

// ---- production founding placement (mirrors matchWorker.spawnTileFor) ------
function spawnTileFor(w, index) {
  const positions = 8;
  const angle = (index % positions) * ((2 * Math.PI) / positions);
  const r = Math.floor(Math.min(w.width, w.height) * 0.33);
  const cx = w.width >> 1;
  const cy = w.height >> 1;
  const x0 = Math.min(w.width - 1, Math.max(0, cx + Math.round(Math.cos(angle) * r)));
  const y0 = Math.min(w.height - 1, Math.max(0, cy + Math.round(Math.sin(angle) * r)));
  const citizenNear = (t, reach) => {
    const tx = t % w.width;
    const ty = (t / w.width) | 0;
    for (let dy = -reach; dy <= reach; dy++) {
      const y = ty + dy;
      if (y < 0 || y >= w.height) continue;
      for (let dx = -reach; dx <= reach; dx++) {
        const x = tx + dx;
        if (x < 0 || x >= w.width) continue;
        if (w.terrain[y * w.width + x] === Terrain.Citizen) return true;
      }
    }
    return false;
  };
  for (let radius = 0; radius < Math.max(w.width, w.height); radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 2 || y < 2 || x >= w.width - 2 || y >= w.height - 2) continue;
        const t = y * w.width + x;
        if (w.terrain[t] === Terrain.Grass && w.property[t] === 0 && citizenNear(t, 9)) return t;
      }
    }
  }
  return y0 * w.width + x0;
}

function runMatch(townType, seed) {
  const world = generateWorld(seed, 96, 96, { townType });
  const spawns = ARCHES.map((archetype, i) => ({ id: i + 1, archetype }));
  const sim = createSim({
    seed, balance, world, spawns,
    timerTicks: TIMER, foundingTicks: 1, dominationPermille: 720,
  });
  const rng = seedRng(seed ^ 0xa2c);
  const bots = spawns.map((s, i) => ({
    playerId: s.id, tier: "sect", cadence: 6 + (i % 5), aggression: 1, grudge: 0,
  }));
  step(sim, {
    n: 0, seedSlice: 1,
    intents: spawns.map((s, i) => ({ t: IntentType.SPAWN, player: s.id, tile: spawnTileFor(world, i) })),
  }, balance);
  const spawnedAfterFounding = [...sim.players].filter((p) => p.spawned).length;
  for (let n = 1; n <= TIMER && sim.status === 0; n++) {
    const intents = [];
    for (const b of bots) if (botShouldAct(b, sim.tick)) intents.push(...botTurn(sim, b, rng, balance));
    step(sim, { n, intents, seedSlice: (n * 2654435761) >>> 0 }, balance);
  }
  const standings = [...sim.players].filter((p) => p.spawned).sort((a, b) => b.ownedTiles - a.ownedTiles);
  const total = standings.reduce((a, p) => a + p.ownedTiles, 0);
  return {
    seed,
    spawned: spawnedAfterFounding,
    minutes: +(sim.tick / TPS / 60).toFixed(1),
    // a winner declared BEFORE the timer is a domination; at the timer it's
    // a points win (sim.winner is set on both paths — don't conflate them)
    decisive: !!sim.winner && sim.tick < TIMER,
    winner: standings[0]?.archetype ?? "-",
    leadShare: total ? +(standings[0].ownedTiles / total).toFixed(2) : 0,
    tilesTotal: total,
  };
}

const summary = [];
for (const townType of TYPES) {
  console.log(`\n== ${townType.toUpperCase()} · 4p sect bots · ${N} matches ==`);
  const rows = [];
  for (let m = 0; m < N; m++) {
    const r = runMatch(townType, 5000 + m * 977);
    rows.push(r);
    console.log(
      `  seed ${r.seed}: spawned ${r.spawned}/4 · ${r.minutes} min · ` +
      `${r.decisive ? "DOMINATION" : "timer-win"} · winner ${r.winner} · lead share ${r.leadShare}`,
    );
  }
  const med = (k) => rows.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
  summary.push({
    townType,
    foundingOK: rows.every((r) => r.spawned === 4),
    medianMin: med("minutes"),
    decisivePct: Math.round((100 * rows.filter((r) => r.decisive).length) / rows.length),
    medianLeadShare: med("leadShare"),
    medianTiles: med("tilesTotal"),
  });
}
console.log("\n==== CAMPAIGN SUMMARY ====");
console.table(summary);
