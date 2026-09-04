/**
 * Cohort travel model (v3 missions M2 — DESIGN_MISSIONS.md §1).
 *
 * March time = Manhattan distance from the player's nearest operational
 * compound to the target × marchTicksPerTile — both directions: the sortie
 * walks out before it works, and walks home after a recall. Stateless
 * (recomputed per query) so a lost compound reroutes the walk home instead
 * of leaving stale timers. Shared by the tick upkeep (sim.ts) and the
 * conversion engine (conversion.ts) without an import cycle.
 */

import type { Balance } from "./balance.js";
import type { Cohort, PlayerState, SimState } from "./types.js";

export function cohortTransit(s: SimState, p: PlayerState, c: Cohort, b: Balance): number {
  const w = s.world;
  const tx = c.target % w.width;
  const ty = (c.target / w.width) | 0;
  let best = -1;
  for (const bd of s.buildings) {
    if (bd.player !== p.id || bd.type !== "compound" || bd.buildTicksLeft > 0) continue;
    const d = Math.abs((bd.tile % w.width) - tx) + Math.abs(((bd.tile / w.width) | 0) - ty);
    if (best < 0 || d < best) best = d;
  }
  if (best < 0) best = 12; // compoundless edge case: a fixed long walk
  return best * b.missions.marchTicksPerTile;
}

/** Has the sortie reached its ground? (outbound only — recalls walk home) */
export function cohortArrived(s: SimState, p: PlayerState, c: Cohort, b: Balance): boolean {
  return c.age >= cohortTransit(s, p, c, b);
}
