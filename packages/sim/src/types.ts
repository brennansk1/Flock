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
}

/** The complete, serializable simulation state. Hashing this == StateHash (§33). */
export interface SimState {
  tick: number;
  rng: RngState;
  world: World;
  players: PlayerState[];
}
