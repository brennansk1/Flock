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
import { M, Plan, PLAN_OVER, type Author, type Face } from "./plan.js";
import { pane, letters, occupancy } from "./lots.js";
import { lighthouseTower } from "./works.js";

const hx = hexToRgb;

/** Lots whose compound art replaces the landmark icon badge. */
export const COMPOUND_LOTS = new Set<number>([Lot.Megachurch, Lot.Fairground, Lot.RadioTower, Lot.WaterTower]);

// ------------------------------------------------------------ MEGACHURCH

/**
 * The 1980s Missouri MEGACHURCH campus (the Ozarks/Springfield look): a
 * HUGE low DOME auditorium on a brick drum ringed with slit windows —
 * standing-seam roof ribbed like a fan, a lantern and cross on top; a
 * GLASS ATRIUM entry (a mullioned glass box, warm-lit at night) at the
 * dome's foot; a tall freestanding white SPIRE (a tapered steel needle
 * with a cross) on the lawn; a low brick EDUCATION wing; and a HUGE
 * striped lot that fills on Sunday morning and Wednesday night and
 * empties between (pure function of the frame clock). The back-lit
 * letter-board marquee stands by the street.
 * Variants: red / buff brick drum · white / copper / pewter dome.
 */
export function megachurch(p: Plan): void {
  const { L, D } = p;
  const v = p.h(1) % 3;
  const brick = [hx("#9a4a36"), hx("#c9a878"), hx("#b8a890")][v]!;
  const dome = [hx("#e4e2dc"), hx("#6f9f8e"), hx("#9aa0a8")][p.h(2) % 3]!;
  const fr = D - 2;
  const small = L < 44;
  // ---- the big lot: the street-side right-hand third, double-loaded aisles
  const pl0 = small ? L - 14 : L - 17, pl1 = L - 2;
  p.pave(pl0, 1, pl1, fr, "asphalt");
  // attendance: Sunday morning full, Wednesday night half, weekday trickle
  const DAY = 2400;
  const day = (RS.tick / DAY) | 0, tod = RS.tick % DAY;
  const dow = ((day % 7) + 7) % 7;
  const occ = dow === 0 && tod > 500 && tod < 1300 ? 92 : dow === 3 && tod > 1700 && tod < 2150 ? 60 : p.night ? 4 : 18;
  for (let d0 = 3; d0 + 4 <= fr - 1; d0 += 9) {
    for (const [row, toSt] of [[d0, false], [d0 + 5, true]] as const) {
      for (let l = pl0 + 2; l + 1 <= pl1 - 1; l += 3) {
        for (let k = 0; k < 3; k++) p.g(l - 1, row + (toSt ? -k + 2 : k), M.stripe);
        const h = p.h(l * 31 + row, 7);
        // cars come and go: a stall's car arrives/leaves on its own hashed
        // minute, so the lot fills and drains a few cars at a time
        const jitter = (h >>> 8) % 40;
        if ((h % 100) + (((RS.tick >> 7) + jitter) % 9) - 4 < occ) {
          p.carDir(l, row + 1, toSt ? 2 : 3, householdVehicle(h), householdPaint(h >>> 4));
        }
      }
    }
  }
  for (let d = 6; d <= fr - 2; d += 9) p.lamp(pl0 + 1, d);
  // ---- lawn + walk + drive
  p.lawn(1, 1, pl0 - 1, fr);
  const cl = small ? 16 : 20; // dome centre (local)
  const R = small ? 9 : 12;
  const cd = small ? 10 : 12;
  p.walk(cl, cd + 10, fr);
  // ---- the EDUCATION wing (low brick, ribbon windows), left of the dome
  const el1 = cl - R + 2;
  if (el1 >= 6) {
    p.box({
      l0: 2, d0: 2, l1: el1, d1: cd + 4, h: 3, wall: brick, roof: M.tar, kind: "flat",
      front: (u, r, n) => (r === 1 && u % 4 !== 0 && u < n - 1 ? pane(p, u, r, 60, M.glassBronze) : null),
      side: (u, r) => (r === 1 && u % 4 !== 0 ? pane(p, u, r, 61, M.glassBronze) : null),
      back: (u, r) => (r === 1 && u % 4 === 1 ? pane(p, u, r, 62) : null),
      lip: (k) => (k % 4 ? M.glassBronze : brick),
      deco: () => { p.top(4, 4, M.hvac); p.top(6, 4, M.hvac); },
    });
  }
  // ---- the DOME auditorium (screen space: the dome is round from any side)
  const [sx, sy] = p.S(cl, cd);
  const Ry = Math.round(R * 0.62);
  const drum = small ? 3 : 4;
  const slit = p.lit ? C.windowLit : hx("#3a4658");
  p.later(sy + Ry + drum + 0.5, () => {
    for (let dy = -Ry; dy <= Ry + drum; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = sx + dx, y = sy + dy;
        const ex = dx / R;
        const inDome = ex * ex + (dy / Ry) * (dy / Ry) <= 1;
        // drum wall: below the dome's southern rim, down `drum` rows
        const rimY = Math.sqrt(Math.max(0, 1 - ex * ex)) * Ry;
        if (!inDome) {
          if (Math.abs(dx) < R && dy > rimY - 0.5 && dy <= rimY + drum) {
            const r = dy - rimY;
            let c: RGB = dx > R * 0.6 ? shade(brick, 0.8) : dx < -R * 0.6 ? shade(brick, 1.05) : brick;
            if (r < 1) c = shade(M.concreteLight, 0.95); // cornice band
            else if (dx % 3 === 0 && r >= 1.5 && r <= drum - 0.5) c = slit;
            p.scr(x, y, c, 3);
          }
          continue;
        }
        // dome surface: lit from the NW, fan RIBS every 15°, a lantern ring
        const ny = dy / Ry;
        const nz = Math.sqrt(Math.max(0, 1 - ex * ex - ny * ny));
        let f = 0.78 + 0.32 * (-0.5 * ex - 0.55 * ny + 0.55 * nz);
        const ang = Math.atan2(dy / Ry, ex);
        const rib = Math.abs(((ang / (Math.PI / 12)) % 1 + 1) % 1 - 0.5) > 0.42;
        if (rib && nz < 0.93) f *= 0.9;
        if (nz > 0.93 && nz < 0.975) f *= 0.82; // lantern ring
        let c = shade(dome, f);
        if (RS.season === "winter" && ny < 0.2 && pixHash(x, y, 5) % 3 !== 0) c = mixC(c, M.snow, 0.7);
        p.scr(x, y, c, 2);
      }
    }
    // lantern + cross on the crown
    const on = p.lit;
    p.tall(() => {
      const lx = sx, ly = sy - Math.round(Ry * 0.45);
      p.scr(lx - 1, ly, shade(dome, 1.1), 2); p.scr(lx, ly, on ? C.windowLit : shade(dome, 0.8), 2); p.scr(lx + 1, ly, shade(dome, 0.85), 2);
      const cross = on ? EMISSIVE.beaconWhite : C.landmarkGold;
      for (let k = 1; k <= 4; k++) p.scr(lx, ly - k, cross);
      p.scr(lx - 1, ly - 3, cross); p.scr(lx + 1, ly - 3, cross);
    });
  });
  // ---- the GLASS ATRIUM entry at the dome's foot, toward the street
  const al0 = cl - (small ? 4 : 6), al1 = cl + (small ? 4 : 6);
  const ad0 = cd + Ry - 1, ad1 = cd + Ry + (small ? 3 : 4);
  const glass = p.lit ? C.windowLit : hx("#7aa4bc");
  const mull = hx("#e8ecee");
  p.box({
    l0: al0, d0: ad0, l1: al1, d1: ad1, h: small ? 3 : 4, wall: glass, roof: hx("#a8c8d8"), kind: "flat", noSnow: true,
    front: (u, r, n, hh) => (u % 3 === 0 || r === 0 ? mull : (u === n >> 1 || u === (n >> 1) - 1) && r >= hh - 2 ? hx("#2a3440") : glass),
    side: (u, r) => (u % 3 === 0 || r === 0 ? mull : glass),
    back: (u, r) => (u % 3 === 0 || r === 0 ? mull : glass),
    lip: (k) => (k % 3 === 0 ? mull : glass),
    deco: () => {
      for (let l = al0; l <= al1; l += 3) for (let d = ad0; d <= ad1; d++) p.top(l, d, mull);
      for (let l = al0; l <= al1; l++) p.top(l, ad0, mull);
    },
  });
  // ---- the SPIRE: a tall tapered white steel needle with a cross
  const spL = al1 + 3, spD = Math.min(fr - 3, ad1 + 2);
  const needle = hx("#f2f0ea"), needleD = hx("#bcbab4");
  const rows = [".+.", "+++", ".+.", ".W.", ".W.", ".W.", ".W.", ".W.", ".W.", ".Wd", ".Wd", ".Wd", "WWd", "WWd", "WWd", "WWd", "WWd", "WWd", "WWd", "BBB"];
  const tall = small ? rows.slice(0, 3).concat(rows.slice(6)) : rows;
  p.spr(spL, spD, tall, { "+": p.lit ? EMISSIVE.beaconWhite : C.landmarkGold, W: needle, d: needleD, B: M.concrete }, 1, 0, true);
  p.later(p.S(spL, spD)[1] + 0.2, () => { const [x, y] = p.S(spL, spD); for (let k = 1; k <= 4; k++) p.shadowPx(x + k, y + 1); });
  // ---- letter-board marquee by the street
  const bg = p.lit ? C.windowLit : M.white, ink = hx("#3a3634");
  const msg = [["kkkkk.kkkkk", ".kk.kkk.kk."], ["kkkk.kkkkkk", "kkk.kk.kkk."], ["kkk.kk.kkkk", ".kkkk.kk.k."]][p.h(4) % 3]!;
  const bw = 9;
  p.spr(2, fr - 1, [
    "F".repeat(bw + 2),
    "F" + msg[0]!.slice(0, bw).replace(/\./g, "w") + "F",
    "F" + msg[1]!.slice(0, bw).replace(/\./g, "w") + "F",
    ".b" + ".".repeat(bw - 2) + "b.",
  ], { F: brick, ".": null, k: ink, b: shade(M.brick, 0.8), w: bg }, 0, 50);
  p.tree(cl - 5, fr - 2, true, 50);
  p.tree(pl0 - 2, fr - 5, false, 51);
  p.tree(2, fr - 5, true, 52);
}

