/**
 * Terrain.Rock — mountain ridges (temperate) and red mesas (desert biome).
 *
 * Relief is derived, not stored: a per-world distance-to-edge field over
 * the Rock tiles (how many rings of rock surround each tile) is bilinearly
 * sampled per pixel and roughened with value noise, giving a height map.
 * It is shaded top-lit from the NW (hillshade: height difference toward
 * the sun), with dark cliff faces on the S/E rims, a lit rim N/W, strata
 * bands on desert mesas, and snow caps (winter everywhere; high interiors
 * of temperate ridges all year). Deterministic and allocation-free per
 * pixel; the field is cached per World (rock never changes mid-match).
 */
import { Terrain, type World } from "../types.js";
import { hexToRgb, type RGB } from "../palette.js";
import { RS, TILE_PX, pixHash, valueNoise, type Put } from "./core.js";
import { wildGround } from "./ground.js";
import { canopyPx } from "./canopy.js";

const FIELD = new WeakMap<World, Uint8Array>();
const MAXD = 8;

/** rings of rock around each tile (0 = not rock, 1 = edge … MAXD). */
export function rockField(w: World): Uint8Array {
  let f = FIELD.get(w);
  if (f) return f;
  f = new Uint8Array(w.width * w.height);
  for (let t = 0; t < f.length; t++) f[t] = w.terrain[t] === Terrain.Rock ? MAXD : 0;
  // two-pass chamfer (chebyshev) distance to the nearest non-rock tile
  const W = w.width, H = w.height;
  const get = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= H ? 0 : f![y * W + x]!);
  for (let pass = 0; pass < MAXD; pass++) {
    let changed = false;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = y * W + x;
        if (f[t] === 0) continue;
        let m = MAXD;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const n = get(x + dx, y + dy);
          if (n + 1 < m) m = n + 1;
        }
        if (m < f[t]!) { f[t] = m; changed = true; }
      }
    }
    if (!changed) break;
  }
  FIELD.set(w, f);
  return f;
}

/** raw bilinear ring distance at a logical pixel (0 outside … MAXD) */
function baseAt(w: World, f: Uint8Array, gx: number, gy: number): number {
  const fx = (gx - TILE_PX / 2) / TILE_PX;
  const fy = (gy - TILE_PX / 2) / TILE_PX;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const ax = fx - x0, ay = fy - y0;
  const W = w.width, Hh = w.height;
  const g = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= Hh ? 0 : f[y * W + x]!);
  const top = g(x0, y0) * (1 - ax) + g(x0 + 1, y0) * ax;
  const bot = g(x0, y0 + 1) * (1 - ax) + g(x0 + 1, y0 + 1) * ax;
  return top * (1 - ay) + bot * ay;
}

/**
 * Height at a logical pixel: the ring distance (a massif rises from its
 * edge), plus RIDGED noise whose amplitude grows inland — spurs, saddles
 * and peaks, so no interior ever reads as a flat plate — plus fine grain.
 */
function heightAt(w: World, f: Uint8Array, gx: number, gy: number): number {
  const base = baseAt(w, f, gx, gy);
  const inland = base > 3 ? 1 : base / 3;
  const r1 = 1 - Math.abs(2 * valueNoise(gx, gy, 18, 209) - 1); // ridge lines
  const r2 = 1 - Math.abs(2 * valueNoise(gx, gy, 9, 215) - 1);
  return base * 0.85 + inland * (2.4 * r1 + 1.1 * r2) + 0.5 * valueNoise(gx, gy, 5, 211) + 0.25 * valueNoise(gx, gy, 3, 213);
}

/** 4×4 ordered-dither threshold (0..1) for smooth tone ramps */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (gx: number, gy: number): number => (BAYER[(gy & 3) * 4 + (gx & 3)]! + 0.5) / 16;

const GRANITE: RGB[] = ["#4f4e4c", "#686560", "#817d76", "#9b968d", "#b6b0a5", "#ccc6ba"].map(hexToRgb);
const SANDSTONE: RGB[] = ["#6a3322", "#8a4530", "#a8593a", "#c2714a", "#d68c5e", "#e4a978"].map(hexToRgb);
const CAPROCK: RGB[] = ["#a8704a", "#bf8a5c", "#cfa070"].map(hexToRgb);
const SNOW: RGB = hexToRgb("#eef3f6");
const SNOW_SHADE: RGB = hexToRgb("#c4d0da");
const SCRUB: RGB = hexToRgb("#7d7a4a");
const PINE: RGB = hexToRgb("#3c5a3a");

