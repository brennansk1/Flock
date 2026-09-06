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
    /** v3 (§4): recruits/s per believer soul held; territory feeds the flock */
    recruits_per_believer?: number;
    /** v3: a small floor so a young cult trickles recruits before it holds ground */
    base_recruits_per_s?: number;
    /** Prosperity Gospel (§2C): a recruitment drive adds this ‰ of current
     *  flock for cash — makes `income` a live stat (Circle's engine). */
    recruit_drive_permille?: number;
    /** usd per bought recruit; the drive's cost scales with the ‰ above. */
    recruit_cost_per?: number;
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
  scandal: {
    evidence_per_s: number;
    /** optional: rate while a victim watchtower is watching (defaults to half) */
    evidence_watched_per_s?: number;
    notify_at: number;
    dmg_heat_coef: number;
    dmg_min: number;
    dmg_max: number;
  };
  archetypes: Record<"dawn" | "radiant" | "circle" | "visitors", { r0: number; retain: number; income: number; heat: number; growth?: number }>;
  victory: {
    domination_pct: Record<"S" | "M" | "L", number>;
    economic_usd: Record<"S" | "M" | "L", number>;
    doctrinal: { faith_hold_s: number; channel_s: number };
  };
  charisma_items: number;
  /** Property purchase + crowding (§18 rev.) — optional for older files. */
  property?: {
    parcel_radius: number;
    base_cost: number;
    cost_growth: number;
    max_link_dist: number;
    crowding_free_tiles: number;
    crowding_cap_mult: number;
    outreach_radius: number;
  };
  /** Civic-takeover effects (§13 rev.) — optional for older files. */
  civics?: {
    sheriff_heat_decay: number;
    school_creep_mult: number;
    highschool_growth_mult: number;
    grocery_defense_mult: number;
    church_faith_per_s: number;
    /** §2A economic anchors (B1.4.20) — optional for older files. */
    anchor_tithe_mult?: number;
    sawmill_build_mult?: number;
    lighthouse_outreach_bonus?: number;
    /** v3 §3: key buildings are sieges — resistance ×this (≈25–40 s to take) */
    siege_resist_mult?: number;
    /** v3 §13: Civic Momentum — global conversion +this per key building held. */
    civic_momentum_per?: number;
  };
  /** v3 missions (DESIGN_MISSIONS.md) — optional for older files. */
  missions?: {
    inner_circle_permille?: number;
    min_send_permille?: number;
    max_send_permille?: number;
    /** legacy M1 knob, superseded by the travel model (ignored) */
    recall_ticks?: number;
    march_ticks_per_tile?: number;
    work_radius?: number;
    followers_per_door?: number;
    max_doors?: number;
    crusade_attrition_permille_per_s?: number;
    tend_hold_divisor?: number;
    /** v3: Faith/s a deployed Tend cohort banks — fuels doctrine buys */
    tend_faith_per_s?: number;
  };
}

