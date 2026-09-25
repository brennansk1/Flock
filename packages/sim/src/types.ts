/**
 * Core simulation types (Part II). All gameplay scalars that participate in sim
 * math are stored as Fixed (Q16.16). Counts and ids are plain integers.
 */
import type { ArchetypeId } from "./archetypes/types.js";

import type { Fixed } from "./fixed.js";
import type { RngState } from "./rng.js";
import type { Street } from "./names.js";

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

/**
 * Terrain classes (§1). `Citizen` lots hold residents; `Grass` is the open
 * country around town — unconvertible (nobody lives there) but buildable:
 * cult compounds rise in the wilderness, and `Dirt` access roads
 * auto-generate to connect them to the highway. `Field` is farmland dressing.
 */
export const Terrain = {
  Citizen: 0,
  Woods: 1,
  Lake: 2,
  Road: 3,
  Grass: 4,
  Field: 5,
  Dirt: 6,
  /** Footpath/sidewalk through a block interior — walkable, unbuildable. */
  Path: 7,
  /** Orchard rows — farmland dressing, wilderness rules like Field. */
  Orchard: 8,
  /** Fenced livestock pasture — wilderness rules like Field. */
  Pasture: 9,
  /** Railroad right-of-way — unbuildable, unclaimable; ideas cross it. */
  Rail: 10,
  /**
   * Rock ridge / mountainside (Stage 2, mountain & desert archetypes):
   * unbuildable, unclaimable, unconvertible — a natural wall like open
   * water. Ideas don't cross it (conversion treats it as nature).
   */
  Rock: 11,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

/** Biome per tile (§2 rev. 3): blob overlays that reskin the open country. */
export const Biome = {
  Temperate: 0,
  Desert: 1,
  Forest: 2,
  Autumn: 3,
  /** Ocean/coast band (§2A oceanside archetype): sand shores, no willows. */
  Ocean: 4,
} as const;
export type Biome = (typeof Biome)[keyof typeof Biome];

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

/** Landmark kinds (§12). Stored per tile; 0 = none. */
export const Landmark = {
  None: 0,
  RadioTower: 1,
  Megachurch: 2,
  TownHall: 3,
  Fairground: 4,
  WaterTower: 5,
} as const;
export type Landmark = (typeof Landmark)[keyof typeof Landmark];

/**
 * Town building occupying a lot (visual + social texture; residents work and
 * shop here, and dots route to them). Multi-tile structures repeat their id
 * on each covered tile; the renderer merges shared edges.
 */
export const Lot = {
  None: 0,
  Shop: 1,
  Supermarket: 2,
  Diner: 3,
  School: 4,
  Library: 5,
  Chapel: 6,
  GasStation: 7,
  Sheriff: 8,
  Office: 9,
  Barn: 10,
  Silo: 11,
  Park: 12,
  Church: 13,
  Bank: 14,
  PostOffice: 15,
  FireStation: 16,
  Factory: 17,
  Motel: 18,
  Parking: 19,
  Cemetery: 20,
  BallField: 21,
  Cinema: 22,
  Playground: 23,
  Dock: 24,
  Greenhouse: 25,
  HighSchool: 26,
  Warehouse: 27,
  GrainElevator: 28,
  Depot: 29,
  Dam: 30,
  WaterTower: 31,
  Substation: 32,
  /** Coastal keystones (§2A oceanside archetype). */
  Lighthouse: 33,
  Cannery: 34,
  /** Timber keystone (§2A mountain archetype). */
  Sawmill: 35,
  /** Stage 2 Courthouse Square: the county courthouse filling the square's centre. */
  Courthouse: 36,
  /** Stage 2 high-school campus: cinder running track around the football field. */
  Track: 37,
  /** Stage 2 landmark compounds: the building footprint around the landmark anchor tile. */
  Megachurch: 38,
  Fairground: 39,
  RadioTower: 40,
  /** Stage 2b: stone breakwater segment out into the sea (the lighthouse stands at its end). */
  Jetty: 41,
  /** Stage 2b: the dam's powerhouse on the bank. */
  Powerhouse: 42,
} as const;
export type Lot = (typeof Lot)[keyof typeof Lot];

/** Per-tile flag bits (World.flags). */
export const TileFlag = {
  /** Prosperity Circle Downline: creep-flipped, pays 2× tithe forever (§11.3) */
  Downline: 1,
  /** Mapgen: this Field tile is part of a desert center-pivot circle (render hint only). */
  Pivot: 2,
  /** Mapgen: a lot inside the planned trailer park (render hint only: trailers draw here). */
  TrailerPark: 4,
} as const;

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
  /**
   * Residents per tile (0–15). The town is people, not acreage: victory,
   * the conversion bar, and follower flow all run on population. Houses
   * (pop ≥ 3) render as buildings; low-pop tiles are yards and gardens.
   */
  pop: Uint8Array;
  /** Town building per lot (Lot enum); houses render where 0 and pop ≥ 3. */
  lot: Uint8Array;
  /** Landmark kind per tile (§12); 0 = none. */
  landmark: Uint8Array;
  /** Ticks a Believer tile has been continuously held (Radiant Glow, §11.2). Capped. */
  holdTicks: Uint16Array;
  /** TileFlag bits per tile. */
  flags: Uint8Array;
  /** Fresh fake town name for this seed (faker corpus via names.ts). */
  townName: string;
  /** Named axis-aligned street segments (grid roads only, §2). */
  streets: Street[];
  /** Biome per tile (blob overlays; Biome enum). */
  biome: Uint8Array;
  /** Purchased-property owner per tile (0 = unowned). Gameplay layer (§18 rev). */
  property: Uint32Array;
}

