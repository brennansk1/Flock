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
  botTurn,
  botShouldAct,
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
  type BotState,
  type BotTier,
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

/** Established Church proper-noun grammar (§21): map-fixture majors. */
const CHURCH_NAMES = [
  "The First Church of the Open Wallet",
  "Tabernacle of the Reasonable Price",
  "The Reformed Order of Punctual Salvation",
  "Cathedral of the Second Opinion",
  "The Congregation of Acceptable Outcomes",
  "Holy Temple of the Extended Warranty",
  "The Brethren of the Bottomless Casserole",
  "Sanctuary of the Mildly Inconvenient Truth",
];

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
  private readonly botRng: RngState;
  private readonly clients = new Map<number, ClientSlot>();
  private readonly roster: WirePlayer[] = [];
  private readonly pending: Intent[] = [];
  private readonly bots: BotState[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextPlayerId = 1;
  private endedAnnounced = false;
  private autoPlaced = false;
  /** replay = seed + every Turn (§33: replays are just intent logs) */
  private readonly replayTurns: Turn[] = [];

  constructor(
    balanceRaw: RawBalance,
    seed: number,
    worldSize = 96,
    botCount = 0,
    foundingTicks = 200,
    churchCount = 0,
  ) {
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
    // Established Churches first (they want their pre-seed expansion early),
    // then Drifter backfill fills the rest of the lobby.
    for (let i = 0; i < churchCount; i++) this.addChurch();
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
    this.bots.push({
      playerId,
      tier: "drifter",
      cadence: 25 + nextRange(this.botRng, 30),
      aggression: 0,
      grudge: 0,
    });
    this.broadcast({ type: "player_joined", player: this.roster[this.roster.length - 1]! });
  }

  /**
   * Add an Established Church (§21): a major with a proper noun, a tighter
   * decision cadence (the difficulty knob is latency, never stat cheats), a
   * high aggression prior, and a pre-seed territory blob expanded out from its
   * spawn — all entered through the turn stream so replays stay faithful.
   */
  addChurch(tier: BotTier = "church", aggression = 2): void {
    const name = CHURCH_NAMES[nextRange(this.botRng, CHURCH_NAMES.length)]!;
    const archetype = ARCHETYPES[nextRange(this.botRng, ARCHETYPES.length)]!;
    const idx = this.roster.length;
    const playerId = this.addPlayer(name, archetype, true);
    this.bots.push({
      playerId,
      tier,
      cadence: 10 + nextRange(this.botRng, 8), // sharper than Drifters/Sects
      aggression,
      grudge: 0,
    });
    // Pre-seed territory: a ring of OPEN_FRONT around the spawn so the major
    // starts the match already established (intents, not a direct world poke).
    const spawn = spawnTileFor(this.sim.world, idx);
    const w = this.sim.world;
    const sx = spawn % w.width;
    const sy = (spawn / w.width) | 0;
    const seedTiles: number[] = [];
    for (let oy = -4; oy <= 4; oy++) {
      for (let ox = -4; ox <= 4; ox++) {
        const x = sx + ox;
        const y = sy + oy;
        if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
        seedTiles.push(y * w.width + x);
      }
    }
    this.pending.push({ t: IntentType.OPEN_FRONT, player: playerId, tiles: seedTiles });
    this.broadcast({ type: "player_joined", player: this.roster[this.roster.length - 1]! });
  }

  /** Promote a Sect-tier bot (utility AI), used for unclaimed splinter sects. */
  addSect(): void {
    const name = `${BOT_FIRST[nextRange(this.botRng, BOT_FIRST.length)]} ${
      BOT_SECOND[nextRange(this.botRng, BOT_SECOND.length)]
    }`;
    const archetype = ARCHETYPES[nextRange(this.botRng, ARCHETYPES.length)]!;
    const playerId = this.addPlayer(name, archetype, true);
    this.bots.push({
      playerId,
      tier: "sect",
      cadence: 18 + nextRange(this.botRng, 16),
      aggression: 1,
      grudge: 0,
    });
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
   * Run every bot brain whose cadence is up (§21). The decision logic lives in
   * @flock/sim's shared `botTurn` (Drifter / Sect / Established Church tiers) so
   * it is unit-tested in the sim package; the worker only feeds its botRng and
   * queues the produced intents into the turn stream.
   */
  private runBots(): void {
    for (const bot of this.bots) {
      if (!botShouldAct(bot, this.sim.tick)) continue;
      const intents = botTurn(this.sim, bot, this.botRng);
      for (const intent of intents) this.pending.push(intent);
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
