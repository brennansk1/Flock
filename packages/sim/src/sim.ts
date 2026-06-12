/**
 * The simulation core (Part II). One `step` == one tick (100 ms, §32). Given a
 * Turn's intents and the same starting state, every machine must reach the same
 * next state — that is the lockstep contract.
 *
 * M0 systems in this file: state construction, intent application (stances,
 * spawns, fronts, compounds, rituals §9, Final Dawn kit §11.1), the per-tick
 * economy/decay loop (§3), timed-effect countdowns, Prophecy resolution, and
 * the victory/elimination state machine (§18). Conversion resolution (§4)
 * lives in conversion.ts.
 */

import { add, sub, mul, div, clamp, min, fromInt, ONE, type Fixed } from "./fixed.js";
import { seedRng, type RngState } from "./rng.js";
import type { Balance } from "./balance.js";
import { IntentType, type Intent, type Turn } from "./intents.js";
import {
  NEUTRAL,
  Stance,
  Terrain,
  TileState,
  MatchStatus,
  type PlayerState,
  type SimState,
  type World,
  type PlayerId,
  type TileId,
  type DistrictId,
} from "./types.js";
import { resolveConversion } from "./conversion.js";

const HUNDRED: Fixed = fromInt(100);
const FIFTY: Fixed = fromInt(50);

/** ticks per second at the canonical 100ms tick */
const TPS = 10;

/** Ritual/ability tuning (§9, §11.1). ITVs; promote to balance.json when tuned. */
export const KIT = {
  sermon: { cooldown: 30 * TPS, faithGain: 12, buffTicks: 20 * TPS },
  festival: { cost: 25, cooldown: 120 * TPS, radius: 10, durTicks: 30 * TPS, heat: 8 },
  offering: {
    faithCost: 10,
    followerCost: 200,
    faithGain: 20,
    cooldown: 90 * TPS,
    dissent: 4,
    heat: 5,
  },
  atonement: { cost: 20, cooldown: 180 * TPS, durTicks: 30 * TPS },
  streetProphet: { cost: 12_000, cooldown: 45 * TPS, durTicks: 30 * TPS },
  stockpileSermon: { cost: 30, cooldown: 90 * TPS, durTicks: 12 * TPS, afterDissent: 10 },
  prophecy: {
    minTiles: 1500,
    /** dev-scale fallback: 10% of populated if the map is smaller than spec */
    minShareOfPopulated: 0.1,
    durTicks: 180 * TPS,
    heat: 15,
    winFaith: 30,
    failFaith: 40,
    failApostasyPct: 15,
    failDissent: 20,
    /** High-S band floor for the rapture flip */
    highS: 65,
    capShareOfMap: 0.12,
    borderRange: 4,
  },
} as const;

export interface PlayerSpawn {
  id: PlayerId;
  archetype: PlayerState["archetype"];
}

/** Build an empty world. Mapgen (mapgen.ts) fills terrain/district/S; tests fill by hand. */
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
    districtCoeffs: [{ conv: ONE, retain: ONE, income: ONE }],
  };
}

/** Canonical fresh-player factory — the only place initial player state is defined. */
export function newPlayer(
  id: PlayerId,
  archetype: PlayerState["archetype"],
  b: Balance,
): PlayerState {
  return {
    id,
    archetype,
    alive: true,
    stance: Stance.Spread,
    followers: b.economy.startFollowers,
    usd: b.economy.startUsd,
    faith: FIFTY,
    heat: 0,
    compounds: 1, // free First Compound (§3.1)
    ownedTiles: 0,
    spawned: false,
    cooldowns: {},
    sermonBuffTicks: 0,
    atonementTicks: 0,
    prophecyUsed: false,
  };
}

/** Construct a fresh, deterministic SimState. */
export function createSim(opts: {
  seed: number;
  balance: Balance;
  world: World;
  spawns: PlayerSpawn[];
  /** domination threshold in per-mille; default 720 (72%, S/M maps §1) */
  dominationPermille?: number;
  /** match timer in ticks; default 12 min (S map §1); 0 = untimed */
  timerTicks?: number;
}): SimState {
  const rng: RngState = seedRng(opts.seed);
  let populated = 0;
  for (let t = 0; t < opts.world.terrain.length; t++) {
    if (opts.world.terrain[t] === Terrain.Citizen) populated++;
  }
  return {
    tick: 0,
    rng,
    world: opts.world,
    players: opts.spawns.map((s) => newPlayer(s.id, s.archetype, opts.balance)),
    fronts: [],
    nextFrontId: 1,
    progress: new Map(),
    populated,
    dominationPermille: opts.dominationPermille ?? 720,
    timerTicks: opts.timerTicks ?? 12 * 60 * TPS,
    status: MatchStatus.Live,
    winner: 0,
    pylons: [],
    districtBuffs: [],
    auras: [],
    prophecies: [],
  };
}

