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
  11: ["b27e381cf9c9caf3","6fb4484cb42fe3d5","85ea024f94fe569f","5ff87a6d202c172c","3899119714a4ec3b","047dbeed469816c8","3001:0:0::047dbeed469816c8"],
  42: ["fed54a657379ac84","622986357c57be56","db4a25727fec5cf4","1981:1:1:revelation:25eac6c125693951"],
  77: ["e11cbb2260e9d0f1","ace971c32f8488a6","e11dc889e2f2ff70","0e7943b0aab14956","2125:1:1:revelation:180b0615846ea804"],
};

for (const seed of Object.keys(GOLDEN).map(Number)) {
  test(`golden bot match seed ${seed} is bit-identical`, () => {
    const got = playGolden(seed, 3000);
    if (process.env.GOLDEN_BLESS) console.log(`  ${seed}: ${JSON.stringify(got)},`);
    else assert.deepEqual(got, GOLDEN[seed]);
  });
}
