/**
 * Civics takeover engine (§13 rev.) — the "key buildings" layer.
 *
 * Every town guarantees its keystone civic lots (mapgen §2 rev. 3). When a
 * cult converts the households occupying a civic lot's tiles, it CONTROLS the
 * institution, with realistic passive and active strategic decrees:
 *
 *   Sheriff (police)     → Passive: Heat fades faster
 *                          Active: Town Curfew (15s district front freeze)
 *   School (elementary)  → Passive: stronger ambient spread
 *                          Active: Parent-Teacher Night (2x ambient creep for 30s)
 *   High School          → Passive: faster follower growth
 *                          Active: Pep Rally (+1,200 followers / overflow to tithe)
 *   Supermarket (grocery)→ Passive: your flock holds firmer
 *                          Active: Food Rationing (+35% retention for 25s)
 *   Church               → Passive: Faith climbs
 *                          Active: Evangelical Revival (+15 Faith, +20 neutral pulse)
 *   Town Hall (Landmark) → Passive: Heat fades faster
 *                          Active: Municipal Injunction (pauses enemy builds for 20s)
 *   Radio Tower (Landmark)→Passive: cheaper broadcast towers
 *                          Active: Emergency Jam (jams strikes and stance switches for 15s)
 *
 * Control is per lot TYPE: the player who owns strictly more of that lot's
 * tiles than any single rival (and at least one) controls it. If there is a tie,
 * the institution is contested and NEITHER player controls it (the Edge Snipe rule).
 * Apostate scarred tiles (from bombs/raids) do not count toward control.
 */

import {
  NEUTRAL,
  Lot,
  Landmark,
  TileState,
  Terrain,
  CivicDecreeId,
  PROGRESS_STRIDE,
  type SimState,
  type PlayerId,
  type DistrictId,
  type World,
} from "./types.js";
import { add, sub, mul, fromInt, toInt, clamp, type Fixed } from "./fixed.js";
import type { Balance } from "./balance.js";
import { ownsLandmark } from "./entities.js";

const HUNDRED: Fixed = fromInt(100);

/** The civic lot types the engine watches, in fixed evaluation order. */
export const CIVIC_LOTS: readonly Lot[] = [
  Lot.Sheriff,
  Lot.School,
  Lot.HighSchool,
  Lot.Supermarket,
  Lot.Church,
];

/** Human-readable effect line per civic lot (client HUD + docs). */
export const CIVIC_EFFECTS: Record<number, string> = {
  [Lot.Sheriff]: "police look away — Heat fades faster",
  [Lot.School]: "kids carry the word — stronger ambient spread",
  [Lot.HighSchool]: "youth recruitment — faster follower growth",
  [Lot.Supermarket]: "control the food — your flock holds firmer",
  [Lot.Church]: "the pulpit is yours — Faith climbs",
};

/** Definition of an active municipal civic decree. */
export interface CivicDecreeDef {
  id: CivicDecreeId;
  name: string;
  lot: number;
  isLandmark: boolean;
  costUsd: number;
  costFaith: number;
  gainHeat: number;
  cooldownTicks: number; // in simulation ticks (10 ticks = 1 second)
  durTicks: number; // 0 for instant effects
  description: string;
}

