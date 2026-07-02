/**
 * Player factory — the only place initial player state is defined. Lives in
 * its own leaf module so sim, diplomacy, server, and client can all share it
 * without import cycles.
 */

import { fromInt } from "./fixed.js";
import type { Balance } from "./balance.js";
import { Stance, type PlayerId, type PlayerState } from "./types.js";

export function newPlayer(
  id: PlayerId,
  archetype: PlayerState["archetype"],
  b: Balance,
): PlayerState {
  return {
    id,
    archetype,
    alive: true,
    stance: Stance.Spread,
    followers: b.economy.startFollowers,
    usd: b.economy.startUsd,
    faith: fromInt(50),
    heat: 0,
    compounds: 1, // free First Compound (§3.1)
    ownedTiles: 0,
    spawned: false,
    cooldowns: {},
    sermonBuffTicks: 0,
    atonementTicks: 0,
    prophecyUsed: false,
    doctrine: [],
    maxFollowers: b.economy.startFollowers,
    e4Spent: false,
    judasTicks: 0,
    traitor: false,
    retentionDebuffTicks: 0,
    schismRiskTicks: 0,
    usdEarned: 0,
    faithHoldTicks: 0,
    parcels: 0,
    channelTicks: 0,
  };
}
