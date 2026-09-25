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
  11: ["612f300bb9ba6a4e","8aec327406865740","01888272349430c5","187369c2d5c13943","2301:1:1:rapture:eb9efc43b34a8d98"],
  42: ["6eef062a7b741d3b","a7461200bd00ef5a","e22e53149e8a9f69","4921d49a72de8d37","9da52ce8ac90da6e","7b3979937d09b076","3001:0:0::7b3979937d09b076"],
  77: ["4cd4207f46debaaf","d2d543d4627663f8","94f38ce13c007d1e","4830a774522fdc78","2055:1:1:revelation:33d40744893e462e"],
};

for (const seed of Object.keys(GOLDEN).map(Number)) {
  test(`golden bot match seed ${seed} is bit-identical`, () => {
    const got = playGolden(seed, 3000);
    if (process.env.GOLDEN_BLESS) console.log(`  ${seed}: ${JSON.stringify(got)},`);
    else assert.deepEqual(got, GOLDEN[seed]);
  });
}
