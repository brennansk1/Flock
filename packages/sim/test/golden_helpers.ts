/**
 * Shared bot-match harness for the golden-hash characterization gate.
 * Plays full headless bot matches (all four archetypes, abilities enabled)
 * and samples the StateHash along the way.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  loadBalance, createSim, generateWorld, step, seedRng, botTurn, botShouldAct,
  hashState, IntentType, fromInt, type RawBalance, type Intent,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
export const balance = loadBalance(
  JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance,
);

export const KIT_IDS = [
  "street_prophet", "stockpile_sermon", "juice_cleanse", "free_retreat_weekend",
  "seminar_blitz", "hostile_acquisition", "crop_circle", "radio_static", "saucer_landing",
];

export const ARCHES = ["dawn", "radiant", "circle", "visitors"] as const;

export function playGolden(seed: number, ticks: number, size = 48, players = 4, seen?: Set<string>): string[] {
  const world = generateWorld(seed, size, size);
  const spawns = Array.from({ length: players }, (_, i) => ({ id: i + 1, archetype: ARCHES[i % 4]! }));
  const sim = createSim({ seed, balance, world, spawns, timerTicks: ticks + 10, foundingTicks: 1, dominationPermille: 700 });
  const rng = seedRng(seed ^ 0xb07);
  const bots = spawns.map((s, i) => ({ playerId: s.id, tier: "church" as const, cadence: 6 + (i % 5), aggression: 2, grudge: 0 }));
  const c = size >> 1, r = (size * 0.35) | 0;
  // Integer spawn ring (no trig): compass points around the centre.
  const ring = [[r, 0], [0, r], [-r, 0], [0, -r], [r >> 1, r >> 1], [-(r >> 1), -(r >> 1)]];
  step(sim, {
    n: 0, seedSlice: 1,
    intents: spawns.map((s, i) => ({ t: IntentType.SPAWN, player: s.id, tile: (c + ring[i]![1]!) * size + (c + ring[i]![0]!) })),
  }, balance);
  // Bankroll everyone so every cash-priced kit branch is exercised.
  for (const p of sim.players) p.usd = fromInt(20_000);
  const out: string[] = [];
  for (let n = 1; n <= ticks && sim.status === 0; n++) {
    const intents: Intent[] = [];
    for (const b of bots) if (botShouldAct(b as any, sim.tick)) intents.push(...botTurn(sim, b as any, rng, balance));
    // Scripted kit usage (bots don't cast ABILITY): exercise every archetype
    // branch so the characterization covers the whole kit surface.
    if (n % 90 === 0) {
      const N = sim.world.terrain.length;
      for (const sp of spawns) {
        let t = (n * 7919 + sp.id * 104729) % N;
        for (let k = 0; k < N && sim.world.terrain[t] !== 0; k++) t = (t + 1) % N;
        for (const ability of KIT_IDS) intents.push({ t: IntentType.ABILITY, player: sp.id, ability, target: t });
        intents.push({ t: IntentType.RITUAL, player: sp.id, ritual: "sermon" });
      }
    }
    step(sim, { n, intents, seedSlice: (n * 2654435761) >>> 0 }, balance);
    if (seen) for (const p of sim.players) for (const k of Object.keys(p.cooldowns)) seen.add(k);
    if (n % 500 === 0) out.push(hashState(sim));
  }
  out.push(`${sim.tick}:${sim.status}:${sim.winner}:${sim.winPath}:${hashState(sim)}`);
  return out;
}
