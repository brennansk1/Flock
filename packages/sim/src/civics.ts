/**
 * Civics takeover engine (§13 rev.) — the "key buildings" layer.
 *
 * Every town guarantees its keystone civic lots (mapgen §2 rev. 3). When a
 * cult converts the households occupying a civic lot's tiles, it CONTROLS the
 * institution, with a realistic effect wired straight into the engines:
 *
 *   Sheriff (police)     → the cops look the other way: bonus Heat decay
 *   School (elementary)  → the kids carry the word home: ambient creep ×
 *   High School          → youth recruitment: follower growth ×
 *   Supermarket (grocery)→ control the food, control the flock: defense ×
 *   Church               → the pulpit is yours: Faith drifts upward
 *
 * Control is per lot TYPE: the player who owns strictly more of that lot's
 * tiles than any rival (and at least one) controls it. Ties break to the
 * lower player id — deterministic like everything else in sim scope.
 *
 * Targeting synergy (§4 rev.): civic lots are ordinary convertible tiles, so
 * fronts/vans can be aimed at them specifically — take the school, and the
 * whole district leans your way.
 */

import { NEUTRAL, Lot, TileState, type SimState, type PlayerId } from "./types.js";

/** The civic lot types the engine watches, in fixed evaluation order. */
export const CIVIC_LOTS: readonly Lot[] = [
  Lot.Sheriff,
  Lot.School,
  Lot.HighSchool,
  Lot.Supermarket,
  Lot.Church,
  // ECONOMIC ANCHORS (§2A mechanics, B1.4.20): every town archetype carries
  // its own prize — the granary (or the cannery that §2A swaps in for it),
  // the sawmill, the lighthouse. Not every anchor exists on every map; the
  // HUD lists only what this town actually has.
  Lot.GrainElevator,
  Lot.Cannery,
  Lot.Sawmill,
  Lot.Lighthouse,
];

/** Human-readable effect line per civic lot (client HUD + docs). */
export const CIVIC_EFFECTS: Record<number, string> = {
  [Lot.Sheriff]: "police look away — Heat fades faster",
  [Lot.School]: "kids carry the word — stronger ambient spread",
  [Lot.HighSchool]: "youth recruitment — faster follower growth",
  [Lot.Supermarket]: "control the food — your flock holds firmer",
  [Lot.Church]: "the pulpit is yours — Faith climbs",
  [Lot.GrainElevator]: "the harvest money flows through you — richer tithe",
  [Lot.Cannery]: "the fish money flows through you — richer tithe",
  [Lot.Sawmill]: "lumber at cost — cheaper commune upgrades",
  [Lot.Lighthouse]: "the beacon draws seekers — farther compound outreach",
};

/**
 * Who controls each civic lot type. One pass over the world, deterministic.
 * Returns a map lot → controlling player id (entries only where controlled).
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
    if (owner === NEUTRAL || w.state[t] !== TileState.Believer) continue;
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
    // iterate ids ascending so ties break to the lower id
    for (const pid of [...per.keys()].sort((a, z) => a - z)) {
      const n = per.get(pid)!;
      if (n > bestN) {
        bestN = n;
        best = pid;
      }
    }
    if (best !== 0) {
      const p = s.players.find((pl) => pl.id === best);
      if (p && p.alive) control.set(lot, best);
    }
  }
  return control;
}

/**
 * Siege state per key-building type (v3 §3), for the HUD tug-of-war bars.
 * Aggregates all instances of each lot type present on the map:
 *   holder     — who controls it now (0 = uncontrolled / mostly neutral)
 *   leader     — the player holding the most of its tiles (0 = none)
 *   leaderFill — fraction 0..1 of the type's tiles the leader holds
 *   contested  — >1 player holds tiles (the bar should flash)
 * Only lot types actually present on the map get an entry.
 */
export interface SiegeBar {
  lot: number;
  holder: PlayerId;
  leader: PlayerId;
  leaderFill: number;
  contested: boolean;
}

export function computeSiegeState(s: SimState): SiegeBar[] {
  const w = s.world;
  const watch = new Set<number>(CIVIC_LOTS);
  const total = new Map<number, number>(); // lot → total tiles of that type
  const per = new Map<number, Map<PlayerId, number>>(); // lot → owner → believer tiles
  for (let t = 0; t < w.lot.length; t++) {
    const lot = w.lot[t]!;
    if (!watch.has(lot)) continue;
    total.set(lot, (total.get(lot) ?? 0) + 1);
    const owner = w.owner[t]!;
    if (owner === NEUTRAL || w.state[t] !== TileState.Believer) continue;
    let m = per.get(lot);
    if (!m) {
      m = new Map();
      per.set(lot, m);
    }
    m.set(owner, (m.get(owner) ?? 0) + 1);
  }
  const control = computeCivicControl(s);
  const out: SiegeBar[] = [];
  for (const lot of CIVIC_LOTS) {
    const tot = total.get(lot);
    if (!tot) continue; // this town doesn't have this building
    const m = per.get(lot);
    let leader: PlayerId = 0;
    let leaderN = 0;
    let owners = 0;
    if (m) {
      for (const pid of [...m.keys()].sort((a, z) => a - z)) {
        const n = m.get(pid)!;
        if (n > 0) owners++;
        if (n > leaderN) {
          leaderN = n;
          leader = pid;
        }
      }
    }
    out.push({
      lot,
      holder: control.get(lot) ?? 0,
      leader,
      leaderFill: leaderN / tot,
      contested: owners > 1,
    });
  }
  return out;
}

/** Does `pid` control the given civic lot? Convenience for the engines. */
export function controlsCivic(control: Map<number, PlayerId>, lot: number, pid: PlayerId): boolean {
  return control.get(lot) === pid;
}
