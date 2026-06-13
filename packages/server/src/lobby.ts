/**
 * Lobby Director (§32). The master object: it owns many concurrent
 * MatchWorkers, routes each authenticated connection into a joinable match (or
 * spins up a fresh one), and on match-END persists the durable results —
 * ranked rating updates (real Glicko-2, not the worker's provisional), XP/Relic
 * progression, match history, and the replay — through the Store (§34).
 *
 * In the single-process dev topology this lives alongside the workers; the
 * production split (one pinned worker process per match) keeps this seam: the
 * Director would talk to workers over IPC instead of in-process calls.
 */

import {
  updateFFA,
  matchXp,
  matchRelics,
  applyXp,
  tierFor,
  type RawBalance,
  type Rating,
} from "@flock/sim";
import { MatchWorker, type MatchEndInfo } from "./matchWorker.js";
import type { Store, Account, MatchRecord, MatchParticipant } from "./store.js";
import type { AuthService } from "./auth.js";
import { Metrics, log } from "./metrics.js";
import type { WebSocket } from "ws";
import type { WirePlayer } from "./protocol.js";

export interface LobbyOptions {
  worldSize: number;
  botCount: number;
  churchCount: number;
  foundingTicks: number;
  capacity: number;
}

const DEFAULTS: LobbyOptions = {
  worldSize: 96,
  botCount: 6,
  churchCount: 1,
  foundingTicks: 200,
  capacity: 20,
};

const PROPHET_CUT = 500; // §20 top-500 leaderboard tier

/**
 * Persist a finished match (§34): per-account XP/Relics, a real Glicko-2 FFA
 * rating update in finishing order, a MatchRecord, and the replay. Bots and
 * guests get no rating persistence (guests aren't ranked, §20), but humans'
 * progression always advances. Exported standalone so it's unit-testable with
 * a synthetic MatchEndInfo and any Store.
 */
export async function persistMatch(store: Store, info: MatchEndInfo): Promise<MatchRecord> {
  // results are already placement-ordered (winner first) by the worker
  const seats = info.results
    .map((r) => ({ r, accountId: info.accountOf.get(r.player) }))
    .filter((s): s is { r: (typeof info.results)[number]; accountId: string } => !!s.accountId);

  const accounts = new Map<string, Account>();
  for (const s of seats) {
    const a = await store.getAccount(s.accountId);
    if (a) accounts.set(s.accountId, a);
  }

  // real FFA Glicko-2 over the rated (non-guest) accounts, in placement order
  const rated = seats.filter((s) => accounts.get(s.accountId) && !accounts.get(s.accountId)!.guest);
  const ratingsIn: Rating[] = rated.map((s) => accounts.get(s.accountId)!.rating);
  const ratingsOut = ratingsIn.length >= 2 ? updateFFA(ratingsIn) : ratingsIn;

  const participants: MatchParticipant[] = [];
  for (const s of seats) {
    const acc = accounts.get(s.accountId);
    if (!acc) continue;
    const outcome = {
      survivedTicks: info.durationTicks,
      placement: s.r.placement,
      playerCount: info.results.length,
      firstWinOfDay: false,
    };
    const before = acc.rating.rating;
    const leveled = applyXp({ level: acc.level, xpIntoLevel: acc.xpIntoLevel }, matchXp(outcome));
    acc.level = leveled.level;
    acc.xpIntoLevel = leveled.xpIntoLevel;
    acc.relics += matchRelics(outcome);
    const ri = rated.findIndex((x) => x.accountId === s.accountId);
    if (ri >= 0) acc.rating = ratingsOut[ri]!;
    await store.saveAccount(acc);
    participants.push({
      accountId: acc.id,
      placement: s.r.placement,
      xp: s.r.xp,
      relics: s.r.relics,
      ratingBefore: Math.round(before),
      ratingAfter: Math.round(acc.rating.rating),
    });
  }

  const record: MatchRecord = {
    id: info.matchId,
    seed: info.seed,
    startedAt: Date.now() - info.durationTicks * 100,
    endedAt: Date.now(),
    durationTicks: info.durationTicks,
    winner: info.accountOf.get(info.winnerPlayerId) ?? null,
    participants,
  };
  await store.recordMatch(record);
  await store.saveReplay(info.matchId, info.replay);
  return record;
}

export class LobbyDirector {
  private readonly matches = new Map<string, MatchWorker>();
  readonly metrics = new Metrics();
  private seedCounter = (Date.now() ^ (process.pid << 16)) >>> 0;

  constructor(
    private readonly balanceRaw: RawBalance,
    private readonly store: Store,
    private readonly auth: AuthService,
    private readonly opts: LobbyOptions = DEFAULTS,
  ) {}

  /** Route an authenticated player into a match, creating one if needed. */
  join(ws: WebSocket, account: Account, archetype: WirePlayer["archetype"]): MatchWorker {
    const match = this.findJoinable() ?? this.createMatch();
    match.addClient(ws, account.name, archetype, account.id);
    this.metrics.inc("players_joined");
    this.metrics.set("matches_live", this.matches.size);
    log("info", "player joined match", { matchId: match.matchId, account: account.id, archetype });
    return match;
  }

  private findJoinable(): MatchWorker | null {
    for (const m of this.matches.values()) if (m.isJoinable()) return m;
    return null;
  }

  private createMatch(): MatchWorker {
    const seed = (this.seedCounter = (this.seedCounter * 1664525 + 1013904223) >>> 0);
    const m = new MatchWorker(
      this.balanceRaw,
      seed,
      this.opts.worldSize,
      this.opts.botCount,
      this.opts.foundingTicks,
      this.opts.churchCount,
      this.opts.capacity,
    );
    m.setOnEnd((info) => void this.persistResult(info).catch((e) => log("error", "persist failed", { err: String(e) })));
    this.matches.set(m.matchId, m);
    this.metrics.inc("matches_created");
    log("info", "match created", { matchId: m.matchId, seed });
    return m;
  }

  private async persistResult(info: MatchEndInfo): Promise<void> {
    this.metrics.inc("matches_ended");
    const record = await persistMatch(this.store, info);
    await this.recomputeProphets();
    this.matches.delete(info.matchId);
    this.metrics.set("matches_live", this.matches.size);
    log("info", "match persisted", { matchId: info.matchId, participants: record.participants.length });
  }

  /** Recompute the Prophet-tier flag (top-500 by rating, §20). */
  private async recomputeProphets(): Promise<void> {
    const top = await this.store.topRatings(PROPHET_CUT);
    const cut = new Set(top.map((a) => a.id));
    for (const a of top) {
      const want = cut.has(a.id);
      if (a.isProphet !== want) {
        a.isProphet = want;
        await this.store.saveAccount(a);
      }
    }
  }

  /** Operator health snapshot (/health). */
  health(): Record<string, unknown> {
    return {
      ...this.metrics.snapshot(),
      matchesLive: this.matches.size,
      tiers: undefined,
    };
  }

  /** Tier label for an account (for profile/lobby display). */
  tierOf(account: Account): string {
    return tierFor(account.rating.rating, account.isProphet);
  }

  stopAll(): void {
    for (const m of this.matches.values()) m.stop();
    this.matches.clear();
  }
}
