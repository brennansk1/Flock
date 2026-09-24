/**
 * Daily Prophecy (§23) — one global modifier-challenge per day, the same for
 * the whole world (the "Wordle effect"). Pure and deterministic: a day number
 * selects a challenge from the template grammar, and a finished match's summary
 * is checked against it for the 30-Relic reward + streak.
 *
 * This is META (outside lockstep), so plain arithmetic is fine. It never reads
 * live sim state — only an end-of-match summary the caller assembles.
 */
import type { ArchetypeId } from "./archetypes/types.js";

export const DAILY_REWARD_RELICS = 30; // §23
export const STREAK_MILESTONES = [7, 30, 100] as const; // cosmetic unlocks (§23)

/** End-of-match facts a Daily Prophecy can test (the caller fills this in). */
export interface DailySummary {
  archetype: ArchetypeId;
  won: boolean;
  placement: number;
  peakFollowers: number;
  usdEarned: number;
  /** highest Heat reached during the match (0..100). */
  heatPeak: number;
  /** Watchtowers operated at end. */
  watchtowers: number;
  /** did this player ever enter CRUSADE stance? */
  enteredCrusade: boolean;
  /** did this player fulfil a Prophecy Countdown? */
  prophecyFulfilled: boolean;
  /** alliances formed this match. */
  alliances: number;
  /** did this player betray an ally (JUDAS)? */
  betrayed: boolean;
}

export interface DailyChallenge {
  id: string;
  title: string;
  description: string;
  reward: number;
}

interface Template extends DailyChallenge {
  check: (s: DailySummary) => boolean;
}

// The challenge grammar. Keep predicates pure functions of the summary.
const TEMPLATES: Template[] = [
  {
    id: "no_watchtowers",
    title: "The Trusting Shepherd",
    description: "Win a match holding zero Watchtowers.",
    reward: DAILY_REWARD_RELICS,
    check: (s) => s.won && s.watchtowers === 0,
  },
  {
    id: "fulfil_prophecy",
    title: "The Date Is Set",
    description: "Fulfil a Prophecy Countdown.",
    reward: DAILY_REWARD_RELICS,
    check: (s) => s.prophecyFulfilled,
  },
  {
    id: "rich_pacifist",
    title: "Money Talks",
    description: "Earn $500k in a match without ever entering CRUSADE.",
    reward: DAILY_REWARD_RELICS,
    check: (s) => s.usdEarned >= 500_000 && !s.enteredCrusade,
  },
  {
    id: "cool_head",
    title: "Nothing to See Here",
    description: "Win a match while keeping Heat below 50 the whole time.",
    reward: DAILY_REWARD_RELICS,
    check: (s) => s.won && s.heatPeak < 50,
  },
  {
    id: "big_flock",
    title: "Standing Room Only",
    description: "Reach 5,000 followers in a single match.",
    reward: DAILY_REWARD_RELICS,
    check: (s) => s.peakFollowers >= 5_000,
  },
  {
    id: "loyal_to_the_end",
    title: "No Judas Here",
    description: "Form an alliance and win without betraying it.",
    reward: DAILY_REWARD_RELICS,
    check: (s) => s.won && s.alliances >= 1 && !s.betrayed,
  },
  {
    id: "podium",
    title: "On the Podium",
    description: "Finish top 3 in any match.",
    reward: DAILY_REWARD_RELICS,
    check: (s) => s.placement <= 3,
  },
  {
    id: "true_believer",
    title: "The Long Game",
    description: "Win a match as The Radiant Path.",
    reward: DAILY_REWARD_RELICS,
    check: (s) => s.won && s.archetype === "radiant",
  },
];

/** Days since the Unix epoch in UTC — the shared global clock for the challenge. */
export function dayNumber(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 86_400_000);
}

/** Deterministically pick the day's challenge (same for everyone, every day). */
export function dailyChallenge(day: number = dayNumber()): DailyChallenge {
  // a small integer hash so consecutive days don't repeat the same template
  let h = (day ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  const t = TEMPLATES[h % TEMPLATES.length]!;
  return { id: t.id, title: t.title, description: t.description, reward: t.reward };
}

/** Did this match satisfy the given day's Daily Prophecy? */
export function checkDaily(summary: DailySummary, day: number = dayNumber()): boolean {
  let h = (day ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return TEMPLATES[h % TEMPLATES.length]!.check(summary);
}

/** Streak cosmetic tier reached, or null. Call when a streak increments. */
export function streakReward(streak: number): number | null {
  return (STREAK_MILESTONES as readonly number[]).includes(streak) ? streak : null;
}
