/**
 * The FREIGHT TRAIN (Stage 2b): a 1980s freight — two hood-unit diesels
 * in a hashed road livery, a string of boxcars, covered hoppers and tank
 * cars, and a red CABOOSE — running the whole main line on a schedule.
 * A pure function of frameTick + the world's rail geometry (no simulated
 * state): every CYCLE ticks one train crosses the map, alternating east /
 * westbound, its consist hashed from the cycle number. Grade-crossing
 * lights flash red while it is near. Presentation only.
 */
import { Terrain, type World } from "../types.js";
import { hexToRgb, shade, type RGB } from "../palette.js";
import { C, TILE_PX, pixHash, isLitHour, type Put } from "./core.js";
import { EMISSIVE } from "./grade.js";

const hx = hexToRgb;
const CYCLE = 800; // ticks between trains (a day is 2400: three a day)
const SPEED = 1.5; // px per tick

interface Line { tiles: number[]; crossings: number[]; on: Uint8Array }
const LINES = new WeakMap<World, Line | null>();

/** The main line: the longest simple rail path (crossing road tiles). */
export function mainLine(w: World): Line | null {
  if (LINES.has(w)) return LINES.get(w)!;
  const W = w.width, H = w.height, N = W * H;
  const isRail = (t: number): boolean => w.terrain[t] === Terrain.Rail;
  // neighbours: rail 4-way, or across ONE road tile to rail beyond (a crossing)
  const nbrs = (t: number): number[] => {
    const x = t % W, y = (t / W) | 0, out: number[] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x1 = x + dx, y1 = y + dy;
      if (x1 < 0 || y1 < 0 || x1 >= W || y1 >= H) continue;
      const n = y1 * W + x1;
      if (isRail(n)) { out.push(n); continue; }
      if (w.terrain[n] === Terrain.Road) {
        // a crossing may span a 2-lane road
        for (let k = 2; k <= 3; k++) {
          const x2 = x + dx * k, y2 = y + dy * k;
          if (x2 < 0 || y2 < 0 || x2 >= W || y2 >= H) break;
          const m = y2 * W + x2;
          if (isRail(m)) { out.push(n); break; }
          if (w.terrain[m] !== Terrain.Road) break;
        }
      }
    }
    return out;
  };
  const railTiles: number[] = [];
  for (let t = 0; t < N; t++) if (isRail(t)) railTiles.push(t);
  if (railTiles.length < 8) { LINES.set(w, null); return null; }
  const bfs = (src: number): { far: number; prev: Int32Array } => {
    const prev = new Int32Array(N).fill(-2);
    prev[src] = -1;
    const q = [src];
    let far = src;
    for (let i = 0; i < q.length; i++) {
      const t = q[i]!;
      far = t;
      for (const n of nbrs(t)) {
        if (prev[n] !== -2) continue;
        // a road tile continues only straight on (along its crossing)
        prev[n] = t;
        q.push(n);
      }
    }
    return { far, prev };
  };
  // start from a rail tile on the map edge if there is one
  let start = railTiles[0]!;
  for (const t of railTiles) { const x = t % W, y = (t / W) | 0; if (x === 0 || y === 0 || x === W - 1 || y === H - 1) { start = t; break; } }
  const a = bfs(start).far;
  const { far: b, prev } = bfs(a);
  const tiles: number[] = [];
  for (let t = b; t !== -1; t = prev[t]!) tiles.push(t);
  tiles.reverse();
  if (tiles.length < 8) { LINES.set(w, null); return null; }
  const on = new Uint8Array(N);
  const crossings: number[] = [];
  for (const t of tiles) { on[t] = 1; if (w.terrain[t] === Terrain.Road) crossings.push(t); }
  const line = { tiles, crossings, on };
  LINES.set(w, line);
  return line;
}

/** point + axis at arc length s (px) along the line (tile-centre polyline) */
function pointAt(w: World, line: Line, s: number): { x: number; y: number; horiz: boolean } {
  const k = Math.max(0, Math.min(line.tiles.length - 1, Math.floor(s / TILE_PX)));
  const f = s - k * TILE_PX;
  const t = line.tiles[k]!, n = line.tiles[Math.min(line.tiles.length - 1, k + 1)]!;
  const tx = t % w.width, ty = (t / w.width) | 0, nx = n % w.width, ny = (n / w.width) | 0;
  const dx = Math.sign(nx - tx), dy = Math.sign(ny - ty);
  const horiz = dy === 0 && (dx !== 0 || k === line.tiles.length - 1);
  return { x: tx * TILE_PX + 4 + Math.round(dx * f), y: ty * TILE_PX + 4 + Math.round(dy * f), horiz };
}

type Kind = "loco" | "box" | "hopper" | "tank" | "caboose";
const LIVERIES: readonly [RGB, RGB][] = [
  [hx("#e8b828"), hx("#23386a")], // yellow + blue (a Chessie-ish road)
  [hx("#2a4a8a"), hx("#e8c040")], // warbonnet-era blue + yellow
  [hx("#2f5a3a"), hx("#e8e4d8")], // Burlington-green + white
  [hx("#1e3a6a"), hx("#ece8dc")], // Conrail-ish blue
];
const BOX: readonly RGB[] = [hx("#8a4a3a"), hx("#6a3a2e"), hx("#6a6e54"), hx("#9a6a3a"), hx("#3a5a7a")];