/**
 * A deployed cohort (v3 missions — DESIGN_MISSIONS.md §1): a slice of the
 * flock sent to work a part of town. `mode` reuses the Stance vocabulary
 * per-sortie ("this wave is a crusade"). Mass is CONSERVED: it leaves
 * `followers` on SEND and returns when the recall completes — deployed
 * followers are a stake, not a projection.
 */
export interface Cohort {
  /** anchor tile the cohort was sent at */
  target: TileId;
  /** per-sortie mode: Spread converts, Tend holds, Crusade burns */
  mode: Stance;
  /** follower-mass committed (Q16.16) */
  mass: Fixed;
  /** ticks since dispatch (drives march-out + the M2 arrival model) */
  age: number;
  /** walking home; mass rejoins the flock when the return completes */
  recalling: boolean;
  /** ticks since recall began */
  recallAge: number;
}

/** Max concurrent cohorts — the readability cap (DESIGN_MISSIONS.md §1). */
export const MAX_COHORTS = 3;

/** Per-player runtime state (§3). */
export interface PlayerState {
  id: PlayerId;
  /** Registered archetype id (see archetypes/registry.ts). */
  archetype: ArchetypeId;
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
  /** VESTIGIAL (rituals cut, v3 M3.2b): always 0 now — kept to preserve the
   *  snapshot/hash layout; purge with the next SNAPSHOT_VERSION bump. */
  sermonBuffTicks: number;
  /** VESTIGIAL (rituals cut, v3 M3.2b): always 0 now — see sermonBuffTicks. */
  atonementTicks: number;
  /** Final Dawn: Prophecy Countdown is once per match (§11.1) */
  prophecyUsed: boolean;
  /** Doctrine (§10): picked node ids (e.g. "B1", "T4"). Irreversible. */
  doctrine: string[];
  /** Ecumenical Pact (§16): a doctrine node shared BY the ally — revoked when
   * the alliance ends. Empty string = none. */
  pactNode: string;
  /** Who granted the pact node (their ally's player id; 0 = none). */
  pactWith: PlayerId;
  /** High-water follower count — doctrine points come from milestones (§10). */
  maxFollowers: Fixed;
  /** E4 UNSHAKEABLE: one mass-apostasy negation per match (§10). */
  e4Spent: boolean;
  /** JUDAS: remaining ticks of the −50% retention shock after betraying (§16). */
  judasTicks: number;
  /** permanent match-long traitor mark (§16) */
  traitor: boolean;
  /** Exposé fallout: retention halved while > 0 (§8). */
  retentionDebuffTicks: number;
  /** Schism Risk gauge: consecutive ticks both schism conditions held (§16). */
  schismRiskTicks: number;
  /** lifetime $ earned — timer tiebreak + recap stat (§1/§25) */
  usdEarned: Fixed;
  /** Share of the town's residents who believe in this cult (‰), refreshed each tick. */
  soulsPermille: number;
  /** Exposes this cult has published this match (drives Expose price). */
  exposes: number;
  /** Victory path currently ascending ("" = none) — see victory.ts. */
  ascendPath: string;
  /** Ticks left on the public Ascension countdown (0 with a path = win). */
  ascendTicks: number;
  /** Land parcels bought (§18 rev.) — drives escalating BUY_PROPERTY cost. */
  parcels: number;
  /** Deployed cohorts (v3 missions) — at most MAX_COHORTS live entries. */
  cohorts: Cohort[];
}

