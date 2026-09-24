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
  11: ["7e838bf0a5d95854","19d72c14705136d4","2f66b098b8f6090d","1918:1:1:domination:ab968e7266b7609f"],
  42: ["6cb9a172fc369023","c5151a4c484e0d4b","5247fd831bd390be","1981:1:1:revelation:8043ce8561110411"],
  77: ["e4f0df695df2805a","cce0ad3c5363ac4e","e46f65e24c1c8118","3bda274ef6871e5f","ded1a26cae1f3a3c","dc2acdf8f719d693","3001:0:0::dc2acdf8f719d693"],
};

for (const seed of Object.keys(GOLDEN).map(Number)) {
  test(`golden bot match seed ${seed} is bit-identical`, () => {
    const got = playGolden(seed, 3000);
    if (process.env.GOLDEN_BLESS) console.log(`  ${seed}: ${JSON.stringify(got)},`);
    else assert.deepEqual(got, GOLDEN[seed]);
  });
}
