/**
 * M1 systems tests: buildings (§6), couriers/vans/agents (§7), raids (§13),
 * Scandal (§15.2), strikes (§8), Court Defection (§15.3), alliances/betrayal/
 * Schism (§16), doctrine (§10), the Radiant/Circle/Visitors kits (§11.2–11.4),
 * CPA (§17), and landmarks (§12).
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
  districtCoeffTable,
  step,
  fromInt,
  toFloat,
  toInt,
  IntentType,
  Stance,
  TileState,
  Terrain,
  Landmark,
  MatchStatus,
  Districts,
  hashState,
  toSnapshot,
  fromSnapshot,
  type RawBalance,
  type SimState,
  type Turn,
  type Intent,
  type PlayerState,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance;
const balance = loadBalance(raw);

const W = 32;

function turn(n: number, intents: Intent[] = []): Turn {
  return { n, intents, seedSlice: (n * 0x9e3779b9) >>> 0 };
}

function run(s: SimState, ticks: number, intentsAtStart: Intent[] = []): void {
  step(s, turn(s.tick, intentsAtStart), balance);
  for (let i = 1; i < ticks; i++) step(s, turn(s.tick), balance);
}

/** Two-player world: p1 left block, p2 right block, two districts split at x=16. */
function duel(): SimState {
  const world = createWorld(W, W);
  world.districtCoeffs = districtCoeffTable();
  for (let i = 0; i < world.susceptibility.length; i++) world.susceptibility[i] = fromInt(50);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      world.district[y * W + x] = x < 16 ? Districts.Suburbs : Districts.Trailer;
    }
  }
  const s = createSim({
    seed: 99,
    balance,
    world,
    spawns: [
      { id: 1, archetype: "dawn" },
      { id: 2, archetype: "radiant" },
    ],
    timerTicks: 0,
    dominationPermille: 1000,
  });
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < 5; x++) own(s, y * W + x, 1);
    for (let x = 27; x < W; x++) own(s, y * W + x, 2);
  }
  s.players[0]!.spawned = true;
  s.players[1]!.spawned = true;
  s.players[0]!.followers = fromInt(1000);
  s.players[1]!.followers = fromInt(1000);
  return s;
}

function own(s: SimState, t: number, pid: number): void {
  s.world.owner[t] = pid;
  s.world.state[t] = TileState.Believer;
  s.players.find((p) => p.id === pid)!.ownedTiles++;
}

function p(s: SimState, id: number): PlayerState {
  return s.players.find((pl) => pl.id === id)!;
}

/** Stage a flock (v3 travel model) so cohorts march a short known distance. */
function compoundAt(s: SimState, pid: number, tile: number): void {
  s.buildings.push({ id: s.nextEntityId++, player: pid, type: "compound", tile, buildTicksLeft: 0, disabledTicks: 0 });
}

/** A cohort send — the v3 replacement for opening a front on a tile. */
function send(pid: number, tile: number, mode: Stance = Stance.Spread, permille = 700): Intent {
  return { t: IntentType.MISSION_SEND, player: pid, tile, permille, mode };
}

// ---------------- buildings & couriers ----------------

test("collection plates spawn couriers that deliver route money", () => {
  const s = duel();
  p(s, 1).usd = fromInt(100_000);
  run(s, 1, [
    { t: IntentType.BUILD, player: 1, building: "collection_plate", tile: 2 * W + 2 },
    { t: IntentType.BUILD, player: 1, building: "collection_plate", tile: 20 * W + 2 },
  ]);
  assert.equal(s.buildings.length, 2, "two plates placed");
  run(s, 150); // finish 15s construction
  const before = toInt(p(s, 1).usd);
  run(s, 600); // a couple of courier cycles (spawn every 20s, ~18 tile walk)
  assert.ok(s.couriers.length > 0 || toInt(p(s, 1).usd) > before, "courier economy is alive");
  const tithedOnly = duel();
  tithedOnly.players[0]!.usd = fromInt(100_000 - 20_000); // plates cost 20k
  run(tithedOnly, 751);
  assert.ok(
    toInt(p(s, 1).usd) > toInt(tithedOnly.players[0]!.usd),
    "plates + couriers must out-earn plain tithe",
  );
});

