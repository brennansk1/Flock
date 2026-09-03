import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSim,
  createWorld,
  step,
  loadBalance,
  fromInt,
  toInt,
  fromFloat,
  ONE,
  div,
  NEUTRAL,
  Terrain,
  TileState,
  Lot,
  Landmark,
  IntentType,
  PROGRESS_STRIDE,
  territoryPixel,
  renderTown,
  newPlayer,
  type SimState,
  type PlayerState,
  type Turn,
  type Intent,
  type RawBalance,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const balance = loadBalance(
  JSON.parse(
    readFileSync(resolve(here, "../../../balance.json"), "utf8"),
  ) as RawBalance,
);

const turn = (n: number, intents: Intent[] = []): Turn => ({ n, intents, seedSlice: n + 1 });
const TPS = 10;

function makeTestSim(): SimState {
  const w = createWorld(32, 32);
  for (let i = 0; i < w.terrain.length; i++) {
    w.terrain[i] = Terrain.Grass;
    w.district[i] = 0;
    w.owner[i] = NEUTRAL;
    w.state[i] = TileState.Neutral;
    w.lot[i] = Lot.None;
    w.landmark[i] = Landmark.None;
  }
  const s = createSim({
    seed: 42,
    world: w,
    spawns: [
      { id: 1, name: "Cult 1", color: "#f00", archetype: "dawn" },
      { id: 2, name: "Cult 2", color: "#0f0", archetype: "radiant" },
      { id: 3, name: "Cult 3", color: "#00f", archetype: "circle" },
      { id: 4, name: "Cult 4", color: "#ff0", archetype: "visitors" },
    ],
    balance,
    foundingTicks: 0,
  });
  s.foundingTicksLeft = 0;
  for (const p of s.players) {
    p.spawned = true;
    p.ownedTiles = 5;
    p.usd = fromInt(100_000);
    p.followers = fromInt(500);
    p.faith = fromInt(50);
  }
  return s;
}

test("Archetype Growth: Radiant Path grows faster than Prosperity Circle", () => {
  const s = makeTestSim();
  const p1 = newPlayer(1, "dawn", balance);
  p1.ownedTiles = 10;
  p1.followers = fromInt(200);
  p1.faith = fromInt(50);

  const p2 = newPlayer(2, "radiant", balance);
  p2.ownedTiles = 10;
  p2.followers = fromInt(200);
  p2.faith = fromInt(50);

  const p3 = newPlayer(3, "circle", balance);
  p3.ownedTiles = 10;
  p3.followers = fromInt(200);
  p3.faith = fromInt(50);

  s.players = [p1, p2, p3];

  // Advance 20 seconds (200 ticks)
  for (let t = 0; t < 20 * TPS; t++) {
    step(s, turn(s.tick, []), balance);
  }

  // Radiant (growth 1.1) should have more followers than Circle (growth 0.9)
  assert.ok(
    p2.followers > p3.followers,
    `Radiant (${toInt(p2.followers)}) should exceed Circle (${toInt(p3.followers)}) in follower growth`,
  );
});

test("Final Dawn Doomsday Bunker: church explodes into apostate scar if captured", () => {
  const s = makeTestSim();
  const p1 = newPlayer(1, "dawn", balance);
  p1.ownedTiles = 5;
  p1.followers = fromInt(500);

  const p2 = newPlayer(2, "radiant", balance);
  p2.ownedTiles = 5;
  p2.followers = fromInt(500);

  s.players = [p1, p2];

  // Set up a church on tiles 10 and 11 owned by Dawn
  s.world.terrain[10] = Terrain.Citizen;
  s.world.terrain[11] = Terrain.Citizen;
  s.world.pop[10] = 10;
  s.world.pop[11] = 10;
  s.world.lot[10] = Lot.Church;
  s.world.lot[11] = Lot.Church;
  s.world.owner[10] = 1;
  s.world.owner[11] = 1;
  s.world.state[10] = TileState.Believer;
  s.world.state[11] = TileState.Believer;

  // Simulate rival player 2 having accumulated enough progress to flip tile 10
  s.progress.set(10 * PROGRESS_STRIDE + 2, fromInt(200));

  // Run 1 tick
  step(s, turn(s.tick, []), balance);

  // Both tiles 10 and 11 of the church lot should have detonated into an apostate scar
  assert.equal(s.world.state[10], TileState.Apostate, "Detonated tile 10 should be Apostate");
  assert.equal(s.world.state[11], TileState.Apostate, "Detonated tile 11 should be Apostate");
  assert.equal(s.world.owner[10], NEUTRAL, "Detonated tile 10 should be Neutral");
  assert.equal(s.world.owner[11], NEUTRAL, "Detonated tile 11 should be Neutral");
  assert.ok(s.world.scarTicks[10]! > 0, "Detonated tile should have scar ticks");
  assert.ok(s.world.scarTicks[11]! > 0, "Detonated sibling tile should have scar ticks");
});

