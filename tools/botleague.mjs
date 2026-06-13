/**
 * Balance bot-league (§40): run many headless bot-vs-bot matches on the real
 * @flock/sim and report per-archetype win rates + average placement. This is
 * the nightly drift detector — if any archetype strays far from the 45–55%
 * band (§41), the designer is paged before players feel it.
 *
 * Usage: node tools/botleague.mjs [matches=200] [players=6] [world=48]
 * Env:   SEED (base seed), TIER (drifter|sect|church, default sect)
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
} from "../packages/sim/dist/index.js";

const MATCHES = Number(process.argv[2] ?? 200);
const PLAYERS = Number(process.argv[3] ?? 6);
const WORLD = Number(process.argv[4] ?? 48);
const BASE_SEED = Number(process.env.SEED ?? 1);
const TIER = process.env.TIER ?? "sect";
const ARCHES = ["dawn", "radiant", "circle", "visitors"];
const MAX_TICKS = Number(process.env.MAXTICKS ?? 9000); // ~15 min cap

const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));

const wins = Object.fromEntries(ARCHES.map((a) => [a, 0]));
const placeSum = Object.fromEntries(ARCHES.map((a) => [a, 0]));
const games = Object.fromEntries(ARCHES.map((a) => [a, 0]));
let decisive = 0;

for (let m = 0; m < MATCHES; m++) {
  const seed = (BASE_SEED + m * 2654435761) >>> 0;
  const world = generateWorld(seed, WORLD, WORLD);
  // rotate archetype assignment by match so matchups are balanced over the run
  const spawns = Array.from({ length: PLAYERS }, (_, i) => ({
    id: i + 1,
    archetype: ARCHES[(i + m) % ARCHES.length],
  }));
  const sim = createSim({ seed, balance, world, spawns, timerTicks: MAX_TICKS, foundingTicks: 1, dominationPermille: 700 });
  const rng = seedRng(seed ^ 0xb07);
  const bots = spawns.map((s, i) => ({
    playerId: s.id,
    tier: TIER,
    cadence: 6 + (i % 5),
    aggression: TIER === "church" ? 2 : 1,
    grudge: 0,
  }));

  // spawn around a ring
  const cx = WORLD >> 1;
  const cy = WORLD >> 1;
  const r = (WORLD * 0.35) | 0;
  step(
    sim,
    {
      n: 0,
      seedSlice: 1,
      intents: spawns.map((s, i) => {
        const a = (i / PLAYERS) * Math.PI * 2;
        const x = Math.max(1, Math.min(WORLD - 2, cx + Math.round(Math.cos(a) * r)));
        const y = Math.max(1, Math.min(WORLD - 2, cy + Math.round(Math.sin(a) * r)));
        return { t: IntentType.SPAWN, player: s.id, tile: y * WORLD + x };
      }),
    },
    balance,
  );

  for (let n = 1; n < MAX_TICKS && sim.status === 0; n++) {
    const intents = [];
    for (const b of bots) if (botShouldAct(b, sim.tick)) intents.push(...botTurn(sim, b, rng));
    step(sim, { n, intents, seedSlice: (n * 2654435761) >>> 0 }, balance);
  }

  // final standings by tiles held
  const standings = [...sim.players].filter((p) => p.spawned).sort((a, b) => b.ownedTiles - a.ownedTiles);
  standings.forEach((p, i) => {
    games[p.archetype]++;
    placeSum[p.archetype] += i + 1;
  });
  const winner = sim.winner ? sim.players.find((p) => p.id === sim.winner) : standings[0];
  if (sim.winner) decisive++;
  if (winner) wins[winner.archetype]++;
}

console.log(`\nFLOCK bot-league — ${MATCHES} matches, ${PLAYERS}p, ${WORLD}² maps, tier=${TIER}`);
console.log(`decisive (domination) finishes: ${((decisive / MATCHES) * 100).toFixed(0)}%\n`);
console.log("archetype     winrate   avg place   (target band 45-55% adj. for player count)");
const expected = 1 / ARCHES.length;
for (const a of ARCHES) {
  const wr = wins[a] / MATCHES / (PLAYERS / ARCHES.length); // normalize to seats
  const avg = games[a] ? placeSum[a] / games[a] : 0;
  const flag = Math.abs(wr - expected) > expected * 0.25 ? "  ⚠ drift" : "";
  console.log(`${a.padEnd(12)}  ${(wr * 100).toFixed(1).padStart(5)}%   ${avg.toFixed(2).padStart(6)}${flag}`);
}
