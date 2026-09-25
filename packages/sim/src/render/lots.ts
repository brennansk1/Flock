/**
 * Downtown & civic lot art (Stage 2, renderer pass 2), authored on the plan
 * kit (plan.ts): each lot is ONE building filling its whole footprint,
 * facing its street in all four frontages, with hash variants (palette,
 * roof, signage) plus winter and night states.
 *
 * Every author works for the footprint's main AND alt size in either
 * orientation — layouts are computed from the local canvas L × D.
 */
import { hexToRgb, shade, type RGB } from "../palette.js";
import { C, RS, pixHash } from "./core.js";
import { EMISSIVE } from "./grade.js";
import { householdPaint, householdVehicle } from "./vehicles.js";
import { M, mix, type Plan, type Face } from "./plan.js";

const hx = hexToRgb;

// ------------------------------------------------------------ helpers

/** a lit / dark pane (lit panes hashed per building) */
export function pane(p: Plan, u: number, r: number, salt = 0, dark: RGB = M.glass): RGB {
  return p.lit && pixHash(p.seed, u * 7 + r * 131, 77 + salt) % 3 !== 0 ? C.windowLit : dark;
}
/** 1-px pseudo-lettering on a sign band */
export function letters(u: number, n: number, bg: RGB, fg: RGB, pad = 1): RGB {
  const k = u - pad;
  if (k < 0 || u > n - 1 - pad) return bg;
  return k % 2 === 0 && k % 8 !== 6 ? fg : bg;
}
/** the "sidewalk" row inside the ring toward the street is d = D-2 */
const FRONT = (p: Plan): number => p.D - 2;

/** parked cars in a row of nose-in stalls (stall pitch 3 along l) */
function stallRow(p: Plan, l0: number, l1: number, dNose: number, toStreet: boolean, occ: number, salt: number): void {
  for (let l = l0; l + 1 <= l1; l += 3) {
    // stall stripe
    for (let k = 0; k < 3; k++) p.g(l - 1, toStreet ? dNose - k : dNose + k, M.stripe);
    const h = p.h(l * 13 + dNose, salt);
    if (h % 100 >= occ) continue;
    const kind = householdVehicle(h);
    // centre: 3–4 long cars; nose at dNose
    p.carDir(l, toStreet ? dNose - 1 : dNose + 1, toStreet ? 2 : 3, kind, householdPaint(h >>> 4));
  }
}
export function occupancy(): number {
  return RS.time === "night" ? 15 : RS.time === "dusk" ? 35 : RS.time === "dawn" ? 20 : 55;
}

// ------------------------------------------------------------ BANK

/**
 * Columned bank + drive-up teller lane. Variants: limestone temple front ·
 * red brick with white columns · 1970s brown-brick modern with bronze
 * glass fins. A time-and-temperature sign on a pole by the lane.
 */
