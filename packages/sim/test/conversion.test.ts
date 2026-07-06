/**
 * Conversion resolution tests (§4): fronts press, neutrals flip, defended
 * enemy tiles resist, ambient creep oozes, attrition bites, scars block.
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
  step,
  fromInt,
  toFloat,
  IntentType,
  Stance,
  NEUTRAL,
  TileState,
  type RawBalance,
  type SimState,
  type Turn,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance;
const balance = loadBalance(raw);

const W = 24;

/** Two players on a 24×24 plain: p1 owns left column block, p2 owns right. */
function twoCults(): SimState {
  const world = createWorld(W, W);
  for (let i = 0; i < world.susceptibility.length; i++) world.susceptibility[i] = fromInt(50);
  const s = createSim({
    seed: 42,
    balance,
    world,
    spawns: [
      { id: 1, archetype: "dawn" },
      { id: 2, archetype: "radiant" },
    ],
  });
  // hand-place territory: p1 columns 0..3, p2 columns 20..23, all rows
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < 4; x++) own(s, y * W + x, 1);
    for (let x = 20; x < W; x++) own(s, y * W + x, 2);
  }
  // tests tuned against the classic 1k-follower dynamics; starts are smaller now
  s.players[0]!.followers = fromInt(1000);
  s.players[1]!.followers = fromInt(1000);
  // established cults with territory count as spawned (MISSION_SEND requires it)
  s.players[0]!.spawned = true;
  s.players[1]!.spawned = true;
  return s;
}

function own(s: SimState, t: number, pid: number): void {
  s.world.owner[t] = pid;
  s.world.state[t] = TileState.Believer;
  s.players.find((p) => p.id === pid)!.ownedTiles++;
}

function emptyTurn(n: number): Turn {
  return { n, intents: [], seedSlice: 0 };
}

function run(s: SimState, ticks: number, turns: Map<number, Turn> = new Map()): void {
  const start = s.tick;
  for (let i = 0; i < ticks; i++) {
    const n = start + i;
    step(s, turns.get(n) ?? emptyTurn(n), balance);
  }
}

/** Stage a player's flock: an operational compound so cohorts march a short,
 *  known distance to their target (v3 travel model). */
function compoundAt(s: SimState, pid: number, tile: number): void {
  s.buildings.push({ id: s.nextEntityId++, player: pid, type: "compound", tile, buildTicksLeft: 0, disabledTicks: 0 });
}

/** A turn that sends a cohort — the v3 replacement for opening a front. */
function sendTurn(
  pid: number,
  tile: number,
  mode: typeof Stance.Spread | typeof Stance.Tend | typeof Stance.Crusade,
  permille = 700,
): Turn {
  return { n: 0, intents: [{ t: IntentType.MISSION_SEND, player: pid, tile, permille, mode }], seedSlice: 0 };
}

test("a spread cohort flips neutral tiles around its target", () => {
  const s = twoCults();
  compoundAt(s, 1, 12 * W + 3); // stage p1's flock at its column-3 edge
  const target = 12 * W + 5; // neutral, radius-6 disk full of neutrals
  const turns = new Map<number, Turn>([[0, sendTurn(1, target, Stance.Spread)]]);
  const before = s.players[0]!.ownedTiles;
  // march (~4 ticks) + door-by-door conversion; 60 sim-seconds is comfortable
  run(s, 600, turns);
  const after = s.players[0]!.ownedTiles;
  assert.ok(after > before, `cohort should capture neutral tiles (before=${before} after=${after})`);
  assert.ok(after - before >= 8, `expected a worked block captured, got ${after - before}`);
});

test("ambient creep flips neutral border tiles with no front at all", () => {
  const s = twoCults();
  const before = s.players[1]!.ownedTiles; // radiant, r0 0.8 — still oozes
  // Creep is the free, slow pressure: 0.35 × 0.8 ≈ 0.28/s → ~6 min per tile.
  run(s, 4200); // 7 minutes of pure creep
  const after = s.players[1]!.ownedTiles;
  assert.ok(after > before, `creep should flip some neutrals (before=${before}, after=${after})`);
});

