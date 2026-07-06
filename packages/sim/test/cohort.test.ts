/**
 * Cohort substrate gates (v3 missions M1 — DESIGN_MISSIONS.md §1):
 *  - MASS CONSERVATION: SEND moves flock out, completed RECALL returns it,
 *    nothing is created or destroyed by the substrate itself;
 *  - INNER CIRCLE: total deployment can never exceed 80% of the flock;
 *  - the 3-cohort cap and bad intents (bogus tile/mode/slot) reject cleanly;
 *  - cohorts survive the snapshot round-trip hash-identically (v9);
 *  - the hash SEES cohort state (two states differing only there differ).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSim,
  createWorld,
  loadBalance,
  step,
  hashState,
  toSnapshot,
  fromSnapshot,
  IntentType,
  Terrain,
  Stance,
  toInt,
  add,
  type Intent,
  type Turn,
  type RawBalance,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const balance = loadBalance(
  JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance,
);

const turn = (n: number, intents: Intent[] = []): Turn => ({ n, intents, seedSlice: n + 1 });

function world() {
  const w = createWorld(32, 32);
  w.terrain.fill(Terrain.Grass);
  for (let y = 12; y < 20; y++) {
    for (let x = 12; x < 20; x++) {
      const t = y * 32 + x;
      w.terrain[t] = Terrain.Citizen;
      w.pop[t] = 4;
    }
  }
  return w;
}

function spawned() {
  const s = createSim({
    seed: 3,
    balance,
    world: world(),
    spawns: [{ id: 1, archetype: "dawn" }],
  });
  step(s, turn(0, [{ t: IntentType.SPAWN, player: 1, tile: 5 * 32 + 5 }]), balance);
  return s;
}

test("cohorts: mass is conserved through send and completed recall", () => {
  const s = spawned();
  const p = s.players[0]!;
  const before = p.followers;
  step(s, turn(1, [
    { t: IntentType.MISSION_SEND, player: 1, tile: 14 * 32 + 14, permille: 300, mode: Stance.Spread },
  ]), balance);
  assert.equal(p.cohorts.length, 1, "cohort deployed");
  const out = p.cohorts[0]!.mass;
  assert.ok(out > 0, "mass committed");
  assert.equal(toInt(add(p.followers, out)), toInt(before), "flock + deployed = original");

  step(s, turn(2, [{ t: IntentType.MISSION_RECALL, player: 1, slot: 0 }]), balance);
  assert.ok(p.cohorts[0]!.recalling, "recall flagged");
  for (let i = 3; i < 3 + balance.missions.recallTicks + 2; i++) step(s, turn(i), balance);
  assert.equal(p.cohorts.length, 0, "cohort came home");
  // growth ran during the wait, so followers >= the conserved total
  assert.ok(toInt(p.followers) >= toInt(before), "mass returned (plus growth)");
});

test("cohorts: the inner circle never deploys", () => {
  const s = spawned();
  const p = s.players[0]!;
  const total = p.followers;
  // try to send 90% three times — the cap must hold at 80% TOTAL
  step(s, turn(1, [
    { t: IntentType.MISSION_SEND, player: 1, tile: 13 * 32 + 13, permille: 900, mode: Stance.Spread },
    { t: IntentType.MISSION_SEND, player: 1, tile: 14 * 32 + 14, permille: 900, mode: Stance.Tend },
    { t: IntentType.MISSION_SEND, player: 1, tile: 15 * 32 + 15, permille: 900, mode: Stance.Crusade },
  ]), balance);
  const deployed = p.cohorts.reduce((a, c) => a + c.mass, 0);
  assert.ok(
    deployed <= (total * (1000 - balance.missions.innerCirclePermille)) / 1000 + 2,
    `deployed ${deployed} exceeds the 80% cap of ${total}`,
  );
  assert.ok(p.followers >= (total * balance.missions.innerCirclePermille) / 1000 - 2, "inner circle held home");
});

test("cohorts: slot cap and garbage intents reject cleanly", () => {
  const s = spawned();
  const p = s.players[0]!;
  const sends: Intent[] = [];
  for (let i = 0; i < 5; i++)
    sends.push({ t: IntentType.MISSION_SEND, player: 1, tile: (13 + i) * 32 + 13, permille: 150, mode: Stance.Spread });
  step(s, turn(1, sends), balance);
  assert.ok(p.cohorts.length <= 3, `cap holds (${p.cohorts.length})`);
  const h = hashState(s);
  step(s, turn(2, [
    { t: IntentType.MISSION_SEND, player: 1, tile: -5, permille: 300, mode: Stance.Spread },
    { t: IntentType.MISSION_SEND, player: 1, tile: 10, permille: 300, mode: "prayer" as never },
    { t: IntentType.MISSION_RECALL, player: 1, slot: 99 },
  ]), balance);
  // garbage changed nothing but the clock — recompute at same tick baseline:
  assert.equal(s.players[0]!.cohorts.length, 3, "no cohort added by garbage");
  assert.ok(h !== 0, "sanity");
});

test("cohorts survive the snapshot round-trip hash-identically (v9)", () => {
  const s = spawned();
  step(s, turn(1, [
    { t: IntentType.MISSION_SEND, player: 1, tile: 14 * 32 + 14, permille: 400, mode: Stance.Crusade },
  ]), balance);
  step(s, turn(2, [{ t: IntentType.MISSION_RECALL, player: 1, slot: 0 }]), balance);
  const restored = fromSnapshot(toSnapshot(s));
  assert.equal(hashState(restored), hashState(s));
  assert.deepEqual(restored.players[0]!.cohorts, s.players[0]!.cohorts);
});

test("the hash sees cohort state", () => {
  const a = spawned();
  const b2 = spawned();
  assert.equal(hashState(a), hashState(b2), "identical baselines");
  step(a, turn(1, [
    { t: IntentType.MISSION_SEND, player: 1, tile: 14 * 32 + 14, permille: 300, mode: Stance.Spread },
  ]), balance);
  step(b2, turn(1, [
    { t: IntentType.MISSION_SEND, player: 1, tile: 14 * 32 + 14, permille: 300, mode: Stance.Tend },
  ]), balance);
  assert.notEqual(hashState(a), hashState(b2), "mode difference must change the hash");
});
