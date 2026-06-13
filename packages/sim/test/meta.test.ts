/**
 * Meta systems (§20 ranked Glicko-2, §22 progression). These run outside
 * lockstep, so the tests assert mathematical behaviour, not hashes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  newRating,
  updateRating,
  updateFFA,
  tierFor,
  seasonalReset,
  DEFAULT_RATING,
  DEFAULT_RD,
  matchXp,
  xpToNext,
  applyXp,
  matchRelics,
  placementBonus,
  rankedUnlocked,
  RANKED_UNLOCK_LEVEL,
} from "../dist/index.js";

test("Glicko-2: beating a peer raises rating and shrinks RD", () => {
  const me = newRating();
  const peer = newRating();
  const after = updateRating(me, [{ opponent: peer, score: 1 }]);
  assert.ok(after.rating > DEFAULT_RATING, `win should raise rating, got ${after.rating}`);
  assert.ok(after.rd < DEFAULT_RD, `a played game should shrink RD, got ${after.rd}`);
  // matches Glickman's canonical worked example ballpark
  assert.ok(after.rating > 1560 && after.rating < 1700, `rating in expected band: ${after.rating}`);
});

test("Glicko-2: losing lowers rating; idle periods inflate RD without moving rating", () => {
  const me = newRating();
  const strong = { rating: 1800, rd: 80, vol: 0.06 };
  const lost = updateRating(me, [{ opponent: strong, score: 0 }]);
  assert.ok(lost.rating < DEFAULT_RATING, "a loss lowers rating");

  const settled = { rating: 1700, rd: 60, vol: 0.06 };
  const idle = updateRating(settled, []);
  assert.equal(idle.rating, 1700, "idle period leaves rating untouched");
  assert.ok(idle.rd > 60, "idle period inflates RD (uncertainty grows)");
});

test("Glicko-2 is a pure function of its inputs (no hidden state)", () => {
  const me = newRating();
  const peer = newRating();
  const a = updateRating(me, [{ opponent: peer, score: 1 }]);
  const b = updateRating(me, [{ opponent: peer, score: 1 }]);
  assert.deepEqual(a, b, "same inputs ⇒ same output");
});

test("FFA decomposition: winner climbs, last place falls, middle barely moves", () => {
  const field = [newRating(), newRating(), newRating(), newRating()];
  const out = updateFFA(field);
  assert.equal(out.length, 4);
  assert.ok(out[0]!.rating > DEFAULT_RATING, "1st place gains");
  assert.ok(out[3]!.rating < DEFAULT_RATING, "last place loses");
  // monotonic by placement: finishing higher never rates worse
  assert.ok(out[0]!.rating > out[1]!.rating, "1st rates above 2nd");
  assert.ok(out[1]!.rating > out[2]!.rating, "2nd rates above 3rd");
  assert.ok(out[2]!.rating > out[3]!.rating, "3rd rates above last");
  // down-weighting (0.4) makes each implicit pairing gentler than a full 1v1
  const onePairing = updateFFA([newRating(), newRating()]);
  const duel = updateRating(newRating(), [{ opponent: newRating(), score: 1 }]);
  assert.ok(
    onePairing[0]!.rating - DEFAULT_RATING < duel.rating - DEFAULT_RATING,
    "a single FFA pairing moves rating less than a full-weight 1v1 win",
  );
});

test("tiers and seasonal soft reset (§20)", () => {
  assert.equal(tierFor(1500), "Acolyte");
  assert.equal(tierFor(1650), "Deacon");
  assert.equal(tierFor(1850), "Minister");
  assert.equal(tierFor(2300), "Oracle");
  assert.equal(tierFor(1500, true), "Prophet", "prophet is the top-500 flag, not a threshold");

  const reset = seasonalReset({ rating: 2100, rd: 50, vol: 0.06 });
  assert.equal(reset.rating, 1800, "halfway back to 1500");
  assert.ok(reset.rd >= DEFAULT_RD * 0.5, "RD floor reintroduces uncertainty");
});

test("progression XP & levels (§22)", () => {
  assert.equal(placementBonus(1, 8), 120);
  assert.equal(placementBonus(2, 8), 60, "2/8 = top 25%");
  assert.equal(placementBonus(4, 8), 30, "4/8 = top 50%");
  assert.equal(placementBonus(7, 8), 0);

  // 10 minutes survived, won, first win of the day
  const xp = matchXp({ survivedTicks: 10 * 600, placement: 1, playerCount: 8, firstWinOfDay: true });
  assert.equal(xp, 40 + 20 + 120 + 100);

  assert.equal(xpToNext(5), Math.round(200 * Math.pow(5, 1.25)));

  // rolling enough XP up several levels at once lands on the right level
  const start = { level: 1, xpIntoLevel: 0 };
  const after = applyXp(start, xpToNext(1) + xpToNext(2) + 5);
  assert.equal(after.level, 3);
  assert.equal(after.xpIntoLevel, 5);
});

test("relics stay inside the 10–30 band; ranked unlocks at level 5 (§22)", () => {
  const winner = matchRelics({ survivedTicks: 100000, placement: 1, playerCount: 8, firstWinOfDay: false });
  const loser = matchRelics({ survivedTicks: 50, placement: 8, playerCount: 8, firstWinOfDay: false });
  assert.ok(winner >= 10 && winner <= 30 && loser >= 10 && loser <= 30);
  assert.ok(winner > loser, "doing better earns more relics");

  assert.equal(rankedUnlocked(RANKED_UNLOCK_LEVEL - 1), false);
  assert.equal(rankedUnlocked(RANKED_UNLOCK_LEVEL), true);
});
