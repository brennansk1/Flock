/**
 * Golden-hash characterization gate. Pins the exact StateHash trajectory of
 * three full bot matches (all four archetypes, every kit ability, decrees,
 * signatures). Pure refactors must leave these bit-identical; an intentional
 * gameplay change re-blesses them:
 *   GOLDEN_BLESS=1 node --test --experimental-strip-types test/golden.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { playGolden } from "./golden_helpers.ts";

const GOLDEN: Record<number, string[]> = {
  11: ["ea601d3fe854e504","5e55fed3d832b4b8","e4612a4e451eb23a","43b067a11e2f54ee","01be38e7faae4e83","9c4ca47c560679af","3001:0:0:9c4ca47c560679af"],
  42: ["242553bbf8d77b13","d32fb082d4b44746","bb7405e6b3c26a74","99878d63d7634fcf","aea06918d25d2235","88c995faf24aeb84","3001:0:0:88c995faf24aeb84"],
  77: ["7c8402982d444546","ca60eb5ec32b643e","a0fbd7be4dcb1ffb","df52bfaa4c525acd","b23977df794b00e5","253e2c8d4f898a3d","3001:0:0:253e2c8d4f898a3d"],
};

for (const seed of Object.keys(GOLDEN).map(Number)) {
  test(`golden bot match seed ${seed} is bit-identical`, () => {
    const got = playGolden(seed, 3000);
    if (process.env.GOLDEN_BLESS) console.log(`  ${seed}: ${JSON.stringify(got)},`);
    else assert.deepEqual(got, GOLDEN[seed]);
  });
}
