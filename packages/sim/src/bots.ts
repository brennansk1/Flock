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

import { getArchetype } from "./archetypes/registry.js";
import { IntentType, type Intent } from "./intents.js";
import { toInt } from "./fixed.js";
import { nextRange, type RngState } from "./rng.js";
import { Stance, Terrain, Lot, CivicDecreeId, MAX_COHORTS, type PlayerId, type SimState, type PlayerState } from "./types.js";
import { CIVIC_LOTS, computeCivicControl } from "./civics.js";
import { exposeBlocker } from "./entities.js";
import { compoundCost, followerCap } from "./sim.js";
import type { Balance } from "./balance.js";

/** Civic/key-building lot types churches like to siege (bonus-bearing tiles). */
const KEY_LOTS = new Set<number>(CIVIC_LOTS);

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
 * Find the strongest rival pressing on this bot's border and a tile to press
 * back at: scan a sample of the bot's tiles, tally which enemy owns the most
 * adjacent tiles, and remember one of that rival's border tiles as the front to
 * aim a cohort at. Returns { rival, front } (front = -1 if none catchable).
 */
function borderRival(sim: SimState, playerId: PlayerId): { rival: PlayerId; front: number } {
  const w = sim.world;
  const owner = w.owner;
  const tally = new Map<PlayerId, number>();
  const frontOf = new Map<PlayerId, number>(); // rival → one of its border tiles
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
      if (o !== 0 && o !== playerId) {
        tally.set(o, (tally.get(o) ?? 0) + 1);
        // prefer a convertible citizen tile as the press target
        if (w.terrain[n] === Terrain.Citizen && !frontOf.has(o)) frontOf.set(o, n);
      }
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
  return { rival: best, front: frontOf.get(best) ?? -1 };
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

/** Nearest key-building tile we don't already hold — a siege target (§M4). */
function nearestKeyBuilding(w: SimState["world"], from: number, playerId: PlayerId, maxR: number): number {
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
        if (w.terrain[t] === Terrain.Citizen && KEY_LOTS.has(w.lot[t]!) && w.owner[t] !== playerId) return t;
      }
    }
  }
  return -1;
}


/**
 * Cast the cult's abilities (registry-driven, so expansion cults get bots for
 * free). Picks a target by the ability's `aim` hint; the sim validates the rest.
 */
function castKit(
  out: Intent[],
  sim: SimState,
  bot: BotState,
  p: PlayerState,
  rng: RngState,
  own: number,
  front: number,
): void {
  for (const a of getArchetype(p.archetype).abilities) {
    if ((p.cooldowns[a.cooldownKey] ?? 0) > 0) continue;
    const c = a.cost(p);
    if ((c.usd !== undefined && p.usd < c.usd) || (c.faith !== undefined && p.faith < c.faith)) continue;
    let target = front;
    if (a.aim === "own") target = own;
    else if (a.aim === "rival") target = bot.grudge ? sampleOwned(sim, rng, bot.grudge, 40) : -1;
    else if (a.aim === "remote") {
      target = -1;
      const w = sim.world;
      for (let i = 0; i < 40 && target < 0; i++) {
        const t = nextRange(rng, w.terrain.length);
        if (w.terrain[t] === Terrain.Citizen && w.owner[t] === 0) target = t;
      }
    }
    if (a.targeting !== "none" && target < 0) continue;
    out.push(
      a.targeting === "none"
        ? { t: IntentType.ABILITY, player: bot.playerId, ability: a.id }
        : { t: IntentType.ABILITY, player: bot.playerId, ability: a.id, target },
    );
    return; // one cast per decision keeps cash for the economy
  }
}

/**
 * `b` (optional) lets the brain check the flock cap before buying commune
 * stages; without it the bot upgrades whenever it can afford to.
 */
