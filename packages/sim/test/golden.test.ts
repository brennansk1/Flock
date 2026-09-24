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
  11: ["36bfba08cd84deed","60151ee6ef01d1e8","36b8aef3597af00f","5b4a14334ba8956c","82911d7158fb2b6c","abca89480f98224f","3001:0:0::abca89480f98224f"],
  42: ["e7bba114ed83a498","7511196615c8df7e","1261:1:1:revelation:c0ebebba4545cc3d"],
  77: ["291ec7a78c41088a","2a9bedc8d9b99118","f017ab8c06544850","284cc2fec929590d","2341:1:1:revelation:1239402580b26684"],
};

for (const seed of Object.keys(GOLDEN).map(Number)) {
  test(`golden bot match seed ${seed} is bit-identical`, () => {
    const got = playGolden(seed, 3000);
    if (process.env.GOLDEN_BLESS) console.log(`  ${seed}: ${JSON.stringify(got)},`);
    else assert.deepEqual(got, GOLDEN[seed]);
  });
}