/** Follower cap for a player: cap_base + cap_per_compound × compounds (§3.1). */
export function followerCap(p: PlayerState, b: Balance): Fixed {
  return add(b.economy.capBase, mul(b.economy.capPerCompound, fromInt(p.compounds)));
}

/** Compound cost: $15,000 × 1.35^(existing compounds − 1); the first is free (§6). */
export function compoundCost(p: PlayerState): Fixed {
  let cost = fromInt(15000);
  const growth = fp(1.35);
  for (let i = 1; i < p.compounds; i++) cost = mul(cost, growth);
  return cost;
}

/** Heat gain scaled by the archetype's heat coefficient (§3.5, §11 table). */
function gainHeat(p: PlayerState, b: Balance, amount: number): void {
  p.heat = clamp(add(p.heat, mul(fromInt(amount), b.archetypes[p.archetype].heat)), 0, HUNDRED);
}

function onCooldown(p: PlayerState, key: string): boolean {
  return (p.cooldowns[key] ?? 0) > 0;
}

function startCooldown(p: PlayerState, key: string, ticks: number): void {
  p.cooldowns[key] = ticks;
}

/** Claim a radius-`r` blob of neutral citizen tiles around `center` for `pid`. */
function claimBlob(s: SimState, pid: PlayerId, center: TileId, r: number): number {
  const w = s.world;
  const cx = center % w.width;
  const cy = (center / w.width) | 0;
  let claimed = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
      if (dx * dx + dy * dy > r * r) continue;
      const t = y * w.width + x;
      if (w.terrain[t] !== Terrain.Citizen) continue;
      if (w.owner[t] !== NEUTRAL || w.state[t] !== TileState.Neutral) continue;
      w.owner[t] = pid;
      w.state[t] = TileState.Believer;
      claimed++;
    }
  }
  return claimed;
}

/** Add dissent to every owned-or-not citizen tile of a district. */
function addDistrictDissent(w: World, district: DistrictId, amount: number): void {
  const amt = fromInt(amount);
  for (let t = 0; t < w.district.length; t++) {
    if (w.district[t] !== district || w.terrain[t] !== Terrain.Citizen) continue;
    w.dissent[t] = min(add(w.dissent[t]!, amt), HUNDRED);
  }
}

function applyRitual(s: SimState, p: PlayerState, b: Balance, intent: Intent): void {
  if (intent.t !== IntentType.RITUAL) return;
  switch (intent.ritual) {
    case "sermon": {
      // §9: must be in Tend/Spread; channel modeled as cooldown for M0.
      if (p.stance === Stance.Crusade || onCooldown(p, "sermon")) return;
      p.faith = clamp(add(p.faith, fromInt(KIT.sermon.faithGain)), 0, HUNDRED);
      p.sermonBuffTicks = KIT.sermon.buffTicks;
      startCooldown(p, "sermon", KIT.sermon.cooldown);
      return;
    }
    case "midnight_festival": {
      if (onCooldown(p, "festival") || p.faith < fromInt(KIT.festival.cost)) return;
      const tile = intent.tile ?? -1;
      if (tile < 0 || tile >= s.world.terrain.length) return;
      p.faith = sub(p.faith, fromInt(KIT.festival.cost));
      s.auras.push({
        player: p.id,
        tile,
        radius: KIT.festival.radius,
        ticksLeft: KIT.festival.durTicks,
      });
      gainHeat(p, b, KIT.festival.heat);
      startCooldown(p, "festival", KIT.festival.cooldown);
      return;
    }
    case "the_offering": {
      if (
        onCooldown(p, "offering") ||
        p.faith < fromInt(KIT.offering.faithCost) ||
        p.followers < fromInt(KIT.offering.followerCost)
      )
        return;
      // pay 10 Faith + 200 followers; gain +20 Faith (cartoon poof + halo, always)
      p.faith = clamp(
        add(sub(p.faith, fromInt(KIT.offering.faithCost)), fromInt(KIT.offering.faithGain)),
        0,
        HUNDRED,
      );
      p.followers = sub(p.followers, fromInt(KIT.offering.followerCost));
      const district =
        intent.district ?? (intent.tile !== undefined ? s.world.district[intent.tile]! : 0);
      if (district > 0) addDistrictDissent(s.world, district, KIT.offering.dissent);
      gainHeat(p, b, KIT.offering.heat);
      startCooldown(p, "offering", KIT.offering.cooldown);
      return;
    }
    case "day_of_atonement": {
      if (onCooldown(p, "atonement") || p.faith < fromInt(KIT.atonement.cost)) return;
      p.faith = sub(p.faith, fromInt(KIT.atonement.cost));
      p.atonementTicks = KIT.atonement.durTicks;
      startCooldown(p, "atonement", KIT.atonement.cooldown);
      return;
    }
  }
}

