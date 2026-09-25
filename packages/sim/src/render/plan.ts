/**
 * PLAN KIT (Stage 2, renderer pass 2) — one composed building / compound
 * across a lot's whole footprint, in any of the four frontages.
 *
 * An asset is authored ONCE in a frontage-local frame: lateral l along the
 * street (0..L-1, left→right as seen from the street), depth d toward the
 * street (0..D-1; the street lies beyond d = D-1). The kit maps that frame
 * to the screen for the lot's real frontage and draws:
 *
 *  - GROUND ops (pavement, lawn, props, cars) — plain rotation;
 *  - BOX masses — the footprint is rotated, but the massing is drawn in
 *    SCREEN space so the 3/4 camera always sees a roof on top and the
 *    building's SOUTH wall below it. That wall is the front (street S), the
 *    back (street N) or a side (street E/W); for N/E/W frontages a 1-px
 *    front "lip" (sign band / awning / marquee) runs along the street edge
 *    of the mass so the front still reads;
 *  - SPRITES — upright screen-space things (flagpoles, pole signs, towers,
 *    masts, the ferris wheel) anchored at a plan point.
 *
 * Boxes and sprites are painter-sorted by their screen base row. The whole
 * footprint is composed once per frame into a cached buffer and each tile
 * blits its own 8×8 slice, so the draw order / viewport clipping of the
 * per-tile renderer stay correct. The outer 1-px ring of the footprint is
 * never written: the lot's own ground (and the territory tint) rings it.
 *
 * Presentation only: pixHash / RS.tick only, no sim state is touched.
 */
import type { World } from "../types.js";
import { hexToRgb, shade, type RGB } from "../palette.js";
import { RS, C, TILE_PX, pixHash, isLitHour, type Put } from "./core.js";
import { lotFrontage } from "./frontage.js";
import { drawVehicle, vehicleSize, type VehicleKind } from "./vehicles.js";

const hx = hexToRgb;

/** Shared building materials (80s small-town palette). */
export const M = {
  brick: hx("#9a4a36"),
  brickDark: hx("#7e3e2e"),
  brickBrown: hx("#7a4e3a"),
  brickBuff: hx("#c9a878"),
  limestone: hx("#d8cfb8"),
  stucco: hx("#e2d6bc"),
  concrete: hx("#b8b2a6"),
  concreteLight: hx("#cfc9bd"),
  white: hx("#ece8dc"),
  clapboard: hx("#e8e4d6"),
  tar: hx("#5f5a55"),
  gravel: hx("#8a847a"),
  slate: hx("#56585e"),
  shingle: hx("#5c5d62"),
  tileRed: hx("#a4533a"),
  copper: hx("#6a9a88"),
  tin: hx("#a8adb2"),
  rust: hx("#8a5a3a"),
  glass: hx("#3c4654"),
  glassBlue: hx("#4a6a88"),
  glassBronze: hx("#5a4a3a"),
  door: hx("#5d4a33"),
  steel: hx("#7a7e84"),
  dark: hx("#2a2826"),
  hvac: hx("#9aa0a6"),
  asphalt: hx("#6f6b66"),
  stripe: hx("#d8d4c8"),
  turf: hx("#3f8526"),
  dirt: hx("#9a8164"),
  sawdust: hx("#c8a86a"),
  lumber: hx("#d8b878"),
  red: hx("#c8342a"),
  navy: hx("#23386a"),
  yellow: hx("#e8c040"),
  snow: hx("#e8eef2"),
  flagBlue: hx("#2a3a7a"),
};

/** A wall-face decorator: u lateral (0..n-1), r wall row (0 = top .. h-1). */
export type Face = (u: number, r: number, n: number, h: number) => RGB | null;

