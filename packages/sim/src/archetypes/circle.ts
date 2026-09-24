/** §11.3 The Prosperity Circle — corporate MLM. Money is the weapon. */
import { add, div, min, mul, fromInt, fromFloat, ONE } from "../fixed.js";
import { Lot, NEUTRAL, Terrain, TileState, TileFlag } from "../types.js";
import { computeCivicControl, controlsCivic } from "../civics.js";
import { followerCap } from "../sim.js";
import { usd, inBounds, pct, both } from "./common.js";
import type { ArchetypeDefinition } from "./types.js";
import { CIRCLE_KIT, CULT_VICTORY } from "./kits.js";
import { mapClass } from "../victory.js";

export const circle: ArchetypeDefinition = {
  id: "circle",
  coeffs: { r0: 1.0, retain: 0.9, income: 1.3, heat: 1.0, growth: 0.9 },
  abilities: [
    {
      id: "seminar_blitz",
      name: "Seminar Blitz",
      blurb: "Buy a stadium seminar: your flock grows 25% instantly (up to your cap).",
      slot: "primary",
      targeting: "none",
      cooldownKey: "seminar_blitz",
      cooldownTicks: CIRCLE_KIT.seminarBlitz.cooldown,
      cost: () => usd(CIRCLE_KIT.seminarBlitz.cost),
      validate: () => true,
      effect: ({ s, p, b }) => {
        const cap = followerCap(p, b, s);
        const gain = div(mul(p.followers, fromInt(CIRCLE_KIT.seminarBlitz.flockPermille)), fromInt(1000));
        p.followers = min(add(p.followers, gain), cap);
      },
    },
    {
      id: "hostile_acquisition",
      name: "Hostile Takeover",
      blurb: "Buy out up to 40 contiguous neutral homes in a district.",
      slot: "secondary",
      targeting: "tile",
      cooldownKey: "hostile_acquisition",
      cooldownTicks: CIRCLE_KIT.hostileAcquisition.cooldown,
      cost: () => usd(CIRCLE_KIT.hostileAcquisition.cost),
      validate: ({ s, target }) =>
        inBounds(s, target) && s.world.owner[target] === NEUTRAL && s.world.terrain[target] === Terrain.Citizen,
      effect: ({ s, p, target }) => {
        const w = s.world;
        const district = w.district[target]!;
        const queue = [target];
        const seen = new Set<number>([target]);
        let bought = 0;
        while (queue.length > 0 && bought < CIRCLE_KIT.hostileAcquisition.maxTiles) {
          const cur = queue.shift()!;
          if (w.owner[cur] === NEUTRAL && w.state[cur] === TileState.Neutral) {
            w.owner[cur] = p.id;
            w.state[cur] = TileState.Believer;
            bought++;
          }
          const x = cur % w.width;
          const y = (cur / w.width) | 0;
          for (const n of [
            y > 0 ? cur - w.width : -1,
            x > 0 ? cur - 1 : -1,
            x < w.width - 1 ? cur + 1 : -1,
            y < w.height - 1 ? cur + w.width : -1,
          ]) {
            if (n < 0 || seen.has(n)) continue;
            if (w.district[n] !== district || w.terrain[n] !== Terrain.Citizen) continue;
            if (w.owner[n] !== NEUTRAL) continue;
            seen.add(n);
            queue.push(n);
          }
        }
        p.ownedTiles += bought;
      },
    },
  ],
  passives: {
    // Downline: tiles flipped by ambient creep alone pay 2× tithe forever.
    onTileCaptured(s, _p, t, worked) {
      if (!worked) s.world.flags[t] = s.world.flags[t]! | TileFlag.Downline;
    },
    // Franchise Megacenter: Bank control triples courier cash.
    courierMult: (s, p) => (controlsCivic(computeCivicControl(s), Lot.Bank, p.id) ? fromInt(3) : ONE),
    // Scandal Vulnerability: ×1.5 follower loss.
    scandalLossPct: (pct) => mul(pct, fromFloat(1.5)),
  },
  victory: {
    id: "ledger",
    name: "The Ledger",
    blurb: "Hold 20% of the town's souls and bank the Ledger target. Then buy the rest.",
    progress: (s, p, b) =>
      both(pct(p.soulsPermille, CULT_VICTORY.ledger.soulsPermille), pct(p.usd, b.victory.ledgerUsd[mapClass(s)])),
    achieved: (s, p, b) =>
      p.soulsPermille >= CULT_VICTORY.ledger.soulsPermille && p.usd >= b.victory.ledgerUsd[mapClass(s)],
  },
  bot: { prefLots: [Lot.Bank, Lot.Office], doctrine: ["B1", "I1", "I2", "E3", "T1", "I3", "I4"] },
  theme: {
    name: "The Prosperity Circle",
    short: "M.L.M.",
    tagline: "Your upline believes in you.",
    playstyle:
      "The richest cult in town. Turn tithe into followers with Seminar Blitz, buy neighbourhoods outright, and chase The Ledger. Scandals hit you hardest.",
    difficulty: 2,
    accent: "#e0a422",
    glyph: "coin",
  },
};
