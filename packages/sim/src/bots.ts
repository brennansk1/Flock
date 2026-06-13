/**
 * Bot brains (§21). All three tiers run through the same Intent API the humans
 * use — zero fog exemptions, zero stat cheats. The sim's applyIntent is
 * defensive (an illegal intent is a no-op), so a brain may *attempt* a rich set
 * of intents and lean on the sim to reject what isn't currently affordable or
 * legal. That keeps the brains small and keeps "cheating" structurally
 * impossible.
 *
 * These functions are pure given (sim, bot, rng): they read sim state, advance
 * the supplied RNG, and return intents. They never mutate the sim, so the
 * server can call them, queue the result into the turn stream, and stay
 * replay-faithful (the intents are what land in the log).
 *
 *   Drifters — random-walk expansion, never build/ally, fold under pressure.
 *   Sects    — utility expansion toward neutrals + a Compound→Plate→Tower script.
 *   Churches — full behaviour tree: stance discipline, doctrine builds, grudges
 *              (focus the strongest border rival), prophecy/signature, scandal.
 */

import { IntentType, type Intent, type BuildingType } from "./intents.js";
import { toInt } from "./fixed.js";
import { nextRange, type RngState } from "./rng.js";
import { Stance, type PlayerId, type SimState, type PlayerState } from "./types.js";

export type BotTier = "drifter" | "sect" | "church";

export interface BotState {
  playerId: PlayerId;
  tier: BotTier;
  /** ticks between decision batches (the difficulty "action latency" knob). */
  cadence: number;
  /** 0..3 aggression prior: higher = opens more fronts, publishes sooner. */
  aggression: number;
  /** current focus rival, recomputed each batch (0 = none). */
  grudge: PlayerId;
}

const usd = (p: PlayerState): number => toInt(p.usd);

/** Should this bot think this tick? Phase-offset by id so they don't sync up. */
export function botShouldAct(bot: BotState, tick: number): boolean {
  return (tick + bot.playerId * 7) % bot.cadence === 0;
}

/** A random tile this bot owns (sampled, so it stays O(samples)), or -1. */
function sampleOwned(sim: SimState, rng: RngState, playerId: PlayerId, samples = 30): number {
  const owner = sim.world.owner;
  for (let i = 0; i < samples; i++) {
    const t = nextRange(rng, owner.length);
    if (owner[t] === playerId) return t;
  }
  return -1;
}

/** A square of tiles around (cx,cy), clamped to the map. */
function blockAround(sim: SimState, cx: number, cy: number, rad: number): number[] {
  const w = sim.world;
  const tiles: number[] = [];
  for (let oy = -rad; oy <= rad; oy++) {
    for (let ox = -rad; ox <= rad; ox++) {
      const x = cx + ox;
      const y = cy + oy;
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
      tiles.push(y * w.width + x);
    }
  }
  return tiles;
}

/**
 * Find the strongest rival pressing on this bot's border: scan a sample of the
 * bot's tiles, tally which enemy owns the most adjacent tiles, return that id.
 */
function borderRival(sim: SimState, playerId: PlayerId): PlayerId {
  const w = sim.world;
  const owner = w.owner;
  const tally = new Map<PlayerId, number>();
  const step = Math.max(1, (owner.length / 4000) | 0);
  for (let t = 0; t < owner.length; t += step) {
    if (owner[t] !== playerId) continue;
    const x = t % w.width;
    const y = (t / w.width) | 0;
    const neigh = [
      x > 0 ? t - 1 : -1,
      x < w.width - 1 ? t + 1 : -1,
      y > 0 ? t - w.width : -1,
      y < w.height - 1 ? t + w.width : -1,
    ];
    for (const n of neigh) {
      if (n < 0) continue;
      const o = owner[n]!;
      if (o !== 0 && o !== playerId) tally.set(o, (tally.get(o) ?? 0) + 1);
    }
  }
  let best: PlayerId = 0;
  let bestN = 0;
  for (const [pid, n] of tally) {
    if (n > bestN) {
      bestN = n;
      best = pid;
    }
  }
  return best;
}

/** A coherent doctrine build order (defensive sim ignores illegal/early picks). */
const CHURCH_DOCTRINE = ["B1", "T1", "B2", "T2", "I1", "B3", "T3"];
const CHURCH_BUILDS: BuildingType[] = [
  "compound",
  "collection_plate",
  "watchtower",
  "broadcast_tower",
  "print_shop",
];

/**
 * Produce this bot's intents for the current tick. Caller should gate on
 * botShouldAct first; this assumes it's the bot's turn to think.
 */
