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
import { C, RS, pixHash, lotOccupancy, stallVisit } from "./core.js";
import { EMISSIVE } from "./grade.js";
import { householdPaint, householdVehicle } from "./vehicles.js";
import { M, mix, type Plan, type Face } from "./plan.js";
import { chainLink } from "./works.js";

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
    const h = stallVisit(p.seed * 131 + l * 13 + dNose + salt * 7, occ);
    if (h < 0) continue;
    const kind = householdVehicle(h);
    // centre: 3–4 long cars; nose at dNose
    p.carDir(l, toStreet ? dNose - 1 : dNose + 1, toStreet ? 2 : 3, kind, householdPaint(h >>> 4));
  }
}
export function occupancy(): number {
  return lotOccupancy(8);
}

// ------------------------------------------------------------ BANK

/**
 * Old-time NEOCLASSICAL bank (the 1900s "temple of money" every county
 * seat kept): a gable-front temple whose street end is a full PEDIMENT
 * with a round CLOCK in the tympanum, over an entablature lettered in
 * bronze, a colonnade of granite COLUMNS, BRONZE doors in the middle bay
 * and a run of granite steps. A drive-up teller lane (added in the 60s)
 * runs down the side under a small canopy, and a green cast-iron post
 * clock stands at the curb. Variants: Indiana limestone · grey granite ·
 * white marble (roof lead-grey or verdigris copper).
 */
