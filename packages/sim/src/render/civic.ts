/**
 * Stage-2 civic set pieces, each drawn as ONE composition across its whole
 * footprint (each tile draws only its own clipped 8×8 slice):
 *  - Lot.Courthouse: neoclassical county courthouse on its square — red
 *    brick with limestone trim, a white-columned portico facing the street,
 *    a clock cupola on the roof, flagpole and corner shade trees.
 *  - Lot.Track: the high-school football field inside a rust cinder oval,
 *    aluminium home bleachers + press box on one long side, light towers.
 *  - Lot.BallField: a little-league diamond — skinned infield, bases,
 *    mound, chalk foul lines, backstop, outfield fence.
 * Everything is a pure function of (footprint, orientation, season, tick).
 */
import { Terrain, type World } from "../types.js";
import { hexToRgb, shade, type RGB } from "../palette.js";
import { RS, C, TILE_PX, pixHash, isLitHour, type Put } from "./core.js";

const hx = hexToRgb;

/** Which footprint side faces the most road: 0=S 1=N 2=E 3=W (ties → S). */
export function streetSide(w: World, ax: number, ay: number, fw: number, fh: number): 0 | 1 | 2 | 3 {
  const road = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w.width && y < w.height && w.terrain[y * w.width + x] === Terrain.Road;
  const n = [0, 0, 0, 0];
  for (let dx = 0; dx < fw; dx++) {
    if (road(ax + dx, ay + fh)) n[0]!++;
    if (road(ax + dx, ay - 1)) n[1]!++;
  }
  for (let dy = 0; dy < fh; dy++) {
    if (road(ax + fw, ay + dy)) n[2]!++;
    if (road(ax - 1, ay + dy)) n[3]!++;
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (n[i]! > n[best]!) best = i;
  return best as 0 | 1 | 2 | 3;
}

function lawnColor(gx: number, gy: number): RGB {
  const base =
    RS.season === "winter" ? hx("#dfe7ee")
    : RS.season === "fall" ? hx("#8a8b54")
    : RS.season === "spring" ? hx("#4c9c28")
    : hx("#3c8223");
  return ((gx >> 1) + (gy >> 1)) % 2 === 0 ? base : shade(base, 1.07);
}

// ------------------------------------------------------------ Courthouse

const BRICK = hx("#a24a38");
const BRICK_D = hx("#86392b");
const LIME = hx("#e4dccb");
const LIME_D = hx("#bdb3a0");
const SLATE = hx("#5b5f66");
const COPPER = hx("#5f9a86");
const COPPER_L = hx("#86bba6");

export function drawCourthouse(w: World, ax: number, ay: number, fw: number, fh: number, clip: Put): void {
  const W = fw * TILE_PX, H = fh * TILE_PX;
  const AX = ax * TILE_PX, AY = ay * TILE_PX;
  const northFacing = streetSide(w, ax, ay, fw, fh) === 1;
  // draw in a south-facing frame; a north-facing square flips the plan
  // (the 3/4 wall face always shows on the screen-south side)
  const p = (x: number, y: number, c: RGB): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    clip(AX + x, AY + y, c);
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, c: RGB | ((x: number, y: number) => RGB)): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p(x, y, typeof c === "function" ? c(x, y) : c);
  };
  const tall = H >= 24;
  const snow = RS.season === "winter";
  rect(0, 0, W - 1, H - 1, (x, y) => lawnColor(AX + x, AY + y));
  const cx = W >> 1; // centre line (between cx-1 and cx)
  // vertical plan (rows), tall 3×3 vs compact 3×2
  const bx0 = 3, bx1 = W - 4;
  const roofY0 = tall ? 3 : 2;
  const wallY0 = tall ? 13 : 7; // limestone cornice row
  const wallY1 = tall ? 17 : 10; // foundation row
  const stepY = wallY1 + 1;
  const walkC = hx("#c9c2b2");
  // walks: perimeter ring, corner diagonals, the main walk to the street
  if (tall) {
    rect(bx0 - 1, roofY0 - 1, bx1 + 1, roofY0 - 1, walkC);
    rect(bx0 - 1, roofY0 - 1, bx0 - 1, stepY + 1, walkC);
    rect(bx1 + 1, roofY0 - 1, bx1 + 1, stepY + 1, walkC);
    rect(bx0 - 1, stepY + 1, bx1 + 1, stepY + 1, walkC);
    for (let i = 0; i < 4; i++) { p(bx0 - 2 - i, stepY + 2 + i, walkC); p(bx1 + 2 + i, stepY + 2 + i, walkC); }
  }
  for (let y = stepY; y < H; y++) { p(cx - 1, y, walkC); p(cx, y, walkC); }
  // hipped slate roof: lit N/W planes, shaded S/E planes
  const midY = (roofY0 + wallY0 - 1) >> 1;
  rect(bx0, roofY0, bx1, wallY0 - 1, (x, y) => {
    let c = snow ? hx("#e6ecf0") : SLATE;
    const k = y - roofY0;
    const hipW = x - bx0 < k + 1 && x - bx0 < wallY0 - 1 - y + 1;
    const hipE = bx1 - x < k + 1 && bx1 - x < wallY0 - 1 - y + 1;
    if (hipW || (y < midY && !hipE)) c = shade(c, 1.12);
    else if (hipE || y > midY) c = shade(c, 0.84);
    if (y === midY && !hipW && !hipE) c = shade(c, 1.25); // ridge
    return c;
  });
  // red-brick south face: limestone cornice + foundation, tall windows
  rect(bx0, wallY0, bx1, wallY0, LIME);
  rect(bx0, wallY0 + 1, bx1, wallY1 - 1, (x, y) => {
    if (x === bx1) return BRICK_D;
    const winCol = (x - bx0) % 2 === 1 && x < bx1 - 1;
    if (winCol && y < wallY1 - (tall ? 1 : 0)) return isLitHour() && pixHash(x, y, 311) % 3 === 0 ? C.windowLit : C.windowDark;
    return (x * 3 + y) % 7 === 0 ? BRICK_D : BRICK;
  });
  rect(bx0, wallY1, bx1, wallY1, LIME_D);
  // PORTICO: pediment + entablature + white columns, steps to the walk
  const px0 = cx - 3, px1 = cx + 2;
  if (tall) {
    rect(px0 + 1, wallY0 - 2, px1 - 1, wallY0 - 2, shade(LIME, 1.06)); // pediment apex
    rect(px0, wallY0 - 1, px1, wallY0 - 1, LIME);
  } else {
    rect(px0, wallY0 - 1, px1, wallY0 - 1, shade(LIME, 1.06));
  }
  rect(px0, wallY0, px1, wallY0, LIME_D); // entablature
  rect(px0, wallY0 + 1, px1, wallY1, (x) => ((x - px0) % 2 === 0 ? hx("#f6f2e8") : hx("#5e554c")));
  rect(px0 - 1, stepY, px1 + 1, stepY, LIME);
  // CLOCK CUPOLA centred on the roof: drum with clock face, copper dome
  const cu0 = roofY0 + (tall ? 1 : 0);
  p(cx - 1, cu0, hx("#d8b848")); // gilt finial
  rect(cx - 2, cu0 + 1, cx + 1, cu0 + (tall ? 2 : 1), (x, y) => (snow ? hx("#eef3f6") : x < cx || y === cu0 + 1 ? COPPER_L : COPPER));
  rect(cx - 2, cu0 + (tall ? 3 : 2), cx + 1, cu0 + (tall ? 4 : 3), (x) => (x === cx + 1 ? LIME_D : LIME));
  p(cx - 1, cu0 + (tall ? 3 : 2), hx("#fbf8ea")); // clock face
  p(cx, cu0 + (tall ? 3 : 2), hx("#2c2a26"));
  rect(cx - 2, cu0 + (tall ? 5 : 4), cx + 1, cu0 + (tall ? 5 : 4), shade(SLATE, 0.6)); // cupola shadow on the roof
  // flagpole on the lawn, flag streaming east
  const fx = 1;
  const fTop = stepY - (tall ? 5 : 4);
  for (let y = fTop; y <= stepY + 1; y++) p(fx, y, hx("#c8c8c8"));
  const wave = (RS.tick >> 3) & 1;
  p(fx + 1, fTop, hx("#b22234"));
  p(fx + 2, fTop + wave, hx("#f0f0f0"));
  p(fx + 1, fTop + 1, hx("#3c3b6e"));
  // lawn shade trees framing the front (bare in winter)
  const tree = (tx: number, ty: number): void => {
    const leaf = snow ? hx("#6a5a44") : RS.season === "fall" ? hx("#b06f33") : hx("#3f7a2c");
    const lite = snow ? hx("#e8eef2") : RS.season === "fall" ? hx("#c89a48") : hx("#5c9a40");
    p(tx + 1, ty + 3, C.shadow); p(tx + 2, ty + 2, C.shadow);
    p(tx, ty, lite); p(tx + 1, ty, leaf);
    p(tx - 1 + 0, ty + 1, leaf); p(tx + 1, ty + 1, shade(leaf, 0.8)); p(tx, ty + 1, leaf);
    p(tx, ty + 2, shade(leaf, 0.75));
  };
  if (tall) { tree(4, 20); tree(W - 6, 20); }
  void northFacing;
}