function applyAbility(s: SimState, p: PlayerState, b: Balance, intent: Intent): void {
  if (intent.t !== IntentType.ABILITY) return;
  switch (intent.ability) {
    case "street_prophet": {
      // §11.1 Final Dawn active 1: fear-pressure pylon.
      if (p.archetype !== "dawn") return;
      if (onCooldown(p, "street_prophet") || p.usd < fromInt(KIT.streetProphet.cost)) return;
      const t = intent.target ?? -1;
      if (t < 0 || t >= s.world.terrain.length || s.world.terrain[t] !== Terrain.Citizen) return;
      p.usd = sub(p.usd, fromInt(KIT.streetProphet.cost));
      s.pylons.push({ player: p.id, tile: t, ticksLeft: KIT.streetProphet.durTicks });
      startCooldown(p, "street_prophet", KIT.streetProphet.cooldown);
      return;
    }
    case "stockpile_sermon": {
      // §11.1 Final Dawn active 2: one contested district, pressure ×3 for 12s.
      if (p.archetype !== "dawn") return;
      if (onCooldown(p, "stockpile_sermon") || p.faith < fromInt(KIT.stockpileSermon.cost)) return;
      const t = intent.target ?? -1;
      if (t < 0 || t >= s.world.district.length) return;
      const district = s.world.district[t]!;
      if (district === 0) return;
      p.faith = sub(p.faith, fromInt(KIT.stockpileSermon.cost));
      s.districtBuffs.push({ player: p.id, district, ticksLeft: KIT.stockpileSermon.durTicks });
      startCooldown(p, "stockpile_sermon", KIT.stockpileSermon.cooldown);
      return;
    }
  }
}

function applySignature(s: SimState, p: PlayerState, b: Balance): void {
  // §11.1 Final Dawn SIGNATURE — Prophecy Countdown. Other signatures land
  // with their archetype kits (Radiant=Labs, Circle=Ledger, Visitors=Saucer).
  if (p.archetype !== "dawn" || p.prophecyUsed) return;
  const minTiles = Math.min(
    KIT.prophecy.minTiles,
    Math.max(1, Math.floor(s.populated * KIT.prophecy.minShareOfPopulated)),
  );
  if (p.ownedTiles < minTiles) return;
  p.prophecyUsed = true;
  gainHeat(p, b, KIT.prophecy.heat);
  s.prophecies.push({
    player: p.id,
    snapshotPermille: Math.floor((p.ownedTiles * 1000) / Math.max(1, s.populated)),
    ticksLeft: KIT.prophecy.durTicks,
  });
}

