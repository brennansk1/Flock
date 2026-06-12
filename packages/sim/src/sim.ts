/**
 * The simulation core (Part II). One `step` == one tick (100 ms, §32). Given a
 * Turn's intents and the same starting state, every machine must reach the same
 * next state — that is the lockstep contract.
 *
 * M0 scope (this file): state construction, intent application skeleton, and the
 * deterministic per-tick economy/decay loop (followers §3.1, tithe §3.2,
 * dissent §3.4, heat §3.5). Conversion resolution (§4) and the front system are
 * built out separately — see resolveConversion(), the M0 critical-path task.
 */

import { add, sub, mul, div, clamp, fromInt, ONE, type Fixed } from "./fixed.js";
import { seedRng, type RngState } from "./rng.js";
import type { Balance } from "./balance.js";
import { IntentType, type Intent, type Turn } from "./intents.js";
import {
  NEUTRAL,
  Stance,
  type PlayerState,
  type SimState,
  type World,
  type PlayerId,
} from "./types.js";

const HUNDRED: Fixed = fromInt(100);
const FIFTY: Fixed = fromInt(50);
const TWO_HUNDRED: Fixed = fromInt(200);

export interface PlayerSpawn {
  id: PlayerId;
  archetype: PlayerState["archetype"];
}

/** Build an empty world. The mapgen tool fills terrain/district/S; tests fill by hand. */
export function createWorld(width: number, height: number): World {
  const n = width * height;
  return {
    width,
    height,
    terrain: new Uint8Array(n),
    state: new Uint8Array(n),
    owner: new Uint32Array(n),
    susceptibility: new Int32Array(n),
    dissent: new Int32Array(n),
    scarTicks: new Uint16Array(n),
    district: new Uint32Array(n),
  };
}

/** Construct a fresh, deterministic SimState. */
export function createSim(opts: {
  seed: number;
  balance: Balance;
  world: World;
  spawns: PlayerSpawn[];
}): SimState {
  const rng: RngState = seedRng(opts.seed);
  const players: PlayerState[] = opts.spawns.map((s) => ({
    id: s.id,
    archetype: s.archetype,
    alive: true,
    stance: Stance.Spread,
    followers: opts.balance.economy.startFollowers,
    usd: opts.balance.economy.startUsd,
    faith: FIFTY,
    heat: 0,
    compounds: 1, // free First Compound (§3.1)
    ownedTiles: 0,
  }));
  return { tick: 0, rng, world: opts.world, players };
}

/** Follower cap for a player: cap_base + cap_per_compound × compounds (§3.1). */
export function followerCap(p: PlayerState, b: Balance): Fixed {
  return add(b.economy.capBase, mul(b.economy.capPerCompound, fromInt(p.compounds)));
}

/** Apply a single validated intent. Mutating, deterministic, no I/O. */
export function applyIntent(s: SimState, intent: Intent, _b: Balance): void {
  const p = s.players.find((pl) => pl.id === intent.player);
  if (!p || !p.alive) return;
  switch (intent.t) {
    case IntentType.SET_STANCE:
      p.stance = intent.stance;
      break;
    // Remaining intents (OPEN_FRONT, BUILD, RITUAL, STRIKE, ...) are wired in as
    // their subsystems land. Each is a pure mutation of SimState.
    default:
      break;
  }
}

/**
 * Per-tick economy + decay (§3). Pure fixed-point, RNG-free, order-stable.
 * Iterates players in id order so the result never depends on array shuffling.
 */
function stepEconomy(s: SimState, b: Balance): void {
  const dt = b.dt;
  for (const p of s.players) {
    if (!p.alive) continue;

    // Followers — logistic growth (§3.1). faith_growth_mod = 0.8 + Faith/250.
    const cap = followerCap(p, b);
    if (cap > 0) {
      const faithGrowthMod = add(fromFloatish(0.8), div(p.faith, fromInt(250)));
      const archGrowth = ONE; // archetype growth mods applied with full kits later
      const utilization = sub(ONE, div(p.followers, cap)); // (1 − F/cap)
      let dF = mul(b.economy.followerGrowth, mul(p.followers, utilization));
      dF = mul(dF, mul(faithGrowthMod, archGrowth));
      p.followers = clamp(add(p.followers, mul(dF, dt)), 0, cap);
    }

    // Tithe (§3.2): $/sec = tithe_per_follower × F × income_avg × dissent_tax.
    // income_avg and dissent_tax come from owned tiles; with no territory yet we
    // use neutral defaults (1.0 income, 0 avg dissent) until the tile pass lands.
    const incomeAvg = ONE;
    const dissentTax = ONE; // 1 − avg_dissent/200, avg_dissent defaults 0
    const tithePerSec = mul(mul(b.economy.tithePerFollower, p.followers), mul(incomeAvg, dissentTax));
    p.usd = add(p.usd, mul(tithePerSec, dt));

    // Faith base drift toward 50 at ±0.05/s (§3.3).
    const drift = fromFloatish(0.05);
    if (p.faith > FIFTY) p.faith = clamp(sub(p.faith, mul(drift, dt)), FIFTY, HUNDRED);
    else if (p.faith < FIFTY) p.faith = clamp(add(p.faith, mul(drift, dt)), 0, FIFTY);

    // Heat decay (§3.5) base −0.08/s, plus crusade gain while active.
    let heat = p.heat;
    if (p.stance === Stance.Crusade) heat = add(heat, mul(b.stances.crusade.heatPerS, dt));
    heat = sub(heat, mul(b.heat.decay, dt));
    p.heat = clamp(heat, 0, HUNDRED);
  }

  // Dissent decay (§3.4): −0.15/s base, per tile. Clamp to [0,100].
  const w = s.world;
  const decayPerTick = mul(fromFloatish(0.15), dt);
  for (let i = 0; i < w.dissent.length; i++) {
    if (w.owner[i] === NEUTRAL) continue;
    const d = (w.dissent[i]! - decayPerTick) | 0;
    w.dissent[i] = d < 0 ? 0 : d > TWO_HUNDRED ? HUNDRED : d;
  }

  // Apostate scar countdown (§4.7): when it hits 0 the tile reverts to Neutral.
  for (let i = 0; i < w.scarTicks.length; i++) {
    if (w.scarTicks[i]! > 0) {
      const remaining = w.scarTicks[i]! - 1;
      w.scarTicks[i] = remaining;
      if (remaining === 0) {
        w.state[i] = 0; // Neutral
        w.owner[i] = NEUTRAL;
      }
    }
  }
}

/** Advance the sim by one tick using a Turn's intents. Returns the same state. */
export function step(s: SimState, turn: Turn, b: Balance): SimState {
  // Fold the turn's seed slice into the RNG stream so server and client agree.
  s.rng.s3 = (s.rng.s3 ^ (turn.seedSlice >>> 0)) >>> 0;

  // Intents apply in their given (server-bundled) order for determinism.
  for (const intent of turn.intents) applyIntent(s, intent, b);

  stepEconomy(s, b);
  // resolveConversion(s, b);  // §4 — wired in by the conversion subsystem.

  s.tick++;
  return s;
}

/**
 * Tiny helper to express a small literal rate as Fixed without importing the
 * float path everywhere. Boundary-only, like balance loading.
 */
function fromFloatish(n: number): Fixed {
  return Math.round(n * ONE) | 0;
}
