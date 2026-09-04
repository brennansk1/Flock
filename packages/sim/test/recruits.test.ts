/**
 * Prosperity Gospel (§2C): BUY_RECRUITS turns cash into flock — the money→power
 * lever that makes `income` a live stat (the Inner Circle's engine). These pin
 * the handler's contract: it spends the right cash, adds the right flock, and
 * gates on affordability and the follower cap.
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
  toInt,
  IntentType,
  followerCap,
  type RawBalance,
  type SimState,
  type Turn,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance;
const balance = loadBalance(raw);

function soloCircle(followers: number, usd: number): SimState {
  const world = createWorld(16, 16);
  const s = createSim({ seed: 7, balance, world, spawns: [{ id: 1, archetype: "circle" }] });
  const p = s.players[0]!;
  p.spawned = true;
  p.followers = fromInt(followers);
  p.usd = fromInt(usd);
  return s;
}

function buyTurn(): Turn {
  return { n: 0, intents: [{ t: IntentType.BUY_RECRUITS, player: 1 }], seedSlice: 0 };
}

test("a recruitment drive buys flock for cash (a ‰ of the current flock)", () => {
  const s = soloCircle(1000, 100_000);
  const before = { f: toFloat(s.players[0]!.followers), usd: toInt(s.players[0]!.usd) };
  step(s, buyTurn(), balance);
  const after = { f: toFloat(s.players[0]!.followers), usd: toInt(s.players[0]!.usd) };
  const gained = after.f - before.f;
  const drivePct = balance.economy.recruitDrivePermille / 1000;
  // ~20% of 1000 = ~200 flock; exact per the ‰ (allow fixed-point rounding)
  assert.ok(Math.abs(gained - 1000 * drivePct) <= 1, `expected ~${1000 * drivePct} flock, got ${gained}`);
  // paid gained × cost_per in cash
  const spent = before.usd - after.usd;
  const per = toInt(balance.economy.recruitCostPer);
  assert.ok(Math.abs(spent - Math.round(gained) * per) <= per, `expected ~${gained * per} spent, got ${spent}`);
});

test("a broke cult cannot buy recruits (no-op, no debt)", () => {
  const s = soloCircle(1000, 10); // nowhere near a drive's cost
  const before = toFloat(s.players[0]!.followers);
  step(s, buyTurn(), balance);
  // ambient base-recruit growth still ticks (~0.1/tick); what must NOT happen is
  // a ~200-flock batch landing. And cash must never go negative.
  assert.ok(toFloat(s.players[0]!.followers) - before < 20, "no batch was bought on empty pockets");
  assert.ok(toInt(s.players[0]!.usd) >= 0, "never goes into debt");
});

test("the drive tops off to the cap and only charges for what it adds", () => {
  const s = soloCircle(1000, 1_000_000); // plenty of cash: the CAP is the limiter
  const cap = toFloat(followerCap(s.players[0]!, balance, s));
  s.players[0]!.followers = fromInt(Math.floor(cap) - 5); // 5 souls of room
  const usdBefore = toInt(s.players[0]!.usd);
  step(s, buyTurn(), balance);
  const after = toFloat(s.players[0]!.followers);
  assert.ok(after <= cap + 1 && after >= cap - 1, `tops off to the cap (${after} vs ${cap})`);
  // a 20%-of-flock batch would be ~200, but only ~5 fit — so we paid for ~5, not 200
  const spent = usdBefore - toInt(s.players[0]!.usd);
  assert.ok(spent < 20 * toInt(balance.economy.recruitCostPer), `charged for the ~5 added, not the full batch (spent ${spent})`);
});
