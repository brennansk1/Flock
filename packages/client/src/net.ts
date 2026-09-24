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
  type ArchetypeId,
  type SkinLoadout,
} from "@flock/sim";

// Protocol message shapes (kept in sync with @flock/server/src/protocol.ts;
// will move to a shared package when the protocol stabilizes).
export interface WirePlayer {
  id: number;
  name: string;
  archetype: ArchetypeId;
  /** true for AI seats — used for the solo-pause affordance. */
  bot?: boolean;
  /** Cosmetic loadout (render-only). */
  skin?: SkinLoadout;
}
export interface WireAccount {
  id: string;
  name: string;
  guest: boolean;
  level: number;
  relics: number;
  rating: number;
  tier: string;
}
type ServerMsg =
  | { type: "auth"; token: string; account: WireAccount }
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
  | { type: "snapshot"; snapshot: Snapshot; players: WirePlayer[] }
  | { type: "chat"; from: number; channel: string; msg: string }
  | { type: "recap"; recap: MatchRecap }
  | { type: "results"; results: MatchResult[] }
  | { type: "error"; message: string }
  | { type: "room"; code: string }
  | { type: "paused"; value: boolean };

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
  /** the authenticated account (guest or linked), from the auth handshake. */
  account?: WireAccount;
  /** rolling chat log (server-moderated). */
  chat: { from: number; msg: string }[];
  /** filled by the server at END (§25) */
  recap?: MatchRecap;
  /** filled by the server at END (§20/§22) */
  results?: MatchResult[];
  sendIntent(intent: ClientIntent): void;
  sendChat(msg: string): void;
  /** solo-vs-bots pause (server-confirmed via the `paused` message). */
  paused: boolean;
  sendPause(value: boolean): void;
}

/** A locally-authored intent waiting to be confirmed by a server Turn. */
interface PendingIntent {
  intent: Intent;
  /** confirmed tick at which it was authored; aged out once a later Turn lands. */
  authoredTick: number;
}

/** Connection lifecycle hooks for the loading screen / error surfacing. */
export interface ConnectHooks {
  onError?(message: string): void;
  onClose?(): void;
}

/** Persist the session token so a returning player resumes their account. */
const TOKEN_KEY = "flock.session";
function withToken(url: string): string {
  try {
    const tok = localStorage.getItem(TOKEN_KEY);
    if (tok && !/[?&]token=/.test(url)) return url + (url.includes("?") ? "&" : "?") + `token=${encodeURIComponent(tok)}`;
  } catch {
    /* storage unavailable (private mode) — fall back to guest */
  }
  return url;
}

export function connect(url: string, onReady: (g: GameSession) => void, hooks: ConnectHooks = {}): void {
  const ws = new WebSocket(withToken(url));
  let session: GameSession | null = null;
  let pendingAccount: WireAccount | null = null;
  let lastResyncAt = 0;
  ws.onerror = () => hooks.onError?.("connection failed");
  ws.onclose = () => hooks.onClose?.();

  // The authority: advanced only by server Turns, hashed for desync checks.
  let confirmed: SimState | null = null;
  // Local intents not yet reflected in a confirmed Turn (the prediction set).
  const pending: PendingIntent[] = [];

  /**
   * Point the rendered sim at the freshly-confirmed state, then (only if the
   * player has intents in flight) replay them on a clone so their own actions
   * show instantly. The common case — no pending intents — renders `confirmed`
   * directly with zero copies, so the snapshot round-trip cost is paid only
   * while the player is actively acting.
   */
  const rebuildPrediction = (): void => {
    if (!session || !confirmed) return;
    if (pending.length === 0) {
      session.sim = confirmed; // fast path: no prediction needed
      return;
    }
    const predicted = fromSnapshot(toSnapshot(confirmed));
    step(
      predicted,
      { n: confirmed.tick, intents: pending.map((p) => p.intent), seedSlice: 0 },
      session.balance,
    );
    session.sim = predicted;
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string) as ServerMsg;
    switch (msg.type) {
      case "auth": {
        // Persist the session token (so RETRY/return resumes the account) and
        // stash the summary to attach when the match session is created.
        try {
          localStorage.setItem(TOKEN_KEY, msg.token);
        } catch {
          /* ignore */
        }
        pendingAccount = msg.account;
        if (session) session.account = msg.account;
        break;
      }
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
          chat: [],
          paused: false,
          sendPause: (value: boolean) => ws.send(JSON.stringify({ type: value ? "pause" : "resume" })),
          ...(pendingAccount ? { account: pendingAccount } : {}),
          sendIntent: (intent) => {
            const full = { ...intent, player: msg.playerId } as Intent;
            ws.send(JSON.stringify({ type: "intent", intent: full }));
            // predict immediately: stash it and fold it into the rendered sim
            if (confirmed) pending.push({ intent: full, authoredTick: confirmed.tick });
            rebuildPrediction();
          },
          sendChat: (text: string) => ws.send(JSON.stringify({ type: "intent", intent: { t: "CHAT", player: msg.playerId, channel: "all", msg: text } })),
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
          // Desync (§33): request a fresh authoritative snapshot and re-mirror.
          // Debounced so a streak of bad hashes triggers one recovery, not a
          // flood. Should be a <0.1% event (§40).
          console.error(`[desync] tick=${msg.tick} server=${msg.hash} local=${local} — requesting resync`);
          const now = Date.now();
          if (now - lastResyncAt > 2000) {
            lastResyncAt = now;
            ws.send(JSON.stringify({ type: "resync" }));
          }
        }
        break;
      }
      case "snapshot": {
        // Resync recovery: replace the authority with the server snapshot and
        // drop any in-flight predictions (they're superseded).
        if (!session) break;
        confirmed = fromSnapshot(msg.snapshot);
        session.players = [...msg.players];
        pending.length = 0;
        rebuildPrediction();
        break;
      }
      case "chat": {
        if (session) {
          session.chat.push({ from: msg.from, msg: msg.msg });
          if (session.chat.length > 50) session.chat.shift();
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
        hooks.onError?.(msg.message);
        break;
      case "paused":
        if (session) session.paused = msg.value;
        break;
      case "room": {
        // surface the invite code in the chat log (renders in the HUD feed)
        session?.chat.push({ from: 0, msg: `Private room — invite code: ${msg.code}` });
        try {
          sessionStorage.setItem("flock.room", msg.code);
        } catch {
          /* ignore */
        }
        break;
      }
    }
  };
}
