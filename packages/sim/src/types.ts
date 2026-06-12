/**
 * Core simulation types (Part II). All gameplay scalars that participate in sim
 * math are stored as Fixed (Q16.16). Counts and ids are plain integers.
 */

import type { Fixed } from "./fixed.js";
import type { RngState } from "./rng.js";

export type PlayerId = number; // 0 = neutral / no owner
export type TileId = number; // index into the flat tile arrays
export type DistrictId = number;

export const NEUTRAL: PlayerId = 0;

/** Stance posture (§5). */
export const Stance = {
  Tend: "tend",
  Spread: "spread",
  Crusade: "crusade",
} as const;
export type Stance = (typeof Stance)[keyof typeof Stance];

/** Citizen tile lifecycle (§1). */
export const TileState = {
  Neutral: 0,
  Believer: 1,
  Apostate: 2,
} as const;
export type TileState = (typeof TileState)[keyof typeof TileState];

/** Terrain classes (§1). Citizen tiles use `Citizen`. */
export const Terrain = {
  Citizen: 0,
  Woods: 1,
  Lake: 2,
  Road: 3,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

export const District = {
  Suburbs: "suburbs",
  College: "college",
  Downtown: "downtown",
  OldTown: "old_town",
  Trailer: "trailer",
} as const;
export type District = (typeof District)[keyof typeof District];

/**
 * The world grid. Tile attributes are kept in parallel typed arrays (struct of
 * arrays) so the sim can iterate hot loops cache-friendly and snapshot/hash
 * cheaply. All Fixed-valued fields are Int32Array of Q16.16 values.
 */
/** District coefficient row (§2, authoritative table). All Fixed. */
export interface DistrictCoeffs {
  conv: Fixed;
  retain: Fixed;
  income: Fixed;
}

export interface World {
  width: number;
  height: number;
  /** Terrain class per tile. */
  terrain: Uint8Array;
  /** TileState per tile. */
  state: Uint8Array;
  /** Owning player per tile (0 = neutral). */
  owner: Uint32Array;
  /** Hidden susceptibility S, 0..100 as Fixed. */
  susceptibility: Int32Array;
  /** Dissent 0..100 as Fixed. */
  dissent: Int32Array;
  /** Apostate-scar remaining ticks (0 = not scarred). */
  scarTicks: Uint16Array;
  /** District membership per tile. */
  district: Uint32Array;
  /** Coefficient row per district id (§2). Index 0 is the 1.0/1.0/1.0 default. */
  districtCoeffs: DistrictCoeffs[];
}

/**
 * An active Front (§4): a player's committed push into a target region. The
 * tile list is kept sorted ascending so every machine iterates identically.
 */
export interface Front {
  id: number;
  player: PlayerId;
  tiles: TileId[];
}

/** Per-player runtime state (§3). */
export interface PlayerState {
  id: PlayerId;
  archetype: "dawn" | "radiant" | "circle" | "visitors";
  alive: boolean;
  stance: Stance;
  followers: Fixed;
  usd: Fixed;
  faith: Fixed; // 0..100
  heat: Fixed; // 0..100
  compounds: number;
  ownedTiles: number;
  /** has this player picked a spawn yet? (elimination requires having lived) */
  spawned: boolean;
  /** remaining cooldown ticks per ritual/ability id; absent = ready */
  cooldowns: Record<string, number>;
  /** Sermon's +5% conversion buff, remaining ticks (§9) */
  sermonBuffTicks: number;
  /** Day of Atonement: dissent decay ×4, own fronts frozen, remaining ticks (§9) */
  atonementTicks: number;
  /** Final Dawn: Prophecy Countdown is once per match (§11.1) */
  prophecyUsed: boolean;
}

/** Street Prophet pylon (§11.1): 40-follower-equivalent pressure, radius 2. */
export interface Pylon {
  player: PlayerId;
  tile: TileId;
  ticksLeft: number;
}

/** Stockpile Sermon (§11.1): attacker's pressure ×3 in one district. */
export interface DistrictBuff {
  player: PlayerId;
  district: DistrictId;
  ticksLeft: number;
}

/** Midnight Festival aura (§9): 2× neutral conversion in a radius. */
export interface Aura {
  player: PlayerId;
  tile: TileId;
  radius: number;
  ticksLeft: number;
}

/** A live Prophecy Countdown (§11.1): public timer + territory snapshot. */
export interface Prophecy {
  player: PlayerId;
  /** owned-tiles per-mille of populated tiles at declaration */
  snapshotPermille: number;
  ticksLeft: number;
}

/** Match lifecycle (§18). LIVE phases are emergent, not scripted. */
export const MatchStatus = {
  Live: 0,
  Ended: 1,
} as const;
export type MatchStatus = (typeof MatchStatus)[keyof typeof MatchStatus];

/**
 * Per-tile, per-attacker conversion progress (§4: `conv_progress per attacker`).
 * Key = tile * PROGRESS_STRIDE + attackerId; value = accumulated pressure as
 * Fixed. Iterated in sorted-key order wherever order matters (hashing, flips).
 */
export type ProgressMap = Map<number, Fixed>;

/** Key stride for ProgressMap. Player ids must stay below this. */
export const PROGRESS_STRIDE = 1024;

/** The complete, serializable simulation state. Hashing this == StateHash (§33). */
export interface SimState {
  tick: number;
  rng: RngState;
  world: World;
  players: PlayerState[];
  fronts: Front[];
  nextFrontId: number;
  progress: ProgressMap;
  /** count of citizen tiles — the victory-balance unit (§1) */
  populated: number;
  /** domination threshold in per-mille of populated tiles (§1: 72% / 80%) */
  dominationPermille: number;
  /** match timer in ticks; 0 = untimed */
  timerTicks: number;
  status: MatchStatus;
  /** winning player id once status is Ended; 0 = none yet */
  winner: PlayerId;
  pylons: Pylon[];
  districtBuffs: DistrictBuff[];
  auras: Aura[];
  prophecies: Prophecy[];
}
