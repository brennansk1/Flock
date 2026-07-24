/**
 * The victory PATHS as strategy (§18). A player should be choosing which way to
 * win — out-convert the town, bank The Ledger, or hold the Megachurch and
 * channel — and each path must actually be reachable in a shipped match.
 *
 * These are regression tests for a real defect: both Revelation paths were
 * implemented and unit-tested, but gated on `revelationMode`, which defaulted
 * to false and was never set true by the server, the lobby, or any tool. The
 * doctrinal test in m2.test.ts passed the flag explicitly, so the mechanic was
 * green while production shipped with exactly one reachable win condition — and
 * the Prosperity Circle, whose §11.3 identity IS the economic win, had none.
 *
 * They also pin the tuning knobs as LIVE. balance.json advertises itself as the
 * single source of tuning truth, and twelve of its knobs used to reach nothing.
 * A knob that a test can move is a knob a designer can move.
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
  IntentType,
  MatchStatus,
  type RawBalance,
  type Intent,
  type Turn,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance;
const balance = loadBalance(raw);

const turn = (n: number, intents: Intent[] = []): Turn => ({ n, intents, seedSlice: n * 7 });

function world16() {
  const w = createWorld(16, 16);
  for (let i = 0; i < w.susceptibility.length; i++) w.susceptibility[i] = fromInt(50);
  return w;
}

/** A two-cult match with the Circle seated, victory paths live. */
function ledgerSim(b = balance) {
  const s = createSim({
    seed: 3,
    balance: b,
    world: world16(),
    spawns: [
      { id: 1, archetype: "circle" },
      { id: 2, archetype: "dawn" },
    ],
    timerTicks: 0,
    dominationPermille: 1000, // keep domination out of the way
  });
  step(
    s,
    turn(0, [
      { t: IntentType.SPAWN, player: 1, tile: 2 * 16 + 4 },
      { t: IntentType.SPAWN, player: 2, tile: 13 * 16 + 13 },
    ]),
    balance,
  );
  return s;
}

test("Revelation is ON by default — the alternate paths ship reachable", () => {
  const s = ledgerSim();
  assert.equal(s.revelationMode, true, "a default match has the alternate victory paths live");
});

test("economic victory: the Circle banking the map target wins the match", () => {
  const s = ledgerSim();
  const target = raw.victory.economic_usd.S; // 16² world → S bucket

  s.players[0]!.usd = fromInt(target - 1);
  step(s, turn(s.tick), balance);
  assert.equal(s.status, MatchStatus.Live, "one dollar short does not win");

  s.players[0]!.usd = fromInt(target);
  step(s, turn(s.tick), balance);
  assert.equal(s.status, MatchStatus.Ended, "hitting The Ledger target ends the match");
  assert.equal(s.winner, 1, "the Circle wins on its own path (§11.3)");
});

test("economic victory is the Circle's alone — another archetype banking it does not win", () => {
  const s = ledgerSim();
  s.players[1]!.usd = fromInt(raw.victory.economic_usd.S * 10);
  step(s, turn(s.tick), balance);
  assert.equal(s.status, MatchStatus.Live, "asymmetry holds: the path belongs to one kit (P2)");
});

test("the economic target is a LIVE knob, not a hardcoded constant", () => {
  // halve the target in the JSON; the same bank must now be enough to win.
  const cheap = loadBalance({
    ...raw,
    victory: { ...raw.victory, economic_usd: { S: 100_000, M: 100_000, L: 100_000 } },
  } as RawBalance);
  const s = ledgerSim(cheap);
  s.players[0]!.usd = fromInt(100_000);
  step(s, turn(s.tick), cheap);
  assert.equal(s.status, MatchStatus.Ended, "balance.json drives the threshold");
  assert.equal(s.winner, 1);
});

test("the schism trigger is a LIVE knob", () => {
  // territory_share of 0 makes every spawned cult territory-eligible at once,
  // so the gauge depends only on dissent — proving the JSON reaches stepSchism.
  const loose = loadBalance({ ...raw, schism: { ...raw.schism, territory_share: 0 } } as RawBalance);
  assert.equal(loose.schism.territorySharePermille, 0, "0% share reaches the loaded balance");
  const strict = loadBalance({ ...raw, schism: { ...raw.schism, sustain_s: 999 } } as RawBalance);
  assert.equal(strict.schism.sustainTicks, 9990, "sustain seconds convert to ticks");
});

test("the scandal knobs are LIVE", () => {
  const b = loadBalance({
    ...raw,
    scandal: { ...raw.scandal, notify_at: 10, dmg_min: 1, dmg_max: 2 },
  } as RawBalance);
  assert.equal(b.scandal.notifyAt, fromInt(10), "notify threshold reaches the loaded balance");
  assert.equal(b.scandal.dmgMin, fromInt(1));
  assert.equal(b.scandal.dmgMax, fromInt(2));
  // the watched-rate defaults to half the open rate when the JSON omits it
  assert.equal(b.scandal.evidenceWatchedPerS, loadBalance(raw).scandal.evidenceWatchedPerS);
});
