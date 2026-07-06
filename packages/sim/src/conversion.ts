/**
 * Conversion resolution — the combat system, rebuilt on PRESENCE
 * (v3 missions, DESIGN_MISSIONS.md §3).
 *
 * Deployed cohorts are the only attack source: pressure comes from
 * follower-mass physically working a zone, never from an abstract order.
 *  1. Each arrived cohort auto-spreads over the nearest unconverted doors
 *     around its target (door count scales with mass, capped), attackers
 *     per door capped at `max_eff_per_border_tile` (60) — wide beats tall.
 *  2. Per worked tile:
 *       pressure/s = base × R0 × mode_mult × district_conv × S_mod(neutral)
 *                    × faith_mod × charisma / resistance
 *       resistance = (1 + defenders_per_tile/40) × district_retain
 *                    × fort_mult × defender_faith_mod × Tend presence
 *  3. A tile flips when accumulated pressure ≥ 100 (houses ~3–6 s under
 *     solid presence; landmarks/civics resist 2× — sieges).
 *  4. Attrition: attacker 0.6/s and defender 0.35/s per worked tile.
 *  5. Ambient creep: every owned border tile passively presses adjacent
 *     neutrals at 0.35 × R0 × district_conv. Healthy cults ooze.
 *  6. Apostate scar tiles are immune to ALL conversion until the scar expires.
 *
 * Everything here is fixed-point, RNG-free, and iterates in stable order
 * (players by array order, tiles ascending) — the lockstep contract.
 */

import { add, sub, mul, div, min, fromInt, toInt, ONE, type Fixed } from "./fixed.js";
import { cohortArrived } from "./cohorts.js";
import type { Balance, ArchetypeCoeffs } from "./balance.js";
import {
  NEUTRAL,
  Stance,
  Terrain,
  TileState,
  TileFlag,
  Lot,
  PROGRESS_STRIDE,
  type PlayerState,
  type SimState,
  type World,
  type TileId,
  type PlayerId,
} from "./types.js";
import { areAllied, commitBetrayal, grudgeMult } from "./diplomacy.js";
import { fortMultAt, compoundDefenseAt, destroyBuildingsOnTile } from "./buildings.js";
import { computeCivicControl, controlsCivic } from "./civics.js";
import {
  r0Mult,
  creepMult,
  effectiveRetain,
  homeDefenseMult,
  defenseAttritionMult,
  ownDissentMult,
} from "./doctrine.js";

const HUNDRED: Fixed = fromInt(100);

/** faith_combat_mod = 0.85 + Faith/333 → 0.85..1.15 (§3.3). */
export function faithCombatMod(faith: Fixed): Fixed {
  return add(fp(0.85), div(faith, fromInt(333)));
}

/** S_mod = 0.5 + S/100 (§2), neutral tiles only. */
function sMod(s: Fixed): Fixed {
  return add(fp(0.5), div(s, HUNDRED));
}

function fp(n: number): Fixed {
  return Math.round(n * ONE) | 0;
}

function coeffsOf(b: Balance, p: PlayerState): ArchetypeCoeffs {
  return b.archetypes[p.archetype];
}

function stanceOf(b: Balance, p: PlayerState): { commit: Fixed; mult: Fixed } {
  switch (p.stance) {
    case Stance.Tend:
      return b.stances.tend;
    case Stance.Crusade:
      return b.stances.crusade;
    default:
      return b.stances.spread;
  }
}

/** Per-sortie mode → the same tuning table (v3 missions: mode is chosen per cohort). */
function modeOf(b: Balance, mode: Stance): { commit: Fixed; mult: Fixed } {
  switch (mode) {
    case Stance.Tend:
      return b.stances.tend;
    case Stance.Crusade:
      return b.stances.crusade;
    default:
      return b.stances.spread;
  }
}

/** 4-neighborhood, edge-clipped, in fixed N/W/E/S order. */
function forEachNeighbor(w: World, t: TileId, fn: (n: TileId) => void): void {
  const x = t % w.width;
  const y = (t / w.width) | 0;
  if (y > 0) fn(t - w.width);
  if (x > 0) fn(t - 1);
  if (x < w.width - 1) fn(t + 1);
  if (y < w.height - 1) fn(t + w.width);
}

