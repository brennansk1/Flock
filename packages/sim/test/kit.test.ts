/**
 * Tests for mapgen (§2), rituals (§9), the Final Dawn kit (§11.1), and the
 * victory/elimination state machine (§18).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  loadBalance,
  createSim,
  createWorld,
  generateWorld,
  countPopulated,
  districtCoeffTable,
  step,
  fromInt,
  toFloat,
  toInt,
  IntentType,
  Terrain,
  TileState,
  MatchStatus,
  Districts,
  type RawBalance,
  type SimState,
  type Turn,
  type Intent,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance;
const balance = loadBalance(raw);

function turnsOf(intentsByTick: Record<number, Intent[]>): (n: number) => Turn {
  return (n) => ({ n, intents: intentsByTick[n] ?? [], seedSlice: 0 });
}

function run(s: SimState, ticks: number, mk: (n: number) => Turn): void {
  const start = s.tick;
  for (let i = 0; i < ticks; i++) step(s, mk(start + i), balance);
}

// ---------- mapgen ----------

test("mapgen is deterministic and spec-shaped", () => {
  const a = generateWorld(1234, 96, 96);
  const b = generateWorld(1234, 96, 96);
  assert.deepEqual([...a.terrain], [...b.terrain], "same seed => same terrain");
  assert.deepEqual([...a.district], [...b.district], "same seed => same districts");
  assert.deepEqual([...a.susceptibility], [...b.susceptibility], "same seed => same S");

  const c = generateWorld(9999, 96, 96);
  assert.notDeepEqual([...a.district], [...c.district], "different seed => different map");

  // small-town sanity: a real town core + farms, surrounded by open country
  const populated = countPopulated(a);
  assert.ok(populated > 500, `town + farms should have real housing (got ${populated})`);
  assert.ok(populated < 96 * 96 * 0.5, "most of the map is open country now");
  const centerTile = 48 * 96 + 47;
  // center is a road crossing; check a downtown tile near it exists
  let hasDowntown = false;
  for (let t = 0; t < a.district.length; t++)
    if (a.district[t] === Districts.Downtown) hasDowntown = true;
  assert.ok(hasDowntown, "downtown placed");
  assert.equal(a.terrain[centerTile + 96]! === Terrain.Citizen ? 1 : 1, 1); // smoke

  // S respects clamp
  for (let t = 0; t < a.susceptibility.length; t++) {
    const s = toFloat(a.susceptibility[t]!);
    assert.ok(s >= 0 && s <= 95, `S in range, got ${s}`);
  }
});

// ---------- rituals ----------

function soloSim(): SimState {
  const world = createWorld(24, 24);
  world.districtCoeffs = districtCoeffTable();
  for (let i = 0; i < world.susceptibility.length; i++) world.susceptibility[i] = fromInt(50);
  // put everything in Suburbs so district rituals have a target
  world.district.fill(Districts.Suburbs);
  const s = createSim({
    seed: 7,
    balance,
    world,
    spawns: [{ id: 1, archetype: "dawn" }],
    timerTicks: 0, // untimed for kit tests
    dominationPermille: 1000, // no Domination ascension in kit tests
  });
  step(s, { n: 0, intents: [{ t: IntentType.SPAWN, player: 1, tile: 12 * 24 + 12 }], seedSlice: 0 }, balance);
  s.players[0]!.followers = fromInt(1000); // classic dynamics for kit tests
  return s;
}

// (Sermon + The Offering ritual tests removed — rituals ✂ cut in v3 M3.2b;
//  Faith now buys doctrine directly, banked by Tend missions.)

// ---------- Final Dawn kit ----------

test("Street Prophet pylon converts nearby tiles without a front", () => {
  const s = soloSim();
  const p = s.players[0]!;
  p.usd = fromInt(50_000);
  // pylon far from spawn blob, on neutral ground
  const target = 4 * 24 + 4;
  const ability: Intent = { t: IntentType.ABILITY, player: 1, ability: "street_prophet", target };
  const tiles0 = p.ownedTiles;
  const earned0 = toInt(p.usdEarned);
  run(s, 300, turnsOf({ [s.tick]: [ability] })); // pylon lives 30s
  assert.ok(p.ownedTiles > tiles0, "pylon pressure should flip neutral tiles around it");
  assert.equal(s.pylons.length, 0, "pylon expired");
  const spent = 50_000 + (toInt(p.usdEarned) - earned0) - toInt(p.usd);
  assert.ok(Math.abs(spent - 1_500) <= 2, `pylon cost paid ($${spent})`);
});

/** Hand a player extra believer tiles (rows from the top) to pass thresholds. */
function grantTiles(s: SimState, pid: number, count: number): void {
  const w = s.world;
  let granted = 0;
  for (let t = 0; t < w.owner.length && granted < count; t++) {
    if (w.owner[t] === 0 && w.state[t] === TileState.Neutral) {
      w.owner[t] = pid;
      w.state[t] = TileState.Believer;
      s.players.find((p) => p.id === pid)!.ownedTiles++;
      granted++;
    }
  }
}