test("Prosperity Circle Franchise Megacenter: bank triples courier cash generation", () => {
  const s = makeTestSim();
  const p1 = newPlayer(1, "circle", balance);
  p1.ownedTiles = 10;
  s.players = [p1];

  // Place bank owned by p1
  s.world.lot[5] = Lot.Bank;
  s.world.owner[5] = 1;
  s.world.state[5] = TileState.Believer;

  // Two operational collection plates with nearby believers for staffing
  s.world.terrain[10] = Terrain.Citizen;
  s.world.terrain[20] = Terrain.Citizen;
  s.world.pop[10] = 50;
  s.world.pop[20] = 50;
  s.world.owner[10] = 1;
  s.world.owner[20] = 1;
  s.world.state[10] = TileState.Believer;
  s.world.state[20] = TileState.Believer;

  s.buildings = [
    {
      id: 1,
      player: 1,
      type: "collection_plate",
      tile: 10,
      buildTicksLeft: 0,
      disabledTicks: 0,
      hp: fromInt(100),
      maxHp: fromInt(100),
    },
    {
      id: 2,
      player: 1,
      type: "collection_plate",
      tile: 20,
      buildTicksLeft: 0,
      disabledTicks: 0,
      hp: fromInt(100),
      maxHp: fromInt(100),
    },
  ];

  // Step to spawn courier at 20s mark (200 ticks)
  s.tick = 20 * TPS;
  step(s, turn(s.tick, []), balance);

  assert.equal(s.couriers.length, 1, "Should have spawned 1 courier");
  const c = s.couriers[0]!;
  // Path length between tile 10 and 20 is 11 tiles
  // Base courierPerTile = 4 => 4 * 11 = $44.
  // With Franchise Megacenter 3x bonus => $132.
  const baseExpected = 4 * c.path.length;
  assert.equal(
    toInt(c.usd),
    baseExpected * 3,
    `Courier cash should be tripled to $${baseExpected * 3}`,
  );
});

test("Visitors Deep Space Transmitter: Radio Tower eliminates strike warning telegraph", () => {
  const s = makeTestSim();
  const p1 = newPlayer(1, "visitors", balance);
  p1.ownedTiles = 10;
  p1.usd = fromInt(500000);

  const p2 = newPlayer(2, "dawn", balance);
  p2.ownedTiles = 10;
  s.players = [p1, p2];

  // P1 owns Radio Tower landmark and has a staffed broadcast tower
  s.world.landmark[8] = Landmark.RadioTower;
  s.world.owner[8] = 1;
  s.world.state[8] = TileState.Believer;
  s.world.pop[8] = 100;

  s.buildings = [
    {
      id: 1,
      player: 1,
      type: "broadcast_tower",
      tile: 8,
      buildTicksLeft: 0,
      disabledTicks: 0,
      hp: fromInt(100),
      maxHp: fromInt(100),
    },
  ];

  // Target tile owned by p2
  s.world.owner[15] = 2;
  s.world.state[15] = TileState.Believer;

  // Launch pamphlet bomb strike
  step(
    s,
    turn(s.tick, [
      {
        player: 1,
        t: IntentType.STRIKE,
        strike: "pamphlet_bomb",
        target: 15,
      },
    ]),
    balance,
  );

  assert.equal(s.strikes.length, 1, "Strike should be created");
  const strike = s.strikes[0]!;
  assert.equal(
    strike.warningTicksLeft,
    0,
    "Deep Space Transmitter should set warningTicksLeft to 0 (no warning telegraph)",
  );
});