export interface BoxSpec {
  l0: number;
  d0: number;
  l1: number;
  d1: number;
  /** visible wall rows */
  h: number;
  wall: RGB;
  roof: RGB;
  kind?: "flat" | "gable" | "hip" | "gambrel" | "barrel" | "none";
  /** ridge runs perpendicular to the street (gable-front) */
  across?: boolean;
  /** front face (street S): u runs along local l */
  front?: Face;
  /** back face (street N) */
  back?: Face;
  /** side face (street E/W): u = 0 at the rear, n-1 at the street end */
  side?: Face;
  /** 1-px street-edge lip for N/E/W frontages; k along local l */
  lip?: (k: number, n: number) => RGB | null;
  /** keep the roof colour in winter (glass, hot surfaces) */
  noSnow?: boolean;
  /** no drop shadow */
  noShadow?: boolean;
  /** roof dressing, painted right after the box: use p.top(l, d, c) */
  deco?: () => void;
}

const MASK_NONE = 0, MASK_GROUND = 1, MASK_ROOF = 2, MASK_WALL = 3, MASK_OBJ = 4;

interface Job {
  key: number;
  seq: number;
  run: () => void;
}

export class Plan {
  /** local canvas size (px): L along the street, D deep */
  L = 0;
  D = 0;
  /** tiles along / deep */
  tl = 0;
  td = 0;
  /** street side on screen: 0 S · 1 N · 2 E · 3 W */
  o: 0 | 1 | 2 | 3 = 0;
  /** screen footprint (px) and its world origin */
  SW = 0;
  SH = 0;
  AX = 0;
  AY = 0;
  seed = 0;
  /** did the frontage search find a street at all */
  fronted = true;
  buf: Array<RGB | null> = [];
  mask = new Uint8Array(0);
  private jobs: Job[] = [];
  private seq = 0;

  get lit(): boolean { return isLitHour(); }
  get night(): boolean { return RS.time === "night"; }
  get winter(): boolean { return RS.season === "winter"; }
  get tick(): number { return RS.tick; }
  /** stable per-lot hash */
  h(k: number, salt = 0): number { return pixHash(this.seed, k, 9001 + salt); }

  reset(w: World, ax: number, ay: number, fw0: number, fh0: number, facing: number): void {
    const f = facing < 0 ? 0 : facing;
    this.fronted = facing >= 0;
    this.o = f as 0 | 1 | 2 | 3;
    this.tl = f <= 1 ? fw0 : fh0;
    this.td = f <= 1 ? fh0 : fw0;
    this.L = this.tl * TILE_PX;
    this.D = this.td * TILE_PX;
    this.SW = fw0 * TILE_PX;
    this.SH = fh0 * TILE_PX;
    this.AX = ax * TILE_PX;
    this.AY = ay * TILE_PX;
    this.seed = ay * w.width + ax;
    const n = this.SW * this.SH;
    if (this.buf.length < n) this.buf = new Array(n).fill(null);
    for (let i = 0; i < n; i++) this.buf[i] = null;
    if (this.mask.length < n) this.mask = new Uint8Array(n);
    else this.mask.fill(0, 0, n);
    this.jobs.length = 0;
    this.seq = 0;
  }

  /** local → screen (footprint-relative px) */
  S(l: number, d: number): [number, number] {
    switch (this.o) {
      case 1: return [this.L - 1 - l, this.D - 1 - d];
      case 2: return [d, this.L - 1 - l];
      case 3: return [this.D - 1 - d, l];
      default: return [l, d];
    }
  }
  /** is the screen px inside the drawable area (not the ring) */
  inside(x: number, y: number): boolean {
    return x >= 1 && y >= 1 && x < this.SW - 1 && y < this.SH - 1;
  }
  /** raw screen write */
  scr(x: number, y: number, c: RGB | null, m = MASK_OBJ): void {
    if (!c || !this.inside(x, y)) return;
    const i = y * this.SW + x;
    this.buf[i] = c;
    this.mask[i] = m;
  }
  at(x: number, y: number): RGB | null {
    return x < 0 || y < 0 || x >= this.SW || y >= this.SH ? null : this.buf[y * this.SW + x]!;
  }
  maskAt(x: number, y: number): number {
    return x < 0 || y < 0 || x >= this.SW || y >= this.SH ? 0 : this.mask[y * this.SW + x]!;
  }
  /** world px of a local point (for seamless textures) */
  gx(l: number, d: number): [number, number] {
    const [x, y] = this.S(l, d);
    return [this.AX + x, this.AY + y];
  }

