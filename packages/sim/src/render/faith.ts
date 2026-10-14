/**
 * Houses of worship (Stage 2b): the steepled town CHURCH and the white
 * clapboard CHAPEL, authored on the plan kit so each reads correctly from
 * every side — the gable-front entry and steeple from the street side
 * (S), the nave's long flank and the steeple at its street end from the
 * E/W, and from behind (N) the plain rear gable with the spire rising over
 * the far end of the roof.
 *
 * Presentation only: pixHash / RS.tick; nothing touches sim state.
 */
import { hexToRgb, shade, type RGB } from "../palette.js";
import { C, RS } from "./core.js";
import { M, type Plan, type Face } from "./plan.js";
import { pane } from "./lots.js";

const hx = hexToRgb;
const GOLD = hx("#e9c46a");
const STAINED: readonly RGB[] = [hx("#4477aa"), hx("#cc9933"), hx("#a8423a"), hx("#4a8a5a")];

interface NaveSpec {
  l0: number; l1: number; d0: number; d1: number;
  /** wall rows */
  h: number;
  wall: RGB;
  roof: RGB;
  /** stained glass (church) or plain panes (chapel) */
  stained: boolean;
  /** steep gable: rise in rows over the front/back wall */
  rise: number;
}

/** a 1-px lancet: glass with a lighter arch head */
function lancet(p: Plan, u: number, r: number, stained: boolean, salt: number): RGB {
  if (p.lit) return r === 0 ? shade(C.windowLit, 1.05) : C.windowLit;
  if (!stained) return r === 0 ? hx("#5a6a7a") : M.glass;
  const c = STAINED[(u + salt) % STAINED.length]!;
  return r === 0 ? shade(c, 1.15) : c;
}

/**
 * The nave: a steep gable-front box. The front gable (street S) carries a
 * rose / lunette window; the flanks carry a row of arched windows; the
 * back gable a single small window. The steep gable triangle is drawn in
 * deco (the kit's is shallower than a church roof).
 */
function nave(p: Plan, n: NaveSpec, doorFront: boolean, rose: boolean): void {
  const front: Face = (u, r, w, hh) => {
    const mid = w >> 1;
    if (doorFront && (u === mid || u === mid - 1) && r >= hh - 2) return r === hh - 2 ? shade(n.wall, 0.8) : hx("#4a3222");
    if ((u === 1 || u === w - 2) && r < hh - 1) return lancet(p, u, r, n.stained, 1);
    if ((u === 3 || u === w - 4) && w >= 10 && r < hh - 1) return lancet(p, u, r, n.stained, 2);
    return null;
  };
  const side: Face = (u, r, w, hh) => {
    if (r === hh - 1) return shade(n.wall, 0.9); // water table
    if (u % 2 === 1 && u > 0 && u < w - 1 && r < hh - 1) return lancet(p, u, r, n.stained, 3);
    return null;
  };
  const back: Face = (u, r, w, hh) => (u === w >> 1 && r === 1 && hh > 2 ? pane(p, u, r, 40) : null);
  p.box({
    l0: n.l0, d0: n.d0, l1: n.l1, d1: n.d1, h: n.h, wall: n.wall, roof: n.roof, kind: "gable", across: true,
    front, side, back,
    lip: (k, w) => (k === w >> 1 || k === (w >> 1) - 1 ? hx("#4a3222") : n.wall),
    deco: () => {
      if (p.o >= 2) return; // side-on: the ridge runs across the screen
      // the steep gable over the visible end wall (front for S, back for N)
      const [ax, ay] = p.S(n.l0, n.d0), [bx, by] = p.S(n.l1, n.d1);
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y1 = Math.max(ay, by), y0 = Math.min(ay, by);
      const yb = y1 - n.h; // row above the wall
      const c2 = x0 + x1;
      const half = (x1 - x0) / 2;
      const rise = Math.min(n.rise, yb - y0);
      for (let k = 0; k <= rise; k++) {
        const hw = half * (1 - k / (rise + 0.5));
        for (let x = x0; x <= x1; x++) {
          const off = Math.abs(2 * x - c2) / 2;
          if (off > hw + 0.01) continue;
          const eave = off > hw - 1; // the bargeboard / raking trim
          let c: RGB = eave ? shade(n.roof, 0.8) : k === 0 ? shade(n.wall, 0.9) : shade(n.wall, 0.96);
          if (!eave && rose && p.o === 0 && k === Math.max(1, rise >> 1) && Math.abs(2 * x - c2) <= 1) c = lancet(p, x, 1, n.stained, 5);
          p.scr(x, yb - k, c, 3);
        }
      }
    },
  });
}