/** The 7 municipal active decrees. */
export const CIVIC_DECREES: Record<CivicDecreeId, CivicDecreeDef> = {
  [CivicDecreeId.TownCurfew]: {
    id: CivicDecreeId.TownCurfew,
    name: "Town Curfew",
    lot: Lot.Sheriff,
    isLandmark: false,
    costUsd: 10_000,
    costFaith: 0,
    gainHeat: 10,
    cooldownTicks: 900, // 90s
    durTicks: 150, // 15s
    description: "Freezes rival conversion fronts in this district for 15s.",
  },
  [CivicDecreeId.PepRally]: {
    id: CivicDecreeId.PepRally,
    name: "Pep Rally",
    lot: Lot.HighSchool,
    isLandmark: false,
    costUsd: 12_000,
    costFaith: 0,
    gainHeat: 0,
    cooldownTicks: 1000, // 100s
    durTicks: 0, // instant
    description: "Spawns +1,200 followers (overflow converted to $0.50 tithe).",
  },
  [CivicDecreeId.ParentTeacherNight]: {
    id: CivicDecreeId.ParentTeacherNight,
    name: "Parent-Teacher Night",
    lot: Lot.School,
    isLandmark: false,
    costUsd: 6_000,
    costFaith: 0,
    gainHeat: 0,
    cooldownTicks: 600, // 60s
    durTicks: 300, // 30s
    description: "Doubles ambient creep conversion speed in this district for 30s.",
  },
  [CivicDecreeId.FoodRationing]: {
    id: CivicDecreeId.FoodRationing,
    name: "Food Rationing",
    lot: Lot.Supermarket,
    isLandmark: false,
    costUsd: 15_000,
    costFaith: 15,
    gainHeat: 0,
    cooldownTicks: 1200, // 120s
    durTicks: 250, // 25s
    description: "+35% retention defense in this district for 25s.",
  },
  [CivicDecreeId.EvangelicalRevival]: {
    id: CivicDecreeId.EvangelicalRevival,
    name: "Evangelical Revival",
    lot: Lot.Church,
    isLandmark: false,
    costUsd: 0,
    costFaith: 20,
    gainHeat: 0,
    cooldownTicks: 750, // 75s
    durTicks: 0, // instant
    description: "+15 Faith instantly, plus +20 neutral conversion pulse around church.",
  },
  [CivicDecreeId.MunicipalInjunction]: {
    id: CivicDecreeId.MunicipalInjunction,
    name: "Municipal Injunction",
    lot: Landmark.TownHall,
    isLandmark: true,
    costUsd: 30_000,
    costFaith: 0,
    gainHeat: 20,
    cooldownTicks: 1500, // 150s
    durTicks: 200, // 20s
    description: "Freezes enemy building construction in Town Hall & adjacent districts for 20s.",
  },
  [CivicDecreeId.EmergencyJam]: {
    id: CivicDecreeId.EmergencyJam,
    name: "Emergency Jam",
    lot: Landmark.RadioTower,
    isLandmark: true,
    costUsd: 40_000,
    costFaith: 0,
    gainHeat: 0,
    cooldownTicks: 1200, // 120s
    durTicks: 150, // 15s
    description: "Jams rival strike charges and locks enemy stance changes for 15s.",
  },
};

/**
 * Who controls each civic lot type. One pass over the world, deterministic.
 * Returns a map lot → controlling player id (entries only where controlled).
 *
 * Strict Majority Rule: A player controls the lot if and only if they hold strictly
 * more Believer tiles of that lot than any single rival. If there is a tie for the top
 * count, the lot is contested and no one controls it. Apostate scar tiles are excluded.
 */
export function computeCivicControl(s: SimState): Map<number, PlayerId> {
  const w = s.world;
  const watch = new Set<number>(CIVIC_LOTS);
  // counts.get(lot) → Map(owner → believer tiles of that lot)
  const counts = new Map<number, Map<PlayerId, number>>();
  for (let t = 0; t < w.lot.length; t++) {
    const lot = w.lot[t]!;
    if (!watch.has(lot)) continue;
    const owner = w.owner[t]!;
    if (owner === NEUTRAL || w.state[t] !== TileState.Believer || w.scarTicks[t]! > 0) continue;
    let per = counts.get(lot);
    if (!per) {
      per = new Map();
      counts.set(lot, per);
    }
    per.set(owner, (per.get(owner) ?? 0) + 1);
  }
  const control = new Map<number, PlayerId>();
  for (const lot of CIVIC_LOTS) {
    const per = counts.get(lot);
    if (!per) continue;
    let best: PlayerId = 0;
    let bestN = 0;
    let tie = false;
    for (const pid of [...per.keys()].sort((a, z) => a - z)) {
      const n = per.get(pid)!;
      if (n > bestN) {
        bestN = n;
        best = pid;
        tie = false;
      } else if (n === bestN) {
        tie = true;
      }
    }
    if (best !== 0 && !tie) {
      const p = s.players.find((pl) => pl.id === best);
      if (p && p.alive) control.set(lot, best);
    }
  }
  return control;
}

/** Does `pid` control the given civic lot? Convenience for the engines. */
export function controlsCivic(control: Map<number, PlayerId>, lot: number, pid: PlayerId): boolean {
  return control.get(lot) === pid;
}

/** Find the district id of a civic lot type. */
export function findLotDistrict(w: World, lot: number): DistrictId {
  for (let t = 0; t < w.lot.length; t++) {
    if (w.lot[t] === lot) return w.district[t]!;
  }
  return 0;
}

/** Find the district id of a landmark type. */
export function findLandmarkDistrict(w: World, landmark: number): DistrictId {
  for (let t = 0; t < w.landmark.length; t++) {
    if (w.landmark[t] === landmark) return w.district[t]!;
  }
  return 0;
}