  // ---------------------------------------------------------- ground layer
  g(l: number, d: number, c: RGB | null): void {
    if (!c) return;
    const [x, y] = this.S(l, d);
    this.scr(x, y, c, MASK_GROUND);
  }
  /** a prop standing on the ground (not a roof) */
  obj(l: number, d: number, c: RGB | null): void {
    if (!c) return;
    const [x, y] = this.S(l, d);
    this.scr(x, y, c, MASK_OBJ);
  }
  fill(l0: number, d0: number, l1: number, d1: number, fn: (l: number, d: number) => RGB | null): void {
    for (let d = d0; d <= d1; d++) for (let l = l0; l <= l1; l++) this.g(l, d, fn(l, d));
  }
  /** paving with world-anchored texture */
  pave(l0: number, d0: number, l1: number, d1: number, kind: "asphalt" | "concrete" | "gravel" | "dirt" | "terrazzo" = "asphalt"): void {
    const snow = this.winter;
    this.fill(l0, d0, l1, d1, (l, d) => {
      const [X, Y] = this.gx(l, d);
      const h = pixHash(X, Y, 53);
      switch (kind) {
        case "concrete":
          return (X % 6 === 0 || Y % 6 === 0) ? shade(M.concreteLight, 0.93) : h % 13 === 0 ? shade(M.concreteLight, 0.96) : M.concreteLight;
        case "terrazzo":
          return h % 5 === 0 ? hx("#c9b8a6") : hx("#d8cab8");
        case "gravel":
          if (snow && h % 3 !== 0) return M.snow;
          return h % 4 === 0 ? shade(M.gravel, 1.12) : h % 7 === 0 ? shade(M.gravel, 0.86) : shade(M.gravel, 1.04);
        case "dirt":
          if (snow && h % 3 !== 0) return hx("#dde3e6");
          return h % 5 === 0 ? shade(M.dirt, 0.9) : h % 11 === 0 ? shade(M.dirt, 1.1) : M.dirt;
        default:
          if (snow && h % 5 === 0) return hx("#c8ced2");
          return h % 11 === 0 ? shade(M.asphalt, 1.08) : M.asphalt;
      }
    });
  }
  /** mown turf matching the park / square lawn (seasonal) */
  turfAt(l: number, d: number): RGB {
    const [X, Y] = this.gx(l, d);
    const t = turf();
    return ((X >> 1) + (Y >> 1)) % 2 === 0 ? t : shade(t, 1.07);
  }
  lawn(l0: number, d0: number, l1: number, d1: number): void {
    this.fill(l0, d0, l1, d1, (l, d) => this.turfAt(l, d));
  }
  /** a front walk (2 px) from depth d0 to d1 at lateral l */
  walk(l: number, d0: number, d1: number, w = 2): void {
    for (let d = d0; d <= d1; d++) for (let i = 0; i < w; i++) this.g(l + i, d, (d + i) % 2 === 0 ? C.pathStone : shade(C.pathStone, 0.94));
  }
  /** a round-crowned shade tree centred at (l, d) — r 1 (small) / 2 (big) */
  tree(l: number, d: number, big = false, salt = 0): void {
    const s = RS.season;
    const hh = this.h(l * 31 + d, salt);
    const conifer = hh % 5 === 0;
    const leaf = s === "winter" ? (conifer ? hx("#3a5640") : hx("#6a5a44")) : s === "fall" && !conifer ? (hh % 2 ? hx("#b06f33") : hx("#c0a052")) : conifer ? hx("#2e5a30") : hx("#3f7a2c");
    const lite = s === "winter" ? (conifer ? M.snow : hx("#8a7a62")) : s === "fall" && !conifer ? hx("#d2a050") : s === "spring" && !conifer && hh % 3 === 0 ? hx("#e8c8d8") : hx("#5f9a44");
    const [x, y] = this.S(l, d);
    const r = big ? 2 : 1;
    this.later(y + r, () => {
      // shadow to the SE, then the crown
      for (let i = -r; i <= r; i++) this.shadowPx(x + i + 1, y + r + 1);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) + Math.abs(dy) > r + (big ? 1 : 0)) continue;
          const c = dx + dy < -r + 1 ? lite : dx + dy > r ? shade(leaf, 0.8) : leaf;
          this.scr(x + dx, y + dy, c);
        }
      }
      if (s === "winter" && !conifer) this.scr(x, y - r, M.snow);
    });
  }
  /** drop shadow pixel onto ground only */
  shadowPx(x: number, y: number): void {
    if (!this.inside(x, y)) return;
    const m = this.maskAt(x, y);
    if (m === MASK_ROOF || m === MASK_WALL) return;
    const cur = this.at(x, y);
    this.scr(x, y, cur ? shade(cur, 0.72) : C.shadow, m === MASK_NONE ? MASK_GROUND : m);
  }
  /** a parked car centred on local (l, d); along = parallel to the street */
  car(l: number, d: number, along: boolean, kind: VehicleKind, paint: RGB, reverse = false): void {
    const [x, y] = this.S(l, d);
    // local +d (toward the street) / +l in screen headings (0 E · 1 W · 2 S · 3 N)
    const toStreet = [2, 3, 0, 1][this.o]!;
    const alongDir = [0, 1, 3, 2][this.o]!;
    let dir = along ? alongDir : toStreet;
    if (reverse) dir = dir ^ 1;
    const { w, h } = vehicleSize(kind, dir);
    drawVehicle((px, py, c) => this.scr(px, py, c), kind, x - (w >> 1), y - (h >> 1), dir, paint, RS.tick);
  }
  /** car with explicit screen-independent heading: local dir 0 +l · 1 -l · 2 +d · 3 -d */
  carDir(l: number, d: number, ldir: number, kind: VehicleKind, paint: RGB, tick = -1, hazards = false): void {
    const [x, y] = this.S(l, d);
    const along = [0, 1, 3, 2][this.o]!;
    const toSt = [2, 3, 0, 1][this.o]!;
    const dir = ldir === 0 ? along : ldir === 1 ? along ^ 1 : ldir === 2 ? toSt : toSt ^ 1;
    const { w, h } = vehicleSize(kind, dir);
    drawVehicle((px, py, c) => this.scr(px, py, c), kind, x - (w >> 1), y - (h >> 1), dir, paint, tick, hazards);
  }

  // ---------------------------------------------------------- queued layers
  /** queue a screen-space job at base row y (painter order) */
  later(y: number, run: () => void): void {
    this.jobs.push({ key: y, seq: this.seq++, run });
  }
  /** upright sprite: rows are drawn with their bottom row on the screen
   * point of (l, d), horizontally centred (or offset by ax) */
  spr(l: number, d: number, rows: readonly string[], pal: Record<string, RGB | null | undefined>, ax = -1, z = 0): void {
    const [x, y] = this.S(l, d);
    this.sprAt(x, y, rows, pal, ax, z);
  }
  /** upright sprite at a screen point (bottom row on y) */
  sprAt(x: number, y: number, rows: readonly string[], pal: Record<string, RGB | null | undefined>, ax = -1, z = 0): void {
    const wid = rows[0]!.length;
    const ox = x - (ax < 0 ? wid >> 1 : ax);
    // a tall sprite near the footprint's top edge slides down to fit
    const oy = Math.max(1, y - rows.length + 1);
    this.later(y + z, () => {
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r]!;
        for (let i = 0; i < row.length; i++) {
          const c = pal[row[i]!];
          if (c) this.scr(ox + i, oy + r, c);
        }
      }
    });
  }
  /** on a roof only */
  top(l: number, d: number, c: RGB | null): void {
    if (!c) return;
    const [x, y] = this.S(l, d);
    if (this.maskAt(x, y) !== MASK_ROOF) return;
    this.scr(x, y, c, MASK_ROOF);
  }

  box(b: BoxSpec): void {
    const [ax, ay] = this.S(b.l0, b.d0);
    const [bx, by] = this.S(b.l1, b.d1);
    const sx0 = Math.min(ax, bx), sx1 = Math.max(ax, bx);
    const sy0 = Math.min(ay, by), sy1 = Math.max(ay, by);
    this.later(sy1 + 0.5, () => {
      this.paintBox(b, sx0, sy0, sx1, sy1);
      if (b.deco) b.deco();
    });
  }

  private paintBox(b: BoxSpec, sx0: number, sy0: number, sx1: number, sy1: number): void {
    const o = this.o;
    const H = Math.max(0, Math.min(b.h, sy1 - sy0));
    const wy0 = sy1 - H + 1; // first wall row
    const kind = b.kind ?? "flat";
    const snow = this.winter && !b.noSnow && kind !== "none";
    const base = snow ? mix(b.roof, M.snow, 0.82) : b.roof;
    const along = !b.across;
    const horiz = (along && o <= 1) || (!along && o >= 2);
    const ry0 = sy0, ry1 = wy0 - 1;
    const rw = sx1 - sx0 + 1, rh = ry1 - ry0 + 1;
    for (let y = ry0; y <= ry1; y++) {
      for (let x = sx0; x <= sx1; x++) {
        let f = 1;
        const X = this.AX + x, Y = this.AY + y;
        if (kind === "flat") {
          if (y === ry0 || x === sx0) f = 1.1;
          else if (y === ry1 || x === sx1) f = 0.84;
          else if (pixHash(X, Y, 71) % 13 === 0) f = 0.93;
        } else if (kind === "barrel") {
          const k = horiz ? (y - ry0) / Math.max(1, rh - 1) : (x - sx0) / Math.max(1, rw - 1);
          f = k < 0.25 ? 1.14 : k < 0.5 ? 1.04 : k < 0.75 ? 0.94 : 0.82;
          if (horiz ? (x - sx0) % 3 === 2 : (y - ry0) % 3 === 2) f *= 0.94; // seams
        } else if (kind !== "none") {
          // pitched: distance to ridge vs. to the ends
          const mid2 = horiz ? ry0 + ry1 : sx0 + sx1; // 2× ridge coord
          const p2 = horiz ? 2 * y : 2 * x;
          const half = horiz ? rh / 2 : rw / 2;
          const dist = Math.abs(p2 - mid2) / 2; // from ridge
          const lo = p2 < mid2; // north / west slope (lit)
          if (dist < 0.6) f = 1.16;
          else if (kind === "gambrel" && dist > half * 0.5) f = lo ? 0.98 : 0.74;
          else f = lo ? 1.06 : 0.84;
          if (kind === "hip") {
            const endDist = horiz ? Math.min(x - sx0, sx1 - x) : Math.min(y - ry0, ry1 - y);
            const sideDist = half - dist;
            if (endDist < sideDist) f = (horiz ? x - sx0 < sx1 - x : y - ry0 < ry1 - y) ? 1.0 : 0.8;
          }
          // shingle courses
          if (!snow && (horiz ? (y & 1) : (x & 1)) && pixHash(X, Y, 73) % 3 === 0) f *= 0.94;
        }
        if (kind === "none") continue;
        this.scr(x, y, shade(base, f), MASK_ROOF);
      }
    }
    // walls
    const faceKind: "front" | "back" | "side" = o === 0 ? "front" : o === 1 ? "back" : "side";
    const fn = faceKind === "front" ? b.front : faceKind === "back" ? b.back : b.side;
    // GABLE END: when the ridge runs up-screen, the visible wall rises into
    // a triangle under the roof (r < 0 rows are offered to the decorator)
    if (!horiz && (kind === "gable" || kind === "gambrel") && rw >= 3) {
      const c2 = sx0 + sx1;
      for (let rise = 1; rise <= rh - 1; rise++) {
        const y = wy0 - rise;
        let any = false;
        for (let x = sx0; x <= sx1; x++) {
          const dist2 = Math.abs(2 * x - c2);
          if (dist2 > rw - 1 - 3 * rise) continue;
          any = true;
          const u = faceKind === "side" && o === 3 ? sx1 - x : x - sx0;
          let c = fn ? fn(u, -rise, rw, H) : null;
          if (!c) c = shade(b.wall, 0.96);
          this.scr(x, y, c, MASK_WALL);
        }
        if (!any) break;
      }
    }
    for (let y = wy0; y <= sy1; y++) {
      const r = y - wy0;
      for (let x = sx0; x <= sx1; x++) {
        const n = rw;
        const u = faceKind === "side" && o === 3 ? sx1 - x : x - sx0;
        let c: RGB | null = fn ? fn(u, r, n, H) : null;
        if (!c) {
          c = b.wall;
          if (faceKind === "back") {
            if (u === (n >> 1) && r >= H - 2) c = C.door;
            else if (u === n - 3 && r === H - 1 && n > 5) c = M.hvac;
          } else if (faceKind === "side") {
            if (H >= 2 && r === Math.max(0, H - 2) && u % 3 === 1 && u > 0 && u < n - 1) c = C.windowDark;
          } else if (u === (n >> 1) && r >= H - 2) c = C.door;
        }
        if (r === 0 && kind !== "flat" && kind !== "none") c = shade(c, 0.86); // eave shadow
        if (x === sx1) c = shade(c, 0.86); // sun from the NW
        this.scr(x, y, c, MASK_WALL);
      }
    }
    // the front lip for N/E/W frontages
    if (b.lip && o !== 0) {
      if (o === 1) {
        for (let x = sx0; x <= sx1; x++) this.scr(x, sy0, b.lip(sx1 - x, rw), MASK_ROOF);
      } else {
        const col = o === 2 ? sx1 : sx0;
        const n = sy1 - sy0 + 1;
        for (let y = sy0; y <= sy1; y++) this.scr(col, y, b.lip(o === 2 ? sy1 - y : y - sy0, n), MASK_WALL);
      }
    }
    if (!b.noShadow) {
      for (let x = sx0 + 1; x <= sx1 + 1; x++) this.shadowPx(x, sy1 + 1);
      for (let y = sy0 + 1; y <= sy1; y++) this.shadowPx(sx1 + 1, y);
    }
  }

  /** run every queued job in painter order */
  finish(): void {
    this.jobs.sort((a, b) => a.key - b.key || a.seq - b.seq);
    for (const j of this.jobs) j.run();
    this.jobs.length = 0;
  }

  // ---------------------------------------------------------- common props
  /** US flag on a pole at (l, d): 6 px pole, 3×2 flag waving on the tick */
  flagpole(l: number, d: number, tall = 6): void {
    const wave = ((RS.tick >> 3) + this.seed) & 1;
    const rows: string[] = [];
    rows.push(wave ? "Bss" : "Bs.");
    rows.push(wave ? "|rr" : "|rs");
    for (let i = 2; i < tall; i++) rows.push("|..");
    this.spr(l, d, rows, { B: M.flagBlue, s: hx("#f0ece6"), r: hx("#c23a30"), "|": hx("#c8ccd0") }, 0);
  }
  /** erase a screen px back to the lot's own ground */
  clear(x: number, y: number): void {
    if (!this.inside(x, y)) return;
    const i = y * this.SW + x;
    this.buf[i] = null;
    this.mask[i] = 0;
  }
  /** a lamp standard (lit at night) */
  lamp(l: number, d: number): void {
    this.spr(l, d, ["o", "|", "|"], { o: this.lit ? C.windowLit : hx("#d8d4c8"), "|": M.dark });
  }
}

