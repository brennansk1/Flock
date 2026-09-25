/**
 * Open grounds (Stage 2, renderer pass 2): the PARK (paths, benches, shade
 * trees, a gazebo or fountain), the ORCHARD (trees in true grid rows, with
 * blossom / fruit / bare seasons), the DOCK (a plank pier on pilings out
 * over the water with a moored rowboat) and desert CENTER-PIVOT circles.
 * Per-tile, but laid out on world-anchored grids so tiles join seamlessly.
 */
import { Terrain, Lot, Biome, type World } from "../types.js";
import { hexToRgb, shade, type RGB } from "../palette.js";
import { RS, C, TILE_PX, pixHash, isLitHour, type Put } from "./core.js";
import { edgeBlend, wildMask } from "./ground.js";
import { turf } from "./plan.js";

const hx = hexToRgb;

function leafColors(salt: number): { leaf: RGB; lite: RGB; dark: RGB } {
  const s = RS.season;
  if (s === "winter") return { leaf: hx("#6a5a44"), lite: hx("#e8eef2"), dark: hx("#54483a") };
  if (s === "fall") return salt % 2 ? { leaf: hx("#b06f33"), lite: hx("#d2a050"), dark: hx("#8a5428") } : { leaf: hx("#c0a052"), lite: hx("#dcc070"), dark: hx("#9a7a3a") };
  if (s === "spring") return { leaf: hx("#4f9a38"), lite: hx("#8ac860"), dark: hx("#3a7a2a") };
  return { leaf: hx("#2f6a24"), lite: hx("#4f8a3a"), dark: hx("#24561c") };
}

/** a 3-px-crowned tree at (cx, cy) with its SE shadow */
function smallTree(put: Put, cx: number, cy: number, salt: number): void {
  const { leaf, lite, dark } = leafColors(salt);
  put(cx + 1, cy + 2, C.shadow); put(cx + 2, cy + 1, C.shadow);
  put(cx, cy - 1, lite);
  put(cx - 1, cy, leaf); put(cx, cy, leaf); put(cx + 1, cy, dark);
  put(cx, cy + 1, dark);
  if (RS.season === "winter") put(cx, cy, hx("#8a7a62"));
}

// ------------------------------------------------------------ PARK

/**
 * PARK / square lawn tile. The park is laid out over its whole component
 * rect (ax, ay, fw, fh): a cross of walks through the middle, the centre
 * piece (a white bandstand GAZEBO or a FOUNTAIN, by hash) where the walks
 * meet, benches along the walks, lamps at the walk ends, shade trees on a
 * jittered grid clear of the walks, and the kerb / hedge where the lawn
 * meets a street.
 */