export function bank(p: Plan): void {
  const { L, D } = p;
  const v = p.h(1) % 3;
  const stone = [M.limestone, hx("#b8b8b4"), hx("#ece6da")][v]!;
  const col = [hx("#f2eee4"), hx("#d8d8d2"), hx("#fbf8f0")][v]!;
  const colShade = shade(col, 0.82);
  const bronze = hx("#8a6230"), bronzeD = hx("#5e4020");
  const recess = hx("#3e3a34");
  const deep = D >= 16;
  const wide = L >= 20;
  const laneW = wide ? 4 : 0;
  const laneL0 = L - 1 - laneW, laneL1 = L - 2;
  const bl0 = wide ? 2 : 1, bl1 = wide ? laneL0 - 2 : L - 2;
  const bd0 = 1, bd1 = deep ? D - 6 : D - 4;
  const fr = FRONT(p);
  const cxl = (bl0 + bl1) >> 1;
  // ground: lawn panels either side of a granite plaza; steps at the portico
  p.lawn(1, bd1 + 1, bl1 + 1, fr);
  p.pave(cxl - 3, bd1 + 1, cxl + 4, fr, "concrete");
  for (let l = bl0; l <= bl1; l++) p.g(l, bd1 + 1, (l & 1) ? shade(col, 0.9) : shade(col, 0.84)); // granite steps
  if (wide) {
    p.pave(laneL0, 1, laneL1, fr, "asphalt");
    for (let d = 2; d <= fr; d += 2) p.g(laneL0, d, M.stripe);
  }
  const h = deep ? 5 : 3;
  const n2 = (n: number): number => n >> 1;
  /** the temple front: entablature, colonnade, plinth (pediment in deco) */
  const front: Face = (u, r, n, hh) => {
    const mid = n2(n);
    if (r === 0) return letters(u, n, shade(stone, 1.06), bronzeD, 3); // entablature
    if (r === hh - 1) return u % 2 ? shade(col, 0.9) : shade(col, 0.84); // stylobate
    // bronze doors in the middle bay
    if ((u === mid || u === mid - 1) && r >= hh - 3) return r === hh - 3 ? bronze : (u === mid ? bronze : bronzeD);
    // columns on a 3-px rhythm: lit shaft + shaded fluting, dark bays
    const k = (u - 1) % 3;
    if (u === 0 || u === n - 1) return stone; // corner antae
    if (k === 0) return r === 1 ? shade(col, 1.06) : col;
    if (k === 1) return colShade;
    return r === 1 ? shade(recess, 1.2) : pane(p, u, r, 1, recess);
  };
  const roofC = shade(stone, 0.78);
  p.box({
    l0: bl0, d0: bd0, l1: bl1, d1: bd1, h, wall: stone, roof: roofC, kind: "flat",
    front,
    deco: () => {
      // parapet balustrade round the flat roof
      for (let l = bl0; l <= bl1; l++) { p.top(l, bd0, shade(col, 0.95)); }
      p.top(cxl - 3, bd0 + 2, M.hvac);
      if (p.o !== 0) return;
      // the PEDIMENT: a low wide triangle over the colonnade, raking
      // cornice, tympanum, and the bank's round clock in its heart
      const x0 = bl0, x1 = bl1, yb = bd1 - h; // row above the wall
      const cx2 = x0 + x1; // 2× centre
      const half = (x1 - x0) / 2;
      const rise = Math.min(4, bd1 - h - bd0);
      for (let k = 0; k <= rise; k++) {
        const hw = half * (1 - k / (rise + 0.6));
        for (let x = x0; x <= x1; x++) {
          const off = Math.abs(2 * x - cx2) / 2;
          if (off > hw) continue;
          const edge = off > hw - 1.3 || k === 0;
          p.scr(x, yb - k, edge ? shade(col, k === 0 ? 0.94 : 1.05) : shade(stone, 0.7), 2);
        }
      }
      // clock: 3-px white dial with bronze rim, dark hands
      const mx = cx2 >> 1, my = yb - 2;
      p.scr(mx, my - 1, hx("#f8f4e6"), 2);
      p.scr(mx - 1, my, hx("#f8f4e6"), 2); p.scr(mx, my, M.dark, 2); p.scr(mx + 1, my, hx("#f8f4e6"), 2);
      p.scr(mx, my + 1, hx("#f8f4e6"), 2);
      p.scr(mx + ((RS.tick >> 6) & 1), my - 1, M.dark, 2); // the minute hand creeps
    },
    back: (u, r, n, hh) => {
      if (r === 0) return shade(stone, 1.06);
      if (u === n2(n) && r >= hh - 2) return C.door;
      return u % 3 === 1 && r < hh - 1 ? pane(p, u, r, 2) : null;
    },
    side: (u, r, n, hh) => {
      if (r === 0) return shade(stone, 1.06); // entablature runs round
      if (r === hh - 1) return shade(col, 0.86);
      // the portico's side columns at the street end, pilasters + tall windows behind
      if (u >= n - 4) return (u - n) % 2 === 0 ? col : recess;
      if (u % 3 === 0) return shade(stone, 1.05);
      return u % 3 === 1 && r >= 1 && r <= hh - 2 ? pane(p, u, r, 3) : null;
    },
    lip: (k) => (k % 3 === 0 ? col : k % 3 === 1 ? colShade : recess),
  });
  if (wide) {
    // drive-up canopy + teller island on the lane (the 60s addition)
    const cd0 = deep ? 3 : 1, cd1 = deep ? 6 : 3;
    p.box({
      l0: laneL0, d0: cd0, l1: laneL1, d1: cd1, h: 1, wall: stone, roof: shade(stone, 1.05),
      front: (u, _r, n) => (u === 0 || u === n - 1 ? col : hx("#3a3632")),
      side: () => stone,
      lip: () => stone,
    });
    const hc = p.h(7);
    if ((hc % 100) < occupancy() + 15) p.carDir(laneL0 + 2, cd1 + (deep ? 3 : 2), 3, householdVehicle(hc), householdPaint(hc >>> 3));
  }
  // cast-iron post clock at the curb (lit dial after dark)
  const dial = p.lit ? EMISSIVE.headlight : hx("#f6f2e2");
  const iron = hx("#2c4a36");
  p.spr(wide ? bl1 + 1 : bl0 + 1, fr, [".g.", "gWg", "gkg", ".g.", ".|.", ".|.", ".|."], { g: iron, W: dial, k: M.dark, "|": iron }, 1);
  p.flagpole(bl0 < 2 ? bl1 : bl0, deep ? fr - 1 : fr, deep ? 7 : 5);
  p.lamp(cxl - 3, fr);
  p.lamp(cxl + 4, fr);
}

// ------------------------------------------------------------ SHERIFF

/**
 * County sheriff's office: a tan-brick 1970s station with a navy
 * department band and the gold star, a glass lobby entry, the flag, a
 * taller JAIL WING behind with barred slit windows, a comms whip on the
 * roof, and a chain-link CRUISER LOT beside it holding two or three
 * black-and-white cruisers whose bubble lights flash (with a night bloom).
 * The patrol car (traffic.ts) is the one that's out.
 */
