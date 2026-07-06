/**
 * Property + civics engine tests (§18 rev. / §13 rev.):
 *  - SPAWN founds a wilderness parcel: property claimed, woods felled, the
 *    First Compound standing, congregation bused in, zero owned tiles — and
 *    the player is NOT eliminated (buildings keep a landless cult alive);
 *  - BUILD in the wilderness requires your own property;
 *  - BUY_PROPERTY: escalating cost, must adjoin the empire;
 *  - crowding: a full parcel sags the follower cap;
 *  - compound outreach lets fronts press town tiles without adjacency;
 *  - civic control computes deterministically and its effects move the
 *    engines (sheriff → faster heat decay);
 *  - everything round-trips the snapshot hash-identically.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSim,
  createWorld,
  generateWorld,
  loadBalance,
  step,
  hashState,
  toSnapshot,
  fromSnapshot,
  followerCap,
  propertyStats,
  propertyCost,
  buildingCost,
  computeCivicControl,
  IntentType,
  Terrain,
  TileState,
  Lot,
  toInt,
  fromInt,
  type Intent,
  type Turn,
  type RawBalance,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const balance = loadBalance(
  JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance,
);

const turn = (n: number, intents: Intent[] = []): Turn => ({ n, intents, seedSlice: n + 1 });

/** 32×32: town block of citizen tiles in the middle, wilderness around it. */
function tinyWorld(): ReturnType<typeof createWorld> {
  const w = createWorld(32, 32);
  w.terrain.fill(Terrain.Grass);
  for (let y = 12; y < 20; y++) {
    for (let x = 12; x < 20; x++) {
      const t = y * 32 + x;
      w.terrain[t] = Terrain.Citizen;
      w.pop[t] = 4;
      w.susceptibility[t] = fromInt(60);
    }
  }
  // some woods where the parcel will land
  w.terrain[4 * 32 + 4] = Terrain.Woods;
  w.terrain[4 * 32 + 5] = Terrain.Woods;
  return w;
}

test("SPAWN founds a wilderness property with compound, felled trees, bused congregation", () => {
  const w = tinyWorld();
  const s = createSim({ seed: 1, balance, world: w, spawns: [{ id: 1, archetype: "dawn" }] });
  step(s, turn(0, [{ t: IntentType.SPAWN, player: 1, tile: 4 * 32 + 4 }]), balance);
  const p = s.players[0]!;
  assert.ok(p.spawned, "spawned");
  assert.equal(p.parcels, 1);
  const stats = propertyStats(s, 1);
  assert.ok(stats.tiles >= 15, `parcel claimed (${stats.tiles} tiles)`);
  assert.ok(
    s.buildings.some((b) => b.player === 1 && b.type === "compound" && b.buildTicksLeft === 0),
    "First Compound stands",
  );
  // the woods inside the parcel were felled
  assert.notEqual(w.terrain[4 * 32 + 4], Terrain.Woods);
  assert.ok(toInt(p.followers) > 0, "congregation bused in");
  assert.equal(p.ownedTiles, 0, "no town tiles yet");
  // run a few ticks: landless-but-housed cult must survive elimination
  for (let i = 1; i < 20; i++) step(s, turn(i), balance);
  assert.ok(s.players[0]!.alive, "compound keeps the cult alive at 0 tiles");
});

test("wilderness BUILD requires own property; BUY_PROPERTY expands the empire", () => {
  const w = tinyWorld();
  const s = createSim({ seed: 2, balance, world: w, spawns: [{ id: 1, archetype: "circle" }] });
  step(s, turn(0, [{ t: IntentType.SPAWN, player: 1, tile: 4 * 32 + 4 }]), balance);
  const p = s.players[0]!;
  p.usd = fromInt(500_000);

  // off-property wilderness build must be rejected
  const offProperty = 25 * 32 + 25;
  const before = s.buildings.length;
  step(s, turn(1, [{ t: IntentType.BUILD, player: 1, building: "collection_plate", tile: offProperty }]), balance);
  assert.equal(s.buildings.length, before, "off-property build rejected");

  // buy land next door (linked), then build on it
  const usd0 = toInt(p.usd);
  const target = 4 * 32 + 10; // within max_link_dist of the parcel
  step(s, turn(2, [{ t: IntentType.BUY_PROPERTY, player: 1, tile: target }]), balance);
  assert.equal(p.parcels, 2, "second parcel bought");
  assert.ok(toInt(p.usd) < usd0, "land costs money");
  const cost1 = toInt(propertyCost(p, balance));
  assert.ok(cost1 > toInt(balance.property.baseCost), "price escalates per parcel");

  // far, unlinked purchase is rejected
  const far = 30 * 32 + 30;
  step(s, turn(3, [{ t: IntentType.BUY_PROPERTY, player: 1, tile: far }]), balance);
  assert.equal(p.parcels, 2, "unlinked land rejected");

  // now a build on the new parcel succeeds
  const w2 = s.world;
  let site = -1;
  for (let t = 0; t < w2.property.length && site < 0; t++) {
    if (w2.property[t] === 1 && !s.buildings.some((b) => b.tile === t)) site = t;
  }
  step(s, turn(4, [{ t: IntentType.BUILD, player: 1, building: "collection_plate", tile: site }]), balance);
  assert.ok(s.buildings.some((b) => b.tile === site), "on-property build accepted");
});

