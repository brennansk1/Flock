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
  11: ["68e651f60dc6ac52","70c55e2ac9e1f120","e89a00c1db651271","d61b0df4f1093a38","fe66a3d250f9a74d","b4690ee9f796eaef","3001:0:0::b4690ee9f796eaef"],
  42: ["633f9909b28f6958","e588d52484c374aa","769c0fa0a62227e4","49d379378612a065","82073444f1efeb3f","7e30ac945aef38ca","3001:0:0::7e30ac945aef38ca"],
  77: ["374b8d8ceba97ede","cddaaa1f4daebc40","49299d2163602238","3729da6a74e678ef","2197:1:1:revelation:9f2df488cc653e8a"],
};

for (const seed of Object.keys(GOLDEN).map(Number)) {
  test(`golden bot match seed ${seed} is bit-identical`, () => {
    const got = playGolden(seed, 3000);
    if (process.env.GOLDEN_BLESS) console.log(`  ${seed}: ${JSON.stringify(got)},`);
    else assert.deepEqual(got, GOLDEN[seed]);
  });
}
