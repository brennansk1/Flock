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

/** Per-town-type farm-belt character (Stage 2b). */
export interface BeltStyle {
  /** 0..1 — how much of the countryside is worked. */
  density: number;
  /** Center-pivot circles to try for. */
  pivots: number;
  /** Tiles of unfarmed fringe (acreages, pasture, woodlots) between town and fields. */
  fringe: number;
  /** Tiles of dry margin from lakes, rivers and the sea. */
  waterSetback: number;
  /** Mountain valleys: farms stay within this many tiles of the town's E–W axis (0 = no limit). */
  valleyHalf: number;
}

/**
 * FARM BELT v3 (Stage 2b — the user rejected v2): the countryside around a
 * 1980s county seat, as surveyed.
 *  1. SECTION ROADS: a gravel county grid (Dirt) on mile-lines (compressed
 *     to ~22 tiles) across open country, clipped to the town edge.
 *  2. FARMSTEADS front those roads at intervals, alternating sides: the
 *     farmhouse on the road, barn + tall silo behind it, a shelterbelt of
 *     trees on the yard's north/west edge.
 *  3. FIELDS are laid out behind each farmstead: the pasture right against
 *     the barn, then crop fields (and at most one orchard block) separated
 *     by 1-tile baulks, a FARM LANE running back from the yard between them.
 *  4. CENTER PIVOTS (Plains irrigation, common by 1984) in some section
 *     blocks; the desert version is placed by tidyAgriculture.
 *  5. A FRINGE ring keeps row crops off the town edge on some maps.
 * Pure function of (world, rng). Replaces layoutFarms + fillFarmBelt.
 */