/**
 * A steeple sprite: gold cross, spire, belfry (louvred), then `shaft`
 * rows of tower. The base row carries the door only when the tower's
 * front faces the camera (street S).
 */
function steeple(spire: number, shaft: number, frontDoor: boolean, w3: boolean): string[] {
  const rows: string[] = w3 ? [".+.", "+++", ".+."] : ["..+..", ".+++.", "..+.."];
  // a TAPERED spire: needle top, then flaring to the belfry's width
  for (let i = 0; i < spire; i++) {
    const k = spire - i; // rows left
    if (w3) rows.push(k > 1 ? ".s." : "sSs");
    else rows.push(k > 3 ? "..s.." : k > 1 ? ".sSs." : "sSSSs");
  }
  if (w3) { rows.push("WkW", "ccc"); }
  else { rows.push("oWkWo", "oWkWo", "ccccc"); }
  for (let i = 0; i < shaft; i++) {
    const last = i === shaft - 1;
    if (w3) rows.push(frontDoor && last ? "WDw" : "WWw");
    else rows.push(frontDoor && last ? "oDDwo" : frontDoor && i === shaft - 2 ? "oaawo" : i === 1 ? "oWgwo" : "oWWwo");
  }
  return rows;
}

function steeplePal(p: Plan, wall: RGB, roof: RGB): Record<string, RGB> {
  const snowy = RS.season === "winter";
  return {
    "+": GOLD,
    s: snowy ? M.snow : roof,
    S: shade(roof, 0.8),
    W: wall,
    w: shade(wall, 0.84),
    k: p.lit ? hx("#6a5a3a") : hx("#2a2622"), // belfry louvres
    c: shade(wall, 1.06), // belfry cornice
    D: hx("#4a3222"),
    o: shade(wall, 0.7), // tower arrises (reads against a same-colour gable)
    g: p.lit ? C.windowLit : M.glass, // the tower's lancet
    a: p.lit ? C.windowLit : hx("#cc9933"), // fanlight over the door
  };
}

/** screen anchor for a tower footprint [l0..l1]×[d0..d1]: bottom-centre */
function towerAnchor(p: Plan, l0: number, d0: number, l1: number, d1: number): [number, number] {
  const [ax, ay] = p.S(l0, d0), [bx, by] = p.S(l1, d1);
  return [(ax + bx) >> 1, Math.max(ay, by)];
}

// ------------------------------------------------------------ CHURCH

/**
 * The steepled town church: a steep-roofed nave (white clapboard, red
 * brick or limestone by hash) with a full-height ENTRY TOWER projecting
 * from the middle of its front gable — the door in the tower's base under
 * a fanlight, the louvred belfry, a tall spire and a gold cross. Stained
 * lancets down both flanks, a rose window in the gable. Churchyard lawn,
 * the front walk, shade trees and the lettered notice board.
 */