export function sheriff(p: Plan): void {
  const { L, D } = p;
  const wall = p.h(1) % 2 ? hx("#c8b48e") : hx("#b89a78");
  const navy = hx("#2a3a5e"), gold = hx("#e0b840");
  const wide = L >= 20;
  const fr = FRONT(p);
  const lotW = wide ? 8 : 6;
  const ll0 = L - 1 - lotW, ll1 = L - 2; // cruiser lot
  const bl0 = 1, bl1 = ll0 - 2;
  const deep = D >= 16;
  const jd1 = deep ? 5 : 3; // jail wing (rear)
  const od0 = jd1 + 1, od1 = deep ? D - 5 : D - 3; // office block (front)
  const cxl = (bl0 + bl1) >> 1;
  // ground: lawn + entry walk, the fenced lot
  p.lawn(bl0, od1 + 1, bl1 + 1, fr);
  p.walk(cxl, od1 + 1, fr);
  p.pave(ll0, 1, ll1, fr, "asphalt");
  chainLink(p, ll0, 1, ll1, fr - 1, true);
  // the jail wing: taller, blank brick, barred slits
  p.box({
    l0: bl0, d0: 1, l1: bl1 - 2, d1: jd1 + 1, h: deep ? 4 : 3, wall: shade(wall, 0.92), roof: M.tar, kind: "flat",
    front: (u, r, n, hh) => (r === 0 ? shade(wall, 1.05) : u % 2 === 1 && r >= 1 && r < hh - 1 ? (r === 1 ? M.dark : hx("#4a4a50")) : null),
    side: (u, r, _n, hh) => (u % 2 === 1 && r >= 1 && r < hh - 1 ? M.dark : null),
    back: (u, r, _n, hh) => (u % 2 === 1 && r >= 1 && r < hh - 1 ? M.dark : null),
    deco: () => { p.top(bl0 + 2, 2, M.hvac); p.top(bl0 + 3, 2, shade(M.hvac, 0.85)); },
  });
  // the office block with the navy band and the gold star over the doors
  p.box({
    l0: bl0, d0: od0, l1: bl1, d1: od1, h: deep ? 3 : 2, wall, roof: hx("#8a8278"), kind: "flat",
    front: (u, r, n, hh) => {
      const mid = n >> 1;
      if (r === 0) return u === mid || u === mid - 1 ? gold : letters(u, n, navy, hx("#d8dce8"), 2);
      if ((u === mid || u === mid - 1) && r >= hh - 2) return p.lit ? C.windowLit : hx("#5a7a98"); // glass lobby doors
      return u % 3 === 1 ? pane(p, u, r, 30) : null;
    },
    side: (u, r) => (r === 0 ? navy : u % 3 === 1 ? pane(p, u, r, 31) : null),
    back: (u, r, n, hh) => (r === 0 ? navy : u === n - 2 && r >= hh - 2 ? C.door : null),
    lip: (k, n) => (k === n >> 1 || k === (n >> 1) - 1 ? gold : navy),
    deco: () => {
      // the comms whip on the roof: steel mast, red lamp at the tip
      const [x, y] = p.S(bl0 + 1, od0 + 1);
      const on = ((RS.tick >> 3) & 1) === 0;
      p.sprAt(x, y, ["r", "|", "|", "|", "|"], { r: on ? EMISSIVE.beacon : hx("#5a1a1a"), "|": M.steel }, 0, 400);
    },
  });
  p.flagpole(cxl + 2, fr - 1, deep ? 7 : 5);
  p.lamp(bl0 + 1, fr);
  // the cruisers: 3 by day, 2 at night / on a shift change, lights flashing
  // in desynced pairs; each rides its own stall across the lot
  const n = 2 + (((RS.tick >> 10) + p.h(5)) % 2 === 0 && !p.night ? 1 : 0);
  const stalls = deep ? [3, 7, 11] : [3, 7];
  const cl = (ll0 + ll1 + 1) >> 1;
  for (let i = 0; i < Math.min(n, stalls.length); i++) {
    const d = stalls[i]!;
    for (let l = ll0 + 1; l < ll1; l++) p.g(l, d + 2, M.stripe);
    p.carDir(cl, d, (i + p.h(6)) & 1, "cruiser", hx("#1e1d1c"), RS.tick + i * 3, false, p.lit);
  }
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
  // USPS blue trim + sign band, the white "sonic eagle" mark
  const usps = hx("#1f4e9a"), uspsD = hx("#173a74"), eagle = hx("#f4f4f0");
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
      const doorU = n >> 1;
      if (r === 0) {
        // the blue sign band: lettering either side of the eagle mark
        if (u === doorU - 1 || u === doorU) return eagle;
        if (u === doorU - 2 || u === doorU + 1) return usps;
        return letters(u, n, usps, eagle, 1);
      }
      if ((u === doorU || u === doorU - 1) && r >= hh - 2) return r === hh - 1 ? hx("#3a2e22") : usps; // blue door frame + transom
      if ((u === doorU - 2 || u === doorU + 1) && r >= 1) return uspsD; // blue door surround
      if (r === hh - 1 && hh >= 3) return u % 2 === 0 ? pane(p, u, r, 3) : wall;
      return u % 2 === 0 && u > 0 && u < n - 1 ? pane(p, u, r, 3) : wall;
    },
    side: (u, r) => (r === 0 ? usps : u % 2 === 0 && u > 0 ? pane(p, u, r, 4, uspsD) : null),
    back: (u, r, n, hh) => (r === 0 ? lime : u === n >> 1 && r >= hh - 2 ? usps : null),
    lip: (k, n) => (k === n >> 1 || k === (n >> 1) - 1 ? eagle : letters(k, n, usps, eagle, 1)),
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
  // blue collection boxes at the curb + the blue-and-white eagle sign
  p.spr(cxl + 3, fr, ["bb", "BB"], { b: usps, B: uspsD }, 0);
  p.spr(cxl - 2, fr, ["BBB", "BeB", ".|."], { B: usps, e: eagle, "|": M.steel }, 1);
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
  // spandrel / glass pairs with real contrast so the ribbons read
  const spandrel = [hx("#a8785a"), hx("#e4e0d6"), hx("#d0c0a0")][v]!;
  const glass = [hx("#2e2620"), hx("#2e3440"), hx("#2e5a62")][v]!;
  const deep = D >= 16;
  const storeys = deep ? (p.h(2) % 3 === 0 ? 2 : 3) : 2;
  const h = storeys * 2;
  const bl0 = 1, bl1 = L - 2;
  const bd0 = 1, bd1 = deep ? D - 5 : D - 3;
  const fr = FRONT(p);
  p.lawn(bl0, bd1 + 1, bl1, fr);
  const cxl = (bl0 + bl1) >> 1;
  p.pave(cxl - 1, bd1 + 1, cxl + 1, fr, "concrete");
  p.box({
    l0: bl0, d0: bd0, l1: bl1, d1: bd1, h, wall: spandrel, roof: hx("#6e6a64"), kind: "flat",
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
  const lit = p.lit;
  p.pave(bl0, bd1 + 1, bl1, fr, "terrazzo");
  // chaser bulbs: every third bulb dark, the gap marching on the clock
  const bulb = (i: number): RGB => ((i + (tick >> 1)) % 3 === 0 ? (lit ? hx("#6a4a20") : hx("#b89040")) : lit ? EMISSIVE.hazard : hx("#fff0b0"));
  const neonC = lit ? neon : neonDay;
  const board = lit ? EMISSIVE.marqueeBoard : hx("#f0ece0");
  const posters = [EMISSIVE.posterA, EMISSIVE.posterB, EMISSIVE.posterC];
  const poster = (k: number): RGB => (lit ? posters[(k + p.seed) % 3]! : [hx("#b0603a"), hx("#4a6a9a"), hx("#c8a848")][(k + p.seed) % 3]!);
  const lipC = (k: number): RGB => (k % 2 === 0 ? bulb(k) : neonC);
  // auditorium + lobby (tall brick, pilaster rhythm on the sides)
  const mq = deep ? 2 : 1; // marquee depth
  const ad1 = bd1 - mq;
  p.box({
    l0: bl0, d0: bd0, l1: bl1, d1: ad1, h: deep ? 4 : 2, wall, roof: M.tar, kind: "flat",
    front: (u, r, n, hh) => {
      const mid = n >> 1;
      if (r === 0) return shade(wall, 1.1);
      if (u >= mid - 1 && u <= mid) return r === hh - 1 ? (lit ? C.windowLit : hx("#2a2622")) : hx("#8a6a3a"); // ticket booth
      if ((u === mid - 3 || u === mid + 2) && r >= hh - 2) return lit ? C.windowLit : hx("#3a2e22"); // lobby doors
      if ((u === 1 || u === n - 2) && r >= hh - 2) return poster(u + r); // poster cases
      return null;
    },
    side: (u, r, n, hh) => (u >= n - 2 && r >= hh - 2 ? poster(u) : u % 3 === 0 ? shade(wall, 0.9) : r === 0 ? shade(wall, 1.1) : null),
    back: (u, r, n, hh) => (u === 2 && r >= hh - 2 ? C.door : null),
    lip: (k) => (k % 3 === 0 ? shade(wall, 0.9) : wall),
    deco: () => {
      p.top(bl0 + 2, bd0 + 1, M.hvac);
      p.top(bl1 - 2, bd0 + 2, M.hvac);
    },
  });
  // the MARQUEE: projects over the sidewalk; chaser bulbs frame the
  // back-lit letter board (the late-show titles), neon along its top
  p.box({
    l0: bl0 + 1, d0: ad1 + 1, l1: bl1 - 1, d1: bd1 + 1, h: 2, wall: board, roof: neonC, kind: "flat", noSnow: true,
    front: (u, r, n) => (r === 0 ? bulb(u) : u === 0 || u === n - 1 ? bulb(u + 1) : letters(u, n, board, hx("#2a2622"), 1)),
    side: (u, r) => (r === 0 ? bulb(u) : board),
    back: (u) => bulb(u),
    lip: lipC,
    deco: () => {
      const [ax, ay] = p.S(bl0 + 1, ad1 + 1), [bx, by] = p.S(bl1 - 1, bd1 + 1);
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
      for (let x = x0; x <= x1; x++) p.scr(x, y0, bulb(x), 2);
      for (let y = y0; y <= y1; y++) { p.scr(x0, y, bulb(y + 1), 2); p.scr(x1, y, bulb(y + 2), 2); }
    },
  });
  // after dark the marquee floods the terrazzo and sidewalk with light
  if (lit) {
    for (let d = bd1 + 2; d <= fr; d++) {
      for (let l = bl0; l <= bl1; l++) {
        const [X, Y] = p.gx(l, d);
        const near = d <= bd1 + 3 && l > bl0 && l < bl1;
        p.g(l, d, near ? ((X + Y) & 1 ? EMISSIVE.marqueePoolHi : EMISSIVE.marqueePool) : (X + Y) % 3 === 0 ? EMISSIVE.marqueePool : null);
      }
    }
  }
  // the vertical BLADE sign at the front corner, rising above the roof:
  // bulb-chased edges and neon letters that spell out one by one, then
  // the whole blade flashes
  const bladeL = bl0 + 2;
  const nRows = deep ? 10 : 5;
  const [x, y] = p.S(bladeL, ad1 - (deep ? 3 : 1));
  const cyc = (tick >> 2) % (nRows + 6);
  const rows: string[] = [];
  for (let i = 0; i < nRows; i++) {
    const on = !lit || cyc >= nRows + 3 ? cyc % 2 === 0 || !lit : i <= cyc;
    rows.push(`${(i + (tick >> 1)) % 3 === 0 ? "o" : "O"}${on ? "N" : "n"}${(i + 1 + (tick >> 1)) % 3 === 0 ? "o" : "O"}`);
  }
  rows.push(".|.");
  p.sprAt(x, y, rows, {
    n: lit ? shade(neon, 0.55) : neonDay,
    N: lit ? neon : hx("#f0ece0"),
    O: lit ? EMISSIVE.hazard : hx("#e8d8a0"),
    o: lit ? hx("#6a4a20") : hx("#b89040"),
    "|": M.steel,
  }, 1, 300);
  // the late-show crowd: a short queue at the booth after dark
  if (lit) {
    const mid = (bl0 + bl1) >> 1;
    const shirts = [hx("#c8342a"), hx("#2a4f9a"), hx("#e8c040"), hx("#ece8dc"), hx("#3a8a4a")];
    const q = 2 + (((tick >> 6) + p.seed) % 3);
    for (let k = 0; k < q; k++) p.obj(mid - 2 - k, bd1 + 2 + (k & 1), shirts[(k + p.seed) % shirts.length]!);
  }
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
  // a narrow deep lot sets the car END-ON to the street (the classic
  // diner-on-a-side-lot look), kitchen annex behind it
  const endOn = !wide && deep;
  const bd0 = endOn ? 5 : deep ? D - 8 : 1, bd1 = fr - 1;
  const cl0 = 1, cl1 = wide ? 10 : L - 2;
  if (deep && !endOn) p.pave(1, 1, L - 2, bd0 - 1, "asphalt");
  p.pave(cl0, bd1 + 1, L - 2, fr, "concrete");
  if (endOn) {
    const brick = p.h(2) % 2 ? M.brick : hx("#d8cbb0");
    p.box({ l0: 1, d0: 1, l1: L - 2, d1: 4, h: 2, wall: brick, roof: M.tar, front: (u) => (u === 1 ? C.door : null), deco: () => p.top(3, 2, M.hvac) });
  }
  p.box({
    l0: cl0, d0: bd0, l1: cl1, d1: bd1, h: 3, wall: steel, roof: hx("#b8bcc4"), kind: "barrel", across: endOn,
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
  // the 1980s grocery look: a long GREEN sign band (Kroger / IGA / Jewel
  // greens), white letters, the store's red accent stripe under it
  const sign = [hx("#2f7a3a"), hx("#236a44"), hx("#3a8a34")][v]!;
  const accent = [M.red, hx("#e8a030"), M.red][v]!;
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
    l0: bl0, d0: bd0, l1: bl1, d1: bd1, h: 3, wall, roof: hx("#cdc8be"), kind: "flat",
    front: (u, r, n) => {
      if (r === 0) {
        // the full-width green band with the big lettered sign in the middle
        const mid = n >> 1, half = Math.max(3, n >> 2);
        if (Math.abs(u - mid) <= half) return letters(u - (mid - half), half * 2 + 1, sign, p.lit ? EMISSIVE.beaconWhite : M.white, 1);
        return u === 0 || u === n - 1 ? mansard : shade(sign, 0.9);
      }
      if (r === 1 && (u <= 1 || u >= n - 2)) return accent;
      if (r === 1) return u === 2 || u === n - 3 ? hx("#8ab0c8") : u === 0 || u === n - 1 ? wall : pane(p, u, 1, 15, hx("#4a5a6a"));
      return u === 2 || u === n - 3 ? hx("#6a8aa0") : u % 4 === 0 ? wall : hx("#8a8478"); // carts / base
    },
    side: (u, r) => (r === 0 ? shade(sign, 0.9) : u % 5 === 2 ? shade(wall, 0.85) : null),
    back: (u, r, n) => (u === 2 && r >= 1 ? hx("#4a4a4a") : u === 5 && r >= 1 ? hx("#4a4a4a") : u === n - 3 && r === 2 ? M.hvac : null),
    lip: (k, n) => {
      const mid = n >> 1, half = Math.max(3, n >> 2);
      return Math.abs(k - mid) <= half ? letters(k - (mid - half), half * 2 + 1, sign, M.white, 1) : shade(sign, 0.9);
    },
    deco: () => {
      for (let l = bl0 + 3; l < bl1 - 1; l += 5) p.top(l, bd0 + 2, M.hvac);
      if (bd1 - bd0 >= 6) for (let l = bl0 + 5; l < bl1 - 1; l += 5) p.top(l, bd0 + 4, shade(M.hvac, 0.9));
    },
  });
  // carts nested by the doors, and a steel CART CORRAL out in the lot
  // with a few strays (the corral fills up after dark)
  if (fr - bd1 >= 3) {
    p.obj(bl0 + 2, bd1 + 1, M.steel); p.obj(bl0 + 3, bd1 + 1, shade(M.steel, 1.2));
    p.obj(bl1 - 2, bd1 + 1, M.steel); p.obj(bl1 - 3, bd1 + 1, shade(M.steel, 1.2));
  }
  if (fr - bd1 >= 5) {
    const cl = ((bl0 + bl1) >> 1) - 2, cd = bd1 + 3;
    const rail = hx("#8a9096"), cart = hx("#d8dce0");
    const full = p.lit ? 4 : 1 + (p.h(11) % 3);
    for (let k = 1; k < 5; k++) { p.g(cl + k, cd - 1, rail); p.g(cl + k, cd + 1, rail); }
    p.obj(cl, cd - 1, sign); p.obj(cl, cd, rail); p.obj(cl, cd + 1, sign); // green-capped end
    for (let k = 1; k <= full; k++) p.obj(cl + k, cd, (k & 1) ? cart : shade(cart, 0.85));
    if (!p.lit) p.obj(cl + 6 + (p.h(12) % 3), cd + 1, cart); // a stray
  }
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
  const cl0 = deep ? 5 : ol1 + 2, cl1 = L - 3;
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
  p.spr(2, fr, rows, {
    A: brandA, B: on && b !== 3 ? EMISSIVE.beaconWhite : brandB,
    p: on ? EMISSIVE.hazard : hx("#f0ece0"), "|": M.steel,
  }, 1, 400);
}

export { mix };
