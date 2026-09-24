/** §11.2 The Radiant Path — wellness MLM. Cool, sticky, defensive. */
import { add, mul, fromInt, ONE } from "../fixed.js";
import { Lot } from "../types.js";
import { controlsCivic } from "../civics.js";
import { loveBombCostMult } from "../doctrine.js";
import { fp, usd, inBounds, districtAt } from "./common.js";
import type { ArchetypeDefinition } from "./types.js";
import { RADIANT_KIT } from "./kits.js";

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
    // The Glow: +0.4%/s retention per second held, cap +80% at 200s.
    retainTileMult(s, _defender, t) {
      const held = Math.min(2000, s.world.holdTicks[t]!);
      return add(ONE, Math.round(held * 0.0004 * 65536));
    },
  },
  bot: { prefLots: [Lot.Supermarket, Lot.Church] },
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
