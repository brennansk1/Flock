/**
 * Intent protocol (§33). Clients send Intents; the server validates and bundles
 * them into Turns. The sim applies the Turn's intents deterministically.
 *
 * This is the complete launch intent set. The discriminated union keeps the
 * netcode and the sim honest about payload shapes.
 */

import type { PlayerId, TileId, DistrictId, Stance, CivicDecreeId } from "./types.js";

export const IntentType = {
  SPAWN: "SPAWN",
  SET_STANCE: "SET_STANCE",
  OPEN_FRONT: "OPEN_FRONT",
  CLOSE_FRONT: "CLOSE_FRONT",
  BUILD: "BUILD",
  BUY_PROPERTY: "BUY_PROPERTY",
  CANCEL_BUILD: "CANCEL_BUILD",
  RITUAL: "RITUAL",
  ABILITY: "ABILITY",
  SIGNATURE: "SIGNATURE",
  STRIKE: "STRIKE",
  AGENT_DISPATCH: "AGENT_DISPATCH",
  VAN_MOVE: "VAN_MOVE",
  DOCTRINE_PICK: "DOCTRINE_PICK",
  ALLY_PROPOSE: "ALLY_PROPOSE",
  ALLY_ACCEPT: "ALLY_ACCEPT",
  ALLY_BREAK: "ALLY_BREAK",
  PACT_PICK: "PACT_PICK",
  PUBLISH_SCANDAL: "PUBLISH_SCANDAL",
  CHAT: "CHAT",
  EMOTE: "EMOTE",
  SURRENDER: "SURRENDER",
  CIVIC_DECREE: "CIVIC_DECREE",
} as const;

export type IntentType = (typeof IntentType)[keyof typeof IntentType];

export type BuildingType =
  | "compound"
  | "collection_plate"
  | "watchtower"
  | "broadcast_tower"
  | "supplement_lab";

export type StrikeType = "pamphlet_bomb" | "prime_time_expose" | "manifesto_drop";

export type RitualId = "sermon" | "midnight_festival" | "the_offering" | "day_of_atonement";

export type AgentMission = "deprogram" | "scandal";

export type Intent =
  | { t: typeof IntentType.SPAWN; player: PlayerId; tile: TileId }
  | { t: typeof IntentType.SET_STANCE; player: PlayerId; stance: Stance }
  | { t: typeof IntentType.OPEN_FRONT; player: PlayerId; tiles: TileId[] }
  | { t: typeof IntentType.CLOSE_FRONT; player: PlayerId; front: number }
  | { t: typeof IntentType.BUILD; player: PlayerId; building: BuildingType; tile: TileId }
  | { t: typeof IntentType.BUY_PROPERTY; player: PlayerId; tile: TileId }
  | { t: typeof IntentType.CANCEL_BUILD; player: PlayerId; tile: TileId }
  | {
      t: typeof IntentType.RITUAL;
      player: PlayerId;
      ritual: RitualId;
      /** anchor tile for placed effects (Festival aura, Offering host district) */
      tile?: TileId;
      district?: DistrictId;
    }
  | { t: typeof IntentType.ABILITY; player: PlayerId; ability: string; target?: TileId }
  | { t: typeof IntentType.SIGNATURE; player: PlayerId; payload?: Record<string, number> }
  | { t: typeof IntentType.STRIKE; player: PlayerId; strike: StrikeType; target: TileId }
  | {
      t: typeof IntentType.AGENT_DISPATCH;
      player: PlayerId;
      district: DistrictId;
      mission: AgentMission;
    }
  | { t: typeof IntentType.VAN_MOVE; player: PlayerId; van: number; path: TileId[] }
  | { t: typeof IntentType.DOCTRINE_PICK; player: PlayerId; node: string }
  | { t: typeof IntentType.ALLY_PROPOSE; player: PlayerId; target: PlayerId }
  | { t: typeof IntentType.ALLY_ACCEPT; player: PlayerId; target: PlayerId }
  | { t: typeof IntentType.ALLY_BREAK; player: PlayerId; target: PlayerId }
  | { t: typeof IntentType.PACT_PICK; player: PlayerId; node: string }
  | { t: typeof IntentType.PUBLISH_SCANDAL; player: PlayerId; target: PlayerId }
  | { t: typeof IntentType.CHAT; player: PlayerId; channel: string; msg: string }
  | { t: typeof IntentType.EMOTE; player: PlayerId; emote: number }
  | { t: typeof IntentType.SURRENDER; player: PlayerId }
  | { t: typeof IntentType.CIVIC_DECREE; player: PlayerId; decree: CivicDecreeId; tile?: TileId };

/** A network Turn: one tick's worth of validated intents plus the RNG seed slice (§33). */
export interface Turn {
  n: number;
  intents: Intent[];
  seedSlice: number;
}
