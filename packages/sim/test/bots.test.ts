/**
 * Bot brains (§21). The brains are pure given (sim, bot, rng); these tests run
 * headless matches driving bots through the same Intent API humans use, and
 * assert: tiers behave differently, the brain is deterministic, and an
 * Established Church actually establishes (grows from its pre-seed).
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
  seedRng,
  botTurn,
  botShouldAct,
  IntentType,
  type RawBalance,
  type BotState,
  type Turn,
  type Intent,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance;
const balance = loadBalance(raw);

function world24() {
  const w = createWorld(24, 24);
  for (let i = 0; i < w.susceptibility.length; i++) w.susceptibility[i] = fromInt(50);
  return w;
}

function bot(playerId: number, tier: BotState["tier"], aggression = 0): BotState {
  return { playerId, tier, cadence: 5, aggression, grudge: 0 };
}

/** Run a headless match where each player is driven by a bot brain. */
function runMatch(seed: number, bots: BotState[], ticks: number) {
  const s = createSim({
    seed,
    balance,
    world: world24(),
    spawns: bots.map((b) => ({ id: b.playerId, archetype: "dawn" as const })),
    timerTicks: 0,
    dominationPermille: 1000,
    foundingTicks: 1,
  });
  const rng = seedRng(seed ^ 0xb07);
  // spawn everyone in opposite corners
  const corners = [1 * 24 + 1, 22 * 24 + 22, 1 * 24 + 22, 22 * 24 + 1];
  step(
    s,
    {
      n: 0,
      intents: bots.map((b, i) => ({ t: IntentType.SPAWN, player: b.playerId, tile: corners[i]! })),
      seedSlice: 7,
    } as Turn,
    balance,
  );
  for (let n = 1; n < ticks; n++) {
    const intents: Intent[] = [];
    for (const b of bots) {
      if (botShouldAct(b, s.tick)) intents.push(...botTurn(s, b, rng));
    }
    step(s, { n, intents, seedSlice: (n * 2654435761) >>> 0 } as Turn, balance);
  }
  return s;
}

test("a bot brain run is deterministic (same seed ⇒ same final state)", () => {
  const mk = () => [bot(1, "church", 2), bot(2, "drifter")];
  const a = runMatch(99, mk(), 220);
  const b = runMatch(99, mk(), 220);
  assert.equal(a.players[0]!.ownedTiles, b.players[0]!.ownedTiles);
  assert.equal(a.players[1]!.ownedTiles, b.players[1]!.ownedTiles);
});

test("Established Church establishes itself and outgrows a lone Drifter", () => {
  const s = runMatch(7, [bot(1, "church", 2), bot(2, "drifter")], 260);
  const church = s.players[0]!;
  const drifter = s.players[1]!;
  assert.ok(church.spawned && church.ownedTiles > 0, "church holds territory");
  // the major's pre-seed + disciplined script should out-expand the drifter
  assert.ok(
    church.ownedTiles > drifter.ownedTiles,
    `church (${church.ownedTiles}) should outgrow drifter (${drifter.ownedTiles})`,
  );
});

test("Church brains attempt the rich intent set; Drifters never build", () => {
  const s = runMatch(3, [bot(1, "church", 2), bot(2, "drifter")], 60);
  const rng = seedRng(123);
  // clear the church's live cohorts so it has slots free — otherwise the
  // sample sees only recalls/holds from a maxed-out mission board
  s.players[0]!.cohorts = [];
  // sample many church decision batches and confirm the richer intent surface
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    for (const intent of botTurn(s, bot(1, "church", 2), rng)) seen.add(intent.t);
    for (const intent of botTurn(s, bot(2, "drifter"), rng)) {
      assert.notEqual(intent.t, IntentType.BUILD, "drifters never build");
      assert.notEqual(intent.t, IntentType.DOCTRINE_PICK, "drifters never pick doctrine");
    }
  }
  assert.ok(seen.has(IntentType.MISSION_SEND), "church expands via missions");
  assert.ok(seen.has(IntentType.SET_STANCE), "church has stance discipline");
});
