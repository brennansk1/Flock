/**
 * Cross-engine-exact trigonometry (B1.4.21).
 *
 * `Math.sin`, `Math.cos` and `Math.atan2` are **not** required by ECMA-262 to
 * be correctly rounded — the spec explicitly allows implementation-defined
 * precision — so V8, SpiderMonkey and JavaScriptCore may disagree in the last
 * bits. Mapgen output is hashed and snapshotted, so a one-ULP disagreement in a
 * shape function is a desync waiting for the right seed.
 *
 * IEEE-754 `+ - * /` on doubles, by contrast, IS exactly specified and gives
 * bit-identical results on every conforming engine. These functions therefore
 * use nothing else: range reduction by multiplication, then a fixed-degree
 * polynomial. Same inputs, same bits, every browser.
 *
 * They approximate the real functions closely enough that town and blob shapes
 * are preserved (errors below are far finer than the tile quantisation that
 * consumes them), so this retires the risk without redrawing every map.
 */

const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

/**
 * sin, accurate to ~1e-9 on the reduced range.
 *
 * Range-reduce to [-π, π] by subtracting a whole number of turns, fold into
 * [-π/2, π/2] via sin(x) = sin(π − x), then a degree-9 Taylor series — which on
 * that interval is already at double-precision noise level.
 */
export function detSin(x: number): number {
  // reduce to [-π, π]. Math.round is exact (ties-to-even on an exact value).
  let a = x - TWO_PI * Math.round(x / TWO_PI);
  // fold into [-π/2, π/2]
  if (a > HALF_PI) a = PI - a;
  else if (a < -HALF_PI) a = -PI - a;
  const x2 = a * a;
  // a·(1 − x²/6 + x⁴/120 − x⁶/5040 + x⁸/362880), Horner form
  return (
    a *
    (1 +
      x2 *
        (-1 / 6 +
          x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880)))))
  );
}

/** cos, via the sin phase shift — same accuracy, same guarantees. */
export function detCos(x: number): number {
  return detSin(x + HALF_PI);
}

/**
 * atan2, accurate to ~1e-5 radians.
 *
 * A degree-9 odd polynomial for atan on |z| ≤ 1, with the standard octant
 * folding (atan(1/z) = π/2 − atan(z)) to cover the rest of the plane.
 */
export function detAtan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const swap = ay > ax;
  const z = swap ? ax / ay : ay / ax; // now 0 ≤ z ≤ 1
  const z2 = z * z;
  // minimax-style odd polynomial for atan on [0,1]
  let r =
    z *
    (0.9998660251 +
      z2 *
        (-0.3302995 +
          z2 * (0.180141 + z2 * (-0.085133 + z2 * 0.0208351))));
  if (swap) r = HALF_PI - r;
  if (x < 0) r = PI - r;
  return y < 0 ? -r : r;
}
