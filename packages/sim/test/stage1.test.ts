/**
 * Stage 1 redesign rules (docs/STAGE1_DESIGN.md): the Ascension victory rule,
 * the Tipping Point, Heat-as-notoriety + Scrutiny, the rebuilt Expose, the
 * Information doctrines, the retired global stance, and DLC registration.
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
  toInt,
  IntentType,
  Stance,
  TileState,
  Terrain,
  Lot,
  MatchStatus,
  Districts,
  dominationThreshold,
  scrutinyMult,
  gainHeatFixed,
  victoryPaths,
  refreshVictoryStats,
  registerArchetype,
  getArchetype,
  archetypeIds,
  renderTown,
  hashState,
  sanitizeLoadout,
  type RawBalance,
  type SimState,
  type Turn,
  type Intent,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance;
const balance = loadBalance(raw);
const W = 32;
const ONE = 65536;

const turn = (n: number, intents: Intent[] = []): Turn => ({ n, intents, seedSlice: (n * 0x9e3779b9) >>> 0 });
function run(s: SimState, ticks: number, first: Intent[] = []): void {
  step(s, turn(s.tick, first), balance);
  for (let i = 1; i < ticks; i++) step(s, turn(s.tick), balance);
}

function own(s: SimState, t: number, pid: number): void {
  s.world.owner[t] = pid;
  s.world.state[t] = TileState.Believer;
  s.players.find((p) => p.id === pid)!.ownedTiles++;
}

/** Two cults, left/right blocks, no pop (tile-share souls). */
function duel(a = "dawn", b = "radiant"): SimState {
  const world = createWorld(W, W);
  world.districtCoeffs = districtCoeffTable();
  for (let i = 0; i < world.susceptibility.length; i++) world.susceptibility[i] = fromInt(50);
  world.district.fill(Districts.Suburbs);
  const s = createSim({
    seed: 11,
    balance,
    world,
    spawns: [
      { id: 1, archetype: a },
      { id: 2, archetype: b },
    ],
    timerTicks: 0,
    dominationPermille: 1000,
  });
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < 4; x++) own(s, y * W + x, 1);
    for (let x = 28; x < W; x++) own(s, y * W + x, 2);
  }
  for (const p of s.players) {
    p.spawned = true;
    p.followers = fromInt(1000);
  }
  return s;
}

/** Give `pid` the first `n` neutral citizen tiles. */
function grant(s: SimState, pid: number, n: number): void {
  const w = s.world;
  for (let t = 0, got = 0; t < w.owner.length && got < n; t++) {
    if (w.owner[t] === 0 && w.terrain[t] === Terrain.Citizen) {
      own(s, t, pid);
      got++;
    }
  }
}

test("Tipping Point: the Domination bar slides to the floor between 8:00 and 12:00", () => {
  const s = duel();
  s.dominationPermille = 650;
  const v = balance.victory;
  s.tick = v.tippingStartTick;
  assert.equal(dominationThreshold(s, balance), 650);
  s.tick = (v.tippingStartTick + v.tippingEndTick) >> 1;
  const mid = dominationThreshold(s, balance);
  assert.ok(mid < 650 && mid > v.tippingFloorPermille, `mid-slide threshold ${mid}`);
  s.tick = v.tippingEndTick + 100;
  assert.equal(dominationThreshold(s, balance), v.tippingFloorPermille);
  s.dominationPermille = 1000; // disabled stays disabled
  assert.equal(dominationThreshold(s, balance), 1000);
});

test("Ascension: breaking the condition collapses the countdown", () => {
  const s = duel();
  s.dominationPermille = 300;
  grant(s, 1, 250); // 128 + 250 of 1024 ≈ 37%
  run(s, 1);
  const p1 = s.players[0]!;
  assert.equal(p1.ascendPath, "domination");
  run(s, 50);
  assert.ok(p1.ascendTicks < balance.victory.ascendTicks, "countdown running");
  // rival retakes ground: drop below the bar
  const w = s.world;
  for (let t = 0, n = 0; t < w.owner.length && n < 200; t++) {
    if (w.owner[t] === 1 && (t % W) >= 4) {
      w.owner[t] = 2;
      s.players[0]!.ownedTiles--;
      s.players[1]!.ownedTiles++;
      n++;
    }
  }
  run(s, 1);
  assert.equal(p1.ascendPath, "", "condition broken → countdown collapses");
  assert.equal(s.status, MatchStatus.Live);
});