/** Check whether `pid` controls the institution required for a given decree. */
export function controlsDecreeInstitution(s: SimState, pid: PlayerId, decreeId: CivicDecreeId): boolean {
  const def = CIVIC_DECREES[decreeId];
  if (!def) return false;
  if (def.isLandmark) {
    return ownsLandmark(s, pid, def.lot);
  }
  const civics = computeCivicControl(s);
  return controlsCivic(civics, def.lot, pid);
}

/** Check if player can execute decree (checks control, cooldown, and resources). */
export function canExecuteCivicDecree(
  s: SimState,
  pid: PlayerId,
  decreeId: CivicDecreeId,
): { ok: boolean; reason?: string } {
  const p = s.players.find((pl) => pl.id === pid);
  if (!p || !p.alive) return { ok: false, reason: "player not alive" };
  const def = CIVIC_DECREES[decreeId];
  if (!def) return { ok: false, reason: "unknown decree" };

  if (!controlsDecreeInstitution(s, pid, decreeId)) {
    return { ok: false, reason: "institution not controlled" };
  }

  const cd = p.cooldowns[`decree_${decreeId}`] ?? 0;
  if (cd > 0) return { ok: false, reason: "decree on cooldown" };

  if (def.costUsd > 0 && p.usd < fromInt(def.costUsd)) {
    return { ok: false, reason: "insufficient USD" };
  }
  if (def.costFaith > 0 && p.faith < fromInt(def.costFaith)) {
    return { ok: false, reason: "insufficient Faith" };
  }

  return { ok: true };
}

/**
 * Execute a civic decree. Deducts resources, starts cooldown, and triggers effects.
 * Returns true if the decree successfully executed.
 */
export function executeCivicDecree(
  s: SimState,
  pid: PlayerId,
  decreeId: CivicDecreeId,
  b: Balance,
  cap: Fixed,
): boolean {
  const check = canExecuteCivicDecree(s, pid, decreeId);
  if (!check.ok) return false;
  const p = s.players.find((pl) => pl.id === pid)!;
  const def = CIVIC_DECREES[decreeId];
  const w = s.world;

  // Pay costs
  if (def.costUsd > 0) p.usd = sub(p.usd, fromInt(def.costUsd));
  if (def.costFaith > 0) p.faith = sub(p.faith, fromInt(def.costFaith));
  if (def.gainHeat > 0) {
    p.heat = clamp(add(p.heat, mul(fromInt(def.gainHeat), b.archetypes[p.archetype].heat)), 0, HUNDRED);
  }

  // Set cooldown
  p.cooldowns[`decree_${decreeId}`] = def.cooldownTicks;

  // District determination
  const district = def.isLandmark
    ? findLandmarkDistrict(w, def.lot)
    : findLotDistrict(w, def.lot);

  // Apply decree effects
  switch (decreeId) {
    case CivicDecreeId.PepRally: {
      const toAdd = fromInt(1200);
      const available = sub(cap, p.followers);
      if (available > 0) {
        if (toAdd <= available) {
          p.followers = add(p.followers, toAdd);
        } else {
          p.followers = cap;
          const overflow = toInt(sub(toAdd, available));
          p.usd = add(p.usd, mul(fromInt(overflow), fromInt(1) >> 1)); // $0.50 per follower
        }
      } else {
        // completely at or over cap: all 1,200 converted to $0.50 tithe cash = $600
        p.usd = add(p.usd, fromInt(600));
      }
      break;
    }

    case CivicDecreeId.EvangelicalRevival: {
      p.faith = clamp(add(p.faith, fromInt(15)), 0, HUNDRED);
      // Pulse +20 progress onto all adjacent neutral citizen tiles
      const churchTiles = new Set<number>();
      for (let t = 0; t < w.lot.length; t++) {
        if (w.lot[t] === Lot.Church) churchTiles.add(t);
      }
      const pulsed = new Set<number>();
      for (const ct of churchTiles) {
        const cx = ct % w.width;
        const cy = (ct / w.width) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
            const nt = y * w.width + x;
            if (churchTiles.has(nt) || pulsed.has(nt)) continue;
            if (
              w.terrain[nt] === Terrain.Citizen &&
              w.owner[nt] === NEUTRAL &&
              w.state[nt] === TileState.Neutral
            ) {
              pulsed.add(nt);
              const key = nt * PROGRESS_STRIDE + pid;
              s.progress.set(key, add(s.progress.get(key) ?? 0, fromInt(20)));
            }
          }
        }
      }
      break;
    }

    case CivicDecreeId.TownCurfew:
    case CivicDecreeId.ParentTeacherNight:
    case CivicDecreeId.FoodRationing:
    case CivicDecreeId.MunicipalInjunction:
    case CivicDecreeId.EmergencyJam: {
      s.activeDecrees.push({
        id: s.nextEntityId++,
        player: pid,
        decree: decreeId,
        district,
        ticksLeft: def.durTicks,
      });
      break;
    }
  }

  return true;
}