test("crowding: a full parcel sags the follower cap until more land is bought", () => {
  const w = tinyWorld();
  const s = createSim({ seed: 3, balance, world: w, spawns: [{ id: 1, archetype: "radiant" }] });
  step(s, turn(0, [{ t: IntentType.SPAWN, player: 1, tile: 4 * 32 + 4 }]), balance);
  const p = s.players[0]!;
  const roomyCap = toInt(followerCap(p, balance, s));
  // pave the parcel with buildings until fewer than crowding_free_tiles remain
  const stats0 = propertyStats(s, 1);
  let placed = 0;
  for (let t = 0; t < s.world.property.length && stats0.free - placed >= balance.property.crowdingFreeTiles; t++) {
    if (s.world.property[t] !== 1) continue;
    if (s.buildings.some((b) => b.tile === t)) continue;
    s.buildings.push({ id: s.nextEntityId++, player: 1, type: "watchtower", tile: t, buildTicksLeft: 0, disabledTicks: 0 });
    placed++;
  }
  const crowdedCap = toInt(followerCap(p, balance, s));
  assert.ok(crowdedCap < roomyCap, `crowded cap ${crowdedCap} < roomy ${roomyCap}`);
});

test("compound outreach: fronts press town tiles without territory adjacency", () => {
  const w = tinyWorld();
  const s = createSim({ seed: 4, balance, world: w, spawns: [{ id: 1, archetype: "dawn" }] });
  // spawn ~4 tiles from the town edge — inside outreach, outside adjacency
  step(s, turn(0, [{ t: IntentType.SPAWN, player: 1, tile: 8 * 32 + 8 }]), balance);
  const townTile = 13 * 32 + 13;
  step(s, turn(1, [{ t: IntentType.OPEN_FRONT, player: 1, tiles: [townTile, townTile + 1, townTile + 32] }]), balance);
  for (let i = 2; i < 400 && s.players[0]!.ownedTiles === 0; i++) step(s, turn(i), balance);
  assert.ok(s.players[0]!.ownedTiles > 0, "outreach front flipped town tiles from the compound");
});

test("civics: control resolves deterministically and the sheriff cools Heat faster", () => {
  const w = tinyWorld();
  // plant a 2-tile sheriff station in town
  const s1 = 13 * 32 + 14;
  w.lot[s1] = Lot.Sheriff;
  w.lot[s1 + 1] = Lot.Sheriff;
  const s = createSim({
    seed: 5,
    balance,
    world: w,
    spawns: [
      { id: 1, archetype: "dawn" },
      { id: 2, archetype: "circle" },
    ],
  });
  step(s, turn(0, [
    { t: IntentType.SPAWN, player: 1, tile: 8 * 32 + 8 },
    { t: IntentType.SPAWN, player: 2, tile: 24 * 32 + 24 },
  ]), balance);

  // player 1 converts both sheriff tiles
  w.owner[s1] = 1;
  w.state[s1] = TileState.Believer;
  w.owner[s1 + 1] = 1;
  w.state[s1 + 1] = TileState.Believer;
  s.players[0]!.ownedTiles += 2;

  const control = computeCivicControl(s);
  assert.equal(control.get(Lot.Sheriff), 1, "player 1 controls the sheriff");

  // heat decays faster for the controller than for the rival
  s.players[0]!.heat = fromInt(50);
  s.players[1]!.heat = fromInt(50);
  for (let i = 1; i <= 100; i++) step(s, turn(i), balance);
  const h1 = toInt(s.players[0]!.heat);
  const h2 = toInt(s.players[1]!.heat);
  assert.ok(h1 < h2, `sheriff controller cools faster (${h1} < ${h2})`);
});

