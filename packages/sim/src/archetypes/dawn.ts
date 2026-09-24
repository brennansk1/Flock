/** §11.1 The Final Dawn — doomsday zealots. Fast, loud, brittle. */
import { add, div, fromInt, ONE } from "../fixed.js";
import { Landmark, Lot, NEUTRAL, TileState, PROGRESS_STRIDE } from "../types.js";
import { destroyBuildingsOnTile } from "../buildings.js";
import { gainHeatScaled } from "../entities.js";
import { HUNDRED, usd, faith, inBounds, isCitizen, districtAt } from "./common.js";
import type { ArchetypeDefinition } from "./types.js";
import { DAWN_KIT } from "./kits.js";

export const dawn: ArchetypeDefinition = {
  id: "dawn",
  coeffs: { r0: 1.05, retain: 0.8, income: 0.8, heat: 1.4, growth: 1.0 },
  abilities: [
    {
      id: "street_prophet",
      name: "Street Prophet",
      blurb: "Plant a doom-preacher: heavy conversion pressure around a tile for 30s.",
      slot: "primary",
      targeting: "tile",
      cooldownKey: "street_prophet",
      cooldownTicks: DAWN_KIT.streetProphet.cooldown,
      cost: () => usd(DAWN_KIT.streetProphet.cost),
      validate: ({ s, target }) => inBounds(s, target) && isCitizen(s.world, target),
      effect: ({ s, p, target }) => {
        s.pylons.push({ player: p.id, tile: target, ticksLeft: DAWN_KIT.streetProphet.durTicks });
      },
    },
    {
      id: "stockpile_sermon",
      name: "Stockpile Sermon",
      blurb: "One district: your conversion pressure ×3 for 12s.",
      slot: "secondary",
      targeting: "district",
      cooldownKey: "stockpile_sermon",
      cooldownTicks: DAWN_KIT.stockpileSermon.cooldown,
      cost: () => faith(DAWN_KIT.stockpileSermon.cost),
      validate: ({ s, target }) => districtAt(s, target) !== 0,
      effect: ({ s, p, target }) => {
        s.districtBuffs.push({ player: p.id, district: s.world.district[target]!, ticksLeft: DAWN_KIT.stockpileSermon.durTicks });
      },
    },
  ],
  signature: {
    name: "Prophecy Countdown",
    blurb: "Broadcast a doomsday timer. If you hold your ground until it ends, the Rapture takes the border.",
    apply(s, p, b) {
      if (p.prophecyUsed) return;
      const k = DAWN_KIT.prophecy;
      const minTiles = Math.min(k.minTiles, Math.max(1, Math.floor(s.populated * k.minShareOfPopulated)));
      if (p.ownedTiles < minTiles) return;
      p.prophecyUsed = true;
      gainHeatScaled(p, b, k.heat);
      s.prophecies.push({
        player: p.id,
        snapshotPermille: Math.floor((p.ownedTiles * 1000) / Math.max(1, s.populated)),
        ticksLeft: k.durTicks,
      });
    },
  },
  passives: {
    // Fear Feeds Us: +2% pressure per cohort deployed anywhere (cap +15%).
    attackMult(s) {
      let cohorts = 0;
      for (const pl of s.players) cohorts += pl.cohorts.length;
      const fearPct = Math.min(15, cohorts * 2);
      return add(ONE, div(fromInt(fearPct), HUNDRED));
    },
    // Doomsday Bunker: captured holy ground detonates every matching holy tile into scars.
    onTileLost(s, b, loser, t, prevOwner) {
      const w = s.world;
      if (!(w.lot[t] === Lot.Church || w.lot[t] === Lot.Chapel || w.landmark[t] === Landmark.Megachurch)) return false;
      const scarDuration = b.conversion.apostateScarTicks;
      const targetLot = w.lot[t]!;
      const targetLmk = w.landmark[t]!;
      for (let ct = 0; ct < w.owner.length; ct++) {
        if (
          (targetLot !== Lot.None && w.lot[ct] === targetLot) ||
          (targetLmk !== Landmark.None && w.landmark[ct] === targetLmk)
        ) {
          if (w.owner[ct] === prevOwner && ct !== t) loser.ownedTiles = Math.max(0, loser.ownedTiles - 1);
          w.owner[ct] = NEUTRAL;
          w.state[ct] = TileState.Apostate;
          w.scarTicks[ct] = scarDuration;
          destroyBuildingsOnTile(s, ct);
          for (const pl of s.players) s.progress.delete(ct * PROGRESS_STRIDE + pl.id);
        }
      }
      return true;
    },
  },
  bot: { prefLots: [Lot.HighSchool, Lot.Sheriff] },
  theme: {
    name: "The Final Dawn",
    short: "DOOMSDAY",
    tagline: "The end is nigh. Recruit accordingly.",
    playstyle:
      "Fastest converter in town. Flood the streets with missions — every cohort out makes the whole cult hit harder. You run HOT: Heat climbs fast and your ground flips back easily.",
    difficulty: 1,
    accent: "#df5a2b",
    glyph: "candle",
  },
};