export function drawPark(w: World, t: number, tx: number, ty: number, x0: number, y0: number, put: Put, ax: number, ay: number, fw: number, fh: number): void {
  const T = turf();
  const walkC = RS.season === "winter" ? hx("#d8dcdc") : hx("#c9c2b2");
  const parkAt = (n: number): boolean => n >= 0 && n < w.lot.length && (w.lot[n] === Lot.Park || w.lot[n] === Lot.Courthouse);
  const pN = ty > 0 && parkAt(t - w.width), pS = ty < w.height - 1 && parkAt(t + w.width);
  const pW = tx > 0 && parkAt(t - 1), pE = tx < w.width - 1 && parkAt(t + 1);
  // the walk cross through the component's centre (2 px wide)
  const cxp = ax * TILE_PX + ((fw * TILE_PX) >> 1) - 1;
  const cyp = ay * TILE_PX + ((fh * TILE_PX) >> 1) - 1;
  const onWalk = (gx: number, gy: number): boolean => (gx === cxp || gx === cxp + 1) || (gy === cyp || gy === cyp + 1);
  const small = fw * fh <= 1;
  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      const gx = x0 + px, gy = y0 + py;
      let c = ((gx >> 1) + (gy >> 1)) % 2 === 0 ? T : shade(T, 1.07);
      if (!small && onWalk(gx, gy)) c = (gx + gy) % 5 === 0 ? shade(walkC, 0.95) : walkC;
      const eb = edgeBlend(w, t, tx, ty, px, py);
      if (eb) c = eb;
      else if ((py === 0 && !pN) || (py === 7 && !pS) || (px === 0 && !pW) || (px === 7 && !pE)) {
        const wm = wildMask(w)[t]!;
        const wildSide = (py === 0 && wm & 1) || (py === 7 && wm & 2) || (px === 0 && wm & 4) || (px === 7 && wm & 8);
        if (!wildSide) c = RS.season === "winter" ? hx("#b8c4c0") : shade(T, 0.78); // clipped hedge / kerb
      }
      put(gx, gy, c);
    }
  }
  const seed = ay * w.width + ax;
  // the centre piece where the walks cross
  const inTile = (gx: number, gy: number): boolean => gx >= x0 && gx < x0 + TILE_PX && gy >= y0 && gy < y0 + TILE_PX;
  const P = (gx: number, gy: number, c: RGB): void => { if (inTile(gx, gy)) put(gx, gy, c); };
  if (!small) {
    if (pixHash(seed, 1, 707) % 2 === 0) {
      // GAZEBO: octagonal bandstand, white posts, pointed roof
      const roof = RS.season === "winter" ? hx("#eef2f4") : pixHash(seed, 2, 707) % 2 ? hx("#8a3a30") : hx("#5a5d62");
      const white = hx("#f0ece4");
      for (const [dx, dy, c] of [
        [0, -2, shade(roof, 1.2)], [1, -2, roof],
        [-1, -1, roof], [0, -1, shade(roof, 1.1)], [1, -1, roof], [2, -1, shade(roof, 0.85)],
        [-1, 0, white], [0, 0, hx("#8a7a62")], [1, 0, hx("#8a7a62")], [2, 0, white],
        [-1, 1, white], [0, 1, white], [1, 1, white], [2, 1, shade(white, 0.85)],
        [3, 1, C.shadow], [0, 2, C.shadow], [1, 2, C.shadow], [2, 2, C.shadow],
      ] as [number, number, RGB][]) P(cxp + dx, cyp + dy, c);
    } else {
      // FOUNTAIN: round stone basin, water glinting on the tick
      const stone = hx("#c8c2b4");
      const water = RS.season === "winter" ? hx("#c8d8e0") : hx("#5f9ac8");
      const glint = ((RS.tick >> 2) & 1) === 0;
      for (let dy = -2; dy <= 3; dy++) for (let dx = -2; dx <= 3; dx++) {
        const ex = dx - 0.5, ey = dy - 0.5;
        const e = ex * ex + ey * ey;
        if (e > 7) continue;
        P(cxp + dx, cyp + dy, e > 4 ? stone : water);
      }
      P(cxp, cyp, hx("#e8eef2"));
      if (glint && RS.season !== "winter") { P(cxp + 1, cyp - 1, hx("#dff0f8")); P(cxp - 1, cyp + 1, hx("#9fc6e0")); }
    }
  }
  // benches beside the walks (one per tile at most), lamps at the ends
  const bh = pixHash(t, 3, 707);
  if (!small && bh % 3 === 0) {
    if (x0 <= cxp + 1 && cxp < x0 + TILE_PX) { const by = y0 + 1 + (bh % 5); if (Math.abs(by - cyp) > 3) { P(cxp - 1, by, C.plank); P(cxp - 1, by + 1, C.plankDark); } }
    else if (y0 <= cyp + 1 && cyp < y0 + TILE_PX) { const bx = x0 + 1 + (bh % 5); if (Math.abs(bx - cxp) > 3) { P(bx, cyp - 1, C.plank); P(bx + 1, cyp - 1, C.plankDark); } }
  }
  if (!small && bh % 5 === 1) {
    const lx = x0 + 3, ly = cyp + 2;
    if (inTile(lx, ly)) { P(lx, ly, C.iconDark); P(lx, ly - 1, isLitHour() ? C.windowLit : hx("#d8d4c8")); }
  }
  // shade trees: up to two per tile on a jittered grid, clear of the walks
  for (let k = 0; k < 2; k++) {
    const hh = pixHash(t, 10 + k, 707);
    if (hh % 3 === 2 && !small) continue;
    const cx = x0 + 2 + (hh % 4), cy = y0 + 2 + ((hh >> 4) % 4);
    if (!small && (Math.abs(cx - cxp) <= 2 || Math.abs(cx - cxp - 1) <= 2 || Math.abs(cy - cyp) <= 2 || Math.abs(cy - cyp - 1) <= 2)) continue;
    if (small && k > 0) break;
    smallTree(P, cx, cy, hh);
  }
  if (small) { P(x0 + 5, y0 + 5, C.plank); P(x0 + 6, y0 + 5, C.plankDark); }
}

