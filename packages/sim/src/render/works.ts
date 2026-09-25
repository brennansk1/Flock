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
import { standsInWater, granite } from "./waterworks.js";

const hx = hexToRgb;

/** chain-link fence around [l0..l1]×[d0..d1] with a gate gap on the street side */
export function chainLink(p: Plan, l0: number, d0: number, l1: number, d1: number, gate = true): void {
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
 * Electrical SUBSTATION on its pole line: a crushed-stone yard inside
 * chain-link; at the back (away from the street, where the transmission
 * line comes in) a steel LATTICE GANTRY — two latticed towers and a
 * latticed beam hung with white insulator strings; silver BUS BARS on
 * post insulators across the yard; two big finned TRANSFORMERS with
 * their bushings; the brick control house by the gate and a red-and-
 * white DANGER sign on the fence; a sodium yard light at night.
 * The incoming line itself runs across the country tiles (utility.ts).
 */
export function substation(p: Plan): void {
  const { SW, SH, o } = p;
  const pad = hx("#b4afa4");
  const small = SW < 16 || SH < 16;
  // yard
  for (let y = 1; y < SH - 1; y++) for (let x = 1; x < SW - 1; x++) {
    const h = pixHash(p.AX + x, p.AY + y, 91);
    p.gScr(x, y, p.winter && h % 3 ? M.snow : h % 5 === 0 ? shade(pad, 0.88) : h % 7 === 0 ? shade(pad, 1.07) : pad);
  }
  // chain-link on the ring's inner edge, gate on the street side
  const f = hx("#a8a49a"), post = hx("#6a6660");
  const gx = SW >> 1, gy = SH >> 1;
  const gate = (x: number, y: number): boolean =>
    (o === 0 && y === SH - 2 && Math.abs(x - gx) <= 1) || (o === 1 && y === 1 && Math.abs(x - gx) <= 1) ||
    (o === 2 && x === SW - 2 && Math.abs(y - gy) <= 1) || (o === 3 && x === 1 && Math.abs(y - gy) <= 1);
  for (let x = 1; x < SW - 1; x++) for (const y of [1, SH - 2]) if (!gate(x, y)) p.scr(x, y, x % 3 === 0 ? post : f, 1);
  for (let y = 1; y < SH - 1; y++) for (const x of [1, SW - 2]) if (!gate(x, y)) p.scr(x, y, y % 3 === 0 ? post : f, 1);
  const steel = hx("#6a6e76"), steelD = hx("#44484e"), ins = hx("#f0ece4"), bus = hx("#aeb3ba");
  const tf = hx("#56645a"), tfD = hx("#3e4a42"), tfTop = hx("#74847a");
  if (small) {
    // a pole-top yard: one transformer + a gantry pole
    p.box({ l0: 2, d0: 2, l1: 4, d1: 4, h: 1, wall: tf, roof: tfTop, noSnow: true, front: (u) => (u % 2 ? tfD : tf), lip: () => tf });
    p.sprAt(5, 5, ["iWi", ".s.", ".s.", ".s."], { i: ins, W: steel, s: steel }, 1, 5);
    p.obj(gx, SH - 3, M.red);
    return;
  }
  // back side (where the line comes in): 0 top · 1 bottom · 2 left · 3 right
  const back = o === 0 ? 0 : o === 1 ? 1 : o === 2 ? 2 : 3;
  const horiz = back <= 1;
  // gantry base line and tower positions (screen)
  const gyB = back === 0 ? 5 : back === 1 ? SH - 3 : 0;
  const gxB = back === 2 ? 4 : back === 3 ? SW - 5 : 0;
  const lattice = (x: number, y: number, k: number): RGB => ((x + y + k) & 1 ? steel : steelD);
  const TH = 6; // tower height (px)
  p.later((horiz ? gyB : SH - 3) + 0.4, () => p.tall(() => {
    if (horiz) {
      for (const tx of [3, SW - 5]) {
        for (let k = 0; k < TH; k++) { p.scr(tx, gyB - k, lattice(tx, gyB - k, 0)); p.scr(tx + 1, gyB - k, lattice(tx + 1, gyB - k, 1)); }
      }
      for (let x = 3; x <= SW - 4; x++) { p.scr(x, gyB - TH, lattice(x, 0, 0)); p.scr(x, gyB - TH + 1, lattice(x, 1, 1)); }
      for (let x = 5; x <= SW - 6; x += 3) { p.scr(x, gyB - TH + 2, ins); p.scr(x, gyB - TH + 3, shade(ins, 0.8)); }
    } else {
      for (const ty of [4, SH - 4]) {
        for (let k = 0; k < TH; k++) { p.scr(gxB, ty - k, lattice(gxB, ty - k, 0)); p.scr(gxB + 1, ty - k, lattice(gxB + 1, ty - k, 1)); }
      }
      for (let y = 4 - TH; y <= SH - 4 - TH; y++) { p.scr(gxB, y, lattice(0, y, 0)); p.scr(gxB + 1, y, lattice(1, y, 1)); }
      for (let y = 4 - TH + 3; y <= SH - 4 - TH - 1; y += 3) { p.scr(gxB + 2, y, ins); }
    }
  }));
  // bus bars on post insulators across the middle of the yard
  const by0 = horiz ? (back === 0 ? 8 : SH - 7) : 5;
  if (horiz) {
    p.later(by0 + 0.3, () => {
      for (let k = 0; k < 2; k++) for (let x = 3; x <= SW - 4; x++) p.scr(x, by0 - 2 + k * 2, bus);
      for (let x = 4; x <= SW - 5; x += 4) { p.scr(x, by0 - 1, ins); p.scr(x, by0 + 1, ins); p.scr(x, by0, steelD); }
    });
  } else {
    const bx0 = back === 2 ? 7 : SW - 8;
    p.later(SH - 4, () => {
      for (let k = 0; k < 2; k++) for (let y = 3; y <= SH - 4; y++) p.scr(bx0 + k * 2, y - 2, bus);
      for (let y = 4; y <= SH - 5; y += 4) { p.scr(bx0 + 1, y - 2, ins); p.scr(bx0 + 1, y - 1, steelD); }
    });
  }
  // two finned transformers toward the front, bushings on top
  const tpos: [number, number][] = horiz
    ? (back === 0 ? [[3, 10], [8, 10]] : [[3, 4], [8, 4]])
    : (back === 2 ? [[10, 3], [10, 8]] : [[3, 3], [3, 8]]);
  for (const [x, y] of tpos) {
    const [a0, b0] = p.Sinv(x, y), [a1, b1] = p.Sinv(x + 3, y + 2);
    p.box({
      l0: Math.min(a0, a1), d0: Math.min(b0, b1), l1: Math.max(a0, a1), d1: Math.max(b0, b1), h: 2, wall: tf, roof: tfTop, noSnow: true,
      front: (u) => (u % 2 ? tfD : tf), back: (u) => (u % 2 ? tfD : tf), side: (u) => (u % 2 ? tfD : tf), lip: () => tfD,
    });
    p.sprAt(x + 1, y, ["i.i"], { i: ins }, 0, 10);
  }
  // control house by the gate + the DANGER sign on the fence
  const [c0, d0] = p.Sinv(horiz ? SW - 6 : (back === 2 ? SW - 6 : 3), horiz ? (back === 0 ? SH - 6 : 3) : SH - 6);
  const [c1, d1] = p.Sinv(horiz ? SW - 3 : (back === 2 ? SW - 3 : 6), horiz ? (back === 0 ? SH - 4 : 5) : SH - 4);
  p.box({ l0: Math.min(c0, c1), d0: Math.min(d0, d1), l1: Math.max(c0, c1), d1: Math.max(d0, d1), h: 2, wall: M.brick, roof: M.tar,
    front: (u) => (u === 1 ? C.door : null), side: (u) => (u === 1 ? C.door : null), back: (u) => (u === 1 ? C.door : null) });
  const sx = o === 0 ? gx - 3 : o === 1 ? gx - 3 : o === 2 ? SW - 2 : 1;
  const sy = o === 0 ? SH - 2 : o === 1 ? 1 : gy - 3;
  p.scr(sx, sy, M.red); p.scr(sx + (o >= 2 ? 0 : 1), sy + (o >= 2 ? 1 : 0), M.white);
  if (p.lit) p.gScr(gx, gy, hx("#e8c070"));
}

// ------------------------------------------------------------ WATER TOWER

/**
 * The classic BOWL-AND-LEGS town water tower (Chicago Bridge & Iron
 * "hemispherical bottom" tank, the 1950s–80s small-town standard), drawn
 * in 3/4 view rising over the back of its lot and into the overhang: a
 * conical cap with a finial + red beacon, the tank band with the town's
 * name, a catwalk ring, the bowl, four splayed legs with two tiers of
 * X-bracing, the central riser pipe and a caged LADDER up one leg. A
 * fenced gravel pad and the pump house below. Tank colour by hash.
 */
export function waterTower(p: Plan): void {
  const { L, D } = p;
  const v = p.h(1) % 4;
  const tank = [hx("#c8ccd0"), hx("#9ec0d8"), hx("#eceae4"), hx("#b8c8a8")][v]!;
  const capC = v === 2 ? M.red : shade(tank, 1.06);
  const big = L >= 16;
  const { SW, SH } = p;
  // mown lawn with a fenced gravel pad round the feet (the pad + fence
  // are laid in SCREEN space under the legs, so every frontage matches)
  p.lawn(1, 1, L - 2, D - 2);
  const x = (SW >> 1) - (SW >= 16 ? 1 : 0); // tower centre column
  const base = SH - (big ? 4 : 3); // leg feet row
  const wide = SW >= 16;
  const R = wide ? 6 : 3; // tank half-width
  const legH = Math.max(8, Math.min(16, base - 2)); // legs (feet → bowl rim)
  const rim = base - legH; // row of the tank's catwalk
  const beaconOn = ((RS.tick >> 3) & 1) === 0;
  const steel = hx("#34383f"), steelL = hx("#555a62"), rung = hx("#b8bcc2");
  {
    const px0 = x - R - 3, px1 = x + R + 3, py0 = Math.max(2, rim + 2), py1 = Math.min(SH - 2, base + 2); // the whole yard under the tank is fenced gravel
    for (let y = py0; y <= py1; y++) for (let xx = px0; xx <= px1; xx++) {
      const h = pixHash(p.AX + xx, p.AY + y, 53);
      const edge = y === py0 || y === py1 || xx === px0 || xx === px1;
      const c = edge ? ((xx + y) % 3 === 0 ? hx("#7a7670") : hx("#a8a49a")) : p.winter && h % 3 ? M.snow : h % 4 === 0 ? shade(M.gravel, 1.12) : M.gravel;
      if (edge) p.scr(xx, y, c); else p.gScr(xx, y, c);
    }
    // the pump house on the pad's corner
    const [a0, b0] = p.Sinv(px1 - 3, py1 - 3), [a1, b1] = p.Sinv(px1 - 1, py1 - 1);
    if (big) p.box({ l0: Math.min(a0, a1), d0: Math.min(b0, b1), l1: Math.max(a0, a1), d1: Math.max(b0, b1), h: 1, wall: M.brick, roof: M.tar, front: (u) => (u === 1 ? C.door : null), back: (u) => (u === 1 ? C.door : null), side: (u) => (u === 1 ? C.door : null) });
  }
  const tShade = (dx: number): RGB => shade(tank, dx < -R * 0.4 ? 1.08 : dx > R * 0.5 ? 0.8 : 0.96);
  p.later(base + 0.5, () => p.tall(() => {
    // legs: feet splayed ±(R+1), tops at ±(R-1) under the rim
    const feet = [-(R + 1), -((R + 1) >> 1) + 0, ((R + 1) >> 1), R + 1];
    const tops = [-(R - 1), -((R - 1) >> 1), ((R - 1) >> 1), R - 1];
    const legX = (i: number, y: number): number => Math.round(tops[i]! + ((feet[i]! - tops[i]!) * (y - rim)) / Math.max(1, legH));
    for (let y = rim + 1; y <= base; y++) {
      for (let i = 0; i < 4; i++) {
        if (!wide && (i === 1 || i === 2)) continue;
        const back = i === 1 || i === 2; // the rear pair reads darker
        p.scr(x + legX(i, y), y, back ? shade(steel, 0.8) : i === 0 ? steelL : steel);
      }
      // riser pipe down the middle
      p.scr(x, y, shade(tank, 0.7));
      if (wide) p.scr(x + 1, y, shade(tank, 0.55));
    }
    // two tiers of X-bracing between the outer legs
    for (const [y0, y1] of [[rim + 2, rim + 1 + (legH >> 1)], [rim + 2 + (legH >> 1), base - 1]] as const) {
      const n = y1 - y0;
      for (let k = 0; k <= n; k++) {
        const y = y0 + k;
        const xl = legX(0, y), xr = legX(3, y);
        const t = k / Math.max(1, n);
        p.scr(x + Math.round(xl + (xr - xl) * t), y, steelL);
        p.scr(x + Math.round(xr + (xl - xr) * t), y, steel);
      }
      p.scr(x + legX(0, y1), y1, steelL);
    }
    // the ladder up the left front leg (rails + rungs), into the catwalk
    for (let y = rim + 1; y <= base; y++) {
      const lx = x + legX(0, y) + 1;
      if (y % 2 === 0) p.scr(lx, y, rung);
    }
    // the TANK: bowl (below the rim), band, cone cap
    // the hemispherical BOWL: the classic silhouette, shaded underneath
    const bowl = wide ? [R, R, R - 1, R - 2, R - 4] : [R, R - 1];
    for (let k = 0; k < bowl.length; k++) {
      const hw = bowl[k]!, y = rim + 1 + k;
      if (y > base - 1) break;
      for (let dx = -hw; dx <= hw; dx++) p.scr(x + dx, y, shade(tShade(dx), 0.9 - k * 0.05));
    }
    // catwalk ring with its rail
    for (let dx = -R - 1; dx <= R + 1; dx++) { p.scr(x + dx, rim, steel); if (dx % 2 === 0) p.scr(x + dx, rim - 1, steelL); }
    const bandH = wide ? 3 : 2;
    for (let k = 1; k <= bandH; k++) {
      const y = rim - k;
      for (let dx = -R; dx <= R; dx++) {
        let c = tShade(dx);
        // the town's name painted across the band's middle row
        if (k === (bandH >> 1) + 1 && Math.abs(dx) <= R - 2 && (dx + R) % 2 === 1) c = v === 2 ? M.red : hx("#2a3a5a");
        p.scr(x + dx, y, c);
      }
    }
    const top = rim - bandH;
    const cone = wide ? [R, R - 2, R - 4] : [R - 1, 1];
    for (let k = 0; k < cone.length; k++) {
      const hw = cone[k]!, y = top - 1 - k;
      for (let dx = -hw; dx <= hw; dx++) {
        let c = shade(capC, dx < 0 ? 1.08 : 0.86);
        if (v === 2 && (dx + k) % 2 === 0) c = M.white; // checkered cap
        if (p.winter && k < cone.length) c = dx <= 0 ? M.snow : shade(M.snow, 0.88);
        p.scr(x + dx, y, c);
      }
    }
    // finial + beacon
    const by = top - cone.length - 1;
    p.scr(x, by + 1 > top - 1 ? top - 1 : by + 1, steel);
    if (p.lit) p.beacon(x, by, beaconOn, 2);
    else p.scr(x, by, beaconOn ? EMISSIVE.beacon : hx("#7a2a2a"));
    // shadow of the legs and tank on the ground, SE
    for (let i = 1; i <= R + 2; i++) p.shadowPx(x + i, base + 1);
  }));
}

// ------------------------------------------------------------ SILO

/**
 * A tall concrete STAVE SILO with a galvanized DOME cap, drawn in 3/4 view
 * rising over the back of its lot: stave courses and steel hoops, the
 * lit west flank, the enclosed unloading CHUTE with its ladder down the
 * front, and a feed bunk / gravel apron at the foot. Winter: snow on the
 * dome. Stave colour by hash (grey concrete · tan · Harvestore blue).
 */
export function silo(p: Plan): void {
  const { SW, SH } = p;
  const v = p.h(1) % 3;
  const stave = [hx("#c8c4b8"), hx("#d0bc98"), hx("#2e4a78")][v]!;
  const domeC = v === 2 ? hx("#2e4a78") : hx("#c8d0d4");
  const x = SW >> 1;
  const base = SH - 3;
  const r = Math.min(3, (SW >> 1) - 2); // half-width (7 px across on 8+ px)
  const tallH = Math.max(14, base + 6); // rises into the overhang
  const top = base - tallH;
  p.later(base + 0.5, () => p.tall(() => {
    for (let y = top; y <= base; y++) {
      const hoop = (y - top) % 3 === 2 && v !== 2;
      for (let dx = -r; dx <= r; dx++) {
        const f = dx <= -r + 1 ? 1.1 : dx >= r - 1 ? 0.76 : dx >= 1 ? 0.9 : 1;
        let c = shade(stave, f * (hoop ? 0.74 : 1));
        if (v !== 2 && !hoop && pixHash(dx, y, p.seed) % 7 === 0) c = shade(c, 0.95);
        p.scr(x + dx, y, c);
      }
    }
    // the dome
    for (let k = 0; k < 3; k++) {
      const y = top - 3 + k;
      const hw = k === 0 ? r - 2 : k === 1 ? r - 1 : r;
      for (let dx = -hw; dx <= hw; dx++) {
        let c = shade(domeC, dx < 0 ? 1.12 : dx > 1 ? 0.8 : 0.98);
        if (p.winter && k < 2) c = dx <= 0 ? M.snow : shade(M.snow, 0.9);
        p.scr(x + dx, y, c);
      }
    }
    p.scr(x, top - 3, shade(domeC, 0.8)); // vent cap
    // the unloading chute + ladder down the front (right of centre)
    for (let y = top; y <= base; y++) p.scr(x + 1, y, (y & 1) ? shade(stave, 0.62) : shade(stave, 0.72));
    // the silo's shadow to the SE
    for (let i = 1; i <= r + 2; i++) p.shadowPx(x + i, base + 1);
    for (let y = base - 2; y <= base; y++) p.shadowPx(x + r + 1, y);
  }));
  // gravel apron + a feed bunk at the foot
  const [ga, gb] = p.Sinv(x, base + 1);
  p.pave(Math.max(1, ga - 3), Math.max(1, gb - 1), Math.min(p.L - 2, ga + 3), Math.min(p.D - 2, gb + 1), "gravel");
  p.obj(1, p.D - 2, C.plank);
  p.obj(2, p.D - 2, C.plankDark);
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

/** Where the lighthouse tower stands (plan point) and how tall it is (px):
 * `tall` = rows from the base up to the lantern (the beam's origin). */
export function lighthouseTower(p: Plan): { l: number; d: number; tall: number } {
  const l = p.L >> 1;
  const d = p.D - 3;
  const [, y] = p.S(l, d);
  // a TALL tower: rises through its own lot and over the tile(s) behind
  return { l, d, tall: Math.max(12, Math.min(18, y + 10)) };
}

/**
 * CAPE COD LIGHTHOUSE at the seaward end of its stone jetty: a tapering
 * white conical tower (a red day-mark band by hash, like Nauset), the
 * black iron LANTERN room with its glazing (the lamp burns at night), the
 * black gallery rail, a black cap with a ventilator ball; a round granite
 * base on the riprap, water all round. The sweeping beam is an unclipped
 * overlay (landmarks.ts).
 */
export function lighthouse(p: Plan, w?: World): void {
  const v = p.h(1) % 3;
  const band = v === 1 ? hx("#b8322a") : M.white;
  const { l, d, tall } = lighthouseTower(p);
  const [x, y] = p.S(l, d);
  // out at sea (a water tile, or the pad at the end of the jetty): no
  // causeway across the lot, just the riprap round the foot
  const onWater = !!w && (w.terrain[p.seed] === Terrain.Lake || standsInWater(w, p.seed % w.width, (p.seed / w.width) | 0));
  // the base: granite riprap round the foot (the jetty's head); on land a
  // rock ledge with a gravel path
  const rip = (xx: number, yy: number): RGB => {
    const h = pixHash(p.AX + xx, p.AY + yy, 97);
    return h % 3 === 0 ? C.rockShade : h % 5 === 0 ? shade(C.rock, 0.86) : C.rock;
  };
  if (onWater) {
    // the jetty's HEAD: a rounded granite-block island filling the pad,
    // wet dark stones at its rim (the sea and its surf ring it)
    const cx = (p.SW - 1) / 2, cy = (p.SH - 1) / 2, ax = p.SW / 2 - 1, ay = p.SH / 2 - 1;
    for (let yy = 1; yy < p.SH - 1; yy++) for (let xx = 1; xx < p.SW - 1; xx++) {
      const e = ((xx - cx) / ax) ** 2 + ((yy - cy) / ay) ** 2;
      if (e > 1.15) {
        // a thin foam collar where the sea breaks on the granite
        if (e < 1.6 && (xx * 3 + yy * 5 + (RS.tick >> 2)) % 4 !== 0) p.gScr(xx, yy, (xx + yy + (RS.tick >> 2)) % 3 ? hx("#eef4f4") : hx("#bcd6dc"));
        continue;
      }
      p.gScr(xx, yy, granite(p.AX + xx, p.AY + yy, e > 0.7));
    }
  } else {
    const rr = Math.min(3, (Math.min(p.SW, p.SH) >> 1) - 1);
    for (let yy = y - rr; yy <= y + rr; yy++) for (let xx = x - rr - 1; xx <= x + rr + 1; xx++) {
      if ((xx - x) * (xx - x) + (yy - y) * (yy - y) * 2 > rr * rr + 3) continue;
      p.gScr(xx, yy, rip(xx, yy));
    }
  }
  if (!onWater) {
    // the jetty / causeway runs on toward the shore across the lot
    p.fill(Math.max(1, l - 1), 1, Math.min(p.L - 2, l + 1), p.D - 2, (l2, d2) => { const [X, Y] = p.gx(l2, d2); return rip(X - p.AX, Y - p.AY); });
  }
  const lamp = p.lit ? EMISSIVE.beaconWhite : hx("#dfe6e0");
  const lampHalo = p.lit ? EMISSIVE.beam : hx("#9aa8a4");
  const black = hx("#1e1e20"), white = M.white;
  p.later(y + 0.5, () => p.tall(() => {
    const top = y - tall;
    // tower: 5 px at the foot tapering to 3 px under the gallery
    for (let yy = top + 3; yy <= y; yy++) {
      const k = (yy - (top + 3)) / Math.max(1, y - top - 3);
      const hw = k > 0.55 ? 2 : 1;
      const isBand = v === 1 && k > 0.2 && k < 0.45;
      const body = isBand ? band : white;
      for (let dx = -hw; dx <= hw; dx++) {
        const f = dx === -hw ? 1.04 : dx === hw ? 0.8 : dx > 0 ? 0.9 : 1;
        p.scr(x + dx, yy, shade(body, f));
      }
      // a door at the foot and two slit windows up the tower
      if (yy === y) p.scr(x, yy, black);
      if ((yy === top + 6 || yy === top + 10) && yy < y - 1) p.scr(x, yy, p.lit ? C.windowLit : M.glass);
    }
    // gallery rail (black), lantern (glazing between black mullions), cap
    for (let dx = -2; dx <= 2; dx++) p.scr(x + dx, top + 2, black);
    p.scr(x - 1, top + 1, black); p.scr(x, top + 1, lamp); p.scr(x + 1, top + 1, black);
    p.scr(x - 1, top, lampHalo); p.scr(x, top, lamp); p.scr(x + 1, top, black);
    for (let dx = -1; dx <= 1; dx++) p.scr(x + dx, top - 1, black);
    p.scr(x, top - 2, black); // ventilator ball
    // shadow to the SE over the riprap / water
    for (let k = 1; k <= 4; k++) p.shadowPx(x + 1 + k, y + 1);
  }));
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
