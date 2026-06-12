/**
 * Client netcode (§33): connect, mirror the authoritative sim by applying the
 * server's Turn broadcasts in order, and verify StateHash when it arrives.
 *
 * M0 skeleton renders server-confirmed state (≤100 ms behind). Client-side
 * prediction + reconciliation slots in here later: predict with local intents,
 * roll back to the last confirmed turn on mismatch, replay.
 */

import {
  loadBalance,
  step,
  hashState,
  newPlayer,
  fromSnapshot,
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
  | { type: "error"; message: string };

/** Distributive Omit so the Intent union keeps its discrimination. */
type DistOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
/** What the client authors: any Intent minus `player` (the server stamps identity). */
export type ClientIntent = DistOmit<Intent, "player">;

export interface GameSession {
  sim: SimState;
  balance: Balance;
  playerId: number;
  players: WirePlayer[];
  /** filled by the server at END (§25) */
  recap?: MatchRecap;
  sendIntent(intent: ClientIntent): void;
}

export function connect(url: string, onReady: (g: GameSession) => void): void {
  const ws = new WebSocket(url);
  let session: GameSession | null = null;

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string) as ServerMsg;
    switch (msg.type) {
      case "welcome": {
        const balance = loadBalance(msg.balance);
        // Joining IS the resync path: restore the authoritative snapshot and
        // mirror every Turn from here on.
        const sim = fromSnapshot(msg.snapshot);
        session = {
          sim,
          balance,
          playerId: msg.playerId,
          players: [...msg.players],
          sendIntent: (intent) =>
            ws.send(JSON.stringify({ type: "intent", intent: { ...intent, player: msg.playerId } })),
        };
        onReady(session);
        break;
      }
      case "player_joined": {
        if (!session) break;
        session.players.push(msg.player);
        // Same factory as the server — initial player state defined once.
        session.sim.players.push(
          newPlayer(msg.player.id, msg.player.archetype, session.balance),
        );
        break;
      }
      case "turn": {
        if (!session) break;
        step(session.sim, msg.turn, session.balance);
        break;
      }
      case "hash": {
        if (!session) break;
        const local = hashState(session.sim);
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
      case "error":
        console.error("[server]", msg.message);
        break;
    }
  };
}