test("Expose resets a rival's Ascension; I2 Counter-Narrative protects it", () => {
  for (const counter of [false, true]) {
    const s = duel();
    s.dominationPermille = 300;
    grant(s, 2, 250);
    const [p1, p2] = [s.players[0]!, s.players[1]!];
    if (counter) p2.doctrine.push("I1", "I2");
    run(s, 60);
    assert.equal(p2.ascendPath, "domination");
    const before = p2.ascendTicks;
    p2.heat = fromInt(50);
    p1.usd = fromInt(10_000);
    run(s, 1, [{ t: IntentType.PUBLISH_SCANDAL, player: 1, target: 2 }]);
    assert.equal(p1.exposes, 1, "expose landed");
    if (counter) assert.ok(p2.ascendTicks < before, "I2: countdown keeps running");
    else assert.ok(p2.ascendTicks >= before, "countdown reset to full");
  }
});

test("Notoriety: conversions raise Heat and Scrutiny amplifies big cults", () => {
  const s = duel();
  const p = s.players[0]!;
  p.soulsPermille = 100;
  assert.equal(scrutinyMult(p), ONE, "small cults: ×1");
  p.soulsPermille = 500;
  assert.equal(scrutinyMult(p), ONE + Math.floor(0.6 * ONE), "50% share: ×1.6 cap");
  p.heat = 0;
  gainHeatFixed(p, balance, fromInt(10));
  const big = p.heat;
  p.soulsPermille = 100;
  p.heat = 0;
  gainHeatFixed(p, balance, fromInt(10));
  assert.ok(big > p.heat, "the leader runs hotter for the same act");

  // a real crusade that converts ground draws Heat
  const c = duel();
  const cp = c.players[0]!;
  cp.heat = 0;
  run(c, 1, [{ t: IntentType.MISSION_SEND, player: 1, tile: 10 * W + 8, permille: 800, mode: Stance.Crusade }]);
  const tiles0 = cp.ownedTiles;
  let peak = 0;
  for (let i = 0; i < 600; i++) {
    run(c, 1);
    if (cp.heat > peak) peak = cp.heat;
  }
  assert.ok(cp.ownedTiles > tiles0, "the crusade converted ground");
  assert.ok(peak > 0, "conversions drew Heat");
});

test("I4 Official Story doubles Heat decay below the CPA line", () => {
  const a = duel();
  const b = duel();
  b.players[0]!.doctrine.push("I1", "I2", "I3", "I4");
  a.players[0]!.heat = fromInt(40);
  b.players[0]!.heat = fromInt(40);
  run(a, 100);
  run(b, 100);
  assert.ok(b.players[0]!.heat < a.players[0]!.heat, "I4 cools faster");
});

test("the retired global stance intent is a no-op", () => {
  const s = duel();
  run(s, 1, [{ t: IntentType.SET_STANCE, player: 1, stance: Stance.Crusade }]);
  assert.equal(s.players[0]!.stance, Stance.Spread);
});

test("cult paths: Rapture needs holy ground, First Contact needs saucer chapels", () => {
  const s = duel("dawn", "visitors");
  // three chapels in town; Dawn holds two of them
  const holy = [5 * W + 10, 6 * W + 10, 7 * W + 10];
  for (const t of holy) s.world.lot[t] = Lot.Chapel;
  grant(s, 1, 200); // ≈ 32% souls
  own(s, holy[0]!, 1);
  own(s, holy[1]!, 1);
  let st = refreshVictoryStats(s);
  const dawnPaths = victoryPaths(s, s.players[0]!, balance, st);
  assert.ok(dawnPaths.find((x) => x.id === "rapture")!.met, "Rapture condition met");

  const v = s.players[1]!;
  grant(s, 2, 100); // ≈ 22% souls
  for (let i = 0; i < 4; i++) {
    s.buildings.push({ id: 900 + i, player: 2, type: "satellite", tile: 20 * W + i, buildTicksLeft: 0, disabledTicks: 0 });
  }
  st = refreshVictoryStats(s);
  assert.ok(victoryPaths(s, v, balance, st).find((x) => x.id === "contact")!.met, "First Contact met");
  s.buildings.pop();
  st = refreshVictoryStats(s);
  assert.ok(!victoryPaths(s, v, balance, st).find((x) => x.id === "contact")!.met, "a toppled chapel breaks it");
});

