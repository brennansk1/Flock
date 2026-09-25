/**
 * DESERT GROUND (Stage 2b): sand-tone variety instead of one flat tan —
 * three soil zones on a broad noise field plus two overlays:
 *   red soil  — iron-red loam / terra rosa patches (the mesa country);
 *   sand      — the common tan, speckled;
 *   dunes     — a dune field with wind RIPPLES (lit crests, shaded troughs);
 *   caliche   — pale white hardpan flats with hairline cracks;
 *   pebbles   — scattered desert-pavement stones, dry brush tufts.
 * Winter lays a thin dusting that lets the zones read through.
 * Pure function of the world px (pixHash / valueNoise). Presentation only.
 */
import { hexToRgb, type RGB } from "../palette.js";
import { C, RS, pixHash, valueNoise } from "./core.js";

const hx = hexToRgb;
const RED = [hx("#c89a6e"), hx("#d0a676"), hx("#b88a62")];
const SAND = [hx("#d9c791"), hx("#c9b57e"), hx("#e0d09c")];
const DUNE_HI = hx("#e8dcae"), DUNE = hx("#dccb96"), DUNE_LO = hx("#c2ab74");
const CALICHE = hx("#e2d8b8"), CALICHE_CRACK = hx("#cbbf9e");
const PEBBLE = hx("#8a7a60");

export function desertGround(gx: number, gy: number): RGB {
  const h = pixHash(gx, gy, 65);
  const winter = RS.season === "winter";
  const z = valueNoise(gx, gy, 44, 301) + 0.12 * (valueNoise(gx, gy, 9, 305) - 0.5);
  let c: RGB;
  const edge = (h % 100) / 100 * 0.06; // dithered zone boundaries
  if (z + edge < 0.27) {
    c = RED[h % 5 === 0 ? 1 : h % 7 === 0 ? 2 : 0]!;
  } else if (z - edge > 0.64) {
    // dune ripples: diagonal wind lines wobbling on a noise field
    const ph = (gx * 2 + gy * 3 + Math.floor(valueNoise(gx, gy, 12, 307) * 9)) % 6;
    c = ph === 0 ? DUNE_HI : ph === 3 || ph === 4 ? DUNE_LO : DUNE;
  } else {
    c = SAND[h % 3 === 0 ? 1 : h % 11 === 0 ? 2 : 0]!;
  }
  // caliche hardpan flats
  const k = valueNoise(gx, gy, 26, 309);
  if (k - edge > 0.72 && z <= 0.64) c = (gx * 7 + gy * 3) % 11 === 0 || h % 17 === 0 ? CALICHE_CRACK : CALICHE;
  if (h % 29 === 0) c = PEBBLE;
  else if (h % 31 === 0) c = C.sandScrub;
  if (winter) {
    // a thin dusting: most px snow-white, the zone tone shows through
    if (h % 3 !== 0) c = h % 5 === 0 ? C.sandDark : C.sandBg;
  }
  return c;
}