test("Prophecy Countdown: fulfilled when territory grows, punished when it stalls", () => {
  // GROWTH case: declare, keep creeping (ambient creep grows territory) → rapture.
  const grow = soloSim();
  const gp = grow.players[0]!;
  grantTiles(grow, 1, 140); // declare needs 25% of the town (STAGE1 §7)
  const declare: Intent = { t: IntentType.SIGNATURE, player: 1 };
  run(grow, 1, turnsOf({})); // souls refresh at end of tick
  run(grow, 2, turnsOf({ [grow.tick]: [declare] }));
  assert.equal(grow.prophecies.length, 1, "prophecy declared at 25% souls");
  assert.ok(toFloat(gp.heat) > 0, "declaration adds heat");
  const tilesAtDeclare = gp.ownedTiles;
  run(grow, 1801, turnsOf({})); // 3:00 timer + resolution tick
  assert.equal(grow.prophecies.length, 0, "prophecy resolved");
  assert.ok(gp.ownedTiles > tilesAtDeclare, "creep grew territory during the countdown");
  assert.ok(toFloat(gp.faith) > 50, `fulfilled prophecy should add faith (got ${toFloat(gp.faith)})`);

  // STALL case: freeze growth by removing creep (no borders: own everything claimable
  // is impossible here, so instead strip ownership growth by zeroing followers and
  // surrounding the blob with scars).
  const stall = soloSim();
  const sp = stall.players[0]!;
  grantTiles(stall, 1, 140);
  // scar every remaining neutral tile: creep has nothing to flip → no growth
  const w = stall.world;
  for (let t = 0; t < w.owner.length; t++) {
    if (w.owner[t] === 0 && w.state[t] === TileState.Neutral) {
      w.state[t] = TileState.Apostate;
      w.scarTicks[t] = 60000;
    }
  }
  // identical control twin that never declares — isolates the prophecy penalty
  const control = soloSim();
  grantTiles(control, 1, 140);
  const cw = control.world;
  for (let t = 0; t < cw.owner.length; t++) {
    if (cw.owner[t] === 0 && cw.state[t] === TileState.Neutral) {
      cw.state[t] = TileState.Apostate;
      cw.scarTicks[t] = 60000;
    }
  }

  run(stall, 1, turnsOf({}));
  run(control, 1, turnsOf({}));
  run(stall, 2, turnsOf({ [stall.tick]: [declare] }));
  assert.equal(stall.prophecies.length, 1);
  const faithBefore = toFloat(sp.faith);
  run(stall, 1801, turnsOf({}));
  run(control, 1803, turnsOf({}));
  assert.ok(toFloat(sp.faith) < faithBefore, "failed prophecy drains faith");
  assert.ok(
    toInt(sp.followers) < toInt(control.players[0]!.followers),
    "failed prophecy causes apostasy vs the control twin",
  );
});

// ---------- victory / elimination ----------

test("domination threshold ends the match with a winner", () => {
  const world = createWorld(16, 16);
  for (let i = 0; i < world.susceptibility.length; i++) world.susceptibility[i] = fromInt(95);
  const s = createSim({
    seed: 3,
    balance,
    world,
    spawns: [{ id: 1, archetype: "dawn" }],
    dominationPermille: 100, // 10% for the test
    timerTicks: 0,
  });
  step(s, { n: 0, intents: [{ t: IntentType.SPAWN, player: 1, tile: 8 * 16 + 8 }], seedSlice: 0 }, balance);
  // spawn blob is ~29 tiles of 256 ≈ 11% > 10% → the Ascension countdown starts
  assert.equal(s.status, MatchStatus.Live, "domination starts an Ascension, not an instant win");
  assert.equal(s.players[0]!.ascendPath, "domination");
  for (let n = 1; n <= balance.victory.ascendTicks + 1 && s.status === MatchStatus.Live; n++) {
    step(s, { n, intents: [], seedSlice: n }, balance);
  }
  assert.equal(s.status, MatchStatus.Ended, "match should end once the countdown survives");
  assert.equal(s.winner, 1);
  assert.equal(s.winPath, "domination");
});

test("timer expiry crowns the largest cult", () => {
  const world = createWorld(24, 24);
  for (let i = 0; i < world.susceptibility.length; i++) world.susceptibility[i] = fromInt(50);
  const s = createSim({
    seed: 4,
    balance,
    world,
    spawns: [
      { id: 1, archetype: "dawn" },
      { id: 2, archetype: "circle" },
    ],
    dominationPermille: 1000,
    timerTicks: 30,
  });
  const spawns: Intent[] = [
    { t: IntentType.SPAWN, player: 1, tile: 6 * 24 + 6 },
    { t: IntentType.SPAWN, player: 2, tile: 18 * 24 + 18 },
  ];
  step(s, { n: 0, intents: spawns, seedSlice: 0 }, balance);
  // tilt the board: give p1 extra tiles
  for (let x = 0; x < 10; x++) {
    const t = 0 * 24 + x;
    s.world.owner[t] = 1;
    s.world.state[t] = TileState.Believer;
    s.players[0]!.ownedTiles++;
  }
  run(s, 35, turnsOf({}));
  assert.equal(s.status, MatchStatus.Ended, "timer should end the match");
  assert.equal(s.winner, 1, "largest cult wins the tiebreak");
});

test("radio_static (Visitors) sows dissent through enemy tiles in range (v3 retarget)", () => {
  // The old effect knocked out Broadcast Towers, which no longer exist — this
  // pins the retargeted behaviour so the ability can't silently become a no-op.
  const world = createWorld(24, 24);
  const s = createSim({
    seed: 3,
    balance,
    world,
    spawns: [{ id: 1, archetype: "visitors" }, { id: 2, archetype: "dawn" }],
  });
  const p1 = s.players[0]!;
  p1.faith = fromInt(100);
  p1.spawned = true;
  const w = s.world;
  const enemy = 12 * 24 + 12;
  w.owner[enemy] = 2;
  w.state[enemy] = TileState.Believer;
  w.terrain[enemy] = Terrain.Citizen;
  w.dissent[enemy] = 0;
  step(
    s,
    { n: 0, intents: [{ t: IntentType.ABILITY, player: 1, ability: "radio_static", target: enemy }], seedSlice: 0 },
    balance,
  );
  assert.ok(toFloat(w.dissent[enemy]!) > 0, `static should raise enemy dissent, got ${toFloat(w.dissent[enemy]!)}`);
});
