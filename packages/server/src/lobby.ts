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

/** Per-match creation overrides — the private-host knobs (§32). */
export interface MatchConfig {
  worldSize?: number;
  botCount?: number;
  foundingTicks?: number;
  townType?: string;
}

/** How a connection wants to be routed. */
export interface JoinRequest {
  /** join an existing private room by code */
  room?: string;
  /** host a fresh private room (with optional config) */
  createPrivate?: boolean;
  config?: MatchConfig;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

export class LobbyDirector {
  private readonly matches = new Map<string, MatchWorker>();
  private readonly byCode = new Map<string, MatchWorker>();
  readonly metrics = new Metrics();
  private seedCounter = (Date.now() ^ (process.pid << 16)) >>> 0;

  constructor(
    private readonly balanceRaw: RawBalance,
    private readonly store: Store,
    private readonly auth: AuthService,
    private readonly opts: LobbyOptions = DEFAULTS,
  ) {}

  /**
   * Route an authenticated player into a match. Public flow finds/creates a
   * public match; `room` joins a private room by code; `createPrivate` hosts
   * one. Returns null when a room code doesn't resolve (caller informs the
   * client and closes).
   */
  join(
    ws: WebSocket,
    account: Account,
    archetype: WirePlayer["archetype"],
    req: JoinRequest = {},
  ): MatchWorker | null {
    let match: MatchWorker;
    if (req.room) {
      const code = req.room.toUpperCase().trim();
      const found = this.byCode.get(code);
      if (!found || !found.isJoinable()) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: found ? "that room is full or already finished" : "no room with that code",
          }),
        );
        ws.close();
        this.metrics.inc("room_join_failed");
        return null;
      }
      match = found;
    } else if (req.createPrivate) {
      match = this.createMatch(req.config ?? {}, true);
    } else {
      match = this.findJoinable() ?? this.createMatch();
    }
    match.addClient(ws, account.name, archetype, account.id);
    if (match.isPrivate) {
      // hand the host/joiner the shareable code
      ws.send(JSON.stringify({ type: "room", code: match.roomCode }));
    }
    this.metrics.inc("players_joined");
    this.metrics.set("matches_live", this.matches.size);
    log("info", "player joined match", {
      matchId: match.matchId,
      account: account.id,
      archetype,
      private: match.isPrivate,
    });
    return match;
  }

  private findJoinable(): MatchWorker | null {
    for (const m of this.matches.values()) if (!m.isPrivate && m.isJoinable()) return m;
    return null;
  }

  private newRoomCode(): string {
    for (;;) {
      let code = "";
      let n = (this.seedCounter = (this.seedCounter * 1664525 + 1013904223) >>> 0);
      for (let i = 0; i < 5; i++) {
        code += CODE_ALPHABET[n % CODE_ALPHABET.length];
        n = (n / CODE_ALPHABET.length) | 0;
      }
      if (!this.byCode.has(code)) return code;
    }
  }

  private createMatch(cfg: MatchConfig = {}, isPrivate = false): MatchWorker {
    const seed = (this.seedCounter = (this.seedCounter * 1664525 + 1013904223) >>> 0);
    const clampInt = (v: number | undefined, lo: number, hi: number, dflt: number): number =>
      Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v!))) : dflt;
    const roomCode = isPrivate ? this.newRoomCode() : "";
    const m = new MatchWorker(
      this.balanceRaw,
      seed,
      clampInt(cfg.worldSize, 64, 160, this.opts.worldSize),
      clampInt(cfg.botCount, 0, 3, this.opts.botCount),
      clampInt(cfg.foundingTicks, 100, 1200, this.opts.foundingTicks),
      this.opts.churchCount,
      this.opts.capacity,
      { isPrivate, roomCode, ...(cfg.townType !== undefined ? { townType: cfg.townType } : {}) },
    );
    m.setOnEnd((info) => void this.persistResult(info).catch((e) => log("error", "persist failed", { err: String(e) })));
    this.matches.set(m.matchId, m);
    if (isPrivate) this.byCode.set(roomCode, m);
    this.metrics.inc(isPrivate ? "private_matches_created" : "matches_created");
    log("info", "match created", { matchId: m.matchId, seed, private: isPrivate, code: roomCode || undefined });
    return m;
  }

  private async persistResult(info: MatchEndInfo): Promise<void> {
    this.metrics.inc("matches_ended");
    const record = await persistMatch(this.store, info);
    await this.recomputeProphets();
    const ended = this.matches.get(info.matchId);
    if (ended?.roomCode) this.byCode.delete(ended.roomCode);
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