export function layoutFarmBelt(
  w: World,
  rng: RngState,
  town: { cx: number; cy: number; r: number },
  style: BeltStyle,
): void {
  const { width, height } = w;
  if (style.density <= 0) return;
  // distance (4-connected) from the town plat, for the fringe ring
  const INF = 1 << 20;
  const dist = new Int32Array(w.terrain.length).fill(INF);
  const q: number[] = [];
  for (let t = 0; t < w.terrain.length; t++) {
    if (w.terrain[t] === Terrain.Citizen && w.district[t] !== 0) { dist[t] = 0; q.push(t); }
  }
  for (let i = 0; i < q.length; i++) {
    const c = q[i]!;
    const x = c % width;
    for (const n of [x > 0 ? c - 1 : -1, x < width - 1 ? c + 1 : -1, c - width, c + width]) {
      if (n < 0 || n >= w.terrain.length || dist[n]! <= dist[c]! + 1) continue;
      dist[n] = dist[c]! + 1;
      q.push(n);
    }
  }
  const nearWater = (t: number): boolean => {
    const r = style.waterSetback;
    const x = t % width;
    const y = (t / width) | 0;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < width && yy < height && w.terrain[yy * width + xx] === Terrain.Lake) return true;
      }
    return false;
  };
  const farmable = (t: number): boolean => {
    const x = t % width;
    const y = (t / width) | 0;
    if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) return false;
    if (w.terrain[t] !== Terrain.Grass || w.lot[t] !== 0 || w.landmark[t] !== 0) return false;
    if (w.biome[t] === Biome.Desert || w.biome[t] === Biome.Forest) return false;
    if (dist[t]! < style.fringe) return false;
    if (style.valleyHalf > 0 && Math.abs(y - town.cy) > style.valleyHalf) return false;
    return !nearWater(t);
  };

  // ---- 1. section roads ----
  const S = 22;
  const offX = town.cx % S;
  const offY = town.cy % S;
  const outside = (t: number): boolean => dist[t]! > 2;
  const paint = (t: number): boolean => {
    const tr = w.terrain[t];
    if (tr === Terrain.Road || tr === Terrain.Dirt) return true;
    if (!outside(t) || w.lot[t] !== 0 || w.landmark[t] !== 0) return false;
    if (tr === Terrain.Grass || tr === Terrain.Woods) { w.terrain[t] = Terrain.Dirt; return true; }
    return false; // water, rail, rock, town: the line breaks there
  };
  const sectionX: number[] = [];
  const sectionY: number[] = [];
  for (let x = offX; x < width; x += S) if (x > 3 && x < width - 3 && Math.abs(x - town.cx) > 6) sectionX.push(x);
  for (let y = offY; y < height; y += S) if (y > 3 && y < height - 3 && Math.abs(y - town.cy) > 6) sectionY.push(y);
  if (style.density >= 0.5) {
    for (const x of sectionX) for (let y = 1; y < height - 1; y++) paint(y * width + x);
    for (const y of sectionY) for (let x = 1; x < width - 1; x++) paint(y * width + x);
  }

  // ---- 2+3. farmsteads with their fields, strung along rural roads ----
  const rural: number[] = [];
  for (let t = 0; t < w.terrain.length; t++) {
    if ((w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Dirt) && dist[t]! >= style.fringe) rural.push(t);
  }
  const farms: number[] = [];
  const want = Math.max(1, Math.round(((width * height) / (96 * 96)) * 16 * style.density));
  const rect = (x0: number, y0: number, fw: number, fh: number, pred: (t: number) => boolean): boolean => {
    if (x0 < 2 || y0 < 2 || x0 + fw >= width - 2 || y0 + fh >= height - 2) return false;
    for (let y = y0; y < y0 + fh; y++) for (let x = x0; x < x0 + fw; x++) if (!pred(y * width + x)) return false;
    return true;
  };
  const fill = (x0: number, y0: number, fw: number, fh: number, tr: number): void => {
    for (let y = y0; y < y0 + fh; y++) for (let x = x0; x < x0 + fw; x++) w.terrain[y * width + x] = tr;
  };
  const plant = (t: number, lot: number, pop: number): void => {
    w.terrain[t] = Terrain.Citizen;
    w.district[t] = 5; // Trailer = the rural fringe district
    w.lot[t] = lot;
    w.pop[t] = pop;
  };
  for (let attempt = 0; attempt < 2500 && farms.length < want && rural.length; attempt++) {
    const road = rural[nextRange(rng, rural.length)]!;
    const rx = road % width;
    const ry = (road / width) | 0;
    if (farms.some((f) => Math.abs((f % width) - rx) + Math.abs(((f / width) | 0) - ry) < 12)) continue;
    // which side of the road: the road runs E–W if its E/W neighbours are road
    const ew = (w.terrain[road - 1] === Terrain.Road || w.terrain[road - 1] === Terrain.Dirt) &&
      (w.terrain[road + 1] === Terrain.Road || w.terrain[road + 1] === Terrain.Dirt);
    const side = nextRange(rng, 2) === 0 ? -1 : 1;
    // farm in local coords: a = along the road, b = depth away from it (1 = first row off the road)
    const at = (a: number, b: number): number => ew ? (ry + side * b) * width + rx + a : (ry + a) * width + rx + side * b;
    const ok = (a: number, b: number): boolean => {
      const t = at(a, b);
      return t >= 0 && t < w.terrain.length && farmable(t);
    };
    // yard: 5 along × 4 deep, plus fields 5 more deep
    let clear = true;
    for (let b = 1; b <= 4 && clear; b++) for (let a = -2; a <= 6 && clear; a++) if (!ok(a, b)) clear = false; // the yard
    if (!clear) continue;
    // farmhouse on the road, barn + silo behind, shelterbelt at the back of the yard
    plant(at(0, 1), 0, 4); // the farmhouse household (renders as a farmhouse in the Trailer district)
    plant(at(1, 3), Lot.Barn, 2);
    plant(at(2, 3), Lot.Barn, 2);
    plant(at(3, 2), Lot.Silo, 1);
    plant(at(3, 3), Lot.Silo, 1);
    for (let a = -2; a <= 4; a++) w.terrain[at(a, 4)] = Terrain.Woods; // shelterbelt / windbreak
    // the pasture against the barn (livestock walk straight in)
    for (let b = 1; b <= 3; b++) for (let a = 5; a <= 6; a++) if (farmable(at(a, b))) w.terrain[at(a, b)] = Terrain.Pasture;
    // the farm lane back from the yard, fields either side of it
    for (let b = 1; b <= 9; b++) if (w.terrain[at(-1, b)] === Terrain.Grass) w.terrain[at(-1, b)] = Terrain.Dirt;
    const orchard = nextRange(rng, 6) === 0;
    for (let b = 5; b <= 9; b++) for (let a = 0; a <= 6; a++) if (farmable(at(a, b))) w.terrain[at(a, b)] = orchard && a <= 3 ? Terrain.Orchard : Terrain.Field;
    for (let b = 1; b <= 9; b++) for (let a = -7; a <= -3; a++) if (farmable(at(a, b))) w.terrain[at(a, b)] = Terrain.Field;
    // the rest of the farm: aligned 6×5 parcels (1-tile baulks) further back
    // and along the road, wherever the land is open — the lane runs on out
    if (style.density >= 0.6) {
      for (let pb = 11; pb <= 23; pb += 6) {
        for (let pa = -14; pa <= 7; pa += 7) {
          let open = true;
          for (let b = pb; b < pb + 5 && open; b++) for (let a = pa; a < pa + 6 && open; a++) if (!ok(a, b)) open = false;
          if (!open) continue;
          const roll = nextRange(rng, 20);
          // far parcels are crops (livestock stay by the barn); an orchard block now and then
          const tr = roll < 16 ? Terrain.Field : roll < 17 ? Terrain.Orchard : -1;
          if (tr < 0) continue; // a fallow / woodlot corner
          for (let b = pb; b < pb + 5; b++) for (let a = pa; a < pa + 6; a++) w.terrain[at(a, b)] = tr;
        }
        for (let b = pb - 1; b < pb + 5; b++) {
          const t = at(-1, b);
          if (t >= 0 && t < w.terrain.length && w.terrain[t] === Terrain.Grass) w.terrain[t] = Terrain.Dirt;
        }
      }
    }
    farms.push(road);
  }

  // ---- 4. center pivots in open section land ----
  let pivots = 0;
  for (let attempt = 0; attempt < 200 && pivots < style.pivots; attempt++) {
    const cx = 6 + nextRange(rng, width - 12);
    const cy = 6 + nextRange(rng, height - 12);
    const R = 4;
    if (!rect(cx - R - 1, cy - R - 1, 2 * R + 3, 2 * R + 3, (t) => farmable(t) || w.terrain[t] === Terrain.Field)) continue;
    let road = false;
    for (let d = -R - 3; d <= R + 3 && !road; d++)
      for (const t of [(cy - R - 3) * width + cx + d, (cy + R + 3) * width + cx + d, (cy + d) * width + cx - R - 3, (cy + d) * width + cx + R + 3])
        if (t >= 0 && t < w.terrain.length && (w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Dirt)) road = true;
    if (!road) continue;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const t = (cy + dy) * width + cx + dx;
        w.terrain[t] = Terrain.Field;
        w.flags[t] = w.flags[t]! | TileFlag.Pivot;
      }
    pivots++;
  }
  void fill;
}
