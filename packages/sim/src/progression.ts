/**
 * Account progression (§22) — XP, levels, and Relics. Like ranked.ts this is a
 * META system outside lockstep scope (it scores finished matches, never runs in
 * step()), so plain integer/float arithmetic is fine here.
 *
 * XP per match:  40 + 2×minutes_survived + placement_bonus + first_win_of_day
 * Levels:        XP to next = round(200 × level^1.25); level 5 unlocks ranked.
 * Relics:        10–30/match by participation; never sold for money (§22).
 */

export const RANKED_UNLOCK_LEVEL = 5;
export const ARCHETYPE_UNLOCK_COST = 1200; // Relics (§22)

export interface MatchOutcome {
  /** seconds the player survived before elimination (or match end). */
  survivedTicks: number;
  /** 1 = first place. */
  placement: number;
  /** total players in the match (for top-25%/50% bands). */
  playerCount: number;
  /** this is the account's first WIN of the day. */
  firstWinOfDay: boolean;
}

const TICKS_PER_MINUTE = 10 * 60; // sim runs at 10 Hz

/** Placement bonus (§22): 1st:120, top25%:60, top50%:30, else 0. */
export function placementBonus(placement: number, playerCount: number): number {
  if (placement === 1) return 120;
  const frac = placement / Math.max(1, playerCount);
  if (frac <= 0.25) return 60;
  if (frac <= 0.5) return 30;
  return 0;
}

export function matchXp(o: MatchOutcome): number {
  const minutes = o.survivedTicks / TICKS_PER_MINUTE;
  const won = o.placement === 1;
  return Math.round(
    40 +
      2 * minutes +
      placementBonus(o.placement, o.playerCount) +
      (won && o.firstWinOfDay ? 100 : 0),
  );
}

/** XP needed to advance FROM `level` to the next (§22): round(200 × level^1.25). */
export function xpToNext(level: number): number {
  return Math.round(200 * Math.pow(Math.max(1, level), 1.25));
}

export interface LevelState {
  level: number;
  xpIntoLevel: number;
}

/** Apply earned XP, rolling over as many level-ups as the total covers. */
export function applyXp(state: LevelState, gained: number): LevelState {
  let level = state.level;
  let xp = state.xpIntoLevel + gained;
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level++;
  }
  return { level, xpIntoLevel: xp };
}

/**
 * Relics earned for a match (§22): a 10-base participation grant plus up to 20
 * scaled by survival and placement, clamped to the 10–30 band. Deterministic in
 * the outcome so two clients agree on the post-match ticker.
 */
export function matchRelics(o: MatchOutcome): number {
  const survivalFrac = Math.min(1, o.survivedTicks / (TICKS_PER_MINUTE * 12));
  const placeFrac = 1 - (o.placement - 1) / Math.max(1, o.playerCount - 1 || 1);
  const bonus = Math.round(20 * (0.5 * survivalFrac + 0.5 * placeFrac));
  return Math.max(10, Math.min(30, 10 + bonus));
}

export function rankedUnlocked(level: number): boolean {
  return level >= RANKED_UNLOCK_LEVEL;
}
