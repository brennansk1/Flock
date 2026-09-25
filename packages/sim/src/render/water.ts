/**
 * Water (Stage 2): lakes, rivers, creeks and the ocean.
 *
 * A per-world distance field (tiles of water between each water tile and
 * the nearest land, cached — water never changes mid-match) is sampled
 * bilinearly per pixel to get a smooth sub-tile distance-to-shore. From it:
 *  - depth tone (shallow shelf lighter, deep water darker);
 *  - OCEAN SURF: foam breakers that roll in parallel to the shore on the
 *    frame clock, thickening where they break, and a swash band at the sand;
 *  - calm RIVER/LAKE ripples: sparse noise streaks drifting along the
 *    channel axis (downstream) instead of a regular stripe texture;
 *  - soft rims: convex tile corners are rounded off into beach/bank and
 *    concave corners get a small nub, so shores never read as rectangles;
 *  - SHOALS: pale shallows off a point bar (land jutting into the water).
 * Pure function of (world, tile, pixel, season, tick).
 */
import { Terrain, type World } from "../types.js";
import { hexToRgb, shade, type RGB } from "../palette.js";
import { RS, C, TILE_PX, pixHash, valueNoise, type Put } from "./core.js";

const FIELD = new WeakMap<World, Uint8Array>();
const MAXD = 6;

export function waterField(w: World): Uint8Array {
  let f = FIELD.get(w);
  if (f) return f;
  const W = w.width, H = w.height;
  f = new Uint8Array(W * H);
  for (let t = 0; t < f.length; t++) f[t] = w.terrain[t] === Terrain.Lake ? MAXD : 0;
  for (let pass = 0; pass < MAXD; pass++) {
    let changed = false;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = y * W + x;
      if (f[t] === 0) continue;
      let m: number = MAXD;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        // the map edge counts as more water (the sea runs off the map)
        const n = nx < 0 || ny < 0 || nx >= W || ny >= H ? MAXD : f[ny * W + nx]!;
        if (n + 1 < m) m = n + 1;
      }
      if (m < f[t]!) { f[t] = m; changed = true; }
    }
    if (!changed) break;
  }
  FIELD.set(w, f);
  return f;
}

/** sub-tile distance to shore in px (≈0 at the waterline). */
export function shoreDistPx(w: World, f: Uint8Array, gx: number, gy: number): number {
  const fx = (gx - TILE_PX / 2 + 0.5) / TILE_PX;
  const fy = (gy - TILE_PX / 2 + 0.5) / TILE_PX;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const ax = fx - x0, ay = fy - y0;
  const W = w.width, H = w.height;
  const g = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= H ? MAXD : f[y * W + x]!);
  const top = g(x0, y0) * (1 - ax) + g(x0 + 1, y0) * ax;
  const bot = g(x0, y0 + 1) * (1 - ax) + g(x0 + 1, y0 + 1) * ax;
  return ((top * (1 - ay) + bot * ay) - 0.5) * TILE_PX;
}

const OCEAN = hexToRgb("#2c5876");
const OCEAN_DEEP = hexToRgb("#244a66");
const OCEAN_SHELF = hexToRgb("#3f7890");
const FOAM = hexToRgb("#eef4f4");
const FOAM_D = hexToRgb("#bcd6dc");