test("§2A anchors: the granary pays and the sawmill discounts (B1.4.20)", () => {
  const w = tinyWorld();
  const g1 = 12 * 32 + 18;
  w.lot[g1] = Lot.GrainElevator;
  w.lot[g1 + 1] = Lot.GrainElevator;
  const sm = 13 * 32 + 18;
  w.lot[sm] = Lot.Sawmill;
  // SAME archetype both seats: the A/B must isolate the anchor mult, not
  // compare dawn-vs-circle income coefficients
  const s = createSim({
    seed: 9,
    balance,
    world: w,
    spawns: [
      { id: 1, archetype: "dawn" },
      { id: 2, archetype: "dawn" },
    ],
  });
  step(s, turn(0, [
    { t: IntentType.SPAWN, player: 1, tile: 4 * 32 + 4 },
    { t: IntentType.SPAWN, player: 2, tile: 27 * 32 + 27 },
  ]), balance);

  // player 1 converts the granary + the sawmill
  for (const t of [g1, g1 + 1, sm]) {
    w.owner[t] = 1;
    w.state[t] = TileState.Believer;
  }
  s.players[0]!.ownedTiles += 3;
  const control = computeCivicControl(s);
  assert.equal(control.get(Lot.GrainElevator), 1, "player 1 holds the granary");
  assert.equal(control.get(Lot.Sawmill), 1, "player 1 holds the sawmill");

  // SAWMILL: lumber at cost — the holder builds cheaper, price is visible
  const c1 = toInt(buildingCost(s, 1, "watchtower", control, balance));
  const c2 = toInt(buildingCost(s, 2, "watchtower", control, balance));
  assert.ok(c1 < c2, `sawmill holder builds cheaper (${c1} < ${c2})`);

  // GRANARY: the harvest money flows — same followers, richer tithe
  s.players[0]!.followers = s.players[1]!.followers;
  s.players[0]!.usdEarned = fromInt(0);
  s.players[1]!.usdEarned = fromInt(0);
  for (let i = 1; i <= 100; i++) step(s, turn(i), balance);
  const e1 = toInt(s.players[0]!.usdEarned);
  const e2 = toInt(s.players[1]!.usdEarned);
  assert.ok(e1 > e2, `granary holder earns more (${e1} > ${e2})`);
});

test("§2A anchors: the lighthouse extends compound outreach (B1.4.20)", () => {
  const w = tinyWorld();
  // lighthouse at the town's FAR corner from the target (creep can't confound)
  const lh = 19 * 32 + 19;
  w.lot[lh] = Lot.Lighthouse;
  w.pop[lh] = 0;
  const s = createSim({ seed: 10, balance, world: w, spawns: [{ id: 1, archetype: "dawn" }] });
  // compound at (4,4); town corner (12,12) is ~11.3 away — OUTSIDE the base
  // outreach radius (10), INSIDE the lighthouse-boosted reach (12)
  step(s, turn(0, [{ t: IntentType.SPAWN, player: 1, tile: 4 * 32 + 4 }]), balance);
  const target = 12 * 32 + 12;
  step(s, turn(1, [{ t: IntentType.OPEN_FRONT, player: 1, tiles: [target] }]), balance);
  for (let i = 2; i <= 250; i++) step(s, turn(i), balance);
  assert.notEqual(w.owner[target], 1, "out of reach without the lighthouse");

  // hand player 1 the light — the beacon draws seekers
  w.owner[lh] = 1;
  w.state[lh] = TileState.Believer;
  s.players[0]!.ownedTiles += 1;
  assert.equal(computeCivicControl(s).get(Lot.Lighthouse), 1);
  let flipped = false;
  for (let i = 251; i <= 900 && !flipped; i++) {
    step(s, turn(i), balance);
    flipped = w.owner[target] === 1;
  }
  assert.ok(flipped, "the same front reaches the target once the light is held");
});

test("property + parcels survive the snapshot round-trip hash-identically", () => {
  const w = generateWorld(31, 64, 64);
  const s = createSim({ seed: 31, balance, world: w, spawns: [{ id: 1, archetype: "visitors" }] });
  // spawn somewhere — the sim spirals to valid open land
  step(s, turn(0, [{ t: IntentType.SPAWN, player: 1, tile: 5 }]), balance);
  for (let i = 1; i < 30; i++) step(s, turn(i), balance);
  const restored = fromSnapshot(toSnapshot(s));
  assert.equal(hashState(restored), hashState(s));
  assert.equal(restored.players[0]!.parcels, s.players[0]!.parcels);
  assert.deepEqual([...restored.world.property], [...s.world.property]);
});