// ------------------------------------------------------------ ORCHARD

/**
 * ORCHARD: fruit trees planted in a true grid (4-px spacing, world-
 * anchored) over mown alleys. Spring blossom (pink / white), summer green
 * with the odd reddening apple, fall yellow-orange with fruit, winter bare
 * branches on snow.
 */
export function drawOrchard(t: number, x0: number, y0: number, put: Put): void {
  const s = RS.season;
  const grass = s === "winter" ? hx("#eaf0f4") : C.meadow;
  const alley = s === "winter" ? hx("#dfe6ea") : shade(C.meadow, 1.08);
  for (let py = 0; py < TILE_PX; py++) for (let px = 0; px < TILE_PX; px++) {
    const gy = y0 + py;
    put(x0 + px, gy, gy % 4 === 3 ? alley : grass); // mown alleys between rows
  }
  for (let ry = 1; ry < TILE_PX; ry += 4) {
    for (let rx = 1; rx < TILE_PX; rx += 4) {
      const cx = x0 + rx, cy = y0 + ry;
      const h = pixHash(cx, cy, 313);
      if (s === "winter") {
        const br = hx("#6a5440");
        put(cx, cy, br); put(cx - 1, cy - 1, br); put(cx + 1, cy - 1, br); put(cx, cy + 1, hx("#4a3a2a"));
        put(cx + 1, cy + 1, hx("#c8d0d6"));
        continue;
      }
      let leaf: RGB, lite: RGB, dark: RGB;
      if (s === "spring") { leaf = hx("#6a9a48"); lite = h % 2 ? hx("#f0c8d8") : hx("#f4f0f0"); dark = hx("#4f7a38"); }
      else if (s === "fall") { leaf = h % 3 ? hx("#c89a38") : hx("#b8702e"); lite = hx("#e0c060"); dark = hx("#8a6a28"); }
      else { leaf = hx("#3f7a2c"); lite = hx("#5f9a44"); dark = hx("#2e5a22"); }
      put(cx + 1, cy + 2, C.shadow); put(cx + 2, cy + 1, C.shadow);
      put(cx, cy - 1, lite);
      put(cx - 1, cy, leaf); put(cx, cy, s === "spring" ? lite : leaf); put(cx + 1, cy, dark);
      put(cx, cy + 1, dark);
      if (s === "spring" && h % 3 === 0) put(cx - 1, cy, lite);
      if ((s === "summer" && h % 4 === 0) || (s === "fall" && h % 2 === 0)) put(cx + (h & 1 ? 1 : -1), cy, hx("#c8342a")); // fruit
    }
  }
}

// ------------------------------------------------------------ DOCK / PIER

/** the direction (0 E · 1 W · 2 S · 3 N) from a dock tile to its water, or -1 */
export function dockWaterDir(w: World, t: number): number {
  const x = t % w.width, y = (t / w.width) | 0;
  const lake = (xx: number, yy: number): boolean => xx >= 0 && yy >= 0 && xx < w.width && yy < w.height && w.terrain[yy * w.width + xx] === Terrain.Lake;
  if (lake(x + 1, y)) return 0;
  if (lake(x - 1, y)) return 1;
  if (lake(x, y + 1)) return 2;
  if (lake(x, y - 1)) return 3;
  return -1;
}

/**
 * The pier, in the dock's own frame: `a` runs out from the shore (0..15 over
 * the dock tile then the first water tile), `b` across (0..7). Returns the
 * colour at (a, b) or null (not pier).
 */
function pierPx(a: number, b: number, seed: number): RGB | null {
  const plank = C.plank, dark = C.plankDark, pile = hx("#4a3a2a");
  const tEnd = pixHash(seed, 1, 919) % 2 === 0; // T-head at the end
  if (a < 3) return null; // the shore bank
  // walkway 2 px wide at b 3..4; T-head across b 1..6 at a 12..14
  const inWalk = b >= 3 && b <= 4 && a <= 14;
  const inHead = tEnd && a >= 12 && a <= 14 && b >= 1 && b <= 6;
  if (inWalk || inHead) return a % 2 === 0 ? plank : dark;
  // pilings along both edges every 3 px
  if ((b === 2 || b === 5) && a % 3 === 0 && a >= 5 && a <= 15) return pile;
  if (tEnd && (b === 0 || b === 7) && (a === 12 || a === 15)) return pile;
  return null;
}