/** mix a→b by k */
export function mix(a: RGB, b: RGB, k: number): RGB {
  return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
}

/** the seasonal mown-turf colour (park / square / civic lawn) */
export function turf(): RGB {
  return RS.season === "winter" ? hx("#dfe7ee")
    : RS.season === "fall" ? hx("#8a8b54")
    : RS.season === "spring" ? hx("#4c9c28")
    : hx("#3f8526");
}

// ------------------------------------------------------------ composition cache

interface Entry {
  frame: number;
  season: string;
  time: string;
  tick: number;
  sw: number;
  sh: number;
  ax: number;
  ay: number;
  px: Int32Array; // packed rgb + 1 (0 = transparent)
}
const CACHE = new WeakMap<World, Map<number, Entry>>();
let FRAME = 0;
/** called once per rendered frame (renderTownFrame) */
export function planFrame(): void {
  FRAME++;
}

const PLAN = new Plan();
const INTERN = new Map<number, RGB>();

export type Author = (p: Plan, w: World) => void;

/**
 * Draw tile (x0, y0)'s slice of the composed lot anchored at (ax, ay)
 * with footprint fw×fh (screen tiles). `author` paints in local space.
 */
export function drawPlanned(
  w: World,
  lot: number,
  ax: number,
  ay: number,
  fw: number,
  fh: number,
  x0: number,
  y0: number,
  put: Put,
  author: Author,
  facing?: number,
): void {
  let m = CACHE.get(w);
  if (!m) { m = new Map(); CACHE.set(w, m); }
  const key = (ay * w.width + ax) * 64 + lot; // anchor tile + lot id
  let e = m.get(key);
  if (!e || e.frame !== FRAME || e.season !== RS.season || e.time !== RS.time || e.tick !== RS.tick || e.sw !== fw * TILE_PX || e.sh !== fh * TILE_PX || e.ax !== ax || e.ay !== ay) {
    const f = facing ?? lotFrontage(w, ax, ay, fw, fh);
    PLAN.reset(w, ax, ay, fw, fh, f);
    author(PLAN, w);
    PLAN.finish();
    const n = PLAN.SW * PLAN.SH;
    const px = e && e.px.length === n ? e.px : new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const c = PLAN.buf[i];
      px[i] = c ? ((c[0] << 16) | (c[1] << 8) | c[2]) + 1 : 0;
    }
    e = { frame: FRAME, season: RS.season, time: RS.time, tick: RS.tick, sw: PLAN.SW, sh: PLAN.SH, ax, ay, px };
    m.set(key, e);
  }
  const AX = ax * TILE_PX, AY = ay * TILE_PX;
  for (let py = 0; py < TILE_PX; py++) {
    const sy = y0 + py - AY;
    if (sy < 1 || sy >= e.sh - 1) continue;
    for (let pxl = 0; pxl < TILE_PX; pxl++) {
      const sx = x0 + pxl - AX;
      if (sx < 1 || sx >= e.sw - 1) continue;
      const v = e.px[sy * e.sw + sx]!;
      if (v === 0) continue;
      let c = INTERN.get(v);
      if (!c) { const k = v - 1; c = [(k >> 16) & 255, (k >> 8) & 255, k & 255]; INTERN.set(v, c); }
      put(x0 + pxl, y0 + py, c);
    }
  }
}
