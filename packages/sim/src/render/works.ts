/**
 * Industry, farm and waterfront lots on the plan kit (Stage 2, renderer
 * pass 2): substation, water tower, barn, greenhouse, lighthouse, grain
 * elevator, sawmill and cannery. See plan.ts for the frame conventions.
 */
import { Terrain, type World } from "../types.js";
import { hexToRgb, shade, type RGB } from "../palette.js";
import { C, RS, TILE_PX, pixHash } from "./core.js";
import { EMISSIVE } from "./grade.js";
import { M, mix, type Plan } from "./plan.js";
import { pane, letters } from "./lots.js";

const hx = hexToRgb;

/** chain-link fence around [l0..l1]×[d0..d1] with a gate gap on the street side */
function chainLink(p: Plan, l0: number, d0: number, l1: number, d1: number, gate = true): void {
  const f = hx("#a8a49a"), post = hx("#7a7670");
  const gl = (l0 + l1) >> 1;
  for (let l = l0; l <= l1; l++) {
    p.obj(l, d0, l % 3 === 0 ? post : f);
    if (!gate || l < gl - 1 || l > gl + 1) p.obj(l, d1, l % 3 === 0 ? post : f);
  }
  for (let d = d0; d <= d1; d++) { p.obj(l0, d, d % 3 === 0 ? post : f); p.obj(l1, d, d % 3 === 0 ? post : f); }
}

/** smoke puffs rising from a screen point (drifting east on the tick) */
function smoke(p: Plan, x: number, y: number, dense = false): void {
  const t = RS.tick;
  const n = dense ? 4 : 3;
  for (let i = 0; i < n; i++) {
    const age = ((t >> 2) + i * 5) % 12;
    const sx = x + ((age + i) >> 2), sy = y - 1 - (age >> 1);
    const c = mix(hx("#9a968e"), hx("#d8d6d0"), age / 12);
    p.later(-100 + 999, () => p.scr(sx, sy, c));
    if (dense && age < 6) p.later(999, () => p.scr(sx + 1, sy, c));
  }
}

// ------------------------------------------------------------ SUBSTATION

/**
 * Fenced transformer yard: pale crushed-stone pad inside chain-link, a row
 * of dark oil-filled TRANSFORMERS (white bushings on top), the steel
 * A-frame GANTRY carrying the bus over the yard, the brick control house
 * by the gate, a red DANGER sign; a sodium yard light at night.
 */
export function substation(p: Plan): void {
  const { L, D } = p;
  const big = L >= 16 && D >= 16;
  const pad = hx("#b4afa4");
  const e = big ? 2 : 1;
  p.fill(e, e, L - 1 - e, D - 1 - e, (l, d) => {
    const [X, Y] = p.gx(l, d);
    const h = pixHash(X, Y, 91);
    if (p.winter && h % 3) return M.snow;
    return h % 5 === 0 ? shade(pad, 0.9) : h % 7 === 0 ? shade(pad, 1.06) : pad;
  });
  chainLink(p, e, e, L - 1 - e, D - 1 - e);
  const tf = hx("#4e5e52"), tfTop = hx("#6e7e72"), bush = hx("#f0ece4"), steel = hx("#5a5e64");
  // transformers: finned tanks on pads with bushings
  const n = big ? 3 : 1;
  const td = big ? 8 : 4;
  for (let i = 0; i < n; i++) {
    const l = big ? 4 + i * 3 : 3;
    p.box({ l0: l, d0: td, l1: l + 1, d1: td + 1, h: 1, wall: tf, roof: tfTop, noSnow: true, front: (u) => (u % 2 ? shade(tf, 0.8) : tf), lip: () => tf });
    p.spr(l, td, ["b.b"], { b: bush }, 0, 20);
  }
  // the gantry: two A-frame legs and the bus bar across the yard
  if (big) {
    const gd = 5;
    p.spr(3, gd, ["sss", "s.s", "s.s", "s.s"], { s: steel }, 1, 6);
    p.spr(L - 4, gd, ["sss", "s.s", "s.s", "s.s"], { s: steel }, 1, 6);
    p.later(gd + 6.5, () => {
      const [x0, y0] = p.S(3, gd), [x1, y1] = p.S(L - 4, gd);
      const n2 = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let k = 0; k <= n2; k++) {
        const x = x0 + Math.round(((x1 - x0) * k) / Math.max(1, n2)), y = y0 + Math.round(((y1 - y0) * k) / Math.max(1, n2)) - 3;
        p.scr(x, y, k % 3 === 1 ? bush : steel);
      }
    });
  }
  // control house by the gate
  const cl0 = big ? L - 7 : L - 5;
  p.box({ l0: cl0, d0: D - 6, l1: L - 4, d1: D - 4, h: 1, wall: M.brick, roof: M.tar, front: (u) => (u === 1 ? C.door : null) });
  // danger sign on the gate + a yard light
  p.obj((L >> 1) - 2, D - 3, hx("#c8342a"));
  if (p.lit) p.g(3, D - 4, hx("#e8c070"));
}