/** State of municipal monopolies for a player. */
export interface MonopolyState {
  townMachine: boolean;
  indoctrinationPipeline: boolean;
  foodAndFuelCartel: boolean;
  sacredCanopy: boolean;
}

/**
 * Compute active municipal monopolies for a player.
 * A monopoly is active only when the player holds strict majority of BOTH institutions.
 * Losing even 1 tile that breaks majority immediately breaks the monopoly.
 */
export function computeMonopolies(s: SimState, pid: PlayerId): MonopolyState {
  if (pid === NEUTRAL) {
    return {
      townMachine: false,
      indoctrinationPipeline: false,
      foodAndFuelCartel: false,
      sacredCanopy: false,
    };
  }

  const control = computeCivicControl(s);
  const w = s.world;

  // 1. Town Machine: Town Hall (Landmark) + Sheriff (Lot)
  const townMachine = ownsLandmark(s, pid, Landmark.TownHall) && controlsCivic(control, Lot.Sheriff, pid);

  // 2. Indoctrination Pipeline: High School (Lot) + Elementary School (Lot)
  const indoctrinationPipeline =
    controlsCivic(control, Lot.HighSchool, pid) && controlsCivic(control, Lot.School, pid);

  // 3. Food & Fuel Cartel: Supermarket (Lot) + Gas Station (Believer lot)
  let ownsGasStation = false;
  for (let t = 0; t < w.lot.length; t++) {
    if (w.lot[t] === Lot.GasStation && w.owner[t] === pid && w.state[t] === TileState.Believer && w.scarTicks[t]! === 0) {
      ownsGasStation = true;
      break;
    }
  }
  const foodAndFuelCartel = controlsCivic(control, Lot.Supermarket, pid) && ownsGasStation;

  // 4. Sacred Canopy: The Old Megachurch (Landmark) + Community Church (Lot)
  const sacredCanopy = ownsLandmark(s, pid, Landmark.Megachurch) && controlsCivic(control, Lot.Church, pid);

  return {
    townMachine,
    indoctrinationPipeline,
    foodAndFuelCartel,
    sacredCanopy,
  };
}

/** Check if any player's Town Curfew decree is active in `district` against `attacker`. */
export function isCurfewActive(s: SimState, district: DistrictId, attacker: PlayerId): boolean {
  for (const d of s.activeDecrees) {
    if (d.decree === CivicDecreeId.TownCurfew && d.district === district && d.player !== attacker) {
      return true;
    }
  }
  return false;
}

/** Check if Parent-Teacher Night decree is active in `district` for `owner`. */
export function isParentTeacherNightActive(s: SimState, district: DistrictId, owner: PlayerId): boolean {
  for (const d of s.activeDecrees) {
    if (d.decree === CivicDecreeId.ParentTeacherNight && d.district === district && d.player === owner) {
      return true;
    }
  }
  return false;
}

/** Check if Food Rationing decree is active in `district` for `defender`. */
export function isFoodRationingActive(s: SimState, district: DistrictId, defender: PlayerId): boolean {
  for (const d of s.activeDecrees) {
    if (d.decree === CivicDecreeId.FoodRationing && d.district === district && d.player === defender) {
      return true;
    }
  }
  return false;
}

/** Check if Municipal Injunction decree is active in `district` or adjacent districts against `builder`. */
export function isMunicipalInjunctionActive(s: SimState, district: DistrictId, builder: PlayerId): boolean {
  for (const d of s.activeDecrees) {
    if (d.decree === CivicDecreeId.MunicipalInjunction && d.player !== builder) {
      // Affects Town Hall district and adjacent districts
      if (d.district === district || Math.abs(d.district - district) <= 1) {
        return true;
      }
    }
  }
  return false;
}

/** Check if Emergency Jam decree is active against `player`. */
export function isEmergencyJamActive(s: SimState, player: PlayerId): boolean {
  for (const d of s.activeDecrees) {
    if (d.decree === CivicDecreeId.EmergencyJam && d.player !== player) {
      return true;
    }
  }
  return false;
}

