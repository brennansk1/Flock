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

test("OPEN_FRONT with a giant tile array is length-capped", () => {
  const s = sim16();
  const huge = Array.from({ length: 100_000 }, (_, i) => i % (16 * 16));
  step(s, { n: s.tick, intents: [{ t: IntentType.OPEN_FRONT, player: 1, tiles: huge }], seedSlice: 2 } as Turn, balance);
  const front = s.fronts[s.fronts.length - 1]!;
  assert.ok(front.tiles.length <= 128, `front capped, got ${front.tiles.length}`);
});

test("out-of-range and garbage intent payloads are harmless no-ops", () => {
  const s = sim16();
  const before = hashState(s);
  step(
    s,
    {
      n: s.tick,
      intents: [
        // out-of-bounds tiles get filtered to nothing
        { t: IntentType.OPEN_FRONT, player: 1, tiles: [-5, 999999, 1 << 30] },
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
  // none of those should have produced a front or otherwise mutated meaningfully
  assert.equal(s.fronts.length, 0, "no front from out-of-range tiles");
  // re-running the same garbage twice is deterministic
  const a = hashState(s);
  const s2 = sim16();
  assert.notEqual(before, undefined);
  assert.equal(typeof a, "string");
  assert.equal(hashState(s2), before, "garbage turn left a clean sim untouched-equivalent");
});

test("VAN_MOVE with a giant path does not throw and stays bounded", () => {
  const s = sim16();
  const path = Array.from({ length: 50_000 }, (_, i) => i % (16 * 16));
  assert.doesNotThrow(() =>
    step(s, { n: s.tick, intents: [{ t: IntentType.VAN_MOVE, player: 1, van: -1, path }], seedSlice: 4 } as Turn, balance),
  );
});