// ------------------------------------------------------------ WATER TOWER

/**
 * Town water tower: a round tank on four legs with the riser pipe and
 * cross-bracing, the town's name painted in a band, a red beacon on top,
 * in a fenced gravel lot with a pump house. Tank colour by hash (silver,
 * pale blue, white with a checkered cap, sage).
 */
export function waterTower(p: Plan): void {
  const { L, D } = p;
  const v = p.h(1) % 4;
  const tank = [hx("#c8ccd0"), hx("#9ec0d8"), hx("#eceae4"), hx("#b8c8a8")][v]!;
  const cap = v === 2 ? M.red : shade(tank, 1.08);
  const big = L >= 16;
  if (big) {
    p.pave(3, 3, L - 4, D - 3, "gravel");
    chainLink(p, 3, 3, L - 4, D - 3);
    p.box({ l0: L - 7, d0: D - 7, l1: L - 5, d1: D - 5, h: 1, wall: M.brick, roof: M.tar, front: (u) => (u === 1 ? C.door : null) });
  } else {
    p.pave(1, 1, L - 2, D - 2, "gravel");
    chainLink(p, 1, 1, L - 2, D - 2);
  }
  // tall structure: anchored in SCREEN space (base near the footprint's
  // south edge) so the tank stands upright in every orientation
  const x = p.SW >> 1, y = p.SH - (big ? 3 : 2);
  const beaconOn = ((RS.tick >> 3) & 1) === 0;
  const beacon = beaconOn ? EMISSIVE.beacon : hx("#5a1a1a");
  const t = shade(tank, 0.8);
  const leg = hx("#4a4e56");
  const rows = big
    ? [
        "....b....",
        "...ccc...",
        ".cCcCcCc.",
        "cCcCcCcCc",
        "TTTTTTTTt",
        "TNNNNNNNt",
        "TTTTTTTTt",
        ".uuuuuuu.",
        "..L.P.L..",
        "..LxPxL..",
        ".L..P..L.",
        "L.xxPxx.L",
      ]
    : [".b.", "ccc", "TTt", "NNt", "uuu", "LPL"];
  const pal = {
    b: beacon, c: cap, C: v === 2 ? M.white : cap, T: tank, t, N: letters(0, 1, tank, tank), u: shade(tank, 0.7),
    L: leg, P: shade(leg, 0.85), x: shade(leg, 1.2),
  } as Record<string, RGB>;
  // painted town name: letter ticks on the band
  p.later(y + 0.25, () => {
    const wid = rows[0]!.length, ox = x - (wid >> 1), oy = y - rows.length + 1;
    for (let r = 0; r < rows.length; r++) for (let i = 0; i < wid; i++) {
      const ch = rows[r]![i]!;
      let c = pal[ch];
      if (!c) continue;
      if (ch === "N") c = i >= 1 && i <= wid - 3 && i % 2 === 1 ? hx("#2a3a5a") : tank;
      p.scr(ox + i, oy + r, c);
    }
    // the red beacon on the cap blooms on its "on" frames
    p.beacon(x, oy, beaconOn, p.lit ? 2 : 1);
    // the tank's shadow on the ground to the SE
    for (let i = 0; i < (big ? 5 : 2); i++) p.shadowPx(x + 1 + i, y + 1);
  });
}

