/**
 * Grid road network (§2, rev. 2) — REPLACES the tensor-field streamlines.
 *
 * Real American small towns are platted: streets run along survey lines, so
 * everything is horizontal or vertical and the land divides into rectangular
 * blocks. Diagonal streamline roads read as stair-stepped noise at 8px/tile;
 * this generator guarantees EVERY road tile lies on an axis-aligned run:
 *
 *  - a 2-lane HIGHWAY runs the full map width and becomes MAIN STREET through
 *    town (the classic strip) — two painted rows;
 *  - a COUNTY ROUTE crosses it vertically through the center of town;
 *  - AVENUES (horizontal) and STREETS (vertical) step outward from the two
 *    arteries with jittered spacing — tight blocks downtown, looser toward the
 *    fringe — each clipped to the organic town footprint and shortened a
 *    random touch so the edge of town dissolves instead of snapping;
 *  - COUNTRY ROADS continue a few streets out to the map edge with occasional
 *    90° jogs, exactly like section-line roads.
 *
 * Every painted street is recorded and NAMED (names.ts / faker corpus), so the
 * client can say "Maple Avenue", not "that road".
 *
 * Floats are fine here (cosmetic boundary): mapgen runs server-side once and
 * ships in the snapshot; the tick loop never resamples any of this.
 */

import { nextRange, type RngState } from "./rng.js";
import { Terrain, type World } from "./types.js";
import { streetLabel, type Street } from "./names.js";

export interface GridTownShape {
  cx: number;
  cy: number;
  r: number;
  highwayY: number;
  highwayX: number;
  inTown: (x: number, y: number) => boolean;
}

/** Paint one axis-aligned road segment (inclusive), Grass/Field only. */
function paintRun(w: World, axis: 0 | 1, at: number, from: number, to: number): void {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  for (let i = lo; i <= hi; i++) {
    const x = axis === 0 ? i : at;
    const y = axis === 0 ? at : i;
    if (x < 1 || y < 1 || x >= w.width - 1 || y >= w.height - 1) continue;
    const t = y * w.width + x;
    if (w.terrain[t] === Terrain.Grass || w.terrain[t] === Terrain.Field) {
      w.terrain[t] = Terrain.Road;
    }
  }
}

/** The town footprint's inclusive x-extent on row y (or null if it misses). */
function rowExtent(town: GridTownShape, w: World, y: number): [number, number] | null {
  let x0 = -1;
  let x1 = -1;
  for (let x = 1; x < w.width - 1; x++) {
    if (town.inTown(x, y)) {
      if (x0 < 0) x0 = x;
      x1 = x;
    }
  }
  return x0 >= 0 && x1 - x0 >= 5 ? [x0, x1] : null;
}

function colExtent(town: GridTownShape, w: World, x: number): [number, number] | null {
  let y0 = -1;
  let y1 = -1;
  for (let y = 1; y < w.height - 1; y++) {
    if (town.inTown(x, y)) {
      if (y0 < 0) y0 = y;
      y1 = y;
    }
  }
  return y0 >= 0 && y1 - y0 >= 5 ? [y0, y1] : null;
}

