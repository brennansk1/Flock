/**
 * Recap generation (§25, Appendix B): turn the match's event log into the
 * shareable story. Headline priority: betrayal > prophecy > scandal > schism >
 * economy > default. The server broadcasts this at END; the Recap Card
 * renderer consumes the same struct.
 */

import { toInt, toFloat } from "./fixed.js";
import type { PlayerId, SimState } from "./types.js";

export interface PlayerRecap {
  player: PlayerId;
  headline: string;
  tilesHeld: number;
  peakFollowers: number;
  usdEarned: number;
  faith: number;
  traitor: boolean;
  won: boolean;
}

export interface MatchRecap {
  winner: PlayerId;
  durationTicks: number;
  players: PlayerRecap[];
}

function fmtTime(tick: number): string {
  const sTotal = Math.floor(tick / 10);
  const m = Math.floor(sTotal / 60);
  const sec = sTotal % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.floor(n / 1_000)}k`;
  return `$${n}`;
}

/** Appendix B grammar, priority-ordered per player. */
export function headlineFor(s: SimState, pid: PlayerId, won: boolean): string {
  const r = s.recap;
  const betrayed = r.betrayals.find((e) => e.traitor === pid);
  if (betrayed) return `Betrayed cult #${betrayed.victim} at ${fmtTime(betrayed.tick)}. Felt nothing.`;
  const wasBetrayed = r.betrayals.find((e) => e.victim === pid);
  if (wasBetrayed && won) return `Forgave nothing. Outlived the traitor.`;

  const prophecy = r.prophecies.find((e) => e.player === pid);
  if (prophecy?.fulfilled) return `Prophecy fulfilled. The town never saw it coming.`;
  if (prophecy && !prophecy.fulfilled) return `The date came and went. The dawn did not.`;

  const scandal = r.scandals.find((e) => e.attacker === pid);
  if (scandal) return `Published cult #${scandal.victim}'s scandal. Followers walked.`;
  const scandaled = r.scandals.find((e) => e.victim === pid);
  if (scandaled && won) return `Survived the headlines AND the Concerned Parents.`;

  const schismed = r.schisms.find((e) => e.parent === pid);
  if (schismed && won) return `Survived a schism. The splinter did not.`;
  if (schismed) return `Grew too big, believed too little. It split.`;

  const p = s.players.find((pl) => pl.id === pid);
  if (p && toInt(p.usdEarned) >= 100_000 && p.ownedTiles < s.populated / 20) {
    return `Earned ${fmtMoney(toInt(p.usdEarned))} and converted nobody's respect.`;
  }
  if (won) return `Last congregation standing.`;
  return `${p ? toInt(p.maxFollowers) : 0} souls. One town. No regrets.`;
}

export function generateRecap(s: SimState): MatchRecap {
  return {
    winner: s.winner,
    durationTicks: s.tick,
    players: s.players
      .filter((p) => p.spawned)
      .map((p) => ({
        player: p.id,
        headline: headlineFor(s, p.id, p.id === s.winner),
        tilesHeld: p.ownedTiles,
        peakFollowers: toInt(p.maxFollowers),
        usdEarned: toInt(p.usdEarned),
        faith: Math.round(toFloat(p.faith)),
        traitor: p.traitor,
        won: p.id === s.winner,
      })),
  };
}
