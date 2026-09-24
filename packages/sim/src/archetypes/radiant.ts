/** §11.2 The Radiant Path — wellness MLM. Cool, sticky, defensive. */
import { add, mul, fromInt, ONE } from "../fixed.js";
import { Lot } from "../types.js";
import { controlsCivic } from "../civics.js";
import { loveBombCostMult } from "../doctrine.js";
import { fp, usd, inBounds, districtAt, pct, both } from "./common.js";
import type { ArchetypeDefinition } from "./types.js";
import { RADIANT_KIT, CULT_VICTORY } from "./kits.js";

export const radiant: ArchetypeDefinition = {
  id: "radiant",
  coeffs: { r0: 1.0, retain: 1.5, income: 1.1, heat: 0.7, growth: 1.1 },
  abilities: [
    {
      id: "juice_cleanse",
      name: "Juice Cleanse",
      blurb: "Wipe every trace of dissent from your tiles in one district.",
      slot: "primary",
      targeting: "district",
      aim: "own",
      cooldownKey: "juice_cleanse",
      cooldownTicks: RADIANT_KIT.juiceCleanse.cooldown,
      cost: () => usd(RADIANT_KIT.juiceCleanse.cost),
      validate: ({ s, target }) => districtAt(s, target) !== 0,
      effect: ({ s, p, target }) => {
        const w = s.world;
        const district = w.district[target]!;
        for (let i = 0; i < w.district.length; i++) {
          if (w.district[i] === district && w.owner[i] === p.id) w.dissent[i] = 0;
        }
      },
    },
    {
      id: "free_retreat_weekend",
      name: "Retreat Weekend",
      blurb: "Radius-8 love-bomb for 25s: 2.5× conversion on neutrals, 1.5× on rivals, zero Heat.",
      slot: "secondary",
      targeting: "tile",
      cooldownKey: "retreat",
      cooldownTicks: RADIANT_KIT.retreat.cooldown,
      cost: (p) => ({ usd: mul(fromInt(RADIANT_KIT.retreat.cost), loveBombCostMult(p)) }),
      validate: ({ s, target }) => inBounds(s, target),
      effect: ({ s, p, target }) => {
        s.auras.push({
          player: p.id,
          tile: target,
          radius: RADIANT_KIT.retreat.radius,
          ticksLeft: RADIANT_KIT.retreat.durTicks,
          kind: "retreat",
        });
      },
    },
  ],
  passives: {
    // Organic Co-Op: Supermarket control → +40% retention.
    retainCivicMult: (_s, defender, civics) =>
      controlsCivic(civics, Lot.Supermarket, defender.id) ? fp(1.4) : ONE,
    // The Glow: +0.8%/s retention per second held, cap +80% at 100s (STAGE1 §7).
    retainTileMult(s, _defender, t) {
      const held = Math.min(1000, s.world.holdTicks[t]!);
      return add(ONE, held * 52); // 0.08%/tick in Q16.16 (≈ 0.0008 × 65536)
    },
  },
  victory: {
    id: "wellness",
    name: "Total Wellness",
    blurb: "Hold 35% of the town's souls with average dissent at 8 or below. A calm, happy, paying flock.",
    progress(_s, p, _b, st) {
      const tiles = st.believerTiles.get(p.id) ?? 0;
      const avg = tiles > 0 ? Math.floor((st.dissentSum.get(p.id) ?? 0) / tiles) : 0;
      const calm = avg <= fromInt(CULT_VICTORY.wellness.maxAvgDissent) ? 1000 : pct(fromInt(CULT_VICTORY.wellness.maxAvgDissent), avg);
      return both(pct(p.soulsPermille, CULT_VICTORY.wellness.soulsPermille), tiles > 0 ? calm : 0);
    },
    achieved(_s, p, _b, st) {
      const tiles = st.believerTiles.get(p.id) ?? 0;
      if (tiles === 0 || p.soulsPermille < CULT_VICTORY.wellness.soulsPermille) return false;
      return (st.dissentSum.get(p.id) ?? 0) <= fromInt(CULT_VICTORY.wellness.maxAvgDissent) * tiles;
    },
  },
  bot: { prefLots: [Lot.Supermarket, Lot.Church], doctrine: ["B3", "B2", "E3", "B1", "T1", "B4", "I1"] },
  theme: {
    name: "The Radiant Path",
    short: "WELLNESS",
    tagline: "Feel the glow. Pay the membership fee.",
    playstyle:
      "Cool and defensive. The longer you hold ground the harder it glows — rivals bounce off it. Low Heat, sticky territory, a slow squeeze that wins the long game.",
    difficulty: 1,
    accent: "#84a23c",
    glyph: "leaf",
  },
};