export function botTurn(sim: SimState, bot: BotState, rng: RngState): Intent[] {
  const out: Intent[] = [];
  const p = sim.players.find((pl) => pl.id === bot.playerId);
  if (!p || !p.alive || !p.spawned) return out;
  const w = sim.world;

  const origin = sampleOwned(sim, rng, bot.playerId);
  if (origin < 0) return out;
  const ox = origin % w.width;
  const oy = (origin / w.width) | 0;

  // ---- expansion (all tiers expand; reach/discipline differ) -------------
  const dir = nextRange(rng, 4);
  const reach = bot.tier === "drifter" ? 3 : 4;
  const dx = dir === 0 ? reach : dir === 1 ? -reach : 0;
  const dy = dir === 2 ? reach : dir === 3 ? -reach : 0;
  const fronts = blockAround(sim, ox + dx, oy + dy, bot.tier === "drifter" ? 2 : 3);
  if (fronts.length > 0) out.push({ t: IntentType.OPEN_FRONT, player: bot.playerId, tiles: fronts });

  // ---- stance discipline -------------------------------------------------
  if (bot.tier === "drifter") {
    // drifters drift: mostly spread, rare brief crusade
    if (nextRange(rng, 12) === 0) {
      out.push({
        t: IntentType.SET_STANCE,
        player: bot.playerId,
        stance: nextRange(rng, 3) === 0 ? Stance.Crusade : Stance.Spread,
      });
    }
    return out; // drifters never build, ally, or scheme
  }

  // ---- economy script (Sect + Church) ------------------------------------
  const builds = bot.tier === "church" ? CHURCH_BUILDS : (["compound", "collection_plate", "watchtower"] as const);
  if (usd(p) > 35_000 && nextRange(rng, bot.tier === "church" ? 4 : 6) === 0) {
    const building = builds[nextRange(rng, builds.length)]!;
    out.push({ t: IntentType.BUILD, player: bot.playerId, building, tile: origin });
  }

  // keep Faith healthy
  if (nextRange(rng, 40) === 0) {
    out.push({ t: IntentType.RITUAL, player: bot.playerId, ritual: "sermon" });
  }

  if (bot.tier === "sect") {
    // Sects play their gimmick naively: occasional signature, mild crusade.
    if (nextRange(rng, 30) === 0) out.push({ t: IntentType.SIGNATURE, player: bot.playerId });
    if (nextRange(rng, 20) === 0) {
      out.push({ t: IntentType.SET_STANCE, player: bot.playerId, stance: Stance.Spread });
    }
    return out;
  }

  // ======================= Established Church behaviour tree ==============
  // 1) discipline: SHELTER when Heat is high, CRUSADE when aggressive & healthy
  const heat = toInt(p.heat);
  const faith = toInt(p.faith);
  if (heat >= 70) {
    out.push({ t: IntentType.SET_STANCE, player: bot.playerId, stance: Stance.Tend });
  } else if (bot.aggression >= 2 && faith >= 40 && nextRange(rng, 3) !== 0) {
    out.push({ t: IntentType.SET_STANCE, player: bot.playerId, stance: Stance.Crusade });
  } else {
    out.push({ t: IntentType.SET_STANCE, player: bot.playerId, stance: Stance.Spread });
  }

  // 2) doctrine: take the next node in the build order whenever a point exists
  for (const node of CHURCH_DOCTRINE) {
    if (!p.doctrine.includes(node)) {
      out.push({ t: IntentType.DOCTRINE_PICK, player: bot.playerId, node });
      break;
    }
  }

  // 3) grudges: recompute the strongest border rival and lean on them
  const rival = borderRival(sim, bot.playerId);
  bot.grudge = rival;
  if (rival !== 0 && bot.aggression >= 1) {
    // focus a front toward a tile we share a border with the rival on
    const target = sampleOwned(sim, rng, bot.playerId);
    if (target >= 0) {
      const tx = target % w.width;
      const ty = (target / w.width) | 0;
      const push = blockAround(sim, tx, ty, 2);
      if (push.length > 0) out.push({ t: IntentType.OPEN_FRONT, player: bot.playerId, tiles: push });
    }
    // publish a scandal on the rival when feeling aggressive (sim gates on evidence)
    if (bot.aggression >= 2 && nextRange(rng, 8) === 0) {
      out.push({ t: IntentType.PUBLISH_SCANDAL, player: bot.playerId, target: rival });
    }
  }

  // 4) prophecy / signature: spend the dramatic button when it's likely ready
  if (nextRange(rng, 25) === 0) {
    out.push({ t: IntentType.SIGNATURE, player: bot.playerId });
  }

  return out;
}