test("Territory pattern styling returns unique RGB colors for each archetype", () => {
  const baseColor: [number, number, number] = [100, 100, 100];
  const dawnCol = territoryPixel(baseColor, "dawn", 0, 7);
  const radiantCol = territoryPixel(baseColor, "radiant", 11, 7);
  const circleCol = territoryPixel(baseColor, "circle", 4, 2);
  const visitorsCol = territoryPixel(baseColor, "visitors", 5, 5);

  assert.deepEqual(dawnCol, [184, 46, 31], "Dawn fracture line should be molten crimson");
  assert.deepEqual(radiantCol, [150, 120, 182], "Radiant speckle should be floral lavender");
  assert.deepEqual(circleCol, [197, 160, 89], "Circle pinstripe should be metallic gold");
  assert.ok(visitorsCol.length === 3, "Visitors pixel should render valid RGB");
});

test("Procedural asset render pipeline runs smoothly with custom compounds, vans, and agents", () => {
  const s = makeTestSim();
  const p1 = newPlayer(1, "dawn", balance);
  p1.ownedTiles = 5;
  const p2 = newPlayer(2, "radiant", balance);
  p2.ownedTiles = 5;
  const p3 = newPlayer(3, "circle", balance);
  p3.ownedTiles = 5;
  const p4 = newPlayer(4, "visitors", balance);
  p4.ownedTiles = 5;
  s.players = [p1, p2, p3, p4];

  // Compounds for all 4 archetypes
  s.buildings = [
    { id: 1, player: 1, type: "compound", tile: 2, buildTicksLeft: 0, disabledTicks: 0, hp: fromInt(100), maxHp: fromInt(100) },
    { id: 2, player: 2, type: "compound", tile: 4, buildTicksLeft: 0, disabledTicks: 0, hp: fromInt(100), maxHp: fromInt(100) },
    { id: 3, player: 3, type: "compound", tile: 6, buildTicksLeft: 0, disabledTicks: 0, hp: fromInt(100), maxHp: fromInt(100) },
    { id: 4, player: 4, type: "compound", tile: 8, buildTicksLeft: 0, disabledTicks: 0, hp: fromInt(100), maxHp: fromInt(100) },
  ];

  // Vans for all 4 archetypes
  s.vans = [
    { id: 1, player: 1, path: [2, 3], idx: 0, moveProgress: 0, tile: 2, health: 100 },
    { id: 2, player: 2, path: [4, 5], idx: 0, moveProgress: 0, tile: 4, health: 100 },
    { id: 3, player: 3, path: [6, 7], idx: 0, moveProgress: 0, tile: 6, health: 100 },
    { id: 4, player: 4, path: [8, 9], idx: 0, moveProgress: 0, tile: 8, health: 100 },
  ];

  // Agents for all 4 archetypes
  s.agents = [
    { id: 1, player: 1, targetDistrict: 0, tile: 2, mission: "deprogram", victim: 2, phase: "gather", progress: 0, exposedTicks: 10 },
    { id: 2, player: 2, targetDistrict: 0, tile: 4, mission: "deprogram", victim: 3, phase: "gather", progress: 0, exposedTicks: 10 },
    { id: 3, player: 3, targetDistrict: 0, tile: 6, mission: "deprogram", victim: 4, phase: "gather", progress: 0, exposedTicks: 10 },
    { id: 4, player: 4, targetDistrict: 0, tile: 8, mission: "deprogram", victim: 1, phase: "gather", progress: 0, exposedTicks: 10 },
  ];

  // Render town should produce non-empty frame data without throwing
  const frame = renderTown(s);
  assert.ok(frame.data.length > 0, "Rendered frame should contain byte data");
  assert.equal(frame.width, s.world.width * 8);
  assert.equal(frame.height, s.world.height * 8);
});