export function drawWater(w: World, t: number, tx: number, ty: number, put: Put, tick: number): void {
  const f = waterField(w);
  const x0 = tx * TILE_PX, y0 = ty * TILE_PX;
  const isW = (n: number, ok: boolean): boolean => ok && w.terrain[n] === Terrain.Lake;
  const wN = isW(t - w.width, ty > 0) || ty === 0;
  const wS = isW(t + w.width, ty < w.height - 1) || ty === w.height - 1;
  const wW = isW(t - 1, tx > 0) || tx === 0;
  const wE = isW(t + 1, tx < w.width - 1) || tx === w.width - 1;
  const ocean = w.biome[t] === 4;
  const desert = w.biome[t] === 1;
  const frozen = RS.season === "winter" && !ocean;
  const creek = (!wW && !wE) || (!wN && !wS);
  // flow axis: a channel open N–S flows south; E–W flows east; lakes drift
  const flowY = wN && wS && !(wE && wW) ? 1 : 0;
  const flowX = wE && wW && !(wN && wS) ? 1 : 0;
  const lake = !flowX && !flowY;
  const deepC = ocean ? OCEAN : creek ? hexToRgb("#3f6272") : C.waterDeep;
  const rippleC = ocean ? OCEAN_SHELF : creek ? hexToRgb("#5a8292") : C.waterRipple;
  const bankC = (gx: number, gy: number): RGB => {
    if (ocean || desert) return pixHash(gx, gy, 103) % 5 === 0 ? C.sandDark : C.sand;
    const h = pixHash(gx, gy, 101) % 4;
    return h === 0 ? hexToRgb("#a8a08a") : h === 1 ? hexToRgb("#8c8a7c") : hexToRgb("#b8ae94"); // gravel bank
  };
  // diagonal land for concave-corner nubs
  const landAt = (dx: number, dy: number): boolean => {
    const x = tx + dx, y = ty + dy;
    if (x < 0 || y < 0 || x >= w.width || y >= w.height) return false;
    return w.terrain[y * w.width + x] !== Terrain.Lake;
  };
  const nwL = wN && wW && landAt(-1, -1), neL = wN && wE && landAt(1, -1);
  const swL = wS && wW && landAt(-1, 1), seL = wS && wE && landAt(1, 1);
  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      const gx = x0 + px, gy = y0 + py;
      // ---- soft rims: round convex corners, nub concave ones
      const dNW = px + py, dNE = (7 - px) + py, dSW = px + (7 - py), dSE = (7 - px) + (7 - py);
      const near = Math.min(!wN && !wW ? dNW : 99, !wN && !wE ? dNE : 99, !wS && !wW ? dSW : 99, !wS && !wE ? dSE : 99);
      if (near < 4 && near < 2.2 + valueNoise(gx, gy, 4, 107) * 1.6) {
        put(gx, gy, bankC(gx, gy));
        continue;
      }
      if ((nwL && dNW < 1.2) || (neL && dNE < 1.2) || (swL && dSW < 1.2) || (seL && dSE < 1.2)) {
        put(gx, gy, bankC(gx, gy));
        continue;
      }
      // px from the waterline, wobbled so depth contours and wave crests
      // never trace the tile grid
      const s0 = shoreDistPx(w, f, gx, gy);
      const s = s0 > 1.5 ? s0 + (valueNoise(gx, gy, 7, 129) - 0.5) * 5 : s0;
      let c: RGB = deepC;
      if (frozen) {
        // lake ice: pale sheet, a darker crack line or two, snow drifts at the edge
        c = s < 2 ? hexToRgb("#e6eef2") : valueNoise(gx, gy, 7, 109) > 0.72 ? hexToRgb("#9ec4d8") : C.waterDeep;
        if (Math.abs(valueNoise(gx, gy, 11, 111) - 0.5) < 0.02) c = hexToRgb("#8ab0c4");
        put(gx, gy, c);
        continue;
      }
      if (ocean) {
        c = s > 20 ? OCEAN_DEEP : s < 9 ? OCEAN_SHELF : OCEAN;
        // BREAKERS: crests every 9 px rolling shoreward at ~1 px / 4 ticks
        const P = 9;
        const phase = (((s + tick / 4) % P) + P) % P;
        const breakLine = valueNoise(gx * 0.7, gy * 0.7, 5, 113) > 0.28; // broken, not ruled
        if (s < 22 && breakLine && phase < (s < 7 ? 1.9 : 1.0)) c = s < 7 ? FOAM : FOAM_D;
        else if (s < 22 && breakLine && phase < 2.6 && s < 7) c = FOAM_D; // spill behind the crest
        if (s < 1.6) c = pixHash(gx, gy, (tick >> 2) & 7) % 3 === 0 ? FOAM : FOAM_D; // swash on the sand
      } else {
        // depth tone
        if (s > 18) c = shade(deepC, 0.9);
        else if (s < 3) c = shade(deepC, 1.1);
        // calm ripples: sparse streaks drifting downstream (lakes: slow drift)
        const drift = tick * (lake ? 0.05 : 0.18);
        const rx = gx - flowX * drift - (lake ? drift * 0.5 : 0);
        const ry = gy - flowY * drift;
        const rip = valueNoise(rx * (flowY ? 2.2 : 1), ry * (flowX ? 2.2 : 1), 5, 115);
        if (rip > 0.6 && rip < 0.66) c = rippleC;
        if (rip > 0.78 && pixHash(gx, gy, 117 + ((tick >> 3) & 3)) % 5 === 0) c = C.waterGlint;
        // lapping edge: a pale line right at the bank
        if (s < 0.9) c = shade(rippleC, 1.12);
      }
      // SHOALS: pale shallows off a point bar (convex land corner nearby)
      if (!ocean && s < 5 && ((nwL && dNW < 5) || (neL && dNE < 5) || (swL && dSW < 5) || (seL && dSE < 5)) && pixHash(gx, gy, 119) % 2 === 0) {
        c = hexToRgb("#7aa0a8");
      }
      put(gx, gy, c);
    }
  }
  // shallows dressing on inland water: cattails by the bank
  if (!ocean && !frozen && (!wN || !wS || !wW || !wE) && pixHash(t, 5, 37) % 4 === 0) {
    const rx = x0 + 2 + (pixHash(t, 6, 37) % 4);
    const ry = !wN ? y0 + 1 : !wS ? y0 + 6 : y0 + 2 + (pixHash(t, 7, 37) % 4);
    put(rx, ry, hexToRgb("#4d6b38"));
    put(rx + 1, ry, hexToRgb("#705633"));
  }
}

