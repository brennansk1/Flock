/**
 * Match story: play one headless 4-cult bot match on a real 96² town and
 * print its storyline — lead changes, Ascension countdowns (started / broken /
 * reset by Expose), Exposes, Prophecies, CPA crackdowns and the finish.
 * For design review, recap tuning and spectator-beat analysis.
 *
 * Usage: node tools/match_story.mjs [seed=11] [town=farm] [--json]
 */
import { readFileSync } from "node:fs";
import {
  loadBalance, createSim, generateWorld, step, seedRng, botTurn, botShouldAct,
  IntentType, MatchStatus, getArchetype,
} from "../packages/sim/dist/index.js";

const SEED = Number(process.argv[2] ?? 11);
const TOWN = process.argv[3] ?? "farm";
const JSON_OUT = process.argv.includes("--json");
const SIZE = 96;
const TIMER = 12 * 60 * 10;
const ARCHES = ["dawn", "radiant", "circle", "visitors"];

const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));
const world = generateWorld(SEED, SIZE, SIZE, { townType: TOWN });
const spawns = ARCHES.map((a, i) => ({ id: i + 1, archetype: ARCHES[(i + SEED) % 4] }));
const sim = createSim({ seed: SEED, balance, world, spawns, timerTicks: TIMER, foundingTicks: 1 });
const rng = seedRng(SEED ^ 0xb07);
const bots = spawns.map((s, i) => ({ playerId: s.id, tier: "church", cadence: 6 + (i % 5), aggression: 1 + (i % 2), grudge: 0 }));

// spawn on a ring of open country around the centre
const c = SIZE >> 1, r = (SIZE * 0.36) | 0;
const ring = [[r, 0], [0, r], [-r, 0], [0, -r]];
step(sim, { n: 0, seedSlice: 1, intents: spawns.map((s, i) => ({ t: IntentType.SPAWN, player: s.id, tile: (c + ring[i][1]) * SIZE + (c + ring[i][0]) })) }, balance);

const name = (id) => {
  const p = sim.players.find((x) => x.id === id);
  return p ? getArchetype(p.archetype).theme.name : `Splinter #${id}`;
};
const clock = (t) => `${Math.floor(t / 600)}:${String(Math.floor((t % 600) / 10)).padStart(2, "0")}`;
const events = [];
const say = (kind, text) => events.push({ t: sim.tick, kind, text });

let leader = 0;
const asc = new Map(); // pid → path
let scandalIdx = 0, prophIdx = 0, pickets = 0;

for (let n = 1; n <= TIMER + 5 && sim.status === MatchStatus.Live; n++) {
  const intents = [];
  for (const b of bots) if (botShouldAct(b, sim.tick)) intents.push(...botTurn(sim, b, rng, balance));
  step(sim, { n, intents, seedSlice: (n * 2654435761) >>> 0 }, balance);

  for (const p of sim.players) {
    const prev = asc.get(p.id) ?? "";
    if (p.ascendPath !== prev) {
      if (p.ascendPath && !prev) say("ascend", `${name(p.id)} begins ASCENDING via ${p.ascendPath.toUpperCase()} (45s on the clock)`);
      else if (!p.ascendPath && prev) say("break", `${name(p.id)}'s ${prev.toUpperCase()} countdown collapses — the town fights back`);
      else say("ascend", `${name(p.id)} switches its Ascension to ${p.ascendPath.toUpperCase()}`);
      asc.set(p.id, p.ascendPath);
    }
  }
  while (scandalIdx < sim.recap.scandals.length) {
    const e = sim.recap.scandals[scandalIdx++];
    const v = sim.players.find((x) => x.id === e.victim);
    say("expose", `${name(e.attacker)} EXPOSES ${name(e.victim)} — ${e.followersLost ?? "?"} followers walk${v?.ascendPath ? ", Ascension clock reset" : ""}`);
  }
  while (prophIdx < sim.recap.prophecies.length) {
    const e = sim.recap.prophecies[prophIdx++];
    say("prophecy", `${name(e.player ?? e.id)} prophecy ${e.fulfilled ? "FULFILLED — the Rapture takes the border" : "FAILS — the faithful scatter"}`);
  }
  if (sim.pickets.length > pickets) say("cpa", `CPA pickets ${name(sim.pickets[sim.pickets.length - 1].target)} — Heat has consequences`);
  pickets = sim.pickets.length;

  if (n % 50 === 0) {
    const top = [...sim.players].filter((p) => p.alive).sort((a, b) => b.soulsPermille - a.soulsPermille)[0];
    if (top && top.id !== leader && top.soulsPermille >= 50) {
      say("lead", `${name(top.id)} takes the lead (${(top.soulsPermille / 10).toFixed(0)}% of the town)`);
      leader = top.id;
    }
  }
}
const w = sim.players.find((p) => p.id === sim.winner);
say("end", w ? `WINNER: ${name(w.id)} by ${(sim.winPath || "timer").toUpperCase()} at ${clock(sim.tick)}` : "No winner");
const standings = [...sim.players].sort((a, b) => b.soulsPermille - a.soulsPermille)
  .map((p) => `${name(p.id)} ${(p.soulsPermille / 10).toFixed(0)}% souls, Heat ${Math.round(p.heat / 65536)}`);

if (JSON_OUT) console.log(JSON.stringify({ seed: SEED, town: TOWN, events: events.map((e) => ({ ...e, clock: clock(e.t) })), standings }, null, 1));
else {
  console.log(`FLOCK match story — seed ${SEED}, ${TOWN} town, 96², 4 church bots`);
  for (const e of events) console.log(`  ${clock(e.t).padStart(5)}  ${e.text}`);
  console.log("  final: " + standings.join(" · "));
}
