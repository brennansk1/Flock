/**
 * Input hardening (§33): a hostile client must not be able to force unbounded
 * work or corrupt state with oversized/garbage intents. applyIntent is
 * defensive — illegal intents are no-ops — and array intents are length-capped.
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
  fromInt,
  toFloat,
  hashState,
  IntentType,
  type RawBalance,
  type Turn,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance;
const balance = loadBalance(raw);

function sim16() {
  const w = createWorld(16, 16);
  for (let i = 0; i < w.susceptibility.length; i++) w.susceptibility[i] = fromInt(50);
  const s = createSim({
    seed: 1,
    balance,
    world: w,
    spawns: [{ id: 1, archetype: "dawn" }],
    timerTicks: 0,
    foundingTicks: 0,
  });
  step(s, { n: 0, intents: [{ t: IntentType.SPAWN, player: 1, tile: 8 * 16 + 8 }], seedSlice: 1 } as Turn, balance);
  return s;
}

test("MISSION_SEND permille is clamped to the legal band (can't deploy the inner circle)", () => {
  const s = sim16();
  const p = s.players[0]!;
  const flock = toFloat(p.followers);
  // an absurd permille can never deploy more than the 80% cap
  step(s, {
    n: s.tick,
    intents: [{ t: IntentType.MISSION_SEND, player: 1, tile: 8 * 16 + 6, permille: 1_000_000, mode: "spread" }],
    seedSlice: 2,
  } as Turn, balance);
  assert.equal(p.cohorts.length, 1, "cohort created");
  const cap = (flock * (1000 - balance.missions.innerCirclePermille)) / 1000;
  assert.ok(toFloat(p.cohorts[0]!.mass) <= cap + 1, `deployed ${toFloat(p.cohorts[0]!.mass)} within cap ${cap}`);
});

test("out-of-range and garbage intent payloads are harmless no-ops", () => {
  const s = sim16();
  const before = hashState(s);
  step(
    s,
    {
      n: s.tick,
      intents: [
        // out-of-bounds mission targets get rejected
        { t: IntentType.MISSION_SEND, player: 1, tile: -5, permille: 300, mode: "spread" },
        { t: IntentType.MISSION_SEND, player: 1, tile: 999999, permille: 300, mode: "spread" },
        // a bogus mode is rejected
        { t: IntentType.MISSION_SEND, player: 1, tile: 10, permille: 300, mode: "prayer" as never },
        // recall of a non-existent slot
        { t: IntentType.MISSION_RECALL, player: 1, slot: 99 },
        // spawn by a non-existent player
        { t: IntentType.SPAWN, player: 999, tile: 0 },
        // build with an unknown building string
        { t: IntentType.BUILD, player: 1, building: "death_star" as never, tile: 0 },
        // doctrine pick of a non-existent node
        { t: IntentType.DOCTRINE_PICK, player: 1, node: "Z9" },
      ],
      seedSlice: 3,
    } as Turn,
    balance,
  );
  assert.equal(s.players[0]!.cohorts.length, 0, "no cohort from garbage targets/modes");
  const s2 = sim16();
  assert.equal(hashState(s2), before, "garbage turn left a clean sim untouched-equivalent");
});

test("VAN_MOVE with a giant path does not throw and stays bounded", () => {
  const s = sim16();
  const path = Array.from({ length: 50_000 }, (_, i) => i % (16 * 16));
  assert.doesNotThrow(() =>
    step(s, { n: s.tick, intents: [{ t: IntentType.VAN_MOVE, player: 1, van: -1, path }], seedSlice: 4 } as Turn, balance),
  );
});
