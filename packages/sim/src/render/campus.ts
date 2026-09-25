/**
 * Schools and civic grounds on the plan kit (Stage 2, renderer pass 2):
 * the consolidated HIGH SCHOOL, the ELEMENTARY school with its blacktop,
 * the PLAYGROUND and the CEMETERY. See plan.ts for the frame conventions.
 */
import { hexToRgb, shade, type RGB } from "../palette.js";
import { C, RS, pixHash } from "./core.js";
import { EMISSIVE } from "./grade.js";
import { M, turf, type Plan } from "./plan.js";
import { pane, letters } from "./lots.js";

const hx = hexToRgb;

const SCHOOL_COLORS: readonly [RGB, RGB][] = [
  [hx("#7a2a34"), hx("#e8c040")], // maroon & gold
  [hx("#23386a"), hx("#f0ece0")], // navy & white
  [hx("#2f6a3a"), hx("#e8c040")], // green & gold
  [hx("#d8742a"), hx("#2a2826")], // orange & black
];

/** a letter-board sign on two posts ("GO TIGERS · HOMECOMING FRI") */
function letterBoard(p: Plan, l: number, d: number, frame: RGB): void {
  const lit = p.lit;
  p.spr(l, d, ["FFFFF", "FwkwF", "|...|"], { F: frame, w: lit ? C.windowLit : M.white, k: hx("#2a2622"), "|": M.steel }, -1, 50);
}

/** swing set · slide · jungle gym · sandbox kit (shared by schools + playgrounds) */
function swings(p: Plan, l: number, d: number): void {
  const frame = hx("#c05a3a");
  const sw = (RS.tick >> 3) & 1;
  p.spr(l, d, ["fffff", "f.s.f", sw ? "f.k.f" : "fk.kf"], { f: frame, s: hx("#3a3632"), k: hx("#3a3632") }, 0, 10);
  p.g(l + 2, d + 1, shade(M.dirt, 0.95)); // worn patch under the swings
}
function slide(p: Plan, l: number, d: number): void {
  const st = hx("#c8ccd2");
  p.spr(l, d, ["h.", "hs", ".s", "..s"].map((r) => r.padEnd(3, ".")), { h: hx("#3f7fbf"), s: st }, 0, 10);
}
function jungleGym(p: Plan, l: number, d: number): void {
  const bar = hx("#d8b040");
  p.spr(l, d, [".b.b.", "bbbbb", "b.b.b", "bbbbb"], { b: bar }, 0, 10);
}
function sandbox(p: Plan, l: number, d: number): void {
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    const edge = i === 0 || i === 3 || j === 0 || j === 2;
    p.g(l + i, d + j, edge ? C.plank : p.winter ? M.snow : C.sand);
  }
}
function merryGoRound(p: Plan, l: number, d: number): void {
  const k = (RS.tick >> 2) & 3;
  const cols = [hx("#c8342a"), hx("#e8c040"), hx("#3f7fbf"), hx("#2f7a3a")];
  p.obj(l, d, cols[k]!); p.obj(l + 1, d, cols[(k + 1) & 3]!);
  p.obj(l + 1, d + 1, cols[(k + 2) & 3]!); p.obj(l, d + 1, cols[(k + 3) & 3]!);
}

// ------------------------------------------------------------ HIGH SCHOOL

/**
 * Consolidated 1960s–80s high school: a long, low red-brick classroom wing
 * with one continuous RIBBON of windows, a flat entrance canopy and a
 * taller GYM wing at one end (clerestory band, school-colour emblem);
 * flat roofs crowded with HVAC. Out front: lawn, flagpole, the letter-
 * board sign and the bus loop with a yellow bus at the curb.
 */
