/**
 * Wire protocol (§33). JSON over WSS for the skeleton; a binary codec is a
 * straightforward swap later since every message shape is already explicit.
 *
 * Server → client: welcome (seed + world + roster + balance, so tuning stays
 * hot-patchable server-side), turn broadcasts, periodic StateHash, snapshots.
 * Client → server: intents only. The client never sends state — server
 * authority is the anti-cheat (§34).
 */

import type { ArchetypeId, Intent, Turn, RawBalance, Snapshot } from "@flock/sim";

export interface WirePlayer {
  id: number;
  name: string;
  archetype: ArchetypeId;
  /** true for AI seats (bots + established churches) — humans never set it. */
  bot?: boolean;
}

/** Account summary handed to the client at connect (§22/§28 profile bits). */
export interface WireAccount {
  id: string;
  name: string;
  guest: boolean;
  level: number;
  relics: number;
  rating: number;
  tier: string;
}

export type ServerMsg =
  | {
      /** Auth result (§26): the session token to persist + account summary. */
      type: "auth";
      token: string;
      account: WireAccount;
    }
  | {
      /**
       * Join payload: full state snapshot (§33) — joining is just the resync
       * path. Balance rides along so tuning stays server-side hot-patchable.
       */
      type: "welcome";
      playerId: number;
      seed: number;
      balance: RawBalance;
      snapshot: Snapshot;
      players: WirePlayer[];
    }
  | { type: "player_joined"; player: WirePlayer }
  | { type: "turn"; turn: Turn }
  | { type: "hash"; tick: number; hash: string }
  | {
      /** Resync response (§33): a fresh authoritative snapshot after a desync. */
      type: "snapshot";
      snapshot: Snapshot;
      players: WirePlayer[];
    }
  | { type: "chat"; from: number; channel: string; msg: string }
  | {
      /** END → RECAP (§18/§25): the story of the match, headline grammar included. */
      type: "recap";
      recap: import("@flock/sim").MatchRecap;
    }
  | {
      /**
       * END → RESULTS (§20/§22): the post-match XP/Relic ticker (§28) and a
       * provisional ranked delta. XP/Relics are self-contained per-match
       * values; the ranked field is provisional from a 1500 baseline because
       * persistent ratings live in the accounts service (§34), not the match.
       */
      type: "results";
      results: MatchResult[];
    }
  | { type: "error"; message: string }
  /** private-room handshake: the shareable invite code (§32) */
  | { type: "room"; code: string }
  /** solo-game pause state (server-confirmed) */
  | { type: "paused"; value: boolean };

export interface MatchResult {
  player: number;
  placement: number;
  xp: number;
  relics: number;
  /** new rating after this match assuming a fresh 1500 entry (provisional). */
  provisionalRating: number;
}

export type ClientMsg =
  | { type: "intent"; intent: Intent }
  /** Client asks for a fresh snapshot after detecting a StateHash divergence. */
  | { type: "resync" }
  /** Solo-vs-bots pause control (ignored in multi-human matches). */
  | { type: "pause" }
  | { type: "resume" };