export function bank(p: Plan): void {
  const { L, D } = p;
  const v = p.h(1) % 3;
  const wall = [M.limestone, M.brick, M.brickBrown][v]!;
  const col = v === 2 ? hx("#cfc4ae") : hx("#f4f0e6");
  const deep = D >= 16;
  const wide = L >= 16;
  const laneW = wide ? 4 : 0;
  const laneL0 = L - 1 - laneW, laneL1 = L - 2;
  const bl0 = 1, bl1 = wide ? laneL0 - 2 : L - 2;
  const bd0 = 1, bd1 = deep ? D - 7 : D - 4;
  const fr = FRONT(p);
  // ground: plaza / lawn in front, the drive-up lane at the side
  p.lawn(bl0, bd1 + 1, bl1, fr);
  const cxl = ((bl0 + bl1) >> 1);
  p.pave(cxl - 1, bd1 + 1, cxl + 2, fr, "concrete");
  if (wide) {
    p.pave(laneL0, 1, laneL1, fr, "asphalt");
    for (let d = 2; d <= fr; d += 2) p.g(laneL0, d, M.stripe); // lane edge
  }
  const h = deep ? 4 : 2;
  const recess = hx("#4a4238");
  const front: Face = (u, r, n, hh) => {
    if (r === 0) return letters(u, n, shade(wall, 1.1), v === 2 ? hx("#e8c070") : hx("#8a7a5a"), 2);
    if (r === hh - 1 && hh >= 3) return shade(col, 0.9); // steps / plinth
    const doorU = n >> 1;
    if ((u === doorU || u === doorU - 1) && r >= hh - 2) return hx("#3a2e22");
    if (v === 2) return u % 2 === 0 ? shade(wall, 0.9) : pane(p, u, r, 1, M.glassBronze);
    return u % 2 === 1 ? col : recess; // colonnade
  };
  p.box({
    l0: bl0, d0: bd0, l1: bl1, d1: bd1, h, wall,
    roof: v === 2 ? M.tar : v === 1 ? M.slate : hx("#8c877e"),
    kind: v === 1 ? "hip" : "flat",
    front,
    side: (u, r, n, hh) => (r === 0 ? shade(wall, 1.08) : u % 3 === 1 && r < hh - 1 ? pane(p, u, r, 2) : null),
    lip: (k) => (k % 2 === 1 ? col : shade(wall, 0.8)),
    deco: () => {
      // rooftop: HVAC and (classical) a pediment over the door
      p.top(bl0 + 2, bd0 + 1, M.hvac);
      if (v !== 2 && p.o === 0) {
        const [x, y] = p.S(cxl, bd1 - h);
        const ped = shade(col, 0.96);
        for (let i = -2; i <= 3; i++) p.scr(x + i, y, ped, 2);
        for (let i = -1; i <= 2; i++) p.scr(x + i, y - 1, shade(ped, 1.05), 2);
        p.scr(x, y - 2, ped, 2); p.scr(x + 1, y - 2, ped, 2);
      }
    },
  });
  if (wide) {
    // drive-up canopy over the teller lane, pneumatic-tube island beside it
    const cd0 = deep ? 3 : 1, cd1 = deep ? 6 : 3;
    const brand = v === 2 ? hx("#6a4a2a") : hx("#2f5a4a");
    p.box({
      l0: laneL0, d0: cd0, l1: laneL1, d1: cd1, h: 1, wall: brand, roof: shade(wall, 1.05), noShadow: false,
      front: (u, _r, n) => (u === 0 || u === n - 1 ? M.steel : brand),
      side: () => brand,
      lip: () => brand,
    });
    if (deep) p.obj(laneL0 + 1, cd1 + 1, M.hvac);
    const hc = p.h(7);
    if (hc % 2 === 0) p.carDir(laneL0 + 2, cd1 + (deep ? 3 : 2), 2, householdVehicle(hc), householdPaint(hc >>> 3));
    // time & temperature sign on a pole at the lane mouth
    const amber: RGB = p.lit ? EMISSIVE.hazard : hx("#c89030");
    const blink = (RS.tick >> 5) & 1;
    p.spr(laneL1, fr, ["SSS", blink ? "a.a" : ".a.", "S|S", ".|.", ".|."], { S: hx("#2a2826"), a: amber, "|": M.steel }, 1);
  } else {
    p.flagpole(bl1, fr);
  }
  p.lamp(bl0 + 1, fr);
}

// ------------------------------------------------------------ POST OFFICE

/**
 * WPA-era brick federal post office: symmetric five-bay front, limestone
 * cornice, granite steps, hipped slate roof (cupola by hash), flagpole
 * with the flag, a blue collection box at the curb and the loading dock
 * + a white postal Jeep round the back.
 */
