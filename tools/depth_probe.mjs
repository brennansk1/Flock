/**
 * Strategic Depth probe (Prime Directive 2 / BUILD_TREE Depth Review).
 *
 * botleague.mjs answers "is any archetype over-winning". It cannot answer the
 * question the Depth Review actually asks: **for how much of a match do the
 * player's decisions still matter?** A match whose winner is settled 30% in has
 * no depth in the remaining 70%, however many systems are layered on top.
 *
 * So this samples ownership over time and reports:
 *
 *   decidedAt        fraction of the match elapsed when the eventual winner
 *                    takes a lead they never lose again. LOW = shallow back half.
 *   leadChanges2H    lead changes in the second half. ZERO = no counterplay.
 *   comebackRate     share of matches where the leader at the halfway point
 *                    did NOT win. ZERO = the midpoint leader always wins.
 *   finalLeadShare   winner's tiles / all owned tiles at the end. HIGH = runaway.
 *   contestedSpan    fraction of samples where the top two are within 15% of
 *                    each other — how much of the match feels like a race.
 *
 * Usage: node tools/depth_probe.mjs [matches=20] [players=4] [world=96]
 * Env:   SEED, TIER (drifter|sect|church), MAXTICKS
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
  TileState,
  NEUTRAL,
  dominationPermilleFor,
} from "../packages/sim/dist/index.js";

/**
 * The winner's converted-soul share of the whole town — the quantity the
 * domination threshold is actually compared against (sim.ts checkVictory
 * measures SOULS, not acreage). Reported so the threshold can be set against
 * measured reality instead of guessed.
 */
function popShare(sim, playerId) {
  const w = sim.world;
  let mine = 0;
  for (let t = 0; t < w.owner.length; t++) {
    if (w.owner[t] === playerId && w.state[t] === TileState.Believer) mine += w.pop[t];
  }
  return sim.totalPop > 0 ? mine / sim.totalPop : 0;
}

const MATCHES = Number(process.argv[2] ?? 20);
const PLAYERS = Number(process.argv[3] ?? 4);
const WORLD = Number(process.argv[4] ?? 96);
const BASE_SEED = Number(process.env.SEED ?? 1);
const TIER = process.env.TIER ?? "sect";
const MAX_TICKS = Number(process.env.MAXTICKS ?? 7200); // 12 min at 10Hz
const SAMPLE_EVERY = 50; // ticks (5s) — fine enough to catch real lead changes
const ARCHES = ["dawn", "radiant", "circle", "visitors"];

const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const rows = [];

