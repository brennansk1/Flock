/**
 * Kit tuning constants for the built-in cults (§11). A leaf module (no engine
 * imports) so any engine file may read them at module-evaluation time.
 * Prices were rescaled to the real economy in Stage 1 (STAGE1_DESIGN §6):
 * the old $12k–$300k price list was never affordable (telemetry, 0 casts).
 */
const TPS = 10;

export const DAWN_KIT = {
  streetProphet: { cost: 1_500, cooldown: 45 * TPS, durTicks: 30 * TPS },
  stockpileSermon: { cost: 30, cooldown: 90 * TPS, durTicks: 12 * TPS, afterDissent: 10 },
  prophecy: {
    /** Soul share (‰) required to declare — no more free Raptures. */
    minSoulsPermille: 250,
    durTicks: 180 * TPS,
    heat: 15,
    winFaith: 30,
    failFaith: 40,
    failApostasyPct: 15,
    failDissent: 20,
    /** High-S band floor for the rapture flip */
    highS: 65,
    capShareOfMap: 0.06,
    borderRange: 4,
  },
} as const;

export const RADIANT_KIT = {
  juiceCleanse: { cost: 2_000, cooldown: 60 * TPS },
  retreat: { cost: 3_500, cooldown: 90 * TPS, radius: 8, durTicks: 25 * TPS },
} as const;

export const CIRCLE_KIT = {
  seminarBlitz: { cost: 4_000, cooldown: 75 * TPS, flockPermille: 250 },
  hostileAcquisition: { cost: 12_000, cooldown: 180 * TPS, maxTiles: 40 },
} as const;

export const VISITORS_KIT = {
  cropCircle: { cost: 1_500, cooldown: 60 * TPS, durTicks: 60 * TPS },
  radioStatic: { faithCost: 20, cooldown: 90 * TPS, radius: 8, dissent: 30 },
  saucerLanding: { cost: 3_000, cooldown: 90 * TPS, capBonus: 2_000 },
} as const;

/** Cult victory paths (STAGE1_DESIGN §3): soul-share gate + the cult's own goal. */
export const CULT_VICTORY = {
  rapture: { soulsPermille: 300 },
  wellness: { soulsPermille: 350, maxAvgDissent: 8 },
  ledger: { soulsPermille: 200 },
  contact: { soulsPermille: 200, satellites: 4 },
} as const;