export function postOffice(p: Plan): void {
  const { L, D } = p;
  const buff = p.h(1) % 3 === 0;
  const wall = buff ? M.brickBuff : M.brick;
  const lime = hx("#e0d8c4");
  const deep = D >= 16;
  const wide = L >= 16;
  const dockW = wide ? 4 : 0;
  const bl0 = 1, bl1 = L - 2 - dockW;
  const bd0 = deep ? 2 : 1, bd1 = deep ? D - 6 : D - 4;
  const fr = FRONT(p);
  const cxl = (bl0 + bl1) >> 1;
  p.lawn(bl0, bd1 + 1, bl1, fr);
  p.pave(cxl - 1, bd1 + 1, cxl + 2, fr, "concrete");
  // loading dock drive down the side to the rear apron
  if (wide) {
    p.pave(L - 1 - dockW, 1, L - 2, fr, "asphalt");
    if (deep) {
      p.box({ l0: L - 1 - dockW, d0: 1, l1: L - 2, d1: 3, h: 1, wall: shade(M.concrete, 0.85), roof: M.concrete, front: (u) => (u % 2 ? hx("#4a4a4a") : shade(M.concrete, 0.8)), lip: () => shade(M.concrete, 0.8) });
      // the postal Jeep (DJ-5): white with the red/blue stripe
      p.carDir(L - 3, 7, 3, "kcar", hx("#ece8dc"));
    }
  }
  const h = deep ? 3 : 2;
  const cupola = p.h(2) % 2 === 0;
  p.box({
    l0: bl0, d0: bd0, l1: bl1, d1: bd1, h, wall,
    roof: cupola ? M.slate : hx("#6a5a52"),
    kind: "hip",
    front: (u, r, n, hh) => {
      if (r === 0) return lime; // cornice
      const doorU = n >> 1;
      if ((u === doorU || u === doorU - 1) && r >= hh - 2) return r === hh - 1 ? hx("#3a2e22") : shade(lime, 0.9);
      if (r === hh - 1 && hh >= 3) return u % 2 === 0 ? pane(p, u, r, 3) : wall;
      return u % 2 === 0 && u > 0 && u < n - 1 ? pane(p, u, r, 3) : wall;
    },
    side: (u, r) => (r === 0 ? lime : u % 2 === 0 && u > 0 ? pane(p, u, r, 4) : null),
    back: (u, r, n, hh) => (r === 0 ? lime : u === n >> 1 && r >= hh - 2 ? C.door : null),
    lip: (k, n) => (k === n >> 1 || k === (n >> 1) - 1 ? hx("#3a2e22") : lime),
    deco: () => {
      if (cupola && deep) {
        const [x, y] = p.S(cxl, bd0 + 2);
        p.sprAt(x + 1, y + 1, ["w", "W", "W"], { w: shade(M.white, 1.05), W: M.white }, 0, 200);
      }
    },
  });
  // granite steps at the door
  const [sx, sy] = p.S(cxl, bd1 + 1);
  void sx; void sy;
  p.g(cxl, bd1 + 1, shade(lime, 0.9));
  p.g(cxl + 1, bd1 + 1, shade(lime, 0.9));
  p.flagpole(deep ? bl0 + 1 : bl0, deep ? fr - 1 : fr, deep ? 7 : 5);
  // blue collection box at the curb
  p.obj(cxl + 3, fr, hx("#2a4f9a"));
  if (deep) p.tree(bl1 - 1, fr - 1, false, 3);
}

// ------------------------------------------------------------ OFFICE

/**
 * Two/three-storey office block with RIBBON windows (continuous glass bands
 * between spandrels) — never a grey slab. Variants: 70s brown brick with
 * bronze glass · white precast with dark ribbons · tan with teal glass (the
 * 1984 look). Rooftop mechanical penthouse; monument sign; side lot.
 */
export function office(p: Plan): void {
  const { L, D } = p;
  const v = p.h(1) % 3;
  const spandrel = [M.brickBrown, hx("#e4e0d6"), hx("#c8b89a")][v]!;
  const glass = [M.glassBronze, hx("#2e3440"), hx("#3e6e74")][v]!;
  const deep = D >= 16;
  const storeys = deep ? 2 + (p.h(2) % 2) : 2;
  const h = storeys * 2;
  const bl0 = 1, bl1 = L - 2;
  const bd0 = 1, bd1 = deep ? D - 5 : D - 3;
  const fr = FRONT(p);
  p.lawn(bl0, bd1 + 1, bl1, fr);
  const cxl = (bl0 + bl1) >> 1;
  p.pave(cxl - 1, bd1 + 1, cxl + 1, fr, "concrete");
  p.box({
    l0: bl0, d0: bd0, l1: bl1, d1: bd1, h, wall: spandrel, roof: hx("#8a857c"), kind: "flat",
    front: (u, r, n, hh) => {
      if (r === hh - 1 && (u === n >> 1 || u === (n >> 1) - 1)) return hx("#2a2622"); // lobby doors
      if (u === 0 || u === n - 1) return shade(spandrel, 0.92); // end piers
      return r % 2 === 1 ? pane(p, u, r, 5, glass) : spandrel; // ribbon / spandrel
    },
    side: (u, r, n) => (u === 0 || u === n - 1 ? null : r % 2 === 1 ? pane(p, u, r, 6, glass) : spandrel),
    back: (u, r, n) => (u === 0 || u === n - 1 ? null : r % 2 === 1 ? pane(p, u, r, 7, glass) : spandrel),
    lip: (k, n) => (k === 0 || k === n - 1 ? spandrel : glass),
    deco: () => {
      // mechanical penthouse + HVAC
      const pl = bl0 + 2 + (p.h(3) % 3);
      p.top(pl, bd0 + 1, M.concrete); p.top(pl + 1, bd0 + 1, M.concrete); p.top(pl + 2, bd0 + 1, shade(M.concrete, 0.8));
      p.top(pl, bd0 + 2, shade(M.concrete, 0.8)); p.top(pl + 1, bd0 + 2, shade(M.concrete, 0.8));
      p.top(bl1 - 2, bd0 + 1, M.hvac);
    },
  });
  // monument sign on the lawn + shrubs
  p.obj(bl0 + 1, fr, shade(spandrel, 0.8)); p.obj(bl0 + 2, fr, shade(spandrel, 0.8));
  p.obj(bl1 - 1, fr, C.bush); p.obj(bl1 - 2, fr, C.bush);
  if (deep) p.tree(bl1 - 1, fr - 1, false, 5);
}