// ------------------------------------------------------------ BARN

/**
 * Red gambrel barn, gable-end to the lane: big sliding doors with the white
 * X-brace, a hayloft door, white corner trim; a tin lean-to, round bales
 * and a tractor by hash. Paint: barn red · white · weathered grey.
 */
export function barn(p: Plan): void {
  const { L, D } = p;
  const v = p.h(1) % 4;
  const wall = [hx("#9a3a2c"), hx("#9a3a2c"), hx("#e8e4d6"), hx("#8a847a")][v]!;
  const trim = v === 2 ? hx("#9a3a2c") : M.white;
  const roof = [M.shingle, hx("#a8adb2"), hx("#6a3a30"), hx("#a8adb2")][v]!;
  const wide = L >= 16;
  const fr = p.D - 2;
  const bl0 = wide ? 2 : 1, bl1 = wide ? 10 : L - 2;
  const bd0 = 1, bd1 = Math.min(fr - 1, D >= 16 ? 10 : 5);
  p.pave(bl0, bd1 + 1, bl1, fr, "dirt");
  const doorFace = (u: number, r: number, n: number, hh: number): RGB | null => {
    if (u === 0 || u === n - 1) return trim;
    const mid = (n - 1) / 2;
    if (r === 0) return Math.abs(u - mid) < 1 ? hx("#3a2a1e") : null; // hayloft
    const du = u - (mid - 2);
    if (du >= 0 && du <= 4 && r >= 1) {
      const rr = r - 1, hh2 = hh - 2;
      if (du === 0 || du === 4 || rr === 0) return trim;
      return (du === 1 + rr || du === 3 - rr || (hh2 <= 1 && du === 2)) ? trim : shade(wall, 0.8);
    }
    return null;
  };
  p.box({
    l0: bl0, d0: bd0, l1: bl1, d1: bd1, h: 3, wall, roof, kind: "gambrel", across: true,
    front: doorFace,
    side: (u, r, n) => (u === 0 || u === n - 1 ? trim : r === 1 && u % 3 === 1 ? hx("#3a2a1e") : null),
    back: (u, _r, n) => (u === 0 || u === n - 1 ? trim : null),
    lip: (k, n) => (k === 0 || k === n - 1 ? trim : Math.abs(k - (n - 1) / 2) <= 2 ? trim : wall),
  });
  if (wide) {
    // tin lean-to
    p.box({ l0: bl1 + 1, d0: bd0 + 1, l1: L - 3, d1: bd1, h: 2, wall: shade(wall, 0.9), roof: M.tin, front: (u) => (u % 2 ? hx("#3a2e24") : null) });
    // round bales
    const bale = p.winter ? hx("#d8d0b8") : hx("#c8a860");
    p.obj(L - 3, fr, bale); p.obj(L - 4, fr, shade(bale, 0.85));
    // tractor (IH red / Deere green) by hash
    if (p.h(2) % 2 === 0) {
      const tc = p.h(3) % 2 ? hx("#b8342a") : hx("#3a7a3a");
      p.obj(1, fr, M.dark); p.obj(2, fr, tc); p.obj(2, fr - 1, tc); p.obj(1, fr - 1, M.dark);
    }
  }
}

// ------------------------------------------------------------ GREENHOUSE

