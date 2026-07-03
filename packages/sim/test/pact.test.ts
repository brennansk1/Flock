/**
 * Ecumenical Pact (§16): allies share one OWNED doctrine node each; the grant
 * lives exactly as long as the alliance.
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
  IntentType,
  type RawBalance,
  type Turn,
  type Intent,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance;
const balance = loadBalance(raw);
const turn = (n: number, intents: Intent[] = []): Turn => ({ n, intents, seedSlice: n * 7 });

function pactSim() {
  const w = createWorld(16, 16);
  for (let i = 0; i < w.susceptibility.length; i++) w.susceptibility[i] = fromInt(50);
  const s = createSim({
    seed: 5,
    balance,
    world: w,
    spawns: [
      { id: 1, archetype: "dawn" },
      { id: 2, archetype: "circle" },
    ],
    foundingTicks: 10,
    timerTicks: 0,
    dominationPermille: 1000,
  });
  step(s, turn(0, [
    { t: IntentType.SPAWN, player: 1, tile: 4 * 16 + 4 },
    { t: IntentType.SPAWN, player: 2, tile: 12 * 16 + 12 },
  ]), balance);
  for (let i = 0; i < 15; i++) step(s, turn(s.tick), balance);
  return s;
}

test("PACT_PICK: shares an owned node with the ally; revoked on alliance break", () => {
  const s = pactSim();
  const p1 = s.players.find((p) => p.id === 1)!;
  // give p1 a doctrine node directly (milestones are irrelevant to the pact rule)
  p1.doctrine.push("B1");

  // no alliance yet: the pick must be refused
  step(s, turn(s.tick, [{ t: IntentType.PACT_PICK, player: 1, node: "B1" }]), balance);
  const p2 = s.players.find((p) => p.id === 2)!;
  assert.equal(p2.pactNode, "", "no pact without an alliance");

  // form the alliance, then share
  step(s, turn(s.tick, [{ t: IntentType.ALLY_PROPOSE, player: 1, target: 2 }]), balance);
  step(s, turn(s.tick, [{ t: IntentType.ALLY_ACCEPT, player: 2, target: 1 }]), balance);
  step(s, turn(s.tick, [{ t: IntentType.PACT_PICK, player: 1, node: "B1" }]), balance);
  assert.equal(p2.pactNode, "B1", "ally received the shared node");
  assert.equal(p2.pactWith, 1, "grant tracks its source");

  // a node you don't own can't be shared
  step(s, turn(s.tick, [{ t: IntentType.PACT_PICK, player: 1, node: "T1" }]), balance);
  assert.equal(p2.pactNode, "B1", "unowned nodes are not shareable");

  // breaking the alliance revokes the grant
  step(s, turn(s.tick, [{ t: IntentType.ALLY_BREAK, player: 1, target: 2 }]), balance);
  assert.equal(p2.pactNode, "", "pact dies with the alliance");
  assert.equal(p2.pactWith, 0, "source cleared");
});
