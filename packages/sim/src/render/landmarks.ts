/**
 * Landmark COMPOUNDS on the plan kit (Stage 2, renderer pass 2): the
 * Megachurch, the county Fairground and the Radio Tower are drawn from
 * their Lot across the whole footprint (the Landmark id only marks one
 * anchor tile; its old 1-tile icon badge is suppressed in townRender).
 * Also the unclipped OVERLAYS that reach past a footprint: the
 * lighthouse's rotating beam over the water.
 */
import { Lot, type World } from "../types.js";
import { hexToRgb, shade, type RGB } from "../palette.js";
import { C, RS, TILE_PX, pixHash, isLitHour, type Put } from "./core.js";
import { EMISSIVE } from "./grade.js";
import { householdPaint, householdVehicle } from "./vehicles.js";
import { lotFrontage } from "./frontage.js";
import { M, Plan, type Author } from "./plan.js";
import { pane, letters, occupancy } from "./lots.js";
import { lighthouseTower } from "./works.js";

const hx = hexToRgb;

/** Lots whose compound art replaces the landmark icon badge. */
export const COMPOUND_LOTS = new Set<number>([Lot.Megachurch, Lot.Fairground, Lot.RadioTower, Lot.WaterTower]);

/** nose-in parking rows filling [l0..l1]×[d0..d1] (double-loaded, 3-px stalls) */
function parkingField(p: Plan, l0: number, d0: number, l1: number, d1: number, occ: number, salt: number): void {
  p.pave(l0, d0, l1, d1, "asphalt");
  for (let d = d0 + 1; d + 3 <= d1; d += 9) {
    for (const [dn, toward] of [[d, false], [d + 7, true]] as const) {
      if (dn > d1) continue;
      for (let l = l0 + 1; l + 1 <= l1; l += 3) {
        for (let k = 0; k < 3; k++) p.g(l - 1, toward ? dn - k : dn + k, M.stripe);
        const h = p.h(l * 17 + dn, salt);
        if (h % 100 >= occ) continue;
        p.carDir(l, toward ? dn - 1 : dn + 1, toward ? 2 : 3, householdVehicle(h), householdPaint(h >>> 4));
      }
    }
  }
}

// ------------------------------------------------------------ MEGACHURCH

/**
 * The old megachurch: a huge A-frame SANCTUARY gable-end to the street with
 * a tall stained-glass slot over the doors, a flat-roofed FELLOWSHIP HALL
 * with a ribbon of windows joined by a covered walk, a slim campanile BELL
 * TOWER with a gold cross, the back-lit LAWN SIGN, and the big lot.
 */