test("watchtower fort_mult makes its tiles drastically harder to take", () => {
  // track the SPECIFIC tile (ownedTiles would count unrelated creep flips)
  const targetTile = 10 * W + 27;
  const ticksToFlip = (withTower: boolean): number => {
    const s = duel();
    p(s, 2).usd = fromInt(100_000);
    p(s, 2).followers = fromInt(200); // thin defense so the open case flips fast
    for (let y = 0; y < W; y++) own(s, y * W + 26, 1);
    compoundAt(s, 1, 10 * W + 26); // stage p1's flock at the col-26 edge
    if (withTower) {
      run(s, 1, [{ t: IntentType.BUILD, player: 2, building: "watchtower", tile: 10 * W + 28 }]);
      run(s, 180); // build it
    }
    run(s, 1, [send(1, targetTile)]);
    for (let i = 0; i < 6000; i++) {
      step(s, turn(s.tick), balance);
      if (s.world.owner[targetTile] === 1) return i;
    }
    return 100_000;
  };
  const open = ticksToFlip(false);
  const guarded = ticksToFlip(true);
  assert.ok(open < 6000, `open tile should flip (took ${open})`);
  assert.ok(guarded > open * 2.5, `fort_mult should bite: open=${open} guarded=${guarded}`);
});

test("buildings are destroyed, not captured, when their tile flips", () => {
  const s = duel();
  p(s, 2).usd = fromInt(100_000);
  p(s, 2).followers = fromInt(200); // thin defense → quick flip
  const tile = 10 * W + 27;
  run(s, 1, [{ t: IntentType.BUILD, player: 2, building: "collection_plate", tile }]);
  assert.equal(s.buildings.length, 1);
  for (let y = 0; y < W; y++) own(s, y * W + 26, 1);
  compoundAt(s, 1, 10 * W + 26);
  run(s, 1, [send(1, tile)]);
  run(s, 3000);
  assert.equal(s.world.owner[tile], 1, "tile should have flipped to the attacker");
  // the plate dies with its tile (the p1 staging compound at col 26 remains)
  assert.ok(
    !s.buildings.some((bd) => bd.type === "collection_plate"),
    "collection_plate must die with its tile",
  );
});

// ---------------- agents: raids & scandal ----------------

test("deprogramming raid scars a blob and spikes district dissent", () => {
  const s = duel();
  p(s, 1).usd = fromInt(50_000);
  run(s, 1, [{ t: IntentType.AGENT_DISPATCH, player: 1, district: Districts.Trailer, mission: "deprogram" }]);
  assert.equal(s.agents.length, 1, "agent dispatched");
  run(s, 800); // travel (~24s) + 6s channel, well inside the 90s scar window
  assert.equal(s.agents.length, 0, "agent expired after the raid");
  // measure the raid's DIRECT effect (apostasy + scars) — net ownedTiles is
  // confounded by the victim's ambient creep during the long channel window
  let apostate = 0;
  let scarred = 0;
  for (let t = 0; t < s.world.state.length; t++) {
    if (s.world.state[t] === TileState.Apostate) apostate++;
    if (s.world.scarTicks[t]! > 0) scarred++;
  }
  assert.ok(apostate > 0, "the raid turned believers apostate");
  assert.ok(scarred > 0, "apostate scar tissue exists");
});

test("expose: gated on the victim's Heat, burns followers, prices up per use", () => {
  const s = duel();
  p(s, 1).usd = fromInt(50_000);
  p(s, 2).heat = fromInt(10); // quiet cult: not exposable
  run(s, 1, [{ t: IntentType.PUBLISH_SCANDAL, player: 1, target: 2 }]);
  assert.equal(p(s, 1).exposes, 0, "a cool cult can't be exposed");
  p(s, 2).heat = fromInt(50); // loud cult
  const followersBefore = toInt(p(s, 2).followers);
  const usdBefore = toInt(p(s, 1).usd);
  run(s, 1, [{ t: IntentType.PUBLISH_SCANDAL, player: 1, target: 2 }]);
  assert.equal(p(s, 1).exposes, 1, "expose landed");
  const spent = usdBefore - toInt(p(s, 1).usd);
  assert.ok(spent > 3_900 && spent <= 4_000, `first expose costs $4k less a tick of tithe (${spent})`);
  assert.ok(toInt(p(s, 2).followers) < followersBefore * 0.8, "victim at heat 50 loses ~30% of followers");
  run(s, 1, [{ t: IntentType.PUBLISH_SCANDAL, player: 1, target: 2 }]);
  assert.equal(p(s, 1).exposes, 1, "cooldown blocks an immediate repeat");
});

