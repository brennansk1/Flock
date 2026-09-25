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
import { M, Plan, type Author, type Face } from "./plan.js";
import { pane, letters, occupancy } from "./lots.js";
import { lighthouseTower } from "./works.js";

const hx = hexToRgb;

/** Lots whose compound art replaces the landmark icon badge. */
export const COMPOUND_LOTS = new Set<number>([Lot.Megachurch, Lot.Fairground, Lot.RadioTower, Lot.WaterTower]);

// ------------------------------------------------------------ MEGACHURCH

/**
 * The megachurch (early-80s evangelical campus), ONE complex: the broad
 * wide-gable SANCTUARY, gable-end to the street, is the dominant mass, its
 * front wall carrying a tall lit cross window over the double doors under a
 * GLASS ENTRY CANOPY; a tall white STEEPLE with a cross stands at the
 * street corner on the low narthex LINK that joins the lower FELLOWSHIP
 * HALL (same brick / siding, same roof). A small PARKING APRON with a curb
 * cut beside the hall, the lawn with its walk, and the back-lit letter-board
 * MARQUEE ("JESUS SAVES") by the street. Variants: red brick · buff brick ·
 * white siding; slate / brown / blue-grey roof; needle spire or square
 * bell-tower cap.
 */
export function megachurch(p: Plan): void {
  const { L, D } = p;
  const v = p.h(1) % 3;
  const wall = [hx("#9a4a36"), hx("#c9a878"), hx("#e8e4d6")][v]!;
  const roof = [hx("#56585e"), hx("#6a4e3e"), hx("#4a5866")][p.h(2) % 3]!;
  const spire = p.h(3) % 2 === 0;
  const fr = D - 2;
  const small = L < 28;
  // massing (frontage-local)
  const sl0 = 5, sl1 = small ? 14 : 18, sd0 = 4, sd1 = D - 9;
  const hl0 = sl1 + 3, hl1 = L - 3, hd0 = 4, hd1 = sd1 - 4;
  const mid2 = sl0 + sl1; // 2× sanctuary centre
  // grounds: lawn before the sanctuary, walk to the street
  p.lawn(1, sd1 + 1, sl1 + 1, fr);
  p.lawn(1, sd0 + 4, sl0 - 1, sd1);
  p.walk((mid2 >> 1), sd1 + 4, fr);
  // parking apron with a curb cut beside the hall
  const ad0 = hd1 + 2, ad1 = hd1 + 7;
  p.pave(hl0 - 1, ad0, hl1, ad1, "asphalt");
  p.pave(hl1 - 3, ad1 + 1, hl1, fr, "asphalt");
  p.lawn(hl0 - 1, ad1 + 1, hl1 - 4, fr);
  const occ = Math.min(90, occupancy() + (((RS.tick / 2400) | 0) % 7 === 0 ? 40 : 15));
  for (let l = hl0 + 1; l + 1 <= hl1; l += 3) {
    for (let k = 0; k < 3; k++) p.g(l - 1, ad0 + k, M.stripe);
    const h = p.h(l * 17, 5);
    if (h % 100 < occ) p.carDir(l, ad0 + 1, 3, householdVehicle(h), householdPaint(h >>> 4));
  }
  p.lamp(hl1 - 4, ad1);
  const glassLit = p.lit ? C.windowLit : v === 2 ? hx("#3a4a66") : M.white;
  const door = hx("#3a2a1e");
  // SANCTUARY: wide gable, cross window over the doors
  p.box({
    l0: sl0, d0: sd0, l1: sl1, d1: sd1, h: small ? 6 : 7, wall, roof, kind: "gable", across: true,
    front: (u, r, n, hh) => {
      const c = Math.abs(2 * u - (n - 1));
      if (u === 0 || u === n - 1) return shade(wall, 0.9);
      if (c <= 1 && r >= -4 && r <= hh - 3) return glassLit; // the cross
      if (c <= 5 && r === -2) return glassLit;
      if (c <= 3 && r >= hh - 2) return (u & 1) ? door : shade(door, 1.3); // double doors
      if ((u === 2 || u === n - 3) && r >= 1 && r <= hh - 2) return pane(p, u, r, 40, hx("#3f5fa8"));
      return null;
    },
    back: (u, r, n, hh) => (u === n >> 1 && r >= hh - 2 ? door : u % 4 === 2 && r >= 1 && r <= hh - 2 ? pane(p, u, r, 43, hx("#3f5fa8")) : null),
    side: (u, r, n, hh) => (u % 3 === 1 && u < n - 1 && r >= 1 && r <= hh - 2 ? pane(p, u, r, 44, u % 9 === 4 ? hx("#8a3a4a") : hx("#34508a")) : u === n - 1 ? shade(wall, 0.9) : null),
    lip: (k, n) => (Math.abs(2 * k - (n - 1)) <= 1 ? glassLit : shade(wall, 0.9)),
  });
  // glass entry canopy over the doors
  p.box({
    l0: (mid2 >> 1) - 3, d0: sd1 + 1, l1: (mid2 >> 1) + 4, d1: sd1 + 3, h: 1, wall: hx("#34343a"), roof: hx("#9ec0d8"),
    front: (u, _r, n) => (u === 0 || u === n - 1 ? M.white : null),
    back: (u, _r, n) => (u === 0 || u === n - 1 ? M.white : null),
    side: () => M.white,
    deco: () => { for (let l = (mid2 >> 1) - 3; l <= (mid2 >> 1) + 4; l += 2) p.top(l, sd1 + 1, M.white); },
  });
  // narthex link
  p.box({
    l0: sl1 + 1, d0: hd0 + 1, l1: hl0 - 1, d1: sd1 - 1, h: 3, wall, roof: M.tar,
    front: (_u, r) => (r >= 1 ? M.glassBlue : null),
    lip: () => M.glassBlue,
  });
  // FELLOWSHIP HALL: lower, same materials
  p.box({
    l0: hl0, d0: hd0, l1: hl1, d1: hd1, h: 3, wall, roof, kind: "gable",
    front: (u, r, n) => (u === n >> 1 && r >= 1 ? door : r === 1 && u % 3 !== 0 ? pane(p, u, r, 41) : null),
    side: (u, r) => (r === 1 && u % 3 === 1 ? pane(p, u, r, 42) : null),
    lip: (k) => (k % 3 !== 0 ? M.glass : wall),
  });
  // STEEPLE on the street corner (screen-space, trimmed to fit): stands
  // forward on the lawn corner; where the frontage leaves too little sky
  // above that point it steps back along the link
  let tl = 3, td = sd1 + 2, by = 0;
  for (const [cl, cd] of [[3, sd1 + 2], [3, sd0 + 4], [sl1 + 2, sd1 + 1]] as const) {
    const y = p.S(cl, cd)[1];
    if (y > by) { by = y; tl = cl; td = cd; }
    if (y - 1 >= 15) break;
  }
  const room = by - 1;
  const rows = room >= 15
    ? [".c.", "ccc", ".c.", ".s.", ".S.", "sSt", "sSt", "WWV", "WDV", "WDV", "WWV"]
    : room >= 11 ? [".c.", "ccc", ".c.", "sSt", "WWV", "WDV", "WWV"] : [".c.", "ccc", "sSt", "WDV"];
  const shaft = Math.max(1, Math.min(5, room - rows.length - 1));
  for (let i = 0; i < shaft; i++) rows.push(i === 1 ? "WwV" : "WWV");
  rows.push("BdB");
  const tw = hx("#f2efe6");
  p.spr(tl, td, rows, {
    c: C.landmarkGold, s: shade(roof, 1.2), S: roof, t: shade(roof, 0.75),
    W: tw, V: shade(tw, 0.74), D: p.lit ? C.windowLit : hx("#2a2622"), w: shade(tw, 0.9),
    B: shade(wall, 0.9), d: door,
  }, 1, 6);
  p.later(by + 6.1, () => { for (let k = 1; k <= 3; k++) p.shadowPx(p.S(tl, td)[0] + 1 + k, by + 1); });
  // letter-board marquee by the street ("JESUS SAVES" / service times)
  const bg = p.lit ? C.windowLit : M.white, ink = hx("#3a3634");
  const msg = [["kkkkk.kkkkk", ".kk.kkk.kk."], ["kkkk.kkkkkk", "kkk.kk.kkk."], ["kkk.kk.kkkk", ".kkkk.kk.k."]][p.h(4) % 3]!;
  const bw = small ? 7 : 11;
  const hdr = v === 0 ? M.white : M.brick;
  p.spr(1, fr - 1, [
    "F".repeat(bw + 2),
    "F" + msg[0]!.slice(0, bw).replace(/\./g, "w") + "F",
    "F" + msg[1]!.slice(0, bw).replace(/\./g, "w") + "F",
    ".b" + ".".repeat(bw - 2) + "b.",
  ], { F: hdr, ".": null, k: ink, b: shade(M.brick, 0.8), w: bg }, 0, 50);
  p.tree(sl1, fr - 1, false, 50);
  p.tree(L - 3, 2, true, 51);
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

/**
 * AM radio mast in the open land: the lot keeps the natural ground (grass /
 * snow / desert — townRender draws it as open country), with a small
 * chain-linked GRAVEL PAD (~1 tile) round the base holding the concrete
 * TRANSMITTER SHACK, the 2-px red/white banded LATTICE MAST on its pier,
 * four GUY WIRES out to concrete anchor blocks near the lot corners, a dirt
 * track to the street, and the red aviation BEACON on top blinking with a
 * bloom (the mid-mast lamp blinks in antiphase). Screen-space so the mast
 * stays upright in every frontage.
 */
export function radioTower(p: Plan): void {
  const { SW, SH, o } = p;
  const mx = (SW >> 1) - 1, my = SH - 8;
  const H = my - 4; // beacon at y = 3 leaves room for its bloom
  const px0 = mx - 3, px1 = mx + 6, py0 = my - 3, py1 = my + 3;
  // gravel pad + chain-link fence (gate toward the street)
  for (let y = py0; y <= py1; y++) for (let x = px0; x <= px1; x++) {
    const h = pixHash(p.AX + x, p.AY + y, 53);
    p.gScr(x, y, p.winter && h % 3 !== 0 ? M.snow : h % 4 === 0 ? shade(M.gravel, 1.12) : h % 7 === 0 ? shade(M.gravel, 0.86) : M.gravel);
  }
  const f = hx("#a8a49a"), post = hx("#6a6660");
  const gx = (px0 + px1) >> 1, gy = (py0 + py1) >> 1;
  const gate = (x: number, y: number): boolean =>
    (o === 0 && y === py1 && Math.abs(x - gx) <= 1) || (o === 1 && y === py0 && Math.abs(x - gx) <= 1) ||
    (o === 2 && x === px1 && Math.abs(y - gy) <= 1) || (o === 3 && x === px0 && Math.abs(y - gy) <= 1);
  for (let x = px0; x <= px1; x++) for (const y of [py0, py1]) if (!gate(x, y)) p.gScr(x, y, (x - px0) % 3 === 0 ? post : f);
  for (let y = py0; y <= py1; y++) for (const x of [px0, px1]) if (!gate(x, y)) p.gScr(x, y, (y - py0) % 3 === 0 ? post : f);
  // dirt track from the gate to the street
  const track = p.winter ? hx("#c8c4bc") : shade(M.dirt, 1.02);
  if (o === 0) for (let y = py1 + 1; y < SH - 1; y++) { p.gScr(gx, y, track); p.gScr(gx + 1, y, shade(track, 0.94)); }
  if (o === 1) for (let y = py0 - 1; y >= 1; y--) { p.gScr(gx, y, track); p.gScr(gx + 1, y, shade(track, 0.94)); }
  if (o === 2) for (let x = px1 + 1; x < SW - 1; x++) { p.gScr(x, gy, track); p.gScr(x, gy + 1, shade(track, 0.94)); }
  if (o === 3) for (let x = px0 - 1; x >= 1; x--) { p.gScr(x, gy, track); p.gScr(x, gy + 1, shade(track, 0.94)); }
  // transmitter shack on the pad (screen rect → local box)
  const [a0, b0] = p.Sinv(mx + 2, my - 1), [a1, b1] = p.Sinv(mx + 5, my + 2);
  const shackDoor: Face = (u, r, n) => (u === n - 2 && r >= 0 ? C.door : u === 1 && r === 0 ? pane(p, u, r, 45) : null);
  p.box({
    l0: Math.min(a0, a1), d0: Math.min(b0, b1), l1: Math.max(a0, a1), d1: Math.max(b0, b1), h: 2,
    wall: M.concreteLight, roof: shade(M.concrete, 0.86), front: shackDoor, back: shackDoor, side: shackDoor,
  });
  // coax run from the mast to the shack
  p.gScr(mx + 2, my, M.dark);
  // anchors near the lot corners
  const anchors: [number, number][] = [[3, 4], [SW - 4, 4], [3, SH - 4], [SW - 4, SH - 4]];
  for (const [ax, ay] of anchors) { p.scr(ax, ay, M.concreteLight); p.scr(ax + 1, ay, shade(M.concrete, 0.8)); }
  const on = ((RS.tick >> 3) & 1) === 0;
  p.later(my + 0.9, () => {
    // guy wires: front pair from the top, back pair from ~2/3 height
    const wire = hx("#9a968c");
    anchors.forEach(([ax, ay], i) => {
      const hy = my - (i < 2 ? Math.round(H * 0.66) : H - 1);
      const n = Math.max(Math.abs(ax - mx), Math.abs(ay - hy));
      for (let s = 1; s < n; s++) p.scr(mx + (ax > mx ? 1 : 0) + Math.round(((ax - mx) * s) / n), hy + Math.round(((ay - hy) * s) / n), wire);
    });
    // the mast: 2-px lattice, banded red / white, on its pier
    p.scr(mx - 1, my, M.concrete); p.scr(mx, my, M.concrete); p.scr(mx + 1, my, shade(M.concrete, 0.8));
    for (let k = 1; k <= H; k++) {
      const band = (((k - 1) >> 1) & 1) === 0 ? hx("#d0402f") : M.white;
      p.scr(mx, my - k, k & 1 ? band : shade(band, 0.88));
      p.scr(mx + 1, my - k, k & 1 ? shade(band, 0.72) : shade(band, 0.8));
    }
    // beacon on top, mid-mast lamp in antiphase
    p.beacon(mx, my - H - 1, on);
    p.scr(mx + 1, my - H - 1, on ? EMISSIVE.beaconGlow : hx("#5a1a1a"));
    p.beacon(mx + 1, my - (H >> 1), !on, 1);
    // the mast's shadow on the ground, to the SE
    for (let k = 1; k < 6; k++) p.shadowPx(mx + 1 + k, my + 1 + (k >> 1));
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
