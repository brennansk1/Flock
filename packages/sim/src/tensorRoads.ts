/**
 * Tensor-field road network — an adaptation of ProbableTrain/MapGenerator
 * (which implements Chen et al., "Interactive Procedural Street Modeling")
 * scaled down to FLOCK's pixel-tile grid.
 *
 * What we keep from the original:
 *  - a 2D symmetric tensor field built by weighted superposition of GRID
 *    basis fields (preferred orientation θ, gaussian decay) and RADIAL
 *    fields (ring orientation around a center)
 *  - streets as streamlines traced along the field's MAJOR eigenvector,
 *    cross-streets along the MINOR, with dsep seed spacing and dtest
 *    collision distance; endpoints of one family seed the other
 *
 * What we drop: RK4 (Euler at 1-tile steps is plenty at 96×96), simplex
 * noise (seeded xoshiro wobble instead), and the graph/polygon/lot pipeline
 * (our blocks emerge from the tiles between roads).
 *
 * Floats are fine here: mapgen output ships to clients inside the snapshot,
 * and production maps are baked offline per §2 — the sim itself never
 * resamples the field.
 */

import { nextRange, type RngState } from "./rng.js";
import { Terrain, type World } from "./types.js";

interface GridField {
  kind: "grid";
  cx: number;
  cy: number;
  size: number;
  decay: number;
  theta: number;
}
interface RadialField {
  kind: "radial";
  cx: number;
  cy: number;
  size: number;
  decay: number;
}
export type BasisField = GridField | RadialField;

/**
 * Sample the combined tensor at (x, y) and return the major eigenvector
 * angle. A symmetric traceless 2×2 tensor is the pair (cos 2θ, sin 2θ)
 * scaled by weight; superposition is vector addition in that space, and the
 * major direction is recovered as ½·atan2.
 */
export function majorAngle(fields: BasisField[], x: number, y: number): number {
  let a = 0; // Σ w·cos 2θ
  let b = 0; // Σ w·sin 2θ
  for (const f of fields) {
    const dx = x - f.cx;
    const dy = y - f.cy;
    const d2 = dx * dx + dy * dy;
    const weight = Math.exp((-f.decay * d2) / (f.size * f.size));
    if (weight < 1e-4) continue;
    const theta = f.kind === "grid" ? f.theta : Math.atan2(dy, dx) + Math.PI / 2;
    a += weight * Math.cos(2 * theta);
    b += weight * Math.sin(2 * theta);
  }
  if (a === 0 && b === 0) return 0; // degenerate point: default grain
  return Math.atan2(b, a) / 2;
}

export interface TraceOpts {
  /** follow the minor (perpendicular) eigenvector instead */
  minor?: boolean;
  /** collision distance to other roads (dtest) */
  dtest: number;
  maxSteps: number;
  /** trace stays within this radius of (boundX, boundY); Infinity = whole map */
  boundR?: number;
  boundX?: number;
  boundY?: number;
  /** arbitrary bound predicate (organic town edges) — overrides boundR */
  bound?: (x: number, y: number) => boolean;
  /** paint a second lane perpendicular to travel (the highway) */
  twoLane?: boolean;
  /** per-step heading wobble in radians (seeded; the simplex-noise stand-in) */
  wobble?: number;
  /** steps before dtest collision applies — lets a street leave its seed road */
  graceSteps?: number;
  rng?: RngState;
}

/**
 * Trace one streamline bidirectionally from a seed, painting Road tiles.
 * The terrain grid doubles as the collision structure: hitting an existing
 * road within dtest ends the trace with a short join (a T-junction), exactly
 * the behaviour that makes street networks read as connected.
 */
export function traceStreamline(
  w: World,
  fields: BasisField[],
  seedX: number,
  seedY: number,
  opts: TraceOpts,
): number {
  let painted = 0;
  for (const dir of [1, -1]) {
    let x = seedX;
    let y = seedY;
    let prevAngle: number | null = null;
    const recent: number[] = []; // own freshly-painted tiles (self-collision exempt)

    for (let step = 0; step < opts.maxSteps; step++) {
      let angle = majorAngle(fields, x, y);
      if (opts.minor) angle += Math.PI / 2;
      // eigenvectors are headless: keep heading continuity by sign-flipping
      if (prevAngle !== null) {
        const diff = Math.cos(angle - prevAngle);
        if (diff < 0) angle += Math.PI;
      } else if (dir === -1) {
        angle += Math.PI;
      }
      if (opts.wobble && opts.rng) {
        angle += ((nextRange(opts.rng, 2001) - 1000) / 1000) * opts.wobble;
      }
      prevAngle = angle;

      x += Math.cos(angle);
      y += Math.sin(angle);
      const tx = Math.round(x);
      const ty = Math.round(y);
      if (tx < 1 || ty < 1 || tx >= w.width - 1 || ty >= w.height - 1) break;
      if (opts.bound) {
        if (!opts.bound(tx, ty)) break;
      } else if (opts.boundR !== undefined) {
        const bx = tx - (opts.boundX ?? 0);
        const by = ty - (opts.boundY ?? 0);
        if (bx * bx + by * by > opts.boundR * opts.boundR) break;
      }
      const t = ty * w.width + tx;
      if (w.terrain[t] === Terrain.Lake || w.terrain[t] === Terrain.Woods) break;

      // dtest collision against foreign road tiles → stop and join
      let collided = false;
      const inGrace = step < (opts.graceSteps ?? 0);
      for (let dy = -opts.dtest; dy <= opts.dtest && !collided && !inGrace; dy++) {
        for (let dx = -opts.dtest; dx <= opts.dtest && !collided; dx++) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= w.width || ny >= w.height) continue;
          const n = ny * w.width + nx;
          if (w.terrain[n] === Terrain.Road && !recent.includes(n)) collided = true;
        }
      }

      if (w.terrain[t] !== Terrain.Road) {
        w.terrain[t] = Terrain.Road;
        painted++;
      }
      recent.push(t);
      if (recent.length > 12) recent.shift();

      if (opts.twoLane) {
        const px = Math.round(tx - Math.sin(angle));
        const py = Math.round(ty + Math.cos(angle));
        if (px >= 0 && py >= 0 && px < w.width && py < w.height) {
          const pt = py * w.width + px;
          if (w.terrain[pt] !== Terrain.Road) {
            w.terrain[pt] = Terrain.Road;
            painted++;
          }
          recent.push(pt);
        }
      }

      if (collided) {
        // join walk: keep paving straight ahead until the street actually
        // touches the network — turns near-misses into proper T-junctions
        let jx = x;
        let jy = y;
        for (let j = 0; j < opts.dtest + 2; j++) {
          jx += Math.cos(prevAngle);
          jy += Math.sin(prevAngle);
          const jtx = Math.round(jx);
          const jty = Math.round(jy);
          if (jtx < 0 || jty < 0 || jtx >= w.width || jty >= w.height) break;
          const jt = jty * w.width + jtx;
          if (w.terrain[jt] === Terrain.Road && !recent.includes(jt)) break; // touched
          if (w.terrain[jt] === Terrain.Lake || w.terrain[jt] === Terrain.Woods) break;
          if (w.terrain[jt] !== Terrain.Road) {
            w.terrain[jt] = Terrain.Road;
            painted++;
          }
        }
        break; // joined the network
      }
    }
  }
  return painted;
}