/** Recap event log (§25): the raw material for headlines and cards. */
export interface RecapEvents {
  betrayals: { traitor: PlayerId; victim: PlayerId; tick: number }[];
  scandals: { attacker: PlayerId; victim: PlayerId; tick: number; followersLost?: number }[];
  schisms: { parent: PlayerId; splinter: PlayerId; tick: number }[];
  prophecies: { player: PlayerId; fulfilled: boolean; tick: number }[];
}

/** Building instance (§6). Destroyed (not captured) when its tile flips. */
export interface Building {
  id: number;
  player: PlayerId;
  type:
    | "compound"
    | "collection_plate"
    | "watchtower"
    | "broadcast_tower"
    | "supplement_lab"
    | "satellite";
  tile: TileId;
  /** construction remaining; 0 = operational */
  buildTicksLeft: number;
  /** sabotage/pamphlet/static downtime; >0 = offline */
  disabledTicks: number;
}

/** Tithe Courier (§7): walks between two Collection Plates carrying route $. */
export interface Courier {
  id: number;
  player: PlayerId;
  path: TileId[];
  /** index of current tile in path */
  idx: number;
  /** accumulated movement, Fixed tiles */
  moveProgress: Fixed;
  usd: Fixed;
}

/** Recruitment Van (§7): mobile converter, courier robber, agent killer. */
export interface Van {
  id: number;
  player: PlayerId;
  tile: TileId;
  path: TileId[];
  idx: number;
  moveProgress: Fixed;
}

export type AgentPhase = "travel" | "channel" | "gather";

/** Agent (§7/§13/§15.2): invisible operative for raids and scandal evidence. */
export interface AgentUnit {
  id: number;
  player: PlayerId;
  tile: TileId;
  targetDistrict: DistrictId;
  /** victim whose district this is (resolved at dispatch) */
  victim: PlayerId;
  mission: "deprogram" | "scandal";
  phase: AgentPhase;
  /** travel ticks remaining to arrival */
  travelTicks: number;
  /** deprogram channel ticks remaining */
  channelTicks: number;
  /** ticks spent inside enemy Watchtower vision (≥30 = killed, §13) */
  exposedTicks: number;
}

/** Charging propaganda strike (§8). One per Broadcast Tower at a time. */
export interface StrikeCharge {
  id: number;
  player: PlayerId;
  type: "pamphlet_bomb" | "prime_time_expose" | "manifesto_drop";
  target: TileId;
  /** victim cult for exposé/manifesto targeting */
  victim: PlayerId;
  chargeTicksLeft: number;
  /** 10s incoming-warning window after charge completes (§8) */
  warningTicksLeft: number;
}