test("timer expiry crowns the most souls", () => {
  const s = duel();
  s.timerTicks = 5;
  grant(s, 2, 50);
  s.players[0]!.usd = fromInt(999_999); // cash no longer beats souls
  run(s, 6);
  assert.equal(s.status, MatchStatus.Ended);
  assert.equal(s.winner, 2);
  assert.equal(s.winPath, "timer");
});

test("DLC: a registered expansion cult plays with zero engine changes", () => {
  registerArchetype({
    id: "test_lodge",
    coeffs: { r0: 1, retain: 1, income: 1, heat: 1, growth: 1 },
    abilities: [
      {
        id: "test_bake_sale",
        name: "Bake Sale",
        blurb: "+$500",
        slot: "primary",
        targeting: "none",
        cooldownKey: "bake_sale",
        cooldownTicks: 100,
        cost: () => ({ faith: fromInt(5) }),
        validate: () => true,
        effect: ({ p }) => {
          p.usd += fromInt(500);
        },
      },
    ],
    passives: {},
    bot: { prefLots: [], doctrine: [] },
    theme: { name: "The Test Lodge", short: "LODGE", tagline: "", playstyle: "", difficulty: 1, accent: "#fff", glyph: "eye" },
  });
  assert.ok(archetypeIds().includes("test_lodge"));
  const b2 = loadBalance(raw); // coefficients default from the definition
  assert.equal(b2.archetypes["test_lodge"]!.r0, ONE);
  const s = createSim({ seed: 1, balance: b2, world: createWorld(W, W), spawns: [{ id: 1, archetype: "test_lodge" }], timerTicks: 0 });
  const p = s.players[0]!;
  p.spawned = true;
  p.faith = fromInt(50);
  const usd = toInt(p.usd);
  step(s, turn(0, [{ t: IntentType.ABILITY, player: 1, ability: "test_bake_sale" }]), b2);
  assert.ok(toInt(p.usd) >= usd + 500, "expansion ability dispatched through the registry");
  assert.ok((p.cooldowns["bake_sale"] ?? 0) > 0, "cooldown started");
  assert.equal(getArchetype("test_lodge").theme.name, "The Test Lodge");
  // someone else's ability id is refused
  const followers = p.followers;
  p.usd = fromInt(50_000);
  step(s, turn(1, [{ t: IntentType.ABILITY, player: 1, ability: "seminar_blitz" }]), b2);
  assert.ok(p.followers <= followers + fromInt(5), "a cult can't cast another cult's power");
  assert.equal(p.cooldowns["seminar_blitz"], undefined);
});

test("skins are render-only: they change pixels, never the StateHash", () => {
  const s = duel();
  const h0 = hashState(s);
  const plain = renderTown(s, { frameTick: 0 });
  const ember = renderTown(s, { frameTick: 0, skins: { 1: { livery: "recolor_ember" } } });
  assert.equal(hashState(s), h0, "rendering with skins never touches sim state");
  let diff = 0;
  for (let i = 0; i < plain.data.length; i++) if (plain.data[i] !== ember.data[i]) diff++;
  assert.ok(diff > 0, "the livery recolours the player's ground");
  const again = renderTown(s, { frameTick: 0 });
  assert.deepEqual(again.data, plain.data, "no skin state leaks into the next frame");
  assert.deepEqual(sanitizeLoadout({ livery: "recolor_frost" }), { livery: "recolor_frost" });
  assert.deepEqual(sanitizeLoadout({ livery: "not_a_skin" }), {});
  assert.deepEqual(sanitizeLoadout({ livery: "recolor_frost" }, () => false), {}, "unowned skins are dropped");
});
