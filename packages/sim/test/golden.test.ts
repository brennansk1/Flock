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
   42: ["ce70f77c697440fb","266b057d0aac9c9e","2ab4999cea997880","1981:1:1:revelation:93803f9a9627ef6b"],
   77: ["b5638b7bf9e7fb39","8e82ae2939926435","7fc8d5a9a104a612","6ddd53b7c7c52caf","2019:1:1:revelation:5a303f306c468174"],
};

for (const seed of Object.keys(GOLDEN).map(Number)) {
  test(`golden bot match seed ${seed} is bit-identical`, () => {
    const got = playGolden(seed, 3000);
    if (process.env.GOLDEN_BLESS) console.log(`  ${seed}: ${JSON.stringify(got)},`);
    else assert.deepEqual(got, GOLDEN[seed]);
  });
}
