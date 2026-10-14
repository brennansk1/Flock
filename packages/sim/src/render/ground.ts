/**
 * Lawn edges that blend into the land (Stage 2). A maintained lot (lawn,
 * park, school grounds, stadium surround, farmstead yard) keeps its mown
 * ground only inside; along any side that faces open country the lot's
 * ground gives way to the neighbouring terrain's own ground over an
 * irregular 1–3.5 px band (a wobbling mowing line with tufts creeping in),
 * so parcels stop reading as pasted-on rectangles. Kerbs, sidewalks,
 * roads and fences stay hard edges — only wild neighbours blend.
 *
 * `wildGround` reproduces the open-grass palette (biome, season, rolling
 * elevation tint) so the blend seam matches the Grass tiles exactly.
 */
import { Terrain, type World } from "../types.js";
import { shade, type RGB } from "../palette.js";
import { RS, C, TILE_PX, pixHash, valueNoise } from "./core.js";
import { desertGround } from "./desert.js";

/** Terrain that counts as open country for blending. */
function wild(tr: number): boolean {
  return tr === Terrain.Grass || tr === Terrain.Field || tr === Terrain.Woods || tr === Terrain.Pasture ||
    tr === Terrain.Orchard || tr === Terrain.Rock || tr === Terrain.Dirt || tr === Terrain.Lake;
}

const MASK = new WeakMap<World, Uint8Array>();
/** per tile: bit0 N, bit1 S, bit2 W, bit3 E neighbour is open country */
export function wildMask(w: World): Uint8Array {
  let m = MASK.get(w);
  if (m) return m;
  m = new Uint8Array(w.width * w.height);
  for (let y = 0; y < w.height; y++) for (let x = 0; x < w.width; x++) {
    const t = y * w.width + x;
    let b = 0;
    if (y > 0 && wild(w.terrain[t - w.width]!)) b |= 1;
    if (y < w.height - 1 && wild(w.terrain[t + w.width]!)) b |= 2;
    if (x > 0 && wild(w.terrain[t - 1]!)) b |= 4;
    if (x < w.width - 1 && wild(w.terrain[t + 1]!)) b |= 8;
    m[t] = b;
  }
  MASK.set(w, m);
  return m;
}

/** The open-country ground colour at a pixel (matches the Grass tile). */
export function wildGround(w: World, t: number, gx: number, gy: number): RGB {
  const b = w.biome[t];
  const h = pixHash(gx, gy, 5);
  if (b === 1) return desertGround(gx, gy); // desert: the same zoned sand as the open land
  if (b === 4) return valueNoise(gx, gy, 9, 13) > 0.55 ? shade(C.sandBg, 1.06) : C.sandBg; // beach
  const cell = valueNoise(gx, gy, 9, 13) > 0.55 ? 0 : 1;
  let c = cell === 0 ? C.meadowLight : C.meadow;
  if (b === 2) c = cell === 0 ? C.forestFloor : shade(C.forestFloor, 0.92);
  const elev = 0.62 * valueNoise(gx, gy, 40, 71) + 0.38 * valueNoise(gx, gy, 12, 77);
  if (elev > 0.7) c = C.grassHigh;
  else if (elev < 0.3) c = C.grassLow;
  if (h % 31 === 0) c = C.scrub;
  return c;
}

/**
 * If pixel (px, py) of tile t lies in the rough band along a side that faces
 * open country, the neighbouring land's ground colour; else null.
 */
export function edgeBlend(w: World, t: number, tx: number, ty: number, px: number, py: number): RGB | null {
  const b = wildMask(w)[t]!;
  if (b === 0) return null;
  const gx = tx * TILE_PX + px, gy = ty * TILE_PX + py;
  let d = 99;
  if (b & 1) d = Math.min(d, py);
  if (b & 2) d = Math.min(d, TILE_PX - 1 - py);
  if (b & 4) d = Math.min(d, px);
  if (b & 8) d = Math.min(d, TILE_PX - 1 - px);
  if (d > 3) return null;
  const reach = 0.8 + 2.7 * valueNoise(gx, gy, 5, 131); // the wobbling mowing line
  if (d < reach || (d < reach + 1 && pixHash(gx, gy, 133) % 3 === 0)) return wildGround(w, t, gx, gy); // + tufts creeping in
  return null;
}
