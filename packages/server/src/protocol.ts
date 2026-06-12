/**
 * Wire protocol (§33). JSON over WSS for the skeleton; a binary codec is a
 * straightforward swap later since every message shape is already explicit.
 *
 * Server → client: welcome (seed + world + roster + balance, so tuning stays
 * hot-patchable server-side), turn broadcasts, periodic StateHash, snapshots.
 * Client → server: intents only. The client never sends state — server
 * authority is the anti-cheat (§34).
 */

import type { Intent, Turn, RawBalance, Snapshot } from "@flock/sim";

export interface WirePlayer {
  id: number;
  name: string;
  archetype: "dawn" | "radiant" | "circle" | "visitors";
}

export type ServerMsg =
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
      /** END → RECAP (§18/§25): the story of the match, headline grammar included. */
      type: "recap";
      recap: import("@flock/sim").MatchRecap;
    }
  | { type: "error"; message: string };

export type ClientMsg = { type: "intent"; intent: Intent };