// ------------------------------------------------------------ LIBRARY

/**
 * Carnegie library: buff/limestone block on a raised basement, a projecting
 * columned portico with a pediment, a broad flight of steps, tall windows
 * flanking; roof by hash: red clay-tile hip · slate hip · flat with a
 * copper dome. Lamp standards flank the steps; a book drop by the walk.
 */
export function library(p: Plan): void {
  const { L, D } = p;
  const v = p.h(1) % 3;
  const wall = v === 1 ? hx("#b8a07a") : M.limestone;
  const col = hx("#f2eee4");
  const deep = D >= 16;
  const bl0 = 2, bl1 = L - 3;
  const bd0 = deep ? 2 : 1, bd1 = deep ? D - 7 : D - 4;
  const fr = FRONT(p);
  const cxl = (bl0 + bl1) >> 1;
  p.lawn(1, bd1 + 1, L - 2, fr);
  p.walk(cxl, bd1 + 1, fr);
  const h = deep ? 3 : 2;
  const roof = v === 0 ? M.tileRed : v === 1 ? M.slate : hx("#8c877e");
  p.box({
    l0: bl0, d0: bd0, l1: bl1, d1: bd1, h, wall, roof, kind: v === 2 ? "flat" : "hip",
    front: (u, r, n, hh) => {
      if (r === 0) return shade(wall, 1.1);
      if (r === hh - 1 && hh >= 3) return shade(wall, 0.85); // raised basement
      return (u % 3 === 1) ? pane(p, u, r, 8) : null; // tall windows
    },
    side: (u, r) => (r === 0 ? shade(wall, 1.1) : u % 3 === 1 ? pane(p, u, r, 9) : null),
    lip: (k, n) => (Math.abs(k - (n >> 1)) <= 2 ? (k % 2 ? col : hx("#5a5044")) : shade(wall, 1.05)),
    deco: () => {
      if (v === 2) {
        // the copper dome over the reading room
        const [x, y] = p.S(cxl, bd0 + 2);
        const cu = RS.season === "winter" ? M.snow : M.copper;
        p.sprAt(x + 1, y + 1, [".c.", "ccC", "CCC"], { c: shade(cu, 1.12), C: shade(cu, 0.9) }, 1, 200);
      }
    },
  });
  // the portico: projecting columned porch with its pediment
  if (deep) {
    const pl0 = cxl - 2, pl1 = cxl + 3;
    p.box({
      l0: pl0, d0: bd1 - 2, l1: pl1, d1: bd1 + 1, h: 3, wall: col, roof: shade(roof, 1.05), kind: "gable", across: true,
      front: (u, r, n, hh) => (r === 0 ? col : r === hh - 1 ? shade(col, 0.9) : u % 2 === 0 ? col : hx("#5a5044")),
      side: (u, r) => (r === 0 ? col : u % 2 === 0 ? col : hx("#5a5044")),
      lip: (k) => (k % 2 ? col : hx("#5a5044")),
      noShadow: true,
    });
    // steps
    for (let l = pl0; l <= pl1; l++) { p.g(l, bd1 + 2, shade(col, 0.92)); p.g(l, bd1 + 3, shade(col, 0.84)); }
    p.lamp(pl0 - 1, bd1 + 3);
    p.lamp(pl1 + 1, bd1 + 3);
    p.tree(1, bd1 + 3, false, 11);
    p.tree(L - 2, bd1 + 3, false, 12);
  } else {
    p.g(cxl, bd1 + 1, shade(col, 0.9)); p.g(cxl + 1, bd1 + 1, shade(col, 0.9));
    p.lamp(cxl - 1, fr);
  }
  p.obj(cxl + 3, fr, hx("#4a5a7a")); // book drop
}

