/**
 * Daily Prophecy (§23) and the earn/spend economy (§22/§36). Meta systems —
 * assert determinism + the hard currency policy, not hashes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dayNumber,
  dailyChallenge,
  checkDaily,
  streakReward,
  DAILY_REWARD_RELICS,
  CATALOG,
  catalogItem,
  freeRotation,
  canPlayArchetype,
  purchase,
  ALL_ARCHETYPES,
  ARCHETYPE_UNLOCK_COST,
  type DailySummary,
  type Wallet,
} from "../dist/index.js";

test("Daily Prophecy is the same for everyone on a given day, varies across days", () => {
  const day = dayNumber();
  assert.equal(dailyChallenge(day).id, dailyChallenge(day).id, "stable within a day");
  // over a week we should see more than one distinct challenge
  const ids = new Set(Array.from({ length: 14 }, (_, i) => dailyChallenge(day + i).id));
  assert.ok(ids.size >= 3, `challenge varies across days, saw ${ids.size}`);
  assert.equal(dailyChallenge(day).reward, DAILY_REWARD_RELICS);
});

test("Daily Prophecy check matches its challenge predicate", () => {
  // find the day index that selects "no_watchtowers" and verify the predicate
  let day = 0;
  while (dailyChallenge(day).id !== "no_watchtowers" && day < 1000) day++;
  const base: DailySummary = {
    archetype: "dawn", won: true, placement: 1, peakFollowers: 100, usdEarned: 0,
    heatPeak: 10, watchtowers: 0, enteredCrusade: false, prophecyFulfilled: false,
    alliances: 0, betrayed: false,
  };
  assert.equal(checkDaily(base, day), true, "won with 0 watchtowers passes");
  assert.equal(checkDaily({ ...base, watchtowers: 2 }, day), false, "watchtowers fail it");
});

test("streak cosmetics fire only at milestones", () => {
  assert.equal(streakReward(7), 7);
  assert.equal(streakReward(30), 30);
  assert.equal(streakReward(6), null);
});

test("free archetype rotation always offers a valid pair so nobody is locked out", () => {
  for (let d = 0; d < 50; d++) {
    const pair = freeRotation(d);
    assert.equal(pair.length, 2);
    assert.notEqual(pair[0], pair[1], "two distinct archetypes");
    for (const a of pair) assert.ok(ALL_ARCHETYPES.includes(a));
  }
  // an empty wallet can always play the free pair
  const empty: Wallet = { relics: 0, shards: 0, unlocks: [] };
  const pair = freeRotation(3);
  assert.ok(canPlayArchetype(empty, pair[0]!, 3));
});

test("POLICY: relics are never purchasable for money; archetypes cost relics", () => {
  // no catalog item priced in money grants relics
  for (const item of CATALOG) {
    if (item.currency === "money") assert.notEqual(item.kind, "archetype", `${item.id} must not sell an archetype for money`);
  }
  // archetype unlock spends relics and grants the archetype
  const wallet: Wallet = { relics: ARCHETYPE_UNLOCK_COST + 50, shards: 0, unlocks: [] };
  const res = purchase(wallet, "unlock_circle");
  assert.ok(res.ok && res.wallet.unlocks.includes("circle"));
  assert.equal(res.wallet.relics, 50, "relics deducted");
  assert.equal(wallet.relics, ARCHETYPE_UNLOCK_COST + 50, "input wallet unmutated");
});

test("economy: insufficient funds, double-buy, and money items", () => {
  const poor: Wallet = { relics: 10, shards: 10, unlocks: [] };
  assert.equal(purchase(poor, "unlock_dawn").ok, false, "not enough relics");
  assert.equal(purchase(poor, "recolor_ember").ok, false, "not enough shards");

  const frame = catalogItem("frame_neon")!;
  assert.equal(purchase(poor, "frame_neon", 0).ok, false, "money not authorized");
  const paid = purchase(poor, "frame_neon", frame.cost);
  assert.ok(paid.ok && paid.wallet.unlocks.includes("frame_neon"), "authorized money purchase grants frame");
  assert.equal(paid.wallet.relics, 10, "money purchase never touches relics");

  const owned: Wallet = { relics: 9999, shards: 0, unlocks: ["circle"] };
  assert.equal(purchase(owned, "unlock_circle").ok, false, "no double-buy");
});