export function megachurch(p: Plan): void {
  const { L, D } = p;
  const v = p.h(1) % 3;
  const brick = [hx("#b8906a"), hx("#e2d6bc"), hx("#9a5a44")][v]!;
  const roof = [hx("#5a4a42"), hx("#3f5a6a"), hx("#6a6a6a")][v]!;
  const fr = p.D - 2;
  const sanctW = Math.max(10, Math.min(16, (L * 0.5) | 0));
  const sl0 = 2, sl1 = sl0 + sanctW - 1;
  const sd0 = 2, sd1 = Math.min(fr - 6, D - 8);
  // grounds: lawn in front of the sanctuary, lot beside the hall
  p.lawn(1, sd1 + 1, sl1 + 1, fr);
  const cxl = (sl0 + sl1) >> 1;
  p.pave(cxl - 1, sd1 + 1, cxl + 2, fr, "concrete");
  const hl0 = sl1 + 3, hl1 = L - 2;
  const hd0 = 3, hd1 = Math.min(sd1 - 2, hd0 + 7);
  if (hl1 - hl0 >= 4) parkingField(p, hl0, hd1 + 2, hl1, fr, Math.min(90, occupancy() + ((RS.tick / 2400) % 7 === 0 ? 40 : 10)), 5);
  const glass = [hx("#3f5fa8"), hx("#c8342a"), hx("#e8c040"), hx("#3f8a5a")];
  p.box({
    l0: sl0, d0: sd0, l1: sl1, d1: sd1, h: 5, wall: brick, roof, kind: "gable", across: true,
    front: (u, r, n, hh) => {
      const mid = n >> 1;
      if (Math.abs(u - mid + 0.5) < 1.2 && r < hh - 2) return p.lit ? glass[(r + u) & 3]! : shade(glass[(r + u) & 3]!, 0.8); // stained-glass slot
      if ((u === mid - 2 || u === mid + 1) && r >= hh - 2) return hx("#3a2a1e"); // doors
      if (r === hh - 1 && Math.abs(u - mid + 0.5) < 3) return shade(M.concrete, 1.05); // entry slab
      return u === 0 || u === n - 1 ? shade(brick, 0.9) : null;
    },
    side: (u, r, n, hh) => (u % 3 === 1 && r >= 1 && r < hh - 1 ? pane(p, u, r, 40, glass[u & 3]!) : null),
    lip: (k, n) => (Math.abs(k - (n >> 1) + 0.5) < 1.2 ? glass[k & 3]! : shade(brick, 0.9)),
  });
  // fellowship hall
  if (hl1 - hl0 >= 4) {
    p.box({
      l0: hl0, d0: hd0, l1: hl1, d1: hd1, h: 2, wall: brick, roof: M.tar,
      front: (u, r, n) => (r === 0 && u % 4 !== 0 ? pane(p, u, r, 41) : u === n >> 1 ? hx("#3a2a1e") : null),
      side: (u, r) => (r === 0 && u % 3 !== 0 ? pane(p, u, r, 42) : null),
      lip: (k) => (k % 4 !== 0 ? M.glass : brick),
      deco: () => { p.top(hl0 + 2, hd0 + 1, M.hvac); p.top(hl1 - 2, hd0 + 2, M.hvac); },
    });
    // covered walkway between them
    for (let l = sl1 + 1; l < hl0; l++) { p.obj(l, hd0 + 3, M.white); p.obj(l, hd0 + 4, shade(M.white, 0.8)); }
  }
  // campanile
  const tl = sl1 + 1, td = sd1;
  const bell = C.landmarkGold;
  p.spr(tl, td, [".g.", "ggg", ".g.", "BBB", "BkB", "BbB", "BBB", "BBB", "BBB", "BBB", "BBB", "BBB", "BBB"], {
    g: bell, B: brick, k: hx("#2a2622"), b: bell,
  }, 1, 5);
  // back-lit lawn sign
  const sl = sl0 + 1;
  p.spr(sl, fr, ["FFFFFF", "FwkwkF", ".|..|."], { F: brick, w: p.lit ? C.windowLit : M.white, k: hx("#2a2622"), "|": M.steel }, 0, 50);
  p.tree(sl1 - 1, fr - 1, true, 50);
}

// ------------------------------------------------------------ FAIRGROUND

/** Unit-circle table (16 steps, ×1000) — presentation only. */
const CIRC16: readonly [number, number][] = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  return [Math.round(Math.cos(a) * 1000), Math.round(Math.sin(a) * 1000)] as [number, number];
});

function ferrisWheel(p: Plan, l: number, d: number, R: number): void {
  const [cx, cy0] = p.S(l, d);
  const cy = cy0 - R - 2; // axle height above its base
  const step = p.winter ? 0 : (RS.tick >> 4) & 15; // slow turn
  const steel = hx("#e8e4d8");
  const gond = [hx("#c8342a"), hx("#e8c040"), hx("#3f7fbf"), hx("#2f9a5a")];
  const lit = isLitHour();
  p.later(cy0 + 0.6, () => {
    // A-frame legs
    for (let k = 0; k <= R + 2; k++) {
      p.scr(cx - 1 - (k >> 1), cy + k, M.steel);
      p.scr(cx + 1 + (k >> 1), cy + k, M.steel);
    }
    // rim
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const x = cx + Math.round(Math.cos(a) * R), y = cy + Math.round(Math.sin(a) * R);
      const bulb = lit && ((i + (RS.tick >> 1)) & 3) === 0;
      p.scr(x, y, bulb ? EMISSIVE.hazard : steel);
    }
    // spokes + gondolas, rotating
    for (let k = 0; k < 8; k++) {
      const [c, s] = CIRC16[(k * 2 + step) & 15]!;
      for (let rr = 1; rr < R; rr++) {
        if (k % 2 === 0) p.scr(cx + Math.round((c * rr) / 1000), cy + Math.round((s * rr) / 1000), shade(steel, 0.85));
      }
      const gx = cx + Math.round((c * R) / 1000), gy = cy + Math.round((s * R) / 1000);
      p.scr(gx, gy + 1, gond[k & 3]!);
    }
    p.scr(cx, cy, M.dark);
  });
}

