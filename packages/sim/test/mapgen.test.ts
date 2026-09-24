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
  Lot,
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

test("every town guarantees its keystone civic buildings", () => {
  for (const seed of SEEDS) {
    const w = generateWorld(seed, 96, 96);
    const present = new Set<number>();
    for (let t = 0; t < w.lot.length; t++) if (w.lot[t] !== 0) present.add(w.lot[t]!);
    for (const [name, kind] of [
      ["elementary school", Lot.School],
      ["high school", Lot.HighSchool],
      ["sheriff", Lot.Sheriff],
      ["grocery", Lot.Supermarket],
      ["church", Lot.Church],
      ["fire station", Lot.FireStation],
      ["gas station", Lot.GasStation],
      ["warehouse", Lot.Warehouse],
    ] as const) {
      assert.ok(present.has(kind), `seed ${seed}: town has no ${name}`);
    }
  }
});

test("no home without street access (roads, lanes, or footpaths)", () => {
  for (const seed of SEEDS) {
    const w = generateWorld(seed, 96, 96);
    const way = (t: number): boolean =>
      t >= 0 &&
      t < w.terrain.length &&
      (w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Dirt || w.terrain[t] === Terrain.Path);
    let orphans = 0;
    for (let t = 0; t < w.terrain.length; t++) {
      if (w.terrain[t] !== Terrain.Citizen || w.pop[t]! < 3 || w.lot[t] !== 0) continue;
      const x = t % w.width;
      const y = (t / w.width) | 0;
      const ok =
        (x > 0 && way(t - 1)) ||
        (x < w.width - 1 && way(t + 1)) ||
        (y > 0 && way(t - w.width)) ||
        (y < w.height - 1 && way(t + w.width));
      if (!ok) orphans++;
    }
    assert.equal(orphans, 0, `seed ${seed}: ${orphans} homes with no way to the street`);
  }
});

test("biomes are configurable, blob-shaped, and deterministic", () => {
  const both = generateWorld(5, 96, 96); // default: desert + forest
  let desert = 0;
  let forest = 0;
  for (let t = 0; t < both.biome.length; t++) {
    if (both.biome[t] === 1) desert++;
    if (both.biome[t] === 2) forest++;
  }
  assert.ok(desert > 50, `default map should carry a desert blob (got ${desert})`);
  assert.ok(forest > 50, `default map should carry a forest blob (got ${forest})`);
  // pure temperate when configured off
  const plain = generateWorld(5, 96, 96, { biomes: [] });
  assert.ok(plain.biome.every((b) => b === 0), "biomes:[] must yield a temperate map");
  // determinism per (seed, config)
  const again = generateWorld(5, 96, 96);
  assert.deepEqual([...again.biome], [...both.biome]);
  // farming v2 exists: orchards or pastures show up on default worlds
  const farmish = [...both.terrain].some((t) => t === Terrain.Orchard || t === Terrain.Pasture);
  assert.ok(farmish, "farms should roll orchards/pastures");
});

test("the railroad, elevator, and depot anchor every town (§2 rev. 5)", () => {
  for (const seed of SEEDS) {
    const w = generateWorld(seed, 96, 96);
    let rail = 0;
    const lots = new Set<number>();
    for (let t = 0; t < w.terrain.length; t++) {
      if (w.terrain[t] === Terrain.Rail) rail++;
      if (w.lot[t] !== 0) lots.add(w.lot[t]!);
    }
    assert.ok(rail >= 80, `seed ${seed}: rail line too short (${rail} tiles)`);
    assert.ok(lots.has(Lot.GrainElevator), `seed ${seed}: no grain elevator`);
    assert.ok(lots.has(Lot.Depot), `seed ${seed}: no depot`);
  }
});

test("the countryside is farmed, watered, and wooded like working land", () => {
  const w = generateWorld(3, 96, 96);
  let farm = 0;
  let rural = 0;
  let water = 0;
  for (let t = 0; t < w.terrain.length; t++) {
    const tr = w.terrain[t];
    if (tr === Terrain.Lake) water++;
    if (tr === Terrain.Field || tr === Terrain.Orchard || tr === Terrain.Pasture) farm++;
    if (tr === Terrain.Grass || tr === Terrain.Field || tr === Terrain.Orchard || tr === Terrain.Pasture) rural++;
  }
  // contiguous farm belt (#3): a solid share of the open land is cultivated
  assert.ok(farm / rural > 0.2, `farm share too low: ${(farm / rural * 100).toFixed(1)}%`);
  // tributaries + outlet (#5/#6): meaningfully more water than one channel
  assert.ok(water > 200, `drainage too sparse: ${water} water tiles`);
});