/** Alliance (§16): 10:00 duration. Stored with a < b. */
export interface Alliance {
  a: PlayerId;
  b: PlayerId;
  expiresTick: number;
}

/** Pending alliance offer. */
export interface AllianceOffer {
  from: PlayerId;
  to: PlayerId;
  expiresTick: number;
}

/** Betrayal grudge: permanent −15% conversion traitor→victim (§16). */
export interface Grudge {
  traitor: PlayerId;
  victim: PlayerId;
}

/** Scandal evidence file (§15.2), attacker × victim. */
export interface Scandal {
  attacker: PlayerId;
  victim: PlayerId;
  /** 0..100 as Fixed */
  evidence: Fixed;
  notified: boolean;
  published: boolean;
}

/** Crop Circle (§11.4): +30 S on a district for 60s, for EVERYONE. */
export interface CropCircle {
  district: DistrictId;
  ticksLeft: number;
}

/** CPA picket line (§17): −30% pressure aura against its target player. */
export interface Picket {
  /** the player whose conversion it suppresses */
  target: PlayerId;
  tile: TileId;
  ticksLeft: number;
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

/**
 * Placed conversion aura: Midnight Festival (2× neutral, §9) or Free Retreat
 * Weekend (2.5× neutral / 1.5× enemy, zero Heat, §11.2).
 */
export interface Aura {
  player: PlayerId;
  tile: TileId;
  radius: number;
  ticksLeft: number;
  kind: "festival" | "retreat";
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

/** Active municipal civic decrees. */
export const CivicDecreeId = {
  TownCurfew: "town_curfew",
  PepRally: "pep_rally",
  ParentTeacherNight: "parent_teacher_night",
  FoodRationing: "food_rationing",
  EvangelicalRevival: "evangelical_revival",
  MunicipalInjunction: "municipal_injunction",
  EmergencyJam: "emergency_jam",
} as const;
export type CivicDecreeId = (typeof CivicDecreeId)[keyof typeof CivicDecreeId];

/** An active municipal decree running with remaining duration ticks. */
export interface ActiveDecree {
  id: number;
  player: PlayerId;
  decree: CivicDecreeId;
  district: DistrictId;
  ticksLeft: number;
}

/** The complete, serializable simulation state. Hashing this == StateHash (§33). */
export interface SimState {
  tick: number;
  rng: RngState;
  world: World;
  players: PlayerState[];
  progress: ProgressMap;
  /** count of citizen tiles — the victory-balance unit (§1) */
  populated: number;
  /** total residents in town — the conversion-bar and domination denominator */
  totalPop: number;
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
  activeDecrees: ActiveDecree[];

  // ---- M1 systems ----
  /** Victory path that ended the match ("" while running / timer / elimination). */
  winPath: string;
  disableCouriers: boolean;
  disableCPA: boolean;
  disableSchisms: boolean;
  buildings: Building[];
  couriers: Courier[];
  vans: Van[];
  agents: AgentUnit[];
  strikes: StrikeCharge[];
  nextEntityId: number;
  alliances: Alliance[];
  allianceOffers: AllianceOffer[];
  grudges: Grudge[];
  scandals: Scandal[];
  cropCircles: CropCircle[];
  pickets: Picket[];
  /** district id → tick when full-strength raids resume (§13 lockout) */
  raidLockouts: Record<number, number>;
  /** next sim-spawned player id (Splinter Sects, §16); high range avoids server ids */
  nextSplinterId: number;
  /** CPA depot timers (§17) */
  cpaNextPicketTick: number;
  cpaNextBusTick: number;
  /** FOUNDING phase (§18): ticks left of spawn-pick; sim is frozen until 0. */
  foundingTicksLeft: number;
  /** recap event log (§25) */
  recap: RecapEvents;
}