/** Pick a street name not used yet (a few retries, then accept a repeat). */
function freshLabel(
  rng: RngState,
  used: Set<string>,
  kind: Parameters<typeof streetLabel>[1],
): string {
  for (let i = 0; i < 6; i++) {
    const name = streetLabel(rng, kind);
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  return streetLabel(rng, kind);
}

/**
 * Trace the whole grid network. Returns the named street records that mapgen
 * stores on `World.streets`.
 */
export function traceGridRoads(w: World, rng: RngState, town: GridTownShape): Street[] {
  const streets: Street[] = [];
  const used = new Set<string>();

  // ---- the HIGHWAY / MAIN STREET (2 lanes: rows hy and hy+1) --------------
  const hy = town.highwayY;
  const townSpan = rowExtent(town, w, hy) ?? [town.cx - town.r, town.cx + town.r];
  paintRun(w, 0, hy, 0, w.width - 1);
  paintRun(w, 0, hy + 1, 0, w.width - 1);
  const highwayName = freshLabel(rng, used, "highway");
  for (const row of [hy, hy + 1]) {
    // Main Street through town, "<X> Highway" out in the country — first
    // match wins in streetAt, so push the specific span before the general.
    streets.push({ name: "Main Street", axis: 0, at: row, from: townSpan[0], to: townSpan[1] });
    streets.push({ name: highwayName, axis: 0, at: row, from: 0, to: w.width - 1 });
  }

  // ---- the COUNTY ROUTE (vertical artery) ---------------------------------
  const mainX = town.highwayX;
  paintRun(w, 1, mainX, 0, w.height - 1);
  streets.push({ name: freshLabel(rng, used, "road"), axis: 1, at: mainX, from: 0, to: w.height - 1 });

  // ---- AVENUES: horizontal town streets stepping out from the highway -----
  // Block sizes: 5–6 lots downtown, 6–8 at the fringe (§2 rev. 6: blocks got
  // one lot wider so front lawns, walks, and parking aprons have room to
  // read — wall-to-wall infill was crushing the space between buildings).
  const denseR = town.r * 0.45;
  const gap = (dist: number): number =>
    dist < denseR ? 5 + nextRange(rng, 2) : 6 + nextRange(rng, 3);
  const avenueSpans: { at: number; from: number; to: number }[] = [];
  for (const dir of [-1, 1]) {
    // the highway occupies hy..hy+1; step from its outer edge
    let y = (dir === -1 ? hy : hy + 1) + dir * gap(0);
    while (Math.abs(y - town.cy) <= town.r + 2 && y > 1 && y < w.height - 2) {
      const ext = rowExtent(town, w, y);
      if (ext) {
        // fray the ends: real plats don't end on a perfect ellipse
        const from = ext[0] + nextRange(rng, 3);
        const to = ext[1] - nextRange(rng, 3);
        if (to - from >= 4) {
          paintRun(w, 0, y, from, to);
          streets.push({ name: freshLabel(rng, used, "avenue"), axis: 0, at: y, from, to });
          avenueSpans.push({ at: y, from, to });
        }
      }
      y += dir * gap(Math.abs(y - town.cy));
    }
  }

  // ---- STREETS: vertical, stepping out from the county route --------------
  const streetSpans: { at: number; from: number; to: number }[] = [];
  for (const dir of [-1, 1]) {
    let x = mainX + dir * gap(0);
    while (Math.abs(x - town.cx) <= town.r * 1.25 + 2 && x > 1 && x < w.width - 2) {
      const ext = colExtent(town, w, x);
      if (ext) {
        const from = ext[0] + nextRange(rng, 3);
        const to = ext[1] - nextRange(rng, 3);
        if (to - from >= 4) {
          paintRun(w, 1, x, from, to);
          streets.push({ name: freshLabel(rng, used, "street"), axis: 1, at: x, from, to });
          streetSpans.push({ at: x, from, to });
        }
      }
      x += dir * gap(Math.abs(x - town.cx));
    }
  }

  // ---- CUL-DE-SACS: dead-end courts poking into residential blocks --------
  // A stub street runs 2–3 tiles off an avenue into the block interior and
  // ends in a bulb (a plus of road) that homes will ring once zoning runs.
  const courts = 2 + nextRange(rng, 3);
  for (let i = 0; i < courts && avenueSpans.length > 0; i++) {
    let placed = false;
    for (let attempt = 0; attempt < 8 && !placed; attempt++) {
      const ave = avenueSpans[nextRange(rng, avenueSpans.length)]!;
      if (ave.to - ave.from < 8) continue;
      const sx = ave.from + 2 + nextRange(rng, ave.to - ave.from - 4);
      const dir = nextRange(rng, 2) === 0 ? -1 : 1;
      const len = 2 + nextRange(rng, 2);
      const endY = ave.at + dir * (len + 1);
      if (endY < 3 || endY > w.height - 4) continue;
      // the whole court must sit inside the town footprint, or it will end
      // up a lollipop street in open country once zoning skips it
      if (!town.inTown(sx, endY) || !town.inTown(sx - 1, endY) || !town.inTown(sx + 1, endY)) continue;
      // the stub + bulb tiles must be open grass, and the tile beyond the
      // bulb must not be road (so the court stays a true dead end)
      let clear = true;
      for (let step = 1; step <= len + 1 && clear; step++) {
        const t = (ave.at + dir * step) * w.width + sx;
        if (w.terrain[t] !== Terrain.Grass) clear = false;
      }
      const beyond = (endY + dir) * w.width + sx;
      if (beyond >= 0 && beyond < w.terrain.length && w.terrain[beyond] === Terrain.Road) clear = false;
      for (const bx of [sx - 1, sx + 1]) {
        const t = endY * w.width + bx;
        if (t < 0 || t >= w.terrain.length || w.terrain[t] === Terrain.Road) clear = false;
      }
      if (!clear) continue;
      placed = true;
      paintRun(w, 1, sx, ave.at + dir, endY);
      // the bulb: east + west of the end tile
      for (const bx of [sx - 1, sx + 1]) {
        const t = endY * w.width + bx;
        if (bx > 1 && bx < w.width - 2 && w.terrain[t] === Terrain.Grass) w.terrain[t] = Terrain.Road;
      }
      streets.push({
        name: freshLabel(rng, used, "court"),
        axis: 1,
        at: sx,
        from: Math.min(ave.at + dir, endY),
        to: Math.max(ave.at + dir, endY),
      });
    }
  }

  // ---- COUNTRY ROADS: section-line roads with 90° jogs --------------------
  // Each continues a platted street from its ACTUAL painted endpoint (not the
  // town footprint — the frayed ends would leave a gap) out to the map edge.
  const rural = 2 + nextRange(rng, 3);
  for (let i = 0; i < rural; i++) {
    const name = freshLabel(rng, used, "road");
    const side = nextRange(rng, 4); // 0=E 1=W 2=N 3=S
    if (side < 2 && avenueSpans.length > 0) {
      const ave = avenueSpans[nextRange(rng, avenueSpans.length)]!;
      traceRuralRoad(w, rng, streets, name, 0, ave.at, side === 0 ? ave.to : ave.from, side === 0 ? 1 : -1);
    } else if (streetSpans.length > 0) {
      const col = streetSpans[nextRange(rng, streetSpans.length)]!;
      traceRuralRoad(w, rng, streets, name, 1, col.at, side === 2 ? col.from : col.to, side === 2 ? -1 : 1);
    }
  }

  // frayed street/avenue ends can miss each other by one tile, leaving a
  // corner-only road contact; bridge those elbows NOW, while the corner tiles
  // are still open grass (zoning converts them to lots right after this).
  fillRoadElbows(w);

  return streets;
}

/** Bridge any road-road diagonal by filling one open elbow tile with Road. */
function fillRoadElbows(w: World): void {
  const isRoad = (t: number): boolean => w.terrain[t] === Terrain.Road;
  const open = (t: number): boolean =>
    w.terrain[t] === Terrain.Grass || w.terrain[t] === Terrain.Field;
  for (let y = 0; y < w.height - 1; y++) {
    for (let x = 0; x < w.width - 1; x++) {
      const a = y * w.width + x;
      const b = a + 1;
      const c = a + w.width;
      const d = c + 1;
      if (isRoad(a) && isRoad(d) && !isRoad(b) && !isRoad(c)) {
        if (open(b)) w.terrain[b] = Terrain.Road;
        else if (open(c)) w.terrain[c] = Terrain.Road;
      }
      if (isRoad(b) && isRoad(c) && !isRoad(a) && !isRoad(d)) {
        if (open(a)) w.terrain[a] = Terrain.Road;
        else if (open(d)) w.terrain[d] = Terrain.Road;
      }
    }
  }
}

/**
 * One rural road: walk axis-aligned from the town edge to the map edge,
 * jogging sideways 2–5 tiles every so often (still axis-aligned), painting and
 * recording each straight run under the same road name.
 */
function traceRuralRoad(
  w: World,
  rng: RngState,
  streets: Street[],
  name: string,
  axis: 0 | 1, // primary travel axis
  at: number, // the row (axis 0) / column (axis 1) we start on
  start: number,
  dir: 1 | -1,
): void {
  let pos = start;
  let lane = at;
  const limit = axis === 0 ? w.width - 2 : w.height - 2;
  let guard = 0;
  while (pos > 1 && pos < limit && guard++ < 40) {
    const run = 7 + nextRange(rng, 9);
    const end = Math.max(1, Math.min(limit, pos + dir * run));
    paintRun(w, axis, lane, pos, end);
    streets.push({ name, axis, at: lane, from: Math.min(pos, end), to: Math.max(pos, end) });
    pos = end;
    if (pos <= 1 || pos >= limit) break;
    // 40%: jog perpendicular (a section-line offset), then keep going
    if (nextRange(rng, 100) < 40) {
      const jog = 2 + nextRange(rng, 4);
      const jdir = nextRange(rng, 2) === 0 ? 1 : -1;
      const perpLimit = axis === 0 ? w.height - 2 : w.width - 2;
      const newLane = Math.max(2, Math.min(perpLimit, lane + jdir * jog));
      // the jog is itself an axis-aligned run on the perpendicular axis
      paintRun(w, axis === 0 ? 1 : 0, pos, lane, newLane);
      streets.push({
        name,
        axis: axis === 0 ? 1 : 0,
        at: pos,
        from: Math.min(lane, newLane),
        to: Math.max(lane, newLane),
      });
      lane = newLane;
    }
  }
}
