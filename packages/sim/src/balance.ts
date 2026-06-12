/**
 * Balance config (Appendix A). `balance.json` at the repo root is the single
 * source of tuning truth and is hot-patchable without client updates.
 *
 * The raw JSON holds floats for human readability; `loadBalance` converts the
 * sim-facing scalars into Fixed at the boundary. Nothing past this file should
 * ever see a float.
 */

import { fromFloat, type Fixed } from "./fixed.js";

/** Shape of balance.json as authored (floats). */
export interface RawBalance {
  sim: { tick_ms: number; turn_per_tick: number; hash_every_turns: number };
  economy: {
    tithe_per_follower: number;
    start_usd: number;
    start_followers: number;
    follower_growth: number;
    cap_base: number;
    cap_per_compound: number;
    courier_per_tile: number;
    courier_cap: number;
    courier_interval_s: number;
  };
  conversion: {
    base_pressure: number;
    flip_threshold: number;
    ambient_creep: number;
    max_eff_per_border_tile: number;
    attrition_attacker: number;
    attrition_defender: number;
    apostate_scar_s: number;
  };
  stances: {
    tend: { commit: number; mult: number };
    spread: { commit: number; mult: number };
    crusade: { commit: number; mult: number; heat_per_s: number; dissent_per_capture: number };
  };
  heat: { decay: number; cpa_harass: number; cpa_siege: number };
  schism: { territory_share: number; avg_dissent: number; sustain_s: number; secede_share: number };
  scandal: { evidence_per_s: number; notify_at: number; dmg_heat_coef: number; dmg_min: number; dmg_max: number };
  archetypes: Record<"dawn" | "radiant" | "circle" | "visitors", { r0: number; retain: number; income: number; heat: number }>;
  victory: {
    domination_pct: Record<"S" | "M" | "L", number>;
    economic_usd: Record<"S" | "M" | "L", number>;
    doctrinal: { faith_hold_s: number; channel_s: number };
  };
  charisma_items: number;
}

export interface ArchetypeCoeffs {
  r0: Fixed;
  retain: Fixed;
  income: Fixed;
  heat: Fixed;
}

/** Sim-facing balance with Fixed scalars and a few pre-derived per-tick rates. */
export interface Balance {
  tickMs: number;
  hashEveryTurns: number;
  /** seconds-per-tick as Fixed, for converting per-second rates to per-tick. */
  dt: Fixed;
  economy: {
    tithePerFollower: Fixed;
    startUsd: Fixed;
    startFollowers: Fixed;
    followerGrowth: Fixed;
    capBase: Fixed;
    capPerCompound: Fixed;
    courierPerTile: Fixed;
    courierCap: Fixed;
    courierIntervalS: number;
  };
  conversion: {
    basePressure: Fixed;
    flipThreshold: Fixed;
    ambientCreep: Fixed;
    maxEffPerBorderTile: Fixed;
    attritionAttacker: Fixed;
    attritionDefender: Fixed;
    apostateScarTicks: number;
  };
  stances: {
    tend: { commit: Fixed; mult: Fixed };
    spread: { commit: Fixed; mult: Fixed };
    crusade: { commit: Fixed; mult: Fixed; heatPerS: Fixed; dissentPerCapture: Fixed };
  };
  heat: { decay: Fixed; cpaHarass: Fixed; cpaSiege: Fixed };
  archetypes: Record<"dawn" | "radiant" | "circle" | "visitors", ArchetypeCoeffs>;
  charismaItems: Fixed;
}

export function loadBalance(raw: RawBalance): Balance {
  const dt = fromFloat(raw.sim.tick_ms / 1000);
  const arche = (k: "dawn" | "radiant" | "circle" | "visitors"): ArchetypeCoeffs => ({
    r0: fromFloat(raw.archetypes[k].r0),
    retain: fromFloat(raw.archetypes[k].retain),
    income: fromFloat(raw.archetypes[k].income),
    heat: fromFloat(raw.archetypes[k].heat),
  });
  return {
    tickMs: raw.sim.tick_ms,
    hashEveryTurns: raw.sim.hash_every_turns,
    dt,
    economy: {
      tithePerFollower: fromFloat(raw.economy.tithe_per_follower),
      startUsd: fromFloat(raw.economy.start_usd),
      startFollowers: fromFloat(raw.economy.start_followers),
      followerGrowth: fromFloat(raw.economy.follower_growth),
      capBase: fromFloat(raw.economy.cap_base),
      capPerCompound: fromFloat(raw.economy.cap_per_compound),
      courierPerTile: fromFloat(raw.economy.courier_per_tile),
      courierCap: fromFloat(raw.economy.courier_cap),
      courierIntervalS: raw.economy.courier_interval_s,
    },
    conversion: {
      basePressure: fromFloat(raw.conversion.base_pressure),
      flipThreshold: fromFloat(raw.conversion.flip_threshold),
      ambientCreep: fromFloat(raw.conversion.ambient_creep),
      maxEffPerBorderTile: fromFloat(raw.conversion.max_eff_per_border_tile),
      attritionAttacker: fromFloat(raw.conversion.attrition_attacker),
      attritionDefender: fromFloat(raw.conversion.attrition_defender),
      apostateScarTicks: Math.round((raw.conversion.apostate_scar_s * 1000) / raw.sim.tick_ms),
    },
    stances: {
      tend: { commit: fromFloat(raw.stances.tend.commit), mult: fromFloat(raw.stances.tend.mult) },
      spread: { commit: fromFloat(raw.stances.spread.commit), mult: fromFloat(raw.stances.spread.mult) },
      crusade: {
        commit: fromFloat(raw.stances.crusade.commit),
        mult: fromFloat(raw.stances.crusade.mult),
        heatPerS: fromFloat(raw.stances.crusade.heat_per_s),
        dissentPerCapture: fromFloat(raw.stances.crusade.dissent_per_capture),
      },
    },
    heat: {
      decay: fromFloat(raw.heat.decay),
      cpaHarass: fromFloat(raw.heat.cpa_harass),
      cpaSiege: fromFloat(raw.heat.cpa_siege),
    },
    archetypes: {
      dawn: arche("dawn"),
      radiant: arche("radiant"),
      circle: arche("circle"),
      visitors: arche("visitors"),
    },
    charismaItems: fromFloat(raw.charisma_items),
  };
}
