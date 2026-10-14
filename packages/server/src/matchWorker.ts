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
  matchXp,
  matchRelics,
  updateFFA,
  newRating,
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
  type MatchRecap,
  archetypeIds,
  type SkinLoadout,
} from "@flock/sim";
import type { ServerMsg, WirePlayer, MatchResult } from "./protocol.js";
import { moderateChat } from "./moderation.js";

const RATE_LIMIT_PER_SEC = 20;
/** Bot archetype pool: every registered cult (registration order — deterministic). */
const ARCHETYPES = archetypeIds();

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
  /** persistent account behind this seat (guests included). */
  accountId: string;
  /** sliding-window intent counter for rate limiting */
  windowStart: number;
  windowCount: number;
}

/** Reported to the Lobby Director at END so it can persist results (§34). */
export interface MatchEndInfo {
  matchId: string;
  seed: number;
  durationTicks: number;
  winnerPlayerId: number;
  recap: MatchRecap;
  results: MatchResult[];
  /** playerId → accountId for every human seat (bots excluded). */
  accountOf: Map<number, string>;
  replay: { seed: number; finalHash: string; turns: Turn[] };
}

export class MatchWorker {
  /** stable match id (the lobby assigns one; defaults to the seed). */
  matchId: string;
  /** max human seats before the lobby opens a new match. */
  readonly capacity: number;
  private onEnd: ((info: MatchEndInfo) => void) | null = null;
  private readonly accountOf = new Map<number, string>();
  private readonly startedAt = Date.now();
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
  /** solo-game pause (client-requested; auto-resumes when a second human joins) */
  private paused = false;
  /** ticks spent holding the founding gate for unplaced humans */
  private foundingHeld = 0;
  private readonly foundingTicksTotal: number;
  /** replay = seed + every Turn (§33: replays are just intent logs) */
  private readonly replayTurns: Turn[] = [];

  /** Private room: joinable only by code, never by public matchmaking. */
  readonly isPrivate: boolean;
  readonly roomCode: string;

  constructor(
    balanceRaw: RawBalance,
    seed: number,
    worldSize = 96,
    botCount = 0,
    foundingTicks = 200,
    churchCount = 0,
    capacity = 4,
    extra: {
      isPrivate?: boolean;
      roomCode?: string;
      townType?: string;
      disableCouriers?: boolean;
      disableCPA?: boolean;
      disableSchisms?: boolean;
    } = {},
  ) {
    this.balanceRaw = balanceRaw;
    this.balance = loadBalance(balanceRaw);
    this.seed = seed;
    this.matchId = `m_${(seed >>> 0).toString(36)}`;
    this.isPrivate = extra.isPrivate ?? false;
    this.roomCode = extra.roomCode ?? "";
    this.foundingTicksTotal = Math.max(1, foundingTicks);
    this.capacity = Math.min(4, capacity); // hard cap: 4 cults per town (§18 rev.)
    // Validate the archetype knob: a typo'd/hostile ?town= param falls back to
    // "farm" rather than silently generating a broken world.
    const TOWN_TYPES = ["farm", "oceanside", "desert", "mountain", "lakeside"] as const;
    const townType = (TOWN_TYPES as readonly string[]).includes(extra.townType ?? "farm")
      ? (extra.townType as (typeof TOWN_TYPES)[number])
      : "farm";
    // Separate RNG streams: seedSlice feeds the sim's randomness through the
    // turn stream (replays stay pure intent logs, §33); botRng drives Drifter
    // decisions, which also enter the turn stream as plain intents.
    this.turnRng = seedRng(seed ^ 0x5eed51de);
    this.botRng = seedRng(seed ^ 0xb07b07);
    this.sim = createSim({
      seed,
      balance: this.balance,
      world: generateWorld(seed, worldSize, worldSize, {
        // user-configurable biomes (§2 rev. 3): FLOCK_BIOMES="desert,forest",
        // "none" for pure temperate; unset = both accents enabled
        biomes:
          process.env.FLOCK_BIOMES === "none"
            ? []
            : ((process.env.FLOCK_BIOMES?.split(",").map((b) => b.trim()) as ("desert" | "forest")[] | undefined) ??
              ["desert", "forest"]),
        // town archetype (§2A): private hosts can pick the world type (validated above)
        townType,
      }),
      spawns: [],
      foundingTicks, // FOUNDING spawn-pick window (§18)
      disableCouriers: extra.disableCouriers ?? false,
      disableCPA: extra.disableCPA ?? false,
      disableSchisms: extra.disableSchisms ?? false,
    });
    // Established Churches first (they want their pre-seed expansion early),
    // then Drifter backfill fills the rest of the lobby.
    for (let i = 0; i < churchCount; i++) this.addChurch();
    for (let i = 0; i < botCount; i++) this.addBot();
  }

