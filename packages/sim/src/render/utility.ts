/**
 * Utility overlays (Stage 2b): the TRANSMISSION LINE that feeds each
 * substation (and leaves the dam's powerhouse), drawn from the yard's back
 * side out across the country on wooden H-frame poles — three sagging
 * conductors, so the pole line visibly runs INTO the substation.
 * Unclipped overlay after the ground pass; presentation only.
 */
import { Lot, type World } from "../types.js";
import { hexToRgb } from "../palette.js";
import { TILE_PX, type Put } from "./core.js";
import { lotFrontage } from "./frontage.js";

const hx = hexToRgb;
const WOOD = hx("#6e5438"), WOOD_D = hx("#4e3a26"), WIRE = hx("#5a5e66"), INS = hx("#e8e4dc");

interface Feed { x: number; y: number; dx: number; dy: number; len: number }
const FEEDS = new WeakMap<World, Feed[]>();

function feedsOf(w: World): Feed[] {
  let list = FEEDS.get(w);
  if (list) return list;
  list = [];
  const seen = new Uint8Array(w.lot.length);
  for (let t = 0; t < w.lot.length; t++) {
    const lot = w.lot[t]!;
    if ((lot !== Lot.Substation && lot !== Lot.Powerhouse) || seen[t]) continue;
    const ax = t % w.width, ay = (t / w.width) | 0;
    let fw = 1, fh = 1;
    while (ax + fw < w.width && w.lot[ay * w.width + ax + fw] === lot) fw++;
    while (ay + fh < w.height && w.lot[(ay + fh) * w.width + ax] === lot) fh++;
    for (let y = ay; y < ay + fh; y++) for (let x = ax; x < ax + fw; x++) seen[y * w.width + x] = 1;
    const f = lotFrontage(w, ax, ay, fw, fh);
    // the line leaves AWAY from the street, on whichever of the three
    // back/side directions crosses the fewest buildings (lines follow open
    // land out of town, not over rooftops)
    const back: [number, number] = f === 0 ? [0, -1] : f === 1 ? [0, 1] : f === 2 ? [-1, 0] : f === 3 ? [1, 0] : [0, -1];
    const dirs: [number, number][] = [back, [back[1], back[0]], [-back[1], -back[0]]];
    let best = back, bestScore = 1e9;
    for (const [ddx, ddy] of dirs) {
      let score = 0;
      const cx = ax + (fw >> 1), cy = ay + (fh >> 1);
      for (let k = 1; k <= 12; k++) {
        const x = cx + ddx * (k + (ddx > 0 ? fw >> 1 : 0)), y = cy + ddy * (k + (ddy > 0 ? fh >> 1 : 0));
        if (x < 0 || y < 0 || x >= w.width || y >= w.height) { score += 6; break; }
        const n = y * w.width + x;
        if ((w.lot[n] !== 0 && w.lot[n] !== lot) || w.pop[n]! >= 3) score += 2;
      }
      if (ddx === back[0] && ddy === back[1]) score -= 1;
      if (score < bestScore) { bestScore = score; best = [ddx, ddy]; }
    }
    const [dx, dy] = best;
    const x = dx === 0 ? (ax + fw / 2) * TILE_PX : dx < 0 ? ax * TILE_PX + 3 : (ax + fw) * TILE_PX - 4;
    const y = dy === 0 ? (ay + fh / 2) * TILE_PX : dy < 0 ? ay * TILE_PX + 3 : (ay + fh) * TILE_PX - 4;
    // run out toward the map edge (at most 16 tiles)
    const toEdge = dx < 0 ? x : dx > 0 ? w.width * TILE_PX - x : dy < 0 ? y : w.height * TILE_PX - y;
    list.push({ x: Math.round(x), y: Math.round(y), dx, dy, len: Math.min(16 * TILE_PX, toEdge - 2) });
  }
  FEEDS.set(w, list);
  return list;
}

export function drawTransmissionLines(w: World, put: Put, view: { x0: number; y0: number; x1: number; y1: number }): void {
  const X0 = view.x0 * TILE_PX - 8, X1 = (view.x1 + 1) * TILE_PX + 8, Y0 = view.y0 * TILE_PX - 8, Y1 = (view.y1 + 1) * TILE_PX + 8;
  const SPAN = 24; // pole spacing (3 tiles)
  for (const f of feedsOf(w)) {
    const ex = f.x + f.dx * f.len, ey = f.y + f.dy * f.len;
    if (Math.max(f.x, ex) < X0 || Math.min(f.x, ex) > X1 || Math.max(f.y, ey) < Y0 || Math.min(f.y, ey) > Y1) continue;
    const px = f.dy !== 0 ? 1 : 0, py = f.dx !== 0 ? 1 : 0; // across-line unit
    // conductors (3, 2 px apart), sagging 1 px mid-span; the camera sees
    // them raised above the ground by the pole height (-3 px on screen)
    for (let s = 0; s <= f.len; s++) {
      const k = s % SPAN;
      const sag = k > 6 && k < SPAN - 6 ? 1 : 0;
      for (const c of [-2, 2]) {
        const x = f.x + f.dx * s + px * c, y = f.y + f.dy * s + py * c - 3 + sag;
        put(x, y, WIRE);
      }
    }
    // H-frame poles: two wood poles and the crossarm with insulators
    for (let s = SPAN; s <= f.len; s += SPAN) {
      const bx = f.x + f.dx * s, by = f.y + f.dy * s;
      for (const c of [-3, 3]) {
        const x = bx + px * c, y = by + py * c;
        put(x, y, WOOD_D); put(x, y - 1, WOOD); put(x, y - 2, WOOD); put(x, y - 3, WOOD);
        put(x + 1, y + 1, hx("#5a6440")); // pole shadow
      }
      for (let c = -3; c <= 3; c++) put(bx + px * c, by + py * c - 3, WOOD_D);
      for (const c of [-2, 2]) put(bx + px * c, by + py * c - 4, INS);
    }
  }
}