// ------------------------------------------------------------ Track

const CINDER = hx("#a4553c");
const CINDER_D = hx("#8e4632");

/** Pixel of the stadium in (u along the long axis, v across) space. */
function trackPixel(u: number, v: number, U: number, V: number, gx: number, gy: number, homeSide: boolean): RGB | null {
  // bleacher band on the home side, below the oval
  const standsH = V >= 30 ? 5 : 4;
  const ovalV = V - standsH;
  const r = (ovalV - 2) / 2; // outer radius
  const cyv = 1 + r; // oval centre (v)
  const cu0 = 1 + r, cu1 = U - 2 - r; // straightaway ends (u)
  const du = u < cu0 ? cu0 - u : u > cu1 ? u - cu1 : 0;
  const dv = v - cyv + 0.5;
  const dist = Math.sqrt(du * du + dv * dv);
  const winter = RS.season === "winter";
  if (dist <= r + 0.5) {
    if (dist > r - 2.5) {
      // cinder lanes with a chalk lane line
      if (Math.abs(dist - (r - 1)) < 0.35) return winter ? hx("#d8c8c0") : hx("#e8dcd0");
      return winter && pixHash(gx, gy, 331) % 2 === 0 ? hx("#e2e6e8") : pixHash(gx, gy, 333) % 5 === 0 ? CINDER_D : CINDER;
    }
    // infield: the football field between the goal lines + end zones
    const fl0 = Math.round(cu0 - r * 0.25), fl1 = Math.round(cu1 + r * 0.25);
    const fv0 = Math.round(cyv - r * 0.55), fv1 = Math.round(cyv + r * 0.55);
    const turfA = winter ? hx("#e4ebef") : hx("#4e9436");
    const turfB = winter ? hx("#d6dfe5") : hx("#45852f");
    if (u >= fl0 && u <= fl1 && v >= fv0 && v <= fv1) {
      const endW = Math.max(2, Math.round((fl1 - fl0) / 12));
      if (u < fl0 + endW || u > fl1 - endW) return winter ? hx("#c9b4b4") : hx("#7a2a30"); // maroon end zones
      const k = u - fl0 - endW;
      const span = fl1 - fl0 - 2 * endW;
      if (k % 4 === 0 || k === span) return winter ? hx("#f4f6f8") : hx("#f0f0e8"); // yard lines
      if (v === fv0 || v === fv1) return hx("#f0f0e8"); // sidelines
      return (k >> 1) % 2 === 0 ? turfA : turfB;
    }
    // goalposts just behind each end line
    if (Math.abs(v - cyv + 0.5) < 1 && (u === fl0 - 1 || u === fl1 + 1)) return hx("#f2d23b");
    return winter ? hx("#e4ebef") : hx("#58963e");
  }
  // HOME STANDS: aluminium bleacher rows + the press box on top
  const sv = v - ovalV;
  const su0 = Math.round(U * 0.25), su1 = Math.round(U * 0.75);
  if (homeSide && sv >= 0 && u >= su0 && u <= su1) {
    if (sv === standsH - 1 || (sv === standsH - 2 && Math.abs(u - (U >> 1)) <= 3)) {
      // press box (painted in school maroon, a dark window strip)
      if (Math.abs(u - (U >> 1)) <= 3) return sv === standsH - 2 ? (isLitHour() ? C.windowLit : C.windowDark) : hx("#7a2a30");
      return C.shadow;
    }
    if (sv === 0) return hx("#8e949a"); // front rail
    const snowy = RS.season === "winter" && sv % 2 === 1;
    return snowy ? hx("#eef2f4") : sv % 2 === 1 ? hx("#cfd4d8") : hx("#9aa1a8"); // bench / riser
  }
  return null;
}

