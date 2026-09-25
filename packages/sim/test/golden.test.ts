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
  11: ["4a5683506b521e3b","548e800bb52b1007","1318:1:1:rapture:759c4a3b2bc0c1d5"],
  42: ["5219a27ca43cc351","e8ddb50406420c2d","065c36e725de8dbb","597c36eb06f10dda","4d656a37be32409f","2832:1:2:revelation:dff381a0326c7013"],
  77: ["2932021f86f96e72","d2f51fbb9d73d215","1261:1:1:revelation:ae117b60713d819c"],
};

for (const seed of Object.keys(GOLDEN).map(Number)) {
  test(`golden bot match seed ${seed} is bit-identical`, () => {
    const got = playGolden(seed, 3000);
    if (process.env.GOLDEN_BLESS) console.log(`  ${seed}: ${JSON.stringify(got)},`);
    else assert.deepEqual(got, GOLDEN[seed]);
  });
}