export function botTurn(sim: SimState, bot: BotState, rng: RngState, b?: Balance): Intent[] {
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
  // ---- expansion: frontier-seeking (v3) ----------------------------------
  // Aim the flock at the nearest UNCONVERTED block so cohorts actually grow the
  // territory, instead of poking a random compass direction into wilderness
  // (the old behaviour — why bots crawled and never reached domination). Try a
  // couple of owned tiles as origins until one has an unworked frontier nearby.
  const reach = bot.tier === "drifter" ? 12 : 16;
  let front = nearestCitizen(w, origin, reach);
  for (let a = 0; a < 2 && front < 0; a++) {
    const o = sampleOwned(sim, rng, bot.playerId);
    if (o >= 0) front = nearestCitizen(w, o, reach);
  }
  // churches periodically point the wave at a key building instead of a plain
  // house — taking the school/sheriff/church swings a whole district (§M4).
  // Archetype-adapted building priorities (Task 5.2):
  // - Dawn: HighSchool, RadioTower
  // - Radiant: Supermarket, Church
  // - Circle: Bank, TownHall
  if (bot.tier === "church" && nextRange(rng, 2) === 0) {
    const prefLots = getArchetype(p.archetype).bot.prefLots;

    let targeted = -1;
    for (const targetLot of prefLots) {
      for (let r = 1; r <= 20; r++) {
        const cx = origin % w.width;
        const cy = (origin / w.width) | 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
            const t = y * w.width + x;
            if (w.terrain[t] === Terrain.Citizen && w.lot[t] === targetLot && w.owner[t] !== bot.playerId) {
              targeted = t;
              break;
            }
          }
          if (targeted >= 0) break;
        }
        if (targeted >= 0) break;
      }
      if (targeted >= 0) break;
    }
    if (targeted >= 0) front = targeted;
    else {
      const kb = nearestKeyBuilding(w, origin, bot.playerId, 18);
      if (kb >= 0) front = kb;
    }
  }
  sendMission(out, sim, bot, p, front, Stance.Spread);

  if (bot.tier === "drifter") return out; // drifters never build, ally, or scheme

  // ---- economy script (Sect + Church) ------------------------------------
  // Prosperity Gospel (§2C): the primary money→power loop is now buying flock.
  // Run a recruitment drive whenever the bank can plausibly cover one — cash
  // becomes cohort mass becomes territory becomes more tithe. Income archetypes
  // (Circle) fund this hardest, which is the whole point; the sim gates the
  // exact cost, so an unaffordable attempt is a harmless no-op.
  // Commune first when the flock presses its cap; otherwise recruit. A Circle
  // on the Ledger path stops spending and banks (its victory is the vault).
  const banking = p.archetype === "circle" && p.soulsPermille >= 150;
  if (p.usd >= compoundCost(p) && (!b || p.followers * 10 >= followerCap(p, b, sim) * 8)) {
    out.push({ t: IntentType.UPGRADE_COMMUNE, player: bot.playerId });
  } else if (!banking && usd(p) > 1500) {
    out.push({ t: IntentType.BUY_RECRUITS, player: bot.playerId });
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
    if (nextRange(rng, 3) === 0) castKit(out, sim, bot, p, rng, origin, front);
    return out;
  }

  // ======================= Established Church behaviour tree ==============
  // 1) discipline: when Heat runs high, cool off — a Tend mission at home
  // banks Faith and stops fresh conversions (which is what raises Heat now).
  const heat = toInt(p.heat);
  if (heat >= 70 && nextRange(rng, 2) === 0) sendMission(out, sim, bot, p, origin, Stance.Tend);

  // 2) doctrine: the cult's own build order (registry), then the generic one
  for (const node of [...getArchetype(p.archetype).bot.doctrine, ...CHURCH_DOCTRINE]) {
    if (!p.doctrine.includes(node)) {
      out.push({ t: IntentType.DOCTRINE_PICK, player: bot.playerId, node });
      break;
    }
  }

  // 3) grudges: an ASCENDING rival is everyone's problem — focus it and try to
  // expose it; otherwise lean on the strongest border rival.
  const ascending = sim.players.find((o) => o.id !== bot.playerId && o.alive && o.ascendPath !== "");
  let { rival, front: rivalFront } = borderRival(sim, bot.playerId);
  if (ascending) {
    rival = ascending.id;
    const t = sampleOwned(sim, rng, ascending.id, 60);
    if (t >= 0) rivalFront = t;
  }
  bot.grudge = rival;
  const rivalP = sim.players.find((o) => o.id === rival);
  if (rivalP && exposeBlocker(sim, p, rivalP) === "" && (ascending || rivalP.soulsPermille > p.soulsPermille + 100 || nextRange(rng, 6) === 0)) {
    out.push({ t: IntentType.PUBLISH_SCANDAL, player: bot.playerId, target: rival });
  }
  if (rival !== 0 && (bot.aggression >= 1 || ascending) && rivalFront >= 0) {
    // aim a cohort straight at the rival's contested doors (not our own turf).
    // Crusade for the extra pressure — but only when Heat has headroom, since
    // Crusade heats us up and high Heat invites the CPA.
    const mode = bot.aggression >= 2 && heat < 55 ? Stance.Crusade : Stance.Spread;
    sendMission(out, sim, bot, p, rivalFront, mode);
  }

  // 3b) the cult's kit — cast when affordable
  if (nextRange(rng, 2) === 0) castKit(out, sim, bot, p, rng, origin, rivalFront >= 0 && nextRange(rng, 2) === 0 ? rivalFront : front);

  // 4) prophecy / signature: spend the dramatic button when it's likely ready
  if (nextRange(rng, 25) === 0) {
    out.push({ t: IntentType.SIGNATURE, player: bot.playerId });
  }

  // 5) Civic Decrees: intelligently invoke active decrees when controlling key institutions
  if (bot.tier === "church" && nextRange(rng, 4) === 0) {
    const ctrl = computeCivicControl(sim);
    if (ctrl.get(Lot.Sheriff) === bot.playerId) {
      out.push({ t: IntentType.CIVIC_DECREE, player: bot.playerId, decree: CivicDecreeId.TownCurfew });
    } else if (ctrl.get(Lot.HighSchool) === bot.playerId) {
      out.push({ t: IntentType.CIVIC_DECREE, player: bot.playerId, decree: CivicDecreeId.PepRally });
    } else if (ctrl.get(Lot.Supermarket) === bot.playerId) {
      out.push({ t: IntentType.CIVIC_DECREE, player: bot.playerId, decree: CivicDecreeId.FoodRationing });
    } else if (ctrl.get(Lot.Church) === bot.playerId) {
      out.push({ t: IntentType.CIVIC_DECREE, player: bot.playerId, decree: CivicDecreeId.EvangelicalRevival });
    } else if (ctrl.get(Lot.School) === bot.playerId) {
      out.push({ t: IntentType.CIVIC_DECREE, player: bot.playerId, decree: CivicDecreeId.ParentTeacherNight });
    }
  }

  return out;
}
