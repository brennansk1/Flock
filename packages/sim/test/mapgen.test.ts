/**
 * Mapgen contract tests (§2, rev. 2 — the grid plat):
 *  - roads are STRICTLY axis-aligned: no corner-only road contact, no
 *    isolated road pixels (the "diagonal stair-step" regression gate);
 *  - every seed names its world: fresh town name, named street segments;
 *  - generation is deterministic per seed and distinct across seeds;
 *  - the population floor holds on standard competitive worlds (96×96);
 *  - the naming fields survive the snapshot round-trip bit-identically.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateWorld,
  countPopulated,
  countTotalPop,
  createSim,
  loadBalance,
  hashState,
  toSnapshot,
  fromSnapshot,
  streetAt,
  householdName,
  memberName,
  Terrain,
  type RawBalance,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const balance = loadBalance(
  JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance,
);

const SEEDS = [1, 2, 3, 42, 99];

test("roads are strictly orthogonal — no corner-only contact, no orphan pixels", () => {
  for (const seed of SEEDS) {
    const w = generateWorld(seed, 96, 96);
    const road = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < w.width && y < w.height && w.terrain[y * w.width + x] === Terrain.Road;
    // a Dirt lane tile is a legitimate elbow between two road runs (bridges
    // meeting the shore, lanes joining streets) — what must never exist is a
    // road-road diagonal with NOTHING walkable bridging the corner.
    const path = (x: number, y: number): boolean =>
      road(x, y) ||
      (x >= 0 && y >= 0 && x < w.width && y < w.height && w.terrain[y * w.width + x] === Terrain.Dirt);
    let cornerOnly = 0;
    let isolated = 0;
    for (let y = 0; y < w.height; y++) {
      for (let x = 0; x < w.width; x++) {
        if (!road(x, y)) continue;
        const orth =
          (path(x + 1, y) ? 1 : 0) + (path(x - 1, y) ? 1 : 0) + (path(x, y + 1) ? 1 : 0) + (path(x, y - 1) ? 1 : 0);
        if (orth === 0) isolated++;
      }
    }
    for (let y = 0; y < w.height - 1; y++) {
      for (let x = 0; x < w.width - 1; x++) {
        const a = road(x, y);
        const b = road(x + 1, y);
        const c = road(x, y + 1);
        const d = road(x + 1, y + 1);
        if ((a && d && !path(x + 1, y) && !path(x, y + 1)) || (b && c && !path(x, y) && !path(x + 1, y + 1)))
          cornerOnly++;
      }
    }
    assert.equal(cornerOnly, 0, `seed ${seed}: ${cornerOnly} unbridged diagonal road contacts`);
    assert.equal(isolated, 0, `seed ${seed}: ${isolated} isolated road tiles`);
  }
});

test("every seed gets a named world: town name + named streets", () => {
  const names = new Set<string>();
  for (const seed of SEEDS) {
    const w = generateWorld(seed, 96, 96);
    assert.ok(w.townName.length >= 3, `seed ${seed}: empty town name`);
    names.add(w.townName);
    assert.ok(w.streets.length >= 10, `seed ${seed}: only ${w.streets.length} streets`);
    for (const s of w.streets) {
      assert.ok(s.name.length >= 3);
      assert.ok(s.to >= s.from);
    }
    // Main Street exists and streetAt resolves it on the highway row
    const main = w.streets.find((s) => s.name === "Main Street");
    assert.ok(main, `seed ${seed}: no Main Street`);
    const mid = ((main.from + main.to) >> 1) + main.at * w.width;
    assert.equal(streetAt(w.streets, w.width, mid), "Main Street");
  }
  assert.ok(names.size >= SEEDS.length - 1, "town names should vary across seeds");
});

test("generation is deterministic per seed and distinct across adjacent seeds", () => {
  const a = generateWorld(7, 96, 96);
  const b = generateWorld(7, 96, 96);
  assert.deepEqual([...a.terrain], [...b.terrain]);
  assert.equal(a.townName, b.townName);
  assert.deepEqual(a.streets, b.streets);
  // the (seed, attempt) salt must not collide across neighboring seeds
  const c = generateWorld(8, 96, 96);
  const differs = a.townName !== c.townName || [...a.terrain].some((v, i) => v !== c.terrain[i]);
  assert.ok(differs, "adjacent seeds produced identical worlds");
});

test("population floor holds on 96×96 competitive worlds", () => {
  for (const seed of SEEDS) {
    const w = generateWorld(seed, 96, 96);
    assert.ok(countPopulated(w) >= 640, `seed ${seed}: ${countPopulated(w)} populated tiles`);
    assert.ok(countTotalPop(w) >= 2900, `seed ${seed}: ${countTotalPop(w)} residents`);
  }
});

test("naming fields survive the snapshot round-trip (hash-identical)", () => {
  const w = generateWorld(11, 64, 64);
  const sim = createSim({
    seed: 11,
    balance,
    world: w,
    spawns: [
      { id: 1, archetype: "dawn" },
      { id: 2, archetype: "circle" },
    ],
  });
  const restored = fromSnapshot(toSnapshot(sim));
  assert.equal(hashState(restored), hashState(sim));
  assert.equal(restored.world.townName, w.townName);
  assert.deepEqual(restored.world.streets, w.streets);
});

test("household/member names are pure and stable", () => {
  assert.equal(householdName(1234), householdName(1234));
  assert.equal(memberName(1234, 0), memberName(1234, 0));
  assert.notEqual(memberName(1234, 0), memberName(1234, 1));
  assert.ok(householdName(99).length >= 2);
});