/** rowboat moored alongside: 4×2 hull at a 9..12, b 5..6 (or 1..2) */
function boatPx(a: number, b: number, seed: number): RGB | null {
  const h = pixHash(seed, 2, 919);
  if (h % 3 === 0) return null; // no boat today
  const side = h & 4 ? 6 : 1;
  const bob = RS.season === "winter" ? 0 : (RS.tick >> 4) & 1;
  if (a < 9 + bob || a > 12 + bob || (b !== side && b !== side + (side === 6 ? 1 : -1))) return null;
  const hull = [hx("#e8e4d8"), hx("#c8342a"), hx("#2a6ab0"), hx("#3a7a4a")][(h >> 3) & 3]!;
  const inner = b === side ? hx("#8a6a48") : hull;
  return a === 9 + bob || a === 12 + bob ? hull : inner;
}

function drawPierFrame(put: Put, x0: number, y0: number, dir: number, aOff: number, seed: number): void {
  for (let i = 0; i < TILE_PX; i++) {
    for (let b = 0; b < TILE_PX; b++) {
      const a = aOff + i;
      const c = pierPx(a, b, seed) ?? (aOff > 0 ? boatPx(a, b, seed) : null);
      if (!c) continue;
      // frame → screen
      let x: number, y: number;
      if (dir === 0) { x = i; y = b; }
      else if (dir === 1) { x = 7 - i; y = b; }
      else if (dir === 2) { x = b; y = i; }
      else { x = b; y = 7 - i; }
      put(x0 + x, y0 + y, c);
    }
  }
}

/** The dock lot's land tile: a grassy bank, the landing, the pier's root. */
export function drawDock(w: World, t: number, x0: number, y0: number, put: Put): void {
  for (let py = 0; py < TILE_PX; py++) for (let px = 0; px < TILE_PX; px++) {
    put(x0 + px, y0 + py, (px * 7 + py * 13) % 11 === 0 ? shade(C.meadow, 0.94) : C.meadow);
  }
  const dir = dockWaterDir(w, t);
  if (dir < 0) {
    // no water beside it: a boat on a trailer
    put(x0 + 2, y0 + 4, hx("#e8e4d8")); put(x0 + 3, y0 + 4, hx("#e8e4d8")); put(x0 + 4, y0 + 4, hx("#c8c4b8"));
    put(x0 + 5, y0 + 4, C.iconDark);
    return;
  }
  // gravel landing + bollard, then the pier root over the bank
  for (let i = 0; i < 3; i++) for (let b = 2; b <= 5; b++) {
    const [x, y] = dir === 0 ? [i, b] : dir === 1 ? [7 - i, b] : dir === 2 ? [b, i] : [b, 7 - i];
    put(x0 + x, y0 + y, hx("#b8b2a4"));
  }
  drawPierFrame(put, x0, y0, dir, 0, t);
}

/**
 * Called from a WATER tile: if a dock sits beside it (facing it), draw the
 * pier's outer half over this water tile (pilings, T-head, rowboat).
 */
export function drawPierOverWater(w: World, t: number, tx: number, ty: number, put: Put): void {
  const x0 = tx * TILE_PX, y0 = ty * TILE_PX;
  const check: [number, number][] = [[t - 1, 0], [t + 1, 1], [t - w.width, 2], [t + w.width, 3]];
  for (const [n, want] of check) {
    if (n < 0 || n >= w.lot.length) continue;
    if ((want === 0 && tx === 0) || (want === 1 && tx === w.width - 1)) continue;
    if (w.lot[n] !== Lot.Dock || dockWaterDir(w, n) !== want) continue;
    // the pier's shadow on the water first, then the deck
    drawPierFrame((x, y, c) => put(x, y, c), x0, y0, want, TILE_PX, n);
    return;
  }
}

// ------------------------------------------------------------ CENTER PIVOTS

interface Pivot { cx: number; cy: number; r: number }
const PIVOTS = new WeakMap<World, { tile: Int32Array; list: Pivot[] }>();

/**
 * Desert CENTER-PIVOT circles: irrigated Field discs on the Temperate biome
 * inside a desert map. Detected per world (connected Field components that
 * are round and ringed by desert), cached.
 */