/**
 * Point bars: a land pixel on the INSIDE of a bend (the land tile has water
 * on two orthogonal sides + that diagonal) grows a gravel/sand bar into the
 * corner. Returns the bar colour or null.
 */
const BAR_MASK = new WeakMap<World, Uint8Array>();
function barMask(w: World): Uint8Array {
  let m = BAR_MASK.get(w);
  if (m) return m;
  m = new Uint8Array(w.width * w.height);
  const water = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w.width && y < w.height && w.terrain[y * w.width + x] === Terrain.Lake;
  for (let ty = 0; ty < w.height; ty++) for (let tx = 0; tx < w.width; tx++) {
    let b = 0;
    if (water(tx - 1, ty) && water(tx, ty - 1) && water(tx - 1, ty - 1)) b |= 1;
    if (water(tx + 1, ty) && water(tx, ty - 1) && water(tx + 1, ty - 1)) b |= 2;
    if (water(tx - 1, ty) && water(tx, ty + 1) && water(tx - 1, ty + 1)) b |= 4;
    if (water(tx + 1, ty) && water(tx, ty + 1) && water(tx + 1, ty + 1)) b |= 8;
    m[ty * w.width + tx] = b;
  }
  BAR_MASK.set(w, m);
  return m;
}

export function pointBarAt(w: World, tx: number, ty: number, px: number, py: number): RGB | null {
  const b = barMask(w)[ty * w.width + tx]!;
  if (b === 0) return null;
  const nw = (b & 1) !== 0, ne = (b & 2) !== 0, sw = (b & 4) !== 0, se = (b & 8) !== 0;
  const gx = tx * TILE_PX + px, gy = ty * TILE_PX + py;
  const r = 3.2 + 2 * valueNoise(gx, gy, 4, 121);
  const hit = (nw && px + py < r) || (ne && 7 - px + py < r) || (sw && px + 7 - py < r) || (se && 14 - px - py < r);
  if (!hit) return null;
  const desert = w.biome[ty * w.width + tx] === 1 || w.biome[ty * w.width + tx] === 4;
  const h = pixHash(gx, gy, 123) % 5;
  if (RS.season === "winter" && h < 3) return hexToRgb("#e6ecf0");
  if (desert) return h === 0 ? C.sandDark : C.sand;
  return h === 0 ? hexToRgb("#8c8a7c") : h < 3 ? hexToRgb("#b8ae94") : hexToRgb("#c8bc9e");
}

/** Water colour for a lake/ocean pixel bleeding across a tile edge into land. */
export function bleedWater(w: World, nt: number, gx: number, gy: number): RGB {
  if (w.biome[nt] === 4) return pixHash(gx, gy, 125) % 4 === 0 ? FOAM_D : OCEAN_SHELF;
  if (RS.season === "winter") return hexToRgb("#e6eef2");
  return pixHash(gx, gy, 127) % 29 === 0 ? C.waterRipple : shade(C.waterDeep, 1.1);
}
