/** §11.4 The Visitors' Fellowship — saucer contactees. Reach anywhere. */
import { add, min, fromInt } from "../fixed.js";
import { Landmark, Lot, NEUTRAL, Terrain, TileState } from "../types.js";
import { ownsLandmark } from "../entities.js";
import { carveDirtLane } from "../mapgen.js";
import { HUNDRED, usd, faith, inBounds, districtAt, pct, both } from "./common.js";
import type { ArchetypeDefinition } from "./types.js";
import { VISITORS_KIT, CULT_VICTORY } from "./kits.js";

export const visitors: ArchetypeDefinition = {
  id: "visitors",
  coeffs: { r0: 1.0, retain: 1.0, income: 0.9, heat: 1.1, growth: 1.0 },
  abilities: [
    {
      id: "crop_circle",
      name: "Crop Circle",
      blurb: "+30 susceptibility across a district for 60s — for EVERYONE. Bait, gift or trap.",
      slot: "primary",
      targeting: "district",
      cooldownKey: "crop_circle",
      cooldownTicks: VISITORS_KIT.cropCircle.cooldown,
      cost: () => usd(VISITORS_KIT.cropCircle.cost),
      validate: ({ s, target }) => districtAt(s, target) !== 0,
      effect: ({ s, target }) => {
        s.cropCircles.push({ district: s.world.district[target]!, ticksLeft: VISITORS_KIT.cropCircle.durTicks });
      },
    },
    {
      id: "radio_static",
      name: "Radio Static",
      blurb: "Jam the signal: +30 dissent on every rival believer tile within radius 8.",
      slot: "secondary",
      targeting: "tile",
      aim: "rival",
      cooldownKey: "radio_static",
      cooldownTicks: VISITORS_KIT.radioStatic.cooldown,
      cost: () => faith(VISITORS_KIT.radioStatic.faithCost),
      validate: ({ s, target }) => inBounds(s, target),
      effect: ({ s, p, target }) => {
        const w = s.world;
        const r = VISITORS_KIT.radioStatic.radius;
        const r2 = r * r;
        const tx = target % w.width;
        const ty = (target / w.width) | 0;
        const amt = fromInt(VISITORS_KIT.radioStatic.dissent);
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r2) continue;
            const x = tx + dx;
            const y = ty + dy;
            if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
            const tt = y * w.width + x;
            const o = w.owner[tt]!;
            if (o !== 0 && o !== p.id && w.state[tt] === TileState.Believer) {
              w.dissent[tt] = min(add(w.dissent[tt]!, amt), HUNDRED);
            }
          }
        }
      },
    },
    {
      id: "saucer_landing",
      name: "Saucer Landing",
      blurb: "Land a satellite chapel on ANY neutral home — even across water. +2,000 flock cap.",
      slot: "signature",
      targeting: "tile",
      aim: "remote",
      cooldownKey: "saucer_landing",
      cooldownTicks: VISITORS_KIT.saucerLanding.cooldown,
      cost: () => usd(VISITORS_KIT.saucerLanding.cost),
      validate: ({ s, target }) => {
        const w = s.world;
        return (
          inBounds(s, target) &&
          w.terrain[target] === Terrain.Citizen &&
          w.owner[target] === NEUTRAL &&
          w.state[target] === TileState.Neutral
        );
      },
      effect: ({ s, p, target }) => {
        const w = s.world;
        w.owner[target] = p.id;
        w.state[target] = TileState.Believer;
        p.followers = add(p.followers, fromInt(w.pop[target]!)); // the household looks up
        p.ownedTiles++;
        s.buildings.push({
          id: s.nextEntityId++,
          player: p.id,
          type: "satellite",
          tile: target,
          buildTicksLeft: 0,
          disabledTicks: 0,
        });
        carveDirtLane(w, target); // pilgrims need a way in
      },
    },
  ],
  passives: {
    // Deep Space Transmitter: holding the Radio Tower hides your strike warnings.
    hidesStrikeWarning: (s, p) => ownsLandmark(s, p.id, Landmark.RadioTower),
  },
  victory: {
    id: "contact",
    name: "First Contact",
    blurb: "Hold 20% of the town's souls with 4 saucer chapels standing. They're coming back — for you.",
    progress: (_s, p, _b, st) =>
      both(pct(p.soulsPermille, CULT_VICTORY.contact.soulsPermille), pct(st.satellites.get(p.id) ?? 0, CULT_VICTORY.contact.satellites)),
    achieved: (_s, p, _b, st) =>
      p.soulsPermille >= CULT_VICTORY.contact.soulsPermille && (st.satellites.get(p.id) ?? 0) >= CULT_VICTORY.contact.satellites,
  },
  bot: { prefLots: [Lot.School, Lot.Library], doctrine: ["T1", "T2", "I1", "I2", "T3", "B1", "E3"] },
  theme: {
    name: "The Visitors' Fellowship",
    short: "U.F.O.",
    tagline: "They're coming back. Be ready.",
    playstyle:
      "The reach cult. Land saucer chapels anywhere on the map, bait districts with crop circles and jam rival signals. No hard weakness — reward for map awareness.",
    difficulty: 3,
    accent: "#4fa3ad",
    glyph: "ufo",
  },
};

