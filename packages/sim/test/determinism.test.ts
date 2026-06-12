/**
 * The determinism CI gate (§40): same seed + same intents => same StateHash.
 * If this ever fails, the lockstep contract is broken and every downstream
 * system is unsafe. Run with: npm test -w @flock/sim
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
  IntentType,
  Stance,
  type RawBalance,
  type Turn,
  type SimState,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(resolve(here, "../../../balance.json"), "utf8"),
) as RawBalance;
const balance = loadBalance(raw);

function freshSim(): SimState {
  const world = createWorld(16, 16);
  // Give one player a little owned, dissenting territory so decay loops run.
  for (let i = 0; i < 32; i++) {
    world.owner[i] = 1;
    world.state[i] = 1; // Believer
    world.dissent[i] = fromInt(40);
    world.susceptibility[i] = fromInt(50);
  }
  const s = createSim({
    seed: 0xdecafbad,
    balance,
    world,
    spawns: [
      { id: 1, archetype: "dawn" },
      { id: 2, archetype: "radiant" },
    ],
  });
  // Seed nonzero Heat so a CRUSADE stance change has an observable, lasting
  // effect (crusade decays Heat slower than the base rate) — gives the
  // divergence test something real to diverge on.
  s.players[0]!.heat = fromInt(50);
  return s;
}

function scriptedTurns(count: number): Turn[] {
  const turns: Turn[] = [];
  for (let n = 0; n < count; n++) {
    const intents =
      n === 5
        ? [{ t: IntentType.SET_STANCE, player: 1, stance: Stance.Crusade } as const]
        : [];
    turns.push({ n, intents: [...intents], seedSlice: (n * 2654435761) >>> 0 });
  }
  return turns;
}

function runToHash(turns: Turn[]): string {
  const s = freshSim();
  for (const turn of turns) step(s, turn, balance);
  return hashState(s);
}

test("same seed + same intents => identical StateHash", () => {
  const turns = scriptedTurns(120);
  const a = runToHash(turns);
  const b = runToHash(turns.map((t) => ({ ...t, intents: [...t.intents] })));
  assert.equal(a, b, "two identical runs must produce the same hash");
});

test("different intents => different StateHash", () => {
  const base = runToHash(scriptedTurns(120));
  const noStanceChange = scriptedTurns(120).map((t) => ({ ...t, intents: [] as Turn["intents"] }));
  const divergent = runToHash(noStanceChange);
  assert.notEqual(base, divergent, "a different intent stream should diverge");
});

test("economy advances deterministically (followers grow, bank fills)", () => {
  const s = freshSim();
  const before = { f: s.players[0]!.followers, usd: s.players[0]!.usd };
  for (const turn of scriptedTurns(50)) step(s, turn, balance);
  assert.ok(s.players[0]!.followers > before.f, "followers should grow under logistic model");
  assert.ok(s.players[0]!.usd > before.usd, "bank should fill from tithe");
  assert.equal(s.tick, 50);
});