  /** The Lobby Director registers a callback to persist results at END (§34). */
  setOnEnd(cb: (info: MatchEndInfo) => void): void {
    this.onEnd = cb;
  }

  /** Live human seats (for lobby capacity decisions). */
  humanCount(): number {
    return this.clients.size;
  }
  /** A match accepts new humans until it ends or fills (founding still open). */
  isJoinable(): boolean {
    return this.sim.status === MatchStatus.Live && this.clients.size < this.capacity;
  }
  isEnded(): boolean {
    return this.sim.status === MatchStatus.Ended;
  }

  /** Attach a connecting client; assigns a player id and spawns them in. */
  addClient(ws: WebSocket, name: string, archetype: WirePlayer["archetype"], accountId = "", skin?: SkinLoadout): void {
    if (this.paused) {
      this.paused = false; // a second founder arrives: the town wakes up
      this.broadcast({ type: "paused", value: false });
    }
    const playerId = this.addPlayer(name, archetype, false, skin);
    this.clients.set(playerId, { playerId, ws, accountId, windowStart: 0, windowCount: 0 });
    if (accountId) this.accountOf.set(playerId, accountId);

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
    const playerId = this.addPlayer(name, archetype, true);
    this.bots.push({
      playerId,
      tier,
      cadence: 10 + nextRange(this.botRng, 8), // sharper than Drifters/Sects
      aggression,
      grudge: 0,
    });
    // v3: the major founds like everyone else (compound + flock via the
    // founding-gate auto-place) and establishes by sending missions — no
    // pre-seeded territory. Its aggression prior does the rest.
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
  private addPlayer(name: string, archetype: WirePlayer["archetype"], autoSpawn: boolean, skin?: SkinLoadout): number {
    const playerId = this.nextPlayerId++;
    this.roster.push({
      id: playerId,
      name,
      archetype,
      ...(autoSpawn ? { bot: true } : {}),
      ...(skin && skin.livery ? { skin } : {}),
    });
    // Players enter the sim via the same door as everyone: an intent in the
    // turn stream. Late join == late spawn, deterministically.
    this.sim.players.push(newPlayer(playerId, archetype, this.balance));
    // Humans pick a spawn during FOUNDING (§18) by clicking; bots (and humans
    // joining a live match) are placed immediately. A human who arrives once
    // the founding window has already ticked to its final hold (<=1) missed
    // the window — auto-place them so they can NEVER extend the founding gate
    // (the gate only waits for founders present during the real window).
    if (autoSpawn || this.sim.foundingTicksLeft <= 1) {
      const spawnTile = spawnTileFor(this.sim.world, this.roster.length - 1);
      this.pending.push({ t: IntentType.SPAWN, player: playerId, tile: spawnTile });
    }
    return playerId;
  }

  private onMessage(playerId: number, raw: string): void {
    const slot = this.clients.get(playerId);
    if (!slot) return;

    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg !== "object" || msg === null) return;
    const type = (msg as { type?: string }).type;

    // Control messages (resync/pause/resume) are meta, not gameplay intents —
    // handle them BEFORE the intent rate limit so a burst of them can't starve
    // a player's real actions (§33).
    // Desync recovery: a client whose StateHash diverged asks for a fresh
    // authoritative snapshot and re-mirrors from there.
    if (type === "resync") {
      this.send(slot.ws, { type: "snapshot", snapshot: toSnapshot(this.sim), players: this.roster });
      return;
    }
    // PAUSE (solo vs bots only): the lockstep clock stops for one human
    if (type === "pause" || type === "resume") {
      if (this.clients.size === 1 && this.sim.status === MatchStatus.Live) {
        this.paused = type === "pause";
        this.broadcast({ type: "paused", value: this.paused });
      }
      return;
    }
    if (type !== "intent") return;

    // Rate limit: 20 intents/sec/client (§33). Only real intents count.
    const now = Date.now();
    if (now - slot.windowStart >= 1000) {
      slot.windowStart = now;
      slot.windowCount = 0;
    }
    if (++slot.windowCount > RATE_LIMIT_PER_SEC) return; // drop + (telemetry later)

    const intent = (msg as { intent?: Intent }).intent;
    if (!intent || typeof intent.t !== "string") return;

    // CHAT is relayed by the server (never simulated), moderated on the way out.
    if (intent.t === IntentType.CHAT) {
      const chat = intent as Extract<Intent, { t: typeof IntentType.CHAT }>;
      const { allowed, text } = moderateChat(chat.msg ?? "");
      if (allowed) this.broadcast({ type: "chat", from: playerId, channel: chat.channel ?? "all", msg: text });
      return;
    }

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
    if (this.paused) return; // solo pause: the town holds still
    // FOUNDING window edge: bots break ground now; HUMANS hold the gate —
    // the match will not begin until every player has placed (sim holds the
    // countdown at 1). An AFK human is auto-placed after a 2× backstop so a
    // lobby can never be held hostage.
    if (this.sim.foundingTicksLeft === 1) {
      const humanIds = new Set(this.clients.keys());
      if (!this.autoPlaced) {
        this.autoPlaced = true;
        for (let i = 0; i < this.sim.players.length; i++) {
          const p = this.sim.players[i]!;
          if (!p.spawned && !humanIds.has(p.id)) {
            this.pending.push({ t: IntentType.SPAWN, player: p.id, tile: spawnTileFor(this.sim.world, i) });
          }
        }
      }
      this.foundingHeld++;
      if (this.foundingHeld > this.foundingTicksTotal * 2) {
        for (let i = 0; i < this.sim.players.length; i++) {
          const p = this.sim.players[i]!;
          if (!p.spawned) {
            this.pending.push({ t: IntentType.SPAWN, player: p.id, tile: spawnTileFor(this.sim.world, i) });
          }
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
      const results = this.computeResults();
      this.broadcast({ type: "recap", recap });
      this.broadcast({ type: "results", results });
      const replay = { seed: this.seed, finalHash: hashState(this.sim), turns: this.replayTurns };
      this.writeReplay();
      // Hand the result to the Lobby Director for durable persistence (§34).
      this.onEnd?.({
        matchId: this.matchId,
        seed: this.seed,
        durationTicks: this.sim.tick,
        winnerPlayerId: this.sim.winner,
        recap,
        results,
        accountOf: new Map(this.accountOf),
        replay,
      });
      this.stop(); // the match is over; release the tick loop
    }
  }

  /**
   * Post-match XP/Relic ticker (§22) + provisional ranked delta (§20). Final
   * placement = winner first, then spawned players by tiles held. XP/Relics are
   * exact per-match values; ratings are provisional from a 1500 baseline since
   * persisted ratings live in the accounts service (§34), not the match worker.
   */
  private computeResults(): MatchResult[] {
    const ranked = this.sim.players
      .filter((p) => p.spawned)
      .sort((a, b) => {
        if (a.id === this.sim.winner) return -1;
        if (b.id === this.sim.winner) return 1;
        return b.ownedTiles - a.ownedTiles;
      });
    const playerCount = ranked.length;
    const newRatings = updateFFA(ranked.map(() => newRating()));
    return ranked.map((p, i): MatchResult => {
      // we don't persist per-player elimination ticks; alive players survived
      // the whole match, eliminated ones get a half-match approximation.
      const survivedTicks = p.alive ? this.sim.tick : Math.floor(this.sim.tick * 0.5);
      const outcome = { survivedTicks, placement: i + 1, playerCount, firstWinOfDay: false };
      return {
        player: p.id,
        placement: i + 1,
        xp: matchXp(outcome),
        relics: matchRelics(outcome),
        provisionalRating: Math.round(newRatings[i]!.rating),
      };
    });
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
      const intents = botTurn(this.sim, bot, this.botRng, this.balance);
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

  // Property start (§18 rev.): spawn on OPEN LAND with the town in reach —
  // spiral to the nearest unclaimed grass tile that has citizen lots within
  // compound-outreach range, so the first fronts can actually press something.
  const citizenNear = (t: number, reach: number): boolean => {
    const tx = t % w.width;
    const ty = (t / w.width) | 0;
    for (let dy = -reach; dy <= reach; dy++) {
      const y = ty + dy;
      if (y < 0 || y >= w.height) continue;
      for (let dx = -reach; dx <= reach; dx++) {
        const x = tx + dx;
        if (x < 0 || x >= w.width) continue;
        if (w.terrain[y * w.width + x] === Terrain.Citizen) return true;
      }
    }
    return false;
  };
  for (let radius = 0; radius < Math.max(w.width, w.height); radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 2 || y < 2 || x >= w.width - 2 || y >= w.height - 2) continue;
        const t = y * w.width + x;
        if (w.terrain[t] === Terrain.Grass && w.property[t] === 0 && citizenNear(t, 9)) return t;
      }
    }
  }
  return y0 * w.width + x0;
}