export function drawTrack(w: World, ax: number, ay: number, fw: number, fh: number, x0: number, y0: number, put: Put): void {
  const W = fw * TILE_PX, H = fh * TILE_PX;
  const AX = ax * TILE_PX, AY = ay * TILE_PX;
  const horiz = fw >= fh;
  const U = horiz ? W : H, V = horiz ? H : W;
  const side = streetSide(w, ax, ay, fw, fh);
  // the stands face the street side when it runs along a long edge
  const flipV = horiz ? side === 1 : side === 3;
  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      const gx = x0 + px, gy = y0 + py;
      const lx = gx - AX, ly = gy - AY;
      const u = horiz ? lx : ly;
      let v = horiz ? ly : lx;
      if (flipV) v = V - 1 - v;
      const c = trackPixel(u, v, U, V, gx, gy, true) ?? lawnColor(gx, gy);
      put(gx, gy, c);
    }
  }
  // stadium light towers at the four corners of the oval (lamps glow at dusk)
  const lamp = isLitHour() ? hx("#fff6c8") : hx("#d8d8d0");
  const corners: Array<[number, number]> = [[2, 1], [U - 3, 1], [2, V - 6], [U - 3, V - 6]];
  for (const [cu, cv] of corners) {
    const vv = flipV ? V - 1 - cv : cv;
    const lx = horiz ? cu : vv, ly = horiz ? vv : cu;
    const gx = AX + lx, gy = AY + ly;
    if (gx >= x0 && gx < x0 + TILE_PX && gy >= y0 && gy < y0 + TILE_PX) put(gx, gy, C.iconDark);
    if (gx >= x0 && gx < x0 + TILE_PX && gy - 1 >= y0 && gy - 1 < y0 + TILE_PX) put(gx, gy - 1, lamp);
  }
}