/** Is `t` a conversion-eligible citizen tile (not terrain, not scarred)? */
function convertible(w: World, t: TileId): boolean {
  return (
    w.terrain[t] === Terrain.Citizen &&
    w.state[t] !== TileState.Apostate &&
    w.scarTicks[t] === 0
  );
}

/** Max consecutive road tiles conversion can jump — ideas travel the highway (§1). */
const ROAD_JUMP = 3;

/**
 * Walk from `t` in a cardinal direction, skipping up to ROAD_JUMP road tiles,
 * and return the first citizen tile on the far side (or −1). This is what lets
 * a congregation reach across the street.
 */
function acrossRoad(w: World, t: TileId, dx: number, dy: number): TileId {
  let x = t % w.width;
  let y = (t / w.width) | 0;
  for (let step = 0; step <= ROAD_JUMP; step++) {
    x += dx;
    y += dy;
    if (x < 0 || y < 0 || x >= w.width || y >= w.height) return -1;
    const n = y * w.width + x;
    if (w.terrain[n] === Terrain.Citizen) return step > 0 ? n : -1; // must cross ≥1 road
    if (
      w.terrain[n] !== Terrain.Road &&
      w.terrain[n] !== Terrain.Dirt &&
      w.terrain[n] !== Terrain.Path &&
      w.terrain[n] !== Terrain.Rail
    )
      return -1; // nature blocks the word
  }
  return -1;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

interface ContestedWork {
  player: PlayerState;
  /** Sorted ascending tile ids one cohort works this tick. */
  tiles: TileId[];
  /** Effective attackers per worked tile (mass/doors, capped). */
  attackersPerTile: Fixed;
  stanceMult: Fixed;
}

/**
 * Per-attacker global pressure multiplier: Final Dawn's Fear Feeds Us passive
 * (§11.1, retargeted in M2: +2% per cohort deployed ANYWHERE — any player's).
 * Cap trimmed +25% → +15% in the v3 balance pass: under recruits-from-
 * believers, r0 already compounds, so dawn's stacking passive made it a
 * runaway winner (48.8% → target ~25%). (Sermon buff is vestigial: rituals cut.)
 */
function attackerGlobalMult(s: SimState, p: PlayerState): Fixed {
  let m = ONE;
  if (p.archetype === "dawn") {
    let cohorts = 0;
    for (const pl of s.players) cohorts += pl.cohorts.length;
    const fearPct = Math.min(15, cohorts * 2);
    m = mul(m, add(ONE, div(fromInt(fearPct), HUNDRED)));
  }
  if (p.sermonBuffTicks > 0) m = mul(m, fp(1.05)); // vestigial (always 0)
  return m;
}

/** Stockpile Sermon ×3 if the attacker has a live buff on this tile's district (§11.1). */
function districtBuffMult(s: SimState, p: PlayerState, t: TileId): Fixed {
  for (const buff of s.districtBuffs) {
    if (buff.player === p.id && buff.district === s.world.district[t]) return fromInt(3);
  }
  return ONE;
}

/**
 * Placed auras: Midnight Festival (2× neutral, §9) and Free Retreat Weekend
 * (2.5× neutral / 1.5× enemy, §11.2). Strongest applicable aura wins.
 */
function auraMult(s: SimState, p: PlayerState, t: TileId, neutral: boolean): Fixed {
  const w = s.world;
  const x = t % w.width;
  const y = (t / w.width) | 0;
  let best = ONE;
  for (const aura of s.auras) {
    if (aura.player !== p.id) continue;
    const ax = aura.tile % w.width;
    const ay = (aura.tile / w.width) | 0;
    const dx = x - ax;
    const dy = y - ay;
    if (dx * dx + dy * dy > aura.radius * aura.radius) continue;
    const m =
      aura.kind === "festival" ? (neutral ? fromInt(2) : ONE) : neutral ? fp(2.5) : fp(1.5);
    if (m > best) best = m;
  }
  return best;
}

/** Crop Circle (§11.4): +30 S on the district for everyone while active. */
function effectiveS(s: SimState, t: TileId): Fixed {
  let v = s.world.susceptibility[t]!;
  for (const cc of s.cropCircles) {
    if (cc.district === s.world.district[t]) {
      v = min(add(v, fromInt(30)), fromInt(95));
      break;
    }
  }
  return v;
}

/** Radiant Glow (§11.2): +0.4%/s retention per second held, cap +80% at 200s. */
function glowMult(s: SimState, defender: PlayerState, t: TileId): Fixed {
  if (defender.archetype !== "radiant") return ONE;
  // 0.4%/s = 0.04%/tick; holdTicks capped at 2000 (= +80%)
  const held = Math.min(2000, s.world.holdTicks[t]!);
  return add(ONE, Math.round(held * 0.0004 * 65536));
}

/** Stance home-defense side effects (§5): Tend +20%, CRUSADE −25%. */
function stanceDefenseMult(b: Balance, defender: PlayerState): Fixed {
  if (defender.stance === Stance.Tend) return fp(1.2);
  if (defender.stance === Stance.Crusade) return fp(0.75);
  return ONE;
}

/** CPA picket lines (§17): −30% pressure for the target within radius 4. */
function picketMult(s: SimState, attacker: PlayerId, t: TileId): Fixed {
  const w = s.world;
  const x = t % w.width;
  const y = (t / w.width) | 0;
  for (const pk of s.pickets) {
    if (pk.target !== attacker) continue;
    const px = pk.tile % w.width;
    const py = (pk.tile / w.width) | 0;
    const dx = x - px;
    const dy = y - py;
    if (dx * dx + dy * dy <= 16) return fp(0.7);
  }
  return ONE;
}

/**
 * Resolve one tick of conversion: cohort presence, ambient creep, flips,
 * attrition, scars. Mutates `s` in place.
 */
export function resolveConversion(s: SimState, b: Balance): void {
  const w = s.world;
  const dt = b.dt;
  const civics = computeCivicControl(s); // key-building takeovers (§13 rev.)

  const work: ContestedWork[] = [];
  /** tiles-under-attack count per defending player id (for defender spread). */
  const defendedCount = new Map<PlayerId, number>();

  // ---- Pass 1: COHORT PRESENCE (v3 missions M2) — the deployed flock works
  // the doors around its target: nearest-unconverted-first auto-spread, door
  // count scaled by mass. Presence IS access: no adjacency requirement, no
  // compound outreach. Tend cohorts convert nothing — they hold the zone
  // (consumed as extra resistance in Pass 2).
  const tendBoost = new Map<TileId, Fixed>();
  for (const p of s.players) {
    if (!p.alive) continue;
    // Lighthouse anchor (§2A mechanics, B1.4.20), retargeted in M2: the beacon
    // draws seekers — its keeper's cohorts work a wider radius around every
    // target (it used to extend compound outreach, which died with fronts).
    const R =
      b.missions.workRadius +
      (controlsCivic(civics, Lot.Lighthouse, p.id) ? b.civics.lighthouseOutreachBonus : 0);
    for (const c of p.cohorts) {
      if (c.recalling || c.mass <= 0 || !cohortArrived(s, p, c, b)) continue;
      const cx = c.target % w.width;
      const cy = (c.target / w.width) | 0;
      if (c.mode === Stance.Tend) {
        const boost = div(c.mass, fromInt(b.missions.tendHoldDivisor));
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            if (dx * dx + dy * dy > R * R) continue;
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
            const t = y * w.width + x;
            if (w.owner[t] === p.id && w.state[t] === TileState.Believer)
              tendBoost.set(t, add(tendBoost.get(t) ?? 0, boost));
          }
        }
        continue;
      }
      const cands: { t: TileId; d: number }[] = [];
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
          const t = y * w.width + x;
          if (!convertible(w, t) || w.owner[t] === p.id) continue;
          cands.push({ t, d: dx * dx + dy * dy });
        }
      }
      if (cands.length === 0) continue;
      cands.sort((a, z) => a.d - z.d || a.t - z.t); // nearest door first, stable
      const doors = Math.max(
        1,
        Math.min(b.missions.maxDoors, 1 + Math.floor(toInt(c.mass) / b.missions.followersPerDoor)),
      );
      const tiles = cands.slice(0, doors).map((e) => e.t).sort((a, z) => a - z);
      for (const t of tiles) {
        const o = w.owner[t]!;
        if (o !== NEUTRAL && areAllied(s, p.id, o)) commitBetrayal(s, p, o); // JUDAS by sortie
      }
      const st = modeOf(b, c.mode);
      const perTile = min(div(c.mass, fromInt(tiles.length)), b.conversion.maxEffPerBorderTile);
      work.push({ player: p, tiles, attackersPerTile: perTile, stanceMult: st.mult });
      for (const t of tiles) {
        const o = w.owner[t]!;
        if (o !== NEUTRAL) defendedCount.set(o, (defendedCount.get(o) ?? 0) + 1);
      }
    }
  }

  // Defender spread: uncommitted followers split across all tiles under attack.
  const defendersPerTile = new Map<PlayerId, Fixed>();
  for (const [pid, count] of defendedCount) {
    const d = s.players.find((pl) => pl.id === pid);
    if (!d || !d.alive) continue;
    const st = stanceOf(b, d);
    const uncommitted = mul(d.followers, sub(ONE, st.commit));
    defendersPerTile.set(pid, div(uncommitted, fromInt(count)));
  }

  // ---- Pass 2: apply presence pressure into the progress map. ----
  for (const wk of work) {
    const p = wk.player;
    const co = coeffsOf(b, p);
    const atkFaith = faithCombatMod(p.faith);
    const globalMult = attackerGlobalMult(s, p);
    for (const t of wk.tiles) {
      const dc = w.districtCoeffs[w.district[t]!] ?? { conv: ONE, retain: ONE, income: ONE };
      const owner = w.owner[t]!;

      // pressure numerator
      let pr = mul(b.conversion.basePressure, mul(co.r0, r0Mult(p))); // T1 (§10)
      pr = mul(pr, wk.stanceMult);
      pr = mul(pr, dc.conv);
      if (owner === NEUTRAL) {
        pr = mul(pr, sMod(effectiveS(s, t)));
        pr = mul(pr, auraMult(s, p, t, true));
      } else {
        pr = mul(pr, auraMult(s, p, t, false));
        pr = mul(pr, grudgeMult(s, p.id, owner)); // betrayal grudge −15% (§16)
      }
      pr = mul(pr, atkFaith);
      pr = mul(pr, b.charismaItems);
      pr = mul(pr, globalMult);
      pr = mul(pr, districtBuffMult(s, p, t));
      pr = mul(pr, picketMult(s, p.id, t)); // CPA picket lines −30% (§17)
      // attacker headcount scaling: effective attackers / cap → 0..1 of full rate
      pr = mul(pr, div(wk.attackersPerTile, b.conversion.maxEffPerBorderTile));

      // resistance denominator
      let res = ONE;
      if (owner !== NEUTRAL) {
        const defender = s.players.find((pl) => pl.id === owner);
        const dpt = defendersPerTile.get(owner) ?? 0;
        res = add(ONE, div(dpt, fromInt(40)));
        res = mul(res, effectiveRetain(p, dc.retain)); // T4 halves district retain (§10)
        res = mul(res, fortMultAt(s, owner, t)); // Watchtower fort_mult 5 (§6)
        res = mul(res, compoundDefenseAt(s, owner, t)); // Compound +10% (§6)
        if (defender) {
          res = mul(res, coeffsOf(b, defender).retain);
          res = mul(res, faithCombatMod(defender.faith));
          res = mul(res, homeDefenseMult(defender)); // B2 Uniforms (§10)
          // Grocery takeover: control the food, keep the flock (§13 rev.)
          if (controlsCivic(civics, Lot.Supermarket, defender.id)) res = mul(res, b.civics.groceryDefenseMult);
          res = mul(res, glowMult(s, defender, t)); // Radiant Glow (§11.2)
          res = mul(res, stanceDefenseMult(b, defender)); // Tend +20% / Crusade −25% (§5)
          if (defender.judasTicks > 0) res = mul(res, fp(0.5)); // JUDAS shock (§16)
          if (defender.retentionDebuffTicks > 0) res = mul(res, fp(0.5)); // Exposé (§8)
          const tb = tendBoost.get(t); // a Tend cohort holds this ground (v3)
          if (tb) res = mul(res, add(ONE, tb));
        }
        if (w.landmark[t] !== 0) res = mul(res, fromInt(2)); // landmarks 0.5× capture (§12)
      } else if (w.landmark[t] !== 0) {
        res = mul(res, fromInt(2));
      }
      pr = div(pr, res);

      const key = t * PROGRESS_STRIDE + p.id;
      s.progress.set(key, add(s.progress.get(key) ?? 0, mul(pr, dt)));
    }
  }

  // ---- Pass 3: ambient creep onto neutral tiles (§4.6). ----
  const playerById = new Map<PlayerId, PlayerState>();
  for (const p of s.players) playerById.set(p.id, p);
  for (let t = 0; t < w.owner.length; t++) {
    const owner = w.owner[t]!;
    if (owner === NEUTRAL || w.state[t] !== TileState.Believer) continue;
    const p = playerById.get(owner);
    if (!p || !p.alive) continue;
    const r0 = mul(coeffsOf(b, p).r0, r0Mult(p));
    let cm = creepMult(p); // T2 Whisper Network +60% (§10)
    // Elementary-school takeover: the kids carry the word home (§13 rev.)
    if (controlsCivic(civics, Lot.School, owner)) cm = mul(cm, b.civics.schoolCreepMult);
    const creepTo = (n: TileId, roadBonus: boolean): void => {
      if (w.owner[n] !== NEUTRAL || !convertible(w, n)) return;
      const dc = w.districtCoeffs[w.district[n]!] ?? { conv: ONE, retain: ONE, income: ONE };
      let pr = mul(mul(mul(b.conversion.ambientCreep, r0), dc.conv), cm);
      if (roadBonus) pr = mul(pr, fp(1.1)); // creep +10% along roads (§1)
      const key = n * PROGRESS_STRIDE + owner;
      s.progress.set(key, add(s.progress.get(key) ?? 0, mul(pr, dt)));
    };
    forEachNeighbor(w, t, (n) => creepTo(n, false));
    // and across the street: ideas travel the highway (§1)
    for (const [dx, dy] of DIRS) {
      const x = (t % w.width) + dx;
      const y = ((t / w.width) | 0) + dy;
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
      const adj = w.terrain[y * w.width + x];
      if (adj !== Terrain.Road && adj !== Terrain.Dirt && adj !== Terrain.Path && adj !== Terrain.Rail)
        continue;
      const far = acrossRoad(w, t, dx, dy);
      if (far >= 0) creepTo(far, true);
    }
  }

  // ---- Pass 3a: Recruitment Vans (§7) — 40-follower pressure at range 2. ----
  for (const van of s.vans) {
    const p = playerById.get(van.player);
    if (!p || !p.alive) continue;
    applyPointPressure(s, b, p, van.tile, 2, dt);
  }

  // ---- Pass 3b: Street Prophet pylons (§11.1) — 40-follower pressure, range 2. ----
  for (const pylon of s.pylons) {
    const p = playerById.get(pylon.player);
    if (!p || !p.alive) continue;
    applyPointPressure(s, b, p, pylon.tile, 2, dt);
  }

  // ---- Pass 4: flips. Sorted keys → deterministic winner on ties. ----
  const flipped = new Map<TileId, PlayerId>(); // tile → winner
  const best = new Map<TileId, Fixed>();
  const keys = [...s.progress.keys()].sort((a, z) => a - z);
  for (const key of keys) {
    const prog = s.progress.get(key)!;
    if (prog < b.conversion.flipThreshold) continue;
    const t = (key / PROGRESS_STRIDE) | 0;
    const attacker = key % PROGRESS_STRIDE;
    if (!convertible(w, t)) continue;
    if (w.owner[t] === attacker) continue;
    // highest progress wins; ties resolve to the lower key (lower player id)
    if (!flipped.has(t) || prog > (best.get(t) ?? 0)) {
      flipped.set(t, attacker);
      best.set(t, prog);
    }
  }

  // tiles each player's cohorts actively worked this tick (Downline tagging)
  const workedBy = new Map<PlayerId, Set<TileId>>();
  for (const wk of work) {
    let set = workedBy.get(wk.player.id);
    if (!set) workedBy.set(wk.player.id, (set = new Set()));
    for (const t of wk.tiles) set.add(t);
  }

  for (const [t, winner] of flipped) {
    const prevOwner = w.owner[t]!;
    const p = playerById.get(winner);
    if (!p) continue;

    // The residents convert: they leave the loser's flock and join the winner's.
    const residents = fromInt(w.pop[t]!);
    if (prevOwner !== NEUTRAL) {
      const loser = playerById.get(prevOwner);
      if (loser) {
        loser.ownedTiles = Math.max(0, loser.ownedTiles - 1);
        loser.followers = loser.followers > residents ? sub(loser.followers, residents) : 0;
      }
    }
    p.followers = add(p.followers, residents);
    w.owner[t] = winner;
    w.state[t] = TileState.Believer;
    w.holdTicks[t] = 0; // Glow resets on flip (§11.2)
    p.ownedTiles++;
    destroyBuildingsOnTile(s, t); // buildings die with their tile (§6)

    // Prosperity Circle Downline (§11.3): tiles flipped by creep alone
    // (never worked by a cohort this tick) pay 2× tithe forever.
    if (p.archetype === "circle" && !(workedBy.get(winner)?.has(t) ?? false)) {
      w.flags[t] = w.flags[t]! | TileFlag.Downline;
    } else {
      w.flags[t] = w.flags[t]! & ~TileFlag.Downline;
    }

    // CRUSADE captures stoke dissent on the taken tile (§3.4); B3 Curfews −40%.
    if (p.stance === Stance.Crusade) {
      const gain = mul(b.stances.crusade.dissentPerCapture, ownDissentMult(p));
      w.dissent[t] = min(add(w.dissent[t]!, gain), HUNDRED);
    }

    // Clear all attackers' progress on the flipped tile.
    for (const pl of s.players) s.progress.delete(t * PROGRESS_STRIDE + pl.id);
  }

  // ---- Pass 5: attrition (§4.5). Pushing costs manpower; turtling is cheaper. ----
  for (const wk of work) {
    const cost = mul(mul(b.conversion.attritionAttacker, fromInt(wk.tiles.length)), dt);
    wk.player.followers = wk.player.followers > cost ? sub(wk.player.followers, cost) : 0;
  }
  for (const [pid, count] of defendedCount) {
    const d = playerById.get(pid);
    if (!d || !d.alive) continue;
    let cost = mul(mul(b.conversion.attritionDefender, fromInt(count)), dt);
    cost = mul(cost, defenseAttritionMult(d)); // B4 TOTAL DEVOTION −50% (§10)
    d.followers = d.followers > cost ? sub(d.followers, cost) : 0;
  }
}