export function highSchool(p: Plan): void {
  const { L, D } = p;
  const [c1, c2] = SCHOOL_COLORS[p.h(1) % SCHOOL_COLORS.length]!;
  const brick = [M.brick, M.brickBrown, hx("#a85a3e")][p.h(2) % 3]!;
  const fr = p.D - 2;
  const gymW = Math.max(6, Math.min(10, (L / 4) | 0));
  const gymLeft = p.h(3) % 2 === 0;
  const wl0 = gymLeft ? gymW + 1 : 1, wl1 = gymLeft ? L - 2 : L - 2 - gymW;
  const gl0 = gymLeft ? 1 : L - 1 - gymW, gl1 = gymLeft ? gymW : L - 2;
  const deep = D >= 16;
  const bd0 = deep ? 2 : 1, bd1 = deep ? D - 7 : D - 3;
  // grounds: lawn, then the bus loop along the street
  p.lawn(1, bd1 + 1, L - 2, fr);
  if (deep) {
    p.pave(wl0, fr - 2, wl1, fr - 1, "asphalt");
    p.carDir(wl0 + 5, fr - 1, 0, "bus", hx("#e8b020"), RS.tick, true);
  }
  const cxl = (wl0 + wl1) >> 1;
  p.walk(cxl, bd1 + 1, deep ? fr - 3 : fr);
  const coping = shade(brick, 1.22);
  p.box({
    l0: wl0, d0: bd0, l1: wl1, d1: bd1, h: 3, wall: brick, roof: M.tar, kind: "flat",
    front: (u, r, n) => {
      if (r === 0) return coping;
      if (r === 1) return u % 5 === 0 ? shade(brick, 0.9) : pane(p, u, r, 20, hx("#3a4a5e")); // the ribbon
      const m = (cxl - wl0);
      if (u === m || u === m + 1) return hx("#2a2622");
      return null;
    },
    side: (u, r) => (r === 0 ? coping : r === 1 && u % 4 !== 0 ? pane(p, u, r, 21, hx("#3a4a5e")) : null),
    back: (u, r, n) => (r === 0 ? coping : r === 1 && u % 5 !== 0 ? pane(p, u, r, 22, hx("#3a4a5e")) : u === n >> 1 && r === 2 ? C.door : null),
    lip: (k) => (k % 5 === 0 ? brick : hx("#3a4a5e")),
    deco: () => {
      for (let l = wl0 + 2; l < wl1 - 1; l += 4) p.top(l, bd0 + 1 + ((l >> 2) & 1) * 2, M.hvac);
    },
  });
  // entrance canopy
  if (deep) {
    p.box({ l0: cxl - 2, d0: bd1 + 1, l1: cxl + 3, d1: bd1 + 2, h: 1, wall: hx("#6a6660"), roof: M.white, noShadow: false, front: (u) => (u === 0 || u === 5 ? M.steel : c1), lip: () => c1 });
  }
  // gym: taller, clerestory band, school emblem
  const gh = deep ? 5 : 3;
  p.box({
    l0: gl0, d0: bd0 - (deep ? 1 : 0), l1: gl1, d1: bd1 + (deep ? 1 : 0), h: gh, wall: shade(brick, 0.92), roof: hx("#8a8a86"), kind: "barrel",
    front: (u, r, n, hh) => {
      if (r === 0) return coping;
      if (r === 1) return u % 2 === 0 ? pane(p, u, r, 23, hx("#4a5a6e")) : shade(brick, 0.92); // clerestory
      const mid = n >> 1;
      if (hh >= 4 && r >= 2 && r <= 3 && (u === mid || u === mid - 1)) return r === 2 ? c1 : c2; // emblem
      if (r === hh - 1 && (u === 1 || u === n - 2)) return hx("#2a2622");
      return null;
    },
    side: (u, r) => (r === 0 ? coping : r === 1 && u % 2 === 0 ? pane(p, u, r, 24, hx("#4a5a6e")) : null),
    lip: (k) => (k % 2 === 0 ? c1 : coping),
  });
  // flagpole and letter board out front
  if (deep) {
    p.flagpole(gymLeft ? wl1 - 2 : wl0 + 2, fr - 3, 7);
    letterBoard(p, gymLeft ? wl0 + 3 : wl1 - 3, fr - 3, c1);
    p.tree(gymLeft ? L - 3 : 2, bd1 + 2, true, 30);
  } else {
    p.flagpole(wl0 + 1, fr, 5);
  }
}

// ------------------------------------------------------------ ELEMENTARY SCHOOL

/**
 * Post-war elementary school: a low buff-brick classroom wing with bands
 * of windows over COLOURED panels (turquoise / mustard / coral), a bell
 * cupola on the older ones, and the fenced blacktop beside it with
 * painted four-square / hopscotch lines, swings, a slide and a jungle gym.
 */
