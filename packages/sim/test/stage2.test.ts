/**
 * Stage 2 — town plan v3 & terrain rules:
 *  - Rock (mountain ridges, desert mesas) is a natural wall: a full bot
 *    match never owns, claims or populates a rock tile;
 *  - every town type is a pure function of (seed, size, type);
 *  - town types differ (the per-type rng salt + morphology);
 *  - the plan pieces exist: courthouse square carrying Town Hall, one
 *    high-school campus with its stadium.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSim, generateWorld, step, seedRng, botTurn, botShouldAct, hashState,
  IntentType, Terrain, Lot, Landmark, type Intent, type TownType,
} from "../dist/index.js";
import { balance, ARCHES } from "./golden_helpers.ts";

const TYPES: TownType[] = ["farm", "lakeside", "desert", "mountain", "oceanside"];

test("rock is a natural wall: never owned, claimed or populated in a bot match", () => {
  const size = 64;
  const world = generateWorld(77, size, size, { townType: "mountain" });
  const rock: number[] = [];
  for (let t = 0; t < world.terrain.length; t++) if (world.terrain[t] === Terrain.Rock) rock.push(t);
  assert.ok(rock.length > size * size * 0.08, `only ${rock.length} rock tiles on a mountain map`);
  const spawns = ARCHES.map((a, i) => ({ id: i + 1, archetype: a }));
  const sim = createSim({ seed: 77, balance, world, spawns, timerTicks: 4000, foundingTicks: 1 });
  // spawn each cult on the open grass nearest a compass point
  const pts = [[16, 32], [48, 32], [32, 12], [32, 52]];
  const spawnAt = pts.map(([x, y]) => {
    for (let r = 0; r < size; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = x! + dx, yy = y! + dy;
          if (xx < 2 || yy < 2 || xx >= size - 2 || yy >= size - 2) continue;
          if (world.terrain[yy * size + xx] === Terrain.Grass) return yy * size + xx;
        }
    return -1;
  });
  step(sim, { n: 0, seedSlice: 1, intents: spawns.map((s, i) => ({ t: IntentType.SPAWN, player: s.id, tile: spawnAt[i]! })) }, balance);
  const rng = seedRng(77);
  const bots = spawns.map((s, i) => ({ playerId: s.id, tier: "church" as const, cadence: 6 + i, aggression: 2, grudge: 0 }));
  for (let n = 1; n <= 3000 && sim.status === 0; n++) {
    const intents: Intent[] = [];
    for (const b of bots) if (botShouldAct(b as any, sim.tick)) intents.push(...botTurn(sim, b as any, rng, balance));
    step(sim, { n, intents, seedSlice: (n * 2654435761) >>> 0 }, balance);
  }
  for (const t of rock) {
    assert.equal(sim.world.terrain[t], Terrain.Rock, `rock at ${t} changed terrain`);
    assert.equal(sim.world.owner[t], 0, `rock at ${t} owned`);
    assert.equal(sim.world.property[t], 0, `rock at ${t} claimed as property`);
    assert.equal(sim.world.pop[t], 0, `rock at ${t} populated`);
  }
  for (const b of sim.buildings) assert.notEqual(sim.world.terrain[b.tile], Terrain.Rock, "a building stands on rock");
});

test("every town type is deterministic and distinct", () => {
  const hashes = new Set<string>();
  for (const townType of TYPES) {
    const a = generateWorld(42, 64, 64, { townType });
    const b = generateWorld(42, 64, 64, { townType });
    const sa = createSim({ seed: 42, balance, world: a, spawns: [] });
    const sb = createSim({ seed: 42, balance, world: b, spawns: [] });
    assert.equal(hashState(sa), hashState(sb), `${townType} is not deterministic`);
    let roads = "";
    for (let t = 0; t < a.terrain.length; t++) roads += a.terrain[t] === Terrain.Road ? "1" : "0";
    hashes.add(roads);
  }
  assert.equal(hashes.size, TYPES.length, "two town types produced the same street plan");
});

test("the plan: a courthouse square holding Town Hall and one HS campus with its stadium", () => {
  for (const townType of TYPES) {
    for (const size of [64, 96]) {
      const w = generateWorld(11, size, size, { townType });
      const th = w.landmark.indexOf(Landmark.TownHall);
      assert.ok(th >= 0 && w.lot[th] === Lot.Courthouse, `${townType}@${size}: Town Hall not on the courthouse`);
      const hs = w.lot.filter((l) => l === Lot.HighSchool).length;
      assert.ok(hs === 8 || hs === 6, `${townType}@${size}: HS is ${hs} tiles, not one 4×2 (alt 3×2) building`);
      assert.ok(w.lot.includes(Lot.Track), `${townType}@${size}: no stadium`);
    }
  }
});