function mixC(a: RGB, b: RGB, k: number): RGB {
  return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
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
  // TALL: the mast rises through the lot and into the overhang behind it
  // (beacon kept a couple of rows under the overhang's top for its bloom)
  const H = Math.min(my + PLAN_OVER - 4, my + 12);
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
  p.later(my + 0.9, () => p.tall(() => {
    // guy wires: three levels, thin and dotted so the mast stays clean
    const wire = hx("#a8a49a");
    anchors.forEach(([ax, ay], i) => {
      for (const frac of i < 2 ? [0.9, 0.5] : [0.7]) {
        const hy = my - Math.round(H * frac);
        const n = Math.max(Math.abs(ax - mx), Math.abs(ay - hy));
        for (let s2 = 2; s2 < n; s2 += 2) p.scr(mx + (ax > mx ? 1 : 0) + Math.round(((ax - mx) * s2) / n), hy + Math.round(((ay - hy) * s2) / n), wire);
      }
    });
    // the mast on its pier: a 2-px lattice in 7 equal FAA bands, orange-
    // red and white, lit face on the west, lattice ticks on the east
    p.scr(mx - 1, my, M.concrete); p.scr(mx, my, M.concrete); p.scr(mx + 1, my, shade(M.concrete, 0.8)); p.scr(mx + 2, my, shade(M.concrete, 0.7));
    const bandH = Math.max(2, Math.round(H / 7));
    for (let k = 1; k <= H; k++) {
      const band = Math.floor((k - 1) / bandH) % 2 === 0 ? hx("#d8452f") : hx("#f2efe8");
      p.scr(mx, my - k, band);
      p.scr(mx + 1, my - k, k % 2 ? shade(band, 0.7) : shade(band, 0.84));
    }
    // top beacon + two side obstruction lamps half-way (antiphase)
    p.beacon(mx, my - H - 1, on, p.lit ? 2 : 1);
    p.scr(mx + 1, my - H - 1, on ? EMISSIVE.beaconGlow : hx("#5a1a1a"));
    const mid = my - (H >> 1);
    p.scr(mx - 1, mid, !on ? EMISSIVE.beacon : hx("#5a1a1a"));
    p.scr(mx + 2, mid, !on ? EMISSIVE.beacon : hx("#5a1a1a"));
    // the mast's shadow on the ground, to the SE
    for (let k = 1; k < 8; k++) p.shadowPx(mx + 1 + k, my + 1 + (k >> 1));
  }));
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
    const lx = p.AX + sx, ly = p.AY + sy - tall + 1;
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