function pivotsOf(w: World): { tile: Int32Array; list: Pivot[] } {
  let p = PIVOTS.get(w);
  if (p) return p;
  const tile = new Int32Array(w.terrain.length).fill(-1);
  const list: Pivot[] = [];
  let desert = false;
  for (let i = 0; i < w.biome.length && !desert; i++) if (w.biome[i] === Biome.Desert) desert = true;
  if (desert) {
    const seen = new Uint8Array(w.terrain.length);
    for (let t0 = 0; t0 < w.terrain.length; t0++) {
      // only fields mapgen marked as center pivots (TileFlag.Pivot = 2)
      if (seen[t0] || w.terrain[t0] !== Terrain.Field || (w.flags[t0]! & 2) === 0) continue;
      const comp: number[] = [];
      const st = [t0];
      seen[t0] = 1;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      while (st.length) {
        const t = st.pop()!;
        comp.push(t);
        const x = t % w.width, y = (t / w.width) | 0;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (const n of [t - 1, t + 1, t - w.width, t + w.width]) {
          if (n < 0 || n >= w.terrain.length || seen[n]) continue;
          if (Math.abs((n % w.width) - x) > 1) continue;
          if (w.terrain[n] !== Terrain.Field || (w.flags[n]! & 2) === 0) continue;
          seen[n] = 1;
          st.push(n);
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      // round: square bbox, fill ≈ π/4 of it
      const fill = comp.length / (bw * bh);
      if (Math.abs(bw - bh) > 1 || bw < 5 || fill < 0.6 || fill > 0.9) continue;
      const idx = list.length;
      list.push({ cx: (x0 * TILE_PX + (x1 + 1) * TILE_PX) / 2, cy: (y0 * TILE_PX + (y1 + 1) * TILE_PX) / 2, r: (bw * TILE_PX) / 2 - 1 });
      for (const t of comp) tile[t] = idx;
    }
  }
  p = { tile, list };
  PIVOTS.set(w, p);
  return p;
}

/**
 * Draw a Field tile that belongs to a center pivot: concentric green crop
 * rings with the wheel tracks, the radial pivot ARM (towers every few px)
 * sweeping slowly, and dry desert in the square's corners. Returns false
 * when the tile isn't a pivot (the caller draws an ordinary field).
 */
export function drawPivotTile(w: World, t: number, x0: number, y0: number, put: Put): boolean {
  const pv = pivotsOf(w);
  const k = pv.tile[t]!;
  if (k < 0) return false;
  const P = pv.list[k]!;
  const s = RS.season;
  const crop = s === "winter" ? hx("#b8a878") : s === "fall" ? hx("#c8a84c") : s === "spring" ? hx("#7ab84a") : hx("#5a9a3a");
  const cropD = shade(crop, 0.86);
  const track = s === "winter" ? hx("#a89868") : shade(crop, 0.74); // wheel ruts, subtle
  const dry = hx("#d9c791"), dryD = hx("#c9b57e");
  // arm angle: one slow revolution per in-game day-ish, 64 steps
  const ang = ((RS.tick >> 4) % 64) / 64 * Math.PI * 2;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  for (let py = 0; py < TILE_PX; py++) for (let px = 0; px < TILE_PX; px++) {
    const gx = x0 + px + 0.5, gy = y0 + py + 0.5;
    const dx = gx - P.cx, dy = gy - P.cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    let c: RGB;
    if (r > P.r) c = pixHash(x0 + px, y0 + py, 65) % 3 === 0 ? dryD : dry; // dry corners
    else {
      const ring = Math.floor(r) % 6;
      c = ring === 0 && r > 3 ? track : ring < 3 ? crop : (pixHash(x0 + px, y0 + py, 66) % 3 ? crop : cropD);
      // the arm: along the ray at `ang`, 1 px wide
      const along = dx * ca + dy * sa, across = -dx * sa + dy * ca;
      if (along > 0 && Math.abs(across) < 0.6) c = Math.floor(along) % 5 === 0 ? hx("#4a4a4a") : hx("#c8ccd0");
      // wet swath just behind the arm
      else if (along > 0 && across > 0.6 && across < 2.2 && s !== "winter") c = shade(c, 0.8);
      if (r < 1.2) c = hx("#6a6e74"); // pivot point
    }
    put(x0 + px, y0 + py, c);
  }
  return true;
}