/** Poly hoop house (ribbed, plants showing through), potting shed, flats outside. */
export function greenhouse(p: Plan): void {
  const { L, D } = p;
  const glassHouse = p.h(1) % 3 === 0;
  const poly = glassHouse ? hx("#cfe8e2") : hx("#e4ece8");
  const plant = RS.season === "winter" ? hx("#7a9a7a") : hx("#6aa04a");
  const wide = L >= 16;
  const fr = p.D - 2;
  const bl0 = 1, bl1 = wide ? 11 : L - 2;
  const bd0 = 1, bd1 = Math.min(fr - 1, D >= 16 ? 9 : 5);
  const glow = p.lit ? hx("#f0c878") : null;
  p.box({
    l0: bl0, d0: bd0, l1: bl1, d1: bd1, h: 2, wall: poly, roof: poly, kind: "barrel", noSnow: !p.winter,
    front: (u, r, n) => (u === n >> 1 && r >= 0 ? hx("#6a7a7a") : u % 3 === 0 ? shade(poly, 0.85) : glow ?? mix(poly, plant, r === 1 ? 0.45 : 0.25)),
    side: (u, r) => (u % 3 === 0 ? shade(poly, 0.85) : glow ?? mix(poly, plant, r === 1 ? 0.45 : 0.25)),
    back: (u) => (u % 3 === 0 ? shade(poly, 0.85) : glow ?? mix(poly, plant, 0.3)),
    lip: (k) => (k % 3 === 0 ? shade(poly, 0.85) : poly),
    deco: () => {
      // plant rows glimpsed through the roof
      for (let l = bl0 + 1; l < bl1; l += 3) p.top(l, bd0 + 1, mix(poly, plant, 0.35));
    },
  });
  if (wide) {
    p.box({ l0: 12, d0: bd0 + 1, l1: L - 2, d1: Math.min(bd1, bd0 + 3), h: 1, wall: hx("#b8946a"), roof: M.rust, front: (u) => (u === 1 ? C.door : null) });
    // flats of seedlings / flowers
    const fl = [hx("#e8a0c0"), hx("#e8c040"), plant];
    for (let l = 12; l <= L - 2; l++) for (const d of [fr - 1, fr]) if (!p.winter && (l + d) % 2 === 0) p.g(l, d, fl[(l * 3 + d) % 3]!);
  }
}

// ------------------------------------------------------------ LIGHTHOUSE

/** Where the lighthouse tower stands (plan point) and how tall it is (px). */
export function lighthouseTower(p: Plan): { l: number; d: number; tall: number } {
  const wide = p.L >= 16;
  const l = wide ? 4 : (p.L >> 1);
  const d = p.D - 3;
  const [, y] = p.S(l, d);
  // as tall as the footprint allows above the base (the ring stays clear)
  return { l, d, tall: Math.max(5, Math.min(11, y - 1)) };
}

/**
 * White tower with a red lantern room (and a gallery), bands by hash; the
 * keeper's cottage beside it (or behind it on a deep lot). The rotating
 * beam is an overlay drawn over the water, unclipped — see landmarks.ts.
 */