/**
 * Generate the full road network: highway (global grain) → county route →
 * town avenues (major) ⇄ cross-streets (minor) with dsep seed spacing along
 * the previous family, alternating exactly like the reference implementation.
 */
export function traceRoadNetwork(
  w: World,
  rng: RngState,
  town: { cx: number; cy: number; r: number; inTown?: (x: number, y: number) => boolean },
): void {
  const inTown =
    town.inTown ??
    ((x: number, y: number): boolean => {
      const dx = x - town.cx;
      const dy = y - town.cy;
      return dx * dx + dy * dy <= town.r * town.r;
    });
  const townTheta = (nextRange(rng, 60) - 30) * (Math.PI / 180); // town grain ±30°
  const highwayTheta = (nextRange(rng, 30) - 15) * (Math.PI / 180); // near-horizontal

  const fields: BasisField[] = [
    // the town's street grain, decaying into the countryside
    { kind: "grid", cx: town.cx, cy: town.cy, size: town.r * 1.6, decay: 1.0, theta: townTheta },
    // a soft radial component so outer streets bow around downtown
    { kind: "radial", cx: town.cx + 4, cy: town.cy - 3, size: town.r * 0.9, decay: 2.2 },
    // the highway's global grain — everything far from town aligns to it
    { kind: "grid", cx: town.cx, cy: town.cy, size: w.width * 3, decay: 0.0, theta: highwayTheta },
  ];

  // HIGHWAY: a two-lane major streamline entering from the west edge
  traceStreamline(w, fields, 1, town.cy + nextRange(rng, 7) - 3, {
    dtest: 0,
    maxSteps: w.width * 2,
    twoLane: true,
    wobble: 0.02,
    rng,
  });
  // COUNTY ROUTE: a minor streamline crossing it through town
  traceStreamline(w, fields, town.cx + nextRange(rng, 5) - 2, 1, {
    minor: true,
    dtest: 0,
    maxSteps: w.height * 2,
    wobble: 0.02,
    rng,
  });

  // TOWN STREETS: the reference's seed-sampling discipline — jittered lattice
  // candidates across the town disc, accepted only if isValidSample holds (no
  // existing road within dsep/2), then a major AND minor streamline traced
  // through the point. Streets stop when they join the network (dtest), so
  // blocks emerge at roughly dsep spacing.
  const dsep = 5;
  const half = Math.ceil(dsep / 2);
  const isValidSample = (sx: number, sy: number): boolean => {
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
        if (w.terrain[y * w.width + x] === Terrain.Road) return false;
      }
    }
    return true;
  };
  for (let round = 0; round < 2; round++) {
    for (let gy = town.cy - town.r; gy <= town.cy + town.r; gy += dsep) {
      for (let gx = town.cx - town.r; gx <= town.cx + town.r; gx += dsep) {
        const sx = gx + nextRange(rng, 3) - 1;
        const sy = gy + nextRange(rng, 3) - 1;
        if (!inTown(sx, sy)) continue;
        if (!isValidSample(sx, sy)) continue;
        const common = {
          dtest: 2,
          maxSteps: town.r * 3,
          bound: inTown,
          wobble: 0.03,
          rng,
        };
        traceStreamline(w, fields, sx, sy, { ...common });
        traceStreamline(w, fields, sx, sy, { ...common, minor: true });
      }
    }
  }

  // COUNTRY ROADS: a few majors wandering out from the town edge
  const country = 2 + nextRange(rng, 2);
  for (let i = 0; i < country; i++) {
    const angle = (nextRange(rng, 360) * Math.PI) / 180;
    traceStreamline(
      w,
      fields,
      Math.round(town.cx + Math.cos(angle) * (town.r + 2)),
      Math.round(town.cy + Math.sin(angle) * (town.r + 2)),
      { dtest: 3, maxSteps: w.width, wobble: 0.08, rng },
    );
  }
}
