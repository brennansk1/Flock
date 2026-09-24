/**
 * Kit tuning constants for the built-in cults (§11). A leaf module (no engine
 * imports) so any engine file may read them at module-evaluation time.
 * ITVs; promote to balance.json when tuned.
 */
const TPS = 10;

export const DAWN_KIT = {
  streetProphet: { cost: 12_000, cooldown: 45 * TPS, durTicks: 30 * TPS },
  stockpileSermon: { cost: 30, cooldown: 90 * TPS, durTicks: 12 * TPS, afterDissent: 10 },
  prophecy: {
    minTiles: 1500,
    /** dev-scale fallback: 10% of populated if the map is smaller than spec */
    minShareOfPopulated: 0.1,
    durTicks: 180 * TPS,
    heat: 15,
    winFaith: 30,
    failFaith: 40,
    failApostasyPct: 15,
    failDissent: 20,
    /** High-S band floor for the rapture flip */
    highS: 65,
    capShareOfMap: 0.12,
    borderRange: 4,
  },
} as const;

export const RADIANT_KIT = {
  juiceCleanse: { cost: 20_000, cooldown: 60 * TPS },
  retreat: { cost: 35_000, cooldown: 90 * TPS, radius: 8, durTicks: 25 * TPS },
} as const;

export const CIRCLE_KIT = {
  seminarBlitz: { cost: 60_000, cooldown: 75 * TPS, followers: 2_500 },
  hostileAcquisition: { cost: 300_000, cooldown: 240 * TPS, maxTiles: 120 },
  ledgerUsd: 1_200_000,
} as const;

export const VISITORS_KIT = {
  cropCircle: { cost: 15_000, cooldown: 60 * TPS, durTicks: 60 * TPS },
  radioStatic: { faithCost: 20, cooldown: 90 * TPS, radius: 8, dissent: 30 },
  saucerLanding: { cost: 25_000, cooldown: 150 * TPS, capBonus: 2_000 },
} as const;