/** colour of a car's cross-section cell: j along (0 rear .. 7), r 0 roof .. 4 frame */
function carPx(kind: Kind, j: number, r: number, paint: RGB, trim: RGB, front: boolean, lit: boolean): RGB | null {
  if (j === 7) return r === 3 ? hx("#2a2826") : null; // coupler gap
  const wheel = r === 4 && (j === 1 || j === 5);
  if (r === 4) return wheel ? hx("#141312") : hx("#3a3632");
  switch (kind) {
    case "loco": {
      const fj = front ? j : 6 - j; // cab toward the head
      if (r === 0) return fj >= 4 ? shade(paint, 1.12) : fj % 2 ? shade(paint, 0.9) : shade(paint, 1.05); // hood + radiator fans
      if (fj === 6 && r === 2) return lit ? EMISSIVE.headlight : hx("#f0e8b0"); // headlight
      if ((fj === 4 || fj === 5) && r === 1) return lit ? C.windowLit : hx("#2a3550"); // cab glass
      if (r === 2) return trim; // the road's stripe
      return paint;
    }
    case "box":
      if (r === 0) return shade(paint, 1.14);
      if ((j === 3 || j === 4) && r >= 1) return shade(paint, 0.72); // the door
      return j % 3 === 0 ? shade(paint, 0.9) : paint;
    case "hopper":
      if (r === 0) return j % 2 ? hx("#b8b4ac") : hx("#a8a49c");
      return j % 2 ? hx("#9a968e") : hx("#8a867e");
    case "tank":
      if ((j === 0 || j === 6) && r === 0) return null; // rounded heads
      if (r === 0) return j === 3 ? hx("#5a5a5e") : hx("#3a3a3e");
      return r === 1 ? hx("#34343a") : hx("#26262a");
    case "caboose":
      if (r === 0) return j === 3 || j === 4 ? hx("#d8d4c8") : hx("#b8342a"); // cupola
      if (r === 1 && (j === 1 || j === 5)) return lit ? C.windowLit : hx("#2a3550");
      return hx("#a82e24");
  }
}

export function drawTrain(w: World, tick: number, put: Put): void {
  const line = mainLine(w);
  if (!line) return;
  const cyc = Math.floor(tick / CYCLE);
  const ph = tick - cyc * CYCLE;
  const h = pixHash(cyc, 7, 9431);
  // one train in three cycles is a light-engine gap: the line rests
  if (h % 5 === 0) return;
  const nCars = 8 + (h % 9);
  const kinds: Kind[] = ["loco", "loco"];
  for (let i = 0; i < nCars; i++) {
    const c = pixHash(cyc, i, 9433) % 10;
    kinds.push(c < 4 ? "box" : c < 7 ? "hopper" : "tank");
  }
  kinds.push("caboose");
  const [paint, trim] = LIVERIES[(h >>> 4) % LIVERIES.length]!;
  const L = line.tiles.length * TILE_PX;
  const len = kinds.length * TILE_PX;
  const east = (cyc & 1) === 0; // + along the line
  const head = ph * SPEED; // head's distance travelled from its entry end
  if (head - len > L) return; // gone
  const lit = isLitHour();
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i]!;
    const boxPaint = BOX[pixHash(cyc, i, 9435) % BOX.length]!;
    for (let j = 0; j < TILE_PX; j++) {
      // distance of this cell from the entry end
      const d = head - i * TILE_PX - (TILE_PX - 1 - j);
      if (d < 0 || d > L - 1) continue;
      const s = east ? d : L - 1 - d;
      const p = pointAt(w, line, s);
      for (let r = 0; r <= 4; r++) {
        const c = carPx(kind, j, r, kind === "box" ? boxPaint : paint, trim, true, lit);
        if (!c) continue;
        if (p.horiz) put(p.x, p.y - 3 + r, r === 4 ? c : c);
        else put(p.x - 2 + r, p.y, r >= 3 ? shade(c, 0.85) : c);
      }
    }
  }
  // grade crossings: the red lights flash while the train is near
  for (const t of line.crossings) {
    const k = line.tiles.indexOf(t) * TILE_PX;
    const sHead = east ? head : L - 1 - head;
    const sTail = east ? head - len : L - 1 - (head - len);
    const lo = Math.min(sHead, sTail) - 24, hi = Math.max(sHead, sTail) + 24;
    if (k < lo || k > hi) continue;
    const x = (t % w.width) * TILE_PX, y = ((t / w.width) | 0) * TILE_PX;
    const on = ((tick >> 2) & 1) === 0;
    put(x, y, on ? EMISSIVE.beacon : hx("#5a1a1a"));
    put(x + TILE_PX - 1, y + TILE_PX - 1, on ? hx("#5a1a1a") : EMISSIVE.beacon);
  }
}