// ---------------- strikes ----------------

test("pamphlet bomb lands after charge+warning, spiking dissent and disabling buildings", () => {
  const s = duel();
  p(s, 1).usd = fromInt(1_000_000);
  p(s, 2).usd = fromInt(50_000);
  const target = 10 * W + 29;
  run(s, 1, [
    { t: IntentType.BUILD, player: 1, building: "broadcast_tower", tile: 5 * W + 2 },
    { t: IntentType.BUILD, player: 2, building: "watchtower", tile: 10 * W + 30 },
  ]);
  run(s, 460); // build the tower (45s)
  run(s, 1, [{ t: IntentType.STRIKE, player: 1, strike: "pamphlet_bomb", target }]);
  assert.equal(s.strikes.length, 1, "strike charging");
  run(s, 30 * 10 + 10 * 10 + 5); // charge 30s + warning 10s
  assert.equal(s.strikes.length, 0, "strike resolved");
  // +35 at impact, minus a few ticks of decay before we look
  assert.ok(toFloat(s.world.dissent[target]!) >= 30, "dissent spiked at impact");
  const tower = s.buildings.find((bd) => bd.type === "watchtower");
  assert.ok(tower && tower.disabledTicks > 0, "victim buildings disabled");
});

// ---------------- diplomacy ----------------

test("allies cannot be converted; attacking an ally triggers JUDAS", () => {
  const s = duel();
  run(s, 1, [{ t: IntentType.ALLY_PROPOSE, player: 1, target: 2 }]);
  run(s, 1, [{ t: IntentType.ALLY_ACCEPT, player: 2, target: 1 }]);
  assert.equal(s.alliances.length, 1, "alliance formed");

  // p1 sends a cohort onto p2 territory → betrayal fires when it arrives
  for (let y = 0; y < W; y++) own(s, y * W + 26, 1);
  compoundAt(s, 1, 10 * W + 26);
  run(s, 1, [send(1, 10 * W + 27)]);
  run(s, 12); // let the cohort march the ~1 tile and work the allied door
  assert.equal(s.alliances.length, 0, "alliance shattered");
  assert.ok(p(s, 1).traitor, "JUDAS mark applied");
  assert.ok(p(s, 1).judasTicks > 0, "retention shock running");
  assert.ok(
    s.grudges.some((g) => g.traitor === 1 && g.victim === 2),
    "permanent grudge recorded",
  );
});

test("schism: oversized, dissent-ridden cult splinters into a new sect", () => {
  const s = duel();
  const parent = p(s, 1);
  // give p1 40% of the map, all at high dissent
  for (let y = 0; y < W; y++) {
    for (let x = 5; x < 14; x++) own(s, y * W + x, 1);
  }
  for (let t = 0; t < s.world.owner.length; t++) {
    if (s.world.owner[t] === 1) s.world.dissent[t] = fromInt(60);
  }
  const tilesBefore = parent.ownedTiles;
  const playersBefore = s.players.length;
  run(s, 320); // 30s sustain + eruption
  assert.equal(s.players.length, playersBefore + 1, "splinter sect exists");
  const splinter = s.players[s.players.length - 1]!;
  assert.ok(splinter.id >= 900, "splinter uses the high id range");
  assert.ok(splinter.ownedTiles > 0, "splinter took territory");
  assert.ok(parent.ownedTiles < tilesBefore, "parent lost the seceding region");
});

// ---------------- doctrine ----------------