export function school(p: Plan): void {
  const { L, D } = p;
  const panel = [hx("#4a9a9a"), hx("#d8a83a"), hx("#d8745a")][p.h(1) % 3]!;
  const brick = p.h(2) % 3 === 0 ? M.brick : M.brickBuff;
  const old = p.h(3) % 3 === 0;
  const fr = p.D - 2;
  const deep = D >= 16;
  const playW = L >= 24 ? 9 : L >= 16 ? 6 : 0;
  const playRight = p.h(4) % 2 === 0;
  const bl0 = playRight ? 1 : 1 + playW + 1, bl1 = playRight ? L - 3 - playW : L - 2;
  const pl0 = playRight ? L - 1 - playW : 1, pl1 = playRight ? L - 2 : playW;
  const bd0 = deep ? 2 : 1, bd1 = deep ? D - 6 : D - 3;
  p.lawn(bl0, bd1 + 1, bl1, fr);
  const cxl = (bl0 + bl1) >> 1;
  p.walk(cxl, bd1 + 1, fr);
  p.box({
    l0: bl0, d0: bd0, l1: bl1, d1: bd1, h: 2, wall: brick, roof: old ? M.shingle : hx("#7a746a"), kind: old ? "hip" : "flat",
    front: (u, r, n) => {
      const m = cxl - bl0;
      if (u === m || u === m + 1) return r === 0 ? M.white : hx("#2a2622");
      if (r === 0) return u % 3 === 0 ? brick : pane(p, u, r, 25, hx("#3a4a5a"));
      return u % 3 === 0 ? brick : panel;
    },
    side: (u, r) => (r === 0 && u % 3 !== 0 ? pane(p, u, r, 26) : r === 1 && u % 3 !== 0 ? panel : null),
    back: (u, r) => (r === 0 && u % 3 !== 0 ? pane(p, u, r, 27) : null),
    lip: (k) => (k % 3 === 0 ? brick : panel),
    deco: () => { if (!old) { p.top(bl0 + 2, bd0 + 1, M.hvac); p.top(bl1 - 2, bd0 + 2, M.hvac); } },
  });
  if (old) {
    const [x, y] = p.S(cxl, bd0 + 2);
    p.sprAt(x + 1, y, ["w", "b", "W"], { w: RS.season === "winter" ? M.snow : M.white, b: C.landmarkGold, W: M.white }, 0, 200);
  }
  // blacktop + play equipment
  if (playW > 0) {
    const d0 = deep ? 2 : 1;
    p.pave(pl0, d0, pl1, fr - 1, "asphalt");
    const line = hx("#e8d27a");
    // four-square + hopscotch
    for (let i = 0; i < 5; i++) { p.g(pl0 + 1 + i, fr - 2, line); p.g(pl0 + 1, fr - 6 + i, line); p.g(pl0 + 5, fr - 6 + i, line); }
    p.g(pl0 + 3, fr - 4, line); p.g(pl0 + 3, fr - 5, line); p.g(pl0 + 2, fr - 4, line); p.g(pl0 + 4, fr - 4, line);
    if (deep) {
      swings(p, pl0 + 1, d0 + 3);
      if (playW >= 8) { jungleGym(p, pl0 + 6, d0 + 4); slide(p, pl0 + 6, fr - 3); }
      else slide(p, pl0 + 4, d0 + 4);
    }
    // chain-link on the lot sides
    const fence = hx("#a8a49a");
    for (let d = d0; d <= fr; d++) p.g(playRight ? pl1 : pl0, d, d % 2 ? fence : shade(fence, 0.85));
  }
  p.flagpole(playRight ? bl0 + 1 : bl1 - 1, fr, deep ? 6 : 4);
  if (deep) p.obj(cxl + 3, fr, hx("#c8342a")); // bike rack
}

// ------------------------------------------------------------ PLAYGROUND

