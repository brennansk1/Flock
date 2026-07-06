/**
 * Intent protocol (§33). Clients send Intents; the server validates and bundles
 * them into Turns. The sim applies the Turn's intents deterministically.
 *
 * This is the complete launch intent set. The discriminated union keeps the
 * netcode and the sim honest about payload shapes.
 */

import type { PlayerId, TileId, DistrictId, Stance } from "./types.js";

export const IntentType = {
  SPAWN: "SPAWN",
  SET_STANCE: "SET_STANCE",
  MISSION_SEND: "MISSION_SEND",
  MISSION_RECALL: "MISSION_RECALL",
  BUILD: "BUILD",
  UPGRADE_COMMUNE: "UPGRADE_COMMUNE",
  BUY_PROPERTY: "BUY_PROPERTY",
  CANCEL_BUILD: "CANCEL_BUILD",
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
} as const;

export type IntentType = (typeof IntentType)[keyof typeof IntentType];

export type BuildingType =
  | "compound"
  | "collection_plate"
  | "watchtower"
  | "broadcast_tower"
  | "supplement_lab";

export type StrikeType = "pamphlet_bomb" | "prime_time_expose" | "manifesto_drop";

export type AgentMission = "deprogram" | "scandal";

export type Intent =
  | { t: typeof IntentType.SPAWN; player: PlayerId; tile: TileId }
  | { t: typeof IntentType.SET_STANCE; player: PlayerId; stance: Stance }
  /** v3 missions (DESIGN_MISSIONS.md §1): send `permille`‰ of the flock to
   * work the town around `tile` in the chosen per-sortie mode. */
  | { t: typeof IntentType.MISSION_SEND; player: PlayerId; tile: TileId; permille: number; mode: Stance }
  /** Recall the cohort in `slot` — they walk home (friction is the point). */
  | { t: typeof IntentType.MISSION_RECALL; player: PlayerId; slot: number }
  | { t: typeof IntentType.BUILD; player: PlayerId; building: BuildingType; tile: TileId }
  /** v3 (DESIGN_MISSIONS.md §2): pay to raise the commune one stage (1→5),
   * lifting the flock cap. The commune is the only buildable. */
  | { t: typeof IntentType.UPGRADE_COMMUNE; player: PlayerId }
  | { t: typeof IntentType.BUY_PROPERTY; player: PlayerId; tile: TileId }
  | { t: typeof IntentType.CANCEL_BUILD; player: PlayerId; tile: TileId }
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
  | { t: typeof IntentType.SURRENDER; player: PlayerId };

/** A network Turn: one tick's worth of validated intents plus the RNG seed slice (§33). */
export interface Turn {
  n: number;
  intents: Intent[];
  seedSlice: number;
}