// ------------------------------------------------------------ BallField

export function drawBallField(ax: number, ay: number, fw: number, fh: number, x0: number, y0: number, put: Put): void {
  const W = fw * TILE_PX, H = fh * TILE_PX;
  const AX = ax * TILE_PX, AY = ay * TILE_PX;
  const winter = RS.season === "winter";
  const grassA = winter ? hx("#e6edf1") : RS.season === "fall" ? hx("#7f8c4a") : hx("#5a9a3c");
  const grassB = shade(grassA, winter ? 0.97 : 0.9);
  const dirt = winter ? hx("#cfc6bc") : hx("#b88a5a");
  const chalk = hx("#f4f2ea");
  // home plate at bottom centre; diamond scaled to the footprint
  const hxp = (W >> 1) - 0.5, hyp = H - 3;
  const s = Math.min(W, H) * 0.3; // base-path length (px, along the diagonal)
  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      const gx = x0 + px, gy = y0 + py;
      const lx = gx - AX, ly = gy - AY;
      const du = lx - hxp, dv = hyp - ly; // dv up from home
      // rotate 45°: a = along 1B line, b = along 3B line
      const a = (du + dv) / Math.SQRT2, b = (dv - du) / Math.SQRT2;
      const r = Math.sqrt(du * du + dv * dv);
      let c: RGB = ((lx >> 1) & 1) === 0 ? grassA : grassB; // mowing stripes
      const inFair = a >= -0.5 && b >= -0.5;
      if (inFair && r > H - 4) c = winter ? hx("#8a8f94") : hx("#2f5a2a"); // outfield fence
      else if (inFair && r <= s * 1.45 && !(a > 1.2 && b > 1.2 && a < s - 1.2 && b < s - 1.2)) c = dirt; // skinned infield arc
      if (Math.abs(a - s / 2) < 0.9 && Math.abs(b - s / 2) < 0.9) c = dirt; // pitcher's mound
      if ((Math.abs(a) < 0.5 && b >= 0 && r < H - 3) || (Math.abs(b) < 0.5 && a >= 0 && r < H - 3)) c = chalk; // foul lines
      if (ly >= H - 1 && Math.abs(du) <= 3) c = hx("#5a5e62"); // backstop
      put(gx, gy, c);
    }
  }
  // bases + plate
  const base = (a: number, b: number): void => {
    const du = (a - b) / Math.SQRT2, dv = (a + b) / Math.SQRT2;
    const gx = Math.round(AX + hxp + du), gy = Math.round(AY + hyp - dv);
    if (gx >= x0 && gx < x0 + TILE_PX && gy >= y0 && gy < y0 + TILE_PX) put(gx, gy, chalk);
  };
  base(0, 0); base(s, 0); base(s, s); base(0, s);
  void W;
}