export function drawRock(w: World, t: number, tx: number, ty: number, put: Put): void {
  const f = rockField(w);
  const desert = w.biome[t] === 1;
  const winter = RS.season === "winter";
  const x0 = tx * TILE_PX, y0 = ty * TILE_PX;
  const d = f[t]!;
  // the ground this massif stands in (for the dithered foot)
  let foot = -1;
  if (d <= 1) {
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const x = tx + dx, y = ty + dy;
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
      const n = y * w.width + x;
      if (f[n] === 0 && w.terrain[n] !== Terrain.Lake) { foot = n; break; }
    }
  }
  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      const gx = x0 + px, gy = y0 + py;
      const hash = pixHash(gx, gy, 217);
      // the FOOT: where the massif meets the land, dither the rock out into
      // the neighbouring ground (grass / forest floor / woods) over ~4 px
      if (foot >= 0) {
        const b0 = baseAt(w, f, gx, gy) + 0.9 * (valueNoise(gx, gy, 7, 229) - 0.5) + 0.3 * (valueNoise(gx, gy, 3, 233) - 0.5);
        if (b0 < 1.45) {
          const k = (1.45 - b0) / 1.1; // 0 at the rock … 1 at the tile edge
          if (k > (pixHash(gx, gy, 235) % 100) / 100 * 0.85 + 0.08) {
            put(gx, gy, w.terrain[foot] === Terrain.Woods && !desert ? canopyPx(gx, gy, 0.5) : wildGround(w, foot, gx, gy));
            continue;
          }
        }
      }
      const h = heightAt(w, f, gx, gy);
      // hillshade: gradient toward the NW sun over 2 px, dithered ramp
      const slope = (h - heightAt(w, f, gx - 2, gy - 2)) * 1.4;
      const tone = Math.max(0, Math.min(1, 0.5 + slope * 0.9)); // 0 shade … 1 lit
      let c: RGB;
      if (desert) {
        const mesaTop = h > 3.4;
        if (mesaTop) {
          const i = tone > 0.62 ? 2 : tone < 0.38 ? 0 : 1;
          c = CAPROCK[i]!;
          if (hash % 23 === 0) c = SCRUB;
        } else {
          const band = Math.floor(h * 2.2) & 1; // strata
          const lv = tone * 4 + bayer(gx, gy) - 0.5;
          let i = 1 + band + Math.round(lv);
          if (h < 1.2) i -= 1;
          c = SANDSTONE[i < 0 ? 0 : i > 5 ? 5 : i]!;
        }
        if (winter && (mesaTop || tone > 0.6) && hash % 3 !== 0) c = tone < 0.45 ? SNOW_SHADE : SNOW;
      } else {
        // 6-step granite ramp, ordered-dithered between steps (no banding)
        const lv = tone * 4.2 + (h > 5 ? 0.6 : 0) + bayer(gx, gy) - 0.5;
        let i = Math.round(lv) + 1;
        c = GRANITE[i < 0 ? 0 : i > 5 ? 5 : i]!;
        // krummholz pines cling to the lower slopes
        if (h < 2 && valueNoise(gx, gy, 4, 219) > 0.64) c = hash % 3 === 0 ? GRANITE[1]! : PINE;
        // snow: in winter it lies on every face that isn't steep shade (the
        // dark faces keep the relief legible); the rest of the year only
        // the highest peaks keep a cap
        if (winter) { if (h > 1.4 && tone > 0.42 && hash % 6 !== 0) c = tone < 0.55 ? SNOW_SHADE : SNOW; }
        else if (h > (RS.season === "summer" ? 8.6 : 7.2) && tone > 0.35 && hash % 7 !== 0) c = tone < 0.45 ? SNOW_SHADE : SNOW;
      }
      put(gx, gy, c);
    }
  }
}

/** Scree/talus colour for a pixel just outside a rock edge, or null. */
export function screeAt(w: World, tx: number, ty: number, px: number, py: number): RGB | null {
  const f = rockField(w);
  const gx = tx * TILE_PX + px, gy = ty * TILE_PX + py;
  // distance (px) to the nearest rock tile edge, up to 6 px out
  let dist = 99;
  const rock = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w.width && y < w.height && f[y * w.width + x]! > 0;
  if (rock(tx, ty - 1)) dist = Math.min(dist, py + 1);
  if (rock(tx, ty + 1)) dist = Math.min(dist, TILE_PX - py);
  if (rock(tx - 1, ty)) dist = Math.min(dist, px + 1);
  if (rock(tx + 1, ty)) dist = Math.min(dist, TILE_PX - px);
  if (rock(tx - 1, ty - 1)) dist = Math.min(dist, Math.hypot(px + 1, py + 1));
  if (rock(tx + 1, ty - 1)) dist = Math.min(dist, Math.hypot(TILE_PX - px, py + 1));
  if (rock(tx - 1, ty + 1)) dist = Math.min(dist, Math.hypot(px + 1, TILE_PX - py));
  if (rock(tx + 1, ty + 1)) dist = Math.min(dist, Math.hypot(TILE_PX - px, TILE_PX - py));
  const reach = 2.5 + 3.5 * valueNoise(gx, gy, 5, 223);
  if (dist > reach) return null;
  // talus thins out with distance: dense at the foot, scattered stones out
  const k = dist / reach;
  if ((pixHash(gx, gy, 227) % 100) / 100 < k * 1.1) return null;
  const hash = pixHash(gx, gy, 231);
  const desert = w.biome[ty * w.width + tx] === 1;
  if (RS.season === "winter" && !desert && hash % 2 === 0) return SNOW_SHADE;
  const ramp = desert ? SANDSTONE : GRANITE;
  return ramp[hash % 3 === 0 ? 2 : hash % 3 === 1 ? 3 : 4]!;
}
