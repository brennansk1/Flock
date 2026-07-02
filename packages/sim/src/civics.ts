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
];

/** Human-readable effect line per civic lot (client HUD + docs). */
export const CIVIC_EFFECTS: Record<number, string> = {
  [Lot.Sheriff]: "police look away — Heat fades faster",
  [Lot.School]: "kids carry the word — stronger ambient spread",
  [Lot.HighSchool]: "youth recruitment — faster follower growth",
  [Lot.Supermarket]: "control the food — your flock holds firmer",
  [Lot.Church]: "the pulpit is yours — Faith climbs",
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

/** Does `pid` control the given civic lot? Convenience for the engines. */
export function controlsCivic(control: Map<number, PlayerId>, lot: number, pid: PlayerId): boolean {
  return control.get(lot) === pid;
}
