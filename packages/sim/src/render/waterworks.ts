/**
 * Waterworks (Stage 2b): the man-made things that stand IN the water —
 * the stone JETTY out to the lighthouse, the concrete DAM with its crest
 * road and spillway, the tailwater churn below it, marina / pier segments
 * chained out over the water — plus the brick hydro POWERHOUSE on the bank
 * (a plan-kit author).
 *
 * Every water-standing lot is drawn after drawWater() has painted the tile
 * (townRender's Lake case), so the sea / river shows round its edges.
 * Presentation only: pixHash / RS.tick; nothing touches sim state.
 */
import { Lot, Terrain, type World } from "../types.js";
import { hexToRgb, shade, type RGB } from "../palette.js";
import { C, RS, TILE_PX, pixHash, isLitHour, type Put } from "./core.js";
import { EMISSIVE } from "./grade.js";
import { M, type Plan } from "./plan.js";
import { pane } from "./lots.js";

const hx = hexToRgb;

const at = (w: World, x: number, y: number): number => (x < 0 || y < 0 || x >= w.width || y >= w.height ? -1 : y * w.width + x);
const lotAt = (w: World, x: number, y: number): number => { const n = at(w, x, y); return n < 0 ? -1 : w.lot[n]!; };
const isWater = (w: World, x: number, y: number): boolean => { const n = at(w, x, y); return n >= 0 && w.terrain[n] === Terrain.Lake; };

/** stone riprap / granite block colour at a world px: 4×3 px blocks in
 * running bond, a lit top course and a dark joint, per-block tone */
export function granite(gx: number, gy: number, wet: boolean): RGB {
  const row = Math.floor(gy / 3);
  const off = (row & 1) * 2;
  const bx = Math.floor((gx + off) / 4);
  const h = pixHash(bx, row, 311);
  const base = [hx("#a6a39a"), hx("#94918a"), hx("#b4b0a6"), hx("#8a877f")][h & 3]!;
  const jx = (gx + off) % 4 === 3, jy = gy % 3 === 2;
  let c = jy ? shade(base, 0.66) : jx ? shade(base, 0.78) : gy % 3 === 0 ? shade(base, 1.1) : base;
  if (wet) c = shade(c, 0.7);
  if (RS.season === "winter" && !wet && !jy && gy % 3 === 0 && h % 2 === 0) c = M.snow;
  return c;
}

// ------------------------------------------------------------ JETTY

/**
 * Open water under a lot that stands in the sea on a NON-water tile (a
 * jetty on a Path tile, the lighthouse's Citizen pad): the ocean / lake
 * base tone with drifting ripple glints, matching drawWater's open water.
 */
export function seaFill(w: World, t: number, tx: number, ty: number, put: Put, tick: number): void {
  const x0 = tx * TILE_PX, y0 = ty * TILE_PX;
  const ocean = w.biome[t] === 4;
  const frozen = RS.season === "winter" && !ocean;
  const deep = ocean ? hx("#2c5876") : C.waterDeep, rip = ocean ? hx("#3f7890") : C.waterRipple;
  const drift = (tick >> 3) & 7;
  for (let py = 0; py < TILE_PX; py++) for (let px = 0; px < TILE_PX; px++) {
    const gx = x0 + px, gy = y0 + py;
    const h = pixHash(gx + (frozen ? 0 : drift), gy, 61);
    put(gx, gy, h % 9 === 0 ? rip : h % 37 === 0 ? C.waterGlint : deep);
  }
}
/** does this tile stand out in the water (≥ 2 water / jetty sides)? */
export function standsInWater(w: World, tx: number, ty: number): boolean {
  let n = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const k = at(w, tx + dx, ty + dy);
    if (k >= 0 && (w.terrain[k] === Terrain.Lake || w.lot[k] === Lot.Jetty)) n++;
  }
  return n >= 2;
}

/**
 * One stone BREAKWATER segment (Lot.Jetty) on a water tile: a causeway of
 * big granite blocks running along the chain's axis, flat capstones down
 * the crown, dark wet stones at the waterline and surf that breaks on the
 * seaward flank on the frame clock.
 */