/** Neighbourhood playground: wood-chip ground under real equipment. */
export function playground(p: Plan): void {
  const { L, D } = p;
  const chips = hx("#b0906a");
  p.fill(1, 1, L - 2, D - 2, (l, d) => {
    const [X, Y] = p.gx(l, d);
    if (p.winter) return pixHash(X, Y, 5) % 5 === 0 ? hx("#c8c0b0") : M.snow;
    return pixHash(X, Y, 5) % 4 === 0 ? shade(chips, 0.88) : pixHash(X, Y, 6) % 7 === 0 ? shade(chips, 1.1) : chips;
  });
  // timber border
  for (let l = 1; l <= L - 2; l++) { p.g(l, 1, C.plankDark); p.g(l, D - 2, C.plankDark); }
  for (let d = 1; d <= D - 2; d++) { p.g(1, d, C.plankDark); p.g(L - 2, d, C.plankDark); }
  if (D >= 16 || L >= 16) {
    const deepAxis = D >= L;
    if (deepAxis) {
      swings(p, 1, 5);
      jungleGym(p, 2, 10);
      slide(p, 2, 13);
      sandbox(p, 4, 11);
      merryGoRound(p, 5, 5);
    } else {
      swings(p, 1, 4);
      jungleGym(p, 7, 5);
      slide(p, 12, 4);
      sandbox(p, 10, 2);
      merryGoRound(p, 3, 3);
    }
  } else {
    swings(p, 1, 4);
    slide(p, 5, 5);
    sandbox(p, 2, 4);
  }
  // a bench for the parents
  p.obj(L - 3, D - 3, C.plank); p.obj(L - 4, D - 3, C.plankDark);
}

// ------------------------------------------------------------ CEMETERY

/**
 * Churchyard / town cemetery: mown turf, a gravel lane in from the street
 * gate with a cross path, headstone rows with family gaps (grey and white
 * stones, a few obelisks, flowers on some graves), cedars and a maple, an
 * iron fence or a clipped hedge, and a small limestone mausoleum by hash.
 */
export function cemetery(p: Plan): void {
  const { L, D } = p;
  p.fill(1, 1, L - 2, D - 2, (l, d) => p.turfAt(l, d));
  const hedge = p.h(1) % 2 === 0;
  const fence = hedge ? (p.winter ? hx("#4a6048") : hx("#2e5a2a")) : hx("#2a2826");
  const gate = (L >> 1) - 1;
  for (let l = 1; l <= L - 2; l++) {
    p.g(l, 1, fence);
    if (l < gate || l > gate + 1) p.g(l, D - 2, fence);
  }
  for (let d = 1; d <= D - 2; d++) { p.g(1, d, fence); p.g(L - 2, d, fence); }
  const gravel = p.winter ? hx("#d0d4d6") : hx("#c9c2b2");
  // lane from the gate + a cross path
  for (let d = 2; d <= D - 2; d++) { p.g(gate, d, gravel); p.g(gate + 1, d, gravel); }
  const crossD = D >= 16 ? (D >> 1) - 1 : -1;
  if (crossD > 0) for (let l = 2; l <= L - 3; l++) p.g(l, crossD, gravel);
  const stone = hx("#cbd0d4"), stoneDark = hx("#8c9296"), white = hx("#eceae4");
  const flowers = [hx("#c8342a"), hx("#e8c040"), hx("#e8a0c0")];
  for (let d = 3; d <= D - 4; d += 3) {
    if (d === crossD || d - 1 === crossD) continue;
    for (let l = 3; l <= L - 4; l += 2) {
      if (l === gate || l === gate + 1 || l === gate - 1) continue;
      const h = pixHash(p.seed, l * 64 + d, 61);
      if (h % 9 === 0) continue; // a family gap
      const c = h % 5 === 0 ? white : h % 5 === 1 ? stoneDark : stone;
      if (h % 23 === 0) {
        p.spr(l, d, ["c", "c"], { c: white }, 0, 1); // obelisk
      } else p.obj(l, d, c);
      p.shadowPx(...p.S(l, d + 1));
      if (!p.winter && h % 7 === 0) p.g(l, d + 1, flowers[h % 3]!);
    }
  }
  // trees + an optional mausoleum at the back
  p.tree(2, 2, false, 40);
  if (L >= 16) p.tree(L - 3, D >= 16 ? (D >> 1) : 2, true, 41);
  if (L >= 16 && D >= 16 && p.h(2) % 2 === 0) {
    p.box({ l0: gate - 1, d0: 2, l1: gate + 2, d1: 4, h: 1, wall: M.limestone, roof: shade(M.limestone, 0.9), kind: "gable", across: true, front: (u, _r, n) => (u === n >> 1 || u === (n >> 1) - 1 ? hx("#4a4238") : null) });
  }
  void turf;
}

export { EMISSIVE, letters };