test("the downtown core and the works exist in every town (quality sweep)", () => {
  // A real Main Street has its bank, post office, diner, cinema, office and
  // library; a real farm town has its factory. Pre-sweep these missed more
  // seeds than they hit (Factory 4/6, PostOffice 5/6) — anchored now with
  // size/district fallbacks + a deterministic nearest-tile last resort.
  for (const seed of SEEDS) {
    const w = generateWorld(seed, 96, 96);
    const present = new Set<number>();
    for (let t = 0; t < w.lot.length; t++) if (w.lot[t] !== 0) present.add(w.lot[t]!);
    for (const [name, kind] of [
      ["bank", Lot.Bank],
      ["post office", Lot.PostOffice],
      ["factory", Lot.Factory],
      ["cinema", Lot.Cinema],
      ["library", Lot.Library],
      ["diner", Lot.Diner],
      ["office", Lot.Office],
    ] as const) {
      assert.ok(present.has(kind), `seed ${seed}: no ${name}`);
    }
    // and the grocery is IN town, not on a farmstead (force-place spiral):
    // Stage 2 zoning puts it on the highway strip or downtown
    for (let t = 0; t < w.lot.length; t++) {
      if (w.lot[t] !== Lot.Supermarket) continue;
      const d = Math.hypot((t % 96) - 48, Math.floor(t / 96) - 48);
      assert.ok(d < 34, `seed ${seed}: supermarket ${d.toFixed(0)} tiles from town center`);
      assert.ok(w.district[t] === 3 || w.district[t] === 6, `seed ${seed}: supermarket outside Downtown/Commercial (district ${w.district[t]})`);
      break;
    }
  }
});

test("household/member names are pure and stable", () => {
  assert.equal(householdName(1234), householdName(1234));
  assert.equal(memberName(1234, 0), memberName(1234, 0));
  assert.notEqual(memberName(1234, 0), memberName(1234, 1));
  assert.ok(householdName(99).length >= 2);
});

test("every parking lot touches a road, and civic anchors park on their frontage (§2 rev. 6)", () => {
  for (const seed of SEEDS) {
    const w = generateWorld(seed, 96, 96);
    const width = 96;
    const road = (t: number): boolean => t >= 0 && t < w.terrain.length && w.terrain[t] === Terrain.Road;
    // every connected parking component must have at least one tile on a road
    const seen = new Set<number>();
    for (let t = 0; t < w.lot.length; t++) {
      if (w.lot[t] !== Lot.Parking || seen.has(t)) continue;
      const component: number[] = [];
      const queue = [t];
      seen.add(t);
      while (queue.length) {
        const c = queue.pop()!;
        component.push(c);
        for (const n of [c - 1, c + 1, c - width, c + width]) {
          if (n < 0 || n >= w.lot.length || seen.has(n)) continue;
          if (w.lot[n] === Lot.Parking) {
            seen.add(n);
            queue.push(n);
          }
        }
      }
      const touches = component.some((c) =>
        [c - 1, c + 1, c - width, c + width].some((n) => road(n)),
      );
      assert.ok(
        touches,
        `seed ${seed}: parking component at tile ${component[0]} (${component.length} tiles) touches no road`,
      );
    }
    // the big civic anchors carry an adjacent parking lot
    for (const [name, kind] of [
      ["supermarket", Lot.Supermarket],
      ["elementary school", Lot.School],
      ["high school", Lot.HighSchool],
      ["sheriff", Lot.Sheriff],
      ["fire station", Lot.FireStation],
    ] as const) {
      let hasLot = false;
      let exists = false;
      for (let t = 0; t < w.lot.length && !hasLot; t++) {
        if (w.lot[t] !== kind) continue;
        exists = true;
        for (const n of [t - 1, t + 1, t - width, t + width]) {
          if (n >= 0 && n < w.lot.length && w.lot[n] === Lot.Parking) hasLot = true;
        }
      }
      assert.ok(!exists || hasLot, `seed ${seed}: ${name} has no adjacent parking lot`);
    }
  }
});
