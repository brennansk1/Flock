/**
 * Colour grading (time of day). A pure per-colour transform, memoised per
 * frame by packed RGB so the per-pixel put() never allocates.
 *
 * Dusk/dawn are LUMINANCE-WEIGHTED grades, not per-channel gains: highlights
 * take the low sun's warm tint while shadows cool slightly, and everything
 * darkens a touch. The old per-channel dusk gains (b×1.12 + 10) pushed snow,
 * concrete and asphalt through magenta — the hot-pink winter-dusk map bug.
 */
import type { RGB } from "../palette.js";
import { C } from "./core.js";

/** Light sources that ignore the grade (they emit). */
export const EMISSIVE = {
  beacon: [255, 34, 34] as RGB,
  policeRed: [255, 40, 48] as RGB,
  policeBlue: [48, 96, 255] as RGB,
  hazard: [255, 176, 32] as RGB,
  headlight: [255, 246, 208] as RGB,
  taillight: [255, 51, 51] as RGB,
  neonPink: [255, 90, 200] as RGB,
  neonCyan: [80, 240, 255] as RGB,
  /** lighthouse beam (pale sodium-white) */
  beam: [255, 236, 170] as RGB,
  /** police light-bar bloom: dimmer halos around the flashing bar */
  policeRedGlow: [170, 36, 48] as RGB,
  policeBlueGlow: [40, 70, 190] as RGB,
  /** cult members' white beacon heads glow through the night grade */
  beaconWhite: [255, 255, 255] as RGB,
};

const pack = (c: RGB): number => (c[0] << 16) | (c[1] << 8) | c[2];

export type Grader = (rgb: RGB) => RGB;

export function makeGrader(time: "dawn" | "day" | "dusk" | "night"): Grader {
  if (time === "day") return (rgb) => rgb;
  const emissive = new Set<number>([
    pack(C.windowLit),
    pack(C.iconAccent),
    ...Object.values(EMISSIVE).map(pack),
  ]);
  if (time === "night") emissive.add(pack(C.windowDark)); // warm-lit panes at night
  const memo = new Map<number, RGB>();
  const clamp = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : n | 0);
  return (rgb) => {
    const k = pack(rgb);
    let out = memo.get(k);
    if (out) return out;
    if (emissive.has(k)) {
      out = rgb;
    } else {
      const L = (rgb[0] * 77 + rgb[1] * 150 + rgb[2] * 29) >> 8; // 0..255
      const hi = L / 255; // highlight weight
      const lo = 1 - hi; // shadow weight
      if (time === "dusk") {
        // warm amber highlights, faint blue in the shade, ~22% darker
        out = [
          clamp(rgb[0] * 0.8 + 30 * hi - 4 * lo),
          clamp(rgb[1] * 0.74 + 10 * hi - 2 * lo),
          clamp(rgb[2] * 0.72 - 6 * hi + 12 * lo),
        ];
      } else if (time === "dawn") {
        // pale gold-rose, lighter than dusk, cool shadows
        out = [
          clamp(rgb[0] * 0.9 + 20 * hi),
          clamp(rgb[1] * 0.86 + 12 * hi),
          clamp(rgb[2] * 0.84 + 2 * hi + 10 * lo),
        ];
      } else {
        out = [(rgb[0] * 0.22) | 0, (rgb[1] * 0.32) | 0, (rgb[2] * 0.55) | 0];
      }
    }
    memo.set(k, out);
    return out;
  };
}
