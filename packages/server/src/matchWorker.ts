/**
 * Match Worker (§32–33): one match, one authoritative lockstep loop.
 *
 * Every tick_ms (100 ms):
 *   1. run bot brains (Drifters §21) — their intents enter the same queue
 *   2. drain the validated intent queue into a Turn{n, intents, seedSlice}
 *   3. step the authoritative sim with that Turn
 *   4. broadcast the Turn to every connected client (they run the same sim)
 *   5. every hash_every_turns, broadcast the StateHash for desync detection
 *
 * Rate limiting (20 intents/s/client, §33) happens at enqueue. Validation
 * beyond shape (ownership, costs, ranges) is the sim's job — applyIntent is
 * defensive by construction, so a hostile intent is at worst a no-op. Bots get
 * zero fog exemptions and zero stat cheats: they act through the Intent API
 * exactly like humans (§21 "zero cheating by construction").
 */

import type { WebSocket } from "ws";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  createSim,
  newPlayer,
  generateWorld,
  step,
  hashState,
  loadBalance,
  seedRng,
  nextU32,
  nextRange,
  toSnapshot,
  generateRecap,
  IntentType,
  Terrain,
  MatchStatus,
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
const ARCHETYPES = ["dawn", "radiant", "circle", "visitors"] as const;

/** Drifter name generator (§21): a silly two-part grammar. */
const BOT_FIRST = [
  "Gary's", "Doreen's", "The Backyard", "Pond", "Greater Mundane", "Roadside",
  "Discount", "Twilight", "The Second", "Humble", "Almost Certain", "Parking Lot",
];
const BOT_SECOND = [
  "Truthers", "Pilgrims", "Awakening", "Fellowship", "Listeners", "Assembly",
  "Choir", "Seekers", "Witnesses", "Potluck", "Revival", "Study Group",
];

interface ClientSlot {
  playerId: number;
  ws: WebSocket;
  /** sliding-window intent counter for rate limiting */
  windowStart: number;
  windowCount: number;
}

interface Bot {
  playerId: number;
  /** ticks between decisions, with per-bot phase offset */
  cadence: number;
}