// ------------------------------------------------------------ CHAPEL

/**
 * Clapboard chapel: gable-FRONT (ridge runs away from the street), a small
 * belfry + spire over the front gable, an arched door and lancet windows,
 * a signboard on the lawn. Siding and roof by hash.
 */
export function chapel(p: Plan): void {
  const { L, D } = p;
  const sid = [M.clapboard, hx("#e8dcb0"), hx("#c8d0d8")][p.h(1) % 3]!;
  const roof = [M.shingle, hx("#3f5a44"), hx("#7a3a30")][p.h(2) % 3]!;
  const deep = D >= 16;
  const bl0 = L >= 16 ? (L >> 1) - 3 : 1, bl1 = L >= 16 ? (L >> 1) + 2 : L - 2;
  const bd0 = deep ? 3 : 1, bd1 = deep ? D - 5 : D - 3;
  const fr = FRONT(p);
  const cxl = (bl0 + bl1) >> 1;
  p.walk(cxl, bd1 + 1, fr);
  p.box({
    l0: bl0, d0: bd0, l1: bl1, d1: bd1, h: 2, wall: sid, roof, kind: "gable", across: true,
    front: (u, r, n) => (u === n >> 1 || u === (n >> 1) - 1 ? (r === 0 ? hx("#4a3a2a") : hx("#3a2a1e")) : r === 0 && (u === 1 || u === n - 2) ? pane(p, u, r, 10, hx("#6a5a8a")) : null),
    side: (u, r, n) => (u % 2 === 1 && u < n - 1 && r === 0 ? pane(p, u, r, 11, hx("#6a5a8a")) : null),
    lip: (k, n) => (k === n >> 1 || k === (n >> 1) - 1 ? hx("#3a2a1e") : sid),
  });
  // belfry + spire over the front gable end
  const [x, y] = p.S(cxl, bd1 - (deep ? 4 : 2));
  const bell = RS.season === "winter" ? M.snow : roof;
  p.sprAt(x + 1, y, ["g", "s", "b", "B", "B"], { g: C.landmarkGold, s: shade(bell, 1.1), b: shade(sid, 0.85), B: sid }, 0, 300);
  // sign board on the lawn
  if (deep) {
    p.obj(bl0 - 1 < 1 ? bl1 + 1 : bl0 - 1, fr - 1, hx("#f0ece0"));
    p.obj(bl0 - 1 < 1 ? bl1 + 1 : bl0 - 1, fr, M.door);
    if (L >= 16) { p.tree(1, bd0 + 2, false, 21); p.tree(L - 2, bd0 + 4, true, 22); }
  }
}

// ------------------------------------------------------------ CINEMA

/**
 * Single-screen movie palace: tall plain-brick auditorium behind; on the
 * street a projecting MARQUEE (white letter board framed by CHASER bulbs
 * that march on the frame clock), poster cases flanking the doors, a
 * ticket booth, and a tall vertical BLADE sign rising above the roof in
 * neon. Variants: deco cream + red neon · brick + cyan neon · pink stucco.
 */
