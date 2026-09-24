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

const FIELD = new WeakMap<World, Uint8Array>();
const MAXD = 5;

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

/** Height (≈0..MAXD+1) at a logical pixel. */
function heightAt(w: World, f: Uint8Array, gx: number, gy: number): number {
  // tile-centre lattice
  const fx = (gx - TILE_PX / 2) / TILE_PX;
  const fy = (gy - TILE_PX / 2) / TILE_PX;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const ax = fx - x0, ay = fy - y0;
  const W = w.width, Hh = w.height;
  const g = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= Hh ? 0 : f[y * W + x]!);
  const top = g(x0, y0) * (1 - ax) + g(x0 + 1, y0) * ax;
  const bot = g(x0, y0 + 1) * (1 - ax) + g(x0 + 1, y0 + 1) * ax;
  const base = top * (1 - ay) + bot * ay;
  return base + 0.9 * valueNoise(gx, gy, 6, 211) + 0.45 * valueNoise(gx, gy, 3, 213);
}

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
  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      const gx = x0 + px, gy = y0 + py;
      const h = heightAt(w, f, gx, gy);
      const hNW = heightAt(w, f, gx - 2, gy - 2);
      const slope = h - hNW; // + = faces the NW sun
      const hash = pixHash(gx, gy, 217);
      let c: RGB;
      if (desert) {
        // MESA: a flat caprock table on the interior, stepped strata walls
        const mesaTop = h > 2.6;
        if (mesaTop) {
          c = CAPROCK[1 + (slope > 0.12 ? 1 : slope < -0.12 ? -1 : 0)]!;
          if (hash % 23 === 0) c = SCRUB; // juniper / scrub on the table
        } else {
          const band = Math.floor(h * 2.2) & 1; // strata
          let i = 2 + band + (slope > 0.15 ? 1 : slope < -0.15 ? -2 : 0);
          if (h < 1.1) i -= 1; // talus foot in shadow
          c = SANDSTONE[i < 0 ? 0 : i > 5 ? 5 : i]!;
        }
        if (winter && (mesaTop || slope > 0.2) && hash % 3 !== 0) c = slope < 0 ? SNOW_SHADE : SNOW;
      } else {
        let i = 2 + (slope > 0.3 ? 2 : slope > 0.08 ? 1 : slope < -0.3 ? -2 : slope < -0.08 ? -1 : 0);
        if (h > 3.2) i += 1; // high ground catches more light
        c = GRANITE[i < 0 ? 0 : i > 5 ? 5 : i]!;
        // krummholz pines cling to the lower slopes
        if (h < 1.6 && valueNoise(gx, gy, 4, 219) > 0.66) c = hash % 3 === 0 ? GRANITE[1]! : PINE;
        // snow: the whole ridge in winter (bare rock shows on steep shade
        // faces), only the high interior peaks the rest of the year
        const snowLine = winter ? 1.3 : RS.season === "summer" ? 5.7 : 5.1;
        if (h > snowLine && (slope > -0.25 || winter) && hash % 7 !== 0) c = slope < -0.1 ? SNOW_SHADE : SNOW;
      }
      // cliff rim: the rock edge drops away — dark on S/E faces, lit N/W
      if (d === 1) {
        const outS = ty + 1 < w.height && f[t + w.width] === 0 && py === TILE_PX - 1;
        const outE = tx + 1 < w.width && f[t + 1] === 0 && px === TILE_PX - 1;
        const outN = ty > 0 && f[t - w.width] === 0 && py === 0;
        const outW = tx > 0 && f[t - 1] === 0 && px === 0;
        if (outS || outE) c = desert ? SANDSTONE[0]! : GRANITE[0]!;
        else if ((outN || outW) && !(winter && hash % 2 === 0)) c = desert ? SANDSTONE[4]! : GRANITE[4]!;
      }
      put(gx, gy, c);
    }
  }
}

/** Scree/talus colour for a pixel just outside a rock edge, or null. */
export function screeAt(w: World, tx: number, ty: number, px: number, py: number): RGB | null {
  const f = rockField(w);
  const gx = tx * TILE_PX + px, gy = ty * TILE_PX + py;
  const near = (ntx: number, nty: number, dist: number): boolean =>
    ntx >= 0 && nty >= 0 && ntx < w.width && nty < w.height && f[nty * w.width + ntx]! > 0 &&
    dist < 1.5 + 2.5 * valueNoise(gx, gy, 4, 223);
  const hit = near(tx, ty - 1, py + 1) || near(tx, ty + 1, TILE_PX - py) || near(tx - 1, ty, px + 1) || near(tx + 1, ty, TILE_PX - px);
  if (!hit) return null;
  const hash = pixHash(gx, gy, 227);
  if (hash % 3 !== 0) return null; // scattered, not a solid apron
  const desert = w.biome[ty * w.width + tx] === 1;
  return desert ? SANDSTONE[hash % 2 === 0 ? 2 : 3]! : GRANITE[hash % 2 === 0 ? 2 : 3]!;
}