export function lighthouse(p: Plan): void {
  const { L, D } = p;
  const v = p.h(1) % 3;
  const band = v === 1 ? M.red : v === 2 ? hx("#2a2826") : M.white;
  const wide = L >= 16, deep = D >= 16;
  const { l, d, tall } = lighthouseTower(p);
  const fr = p.D - 2;
  const cottage = (l0: number, d0: number, l1: number, d1: number): void => {
    p.box({ l0, d0, l1, d1, h: 2, wall: M.clapboard, roof: hx("#9a3a2c"), kind: "gable", front: (u, r) => (u === 2 && r >= 0 ? C.door : u % 3 === 1 && r === 0 ? pane(p, u, r, 30) : null) });
  };
  if (wide) {
    cottage(8, 1, L - 2, Math.min(fr - 1, 5));
    for (let dd = 3; dd <= fr; dd++) p.g(6, dd, C.pathStone);
  } else if (deep) {
    cottage(1, 1, L - 2, 6);
    for (let dd = 7; dd <= fr; dd++) p.g(2, dd, C.pathStone);
  } else {
    // a lone light on its rock ledge with the little oil house
    p.fill(1, 1, L - 2, D - 2, (l2, d2) => {
      const [X, Y] = p.gx(l2, d2);
      const h = pixHash(X, Y, 97);
      return h % 3 === 0 ? C.rockShade : h % 5 === 0 ? shade(C.rock, 0.9) : C.rock;
    });
    p.box({ l0: 1, d0: 1, l1: 3, d1: 3, h: 1, wall: M.white, roof: hx("#9a3a2c"), kind: "gable", front: (u) => (u === 1 ? C.door : null) });
  }
  const lamp = p.lit ? EMISSIVE.beaconWhite : hx("#f0e8b0");
  const rows = ["k", "L", "g"];
  for (let i = 0; i < tall - 4; i++) rows.push(v !== 0 && (i >> 1) % 2 === 0 ? "B" : "W");
  rows.push("s");
  const pal: Record<string, RGB> = { k: hx("#2a2826"), L: lamp, g: M.red, W: M.white, B: band, s: shade(M.concrete, 0.9) };
  const [x, y] = p.S(l, d);
  p.later(y, () => {
    const oy = y - rows.length + 1;
    for (let r = 0; r < rows.length; r++) {
      const c = pal[rows[r]!]!;
      if (r === 1) { p.scr(x - 1, oy + r, M.red); p.scr(x + 1, oy + r, M.red); }
      p.scr(x, oy + r, c);
      if (r > 2) { p.scr(x - 1, oy + r, shade(c, 1.05)); p.scr(x + 1, oy + r, shade(c, 0.8)); }
      if (r === 2) { p.scr(x - 1, oy + r, M.dark); p.scr(x + 1, oy + r, M.dark); }
    }
    p.shadowPx(x + 2, y); p.shadowPx(x + 2, y - 1);
  });
}

// ------------------------------------------------------------ GRAIN ELEVATOR

/**
 * Country elevator on the siding: a row of slip-formed concrete silos (tall
 * cylinders, lit on the west), the taller head house with the bucket leg,
 * spouts and the co-op's painted name; a pair of corrugated steel bins
 * with conical caps, the scale house and a grain truck at the dump pit.
 */