function tent(p: Plan, l: number, d: number, a: RGB): void {
  p.box({ l0: l, d0: d, l1: l + 2, d1: d + 2, h: 1, wall: a, roof: a, kind: "gable", noSnow: false,
    front: (u) => (u === 1 ? hx("#3a2a1e") : u % 2 ? M.white : a),
  });
  p.top(l + 1, d, M.white);
}

/**
 * County fairground: a white board fence with the gate arch on the street,
 * the dirt race oval with its infield and the covered GRANDSTAND along the
 * home straight; the MIDWAY with a slowly turning FERRIS WHEEL (bulbs chase
 * after dark), striped tents and a carousel; long white EXHIBITION BARNS
 * at the back. Winter: the fair is shut (the wheel stands still).
 */
export function fairground(p: Plan): void {
  const { L, D } = p;
  const fr = p.D - 2;
  const fence = p.winter ? hx("#d8d4c8") : M.white;
  // board fence (ring inset), gate at the street
  const gate0 = (L >> 1) - 2, gate1 = (L >> 1) + 2;
  for (let l = 1; l <= L - 2; l++) { p.g(l, 1, fence); if (l < gate0 || l > gate1) p.g(l, D - 2, fence); }
  for (let d = 1; d <= D - 2; d++) { p.g(1, d, fence); p.g(L - 2, d, fence); }
  // the race oval (left ~60%)
  const ow = Math.floor((L - 4) * 0.58), oh = D - 12;
  const ocl = 2 + ow / 2, ocd = 3 + oh / 2;
  const rx = ow / 2, ry = oh / 2;
  const dirt = hx("#a8865e"), groove = hx("#96764f");
  for (let d = 2; d <= 3 + oh; d++) for (let l = 2; l <= 2 + ow; l++) {
    const ex = (l - ocl) / rx, ey = (d - ocd) / ry;
    const e = ex * ex + ey * ey;
    if (e > 1) continue;
    if (e > 0.62) {
      const [X, Y] = p.gx(l, d);
      p.g(l, d, p.winter ? (pixHash(X, Y, 3) % 3 ? M.snow : hx("#c8c0b0")) : e > 0.8 ? groove : dirt);
    } else p.g(l, d, p.turfAt(l, d));
  }
  // grandstand along the home straight (near side of the oval)
  const gl0 = Math.round(ocl - rx * 0.55), gl1 = Math.round(ocl + rx * 0.55);
  const gd0 = 4 + oh, gd1 = gd0 + 3;
  p.box({
    l0: gl0, d0: gd0, l1: gl1, d1: gd1, h: 2, wall: hx("#b8b0a0"), roof: hx("#7a3a30"), kind: "flat",
    front: (u, r) => (u % 4 === 0 ? M.steel : r === 0 ? hx("#d8d0c0") : hx("#a09888")),
    back: (u, r) => (r === 0 ? (u % 2 ? hx("#e8e4d8") : hx("#c8c0b0")) : u % 5 === 0 ? M.steel : hx("#9a9282")), // seat tiers
    lip: (k) => (k % 4 === 0 ? M.steel : hx("#7a3a30")),
  });
  // midway ground (dirt / gravel) on the right
  const ml0 = 3 + ow, ml1 = L - 3;
  p.pave(ml0, 2, ml1, fr, "dirt");
  // exhibition barns at the back of the midway
  const bw = Math.max(5, ((ml1 - ml0) >> 1) - 1);
  for (let i = 0; i < 2; i++) {
    const bl0 = ml0 + 1 + i * (bw + 2);
    if (bl0 + bw - 1 > ml1) break;
    p.box({
      l0: bl0, d0: 2, l1: bl0 + bw - 1, d1: 6, h: 2, wall: M.white, roof: i ? hx("#9a3a2c") : hx("#5a5d62"), kind: "gable",
      front: (u, _r, n) => (u === n >> 1 ? hx("#3a2a1e") : u % 3 === 0 ? hx("#9a3a2c") : null),
      lip: () => (i ? hx("#9a3a2c") : M.white),
    });
  }
  // ferris wheel, tents, carousel
  const R = Math.max(4, Math.min(6, ((ml1 - ml0) >> 1) - 1));
  ferrisWheel(p, ml0 + ((ml1 - ml0) >> 1), Math.min(fr - 4, 10 + R * 2), R);
  const tc = [hx("#c8342a"), hx("#3f7fbf"), hx("#e8c040")];
  let k = 0;
  for (let l = ml0 + 1; l + 2 <= ml1; l += 5) tent(p, l, fr - 4, tc[k++ % 3]!);
  // carousel
  const [cx, cy] = p.S(ml0 + 2, Math.min(fr - 8, 10 + R * 2 + 1));
  const ph = p.winter ? 0 : (RS.tick >> 2) & 1;
  p.sprAt(cx, cy, [".rwr.", "rwrwr", ph ? "p.y.b" : "y.b.p"], { r: hx("#c8342a"), w: M.white, p: hx("#e8a0c0"), y: hx("#e8c040"), b: hx("#3f7fbf") }, -1, 2);
  // gate arch
  p.spr(L >> 1, fr, ["AAAAAA", "AwkwkA", "|....|"], { A: hx("#c8342a"), w: M.white, k: hx("#2a2622"), "|": M.white }, 3, 50);
  // a few trees along the fence
  p.tree(3, fr - 1, true, 60);
  p.tree(ml1 - 1, fr - 1, false, 61);
}

