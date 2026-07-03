/**
 * Playtest-readiness campaign (§40/§41): headless simulations that answer,
 * with numbers, the questions a playtest would ask —
 *
 *   1. TIME OF PLAY   — match-duration distribution on live server settings
 *   2. BALANCE        — per-archetype winrate on rotating seats
 *   3. BOT CHALLENGE  — do higher tiers reliably beat lower tiers?
 *   4. SIZE PACING    — how map size (64/96/128) moves match length
 *
 * Mirrors matchWorker defaults: domination 720‰, 12-min timer (7200 ticks at
 * 10 TPS), founding 200. Usage: node tools/playtest_sim.mjs [matches=8]
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

const MATCHES = Number(process.argv[2] ?? 8);
const ARCHES = ["dawn", "radiant", "circle", "visitors"];
const TPS = 10;
const TIMER = 12 * 60 * TPS; // server default
const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));

function runMatch({ seed, world: WORLD, players, tiers, town = "farm" }) {
  const w = generateWorld(seed, WORLD, WORLD, { townType: town });
  const spawns = Array.from({ length: players }, (_, i) => ({
    id: i + 1,
    archetype: ARCHES[(i + seed) % ARCHES.length],
  }));
  const sim = createSim({ seed, balance, world: w, spawns, timerTicks: TIMER, foundingTicks: 1, dominationPermille: 720 });
  const rng = seedRng(seed ^ 0xb07);
  const bots = spawns.map((s, i) => ({
    playerId: s.id,
    tier: tiers[i % tiers.length],
    cadence: 6 + (i % 5),
    aggression: tiers[i % tiers.length] === "church" ? 2 : 1,
    grudge: 0,
  }));
  // ring spawns on populated-adjacent ground
  const cx = WORLD >> 1;
  const cy = WORLD >> 1;
  const r = (WORLD * 0.3) | 0;
  step(sim, {
    n: 0,
    seedSlice: 1,
    intents: spawns.map((s, i) => {
      const a = (i / players) * Math.PI * 2;
      const x = Math.max(1, Math.min(WORLD - 2, cx + Math.round(Math.cos(a) * r)));
      const y = Math.max(1, Math.min(WORLD - 2, cy + Math.round(Math.sin(a) * r)));
      return { t: IntentType.SPAWN, player: s.id, tile: y * WORLD + x };
    }),
  }, balance);
  for (let n = 1; n <= TIMER && sim.status === 0; n++) {
    const intents = [];
    for (const b of bots) if (botShouldAct(b, sim.tick)) intents.push(...botTurn(sim, b, rng));
    step(sim, { n, intents, seedSlice: (n * 2654435761) >>> 0 }, balance);
  }
  const standings = [...sim.players].filter((p) => p.spawned).sort((a, b) => b.ownedTiles - a.ownedTiles);
  const winner = sim.winner ? sim.players.find((p) => p.id === sim.winner) : standings[0];
  return {
    ticks: sim.tick,
    minutes: sim.tick / TPS / 60,
    decisive: !!sim.winner,
    winnerArch: winner?.archetype ?? "-",
    winnerTier: winner ? bots.find((b) => b.playerId === winner.id)?.tier : "-",
    standings: standings.map((p) => ({
      arch: p.archetype,
      tier: bots.find((b) => b.playerId === p.id)?.tier,
      tiles: p.ownedTiles,
    })),
  };
}

const pct = (n, d) => ((100 * n) / Math.max(1, d)).toFixed(0) + "%";

// ---- 1+2: classic config — duration + archetype balance --------------------
console.log(`\n== CLASSIC 96² · 4p · sect bots · ${MATCHES} matches ==`);
{
  const durations = [];
  const wins = Object.fromEntries(ARCHES.map((a) => [a, 0]));
  const seats = Object.fromEntries(ARCHES.map((a) => [a, 0]));
  let decisive = 0;
  for (let m = 0; m < MATCHES; m++) {
    const r = runMatch({ seed: 1000 + m * 977, world: 96, players: 4, tiers: ["sect"] });
    durations.push(r.minutes);
    if (r.decisive) decisive++;
    wins[r.winnerArch] = (wins[r.winnerArch] ?? 0) + 1;
    for (const s of r.standings) seats[s.arch] = (seats[s.arch] ?? 0) + 1;
    console.log(`  match ${m}: ${r.minutes.toFixed(1)} min · ${r.decisive ? "DOMINATION" : "timer"} · winner ${r.winnerArch}`);
  }
  durations.sort((a, b) => a - b);
  const mid = durations[Math.floor(durations.length / 2)];
  console.log(`  → median ${mid.toFixed(1)} min · min ${durations[0].toFixed(1)} · max ${durations[durations.length - 1].toFixed(1)} · decisive ${pct(decisive, MATCHES)}`);
  console.log(`  → winrates (seat-adjusted): ${ARCHES.map((a) => `${a} ${pct(wins[a] ?? 0, Math.max(1, seats[a] / 4) * 1)}`).join(" · ")}`);
}

// ---- 3: tier ladder — church > sect > drifter? ------------------------------
console.log(`\n== TIER LADDER 96² · 4p (church/sect/sect/drifter) · ${Math.max(4, MATCHES / 2)} matches ==`);
{
  const N = Math.max(4, Math.floor(MATCHES / 2));
  const placeByTier = { church: [], sect: [], drifter: [] };
  for (let m = 0; m < N; m++) {
    const r = runMatch({ seed: 5000 + m * 613, world: 96, players: 4, tiers: ["church", "sect", "sect", "drifter"] });
    r.standings.forEach((s, i) => placeByTier[s.tier]?.push(i + 1));
  }
  for (const t of ["church", "sect", "drifter"]) {
    const arr = placeByTier[t];
    const avg = arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
    console.log(`  ${t.padEnd(8)} avg placement ${avg.toFixed(2)}  (n=${arr.length})`);
  }
}

// ---- 4: size pacing ----------------------------------------------------------
console.log(`\n== SIZE PACING · 4p sect · 3 matches each ==`);
for (const size of [64, 96, 128]) {
  const ds = [];
  let dec = 0;
  for (let m = 0; m < 3; m++) {
    const r = runMatch({ seed: 9000 + m * 331 + size, world: size, players: 4, tiers: ["sect"] });
    ds.push(r.minutes);
    if (r.decisive) dec++;
  }
  console.log(`  ${size}²: ${ds.map((d) => d.toFixed(1)).join(" / ")} min · decisive ${dec}/3`);
}
console.log("");