export function drawJetty(w: World, t: number, tx: number, ty: number, put: Put, tick: number): void {
  const x0 = tx * TILE_PX, y0 = ty * TILE_PX;
  const link = (x: number, y: number): boolean => {
    const l = lotAt(w, x, y);
    if (l === Lot.Jetty || l === Lot.Lighthouse) return true;
    const n = at(w, x, y);
    return n >= 0 && w.terrain[n] !== Terrain.Lake; // the shore root
  };
  const eN = link(tx, ty - 1), eS = link(tx, ty + 1), eW = link(tx - 1, ty), eE = link(tx + 1, ty);
  // axis: N–S when linked vertically (or nothing horizontal)
  const vert = eN || eS || !(eW || eE);
  const surf = (tick >> 2) & 7;
  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      const gx = x0 + px, gy = y0 + py;
      // across-axis coordinate (0 = centre) and along-axis reach
      const a = vert ? px - 3.5 : py - 3.5;
      const along = vert ? py : px;
      const lo = vert ? eN : eW, hi = vert ? eS : eE;
      // the end of a chain rounds off
      const endCut = (!lo && along < 2 ? 2 - along : 0) + (!hi && along > 5 ? along - 5 : 0);
      const half = 1.9 + valueJit(gx, gy) - endCut * 0.9;
      const d = Math.abs(a);
      if (d > half + 0.9) {
        // surf breaking on the flank (both sides; the seaward side more)
        // surf: a white collar on the stones, spray thrown on the clock
        const k = d - half;
        if (k < 1.9 || (k < 3 && (gx * 7 + gy * 3 + surf) % 6 === 0)) put(gx, gy, (gx + gy + surf) % 3 ? hx("#eef4f4") : hx("#bcd6dc"));
        continue;
      }
      const wet = d > half - 0.4;
      let c = granite(gx, gy, wet);
      if (d < 1.2 && !wet) c = shade(c, 1.12); // capstones along the crown
      put(gx, gy, c);
    }
  }
}
function valueJit(gx: number, gy: number): number {
  return ((pixHash(gx >> 1, gy >> 1, 313) % 100) / 100) * 0.9 - 0.3;
}

// ------------------------------------------------------------ DAM

/** river flow across a dam tile: +1 = the water goes S (or E), -1 = N (or W) */
function damFlow(w: World, tx: number, ty: number, vert: boolean): number {
  // the reservoir side holds more water within 3 tiles
  let a = 0, b = 0;
  for (let k = 1; k <= 3; k++) for (let s = -2; s <= 2; s++) {
    if (vert) { if (isWater(w, tx + s, ty - k)) a++; if (isWater(w, tx + s, ty + k)) b++; }
    else { if (isWater(w, tx - k, ty + s)) a++; if (isWater(w, tx + k, ty + s)) b++; }
  }
  return a >= b ? 1 : -1;
}
/** dam runs E–W (spans a N–S river) when its neighbours sit left/right */
function damAcross(w: World, tx: number, ty: number): boolean {
  const l = (x: number, y: number): boolean => lotAt(w, x, y) === Lot.Dam;
  if (l(tx - 1, ty) || l(tx + 1, ty)) return true;
  if (l(tx, ty - 1) || l(tx, ty + 1)) return false;
  return isWater(w, tx, ty - 1) || isWater(w, tx, ty + 1);
}

/**
 * A concrete gravity DAM segment: the upstream parapet, the CREST ROAD
 * (asphalt, a centre line, lamp standards), the downstream parapet, then
 * the stepped downstream face; the middle bays are SPILLWAY gates with
 * piers, water pouring white over the ogee on the clock.
 */