/**
 * Point-source pressure (Vans §7, pylons §11.1): a 40-follower-equivalent
 * converter pressing every non-owned convertible tile within `range`.
 */
function applyPointPressure(
  s: SimState,
  b: Balance,
  p: PlayerState,
  center: TileId,
  range: number,
  dt: Fixed,
): void {
  const w = s.world;
  const co = coeffsOf(b, p);
  const atkFaith = faithCombatMod(p.faith);
  const strength = div(fromInt(40), b.conversion.maxEffPerBorderTile);
  const cx = center % w.width;
  const cy = (center / w.width) | 0;
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
      const t = y * w.width + x;
      if (!convertible(w, t) || w.owner[t] === p.id) continue;
      const owner = w.owner[t]!;
      if (owner !== NEUTRAL && areAllied(s, p.id, owner)) continue; // vans don't betray
      const dc = w.districtCoeffs[w.district[t]!] ?? { conv: ONE, retain: ONE, income: ONE };
      let pr = mul(mul(b.conversion.basePressure, mul(co.r0, r0Mult(p))), strength);
      pr = mul(pr, dc.conv);
      if (owner === NEUTRAL) pr = mul(pr, sMod(s.world.susceptibility[t]!));
      pr = mul(pr, atkFaith);
      const key = t * PROGRESS_STRIDE + p.id;
      s.progress.set(key, add(s.progress.get(key) ?? 0, mul(pr, dt)));
    }
  }
}

/** Mark a Believer tile Apostate (§4.7): scar timer, no owner, S −15 on revert. */
export function apostatize(w: World, t: TileId, b: Balance, players: PlayerState[]): void {
  const prev = w.owner[t]!;
  if (prev !== NEUTRAL) {
    const loser = players.find((pl) => pl.id === prev);
    if (loser) {
      loser.ownedTiles = Math.max(0, loser.ownedTiles - 1);
      // the residents walk out
      const residents = fromInt(w.pop[t]!);
      loser.followers = loser.followers > residents ? sub(loser.followers, residents) : 0;
    }
  }
  w.owner[t] = NEUTRAL;
  w.state[t] = TileState.Apostate;
  w.scarTicks[t] = b.conversion.apostateScarTicks;
  const reduced = sub(w.susceptibility[t]!, fromInt(15));
  w.susceptibility[t] = reduced < fromInt(5) ? fromInt(5) : reduced;
}
