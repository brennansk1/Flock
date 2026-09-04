/**
 * Town-archetype contract tests (§2A — B1.4.14.6):
 *  - every archetype generates deterministically and differs from the farm
 *    baseline (the archetype pass actually did something);
 *  - the base-map guarantees SURVIVE the archetype pass: population floor,
 *    all seven keystone civics, road orthogonality — despite the sea /
 *    conifer walls / lake eating land;
 *  - water stays clean: no residents on water, no lots on water except the
 *    dam (the weir deliberately spans the millpond);
 *  - per-archetype anchors exist: oceanside lighthouse + cannery (and NO
 *    grain elevator — the harbor replaced it), mountain sawmill + timber
 *    walls + no farmland climbing the forested slopes, lakeside big water +
 *    resort docks, desert dominant sand + a temperate oasis under the town;
 *  - an archetype world survives the snapshot round-trip hash-identically.
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
  Lot,
  Terrain,
  Biome,
  type RawBalance,
  type TownType,
  type World,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const balance = loadBalance(
  JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance,
);

const SEEDS = [1, 2, 3, 42, 99];
const TYPES: TownType[] = ["oceanside", "mountain", "lakeside", "desert"];

// one generation per (type, seed) shared by every test below
const cache = new Map<string, World>();
function gen(townType: TownType, seed: number, size = 96): World {
  const key = `${townType}:${seed}:${size}`;
  let w = cache.get(key);
  if (!w) {
    w = generateWorld(seed, size, size, townType === "farm" ? {} : { townType });
    cache.set(key, w);
  }
  return w;
}

function lotCount(w: World, lot: number): number {
  let n = 0;
  for (let t = 0; t < w.lot.length; t++) if (w.lot[t] === lot) n++;
  return n;
}

function terrainCount(w: World, terrain: number): number {
  let n = 0;
  for (let t = 0; t < w.terrain.length; t++) if (w.terrain[t] === terrain) n++;
  return n;
}

test("archetypes are deterministic per seed and actually reshape the map", () => {
  for (const townType of TYPES) {
    const a = gen(townType, 42);
    const b = generateWorld(42, 96, 96, { townType });
    assert.ok(
      Buffer.from(a.terrain.buffer).equals(Buffer.from(b.terrain.buffer)) &&
        Buffer.from(a.lot.buffer).equals(Buffer.from(b.lot.buffer)) &&
        Buffer.from(a.biome.buffer).equals(Buffer.from(b.biome.buffer)) &&
        a.townName === b.townName,
      `${townType}: same seed produced different worlds`,
    );
    const farm = gen("farm", 42);
    assert.ok(
      !Buffer.from(a.terrain.buffer).equals(Buffer.from(farm.terrain.buffer)),
      `${townType}: identical to the farm baseline — archetype pass did nothing`,
    );
  }
});

test("population floor and keystone civics survive every archetype", () => {
  for (const townType of TYPES) {
    for (const seed of SEEDS) {
      const w = gen(townType, seed);
      assert.ok(
        countPopulated(w) >= 640,
        `${townType} seed ${seed}: only ${countPopulated(w)} populated tiles`,
      );
      assert.ok(
        countTotalPop(w) >= 2900,
        `${townType} seed ${seed}: only ${countTotalPop(w)} souls`,
      );
      for (const [name, kind] of [
        ["elementary school", Lot.School],
        ["high school", Lot.HighSchool],
        ["sheriff", Lot.Sheriff],
        ["grocery", Lot.Supermarket],
        ["church", Lot.Church],
        ["fire station", Lot.FireStation],
        ["gas station", Lot.GasStation],
      ] as const) {
        assert.ok(lotCount(w, kind) > 0, `${townType} seed ${seed}: no ${name}`);
      }
    }
  }
});

test("road orthogonality survives every archetype (sea/forest trims leave no debris)", () => {
  for (const townType of TYPES) {
    for (const seed of SEEDS) {
      const w = gen(townType, seed);
      const road = (x: number, y: number): boolean =>
        x >= 0 && y >= 0 && x < w.width && y < w.height && w.terrain[y * w.width + x] === Terrain.Road;
      const path = (x: number, y: number): boolean =>
        road(x, y) ||
        (x >= 0 && y >= 0 && x < w.width && y < w.height && w.terrain[y * w.width + x] === Terrain.Dirt);
      let cornerOnly = 0;
      let isolated = 0;
      for (let y = 0; y < w.height; y++) {
        for (let x = 0; x < w.width; x++) {
          if (!road(x, y)) continue;
          const orth =
            (path(x + 1, y) ? 1 : 0) +
            (path(x - 1, y) ? 1 : 0) +
            (path(x, y + 1) ? 1 : 0) +
            (path(x, y - 1) ? 1 : 0);
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
      assert.equal(cornerOnly, 0, `${townType} seed ${seed}: ${cornerOnly} unbridged diagonal road contacts`);
      assert.equal(isolated, 0, `${townType} seed ${seed}: ${isolated} isolated road tiles`);
    }
  }
});

test("water stays clean: no residents on water; only the dam may sit on a lake", () => {
  for (const townType of TYPES) {
    for (const seed of SEEDS) {
      const w = gen(townType, seed);
      for (let t = 0; t < w.terrain.length; t++) {
        if (w.terrain[t] !== Terrain.Lake) continue;
        assert.equal(w.pop[t], 0, `${townType} seed ${seed}: residents living on water at t=${t}`);
        assert.ok(
          w.lot[t] === 0 || w.lot[t] === Lot.Dam,
          `${townType} seed ${seed}: lot ${w.lot[t]} stranded on water at t=${t}`,
        );
      }
    }
  }
});

test("oceanside: a real sea, one lighthouse, a working cannery, no grain elevator", () => {
  for (const seed of SEEDS) {
    const w = gen("oceanside", seed);
    let oceanBiome = 0;
    for (let t = 0; t < w.biome.length; t++) if (w.biome[t] === Biome.Ocean) oceanBiome++;
    assert.ok(oceanBiome >= 1500, `seed ${seed}: only ${oceanBiome} ocean tiles — no sea`);
    assert.ok(lotCount(w, Lot.Lighthouse) >= 1, `seed ${seed}: no lighthouse on the shore`);
    assert.ok(lotCount(w, Lot.Cannery) >= 1, `seed ${seed}: no cannery — the harbor has no industry`);
    assert.equal(
      lotCount(w, Lot.GrainElevator),
      0,
      `seed ${seed}: grain elevator survived — the cannery swap (§2A) failed`,
    );
  }
});

test("mountain: timber walls, a sawmill on the rail, no farmland up the slopes", () => {
  for (const seed of SEEDS) {
    const w = gen("mountain", seed);
    const woods = terrainCount(w, Terrain.Woods);
    assert.ok(woods >= 1500, `seed ${seed}: only ${woods} woods tiles — the valley has no walls`);
    assert.ok(lotCount(w, Lot.Sawmill) >= 2, `seed ${seed}: no sawmill beside the rail`);
    for (let t = 0; t < w.terrain.length; t++) {
      if (w.biome[t] !== Biome.Forest) continue;
      const tr = w.terrain[t];
      assert.ok(
        tr !== Terrain.Field && tr !== Terrain.Orchard && tr !== Terrain.Pasture,
        `seed ${seed}: farmland at t=${t} climbed into the forest biome`,
      );
    }
  }
});

test("lakeside: a big water body beyond the farm baseline, resort docks on the shore", () => {
  for (const seed of SEEDS) {
    const lakeside = gen("lakeside", seed);
    const farm = gen("farm", seed);
    const lakeTiles = terrainCount(lakeside, Terrain.Lake);
    const farmLake = terrainCount(farm, Terrain.Lake);
    assert.ok(
      lakeTiles >= farmLake + 250,
      `seed ${seed}: lakeside has ${lakeTiles} water vs farm ${farmLake} — no big lake`,
    );
    assert.ok(lotCount(lakeside, Lot.Dock) >= 3, `seed ${seed}: fewer than 3 docks — no resort shore`);
  }
});

test("desert: dominant sand with a temperate oasis under the town", () => {
  for (const seed of SEEDS) {
    const w = gen("desert", seed);
    let desert = 0;
    let popTiles = 0;
    let temperatePop = 0;
    for (let t = 0; t < w.biome.length; t++) {
      if (w.biome[t] === Biome.Desert) desert++;
      if (w.pop[t]! > 0) {
        popTiles++;
        if (w.biome[t] !== Biome.Desert) temperatePop++;
      }
    }
    assert.ok(desert >= 4000, `seed ${seed}: only ${desert} desert tiles — sand isn't dominant`);
    assert.ok(
      temperatePop / popTiles >= 0.9,
      `seed ${seed}: only ${((temperatePop / popTiles) * 100).toFixed(0)}% of homes on temperate ground — the oasis rule failed`,
    );
  }
});

test("archetype worlds survive the snapshot round-trip (hash-identical)", () => {
  const w = gen("oceanside", 11, 64);
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
});