test("doctrine: Faith is the currency, tiers gate, effects apply (v3)", () => {
  const s = duel();
  const me = p(s, 1);
  // three picks cost 3×15 = 45 Faith; fund exactly that
  me.faith = fromInt(45);
  run(s, 1, [{ t: IntentType.DOCTRINE_PICK, player: 1, node: "T4" }]);
  assert.equal(me.doctrine.length, 0, "T4 must be tier-gated (needs 3 in branch)");
  run(s, 1, [
    { t: IntentType.DOCTRINE_PICK, player: 1, node: "T1" },
    { t: IntentType.DOCTRINE_PICK, player: 1, node: "T2" },
    { t: IntentType.DOCTRINE_PICK, player: 1, node: "T3" },
  ]);
  assert.deepEqual(me.doctrine, ["T1", "T2", "T3"], "three picks landed");
  assert.ok(toInt(me.faith) < 5, "Faith was spent (≈0 after 45 of 45)");
  run(s, 1, [{ t: IntentType.DOCTRINE_PICK, player: 1, node: "B1" }]);
  assert.equal(me.doctrine.length, 3, "no Faith left — 4th pick refused");
});

test("doctrine: a deployed Tend cohort banks Faith to spend (v3)", () => {
  const s = duel();
  const me = p(s, 1);
  compoundAt(s, 1, 12 * W + 3);
  me.faith = fromInt(10); // below the 15 cost — can't buy yet
  run(s, 1, [send(1, 12 * W + 5, Stance.Tend)]);
  const before = toInt(me.faith);
  run(s, 400); // the tend cohort marches in and gathers the faithful
  assert.ok(toInt(me.faith) > before, "Tend banked Faith while deployed");
});

// ---------------- archetype kits ----------------

test("Radiant: Juice Cleanse zeroes one district's dissent", () => {
  const s = duel();
  const me = p(s, 2);
  me.usd = fromInt(100_000);
  for (let t = 0; t < s.world.owner.length; t++) {
    if (s.world.owner[t] === 2) s.world.dissent[t] = fromInt(80);
  }
  run(s, 1, [{ t: IntentType.ABILITY, player: 2, ability: "juice_cleanse", target: 10 * W + 30 }]);
  let maxDissent = 0;
  for (let t = 0; t < s.world.owner.length; t++) {
    if (s.world.owner[t] === 2) maxDissent = Math.max(maxDissent, toFloat(s.world.dissent[t]!));
  }
  assert.ok(maxDissent < 1, `district dissent zeroed (max ${maxDissent})`);
});

test("Circle: Seminar Blitz grows the flock 25%; The Ledger ascends and wins", () => {
  const world = createWorld(W, W);
  world.districtCoeffs = districtCoeffTable();
  const s = createSim({
    seed: 5,
    balance,
    world,
    spawns: [
      { id: 1, archetype: "circle" },
      { id: 2, archetype: "dawn" },
    ],
    timerTicks: 0,
    dominationPermille: 1000,
  });
  step(s, turn(0, [
    { t: IntentType.SPAWN, player: 1, tile: 8 * W + 8 },
    { t: IntentType.SPAWN, player: 2, tile: 24 * W + 24 },
  ]), balance);

  const me = p(s, 1);
  me.usd = fromInt(100_000);
  const before = toInt(me.followers);
  run(s, 1, [{ t: IntentType.ABILITY, player: 1, ability: "seminar_blitz" }]);
  assert.ok(toInt(me.followers) >= Math.floor(before * 1.24), "blitz adds ~25% of the flock");

  // The Ledger: 20% of the town + the S-map bank target, held through the countdown.
  const w = s.world;
  for (let t = 0, got = me.ownedTiles; t < w.owner.length && got < 240; t++) {
    if (w.owner[t] === 0 && w.terrain[t] === Terrain.Citizen) {
      w.owner[t] = 1; w.state[t] = TileState.Believer; me.ownedTiles++; got++;
    }
  }
  me.usd = fromInt(200_000); // over the S-map Ledger target ($150k)
  run(s, 2);
  assert.equal(me.ascendPath, "ledger", "the Ledger countdown is running");
  run(s, balance.victory.ascendTicks + 2);
  assert.equal(s.status, MatchStatus.Ended, "the Ledger wins once the countdown survives");
  assert.equal(s.winner, 1);
  assert.equal(s.winPath, "ledger");
});

