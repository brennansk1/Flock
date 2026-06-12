/**
 * Map generation (§2) — M0 scope.
 *
 * The full pipeline is an offline tool placing hand-authored district
 * templates; this M0 generator produces spec-shaped maps procedurally so every
 * other system can be built and balanced against real district texture:
 *   - Downtown blob at the centroid (the income heart, forces mid-game conflict)
 *   - Voronoi-seeded districts at the §2 quota ratios
 *   - Woods/Lake blobs (~10%), cross roads through the center
 *   - Susceptibility rolled ~Normal(50,18), clamped 5–95, with district biases
 *     (College +12, Old Town −8)
 *
 * Deterministic from seed via the sim's own xoshiro RNG — a replay's intent
 * log plus the seed reproduces the map exactly. Landmark placement and
 * hand-authored templates arrive with the offline tool (M1).
 */

import { fromInt, fromFloat } from "./fixed.js";
import { seedRng, nextRange, type RngState } from "./rng.js";
import { Terrain, Landmark, type World, type DistrictCoeffs } from "./types.js";
import { createWorld } from "./sim.js";

/** District ids (index into districtCoeffs). 0 = unzoned (terrain). */
export const Districts = {
  None: 0,
  Suburbs: 1,
  College: 2,
  Downtown: 3,
  OldTown: 4,
  Trailer: 5,
} as const;

/** Authoritative coefficient table (§2). */
export function districtCoeffTable(): DistrictCoeffs[] {
  const row = (conv: number, retain: number, income: number): DistrictCoeffs => ({
    conv: fromFloat(conv),
    retain: fromFloat(retain),
    income: fromFloat(income),
  });
  return [
    row(1.0, 1.0, 1.0), // None (roads/woods/lake never convert anyway)
    row(1.0, 1.2, 1.0), // Suburbs
    row(1.6, 0.6, 0.7), // College Campus
    row(0.9, 1.0, 1.5), // Downtown/Strip
    row(0.5, 1.6, 1.3), // Old Town
    row(1.3, 0.9, 0.6), // Trailer/Outskirts
  ];
}

/** Non-downtown Voronoi seed weights ≈ §2 quotas (Suburbs 38 : College 8 : OldTown 12 : Trailer 18). */
const SEED_WEIGHTS: [number, number][] = [
  [Districts.Suburbs, 38],
  [Districts.College, 8],
  [Districts.OldTown, 12],
  [Districts.Trailer, 18],
];

export function generateWorld(seed: number, width: number, height: number): World {
  const rng = seedRng(seed ^ 0x6d61_7067); // "mapg"
  const w = createWorld(width, height);
  w.districtCoeffs = districtCoeffTable();

  placeDistricts(w, rng);
  placeTerrain(w, rng);
  placeLandmarks(w, rng);
  rollSusceptibility(w, rng);
  return w;
}

/**
 * Landmarks (§2 rule 2, simplified to quadrants): Radio Tower & Megachurch in
 * opposite thirds, Town Hall adjacent to Downtown (near center), Fairground
 * and Water Tower in the remaining quadrants. Each lands on the nearest
 * citizen tile to its anchor.
 */
function placeLandmarks(w: World, rng: RngState): void {
  const q = (fx: number, fy: number): number => {
    const x = Math.floor(w.width * fx);
    const y = Math.floor(w.height * fy);
    return y * w.width + x;
  };
  const anchors: [number, number][] = [
    [Landmark.RadioTower, q(0.18, 0.18)],
    [Landmark.Megachurch, q(0.82, 0.82)],
    [Landmark.TownHall, q(0.5, 0.45)], // adjacent to Downtown by construction
    [Landmark.Fairground, q(0.82, 0.18)],
    [Landmark.WaterTower, q(0.18, 0.82)],
  ];
  for (const [kind, anchor] of anchors) {
    const t = nearestCitizen(w, anchor);
    if (t >= 0) w.landmark[t] = kind;
  }
  void rng; // placement is anchor-based; jitter can come later without breaking replays
}

function nearestCitizen(w: World, from: number): number {
  const x0 = from % w.width;
  const y0 = (from / w.width) | 0;
  for (let r = 0; r < Math.max(w.width, w.height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
        const t = y * w.width + x;
        if (w.terrain[t] === Terrain.Citizen) return t;
      }
    }
  }
  return -1;
}