/** Apply a single validated intent. Mutating, deterministic, no I/O. */
export function applyIntent(s: SimState, intent: Intent, b: Balance): void {
  const p = s.players.find((pl) => pl.id === intent.player);
  if (!p || !p.alive) return;
  switch (intent.t) {
    case IntentType.SET_STANCE:
      p.stance = intent.stance;
      break;

    case IntentType.SPAWN: {
      // FOUNDING phase (§18): claim the starting blob around the picked tile.
      if (p.spawned) break;
      const claimed = claimBlob(s, p.id, intent.tile, 3);
      if (claimed > 0) {
        p.ownedTiles += claimed;
        p.spawned = true;
      }
      break;
    }

    case IntentType.OPEN_FRONT: {
      // Commit toward a target region (§4.1). Tiles are deduped, sorted, and
      // bounds-checked; eligibility (adjacency, convertibility) is re-checked
      // every tick by resolveConversion, so stale fronts are harmless.
      const w = s.world;
      const tiles = [...new Set(intent.tiles)]
        .filter((t) => t >= 0 && t < w.owner.length)
        .sort((a, z) => a - z);
      if (tiles.length === 0) break;
      s.fronts.push({ id: s.nextFrontId++, player: p.id, tiles });
      break;
    }

    case IntentType.CLOSE_FRONT: {
      const idx = s.fronts.findIndex((f) => f.id === intent.front && f.player === p.id);
      if (idx >= 0) s.fronts.splice(idx, 1);
      break;
    }

    case IntentType.BUILD: {
      // M0 scope: Compounds (follower cap + the economy backbone). The rest of
      // the §6 table lands with the buildings subsystem.
      if (intent.building !== "compound") break;
      if (p.compounds >= 8) break; // max 8 (§6)
      const w = s.world;
      const t = intent.tile;
      if (t < 0 || t >= w.owner.length || w.owner[t] !== p.id) break;
      const cost = compoundCost(p);
      if (p.usd < cost) break;
      p.usd = sub(p.usd, cost);
      p.compounds++;
      break;
    }

    case IntentType.RITUAL:
      applyRitual(s, p, b, intent);
      break;

    case IntentType.ABILITY:
      applyAbility(s, p, b, intent);
      break;

    case IntentType.SIGNATURE:
      applySignature(s, p, b);
      break;

    case IntentType.SURRENDER:
      p.alive = false;
      break;

    // Remaining intents (STRIKE, AGENT_DISPATCH, diplomacy, ...) are wired in
    // as their subsystems land. Each is a pure mutation of SimState.
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
  const w = s.world;

  // Per-owner aggregates over owned tiles: income coeff sum + dissent sum.
  const incomeSum = new Map<PlayerId, Fixed>();
  const dissentSum = new Map<PlayerId, Fixed>();
  for (let t = 0; t < w.owner.length; t++) {
    const o = w.owner[t]!;
    if (o === NEUTRAL || w.state[t] !== TileState.Believer) continue;
    const dc = w.districtCoeffs[w.district[t]!] ?? { conv: ONE, retain: ONE, income: ONE };
    incomeSum.set(o, add(incomeSum.get(o) ?? 0, dc.income));
    dissentSum.set(o, add(dissentSum.get(o) ?? 0, w.dissent[t]!));
  }

  for (const p of s.players) {
    if (!p.alive) continue;

    // Followers — logistic growth (§3.1). faith_growth_mod = 0.8 + Faith/250.
    const cap = followerCap(p, b);
    if (cap > 0) {
      let faithGrowthMod = add(fp(0.8), div(p.faith, fromInt(250)));
      // stance growth side-effects (§5): Tend +10%, CRUSADE −20%
      if (p.stance === Stance.Tend) faithGrowthMod = mul(faithGrowthMod, fp(1.1));
      else if (p.stance === Stance.Crusade) faithGrowthMod = mul(faithGrowthMod, fp(0.8));
      const utilization = sub(ONE, div(p.followers, cap)); // (1 − F/cap)
      let dF = mul(b.economy.followerGrowth, mul(p.followers, utilization));
      dF = mul(dF, faithGrowthMod);
      p.followers = clamp(add(p.followers, mul(dF, dt)), 0, cap);
    }

    // Tithe (§3.2): $/sec = tithe_per_follower × F × income_avg × dissent_tax,
    // income_avg = mean district income over owned tiles; archetype income coeff.
    let incomeAvg = ONE;
    let dissentTax = ONE;
    if (p.ownedTiles > 0) {
      const n = fromInt(p.ownedTiles);
      incomeAvg = div(incomeSum.get(p.id) ?? 0, n);
      const avgDissent = div(dissentSum.get(p.id) ?? 0, n);
      dissentTax = sub(ONE, div(avgDissent, fromInt(200))); // 100 avg = half income
    }
    let tithePerSec = mul(mul(b.economy.tithePerFollower, p.followers), mul(incomeAvg, dissentTax));
    tithePerSec = mul(tithePerSec, b.archetypes[p.archetype].income);
    p.usd = add(p.usd, mul(tithePerSec, dt));

    // Faith base drift toward 50 at ±0.05/s (§3.3).
    const drift = fp(0.05);
    if (p.faith > FIFTY) p.faith = clamp(sub(p.faith, mul(drift, dt)), FIFTY, HUNDRED);
    else if (p.faith < FIFTY) p.faith = clamp(add(p.faith, mul(drift, dt)), 0, FIFTY);

    // Heat decay (§3.5) base −0.08/s, plus crusade gain while active.
    let heat = p.heat;
    if (p.stance === Stance.Crusade)
      heat = add(heat, mul(mul(b.stances.crusade.heatPerS, b.archetypes[p.archetype].heat), dt));
    heat = sub(heat, mul(b.heat.decay, dt));
    p.heat = clamp(heat, 0, HUNDRED);
  }

  // Dissent decay (§3.4): −0.15/s base; Tend stance 2×; Atonement 4× (§9).
  const baseDecay = mul(fp(0.15), dt);
  const decayFor = new Map<PlayerId, Fixed>();
  for (const p of s.players) {
    let d = baseDecay;
    if (p.stance === Stance.Tend) d = mul(d, fromInt(2));
    if (p.atonementTicks > 0) d = mul(d, fromInt(4));
    decayFor.set(p.id, d);
  }
  for (let i = 0; i < w.dissent.length; i++) {
    const o = w.owner[i]!;
    if (o === NEUTRAL) continue;
    const dec = decayFor.get(o) ?? baseDecay;
    const d = (w.dissent[i]! - dec) | 0;
    w.dissent[i] = d < 0 ? 0 : d;
  }

  // Apostate scar countdown (§4.7): when it hits 0 the tile reverts to Neutral.
  for (let i = 0; i < w.scarTicks.length; i++) {
    if (w.scarTicks[i]! > 0) {
      const remaining = w.scarTicks[i]! - 1;
      w.scarTicks[i] = remaining;
      if (remaining === 0) {
        w.state[i] = TileState.Neutral;
        w.owner[i] = NEUTRAL;
      }
    }
  }
}

/** Count down pylons, district buffs, auras, cooldowns, personal buff timers. */
function stepEffects(s: SimState, b: Balance): void {
  for (const p of s.players) {
    if (p.sermonBuffTicks > 0) p.sermonBuffTicks--;
    if (p.atonementTicks > 0) p.atonementTicks--;
    for (const key of Object.keys(p.cooldowns).sort()) {
      const left = p.cooldowns[key]! - 1;
      if (left <= 0) delete p.cooldowns[key];
      else p.cooldowns[key] = left;
    }
  }

  for (let i = s.pylons.length - 1; i >= 0; i--) {
    if (--s.pylons[i]!.ticksLeft <= 0) s.pylons.splice(i, 1);
  }
  for (let i = s.auras.length - 1; i >= 0; i--) {
    if (--s.auras[i]!.ticksLeft <= 0) s.auras.splice(i, 1);
  }
  for (let i = s.districtBuffs.length - 1; i >= 0; i--) {
    const buff = s.districtBuffs[i]!;
    if (--buff.ticksLeft <= 0) {
      // Stockpile Sermon aftershock: +10 dissent in the district (§11.1).
      addDistrictDissent(s.world, buff.district, KIT.stockpileSermon.afterDissent);
      s.districtBuffs.splice(i, 1);
    }
  }

  resolveProphecies(s, b);
}

/** Resolve expired Prophecy Countdowns (§11.1 SIGNATURE). */
function resolveProphecies(s: SimState, b: Balance): void {
  for (let i = s.prophecies.length - 1; i >= 0; i--) {
    const pr = s.prophecies[i]!;
    if (--pr.ticksLeft > 0) continue;
    s.prophecies.splice(i, 1);
    const p = s.players.find((pl) => pl.id === pr.player);
    if (!p || !p.alive) continue;

    const nowPermille = Math.floor((p.ownedTiles * 1000) / Math.max(1, s.populated));
    if (nowPermille > pr.snapshotPermille) {
      prophecyRapture(s, p);
      p.faith = clamp(add(p.faith, fromInt(KIT.prophecy.winFaith)), 0, HUNDRED);
    } else {
      p.faith = clamp(sub(p.faith, fromInt(KIT.prophecy.failFaith)), 0, HUNDRED);
      p.followers = mul(p.followers, fp(1 - KIT.prophecy.failApostasyPct / 100));
      const w = s.world;
      const amt = fromInt(KIT.prophecy.failDissent);
      for (let t = 0; t < w.owner.length; t++) {
        if (w.owner[t] === p.id) w.dissent[t] = min(add(w.dissent[t]!, amt), HUNDRED);
      }
    }
  }
}

/** Fulfilled Prophecy: flip High-S tiles within range of borders, capped (§11.1). */
function prophecyRapture(s: SimState, p: PlayerState): void {
  const w = s.world;
  // multi-source BFS from all owned tiles, range ≤ borderRange
  const dist = new Int16Array(w.owner.length).fill(-1);
  const queue: TileId[] = [];
  for (let t = 0; t < w.owner.length; t++) {
    if (w.owner[t] === p.id && w.state[t] === TileState.Believer) {
      dist[t] = 0;
      queue.push(t);
    }
  }
  const cap = Math.max(1, Math.floor(s.populated * KIT.prophecy.capShareOfMap));
  let flipped = 0;
  const highS = fromInt(KIT.prophecy.highS);
  for (let qi = 0; qi < queue.length && flipped < cap; qi++) {
    const t = queue[qi]!;
    const d = dist[t]!;
    if (d >= KIT.prophecy.borderRange) continue;
    const x = t % w.width;
    const y = (t / w.width) | 0;
    const neighbors = [
      y > 0 ? t - w.width : -1,
      x > 0 ? t - 1 : -1,
      x < w.width - 1 ? t + 1 : -1,
      y < w.height - 1 ? t + w.width : -1,
    ];
    for (const n of neighbors) {
      if (n < 0 || dist[n] !== -1) continue;
      dist[n] = d + 1;
      queue.push(n);
      if (
        w.terrain[n] === Terrain.Citizen &&
        w.state[n] !== TileState.Apostate &&
        w.scarTicks[n] === 0 &&
        w.owner[n] !== p.id &&
        w.susceptibility[n]! >= highS &&
        flipped < cap
      ) {
        const prev = w.owner[n]!;
        if (prev !== NEUTRAL) {
          const loser = s.players.find((pl) => pl.id === prev);
          if (loser) loser.ownedTiles = Math.max(0, loser.ownedTiles - 1);
        }
        w.owner[n] = p.id;
        w.state[n] = TileState.Believer;
        p.ownedTiles++;
        flipped++;
      }
    }
  }
}

/** Victory checks, per tick, in §18 priority order; plus elimination. */
function checkVictory(s: SimState): void {
  if (s.status === MatchStatus.Ended) return;

  // Elimination: spawned and holding zero tiles (§18; satellites arrive with Visitors' kit).
  for (const p of s.players) {
    if (p.alive && p.spawned && p.ownedTiles === 0) p.alive = false;
  }

  const contenders = s.players.filter((p) => p.alive && p.spawned);

  // (1) Domination threshold.
  for (const p of contenders) {
    if (s.populated > 0 && p.ownedTiles * 1000 >= s.populated * s.dominationPermille) {
      s.status = MatchStatus.Ended;
      s.winner = p.id;
      return;
    }
  }

  // (2) Last cult standing (only meaningful once the lobby had rivals).
  if (contenders.length === 1 && s.players.filter((p) => p.spawned).length >= 2) {
    s.status = MatchStatus.Ended;
    s.winner = contenders[0]!.id;
    return;
  }

  // (5) Timer expiry → highest tiles, then $ earned, then Faith (§1).
  if (s.timerTicks > 0 && s.tick >= s.timerTicks && contenders.length > 0) {
    let best = contenders[0]!;
    for (const p of contenders.slice(1)) {
      if (
        p.ownedTiles > best.ownedTiles ||
        (p.ownedTiles === best.ownedTiles && p.usd > best.usd) ||
        (p.ownedTiles === best.ownedTiles && p.usd === best.usd && p.faith > best.faith)
      ) {
        best = p;
      }
    }
    s.status = MatchStatus.Ended;
    s.winner = best.id;
  }
}

/** Advance the sim by one tick using a Turn's intents. Returns the same state. */
export function step(s: SimState, turn: Turn, b: Balance): SimState {
  // Fold the turn's seed slice into the RNG stream so server and client agree.
  s.rng.s3 = (s.rng.s3 ^ (turn.seedSlice >>> 0)) >>> 0;

  if (s.status === MatchStatus.Ended) {
    s.tick++;
    return s; // frozen — RECAP state (§18)
  }

  // Intents apply in their given (server-bundled) order for determinism.
  for (const intent of turn.intents) applyIntent(s, intent, b);

  stepEconomy(s, b);
  resolveConversion(s, b);
  stepEffects(s, b);
  checkVictory(s);

  s.tick++;
  return s;
}

/**
 * Tiny helper to express a small literal rate as Fixed without importing the
 * float path everywhere. Boundary-only, like balance loading.
 */
function fp(n: number): Fixed {
  return Math.round(n * ONE) | 0;
}