export function grainElevator(p: Plan): void {
  const { L, D } = p;
  const conc = p.h(1) % 2 ? hx("#d8d2c4") : hx("#c8c2b4");
  const fr = p.D - 2;
  const deep = D >= 16;
  p.pave(1, deep ? 9 : D - 3, L - 2, fr, "gravel");
  const siloD = deep ? 7 : 4;
  const n = Math.max(3, Math.floor((L - 8) / 3));
  const H = deep ? 9 : 5;
  const headAt = n >> 1; // the head house stands mid-row, the drive under it
  const silo = (l: number, sd = siloD): void => {
    const [x, y0] = p.S(l, sd);
    p.later(y0, () => {
      const y = Math.max(y0, H + 2);
      for (let r = 0; r <= H; r++) {
        for (let i = -1; i <= 1; i++) {
          let c = i < 0 ? shade(conc, 1.1) : i > 0 ? shade(conc, 0.72) : conc;
          if (r === 0) c = shade(c, 0.85);
          p.scr(x + i, y - r, c);
        }
      }
      const top = p.winter ? M.snow : shade(conc, 1.16);
      p.scr(x, y - H - 1, top); p.scr(x - 1, y - H - 1, shade(top, 0.95));
      p.shadowPx(x + 2, y); p.shadowPx(x + 2, y - 1);
    });
  };
  // a lot turned end-on to its street holds a 2-wide silo BATTERY running
  // back from the head house instead of a single row
  const turned = L < D && D >= 24;
  if (turned) {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) silo(3 + c * 3, 4 + r * 3);
  } else for (let i = 0; i < n; i++) if (i !== headAt) silo(2 + i * 3);
  // head house: a taller, wider box mid-row with the co-op's name
  const hl = turned ? 4 : 2 + headAt * 3;
  const [hxp, hy0] = p.S(hl, turned ? 16 : siloD);
  const HH = H + 2;
  const head = shade(conc, 0.9);
  p.later(hy0 + 0.5, () => {
    const hyp = Math.max(hy0, HH + 2);
    for (let r = 0; r <= HH; r++) for (let i = -1; i <= 1; i++) {
      let c = i === 1 ? shade(head, 0.78) : i === -1 ? shade(head, 1.06) : head;
      if (r === HH) c = shade(head, 1.18);
      if ((r === HH - 2 || r === HH - 3) && i <= 0) c = hx("#2a4a7a"); // painted co-op name
      if (r === 2 && i === 0) c = hx("#2a2622"); // drive-through
      if (r === 1 && i === 0) c = hx("#2a2622");
      if (r === 5 && i === 0) c = M.glass;
      p.scr(hxp + i, hyp - r, c);
    }
    // the spout slanting to the track side
    p.scr(hxp - 2, hyp - HH + 3, M.steel); p.scr(hxp - 3, hyp - HH + 4, M.steel);
    p.shadowPx(hxp + 2, hyp); p.shadowPx(hxp + 2, hyp - 1);
  });
  const lastSilo = turned ? 7 : 2 + (n - 1) * 3;
  // corrugated steel bins with cones
  const bins = deep ? 2 : 1;
  for (let b = 0; b < bins; b++) {
    const bl = L - 3 - b * 4;
    if (bl <= lastSilo + 2) break;
    p.spr(bl, siloD + (deep ? 3 : 0), [".t.", "ttt", "BbB", "BbB", "BbB"], { t: p.winter ? M.snow : hx("#c8ccd0"), B: hx("#a8adb2"), b: hx("#8a9096") }, 1, 0);
  }
  if (deep) {
    // scale house + a grain truck at the pit
    const sd = turned ? fr - 3 : 11;
    const sl = turned ? L - 5 : 2;
    p.box({ l0: sl, d0: sd, l1: sl + 2, d1: sd + 1, h: 1, wall: hx("#e8e4d6"), roof: M.rust, front: (u) => (u === 1 ? pane(p, u, 0, 31) : null) });
    const tc = p.h(2) % 2 ? hx("#b8342a") : hx("#2a4f9a");
    if (!turned) { p.carDir(8, 12, 0, "pickup", tc); p.obj(10, 12, hx("#c8a860")); }
    else p.carDir(L - 4, fr - 5, 3, "pickup", tc);
  }
}

// ------------------------------------------------------------ SAWMILL

/**
 * Mountain sawmill: the long open-sided saw shed (rusty corrugated roof,
 * the head rig and a log on the carriage glimpsed inside), a log deck of
 * stacked logs with end grain showing, stickered lumber stacks, and the
 * conical steel "wigwam" sawdust burner smoking (glowing at night).
 */
