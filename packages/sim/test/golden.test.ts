/**
 * Golden-hash characterization gate. Pins the exact StateHash trajectory of
 * three full bot matches (all four archetypes, every kit ability, decrees,
 * signatures). Pure refactors must leave these bit-identical; an intentional
 * gameplay or mapgen change (e.g. Stage 2 worldgen) re-blesses them:
 *   GOLDEN_BLESS=1 node --test --experimental-strip-types test/golden.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { playGolden } from "./golden_helpers.ts";

const GOLDEN: Record<number, string[]> = {
  11: ["e89639bc27b92377","067acba3d37b9e8b","e07dc1805a625fd2","1688:1:1:rapture:ed411db02a92e441"],
  42: ["2b5b84ccd40c6ff4","c869133bdf14a639","eeb50a55a349eefb","d20134f3d8e00683","7503e06280aa8162","2701:1:1:revelation:04348b44afcee96d"],
  77: ["6829a0d567580d37","495a8cfaa999cc2d","67a7aa6a0b47b942","1c6609a788b1d87c","71cdafde4be142db","1395a5a81701a0c4","3001:0:0::1395a5a81701a0c4"],
};

for (const seed of Object.keys(GOLDEN).map(Number)) {
  test(`golden bot match seed ${seed} is bit-identical`, () => {
    const got = playGolden(seed, 3000);
    if (process.env.GOLDEN_BLESS) console.log(`  ${seed}: ${JSON.stringify(got)},`);
    else assert.deepEqual(got, GOLDEN[seed]);
  });
}