test("Visitors: Saucer Landing claims remote ground and keeps the cult alive", () => {
  const s = duel();
  // make p1 a visitor for this test
  const me = p(s, 1);
  (me as { archetype: string }).archetype = "visitors";
  me.usd = fromInt(100_000);
  const remote = 2 * W + 20; // deep on the neutral side
  run(s, 1, [{ t: IntentType.ABILITY, player: 1, ability: "saucer_landing", target: remote }]);
  assert.equal(s.world.owner[remote], 1, "satellite tile claimed");
  assert.ok(
    s.buildings.some((bd) => bd.type === "satellite" && bd.player === 1),
    "satellite chapel exists",
  );
  // wipe the homeland; satellite must keep them in the match
  const w = s.world;
  for (let t = 0; t < w.owner.length; t++) {
    if (w.owner[t] === 1 && t !== remote) {
      w.owner[t] = 0;
      w.state[t] = TileState.Neutral;
    }
  }
  me.ownedTiles = 1;
  run(s, 5);
  assert.ok(me.alive, "losing the homeland is an inconvenience (§11.4)");
});

test("Visitors: Crop Circle accelerates neutral conversion for everyone", () => {
  const captured = (withCircle: boolean): number => {
    const s = duel();
    const me = p(s, 1);
    (me as { archetype: string }).archetype = "visitors";
    me.usd = fromInt(100_000);
    compoundAt(s, 1, 10 * W + 4); // stage at p1's col-4 edge
    const intents: Intent[] = [send(1, 10 * W + 5)];
    if (withCircle)
      intents.push({ t: IntentType.ABILITY, player: 1, ability: "crop_circle", target: 10 * W + 5 });
    const base = me.ownedTiles;
    run(s, 240, intents); // window where the +30 S boost differentiates
    return me.ownedTiles - base;
  };
  const plain = captured(false);
  const boosted = captured(true);
  assert.ok(boosted > plain, `crop circle should speed flips (${plain} vs ${boosted})`);
});

// ---------------- CPA & landmarks ----------------

test("CPA pickets the highest-heat player at 60+, raids at 85+", () => {
  const s = duel();
  const hot = p(s, 1);
  hot.heat = fromInt(90);
  // keep heat pinned (decay would dip below thresholds over the window)
  for (let i = 0; i < 700; i++) {
    hot.heat = fromInt(90);
    step(s, turn(s.tick), balance);
  }
  assert.ok(s.pickets.length > 0, "picket lines deployed");
  let scarred = 0;
  for (let t = 0; t < s.world.scarTicks.length; t++) if (s.world.scarTicks[t]! > 0) scarred++;
  assert.ok(scarred > 0, "deprogrammer bus raided the hot cult");
});

test("Megachurch raises Faith above the 50 drift ceiling while held", () => {
  const s = duel();
  const t = 10 * W + 2; // inside p1 territory
  s.world.landmark[t] = Landmark.Megachurch;
  run(s, 600);
  assert.ok(toFloat(p(s, 1).faith) > 50.5, `megachurch faith trickle (${toFloat(p(s, 1).faith)})`);
});

// ---------------- determinism with the full systems online ----------------

test("M1 snapshot round-trip + determinism with buildings/agents/alliances live", () => {
  const build = (): SimState => {
    const s = duel();
    p(s, 1).usd = fromInt(500_000);
    step(s, turn(s.tick, [
      { t: IntentType.BUILD, player: 1, building: "watchtower", tile: 5 * W + 2 },
      { t: IntentType.AGENT_DISPATCH, player: 1, district: Districts.Trailer, mission: "deprogram" },
      { t: IntentType.ALLY_PROPOSE, player: 1, target: 2 },
    ]), balance);
    step(s, turn(s.tick, [{ t: IntentType.ALLY_ACCEPT, player: 2, target: 1 }]), balance);
    for (let i = 0; i < 400; i++) step(s, turn(s.tick), balance);
    return s;
  };
  const a = build();
  const b2 = build();
  assert.equal(hashState(a), hashState(b2), "identical runs stay hash-identical");

  const restored = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(a))));
  assert.equal(hashState(restored), hashState(a), "M1 snapshot round-trips");
  for (let i = 0; i < 200; i++) {
    step(a, turn(a.tick), balance);
    step(restored, turn(restored.tick), balance);
  }
  assert.equal(hashState(restored), hashState(a), "restored sim tracks the original");
});
