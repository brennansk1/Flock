/**
 * Key-building strategy (§13 rev.): Civic Momentum — controlling the town's
 * institutions bends conversion your way — and the Sawmill retarget discounts
 * building up the commune. These pin the strategic implications so a takeover
 * always matters.
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
  toInt,
  compoundCost,
  IntentType,
  Stance,
  TileState,
  Lot,
  type RawBalance,
  type SimState,
  type Turn,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance;
const balance = loadBalance(raw);

const W = 24;

function emptyTurn(n: number): Turn {
  return { n, intents: [], seedSlice: 0 };
}

/** A circle cult (r0 1.0, no Fear-Feeds-Us passive) with a compound + flock. */
function soloCult(civicLots: number): SimState {
  const world = createWorld(W, W);
  for (let i = 0; i < world.susceptibility.length; i++) world.susceptibility[i] = fromInt(50);
  const s = createSim({ seed: 42, balance, world, spawns: [{ id: 1, archetype: "circle" }] });
  const p = s.players[0]!;
  p.spawned = true;
  p.followers = fromInt(1000);
  s.buildings.push({ id: s.nextEntityId++, player: 1, type: "compound", tile: 12 * W + 3, buildTicksLeft: 0, disabledTicks: 0 });
  // Grant control of `civicLots` key buildings whose OWN effects don't touch
  // cohort conversion (Sheriff=Heat, Grain=money, Church=Faith, HighSchool=growth)
  // — so any conversion delta is pure Civic Momentum, placed far from the front.
  const lots = [Lot.Sheriff, Lot.GrainElevator, Lot.Church, Lot.HighSchool];
  for (let i = 0; i < civicLots && i < lots.length; i++) {
    const t = i; // row 0, far from the row-12 front
    s.world.lot[t] = lots[i]!;
    s.world.owner[t] = 1;
    s.world.state[t] = TileState.Believer;
  }
  return s;
}

function sendSpread(pid: number, tile: number): Turn {
  return { n: 0, intents: [{ t: IntentType.MISSION_SEND, player: pid, tile, permille: 700, mode: Stance.Spread }], seedSlice: 0 };
}

test("Civic Momentum: controlling key buildings converts the town faster", () => {
  const ticksToFlip = (civicLots: number): number => {
    const s = soloCult(civicLots);
    const target = 12 * W + 6; // neutral tile in the cohort's spread radius
    const turns = new Map<number, Turn>([[0, sendSpread(1, target)]]);
    for (let n = 0; n < 4000; n++) {
      step(s, turns.get(n) ?? emptyTurn(n), balance);
      if (s.world.owner[target] === 1) return n + 1;
    }
    return Infinity;
  };
  const none = ticksToFlip(0);
  const three = ticksToFlip(3); // +9% conversion momentum
  assert.ok(none < Infinity && three < Infinity, `both should flip (none=${none}, three=${three})`);
  assert.ok(three < none, `civic momentum should flip the target sooner (none=${none}, with 3 civics=${three})`);
});

test("Sawmill takeover discounts building up the commune", () => {
  const spend = (holdSawmill: boolean): number => {
    const world = createWorld(W, W);
    const s = createSim({ seed: 7, balance, world, spawns: [{ id: 1, archetype: "circle" }] });
    const p = s.players[0]!;
    p.spawned = true;
    p.usd = fromInt(1_000_000);
    if (holdSawmill) {
      s.world.lot[0] = Lot.Sawmill;
      s.world.owner[0] = 1;
      s.world.state[0] = TileState.Believer;
    }
    const before = toInt(p.usd);
    step(s, { n: 0, intents: [{ t: IntentType.UPGRADE_COMMUNE, player: 1 }], seedSlice: 0 }, balance);
    return before - toInt(s.players[0]!.usd);
  };
  const full = spend(false);
  const discounted = spend(true);
  assert.ok(discounted < full, `Sawmill should make the upgrade cheaper (full=${full}, discounted=${discounted})`);
  // ~0.88× the base cost (allow rounding)
  assert.ok(discounted <= full * 0.9, `expected ≈0.88× cost, got ${discounted}/${full}`);
});
