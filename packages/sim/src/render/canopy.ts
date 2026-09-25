/**
 * WOODS CANOPY (Stage 2b): a crown-by-crown forest texture instead of
 * speckle. Crowns sit on a jittered 4-px lattice (radius 2–3 px), each lit
 * on its NW, shaded on its SE, with dark gaps between them; a hashed share
 * are conifers. The season changes the deciduous crowns:
 *   summer — three greens with sunlit highlights;
 *   fall   — per-crown reds, oranges and golds (a few holdouts still green);
 *   winter — BARE branch tracery over a snowy floor, snow on the lit side;
 *            conifers stay dark green with snow caps;
 *   spring — fresh pale green, with redbud-pink and dogwood-white blossom.
 * Pure function of the world px (pixHash only). Presentation only.
 */
import { hexToRgb, type RGB } from "../palette.js";
import { RS, pixHash } from "./core.js";

const hx = hexToRgb;
type Pal = { base: RGB[]; lite: RGB[]; dark: RGB[] };
const DECID: Record<string, Pal> = {
  summer: {
    base: [hx("#4e873a"), hx("#5a9442"), hx("#437a30")],
    lite: [hx("#79b458"), hx("#86bf62"), hx("#6aa34c")],
    dark: [hx("#335e26"), hx("#3c6a2c"), hx("#2e5522")],
  },
  fall: {
    base: [hx("#a8432e"), hx("#c0702e"), hx("#c89a3a"), hx("#8a3a2a"), hx("#7a7a3a")],
    lite: [hx("#d0684a"), hx("#e09448"), hx("#e8c060"), hx("#b85a40"), hx("#9a9a50")],
    dark: [hx("#6e2c20"), hx("#8a4a22"), hx("#96702a"), hx("#5e281e"), hx("#56562a")],
  },
  spring: {
    base: [hx("#7cb656"), hx("#8cc460"), hx("#d8a8bc"), hx("#6aa84a"), hx("#ece6dc"), hx("#74ae50"), hx("#86bc5a")],
    lite: [hx("#a8d882"), hx("#b4e08c"), hx("#f0c8d8"), hx("#94c870"), hx("#fbf8f2"), hx("#a0d07a"), hx("#acd884")],
    dark: [hx("#4e8034"), hx("#5a8c3c"), hx("#a8788c"), hx("#467a30"), hx("#b8b2a6"), hx("#4a7c32"), hx("#56883a")],
  },
};
const CONIFER = { base: hx("#2e5a34"), lite: hx("#467a48"), dark: hx("#1e3e24") };
const FLOOR_SUMMER = hx("#26401e"), FLOOR_FALL = hx("#5a3a22"), FLOOR_SPRING = hx("#3e6428");
const SNOW = hx("#e8eef2"), SNOW_SH = hx("#c8d4dc"), BRANCH = hx("#6a5a48"), BRANCH_D = hx("#4e4234");

/**
 * Canopy colour at world px (gx, gy). `conifers` is the evergreen share
 * (0..1, e.g. higher in the mountains).
 */
export function canopyPx(gx: number, gy: number, conifers = 0.22): RGB {
  const cx = gx >> 2, cy = gy >> 2;
  let best = 9, bh = 0, bdx = 0, bdy = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const h = pixHash(cx + i, cy + j, 4441);
      const ox = (cx + i) * 4 + (h & 3), oy = (cy + j) * 4 + ((h >> 2) & 3);
      const r = 2.2 + ((h >> 4) & 1) * 0.9;
      const dx = (gx - ox) / r, dy = (gy - oy) / r;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; bh = h; bdx = dx; bdy = dy; }
    }
  }
  const s = RS.season;
  const hp = pixHash(gx, gy, 4443);
  if (best > 1) {
    // the gap between crowns: deep shade / the forest floor
    if (s === "winter") return hp % 3 === 0 ? SNOW_SH : SNOW;
    return s === "fall" ? FLOOR_FALL : s === "spring" ? FLOOR_SPRING : FLOOR_SUMMER;
  }
  const lit = bdx + bdy < -0.55, dark = bdx + bdy > 0.65 || best > 0.8;
  const conifer = ((bh >>> 8) % 100) < conifers * 100;
  if (conifer) {
    if (s === "winter" && lit) return SNOW;
    return lit ? CONIFER.lite : dark ? CONIFER.dark : hp % 7 === 0 ? CONIFER.dark : CONIFER.base;
  }
  if (s === "winter") {
    // bare hardwood: branch tracery radiating from the crown's heart, snow
    // lying on the lit upper branches, the snowy floor showing through
    const spoke = ((Math.abs(bdx) < 0.25 || Math.abs(bdy) < 0.25 || Math.abs(bdx - bdy) < 0.3) && best < 0.8) || best < 0.08;
    if (!spoke) return hp % 4 === 0 ? BRANCH_D : hp % 3 === 0 ? SNOW_SH : SNOW;
    return lit && hp % 2 === 0 ? SNOW : dark ? BRANCH_D : BRANCH;
  }
  const pal = DECID[s] ?? DECID.summer!;
  const k = (bh >>> 12) % pal.base.length;
  if (lit) return pal.lite[k]!;
  if (dark) return pal.dark[k]!;
  return hp % 9 === 0 ? pal.lite[k]! : pal.base[k]!;
}
