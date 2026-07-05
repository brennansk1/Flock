/**
 * B6.5 — the cross-engine determinism probe. Runs the exact surface a
 * browser client executes during prediction: generateWorld (including the
 * §2A oceanside coastline — the one place transcendental math touches the
 * sim) + createSim + empty-intent stepping through conversion/economy/creep,
 * hashing along the way. The SAME module runs in Node and, bundled, in
 * headless Chromium/Firefox; every engine must produce identical hashes.
 *
 * Deterministic by construction: no Date, no Math.random, fixed intent
 * script, fixed seedSlices.
 */

import {
  loadBalance,
  createSim,
  generateWorld,
  step,
  hashState,
  IntentType,
  Terrain,
} from "../../packages/sim/dist/index.js";

const CASES = [
  { seed: 11, townType: "farm" },
  { seed: 11, townType: "oceanside" }, // Math.sin coastline — highest divergence risk
  { seed: 42, townType: "mountain" },
  { seed: 7, townType: "lakeside" },
];
const SIZE = 64;
const TICKS = 400;

/** Deterministic founder placement: ring anchor → spiral to valid grass. */
function spawnTile(w, index) {
  const angle = (index % 8) * (Math.PI / 4);
  const r = Math.floor(SIZE * 0.33);
  const x0 = Math.min(SIZE - 3, Math.max(2, (SIZE >> 1) + Math.round(Math.cos(angle) * r)));
  const y0 = Math.min(SIZE - 3, Math.max(2, (SIZE >> 1) + Math.round(Math.sin(angle) * r)));
  for (let radius = 0; radius < SIZE; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 2 || y < 2 || x >= SIZE - 2 || y >= SIZE - 2) continue;
        const t = y * SIZE + x;
        if (w.terrain[t] === Terrain.Grass && w.property[t] === 0) return t;
      }
    }
  }
  return y0 * SIZE + x0;
}

export function runProbe(balanceRaw) {
  const balance = loadBalance(balanceRaw);
  const out = {};
  for (const { seed, townType } of CASES) {
    const world = generateWorld(seed, SIZE, SIZE, { townType });
    const sim = createSim({
      seed,
      balance,
      world,
      spawns: [
        { id: 1, archetype: "dawn" },
        { id: 2, archetype: "circle" },
      ],
      timerTicks: 6000,
      foundingTicks: 1,
      dominationPermille: 720,
    });
    const hashes = [];
    step(
      sim,
      {
        n: 0,
        seedSlice: 1,
        intents: [
          { t: IntentType.SPAWN, player: 1, tile: spawnTile(world, 0) },
          { t: IntentType.SPAWN, player: 2, tile: spawnTile(world, 4) },
        ],
      },
      balance,
    );
    hashes.push(String(hashState(sim)));
    for (let n = 1; n <= TICKS; n++) {
      step(sim, { n, intents: [], seedSlice: (n * 2654435761) >>> 0 }, balance);
      if (n % 100 === 0) hashes.push(String(hashState(sim)));
    }
    out[`${townType}:${seed}`] = hashes;
  }
  return out;
}
