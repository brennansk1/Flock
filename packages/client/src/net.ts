/**
 * Client netcode (§33): connect, mirror the authoritative sim by applying the
 * server's Turn broadcasts in order, verify StateHash when it arrives, and
 * predict locally so the player's own actions feel instant.
 *
 * Two sims run side by side:
 *   - `confirmed` advances ONLY by server Turns. It is the authority; the
 *     StateHash desync check (§33) runs against it, never against prediction.
 *   - `sim` (rendered) is the prediction: a clone of `confirmed` with the local
 *     player's sent-but-unacknowledged intents replayed on top each turn.
 *
 * Reconciliation is implicit and rollback-free by construction: every server
 * Turn rebuilds the prediction from the freshly-confirmed snapshot, so any
 * mispredicted pixel self-heals within one turn (≤100 ms). Pending intents age
 * out once a Turn lands after the tick they were authored on.
 */

import {
  loadBalance,
  step,
  hashState,
  newPlayer,
  fromSnapshot,
  toSnapshot,
  type Balance,
  type Intent,
  type RawBalance,
  type SimState,
  type Snapshot,
  type Turn,
  type MatchRecap,
} from "@flock/sim";

// Protocol message shapes (kept in sync with @flock/server/src/protocol.ts;
// will move to a shared package when the protocol stabilizes).
export interface WirePlayer {
  id: number;
  name: string;
  archetype: "dawn" | "radiant" | "circle" | "visitors";
}
type ServerMsg =
  | {
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
  | { type: "recap"; recap: MatchRecap }
  | { type: "results"; results: MatchResult[] }
  | { type: "error"; message: string };

/** Post-match XP/Relic ticker + provisional rating (§20/§22). */
export interface MatchResult {
  player: number;
  placement: number;
  xp: number;
  relics: number;
  provisionalRating: number;
}

/** Distributive Omit so the Intent union keeps its discrimination. */
type DistOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
/** What the client authors: any Intent minus `player` (the server stamps identity). */
export type ClientIntent = DistOmit<Intent, "player">;

export interface GameSession {
  /** the rendered, locally-predicted sim (see file header). */
  sim: SimState;
  balance: Balance;
  playerId: number;
  players: WirePlayer[];
  /** filled by the server at END (§25) */
  recap?: MatchRecap;
  /** filled by the server at END (§20/§22) */
  results?: MatchResult[];
  sendIntent(intent: ClientIntent): void;
}

/** A locally-authored intent waiting to be confirmed by a server Turn. */
interface PendingIntent {
  intent: Intent;
  /** confirmed tick at which it was authored; aged out once a later Turn lands. */
  authoredTick: number;
}

export function connect(url: string, onReady: (g: GameSession) => void): void {
  const ws = new WebSocket(url);
  let session: GameSession | null = null;

  // The authority: advanced only by server Turns, hashed for desync checks.
  let confirmed: SimState | null = null;
  // Local intents not yet reflected in a confirmed Turn (the prediction set).
  const pending: PendingIntent[] = [];

  /**
   * Rebuild the rendered sim from the confirmed snapshot, then replay the
   * pending local intents as one speculative step so the player sees their own
   * actions immediately. Cheap at 10 Hz; corrected every server Turn.
   */
  const rebuildPrediction = (): void => {
    if (!session || !confirmed) return;
    const predicted = fromSnapshot(toSnapshot(confirmed));
    if (pending.length > 0) {
      step(
        predicted,
        { n: confirmed.tick, intents: pending.map((p) => p.intent), seedSlice: 0 },
        session.balance,
      );
    }
    session.sim = predicted;
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string) as ServerMsg;
    switch (msg.type) {
      case "welcome": {
        const balance = loadBalance(msg.balance);
        // Joining IS the resync path: restore the authoritative snapshot and
        // mirror every Turn from here on.
        confirmed = fromSnapshot(msg.snapshot);
        session = {
          sim: fromSnapshot(msg.snapshot),
          balance,
          playerId: msg.playerId,
          players: [...msg.players],
          sendIntent: (intent) => {
            const full = { ...intent, player: msg.playerId } as Intent;
            ws.send(JSON.stringify({ type: "intent", intent: full }));
            // predict immediately: stash it and fold it into the rendered sim
            if (confirmed) pending.push({ intent: full, authoredTick: confirmed.tick });
            rebuildPrediction();
          },
        };
        onReady(session);
        break;
      }
      case "player_joined": {
        if (!session || !confirmed) break;
        session.players.push(msg.player);
        // Same factory as the server — initial player state defined once. Add
        // to BOTH sims so prediction and authority agree on the roster.
        confirmed.players.push(newPlayer(msg.player.id, msg.player.archetype, session.balance));
        rebuildPrediction();
        break;
      }
      case "turn": {
        if (!session || !confirmed) break;
        step(confirmed, msg.turn, session.balance);
        // Age out predictions that have now had a Turn to land server-side;
        // whatever is left is still in flight and stays predicted.
        for (let i = pending.length - 1; i >= 0; i--) {
          if (pending[i]!.authoredTick < confirmed.tick) pending.splice(i, 1);
        }
        rebuildPrediction();
        break;
      }
      case "hash": {
        if (!confirmed) break;
        // Always hash the AUTHORITY, never the prediction (§33).
        const local = hashState(confirmed);
        if (local !== msg.hash) {
          // Desync (§33): production path requests a snapshot resync; the
          // skeleton logs loudly — this should be a <0.1% event (§40).
          console.error(`[desync] tick=${msg.tick} server=${msg.hash} local=${local}`);
        }
        break;
      }
      case "recap":
        if (session) session.recap = msg.recap;
        break;
      case "results":
        if (session) session.results = msg.results;
        break;
      case "error":
        console.error("[server]", msg.message);
        break;
    }
  };
}