export function cinema(p: Plan): void {
  const { L, D } = p;
  const v = p.h(1) % 3;
  const wall = [hx("#e2d2a8"), M.brick, hx("#d8a8a0")][v]!;
  const neon = [EMISSIVE.neonPink, EMISSIVE.neonCyan, EMISSIVE.hazard][v]!;
  const neonDay = [hx("#c83a4a"), hx("#3a8ab0"), hx("#d89030")][v]!;
  const deep = D >= 16;
  const bl0 = 1, bl1 = L - 2;
  const bd0 = 1, bd1 = deep ? D - 5 : D - 3;
  const fr = FRONT(p);
  const tick = RS.tick;
  p.pave(bl0, bd1 + 1, bl1, fr, "terrazzo");
  const bulb = (i: number): RGB => ((i + (tick >> 1)) % 3 === 0 ? (p.lit ? EMISSIVE.hazard : hx("#fff0b0")) : hx("#b89040"));
  const lipC = (k: number): RGB => (k % 2 === 0 ? bulb(k) : (p.lit ? neon : neonDay));
  // auditorium (tall, plain side brick with a pilaster rhythm)
  p.box({
    l0: bl0, d0: bd0, l1: bl1, d1: bd1, h: deep ? 5 : 3, wall, roof: M.tar, kind: "flat",
    front: (u, r, n, hh) => {
      // lobby front: marquee board across rows 0..1, then doors + poster cases
      if (r === 0) return bulb(u); // the chaser border
      if (r === 1) return u === 0 || u === n - 1 ? bulb(u + 1) : letters(u, n, p.lit ? hx("#fff8e8") : hx("#f0ece0"), hx("#2a2622"), 1);
      if (r === 2 && hh > 3) return u === 0 || u === n - 1 ? bulb(u + 2) : shade(neonDay, 0.9); // marquee soffit
      const mid = n >> 1;
      if (u >= mid - 1 && u <= mid) return r === hh - 1 ? hx("#2a2622") : hx("#8a6a3a"); // ticket booth
      if ((u === mid - 3 || u === mid + 2) && r === hh - 1) return hx("#3a2e22"); // doors
      if ((u === 1 || u === n - 2) && r >= hh - 2) return p.lit ? C.windowLit : hx("#c8b060"); // poster cases
      return null;
    },
    side: (u, r, n) => (u === n - 1 && r <= 1 ? bulb(r) : u % 3 === 0 ? shade(wall, 0.9) : null),
    back: (u, r, n, hh) => (u === 2 && r >= hh - 2 ? C.door : null),
    lip: lipC,
    deco: () => {
      p.top(bl0 + 2, bd0 + 1, M.hvac);
      p.top(bl1 - 2, bd0 + 2, M.hvac);
    },
  });
  // the vertical BLADE sign at the front, rising above the roof
  const bladeL = bl0 + 2;
  const [x, y] = p.S(bladeL, bd1 - (deep ? 4 : 2));
  const rows = deep ? ["n", "N", "n", "N", "n", "N", "|"] : ["n", "N", "n", "N"];
  const flick = (tick >> 2) % 7 === 0;
  p.sprAt(x, y, rows, {
    n: p.lit ? neon : neonDay,
    N: p.lit ? (flick ? neonDay : hx("#fff8e8")) : hx("#f0ece0"),
    "|": M.steel,
  }, 0, 300);
  // poster-case glow spills onto the terrazzo at night
  if (p.lit) { p.g(bl0 + 1, bd1 + 1, shade(C.windowLit, 0.7)); p.g(bl1 - 1, bd1 + 1, shade(C.windowLit, 0.7)); }
}

// ------------------------------------------------------------ DINER

/**
 * Chrome diner car: long stainless body with rounded ends, a continuous
 * window band over a red enamel stripe, a barrel roof and a neon rooftop
 * EAT sign; a brick kitchen annex with its exhaust hood beside it.
 */
export function diner(p: Plan): void {
  const { L, D } = p;
  const steel = hx("#c8ccd2");
  const stripe = [M.red, hx("#2a6ab0"), hx("#2f7a4a")][p.h(1) % 3]!;
  const wide = L >= 16;
  const deep = D >= 16;
  const fr = FRONT(p);
  const bd0 = deep ? D - 8 : 1, bd1 = fr - 1;
  const cl0 = 1, cl1 = wide ? 10 : L - 2;
  if (deep) p.pave(1, 1, L - 2, bd0 - 1, "asphalt");
  p.pave(cl0, bd1 + 1, L - 2, fr, "concrete");
  p.box({
    l0: cl0, d0: bd0, l1: cl1, d1: bd1, h: 3, wall: steel, roof: hx("#b8bcc4"), kind: "barrel",
    front: (u, r, n) => {
      if (r === 0) return u === 0 || u === n - 1 ? shade(steel, 0.9) : u === 2 ? hx("#8ab0c8") : u % 3 === 0 ? steel : pane(p, u, 0, 12, hx("#3a4a5a"));
      if (r === 1) return stripe;
      return u % 2 ? shade(steel, 0.8) : shade(steel, 0.9);
    },
    side: (u, r) => (r === 1 ? stripe : r === 0 && u % 2 === 1 ? pane(p, u, 0, 13, hx("#3a4a5a")) : null),
    back: (_u, r) => (r === 1 ? stripe : null),
    lip: () => stripe,
    deco: () => {
      // round the car's ends: knock the corner pixels back to ground
      const [ax, ay] = p.S(cl0, bd0), [bx, by] = p.S(cl1, bd1);
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by);
      p.clear(x0, y0); p.clear(x1, y0);
    },
  });
  if (wide) {
    const brick = p.h(2) % 2 ? M.brick : hx("#d8cbb0");
    p.box({
      l0: cl1 + 1, d0: bd0, l1: L - 2, d1: bd1, h: 2, wall: brick, roof: M.tar,
      front: (u, r, n) => (u === n - 2 && r >= 0 ? C.door : r === 0 && u === 1 ? pane(p, u, r, 14) : null),
      deco: () => { p.top(cl1 + 2, bd0 + 1, M.hvac); p.top(cl1 + 3, bd0 + 1, shade(M.hvac, 0.8)); },
    });
  }
  // rooftop EAT sign
  const [x, y] = p.S((cl0 + cl1) >> 1, bd0 + 1);
  const on = p.lit && ((RS.tick >> 3) + p.seed) % 9 !== 0;
  p.sprAt(x, y, ["rrrrr", "rWrWr", ".|.|."], { r: on ? EMISSIVE.neonPink : stripe, W: on ? EMISSIVE.beaconWhite : M.white, "|": M.steel }, -1, 300);
  if (deep) {
    const hc = p.h(9);
    if (hc % 100 < occupancy()) p.carDir(4, 4, 3, householdVehicle(hc), householdPaint(hc >>> 3));
  }
}

