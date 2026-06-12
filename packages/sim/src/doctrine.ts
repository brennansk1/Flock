/**
 * Doctrine Tree (BITE, §10). 16 nodes, 7 points max, earned at follower
 * milestones. Tier gating: a branch's T3 needs 2 picks in that branch, T4
 * needs 3. Irreversible.
 *
 * Effects are queried by the systems they modify (conversion, economy, raids,
 * strikes) through tiny helpers here — doctrine never pushes state itself.
 */

import type { Fixed } from "./fixed.js";
import { toFloat } from "./fixed.js";
import type { PlayerState } from "./types.js";

/** Follower milestones that each grant 1 doctrine point (§10). */
export const MILESTONES = [2_500, 5_000, 10_000, 18_000, 30_000, 50_000, 80_000] as const;

export const DOCTRINE_NODES = [
  "B1", "B2", "B3", "B4", // Behavior — Discipline
  "I1", "I2", "I3", "I4", // Information — The Truth
  "T1", "T2", "T3", "T4", // Thought — The Word
  "E1", "E2", "E3", "E4", // Emotional — The Embrace
] as const;
export type DoctrineNode = (typeof DOCTRINE_NODES)[number];

export function hasDoctrine(p: PlayerState, node: DoctrineNode): boolean {
  return p.doctrine.includes(node);
}

/** Points earned so far from the player's high-water follower count. */
export function doctrinePointsEarned(p: PlayerState): number {
  const peak = toFloat(p.maxFollowers);
  let pts = 0;
  for (const m of MILESTONES) if (peak >= m) pts++;
  return pts;
}

export function doctrinePointsAvailable(p: PlayerState): number {
  return doctrinePointsEarned(p) - p.doctrine.length;
}

/** Validate and apply a DOCTRINE_PICK. Returns true if the pick landed. */
export function pickDoctrine(p: PlayerState, node: string): boolean {
  if (!(DOCTRINE_NODES as readonly string[]).includes(node)) return false;
  if (p.doctrine.includes(node)) return false;
  if (doctrinePointsAvailable(p) <= 0) return false;

  const branch = node[0]!;
  const tier = Number(node[1]!);
  const inBranch = p.doctrine.filter((n) => n[0] === branch).length;
  // tiers gate: need 2 in a branch for its T3, 3 for T4 (§10)
  if (tier === 3 && inBranch < 2) return false;
  if (tier === 4 && inBranch < 3) return false;
  // T1/T2 are open; also require lower duplicates not needed (T2 doesn't need T1)

  p.doctrine.push(node);
  return true;
}

// ---- effect multipliers (Fixed where they enter sim math) ----

const Q = (n: number): Fixed => Math.round(n * 65536);

/** B1 Tithing Drill: +10% tithe. */
export function titheMult(p: PlayerState): Fixed {
  return hasDoctrine(p, "B1") ? Q(1.1) : Q(1);
}

/** B2 Uniforms: +15% home-tile defense. */
export function homeDefenseMult(p: PlayerState): Fixed {
  return hasDoctrine(p, "B2") ? Q(1.15) : Q(1);
}

/** B3 Curfews: dissent gains from your own actions −40%. */
export function ownDissentMult(p: PlayerState): Fixed {
  return hasDoctrine(p, "B3") ? Q(0.6) : Q(1);
}

/** B4 TOTAL DEVOTION: defense attrition −50% (and Court Defection immunity). */
export function defenseAttritionMult(p: PlayerState): Fixed {
  return hasDoctrine(p, "B4") ? Q(0.5) : Q(1);
}

/** I3 Strong Signal: strike radius +30%, cost −20%. */
export function strikeRadiusMult(p: PlayerState): number {
  return hasDoctrine(p, "I3") ? 1.3 : 1;
}
export function strikeCostMult(p: PlayerState): Fixed {
  return hasDoctrine(p, "I3") ? Q(0.8) : Q(1);
}

/** T1 Better Pamphlets: R₀ +10%. */
export function r0Mult(p: PlayerState): Fixed {
  return hasDoctrine(p, "T1") ? Q(1.1) : Q(1);
}

/** T2 Whisper Network: ambient creep +60%. */
export function creepMult(p: PlayerState): Fixed {
  return hasDoctrine(p, "T2") ? Q(1.6) : Q(1);
}

/** T3 Forgiveness: apostate scars on your lost tiles heal in half the time. */
export function scarTicksFor(victim: PlayerState | undefined, baseTicks: number): number {
  return victim && hasDoctrine(victim, "T3") ? baseTicks >> 1 : baseTicks;
}

/**
 * T4 THE IRRESISTIBLE WORD: ignore 50% of district retain modifiers when
 * attacking — retain' = 1 + (retain − 1)/2.
 */
export function effectiveRetain(attacker: PlayerState, retain: Fixed): Fixed {
  if (!hasDoctrine(attacker, "T4")) return retain;
  return Q(1) + ((retain - Q(1)) >> 1);
}

/** E1 Welcome Basket: love-bomb abilities −30% cost. */
export function loveBombCostMult(p: PlayerState): Fixed {
  return hasDoctrine(p, "E1") ? Q(0.7) : Q(1);
}

/** E2 Family Now: deprogramming raids against you −50% effect. */
export function raidEffectMultAgainst(victim: PlayerState | undefined): Fixed {
  return victim && hasDoctrine(victim, "E2") ? Q(0.5) : Q(1);
}

/** E3 Clean Image: Heat gains −30%. */
export function heatGainMult(p: PlayerState): Fixed {
  return hasDoctrine(p, "E3") ? Q(0.7) : Q(1);
}

/**
 * E4 UNSHAKEABLE: negate the first mass-apostasy event (Scandal, Exposé,
 * failed Prophecy). Returns true if the event was absorbed.
 */
export function tryAbsorbMassApostasy(p: PlayerState): boolean {
  if (hasDoctrine(p, "E4") && !p.e4Spent) {
    p.e4Spent = true;
    return true;
  }
  return false;
}