export class MatchWorker {
  private readonly balanceRaw: RawBalance;
  private readonly balance: Balance;
  private readonly seed: number;
  private readonly sim: SimState;
  private readonly turnRng: RngState;
  private readonly botRng: RngState;
  private readonly clients = new Map<number, ClientSlot>();
  private readonly roster: WirePlayer[] = [];
  private readonly pending: Intent[] = [];
  private readonly bots: Bot[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextPlayerId = 1;
  private endedAnnounced = false;
  private autoPlaced = false;
  /** replay = seed + every Turn (§33: replays are just intent logs) */
  private readonly replayTurns: Turn[] = [];

  constructor(balanceRaw: RawBalance, seed: number, worldSize = 96, botCount = 0, foundingTicks = 200) {
    this.balanceRaw = balanceRaw;
    this.balance = loadBalance(balanceRaw);
    this.seed = seed;
    // Separate RNG streams: seedSlice feeds the sim's randomness through the
    // turn stream (replays stay pure intent logs, §33); botRng drives Drifter
    // decisions, which also enter the turn stream as plain intents.
    this.turnRng = seedRng(seed ^ 0x5eed51de);
    this.botRng = seedRng(seed ^ 0xb07b07);
    this.sim = createSim({
      seed,
      balance: this.balance,
      world: generateWorld(seed, worldSize, worldSize),
      spawns: [],
      foundingTicks, // FOUNDING spawn-pick window (§18)
    });
    for (let i = 0; i < botCount; i++) this.addBot();
  }

  /** Attach a connecting client; assigns a player id and spawns them in. */
  addClient(ws: WebSocket, name: string, archetype: WirePlayer["archetype"]): void {
    const playerId = this.addPlayer(name, archetype, false);
    this.clients.set(playerId, { playerId, ws, windowStart: 0, windowCount: 0 });

    this.send(ws, {
      type: "welcome",
      playerId,
      seed: this.seed,
      balance: this.balanceRaw,
      snapshot: toSnapshot(this.sim),
      players: this.roster,
    });
    this.broadcast({ type: "player_joined", player: this.roster[this.roster.length - 1]! }, playerId);

    ws.on("message", (data) => this.onMessage(playerId, data.toString()));
    ws.on("close", () => this.clients.delete(playerId));

    if (!this.timer) this.start();
  }

  /** Add a Drifter bot (§21): backfill AI playing through the Intent API. */
  addBot(): void {
    const name = `${BOT_FIRST[nextRange(this.botRng, BOT_FIRST.length)]} ${
      BOT_SECOND[nextRange(this.botRng, BOT_SECOND.length)]
    }`;
    const archetype = ARCHETYPES[nextRange(this.botRng, ARCHETYPES.length)]!;
    const playerId = this.addPlayer(name, archetype, true);
    this.bots.push({ playerId, cadence: 25 + nextRange(this.botRng, 30) });
    this.broadcast({ type: "player_joined", player: this.roster[this.roster.length - 1]! });
  }

  /** Shared join path: roster + sim player + SPAWN through the turn stream. */
  private addPlayer(name: string, archetype: WirePlayer["archetype"], autoSpawn: boolean): number {
    const playerId = this.nextPlayerId++;
    this.roster.push({ id: playerId, name, archetype });
    // Players enter the sim via the same door as everyone: an intent in the
    // turn stream. Late join == late spawn, deterministically.
    this.sim.players.push(newPlayer(playerId, archetype, this.balance));
    // Humans pick a spawn during FOUNDING (§18) by clicking; bots (and humans
    // joining a live match) are placed immediately.
    if (autoSpawn || this.sim.foundingTicksLeft === 0) {
      const spawnTile = spawnTileFor(this.sim.world, this.roster.length - 1);
      this.pending.push({ t: IntentType.SPAWN, player: playerId, tile: spawnTile });
    }
    return playerId;
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
    if (typeof msg !== "object" || msg === null || (msg as { type?: string }).type !== "intent")
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
    // FOUNDING expiry: auto-place anyone who never clicked a spawn (§18).
    if (this.sim.foundingTicksLeft === 1 && !this.autoPlaced) {
      this.autoPlaced = true;
      for (let i = 0; i < this.sim.players.length; i++) {
        const p = this.sim.players[i]!;
        if (!p.spawned) {
          this.pending.push({ t: IntentType.SPAWN, player: p.id, tile: spawnTileFor(this.sim.world, i) });
        }
      }
    }
    if (this.sim.status === MatchStatus.Live && this.sim.foundingTicksLeft === 0) this.runBots();

    const turn: Turn = {
      n: this.sim.tick,
      intents: this.pending.splice(0, this.pending.length),
      seedSlice: nextU32(this.turnRng),
    };
    this.replayTurns.push(turn);
    step(this.sim, turn, this.balance);
    this.broadcast({ type: "turn", turn });

    if (this.sim.tick % this.balance.hashEveryTurns === 0) {
      this.broadcast({ type: "hash", tick: this.sim.tick, hash: hashState(this.sim) });
    }

    if (this.sim.status === MatchStatus.Ended && !this.endedAnnounced) {
      this.endedAnnounced = true;
      const recap = generateRecap(this.sim);
      this.broadcast({ type: "recap", recap });
      this.writeReplay();
      const w = this.roster.find((r) => r.id === this.sim.winner);
      // eslint-disable-next-line no-console
      console.log(`[match] ended at tick ${this.sim.tick}: winner ${w?.name ?? "nobody"}`);
    }
  }

  /** Replay Store (§34): gzipped intent logs in production; JSON here. */
  private writeReplay(): void {
    try {
      mkdirSync("replays", { recursive: true });
      writeFileSync(
        `replays/match-${this.seed}.json`,
        JSON.stringify({ seed: this.seed, finalHash: hashState(this.sim), turns: this.replayTurns }),
      );
    } catch {
      // replays are best-effort in the dev server
    }
  }

  /**
   * Drifter brains (§21): random-walk expansion. Every `cadence` ticks a bot
   * opens a small front in a random direction from a random owned tile. They
   * never ally, never build, never push back — they fold under pressure.
   */
  private runBots(): void {
    for (const bot of this.bots) {
      if ((this.sim.tick + bot.playerId * 7) % bot.cadence !== 0) continue;
      const p = this.sim.players.find((pl) => pl.id === bot.playerId);
      if (!p || !p.alive || !p.spawned) continue;

      const w = this.sim.world;
      // random owned tile: sample up to 30 positions
      let origin = -1;
      for (let i = 0; i < 30; i++) {
        const t = nextRange(this.botRng, w.owner.length);
        if (w.owner[t] === bot.playerId) {
          origin = t;
          break;
        }
      }
      if (origin < 0) continue;

      const dir = nextRange(this.botRng, 4);
      const dx = dir === 0 ? 3 : dir === 1 ? -3 : 0;
      const dy = dir === 2 ? 3 : dir === 3 ? -3 : 0;
      const cx = (origin % w.width) + dx;
      const cy = ((origin / w.width) | 0) + dy;
      const tiles: number[] = [];
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          const x = cx + ox;
          const y = cy + oy;
          if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
          tiles.push(y * w.width + x);
        }
      }
      if (tiles.length === 0) continue;

      // Drifters drift: mostly Spread, occasional brief Crusade.
      if (nextRange(this.botRng, 12) === 0) {
        this.pending.push({
          t: IntentType.SET_STANCE,
          player: bot.playerId,
          stance: nextRange(this.botRng, 3) === 0 ? "crusade" : "spread",
        });
      }
      this.pending.push({ t: IntentType.OPEN_FRONT, player: bot.playerId, tiles });

      // Sect-tier economy script with noise (§21): Compound → Plate → Watchtower.
      if (p.usd > 40_000 * 65536 && nextRange(this.botRng, 6) === 0) {
        const builds = ["compound", "collection_plate", "watchtower"] as const;
        this.pending.push({
          t: IntentType.BUILD,
          player: bot.playerId,
          building: builds[nextRange(this.botRng, builds.length)]!,
          tile: origin,
        });
      }
      // naive gimmick usage: rituals keep Faith healthy
      if (nextRange(this.botRng, 40) === 0) {
        this.pending.push({ t: IntentType.RITUAL, player: bot.playerId, ritual: "sermon" });
      }
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

/**
 * Deterministic ring placement nudged to the nearest citizen tile (the
 * FOUNDING spawn-pick UI replaces this, §18).
 */
function spawnTileFor(w: World, index: number): number {
  const positions = 8;
  const angle = (index % positions) * ((2 * Math.PI) / positions);
  const r = Math.floor(Math.min(w.width, w.height) * 0.33);
  const cx = w.width >> 1;
  const cy = w.height >> 1;
  const x0 = Math.min(w.width - 1, Math.max(0, cx + Math.round(Math.cos(angle) * r)));
  const y0 = Math.min(w.height - 1, Math.max(0, cy + Math.round(Math.sin(angle) * r)));

  // spiral out to the nearest citizen tile so spawns never land in a lake
  for (let radius = 0; radius < Math.max(w.width, w.height); radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
        const t = y * w.width + x;
        if (w.terrain[t] === Terrain.Citizen) return t;
      }
    }
  }
  return y0 * w.width + x0;
}
