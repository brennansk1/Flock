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
  11: ["199adbb9efcf9983","174cbf54691856bd","1005:1:1:rapture:c2f867a61015acd2"],
  42: ["2b7a278edacc94d8","acf420fe86178463","fecf48ba00d85bdc","ba38fec666852fd5","2341:1:1:revelation:763c3b99c955f2f7"],
  77: ["cbf168f2d8bef7b8","7b4a108e1b7666a8","d68420568d52e8ee","1621:1:1:revelation:ffaaad3bf16b8980"],
};

for (const seed of Object.keys(GOLDEN).map(Number)) {
  test(`golden bot match seed ${seed} is bit-identical`, () => {
    const got = playGolden(seed, 3000);
    if (process.env.GOLDEN_BLESS) console.log(`  ${seed}: ${JSON.stringify(got)},`);
    else assert.deepEqual(got, GOLDEN[seed]);
  });
}