// ------------------------------------------------------------ SUPERMARKET

/**
 * Supermarket: a big flat box with a shingled mansard fascia (the 70s–80s
 * grocery look) carrying a big sign, a glass storefront with IN / OUT
 * doors at the ends, cart corrals, and its customer lot in front with
 * stalls, cars and lamp standards.
 */
export function supermarket(p: Plan): void {
  const { L, D } = p;
  const v = p.h(1) % 3;
  const sign = [M.red, hx("#2f7a3a"), hx("#2a4f9a")][v]!;
  const wall = [hx("#d8cbb0"), hx("#c8b89a"), M.white][v]!;
  const mansard = hx("#6a4a3a");
  const deep = D >= 16;
  const bl0 = 1, bl1 = L - 2;
  const bd0 = 1, bd1 = deep ? 7 : D - 3;
  const fr = FRONT(p);
  // the lot
  if (fr > bd1) {
    p.pave(bl0, bd1 + 1, bl1, fr, "asphalt");
    if (fr - bd1 >= 5) {
      stallRow(p, bl0 + 2, bl1 - 1, fr, false, occupancy(), 3);
      p.lamp(bl0 + 1, bd1 + 3);
      p.lamp(bl1 - 1, bd1 + 3);
    }
  }
  p.box({
    l0: bl0, d0: bd0, l1: bl1, d1: bd1, h: 3, wall, roof: hx("#9a948a"), kind: "flat",
    front: (u, r, n) => {
      if (r === 0) {
        // mansard fascia with the big sign in the middle
        const mid = n >> 1, half = Math.max(3, n >> 2);
        if (Math.abs(u - mid) <= half) return letters(u - (mid - half), half * 2 + 1, sign, p.lit ? hx("#fff8e8") : M.white, 1);
        return u % 2 ? mansard : shade(mansard, 0.85);
      }
      if (r === 1) return u === 2 || u === n - 3 ? hx("#8ab0c8") : u === 0 || u === n - 1 ? wall : pane(p, u, 1, 15, hx("#4a5a6a"));
      return u === 2 || u === n - 3 ? hx("#6a8aa0") : u % 4 === 0 ? wall : hx("#8a8478"); // carts / base
    },
    side: (u, r) => (r === 0 ? mansard : u % 5 === 2 ? shade(wall, 0.85) : null),
    back: (u, r, n) => (u === 2 && r >= 1 ? hx("#4a4a4a") : u === 5 && r >= 1 ? hx("#4a4a4a") : u === n - 3 && r === 2 ? M.hvac : null),
    lip: (k, n) => {
      const mid = n >> 1, half = Math.max(3, n >> 2);
      return Math.abs(k - mid) <= half ? letters(k - (mid - half), half * 2 + 1, sign, M.white, 1) : mansard;
    },
    deco: () => {
      for (let l = bl0 + 3; l < bl1 - 1; l += 5) p.top(l, bd0 + 2, M.hvac);
      if (bd1 - bd0 >= 6) for (let l = bl0 + 5; l < bl1 - 1; l += 5) p.top(l, bd0 + 4, shade(M.hvac, 0.9));
    },
  });
  // cart corral
  if (fr - bd1 >= 3) { p.obj(bl0 + 1, bd1 + 1, M.steel); p.obj(bl0 + 2, bd1 + 1, M.steel); }
}