export function church(p: Plan): void {
  const { L, D } = p;
  const v = p.h(1) % 3;
  const wall = [M.clapboard, M.brick, M.limestone][v]!;
  const roof = [hx("#5c5d62"), hx("#4a4e56"), hx("#6a5a4e")][v]!;
  const fr = p.D - 2;
  const wide = L >= 16;
  const deep = D >= 16;
  const nl0 = wide ? 3 : 1, nl1 = wide ? L - 4 : L - 2;
  const nd0 = 1, nd1 = deep ? D - 7 : D - 4;
  const mid = (nl0 + nl1) >> 1;
  p.lawn(1, 1, L - 2, fr);
  p.walk(mid, nd1 + 1, fr);
  const h = deep ? 4 : 3;
  nave(p, { l0: nl0, l1: nl1, d0: nd0, d1: nd1, h, wall, roof, stained: true, rise: deep ? 4 : 3 }, false, true);
  // the entry tower projecting from the front gable
  const td0 = nd1 - 1, td1 = Math.min(fr - 2, nd1 + 2);
  const [tx, ty] = towerAnchor(p, mid - 2, td0, mid + 2, td1);
  const shaft = p.o === 0 ? h + 2 : h + 1;
  const spire = deep ? 6 : 4;
  const rows = steeple(spire, shaft, p.o === 0, false);
  p.sprAt(tx, ty, rows, steeplePal(p, wall, roof), -1, p.o === 1 ? -0.25 : 0.75, true);
  if (wide && deep) {
    p.tree(1, 3, true, 3);
    p.tree(L - 2, 5, false, 4);
    p.tree(L - 2, fr - 2, true, 5);
  }
  // notice board ("SUNDAY 9:30 & 11") on the lawn
  const sl = mid + 3 <= L - 2 ? mid + 3 : mid - 3;
  p.spr(sl, fr, ["NNN", ".|."], { N: p.lit ? C.windowLit : hx("#f0ece0"), "|": M.door }, 1);
}

// ------------------------------------------------------------ CHAPEL

/**
 * A real country chapel: white clapboard, a STEEP gable roof, a small
 * steeple (belfry + spire + cross) riding the front of the ridge, round-
 * headed windows down the flanks and a pair in the front gable, a front
 * door with steps and a little gabled hood. Siding and roof by hash.
 */
export function chapel(p: Plan): void {
  const { L, D } = p;
  const wall = [M.clapboard, hx("#f0ece2"), hx("#e8e2cc")][p.h(1) % 3]!;
  const roof = [hx("#6a6c70"), hx("#7a4a3a"), hx("#4a5a4a")][p.h(2) % 3]!;
  const deep = D >= 16;
  const wide = L >= 16;
  const fr = p.D - 2;
  const nl0 = wide ? 4 : 1, nl1 = wide ? L - 5 : L - 2;
  const nd0 = deep ? 2 : 1, nd1 = deep ? D - 6 : D - 4;
  const mid = (nl0 + nl1) >> 1;
  p.lawn(1, 1, L - 2, fr);
  p.walk(mid, nd1 + 1, fr);
  // front steps
  p.g(mid, nd1 + 1, shade(M.concreteLight, 0.95));
  p.g(mid + 1, nd1 + 1, shade(M.concreteLight, 0.95));
  const h = deep ? 3 : 2;
  // clapboard courses: every other wall row a touch darker
  nave(p, { l0: nl0, l1: nl1, d0: nd0, d1: nd1, h, wall, roof, stained: false, rise: deep ? 5 : 3 }, true, false);
  // the steeple rides the ridge at the FRONT end of the roof
  const [ax, ay] = p.S(nl0, nd0), [bx, by] = p.S(nl1, nd1);
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
  const pal = steeplePal(p, wall, roof);
  const rows = steeple(deep ? 4 : 3, 1, false, true);
  let sx: number, sy: number;
  if (p.o === 0) { sx = (x0 + x1) >> 1; sy = y1 - h - 1; }
  else if (p.o === 1) { sx = (x0 + x1) >> 1; sy = y0 + 2; }
  else { sx = p.o === 2 ? x1 - 2 : x0 + 2; sy = ((y0 + y1 - h) >> 1); }
  p.sprAt(sx, sy, rows, pal, -1, 500, true);
  if (wide && deep) {
    p.tree(1, 4, true, 7);
    p.tree(L - 2, fr - 2, false, 8);
  }
  // the little board by the walk
  p.spr(mid + 3 <= L - 2 ? mid + 3 : mid - 2, fr, ["NN", "|."], { N: hx("#f0ece0"), "|": M.door }, 0);
}
