/**
 * Match Worker (§32–33): one match, one authoritative lockstep loop.
 *
 * Every tick_ms (100 ms):
 *   1. drain the validated intent queue into a Turn{n, intents, seedSlice}
 *   2. step the authoritative sim with that Turn
 *   3. broadcast the Turn to every connected client (they run the same sim)
 *   4. every hash_every_turns, broadcast the StateHash for desync detection
 *
 * Rate limiting (20 intents/s/client, §33) happens at enqueue. Validation
 * beyond shape (ownership, costs, ranges) is the sim's job — applyIntent is
 * defensive by construction, so a hostile intent is at worst a no-op.
 */

import type { WebSocket } from "ws";
import {
  createSim,
  createWorld,
  step,
  hashState,
  loadBalance,
  seedRng,
  nextU32,
  fromInt,
  toSnapshot,
  IntentType,
  type Balance,
  type RawBalance,
  type SimState,
  type Intent,
  type Turn,
  type World,
  type RngState,
} from "@flock/sim";
import type { ServerMsg, WirePlayer } from "./protocol.js";

const RATE_LIMIT_PER_SEC = 20;

interface ClientSlot {
  playerId: number;
  ws: WebSocket;
  /** sliding-window intent counter for rate limiting */
  windowStart: number;
  windowCount: number;
}

export class MatchWorker {
  private readonly balanceRaw: RawBalance;
  private readonly balance: Balance;
  private readonly seed: number;
  private readonly sim: SimState;
  private readonly turnRng: RngState;
  private readonly clients = new Map<number, ClientSlot>();
  private readonly roster: WirePlayer[] = [];
  private readonly pending: Intent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextPlayerId = 1;

  constructor(balanceRaw: RawBalance, seed: number, worldSize = 64) {
    this.balanceRaw = balanceRaw;
    this.balance = loadBalance(balanceRaw);
    this.seed = seed;
    // Separate RNG stream for seedSlice generation — the server feeds the sim's
    // randomness through the turn stream so replays are pure intent logs (§33).
    this.turnRng = seedRng(seed ^ 0x5eed51de);
    this.sim = createSim({
      seed,
      balance: this.balance,
      world: makeTestWorld(worldSize),
      spawns: [],
    });
  }

  /** Attach a connecting client; assigns a player id and spawns them in. */
  addClient(ws: WebSocket, name: string, archetype: WirePlayer["archetype"]): void {
    const playerId = this.nextPlayerId++;
    const player: WirePlayer = { id: playerId, name, archetype };
    this.roster.push(player);

    // Players joining a live match enter the sim via the same door as everyone:
    // an intent in the turn stream. Late join == late spawn, deterministically.
    this.sim.players.push({
      id: playerId,
      archetype,
      alive: true,
      stance: "spread",
      followers: this.balance.economy.startFollowers,
      usd: this.balance.economy.startUsd,
      faith: fromInt(50),
      heat: 0,
      compounds: 1,
      ownedTiles: 0,
    });
    const w = this.sim.world;
    const spawnTile = spawnTileFor(w, this.roster.length - 1);
    this.pending.push({ t: IntentType.SPAWN, player: playerId, tile: spawnTile });

    this.clients.set(playerId, { playerId, ws, windowStart: 0, windowCount: 0 });

    this.send(ws, {
      type: "welcome",
      playerId,
      seed: this.seed,
      balance: this.balanceRaw,
      snapshot: toSnapshot(this.sim),
      players: this.roster,
    });
    this.broadcast({ type: "player_joined", player }, playerId);

    ws.on("message", (data) => this.onMessage(playerId, data.toString()));
    ws.on("close", () => this.clients.delete(playerId));

    if (!this.timer) this.start();
  }

  private onMessage(playerId: number, raw: string): void {
    const slot = this.clients.get(playerId);
    if (!slot) return;

    // Rate limit: 20 intents/sec/client (§33).
    const now = Date.now();
    if (now - slot.windowStart >= 1000) {
      slot.windowStart = now;
      slot.windowCount = 0;
    }
    if (++slot.windowCount > RATE_LIMIT_PER_SEC) return; // drop + (telemetry later)

    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (
      typeof msg !== "object" ||
      msg === null ||
      (msg as { type?: string }).type !== "intent"
    )
      return;
    const intent = (msg as { intent?: Intent }).intent;
    if (!intent || typeof intent.t !== "string") return;
    // Identity is the socket's, never the payload's.
    this.pending.push({ ...intent, player: playerId } as Intent);
  }

  private start(): void {
    this.timer = setInterval(() => this.tick(), this.balance.tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const turn: Turn = {
      n: this.sim.tick,
      intents: this.pending.splice(0, this.pending.length),
      seedSlice: nextU32(this.turnRng),
    };
    step(this.sim, turn, this.balance);
    this.broadcast({ type: "turn", turn });

    if (this.sim.tick % this.balance.hashEveryTurns === 0) {
      this.broadcast({ type: "hash", tick: this.sim.tick, hash: hashState(this.sim) });
    }
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMsg, except?: number): void {
    const data = JSON.stringify(msg);
    for (const slot of this.clients.values()) {
      if (slot.playerId === except) continue;
      if (slot.ws.readyState === slot.ws.OPEN) slot.ws.send(data);
    }
  }
}

/** Flat all-citizen test world until the mapgen tool lands (§2). */
function makeTestWorld(size: number): World {
  const w = createWorld(size, size);
  for (let i = 0; i < w.susceptibility.length; i++) w.susceptibility[i] = fromInt(50);
  return w;
}

/** Deterministic ring placement for skeleton spawns (FOUNDING UI later, §18). */
function spawnTileFor(w: World, index: number): number {
  const positions = 8;
  const angle = (index % positions) * ((2 * Math.PI) / positions);
  const r = Math.floor(Math.min(w.width, w.height) * 0.33);
  const cx = w.width >> 1;
  const cy = w.height >> 1;
  const x = Math.min(w.width - 1, Math.max(0, cx + Math.round(Math.cos(angle) * r)));
  const y = Math.min(w.height - 1, Math.max(0, cy + Math.round(Math.sin(angle) * r)));
  return y * w.width + x;
}