// ------------------------------------------------------------ GAS STATION

/**
 * 80s service station: tall pole sign with the brand and a price board,
 * a flat canopy over two pump islands (pumps glimpsed under the fascia),
 * a white enamel-panel office with two service-bay doors, air pump, tire
 * stack, oil-can display. Brands are generic 80s liveries by hash.
 */
export function gasStation(p: Plan): void {
  const { L, D } = p;
  const b = p.h(1) % 4;
  const brandA = [hx("#c8342a"), hx("#e8c040"), hx("#e07a2a"), hx("#2f7a3a")][b]!;
  const brandB = [hx("#23386a"), hx("#c8342a"), hx("#2a4f9a"), M.white][b]!;
  const deep = D >= 16;
  const fr = FRONT(p);
  p.pave(1, 1, L - 2, fr, "concrete");
  const panel = M.white;
  // office + bays at the rear (deep) or side (shallow)
  const ol0 = 1, ol1 = deep ? Math.min(L - 2, 10) : Math.min(L - 2, 6);
  const od0 = 1, od1 = deep ? 5 : D - 3;
  p.box({
    l0: ol0, d0: od0, l1: ol1, d1: od1, h: 2, wall: panel, roof: shade(brandB, 1.1), kind: "flat",
    front: (u, r, n) => {
      if (r === 0) return letters(u, n, brandA, M.white, 1);
      if (u <= 2) return pane(p, u, r, 16, hx("#4a6a88")); // office window
      if (u === 3) return C.door;
      return (u - 4) % 3 === 2 ? panel : hx("#8a9098"); // bay doors
    },
    lip: (k) => (k % 3 === 0 ? M.white : brandA),
  });
  // canopy over the pump islands
  const cl0 = deep ? 3 : ol1 + 2, cl1 = L - 3;
  const cd0 = deep ? 8 : 1, cd1 = deep ? fr - 3 : fr - 2;
  if (cl1 - cl0 >= 3) {
    const pump = hx("#d8d4c8");
    p.box({
      l0: cl0, d0: cd0, l1: cl1, d1: cd1, h: 2, wall: hx("#4a4844"), roof: M.white, kind: "flat",
      front: (u, r, n) => {
        if (r === 0) return u % 4 === 1 ? brandB : brandA; // fascia stripes
        return u === 0 || u === n - 1 ? M.steel : (u % 4 === 2 ? pump : u % 4 === 3 ? brandA : hx("#4a4844")); // pumps under the canopy
      },
      side: (u, r) => (r === 0 ? brandA : u % 3 === 1 ? pump : null),
      back: (u, r) => (r === 0 ? brandA : u % 4 === 2 ? pump : null),
      lip: (k) => (k % 4 === 1 ? brandB : brandA),
      deco: () => {
        if (p.lit) {
          // the canopy's downlights wash the apron
          const [ax, ay] = p.S(cl0, cd1), [bx, by] = p.S(cl1, cd1);
          void ax; void bx; void ay; void by;
        }
      },
    });
    // a car at the pump
    const hc = p.h(4);
    if (hc % 100 < occupancy() + 20) p.carDir((cl0 + cl1) >> 1, cd1 + 2, hc & 1 ? 0 : 1, householdVehicle(hc), householdPaint(hc >>> 3));
    // lit apron under the canopy at night
    if (p.lit) for (let l = cl0; l <= cl1; l++) p.g(l, cd1 + 1, hx("#e8dcb0"));
  }
  // air pump, tire stack, oil cans by the bays
  p.obj(ol1 + 1, od1, hx("#c8342a"));
  p.obj(ol1 + 1, od1 - 1, M.dark);
  p.obj(ol0, od1 + 1, hx("#2a2826"));
  // the tall pole sign at the street corner (brand + price board)
  const on = p.lit;
  const rows = deep
    ? ["AAA", "ABA", "AAA", "ppp", ".|.", ".|.", ".|.", ".|."]
    : ["AAA", "ABA", "ppp", ".|.", ".|."];
  p.spr(L - 2, fr, rows, {
    A: brandA, B: on && b !== 3 ? EMISSIVE.beaconWhite : brandB,
    p: on ? EMISSIVE.hazard : hx("#f0ece0"), "|": M.steel,
  }, 1, 400);
}

export { mix };