export function drawDam(w: World, t: number, tx: number, ty: number, put: Put, tick: number): void {
  const x0 = tx * TILE_PX, y0 = ty * TILE_PX;
  const across = damAcross(w, tx, ty);
  const flow = damFlow(w, tx, ty, across);
  // spillway: tiles whose neighbours along the dam are both dam
  const along = (k: number): boolean => (across ? lotAt(w, tx + k, ty) : lotAt(w, tx, ty + k)) === Lot.Dam;
  const spill = along(-1) && along(1);
  const conc = hx("#c2beb4"), concD = hx("#9c988e"), concL = hx("#dcd8ce");
  const road = C.asphalt, line = C.highwayLine;
  const pour = (tick >> 1) & 3;
  const lit = isLitHour();
  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      // u across the dam (0 upstream .. 7 downstream), v along it
      let u = across ? py : px;
      const v = across ? px : py;
      if (flow < 0) u = 7 - u;
      let c: RGB | null;
      if (u === 0) c = (v & 1) ? shade(concD, 0.8) : null; // the wet upstream face at the waterline
      else if (u === 1 || u === 4) c = v % 4 === 0 ? concD : concL; // parapets + posts
      else if (u === 2) c = v % 4 < 2 ? line : road; // the crest road, centre line
      else if (u === 3) c = road;
      else if (spill && v % 4 !== 1) {
        // spillway bay: water sheets down the face under the road, white at the toe
        const k = (u * 3 + v + pour) & 3;
        c = u === 5 ? (k === 0 ? hx("#9fc6e0") : hx("#6f9fc0")) : u === 6 ? (k < 2 ? hx("#dff0f6") : hx("#9fc6e0")) : k < 3 ? hx("#f4fafc") : hx("#bcd6dc");
        if (RS.season === "winter" && u === 5) c = hx("#dcecf2"); // an ice sheet on the crest
      } else {
        // the stepped downstream face (gate piers in the spillway)
        c = u === 5 ? concD : u === 6 ? conc : shade(concD, 0.86);
        if (spill) c = u === 7 ? conc : concL;
      }
      if (!c) continue;
      put(across ? x0 + v : x0 + (flow < 0 ? 7 - u : u), across ? y0 + (flow < 0 ? 7 - u : u) : y0 + v, c);
    }
  }
  // crest lamp standards (lit at night) on the upstream parapet
  if ((across ? tx : ty) % 2 === 0) {
    const u = 1, v = 1;
    const uu = flow < 0 ? 7 - u : u;
    put(across ? x0 + v : x0 + uu, across ? y0 + uu : y0 + v, lit ? C.windowLit : M.dark);
  }
}

/**
 * The tailwater below a spillway: churning white water in the first rows
 * downstream of the dam, drifting on the clock. Called for water tiles.
 */
export function drawTailwater(w: World, tx: number, ty: number, put: Put, tick: number): void {
  const x0 = tx * TILE_PX, y0 = ty * TILE_PX;
  if (lotAt(w, tx, ty) === Lot.Dam) return;
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    if (lotAt(w, tx + dx, ty + dy) !== Lot.Dam) continue;
    const across = dy !== 0;
    const dam = { x: tx + dx, y: ty + dy };
    if (damAcross(w, dam.x, dam.y) !== across) continue; // beside the dam's end, not below it
    const flow = damFlow(w, dam.x, dam.y, across);
    // this tile must be DOWNSTREAM of that dam tile
    if (across ? Math.sign(-dy) !== flow : Math.sign(-dx) !== flow) continue;
    const ph = (tick >> 1) & 7;
    for (let k = 0; k < 5; k++) {
      for (let v = 0; v < TILE_PX; v++) {
        const h = pixHash(x0 + v, y0 + k, 331 + ph);
        if (h % (k + 2) !== 0) continue;
        const c = k < 2 ? hx("#eef6f8") : hx("#bcd6dc");
        const uu = (dy === 1 || dx === 1) ? 7 - k : k; // rows counted from the dam side
        put(across ? x0 + v : x0 + uu, across ? y0 + uu : y0 + v, c);
      }
    }
    return;
  }
}

// ------------------------------------------------------------ MARINA / PIER ON WATER

/**
 * A Dock lot standing on a WATER tile (a pier chained out from the shore).
 * Single-wide: a 2-px deck on pilings, T-head at the chain's end, a boat
 * alongside. Two-wide (a Dock beside it across the axis): the MARINA —
 * a 3-px main walk on the shared side with FINGER piers off the outer
 * side every 4 px and boats (runabouts, cabin cruisers, a sailboat with
 * its mast) moored in the slips.
 */
