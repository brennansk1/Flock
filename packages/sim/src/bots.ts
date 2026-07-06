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

import { IntentType, type Intent } from "./intents.js";
import { toInt } from "./fixed.js";
import { nextRange, type RngState } from "./rng.js";
import { Stance, Terrain, MAX_COHORTS, type PlayerId, type SimState, type PlayerState } from "./types.js";

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

/** Cohort commitment by tier — churches send bigger waves (v3 missions). */
function missionPermille(bot: BotState): number {
  return bot.tier === "church" ? 600 : bot.tier === "sect" ? 450 : 350;
}

/**
 * Send a cohort at `target` in `mode`, respecting the MAX_COHORTS cap: if
 * full, recall a cohort whose target zone we already hold (its work is done),
 * freeing a slot next cycle. Deterministic (no rng); a -1 target is a no-op.
 */
function sendMission(
  out: Intent[],
  sim: SimState,
  bot: BotState,
  p: PlayerState,
  target: number,
  mode: Stance,
): void {
  if (target < 0) return;
  if (p.cohorts.length < MAX_COHORTS) {
    out.push({
      t: IntentType.MISSION_SEND,
      player: bot.playerId,
      tile: target,
      permille: missionPermille(bot),
      mode,
    });
    return;
  }
  const idx = p.cohorts.findIndex((c) => !c.recalling && sim.world.owner[c.target] === bot.playerId);
  if (idx >= 0) out.push({ t: IntentType.MISSION_RECALL, player: bot.playerId, slot: idx });
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

/**
 * Produce this bot's intents for the current tick. Caller should gate on
 * botShouldAct first; this assumes it's the bot's turn to think.
 */
/** Nearest convertible citizen tile within maxR (spiral, deterministic). */
function nearestCitizen(w: SimState["world"], from: number, maxR: number): number {
  const cx = from % w.width;
  const cy = (from / w.width) | 0;
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
        const t = y * w.width + x;
        if (w.terrain[t] === Terrain.Citizen && w.owner[t] === 0) return t;
      }
    }
  }
  return -1;
}


export function botTurn(sim: SimState, bot: BotState, rng: RngState): Intent[] {
  const out: Intent[] = [];
  const p = sim.players.find((pl) => pl.id === bot.playerId);
  if (!p || !p.alive || !p.spawned) return out;
  const w = sim.world;

  let origin = sampleOwned(sim, rng, bot.playerId);
  if (origin < 0) {
    // no territory yet (property-start §18 rev.): operate from the compound
    const compound = sim.buildings.find((bd) => bd.player === bot.playerId && bd.type === "compound");
    if (!compound) return out;
    origin = compound.tile;
  }
  const ox = origin % w.width;
  const oy = (origin / w.width) | 0;

  // ---- expansion (all tiers expand; reach/discipline differ) -------------
  if (p.ownedTiles === 0) {
    // beachhead (v3): send the flock at the nearest citizen block
    sendMission(out, sim, bot, p, nearestCitizen(w, origin, 12), Stance.Spread);
  } else {
    const dir = nextRange(rng, 4);
    const reach = bot.tier === "drifter" ? 3 : 4;
    const dx = dir === 0 ? reach : dir === 1 ? -reach : 0;
    const dy = dir === 2 ? reach : dir === 3 ? -reach : 0;
    const tx = ox + dx;
    const ty = oy + dy;
    const target = tx >= 0 && ty >= 0 && tx < w.width && ty < w.height ? ty * w.width + tx : -1;
    sendMission(out, sim, bot, p, target, Stance.Spread);
  }

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
  // v3 money→power: pour spare cash into commune stages (raises the flock cap)
  if (usd(p) > 25_000 && nextRange(rng, 3) === 0) {
    out.push({ t: IntentType.UPGRADE_COMMUNE, player: bot.playerId });
  }
  // (v3 M3.3b: placeable buildings cut — bots grow via commune upgrades above)
  // land acquisition (§18 rev.): buy the next parcel before crowding bites
  if (usd(p) > 60_000 && nextRange(rng, 10) === 0) {
    const dir2 = nextRange(rng, 4);
    const off = dir2 === 0 ? 6 : dir2 === 1 ? -6 : dir2 === 2 ? 6 * w.width : -6 * w.width;
    out.push({ t: IntentType.BUY_PROPERTY, player: bot.playerId, tile: origin + off });
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
    // press the rival border: a cohort auto-spreads to the contested doors.
    // Aggressive churches send it in as a Crusade.
    const target = sampleOwned(sim, rng, bot.playerId);
    sendMission(out, sim, bot, p, target, bot.aggression >= 2 ? Stance.Crusade : Stance.Spread);
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
