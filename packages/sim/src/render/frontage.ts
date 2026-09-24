/**
 * Building ORIENTATION (Stage 2). Every lot faces one street, chosen from
 * its neighbours deterministically:
 *   1. the highway / Main Street,
 *   2. the side facing the Courthouse Square across its street,
 *   3. any Road,
 *   4. a Dirt lane.
 * A multi-tile building takes ONE frontage for its whole footprint: the
 * side of its bounding box with the best class, then the most contact.
 * Remaining ties prefer S, E, W, N (the 3/4 camera looks from the south);
 * houses break them by hash instead so corner lots vary.
 *
 * The per-tile road class field is cached per World (roads never change).
 */
import { Terrain, Lot, type World } from "../types.js";
import { pixHash } from "./core.js";

/** 0 = S · 1 = N · 2 = E · 3 = W · -1 = no street contact */
export type Facing = -1 | 0 | 1 | 2 | 3;

const CLASS = new WeakMap<World, Uint8Array>();

/** 0 none · 1 dirt · 2 road · 3 road facing the square · 4 highway · 5 Main Street */
export function roadClass(w: World): Uint8Array {
  let f = CLASS.get(w);
  if (f) return f;
  const W = w.width, H = w.height;
  f = new Uint8Array(W * H);
  const road = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < W && y < H && w.terrain[y * W + x] === Terrain.Road;
  for (let t = 0; t < f.length; t++) {
    if (w.terrain[t] === Terrain.Road) f[t] = 2;
    else if (w.terrain[t] === Terrain.Dirt) f[t] = 1;
  }
  // the square's own streets
  const square = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const l = w.lot[y * W + x];
    return l === Lot.Courthouse || l === Lot.Park;
  };
  let hasSquare = false;
  for (let t = 0; t < w.lot.length && !hasSquare; t++) if (w.lot[t] === Lot.Courthouse) hasSquare = true;
  if (hasSquare) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!road(x, y)) continue;
      if (square(x - 1, y) || square(x + 1, y) || square(x, y - 1) || square(x, y + 1)) f[y * W + x] = 3;
    }
  }
  // through streets (the highway / Main Street): long street records, plus
  // the adjoining lane row of a double carriageway
  // Main Street itself outranks every other through road (class 5)
  const streets = [...(w.streets ?? [])].sort((a, b) => (a.name === "Main Street" ? 1 : 0) - (b.name === "Main Street" ? 1 : 0));
  for (const st of streets) {
    const dim = st.axis === 0 ? W : H;
    const main = st.name === "Main Street";
    if (!main && st.to - st.from + 1 < dim * 0.5) continue;
    for (let a = st.from; a <= st.to; a++) {
      for (const off of [0, -1, 1]) {
        const x = st.axis === 0 ? a : st.at + off;
        const y = st.axis === 0 ? st.at + off : a;
        if (!road(x, y)) continue;
        if (off !== 0) {
          // a lane row only if it runs along the street (not a side street)
          const along = st.axis === 0 ? road(x - 1, y) && road(x + 1, y) : road(x, y - 1) && road(x, y + 1);
          if (!along) continue;
        }
        f[y * W + x] = main ? 5 : 4;
      }
    }
  }
  CLASS.set(w, f);
  return f;
}

/** Frontage of the footprint (ax, ay, fw, fh); `tieSeed` ≥ 0 hashes ties (houses). */
export function lotFrontage(w: World, ax: number, ay: number, fw: number, fh: number, tieSeed = -1, reach = 1): Facing {
  const f = roadClass(w);
  const W = w.width, H = w.height;
  // `reach` > 1 looks across open lawn (the courthouse sits inside its
  // square's park): step outward past Park tiles to the street
  const cls0 = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= H ? 0 : f[y * W + x]!);
  let sdx = 0, sdy = 0;
  const cls = (x: number, y: number): number => {
    let c = cls0(x, y);
    for (let r = 1; r < reach && c === 0; r++) {
      const nx = x + sdx * r, ny = y + sdy * r;
      const px = x + sdx * (r - 1), py = y + sdy * (r - 1);
      if (px < 0 || py < 0 || px >= W || py >= H || w.lot[py * W + px] !== Lot.Park) break;
      c = cls0(nx, ny);
    }
    return c;
  };
  const score = [0, 0, 0, 0];
  const best = [0, 0, 0, 0];
  const add = (side: number, c: number): void => {
    if (c === 0) return;
    if (c > best[side]!) best[side] = c;
    score[side]!++;
  };
  for (let dx = 0; dx < fw; dx++) {
    sdx = 0; sdy = 1; add(0, cls(ax + dx, ay + fh));
    sdy = -1; add(1, cls(ax + dx, ay - 1));
  }
  for (let dy = 0; dy < fh; dy++) {
    sdy = 0; sdx = 1; add(2, cls(ax + fw, ay + dy));
    sdx = -1; add(3, cls(ax - 1, ay + dy));
  }
  const ORDER = [0, 2, 3, 1];
  let pick = -1, pv = 0;
  const tied: number[] = [];
  for (const s of ORDER) {
    if (best[s] === 0) continue;
    const v = best[s]! * 100 + score[s]!;
    if (v > pv) { pv = v; pick = s; tied.length = 0; tied.push(s); }
    else if (v === pv) tied.push(s);
  }
  if (pick >= 0 && tieSeed >= 0 && tied.length > 1) pick = tied[pixHash(tieSeed, 17, 701) % tied.length]!;
  return pick as Facing;
}