export function drawDockOnWater(w: World, t: number, tx: number, ty: number, put: Put, tick: number): void {
  const x0 = tx * TILE_PX, y0 = ty * TILE_PX;
  const dock = (x: number, y: number): boolean => lotAt(w, x, y) === Lot.Dock;
  const land = (x: number, y: number): boolean => { const n = at(w, x, y); return n >= 0 && w.terrain[n] !== Terrain.Lake; };
  const linkN = dock(tx, ty - 1) || land(tx, ty - 1), linkS = dock(tx, ty + 1) || land(tx, ty + 1);
  const linkW = dock(tx - 1, ty) || land(tx - 1, ty), linkE = dock(tx + 1, ty) || land(tx + 1, ty);
  // axis of the chain: prefer the one with a LAND end
  const vert = (land(tx, ty - 1) || land(tx, ty + 1)) ? true : (land(tx - 1, ty) || land(tx + 1, ty)) ? false : (linkN || linkS);
  // a Dock beside us across the axis = the marina's second lane
  const sideLo = vert ? dock(tx - 1, ty) : dock(tx, ty - 1);
  const sideHi = vert ? dock(tx + 1, ty) : dock(tx, ty + 1);
  const wide = sideLo || sideHi;
  const endLo = vert ? !linkN : !linkW, endHi = vert ? !linkS : !linkE;
  const plank = RS.season === "winter" ? hx("#b8b2a8") : C.plank, dark = C.plankDark, pile = hx("#4a3a2a");
  const bob = RS.season === "winter" ? 0 : (tick >> 4) & 1;
  const P = (a: number, b: number, c: RGB): void => {
    // a along the axis (0..7), b across (0..7)
    put(vert ? x0 + b : x0 + a, vert ? y0 + a : y0 + b, c);
  };
  const boatCol = (s: number): RGB => [hx("#ece8dc"), hx("#c8342a"), hx("#2a6ab0"), hx("#e8e4d8"), hx("#3a7a4a")][s % 5]!;
  if (!wide) {
    for (let a = 0; a < 8; a++) {
      P(a, 3, a % 2 ? dark : plank); P(a, 4, a % 2 ? plank : dark);
      if (a % 3 === 0) { P(a, 2, pile); P(a, 5, pile); }
    }
    if (endLo || endHi) {
      const a0 = endLo ? 0 : 5;
      for (let a = a0; a < a0 + 3; a++) for (let b = 1; b <= 6; b++) P(a, b, (a + b) % 2 ? plank : dark);
    }
    const h = pixHash(t, 2, 919);
    if (h % 3 !== 0) {
      const side = h & 4 ? 6 : 0;
      const hull = boatCol(h >>> 3);
      for (let a = 2 + bob; a <= 5 + bob; a++) { P(a, side, hull); P(a, side + 1, a === 2 + bob || a === 5 + bob ? hull : hx("#8a6a48")); }
    }
    return;
  }
  // MARINA lane: main walk on the shared side, fingers to the outer side
  const mainB = sideHi ? [5, 6, 7] : [0, 1, 2];
  const outer = sideHi ? -1 : 1; // fingers run toward the outer side
  for (let a = 0; a < 8; a++) for (const b of mainB) P(a, b, (a + b) % 2 ? plank : shade(plank, 0.92));
  for (let a = 0; a < 8; a += 4) {
    // a finger pier (1 px) out to the outer edge, piling at its tip
    for (let k = 1; k <= 4; k++) P(a, mainB[sideHi ? 0 : 2]! + outer * k, dark);
    P(a, sideHi ? 0 : 7, pile);
    // the boat in the slip beside the finger
    const h = pixHash(t * 8 + a, 5, 921);
    if (h % 4 === 0) continue; // empty slip
    const hull = boatCol(h >>> 2);
    const cabin = h % 3 === 0;
    const b0 = sideHi ? 1 : 3, b1 = sideHi ? 4 : 6; // boat lies across the slip
    for (let b = b0; b <= b1; b++) {
      P(a + 1 + (bob & (h & 1)), b, hull);
      P(a + 2 + (bob & (h & 1)), b, b === b0 || b === b1 ? hull : cabin ? hx("#f4f2ea") : hx("#8a6a48"));
    }
    // a sailboat's mast pokes up (1 px, the camera sees its top)
    if (h % 5 === 1) P(a + 2, (b0 + b1) >> 1, hx("#d8d4c8"));
  }
  if (endLo || endHi) {
    // the marina's head: a fuel float + light at the end of the walk
    const a = endLo ? 0 : 7;
    for (const b of mainB) P(a, b, hx("#d8d4c8"));
    P(a, mainB[1]!, isLitHour() ? EMISSIVE.hazard : hx("#c8342a"));
  }
}

