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

test("an open front flips adjacent neutral tiles within seconds", () => {
  const s = twoCults();
  // p1 pushes into column 4 (neutral, adjacent to its column 3)
  const targets = Array.from({ length: W }, (_, y) => y * W + 4);
  const turns = new Map<number, Turn>([
    [0, { n: 0, intents: [{ t: IntentType.OPEN_FRONT, player: 1, tiles: targets }], seedSlice: 0 }],
  ]);
  const before = s.players[0]!.ownedTiles;
  // Early-game pressure with 1k followers spread over a 24-tile front is slow
  // (~3/s vs the 100 threshold); 60 sim-seconds is a comfortable window. The
  // §4.4 "1.5–4s typical" figure assumes mid-game (~60 attackers per tile).
  run(s, 600, turns);
  const after = s.players[0]!.ownedTiles;
  assert.ok(after > before, `front should capture neutral tiles (before=${before} after=${after})`);
  assert.ok(after - before >= W / 2, `expected most of the column captured, got ${after - before}`);
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
  // Measure ticks-to-first-flip for p1 attacking neutral vs attacking p2.
  const ticksToFirstFlip = (attackEnemy: boolean): number => {
    const s = twoCults();
    const col = attackEnemy ? 20 : 4;
    const targets = Array.from({ length: W }, (_, y) => y * W + col);
    // teleport p1 adjacent to p2 for the enemy case: give p1 column 19
    if (attackEnemy) for (let y = 0; y < W; y++) own(s, y * W + 19, 1);
    const turns = new Map<number, Turn>([
      [0, { n: 0, intents: [{ t: IntentType.OPEN_FRONT, player: 1, tiles: targets }], seedSlice: 0 }],
    ]);
    const base = s.players[0]!.ownedTiles;
    for (let n = 0; n < 3000; n++) {
      step(s, turns.get(n) ?? emptyTurn(n), balance);
      if (s.players[0]!.ownedTiles > base) return n + 1;
    }
    return Infinity;
  };
  const vsNeutral = ticksToFirstFlip(false);
  const vsEnemy = ticksToFirstFlip(true);
  assert.ok(vsNeutral < vsEnemy, `neutral (${vsNeutral}) should flip before defended enemy (${vsEnemy})`);
  assert.ok(vsEnemy > vsNeutral * 2, `defense should matter: neutral=${vsNeutral} enemy=${vsEnemy}`);
});

test("attrition: pushing a front costs the attacker followers", () => {
  const s = twoCults();
  const targets = Array.from({ length: W }, (_, y) => y * W + 4);
  const turns = new Map<number, Turn>([
    [0, { n: 0, intents: [{ t: IntentType.OPEN_FRONT, player: 1, tiles: targets }], seedSlice: 0 }],
  ]);
  // crusade to maximize commitment, then compare follower trajectories
  const sIdle = twoCults();
  run(s, 30, turns);
  run(sIdle, 30);
  assert.ok(
    toFloat(s.players[0]!.followers) < toFloat(sIdle.players[0]!.followers),
    "attacker should have fewer followers than an idle twin",
  );
});

test("apostate scar tiles are immune to conversion until they heal", () => {
  const s = twoCults();
  const t = 10 * W + 4; // neutral tile adjacent to p1
  s.world.state[t] = TileState.Apostate;
  s.world.scarTicks[t] = 200; // 20s remaining
  const turns = new Map<number, Turn>([
    [0, { n: 0, intents: [{ t: IntentType.OPEN_FRONT, player: 1, tiles: [t] }], seedSlice: 0 }],
  ]);
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

test("CRUSADE stance presses faster than Tend the Flock", () => {
  const capturedAfter = (stance: typeof Stance.Tend | typeof Stance.Crusade): number => {
    const s = twoCults();
    const targets = Array.from({ length: W }, (_, y) => y * W + 4);
    const turns = new Map<number, Turn>([
      [
        0,
        {
          n: 0,
          intents: [
            { t: IntentType.SET_STANCE, player: 1, stance },
            { t: IntentType.OPEN_FRONT, player: 1, tiles: targets },
          ],
          seedSlice: 0,
        },
      ],
    ]);
    const base = s.players[0]!.ownedTiles;
    run(s, 120, turns); // short window: crusade flips, tend trickles
    return s.players[0]!.ownedTiles - base;
  };
  const tend = capturedAfter(Stance.Tend);
  const crusade = capturedAfter(Stance.Crusade);
  assert.ok(crusade > tend, `crusade (${crusade}) should out-capture tend (${tend})`);
});