for (let m = 0; m < MATCHES; m++) {
  const seed = (BASE_SEED + m * 2654435761) >>> 0;
  const world = generateWorld(seed, WORLD, WORLD);
  const spawns = Array.from({ length: PLAYERS }, (_, i) => ({
    id: i + 1,
    archetype: ARCHES[(i + m) % ARCHES.length],
  }));
  const sim = createSim({
    seed,
    balance,
    world,
    spawns,
    timerTicks: MAX_TICKS,
    foundingTicks: 1,
    // read the shipped knob, so the probe measures the config players get
    dominationPermille: dominationPermilleFor(balance, WORLD, WORLD),
  });
  const rng = seedRng(seed ^ 0xb07);
  const bots = spawns.map((s, i) => ({
    playerId: s.id,
    tier: TIER,
    cadence: 6 + (i % 5),
    aggression: TIER === "church" ? 2 : 1,
    grudge: 0,
  }));

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

  /** @type {{tick:number, leader:number, tiles:number[]}[]} */
  const samples = [];
  let n = 1;
  for (; n < MAX_TICKS && sim.status === 0; n++) {
    const intents = [];
    for (const b of bots) if (botShouldAct(b, sim.tick)) intents.push(...botTurn(sim, b, rng));
    step(sim, { n, intents, seedSlice: (n * 2654435761) >>> 0 }, balance);
    if (n % SAMPLE_EVERY === 0) {
      const tiles = spawns.map((s) => sim.players.find((p) => p.id === s.id)?.ownedTiles ?? 0);
      let leader = -1;
      let best = -1;
      tiles.forEach((t, i) => {
        if (t > best) {
          best = t;
          leader = i;
        }
      });
      samples.push({ tick: n, leader: best > 0 ? leader : -1, tiles });
    }
  }
  if (samples.length < 4) continue; // too short to say anything about shape

  const standings = [...sim.players].filter((p) => p.spawned).sort((a, b) => b.ownedTiles - a.ownedTiles);
  const winnerPlayer = sim.winner ? sim.players.find((p) => p.id === sim.winner) : standings[0];
  if (!winnerPlayer) continue;
  const winIdx = spawns.findIndex((s) => s.id === winnerPlayer.id);

  // decidedAt: the last sample where someone OTHER than the winner led; after
  // that the winner never surrenders the lead again.
  let lastNonWinnerLead = -1;
  samples.forEach((s, i) => {
    if (s.leader !== winIdx && s.leader !== -1) lastNonWinnerLead = i;
  });
  const decidedAt = (lastNonWinnerLead + 1) / samples.length;

  // lead changes in the second half
  const half = samples.length >> 1;
  let leadChanges2H = 0;
  for (let i = half + 1; i < samples.length; i++) {
    if (samples[i].leader !== samples[i - 1].leader) leadChanges2H++;
  }

  const midLeader = samples[half]?.leader ?? -1;
  const comeback = midLeader !== -1 && midLeader !== winIdx;

  const totalOwned = standings.reduce((a, p) => a + p.ownedTiles, 0);
  const finalLeadShare = totalOwned ? winnerPlayer.ownedTiles / totalOwned : 0;

  // contested: top two within 15% of each other
  let contested = 0;
  for (const s of samples) {
    const sorted = [...s.tiles].sort((a, b) => b - a);
    if (sorted[0] > 0 && sorted[1] / sorted[0] >= 0.85) contested++;
  }

  rows.push({
    decidedAt,
    leadChanges2H,
    comeback,
    finalLeadShare,
    winnerPopShare: popShare(sim, winnerPlayer.id),
    contestedSpan: contested / samples.length,
    ticks: n,
    decisive: !!sim.winner,
  });
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log(`\nFLOCK depth probe — ${rows.length}/${MATCHES} matches, ${PLAYERS}p, ${WORLD}², tier=${TIER}`);
console.log(`median match length      ${(median(rows.map((r) => r.ticks)) / 600).toFixed(1)} min`);
console.log(`decisive (domination)    ${pct(mean(rows.map((r) => (r.decisive ? 1 : 0))))}`);
console.log("");
console.log(`decidedAt (median)       ${pct(median(rows.map((r) => r.decidedAt)))}   <- match settled this far in`);
console.log(`lead changes, 2nd half   ${mean(rows.map((r) => r.leadChanges2H)).toFixed(2)}   <- 0 means no counterplay`);
console.log(`comeback rate            ${pct(mean(rows.map((r) => (r.comeback ? 1 : 0))))}   <- midpoint leader lost`);
console.log(`final lead share         ${pct(mean(rows.map((r) => r.finalLeadShare)))}   <- winner's slice of owned land`);
console.log(`contested span           ${pct(mean(rows.map((r) => r.contestedSpan)))}   <- match felt like a race`);
const ps = rows.map((r) => r.winnerPopShare);
console.log(
  `winner soul share        mean ${pct(mean(ps))}  best ${pct(Math.max(...ps))}   <- what domination is compared against`,
);

// Depth Review verdict thresholds. These are the axis gates, stated up front so
// the number is judged against a bar rather than eyeballed.
const dA = median(rows.map((r) => r.decidedAt));
const cb = mean(rows.map((r) => (r.comeback ? 1 : 0)));
const lc = mean(rows.map((r) => r.leadChanges2H));
console.log("\nverdict");
console.log(`  anti-degenerate  ${dA >= 0.6 ? "PASS" : "FAIL"}  (decidedAt >= 60% of match)`);
console.log(`  counterplay      ${lc >= 0.5 ? "PASS" : "FAIL"}  (>= 0.5 lead changes in 2H)`);
console.log(`  comeback arc     ${cb >= 0.15 ? "PASS" : "FAIL"}  (>= 15% midpoint-leader upsets)`);