// ------------------------------------------------------------ POWERHOUSE

/**
 * The hydro POWERHOUSE at the dam's abutment (a 1930s WPA/TVA-style brick
 * block): tall arched windows between brick pilasters, a stone plinth and
 * cornice, a flat roof with the transformer deck and insulators, the
 * tailrace arch at its base; a switchyard pole with the line leaving it,
 * and a sodium light at night.
 */
export function powerhouse(p: Plan): void {
  const { L, D } = p;
  const brick = p.h(1) % 2 ? M.brick : M.brickBrown;
  const stone = M.limestone;
  const fr = p.D - 2;
  p.pave(1, 1, L - 2, fr, "concrete");
  const bl1 = L >= 16 ? L - 5 : L - 2;
  p.box({
    l0: 1, d0: 1, l1: bl1, d1: D - 3, h: Math.min(4, D - 4), wall: brick, roof: M.tar, kind: "flat",
    front: (u, r, n, hh) => {
      if (r === 0) return stone; // cornice
      if (r === hh - 1) return u % 4 === 2 ? hx("#2a3a44") : shade(stone, 0.9); // plinth + tailrace arches
      if (u % 3 === 0) return shade(brick, 1.08); // pilasters
      return r === 1 ? shade(pane(p, u, r, 50), 1.1) : pane(p, u, r, 50); // tall arched windows
    },
    side: (u, r, _n, hh) => (r === 0 ? stone : r === hh - 1 ? shade(stone, 0.9) : u % 3 === 1 ? pane(p, u, r, 51) : null),
    back: (u, r, _n, hh) => (r === 0 ? stone : u === 2 && r >= hh - 2 ? C.door : null),
    lip: (k) => (k % 3 === 0 ? shade(brick, 1.08) : M.glass),
    deco: () => {
      // transformer deck: two tanks + white insulator stacks on the roof
      p.top(3, 2, hx("#4e5e52")); p.top(4, 2, hx("#4e5e52")); p.top(3, 3, hx("#6e7e72"));
      if (bl1 >= 8) { p.top(7, 2, hx("#4e5e52")); p.top(8, 2, hx("#4e5e52")); }
      p.top(5, 2, hx("#f0ece4"));
    },
  });
  if (L >= 16) {
    // switchyard pole with crossarm + insulators beside the house
    p.spr(L - 3, D - 3, ["wWw", ".|.", ".|.", ".|.", ".|."], { w: hx("#f0ece4"), W: hx("#5a4634"), "|": hx("#5a4634") }, 1, 0);
    if (p.lit) p.g(L - 4, fr, hx("#e8c070"));
  }
}

/** Dispatch for a lot standing on a water tile (after drawWater). */
export function drawWaterLot(w: World, t: number, tx: number, ty: number, put: Put, tick: number): boolean {
  const lot = w.lot[t]!;
  if (lot === Lot.Jetty) { drawJetty(w, t, tx, ty, put, tick); return true; }
  if (lot === Lot.Dam) { drawDam(w, t, tx, ty, put, tick); return true; }
  if (lot === Lot.Dock) { drawDockOnWater(w, t, tx, ty, put, tick); return true; }
  return false;
}
