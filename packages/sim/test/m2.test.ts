/**
 * Founding phase (§18), Doctrinal victory (§18 Revelation), recap grammar
 * (§25/Appendix B), and replay-from-log determinism (§33/§40).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  loadBalance,
  createSim,
  createWorld,
  step,
  hashState,
  fromInt,
  toInt,
  IntentType,
  Landmark,
  MatchStatus,
  generateRecap,
  headlineFor,
  type RawBalance,
  type SimState,
  type Turn,
  type Intent,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance;
const balance = loadBalance(raw);

const turn = (n: number, intents: Intent[] = []): Turn => ({ n, intents, seedSlice: n * 7 });

function world16() {
  const w = createWorld(16, 16);
  for (let i = 0; i < w.susceptibility.length; i++) w.susceptibility[i] = fromInt(50);
  return w;
}

test("FOUNDING: the sim holds its breath until the window closes", () => {
  const s = createSim({
    seed: 1,
    balance,
    world: world16(),
    spawns: [{ id: 1, archetype: "dawn" }],
    foundingTicks: 50,
    timerTicks: 0,
    dominationPermille: 1000,
  });
  step(s, turn(0, [{ t: IntentType.SPAWN, player: 1, tile: 8 * 16 + 8 }]), balance);
  assert.ok(s.players[0]!.spawned, "spawn pick lands during founding");
  const usd0 = toInt(s.players[0]!.usd);
  for (let i = 0; i < 40; i++) step(s, turn(s.tick), balance);
  assert.equal(toInt(s.players[0]!.usd), usd0, "no economy during founding");
  for (let i = 0; i < 100; i++) step(s, turn(s.tick), balance);
  assert.ok(toInt(s.players[0]!.usd) > usd0, "economy starts when founding ends");
});

test("Doctrinal victory: Faith 100 held 90s + 20s Megachurch channel (Revelation)", () => {
  const w = world16();
  w.landmark[5] = Landmark.Megachurch;
  const s = createSim({
    seed: 2,
    balance,
    world: w,
    spawns: [
      { id: 1, archetype: "radiant" },
      { id: 2, archetype: "dawn" },
    ],
    revelationMode: true,
    timerTicks: 0,
    dominationPermille: 1000,
  });
  step(s, turn(0, [
    { t: IntentType.SPAWN, player: 1, tile: 2 * 16 + 4 }, // blob covers the megachurch
    { t: IntentType.SPAWN, player: 2, tile: 13 * 16 + 13 },
  ]), balance);
  assert.equal(s.world.owner[5], 1, "p1 holds the Megachurch");
  s.players[0]!.faith = fromInt(100);
  // hold 90s + channel 20s; megachurch trickle keeps faith pinned at 100
  for (let i = 0; i < 1150 && s.status !== MatchStatus.Ended; i++) {
    s.players[0]!.faith = fromInt(100); // pin against drift for the test
    step(s, turn(s.tick), balance);
  }
  assert.equal(s.status, MatchStatus.Ended, "doctrinal victory fires");
  assert.equal(s.winner, 1);
});

test("recap headlines follow the Appendix B priority order", () => {
  const s = createSim({
    seed: 3,
    balance,
    world: world16(),
    spawns: [
      { id: 1, archetype: "dawn" },
      { id: 2, archetype: "circle" },
    ],
    timerTicks: 0,
  });
  // a player with both a scandal AND a betrayal leads with the betrayal
  s.recap.scandals.push({ attacker: 1, victim: 2, tick: 100 });
  s.recap.betrayals.push({ traitor: 1, victim: 2, tick: 500 });
  const h = headlineFor(s, 1, false);
  assert.match(h, /Betrayed/, `betrayal outranks scandal, got: ${h}`);

  const h2 = headlineFor(s, 2, false); // nothing notable, has followers
  assert.match(h2, /souls\. One town\./, `default grammar, got: ${h2}`);

  const recap = generateRecap(s);
  assert.equal(recap.players.length, 0, "unspawned players stay off the card");
});

test("replay from a recorded turn log reproduces the exact final hash (§40)", () => {
  const make = () =>
    createSim({
      seed: 44,
      balance,
      world: world16(),
      spawns: [
        { id: 1, archetype: "dawn" },
        { id: 2, archetype: "visitors" },
      ],
      timerTicks: 0,
      dominationPermille: 1000,
    });

  // record a live match's turn log
  const live = make();
  const log: Turn[] = [];
  const scripted = new Map<number, Intent[]>([
    [0, [
      { t: IntentType.SPAWN, player: 1, tile: 4 * 16 + 4 },
      { t: IntentType.SPAWN, player: 2, tile: 11 * 16 + 11 },
    ]],
    [10, [{ t: IntentType.SET_STANCE, player: 1, stance: "crusade" }]],
    [20, [{ t: IntentType.MISSION_SEND, player: 1, tile: 7 * 16 + 7, permille: 500, mode: "crusade" }]],
  ]);
  for (let n = 0; n < 300; n++) {
    const tn: Turn = { n, intents: scripted.get(n) ?? [], seedSlice: (n * 2654435761) >>> 0 };
    log.push(tn);
    step(live, tn, balance);
  }
  const liveHash = hashState(live);

  // replay the log cold — the §34 Recap Renderer / replay audit path
  const replayed = make();
  for (const tn of JSON.parse(JSON.stringify(log)) as Turn[]) step(replayed, tn, balance);
  assert.equal(hashState(replayed), liveHash, "replay must be bit-identical");
});