function placeDistricts(w: World, rng: RngState): void {
  const { width, height } = w;

  // 1. Downtown at centroid ±10% (§2 rule 1), radius ~12% of min dimension.
  const jitter = Math.floor(width / 10);
  const cx = (width >> 1) + nextRange(rng, jitter * 2 + 1) - jitter;
  const cy = (height >> 1) + nextRange(rng, jitter * 2 + 1) - jitter;
  const downtownR = Math.max(4, Math.floor(Math.min(width, height) * 0.12));

  // 2. Weighted Voronoi seeds for the rest.
  const seedCount = Math.max(8, Math.floor((width * height) / 512));
  const totalWeight = SEED_WEIGHTS.reduce((a, [, n]) => a + n, 0);
  const seeds: { x: number; y: number; district: number }[] = [];
  for (let i = 0; i < seedCount; i++) {
    let pick = nextRange(rng, totalWeight);
    let district: number = Districts.Suburbs;
    for (const [id, weight] of SEED_WEIGHTS) {
      if (pick < weight) {
        district = id;
        break;
      }
      pick -= weight;
    }
    seeds.push({ x: nextRange(rng, width), y: nextRange(rng, height), district });
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = y * width + x;
      const ddx = x - cx;
      const ddy = y - cy;
      if (ddx * ddx + ddy * ddy <= downtownR * downtownR) {
        w.district[t] = Districts.Downtown;
        continue;
      }
      let bestD = Infinity;
      let bestId: number = Districts.Suburbs;
      for (const s2 of seeds) {
        const dx = x - s2.x;
        const dy = y - s2.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          bestId = s2.district;
        }
      }
      w.district[t] = bestId;
    }
  }
}

function placeTerrain(w: World, rng: RngState): void {
  const { width, height } = w;
  const area = width * height;

  // Woods/Lake blobs until ~10% of the map is impassable (§2 quota).
  const target = Math.floor(area * 0.1);
  let placed = 0;
  let guard = 0;
  while (placed < target && guard++ < 200) {
    const bx = nextRange(rng, width);
    const by = nextRange(rng, height);
    const r = 2 + nextRange(rng, Math.max(3, width >> 4));
    const kind = nextRange(rng, 3) === 0 ? Terrain.Lake : Terrain.Woods;
    // keep the centroid (Downtown) clear
    const cdx = bx - (width >> 1);
    const cdy = by - (height >> 1);
    if (cdx * cdx + cdy * cdy < (width * width) / 16) continue;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = bx + dx;
        const y = by + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const t = y * width + x;
        if (w.terrain[t] === Terrain.Citizen) {
          w.terrain[t] = kind;
          w.district[t] = Districts.None;
          placed++;
        }
      }
    }
  }

  // Cross roads through the center guarantee connectivity (§2 rule 5).
  const my = height >> 1;
  const mx = width >> 1;
  for (let x = 0; x < width; x++) {
    w.terrain[my * width + x] = Terrain.Road;
    w.district[my * width + x] = Districts.None;
  }
  for (let y = 0; y < height; y++) {
    w.terrain[y * width + mx] = Terrain.Road;
    w.district[y * width + mx] = Districts.None;
  }
}

function rollSusceptibility(w: World, rng: RngState): void {
  for (let t = 0; t < w.susceptibility.length; t++) {
    if (w.terrain[t] !== Terrain.Citizen) {
      w.susceptibility[t] = 0;
      continue;
    }
    // ~Normal(50, 18) via 4 uniform draws in [0,31]: mean 62, σ≈18.5.
    const sum =
      nextRange(rng, 32) + nextRange(rng, 32) + nextRange(rng, 32) + nextRange(rng, 32);
    let s = 50 + (sum - 62);
    if (w.district[t] === Districts.College) s += 12;
    else if (w.district[t] === Districts.OldTown) s -= 8;
    s = s < 5 ? 5 : s > 95 ? 95 : s;
    w.susceptibility[t] = fromInt(s);
  }
}

/** Count conversion-eligible citizen tiles — the balance unit (§1). */
export function countPopulated(w: World): number {
  let n = 0;
  for (let t = 0; t < w.terrain.length; t++) if (w.terrain[t] === Terrain.Citizen) n++;
  return n;
}