export function sawmill(p: Plan): void {
  const { L, D } = p;
  const deep = D >= 16;
  const fr = p.D - 2;
  p.pave(1, 1, L - 2, fr, "dirt");
  // sawdust drifts
  p.fill(1, 1, L - 2, fr, (l, d) => {
    const [X, Y] = p.gx(l, d);
    return pixHash(X >> 1, Y >> 1, 211) % 5 === 0 ? (p.winter ? hx("#e0dccc") : M.sawdust) : null;
  });
  const shedL1 = Math.min(L - 8, 14);
  const sd0 = 1, sd1 = deep ? 6 : 4;
  const inside = hx("#3a2e24");
  p.box({
    l0: 1, d0: sd0, l1: shedL1, d1: sd1, h: 2, wall: inside, roof: M.rust, kind: "gable",
    front: (u, r) => (u % 4 === 0 ? hx("#6a5a44") : r === 1 && u > 2 && u < 8 ? hx("#8a6a4a") : r === 0 && u === 5 ? M.steel : inside),
    side: (u) => (u % 3 === 0 ? hx("#6a5a44") : inside),
    lip: (k) => (k % 4 === 0 ? hx("#6a5a44") : shade(M.rust, 0.8)),
  });
  // log deck: logs stacked along l, end grain toward the camera side
  const bark = hx("#5a4030"), bark2 = hx("#6e5038"), grain = hx("#c8a070");
  const ld0 = deep ? 8 : sd1 + 1, ld1 = deep ? 12 : fr - 1;
  for (let d = ld0; d <= ld1; d++) for (let l = 1; l <= shedL1 - 2; l++) {
    const endL = l === shedL1 - 2;
    p.obj(l, d, endL ? grain : d % 2 ? bark : bark2);
  }
  // lumber stacks (stickered)
  if (deep) {
    for (const [l0, d0] of [[shedL1 + 2, 2], [shedL1 + 2, 5]] as const) {
      if (l0 + 3 > L - 2) continue;
      p.box({ l0, d0, l1: Math.min(L - 2, l0 + 4), d1: d0 + 1, h: 1, wall: shade(M.lumber, 0.8), roof: M.lumber, noSnow: false, front: (u) => (u % 2 ? shade(M.lumber, 0.7) : shade(M.lumber, 0.85)) });
    }
  }
  // the wigwam burner
  const bl = L - 4, bd = deep ? fr - 1 : fr;
  const glow = p.lit ? EMISSIVE.hazard : hx("#3a2a20");
  const rows = deep
    ? ["..m..", ".mmm.", ".sSs.", ".sSr.", "ssSrr", "ssSrr", "sgSrr"]
    : [".m.", "sSr", "sgr"];
  p.spr(bl, bd, rows, { m: hx("#2a2826"), s: hx("#a8704a"), S: hx("#8a5a3a"), r: hx("#6e4430"), g: glow }, -1, 0);
  const [x, y] = p.S(bl, bd);
  smoke(p, x, y - rows.length, true);
  // conveyor from the shed to the burner
  const cv = hx("#4a4a4a");
  {
    const l0 = shedL1 + 1, d0 = sd1, l1 = bl - 2, d1 = bd - 3;
    const n = Math.max(1, Math.abs(l1 - l0), Math.abs(d1 - d0));
    for (let k = 0; k <= n; k++) p.obj(l0 + Math.round(((l1 - l0) * k) / n), d0 + Math.round(((d1 - d0) * k) / n), k % 2 ? cv : M.steel);
  }
  // log truck by hash
  if (deep && p.h(3) % 2 === 0) {
    p.carDir(shedL1 + 3, fr, 1, "pickup", hx("#2a4f9a"));
  }
}

// ------------------------------------------------------------ CANNERY

/** Local direction (0 +l · 1 -l · 2 +d · 3 -d) toward the most water around the lot. */
function waterSide(p: Plan, w: World): number {
  const ax = p.AX / TILE_PX, ay = p.AY / TILE_PX, fw = p.SW / TILE_PX, fh = p.SH / TILE_PX;
  const lake = (x: number, y: number): number => (x >= 0 && y >= 0 && x < w.width && y < w.height && w.terrain[y * w.width + x] === Terrain.Lake ? 1 : 0);
  const cnt = [0, 0, 0, 0]; // screen S N E W
  for (let r = 1; r <= 3; r++) {
    for (let i = -1; i <= fw; i++) { cnt[0]! += lake(ax + i, ay + fh - 1 + r); cnt[1]! += lake(ax + i, ay - r); }
    for (let i = -1; i <= fh; i++) { cnt[2]! += lake(ax + fw - 1 + r, ay + i); cnt[3]! += lake(ax - r, ay + i); }
  }
  let best = -1, bv = 0;
  for (let s = 0; s < 4; s++) if (cnt[s]! > bv) { bv = cnt[s]!; best = s; }
  if (best < 0) return 3; // default: out the back
  // screen side → local direction for this frontage
  const TABLE = [
    [2, 3, 0, 1], // o=0: S→+d, N→-d, E→+l, W→-l
    [3, 2, 1, 0], // o=1
    [1, 0, 2, 3], // o=2: S→-l (y=L-1-l), N→+l, E→+d, W→-d
    [0, 1, 3, 2], // o=3: S→+l, N→-l, E→-d, W→+d
  ];
  return TABLE[p.o]![best]!;
}