export interface ArchetypeCoeffs {
  r0: Fixed;
  retain: Fixed;
  income: Fixed;
  heat: Fixed;
  growth: Fixed;
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
    recruitsPerBeliever: Fixed;
    baseRecruitsPerS: Fixed;
    recruitDrivePermille: number;
    recruitCostPer: Fixed;
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
  property: {
    parcelRadius: number;
    baseCost: Fixed;
    costGrowth: Fixed;
    maxLinkDist: number;
    crowdingFreeTiles: number;
    crowdingCapMult: Fixed;
    outreachRadius: number;
  };
  civics: {
    sheriffHeatDecay: Fixed;
    schoolCreepMult: Fixed;
    highschoolGrowthMult: Fixed;
    groceryDefenseMult: Fixed;
    churchFaithPerS: Fixed;
    anchorTitheMult: Fixed;
    sawmillBuildMult: Fixed;
    lighthouseOutreachBonus: number;
    siegeResistMult: Fixed;
    civicMomentumPer: Fixed;
  };
  missions: {
    innerCirclePermille: number;
    minSendPermille: number;
    maxSendPermille: number;
    marchTicksPerTile: number;
    workRadius: number;
    followersPerDoor: number;
    maxDoors: number;
    crusadeAttritionPermillePerS: number;
    tendHoldDivisor: number;
    tendFaithPerS: Fixed;
  };
  /** Schism watcher (§16) — the counter-pressure on over-expansion. */
  schism: {
    /** territory trigger, in per-mille of populated tiles */
    territorySharePermille: number;
    /** cult-average dissent trigger */
    avgDissent: Fixed;
    /** how long both conditions must hold, in ticks */
    sustainTicks: number;
    /** fraction of the parent's tiles that secedes, in per-mille */
    secedeSharePermille: number;
  };
  /** Scandal (§15.2) — the counter-pressure on a runaway leader. */
  scandal: {
    /** evidence %/s while gathering undisturbed */
    evidencePerS: Fixed;
    /** evidence %/s while a victim watchtower watches the district borders */
    evidenceWatchedPerS: Fixed;
    /** evidence % at which the victim is tipped off */
    notifyAt: Fixed;
    /** follower loss = clamp(victim Heat × coef, min, max) percent */
    dmgHeatCoef: Fixed;
    dmgMin: Fixed;
    dmgMax: Fixed;
  };
  /**
   * Victory thresholds (§18). Plain numbers where they are compared against a
   * population share; Fixed where they meet fixed-point tick math.
   */
  victory: {
    /** domination cut-off as a PERCENT of total town souls, keyed by map size */
    dominationPct: Record<"S" | "M" | "L", number>;
    /** Revelation economic target ("The Ledger", §11.3) by map size */
    economicUsd: Record<"S" | "M" | "L", number>;
    /** Revelation doctrinal path (§18): hold Faith 100, then channel */
    doctrinal: { faithHoldTicks: number; channelTicks: number };
  };
}

/** Map-size bucket for the size-keyed victory tables (§1: S 64², M 96², L 128²). */
export function mapSizeBucket(width: number, height: number): "S" | "M" | "L" {
  const n = Math.max(width, height);
  return n <= 64 ? "S" : n <= 96 ? "M" : "L";
}

/**
 * The domination threshold this world should run, in per-mille, read from
 * balance.json so it stays hot-patchable (§A). Until 2026-07-24 nothing read
 * `victory.domination_pct` at all — createSim's hardcoded 720 default governed
 * every match, and the knob in balance.json was dead config.
 */
export function dominationPermilleFor(balance: Balance, width: number, height: number): number {
  return Math.round(balance.victory.dominationPct[mapSizeBucket(width, height)] * 10);
}