test("defended enemy tiles flip far slower than neutral tiles", () => {
  // Track the ANCHOR tile itself (the cohort always works its dist-0 target),
  // so the enemy case measures a DEFENDED flip — not a neutral bystander the
  // auto-spread happened to pick up.
  const ticksToTargetFlip = (attackEnemy: boolean): number => {
    const s = twoCults();
    const col = attackEnemy ? 20 : 5;
    const target = 12 * W + col;
    // teleport p1 adjacent to p2 for the enemy case: give p1 column 19
    if (attackEnemy) for (let y = 0; y < W; y++) own(s, y * W + 19, 1);
    compoundAt(s, 1, 12 * W + (attackEnemy ? 19 : 3));
    const turns = new Map<number, Turn>([[0, sendTurn(1, target, Stance.Spread)]]);
    for (let n = 0; n < 3000; n++) {
      step(s, turns.get(n) ?? emptyTurn(n), balance);
      if (s.world.owner[target] === 1) return n + 1;
    }
    return Infinity;
  };
  const vsNeutral = ticksToTargetFlip(false);
  const vsEnemy = ticksToTargetFlip(true);
  assert.ok(vsNeutral < vsEnemy, `neutral (${vsNeutral}) should flip before defended enemy (${vsEnemy})`);
  assert.ok(vsEnemy > vsNeutral * 1.5, `defense should matter: neutral=${vsNeutral} enemy=${vsEnemy}`);
});

test("committing a cohort costs the attacker its available flock", () => {
  const s = twoCults();
  compoundAt(s, 1, 12 * W + 3);
  const turns = new Map<number, Turn>([[0, sendTurn(1, 12 * W + 5, Stance.Crusade)]]);
  // deploying moves mass out of the home flock (and crusade attrition bites);
  // compare the home flock against an idle twin
  const sIdle = twoCults();
  run(s, 60, turns);
  run(sIdle, 60);
  assert.ok(
    toFloat(s.players[0]!.followers) < toFloat(sIdle.players[0]!.followers),
    "attacker's home flock should be lower than an idle twin's",
  );
});

test("apostate scar tiles are immune to conversion until they heal", () => {
  const s = twoCults();
  compoundAt(s, 1, 12 * W + 3);
  const t = 10 * W + 5; // neutral tile in p1's cohort radius
  s.world.state[t] = TileState.Apostate;
  s.world.scarTicks[t] = 200; // 20s remaining
  const turns = new Map<number, Turn>([[0, sendTurn(1, t, Stance.Spread)]]);
  run(s, 100, turns); // 10s: still scarred
  assert.equal(s.world.owner[t], NEUTRAL, "scarred tile must not flip");
  assert.equal(s.world.state[t], TileState.Apostate);
  run(s, 150); // scar expires at t=200 ticks
  assert.notEqual(
    s.world.state[t],
    TileState.Apostate,
    "scar should heal (creep may flip it to Believer immediately after)",
  );
});

test("a CRUSADE cohort presses faster than a TEND cohort", () => {
  const capturedAfter = (mode: typeof Stance.Tend | typeof Stance.Crusade): number => {
    const s = twoCults();
    compoundAt(s, 1, 12 * W + 3);
    const turns = new Map<number, Turn>([[0, sendTurn(1, 12 * W + 5, mode)]]);
    const base = s.players[0]!.ownedTiles;
    run(s, 200, turns); // Tend holds (0 captures); Crusade flips
    return s.players[0]!.ownedTiles - base;
  };
  const tend = capturedAfter(Stance.Tend);
  const crusade = capturedAfter(Stance.Crusade);
  assert.ok(crusade > tend, `crusade (${crusade}) should out-capture tend (${tend})`);
});
