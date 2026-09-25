/**
 * Farm plan (Stage 2): agriculture sits where farmers actually farm.
 *  - A field / orchard / pasture parcel is cleared, open land: a parcel whose
 *    surroundings are mostly timber (fields "in the middle of the woods")
 *    reverts to meadow as a whole; any single ag tile still wrapped in woods
 *    reverts too.
 *  - Farmsteads (barn, silo, greenhouse and the farmhouse) stand in a
 *    cleared yard: no trees within 2 tiles.
 *  - Desert towns irrigate: 2–3 center-pivot circles on open ground near
 *    the river and a road (standard in the arid West by the 1980s).
 * Pure function of (world, rng); integer math.
 */
import { nextRange, type RngState } from "./rng.js";
import { Lot, Terrain, Biome, TileFlag, type World } from "./types.js";

const AG: ReadonlySet<number> = new Set([Terrain.Field, Terrain.Orchard, Terrain.Pasture]);
const FARM_LOTS: ReadonlySet<number> = new Set([Lot.Barn, Lot.Silo, Lot.Greenhouse]);

/** Share (‰) of woods tiles in the (2r+1)² window around t. */
export function woodsPermille(w: World, t: number, r: number): number {
  const x = t % w.width;
  const y = (t / w.width) | 0;
  let n = 0;
  let c = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w.width || yy >= w.height) continue;
      c++;
      if (w.terrain[yy * w.width + xx] === Terrain.Woods) n++;
    }
  }
  return c === 0 ? 0 : ((n * 1000) / c) | 0;
}

export function tidyAgriculture(w: World, rng: RngState, desert: boolean, river: number[] | null): void {
  const { width, height } = w;
  // 1. parcels in the woods revert to meadow (whole component at a time)
  const seen = new Uint8Array(w.terrain.length);
  for (let t = 0; t < w.terrain.length; t++) {
    if (seen[t] || !AG.has(w.terrain[t]!)) continue;
    const kind = w.terrain[t]!;
    const comp: number[] = [];
    const st = [t];
    seen[t] = 1;
    while (st.length) {
      const c = st.pop()!;
      comp.push(c);
      const x = c % width;
      for (const n of [x > 0 ? c - 1 : -1, x < width - 1 ? c + 1 : -1, c - width, c + width]) {
        if (n < 0 || n >= w.terrain.length || seen[n] || w.terrain[n] !== kind) continue;
        seen[n] = 1;
        st.push(n);
      }
    }
    let sum = 0;
    for (const c of comp) sum += woodsPermille(w, c, 2);
    if (sum / comp.length > 200 || comp.length < 4) for (const c of comp) w.terrain[c] = Terrain.Grass;
  }
  // …and any ag tile still wrapped in timber
  for (let t = 0; t < w.terrain.length; t++) {
    if (AG.has(w.terrain[t]!) && woodsPermille(w, t, 2) > 280) w.terrain[t] = Terrain.Grass;
  }
  // 2. farmyards are cleared: no trees within 2 tiles of a farm building
  for (let t = 0; t < w.terrain.length; t++) {
    if (!FARM_LOTS.has(w.lot[t]!)) continue;
    const x = t % width;
    const y = (t / width) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const n = yy * width + xx;
        if (w.terrain[n] === Terrain.Woods) w.terrain[n] = Terrain.Grass;
      }
    }
  }
  ensureFarmsteadsWork(w);
  // (3. moved to ensureFarmsteadsWork — rerun after the late setback passes)
  // 4. desert: center-pivot irrigation circles near the river + a road
  if (desert && river && river.length) {
    let placed = 0;
    const want = 2 + nextRange(rng, 2);
    for (let attempt = 0; attempt < 400 && placed < want; attempt++) {
      const y = 6 + nextRange(rng, height - 12);
      const rx = river[Math.min(river.length - 1, y)]!;
      const side = nextRange(rng, 2) === 0 ? -1 : 1;
      const cx = rx + side * (5 + nextRange(rng, 9));
      const R = 3 + nextRange(rng, 2);
      if (cx - R < 1 || cx + R >= width - 1 || y - R < 1 || y + R >= height - 1) continue;
      let ok = true;
      let roadNear = false;
      for (let dy = -R - 4; dy <= R + 4 && ok; dy++) {
        for (let dx = -R - 4; dx <= R + 4 && ok; dx++) {
          if (cx + dx < 0 || y + dy < 0 || cx + dx >= width || y + dy >= height) continue;
          const t = (y + dy) * width + cx + dx;
          const tr = w.terrain[t];
          if (tr === Terrain.Road || tr === Terrain.Dirt) roadNear = true;
          if (dx * dx + dy * dy > R * R) continue;
          if (tr !== Terrain.Grass || w.lot[t] !== 0 || w.landmark[t] !== 0) ok = false;
        }
      }
      if (!ok || !roadNear) continue;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue;
          const t = (y + dy) * width + cx + dx;
          w.terrain[t] = Terrain.Field;
          w.biome[t] = Biome.Temperate; // the irrigated green
          w.flags[t] = w.flags[t]! | TileFlag.Pivot;
        }
      }
      placed++;
    }
  }
}

/**
 * Every farmstead works land: one with no parcel within 5 tiles gets a 4×3
 * (improved, irrigated) pasture on open ground beside its yard, or — with
 * no room — it isn't a farm, and goes.
 */
export function ensureFarmsteadsWork(w: World): void {
  const { width, height } = w;
  // every farmstead works land: one with no parcel within 5 tiles gets
  //    a 4×3 pasture on open ground beside its yard (ranch country), or —
  //    with no room — it isn't a farm, and goes
  const agNear = (t: number, r: number): boolean => {
    const x = t % width;
    const y = (t / width) | 0;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < width && yy < height && AG.has(w.terrain[yy * width + xx]!)) return true;
      }
    return false;
  };
  for (let t = 0; t < w.terrain.length; t++) {
    if (!FARM_LOTS.has(w.lot[t]!) || agNear(t, 5)) continue;
    const x = t % width;
    const y = (t / width) | 0;
    let done = false;
    for (let r = 2; r <= 4 && !done; r++) {
      for (const [ox, oy] of [[r, -1], [-r - 3, -1], [-1, r], [-1, -r - 2]] as const) {
        const x0 = x + ox;
        const y0 = y + oy;
        let ok = x0 >= 1 && y0 >= 1 && x0 + 4 < width - 1 && y0 + 3 < height - 1;
        for (let dy = 0; dy < 3 && ok; dy++)
          for (let dx = 0; dx < 4 && ok; dx++) {
            const n = (y0 + dy) * width + x0 + dx;
            if (w.terrain[n] !== Terrain.Grass || w.landmark[n] !== 0 || w.biome[n] === Biome.Forest || woodsPermille(w, n, 1) > 0) ok = false;
          }
        if (!ok) continue;
        for (let dy = 0; dy < 3; dy++)
          for (let dx = 0; dx < 4; dx++) {
            const n = (y0 + dy) * width + x0 + dx;
            w.terrain[n] = Terrain.Pasture;
            w.biome[n] = Biome.Temperate; // irrigated / improved pasture
          }
        done = true;
        break;
      }
    }
    if (!done) {
      w.lot[t] = 0;
      w.pop[t] = 0;
      w.terrain[t] = Terrain.Grass;
    }
  }
}