/**
 * Harbor cannery: a long painted-board shed (corrugated roof, loading doors,
 * the company name on the fascia), the taller white ICE HOUSE, and an
 * elevated conveyor running to the water side; fish totes, a forklift and
 * gulls on the ridge.
 */
export function cannery(p: Plan, w: World): void {
  const { L, D } = p;
  const v = p.h(1) % 3;
  const wall = [hx("#b8c4b8"), hx("#9a4a3a"), hx("#d8d0b8")][v]!;
  const fr = p.D - 2;
  const deep = D >= 16;
  p.pave(1, 1, L - 2, fr, "concrete");
  // a lot turned end-on to its street runs the shed back along the depth
  const turned = L < D && D >= 24;
  const sl1 = turned ? L - 2 : Math.min(L - 9, 14);
  const sd1 = turned ? Math.min(D - 10, 12) : deep ? 8 : D - 3;
  p.box({
    l0: 1, d0: 1, l1: sl1, d1: sd1, h: 3, wall, roof: hx("#8a9096"), kind: "gable", across: turned,
    front: (u, r, n) => (r === 0 ? letters(u, n, shade(wall, 1.1), hx("#23386a"), 2) : u % 5 === 2 ? hx("#3a3430") : r === 1 && u % 5 === 4 ? pane(p, u, r, 32) : null),
    side: (u, r) => (r === 1 && u % 3 === 1 ? pane(p, u, r, 33) : null),
    lip: (k, n) => letters(k, n, shade(wall, 1.1), hx("#23386a"), 2),
    deco: () => {
      // gulls on the ridge
      if (!p.winter) for (let i = 0; i < 3; i++) p.top(2 + ((p.h(10 + i) % Math.max(1, sl1 - 3))), 1 + ((sd1 - 1) >> 1), M.white);
    },
  });
  // ice house
  const il0 = turned ? 1 : sl1 + 2, il1 = turned ? Math.min(L - 2, 8) : L - 2;
  const id0 = turned ? sd1 + 2 : 2, id1 = turned ? sd1 + 6 : Math.min(sd1, deep ? 7 : sd1);
  p.box({
    l0: il0, d0: id0, l1: il1, d1: id1, h: deep ? 4 : 3, wall: M.white, roof: M.tar,
    front: (u, r, n) => (r === 0 ? letters(u, n, M.white, hx("#2a6ab0"), 2) : u === n >> 1 && r >= 2 ? hx("#6a7a8a") : null),
    lip: () => hx("#2a6ab0"),
  });
  // conveyor to the water side
  const ws = waterSide(p, w);
  const cv = hx("#4a4a4a"), belt = hx("#2a2826");
  const cl = (1 + sl1) >> 1, cd = (1 + sd1) >> 1;
  p.later(900, () => {
    for (let k = 0; k < 40; k++) {
      const l = ws === 0 ? sl1 + 1 + k : ws === 1 ? 0 - k : cl;
      const d = ws === 2 ? sd1 + 1 + k : ws === 3 ? 0 - k : cd;
      if (ws === 0 || ws === 1) { if (l < 1 || l > L - 2) break; }
      else if (d < 1 || d > D - 2) break;
      const [x, y] = p.S(l, d);
      p.scr(x, y - 2, k % 3 === 0 ? cv : belt);
      if (k % 3 === 0) p.scr(x, y - 1, M.steel);
    }
  });
  // fish totes + forklift
  if (deep) {
    const tote = [hx("#2a6ab0"), hx("#e07a2a")];
    for (let i = 0; i < 4; i++) p.obj(2 + i, fr - 1, tote[i & 1]!);
    p.obj(8, fr - 1, hx("#e8c040")); p.obj(9, fr - 1, hx("#e8c040")); p.obj(8, fr - 2, M.dark);
  }
}

export { mix };
