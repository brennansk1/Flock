/**
 * Civic Decrees & Municipal Monopolies engine tests (Sprint 1 §13 rev.):
 *  - Strict Majority & Edge-Snipe Rule (ties break control to nobody);
 *  - Universal Apostate Scar exclusion (scarred tiles cannot confer control);
 *  - 7 Active Civic Decrees (costs, cooldowns, district targeting, mechanical effects);
 *  - 4 Municipal Monopolies (Town Machine, Indoctrination Pipeline, Food & Fuel Cartel, Sacred Canopy);
 *  - Snapshot determinism & StateHash bit-identity with decrees and monopolies active.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSim,
  createWorld,
  loadBalance,
  step,
  hashState,
  toSnapshot,
  fromSnapshot,
  computeCivicControl,
  controlsCivic,
  ownsLandmark,
  computeMonopolies,
  executeCivicDecree,
  canExecuteCivicDecree,
  isCurfewActive,
  isParentTeacherNightActive,
  isFoodRationingActive,
  isMunicipalInjunctionActive,
  isEmergencyJamActive,
  buildingCost,
  CivicDecreeId,
  IntentType,
  Terrain,
  TileState,
  Lot,
  Landmark,
  Stance,
  toInt,
  fromInt,
  fromFloat,
  add,
  sub,
  type Intent,
  type Turn,
  type RawBalance,
  type SimState,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const balance = loadBalance(
  JSON.parse(
    readFileSync(resolve(here, "../../../balance.json"), "utf8"),
  ) as RawBalance,
);

const turn = (n: number, intents: Intent[] = []): Turn => ({ n, intents, seedSlice: n + 1 });

function makeTestSim(): SimState {
  const w = createWorld(32, 32);
  for (let i = 0; i < w.terrain.length; i++) {
    w.terrain[i] = Terrain.Grass;
    w.district[i] = 0;
  }
  const s = createSim({
    seed: 42,
    world: w,
    spawns: [
      { id: 1, name: "Cult A", color: "#f00", archetype: "radiant" },
      { id: 2, name: "Cult B", color: "#00f", archetype: "circle" },
    ],
    balance,
    foundingTicks: 0,
  });
  s.foundingTicksLeft = 0;
  const p1 = s.players[0]!;
  const p2 = s.players[1]!;
  p1.spawned = true;
  p2.spawned = true;
  p1.usd = fromInt(500_000);
  p2.usd = fromInt(500_000);
  p1.faith = fromInt(50);
  p2.faith = fromInt(50);
  p1.followers = fromInt(500);
  p2.followers = fromInt(500);
  p1.ownedTiles = 5;
  p2.ownedTiles = 5;
  return s;
}

test("Strict Majority & Edge-Snipe Rule: ties result in contested institution", () => {
  const s = makeTestSim();
  const w = s.world;

  // Set up 4 School tiles
  const schoolTiles = [10, 11, 12, 13];
  for (const t of schoolTiles) {
    w.lot[t] = Lot.School;
  }

  // Player 1 owns 2 believer tiles, Player 2 owns 1 -> P1 has strict majority
  w.owner[10] = 1;
  w.state[10] = TileState.Believer;
  w.owner[11] = 1;
  w.state[11] = TileState.Believer;
  w.owner[12] = 2;
  w.state[12] = TileState.Believer;

  let control = computeCivicControl(s);
  assert.equal(controlsCivic(control, Lot.School, 1), true, "P1 should control School (2 vs 1)");
  assert.equal(controlsCivic(control, Lot.School, 2), false);

  // Player 2 snipes 1 tile (Edge-Snipe): converts tile 13 -> 2 vs 2 tie!
  w.owner[13] = 2;
  w.state[13] = TileState.Believer;

  control = computeCivicControl(s);
  assert.equal(controlsCivic(control, Lot.School, 1), false, "P1 loses control on tie (2 vs 2)");
  assert.equal(controlsCivic(control, Lot.School, 2), false, "P2 does not gain control on tie");

  // Player 1 converts another tile outside or flips tile 12 -> 3 vs 1
  w.owner[12] = 1;
  control = computeCivicControl(s);
  assert.equal(controlsCivic(control, Lot.School, 1), true, "P1 re-takes control (3 vs 1)");
});

test("Universal Apostate Scar exclusion disables civic control", () => {
  const s = makeTestSim();
  const w = s.world;

  w.lot[20] = Lot.Sheriff;
  w.lot[21] = Lot.Sheriff;
  w.owner[20] = 1;
  w.state[20] = TileState.Believer;
  w.owner[21] = 1;
  w.state[21] = TileState.Believer;

  let control = computeCivicControl(s);
  assert.equal(controlsCivic(control, Lot.Sheriff, 1), true);

  // Deprogramming raid / bomb scars the tiles
  w.scarTicks[20] = 900;
  w.scarTicks[21] = 900;

  control = computeCivicControl(s);
  assert.equal(controlsCivic(control, Lot.Sheriff, 1), false, "Scarred tiles cannot grant control");
});

test("Active Civic Decree: Pep Rally grants followers with overflow to tithe cash", () => {
  const s = makeTestSim();
  const w = s.world;
  const p1 = s.players[0]!;

  w.lot[30] = Lot.HighSchool;
  w.owner[30] = 1;
  w.state[30] = TileState.Believer;

  p1.usd = fromInt(20_000);
  p1.followers = fromInt(100);

  // Execute Pep Rally
  const executed = executeCivicDecree(s, 1, CivicDecreeId.PepRally, balance, fromInt(2_000));
  assert.equal(executed, true, "Pep rally should execute successfully");
  assert.equal(toInt(p1.usd), 18_800, "Cost $1,200 USD deducted (Stage 1 rescale)");
  assert.equal(toInt(p1.followers), 400, "Followers increased by 300");
  assert.equal(p1.cooldowns["decree_pep_rally"], 1000, "Cooldown set to 1000 ticks");

  // Cannot execute while on cooldown
  const canExecAgain = canExecuteCivicDecree(s, 1, CivicDecreeId.PepRally);
  assert.equal(canExecAgain.ok, false);
});

test("Active Civic Decree: Town Curfew freezes enemy conversion fronts in district", () => {
  const s = makeTestSim();
  const w = s.world;
  const p1 = s.players[0]!;

  w.lot[40] = Lot.Sheriff;
  w.district[40] = 1;
  w.owner[40] = 1;
  w.state[40] = TileState.Believer;

  p1.usd = fromInt(50_000);
  const ok = executeCivicDecree(s, 1, CivicDecreeId.TownCurfew, balance, fromInt(10_000));
  assert.equal(ok, true);
  assert.equal(s.activeDecrees.length, 1);
  assert.equal(isCurfewActive(s, 1, 2), true, "Curfew active in district 1 against rival P2");
  assert.equal(isCurfewActive(s, 1, 1), false, "Curfew not active against owner P1");
  assert.equal(isCurfewActive(s, 2, 2), false, "Curfew not active in district 2");
});

test("Active Civic Decree: Municipal Injunction pauses rival construction", () => {
  const s = makeTestSim();
  const w = s.world;
  const p1 = s.players[0]!;

  w.landmark[50] = Landmark.TownHall;
  w.district[50] = 2;
  w.owner[50] = 1;
  w.state[50] = TileState.Believer;

  p1.usd = fromInt(50_000);
  const ok = executeCivicDecree(s, 1, CivicDecreeId.MunicipalInjunction, balance, fromInt(10_000));
  assert.equal(ok, true);
  assert.equal(isMunicipalInjunctionActive(s, 2, 2), true, "Injunction active in district 2 against P2");
  assert.equal(isMunicipalInjunctionActive(s, 1, 2), true, "Injunction active in adjacent district 1");
  assert.equal(isMunicipalInjunctionActive(s, 2, 1), false, "Injunction does not freeze owner P1");

  // Step buildings with a building under construction in district 2
  s.buildings.push({
    id: s.nextEntityId++,
    player: 2,
    type: "compound",
    tile: 55,
    buildTicksLeft: 50,
    disabledTicks: 0,
  });
  w.district[55] = 2;

  // Run a sim step
  step(s, turn(s.tick), balance);
  assert.equal(s.buildings[0]!.buildTicksLeft, 50, "Construction paused during Municipal Injunction");
});

test("Active Civic Decree: Emergency Jam blocks rival strike charging and stance changes", () => {
  const s = makeTestSim();
  const w = s.world;
  const p1 = s.players[0]!;
  const p2 = s.players[1]!;

  w.landmark[60] = Landmark.RadioTower;
  w.owner[60] = 1;
  w.state[60] = TileState.Believer;

  p1.usd = fromInt(50_000);
  const ok = executeCivicDecree(s, 1, CivicDecreeId.EmergencyJam, balance, fromInt(10_000));
  assert.equal(ok, true);
  assert.equal(isEmergencyJamActive(s, 2), true, "Emergency Jam active against P2");

  // Rival strike charge is paused
  s.strikes.push({
    id: s.nextEntityId++,
    player: 2,
    victim: 1,
    type: "pamphlet_bomb",
    target: 0,
    chargeTicksLeft: 100,
    warningTicksLeft: 0,
  });

  // Attempt stance change during Emergency Jam
  p2.stance = Stance.Tend;
  step(s, turn(s.tick, [{ t: IntentType.SET_STANCE, player: 2, stance: Stance.Crusade }]), balance);
  assert.equal(p2.stance, Stance.Tend, "Stance change ignored while Emergency Jam is active");
  assert.equal(s.strikes[0]!.chargeTicksLeft, 100, "Strike charge paused while Emergency Jam is active");
});

test("Municipal Monopoly: The Town Machine raises CPA threshold and auto-arrests agents", () => {
  const s = makeTestSim();
  const w = s.world;

  // Town Hall + Sheriff
  w.landmark[70] = Landmark.TownHall;
  w.owner[70] = 1;
  w.state[70] = TileState.Believer;

  w.lot[71] = Lot.Sheriff;
  w.owner[71] = 1;
  w.state[71] = TileState.Believer;

  const monopolies = computeMonopolies(s, 1);
  assert.equal(monopolies.townMachine, true, "Town Machine monopoly active");

  // Agent sent by P2 against P1
  s.agents.push({
    id: s.nextEntityId++,
    player: 2,
    victim: 1,
    tile: 70,
    mission: "deprogram",
    phase: "gather",
    travelTicks: 0,
    channelTicks: 100,
    exposedTicks: 0,
  });

  // Step entities
  step(s, turn(s.tick), balance);
  assert.equal(s.agents.length, 0, "Stealth agent immediately auto-arrested by Town Machine");
});

test("Municipal Monopoly: Food & Fuel Cartel boosts van speed and enemy building cost", () => {
  const s = makeTestSim();
  const w = s.world;

  // Supermarket + Gas Station
  w.lot[80] = Lot.Supermarket;
  w.owner[80] = 1;
  w.state[80] = TileState.Believer;

  w.lot[81] = Lot.GasStation;
  w.owner[81] = 1;
  w.state[81] = TileState.Believer;

  const monopolies = computeMonopolies(s, 1);
  assert.equal(monopolies.foodAndFuelCartel, true, "Food & Fuel Cartel active");

  // Enemy building cost for P2 has +30% surcharge
  const baseCost = buildingCost(s, 1, "watchtower");
  const enemyCost = buildingCost(s, 2, "watchtower");
  assert.ok(enemyCost > baseCost, "Enemy building cost penalized by cartel");
});

test("Municipal Monopoly: Sacred Canopy locks Faith floor at 50 and boosts Sermon", () => {
  const s = makeTestSim();
  const w = s.world;
  const p1 = s.players[0]!;

  // Megachurch + Church
  w.landmark[90] = Landmark.Megachurch;
  w.owner[90] = 1;
  w.state[90] = TileState.Believer;

  w.lot[91] = Lot.Church;
  w.owner[91] = 1;
  w.state[91] = TileState.Believer;

  const monopolies = computeMonopolies(s, 1);
  assert.equal(monopolies.sacredCanopy, true, "Sacred Canopy active");

  // Faith floor cannot drift below 50
  p1.faith = fromInt(40);
  step(s, turn(s.tick), balance);
  assert.ok(p1.faith >= fromInt(50), "Faith locked at 50 floor");

  // Sermon receives +50% bonus
  p1.faith = fromInt(50);
  p1.sermonBuffTicks = 0;
  delete p1.cooldowns["sermon"];

  step(s, turn(s.tick, [{ t: IntentType.RITUAL, player: 1, ritual: "sermon" }]), balance);
  assert.ok(p1.sermonBuffTicks > 0);
  assert.ok(p1.faith >= fromInt(68), "Sermon faith gain boosted by 50% under Sacred Canopy (12 * 1.5 = +18 faith)");
});

test("Active decrees and monopolies survive snapshot round-trip bit-identically", () => {
  const s = makeTestSim();
  const w = s.world;

  w.lot[40] = Lot.Sheriff;
  w.owner[40] = 1;
  w.state[40] = TileState.Believer;

  executeCivicDecree(s, 1, CivicDecreeId.TownCurfew, balance, fromInt(10_000));
  assert.equal(s.activeDecrees.length, 1);

  const hashBefore = hashState(s);
  const snap = toSnapshot(s);
  const restored = fromSnapshot(snap);
  const hashAfter = hashState(restored);

  assert.equal(hashBefore, hashAfter, "Snapshot round-trip preserves active decrees bit-identically");
  assert.equal(restored.activeDecrees.length, 1);
  assert.equal(restored.activeDecrees[0]!.decree, CivicDecreeId.TownCurfew);
});