// ------------------------------------------------------------ RADIO TOWER

/** Screen geometry of the mast (for the author and the beacon halo). */
function mastOf(p: Plan): { l: number; d: number; H: number } {
  return { l: (p.L >> 1) - 1, d: (p.D >> 1) + 2, H: Math.min(p.D - 4, p.o <= 1 ? p.SH - 5 : p.SH - 5) };
}

/**
 * AM radio mast: a red-and-white banded lattice mast on a concrete pier,
 * GUY WIRES from three heights to anchors at the lot corners, the concrete
 * transmitter shack with the coax run, a small fence round the base, and
 * the red aviation BEACON on top blinking with a halo (the mid-mast lamp
 * blinks in antiphase).
 */
export function radioTower(p: Plan): void {
  const { L, D } = p;
  const { l, d, H } = mastOf(p);
  // gravel pad + base fence
  p.pave(l - 2, d - 2, l + 2, d + 1, "gravel");
  const f = hx("#a8a49a");
  for (let i = -2; i <= 2; i++) { p.obj(l + i, d - 2, f); p.obj(l + i, d + 1, f); }
  for (let i = -2; i <= 1; i++) { p.obj(l - 2, d + i, f); p.obj(l + 2, d + i, f); }
  // transmitter shack + coax
  const tl0 = l + 4, td0 = d + 1;
  p.box({ l0: tl0, d0: td0, l1: Math.min(L - 3, tl0 + 3), d1: Math.min(D - 3, td0 + 2), h: 1, wall: M.concrete, roof: shade(M.concrete, 0.9), front: (u) => (u === 1 ? C.door : null) });
  for (let i = l + 1; i < tl0; i++) p.g(i, d, M.dark);
  // dirt track to the gate
  for (let dd = td0 + 3; dd <= D - 2; dd++) p.g(tl0 + 1, dd, shade(M.dirt, 1.02));
  // anchors at three corners
  const anchors: [number, number][] = [[2, 2], [L - 3, 2], [2, D - 3]];
  for (const [al, ad] of anchors) p.obj(al, ad, M.concrete);
  const [mx, my] = p.S(l, d);
  const on = ((RS.tick >> 3) & 1) === 0;
  p.later(999, () => {
    // guy wires from three heights
    const wire = hx("#8a867c");
    for (const [al, ad] of anchors) {
      const [axp, ayp] = p.S(al, ad);
      for (const frac of [0.35, 0.7, 1]) {
        const hy = my - Math.round(H * frac);
        const n = Math.max(Math.abs(axp - mx), Math.abs(ayp - hy));
        for (let s = 1; s < n; s += 1) {
          if (s % 2) continue; // fine wire: dotted
          const x = mx + Math.round(((axp - mx) * s) / n), y = hy + Math.round(((ayp - hy) * s) / n);
          p.scr(x, y, wire);
        }
      }
    }
    // the mast: banded red / white, 1 px lattice + pier
    p.scr(mx, my, M.concrete); p.scr(mx + 1, my, shade(M.concrete, 0.8));
    for (let k = 1; k <= H; k++) {
      const band = ((k - 1) / 2 | 0) % 2 === 0 ? hx("#d0402f") : M.white;
      p.scr(mx, my - k, band);
      if (k % 2 === 0) p.scr(mx + 1, my - k, shade(band, 0.7));
    }
    const top = my - H - 1;
    p.scr(mx, top, on ? EMISSIVE.beacon : hx("#5a1a1a"));
    if (on) { p.scr(mx - 1, top, hx("#c83a30")); p.scr(mx + 1, top, hx("#c83a30")); p.scr(mx, top - 1, hx("#c83a30")); }
    else p.scr(mx, my - (H >> 1), EMISSIVE.beacon);
    // shadow of the mast on the grass
    for (let k = 1; k < 5; k++) p.shadowPx(mx + k, my + 1);
  });
}