export function loadBalance(raw: RawBalance): Balance {
  const dt = fromFloat(raw.sim.tick_ms / 1000);
  /** ticks per second, derived from the configured tick length */
  const TPS = Math.round(1000 / raw.sim.tick_ms);
  const arche = (k: "dawn" | "radiant" | "circle" | "visitors"): ArchetypeCoeffs => ({
    r0: fromFloat(raw.archetypes[k].r0),
    retain: fromFloat(raw.archetypes[k].retain),
    income: fromFloat(raw.archetypes[k].income),
    heat: fromFloat(raw.archetypes[k].heat),
    growth: fromFloat(raw.archetypes[k].growth ?? 1.0),
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
      recruitsPerBeliever: fromFloat(raw.economy.recruits_per_believer ?? 0.005),
      baseRecruitsPerS: fromFloat(raw.economy.base_recruits_per_s ?? 1),
      recruitDrivePermille: raw.economy.recruit_drive_permille ?? 200,
      recruitCostPer: fromFloat(raw.economy.recruit_cost_per ?? 35),
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
    property: {
      parcelRadius: raw.property?.parcel_radius ?? 2,
      baseCost: fromFloat(raw.property?.base_cost ?? 8000),
      costGrowth: fromFloat(raw.property?.cost_growth ?? 1.5),
      maxLinkDist: raw.property?.max_link_dist ?? 14,
      crowdingFreeTiles: raw.property?.crowding_free_tiles ?? 3,
      crowdingCapMult: fromFloat(raw.property?.crowding_cap_mult ?? 0.85),
      outreachRadius: raw.property?.outreach_radius ?? 10,
    },
    civics: {
      sheriffHeatDecay: fromFloat(raw.civics?.sheriff_heat_decay ?? 0.1),
      schoolCreepMult: fromFloat(raw.civics?.school_creep_mult ?? 1.25),
      highschoolGrowthMult: fromFloat(raw.civics?.highschool_growth_mult ?? 1.15),
      groceryDefenseMult: fromFloat(raw.civics?.grocery_defense_mult ?? 1.2),
      churchFaithPerS: fromFloat(raw.civics?.church_faith_per_s ?? 0.1),
      anchorTitheMult: fromFloat(raw.civics?.anchor_tithe_mult ?? 1.1),
      sawmillBuildMult: fromFloat(raw.civics?.sawmill_build_mult ?? 0.88),
      lighthouseOutreachBonus: raw.civics?.lighthouse_outreach_bonus ?? 2,
      siegeResistMult: fromFloat(raw.civics?.siege_resist_mult ?? 3.5),
      civicMomentumPer: fromFloat(raw.civics?.civic_momentum_per ?? 0.03),
    },
    missions: {
      innerCirclePermille: raw.missions?.inner_circle_permille ?? 200,
      minSendPermille: raw.missions?.min_send_permille ?? 100,
      maxSendPermille: raw.missions?.max_send_permille ?? 900,
      marchTicksPerTile: raw.missions?.march_ticks_per_tile ?? 2,
      workRadius: raw.missions?.work_radius ?? 6,
      followersPerDoor: raw.missions?.followers_per_door ?? 15,
      maxDoors: raw.missions?.max_doors ?? 12,
      crusadeAttritionPermillePerS: raw.missions?.crusade_attrition_permille_per_s ?? 2,
      tendHoldDivisor: raw.missions?.tend_hold_divisor ?? 200,
      tendFaithPerS: fromFloat(raw.missions?.tend_faith_per_s ?? 0.4),
    },
    schism: {
      territorySharePermille: Math.round((raw.schism?.territory_share ?? 0.35) * 1000),
      avgDissent: fromFloat(raw.schism?.avg_dissent ?? 40),
      sustainTicks: Math.round((raw.schism?.sustain_s ?? 30) * TPS),
      secedeSharePermille: Math.round((raw.schism?.secede_share ?? 0.25) * 1000),
    },
    scandal: {
      evidencePerS: fromFloat(raw.scandal?.evidence_per_s ?? 1.2),
      evidenceWatchedPerS: fromFloat(raw.scandal?.evidence_watched_per_s ?? (raw.scandal?.evidence_per_s ?? 1.2) / 2),
      notifyAt: fromFloat(raw.scandal?.notify_at ?? 50),
      dmgHeatCoef: fromFloat(raw.scandal?.dmg_heat_coef ?? 0.6),
      dmgMin: fromFloat(raw.scandal?.dmg_min ?? 5),
      dmgMax: fromFloat(raw.scandal?.dmg_max ?? 35),
    },
    victory: {
      dominationPct: {
        S: raw.victory?.domination_pct?.S ?? 50,
        M: raw.victory?.domination_pct?.M ?? 45,
        L: raw.victory?.domination_pct?.L ?? 40,
      },
      economicUsd: {
        S: raw.victory?.economic_usd?.S ?? 1_200_000,
        M: raw.victory?.economic_usd?.M ?? 3_000_000,
        L: raw.victory?.economic_usd?.L ?? 6_000_000,
      },
      doctrinal: {
        faithHoldTicks: Math.round((raw.victory?.doctrinal?.faith_hold_s ?? 90) * TPS),
        channelTicks: Math.round((raw.victory?.doctrinal?.channel_s ?? 20) * TPS),
      },
    },
  };
}