// ------------------------------------------------------------ overlays

const LIGHT_CACHE = new WeakMap<World, number[]>();

/**
 * Overlays that reach past a footprint (unclipped, drawn after the ground
 * pass): the lighthouse's rotating beam at dusk / night.
 */
export function drawLotOverlays(w: World, tick: number, put: Put, view: { x0: number; y0: number; x1: number; y1: number }): void {
  if (!isLitHour()) return;
  let list = LIGHT_CACHE.get(w);
  if (!list) {
    list = [];
    for (let t = 0; t < w.lot.length; t++) if (w.lot[t] === Lot.Lighthouse) list.push(t);
    LIGHT_CACHE.set(w, list);
  }
  const seen = new Set<number>();
  for (const t of list) {
    // anchor of this lighthouse's footprint
    let ax = t % w.width, ay = (t / w.width) | 0;
    while (ax > 0 && w.lot[ay * w.width + ax - 1] === Lot.Lighthouse) ax--;
    while (ay > 0 && w.lot[(ay - 1) * w.width + ax] === Lot.Lighthouse) ay--;
    const key = ay * w.width + ax;
    if (seen.has(key)) continue;
    seen.add(key);
    let fw = 1, fh = 1;
    while (ax + fw < w.width && w.lot[ay * w.width + ax + fw] === Lot.Lighthouse && fw < 2) fw++;
    while (ay + fh < w.height && w.lot[(ay + fh) * w.width + ax] === Lot.Lighthouse && fh < 2) fh++;
    if (ax + fw < view.x0 - 6 || ax > view.x1 + 6 || ay + fh < view.y0 - 6 || ay > view.y1 + 6) continue;
    const p = OVERLAY_PLAN;
    p.reset(w, ax, ay, fw, fh, lotFrontage(w, ax, ay, fw, fh));
    const { l, d, tall } = lighthouseTower(p);
    const [sx, sy] = p.S(l, d);
    const lx = p.AX + sx, ly = p.AY + sy - tall;
    // 32-step sweep, a long narrow cone of light
    const a = ((tick >> 1) % 32) / 32 * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const beam: RGB = EMISSIVE.beam;
    for (let r = 2; r < 34; r++) {
      const half = Math.floor(r / 9);
      for (let k = -half; k <= half; k++) {
        if (k !== 0 && (r + k * 2) % 3 !== 0) continue; // solid core, sparse flanks
        const x = Math.round(lx + ca * r - sa * k), y = Math.round(ly + sa * r + ca * k);
        put(x, y, r < 6 ? EMISSIVE.beaconWhite : beam);
      }
    }
  }
}
const OVERLAY_PLAN = new Plan();

export const LANDMARK_AUTHORS: Partial<Record<number, Author>> = {
  [Lot.Megachurch]: megachurch,
  [Lot.Fairground]: fairground,
  [Lot.RadioTower]: radioTower,
};

export { letters, TILE_PX };
