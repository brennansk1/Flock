/**
 * Q16.16 fixed-point arithmetic.
 *
 * The entire simulation runs in fixed-point so that math is bit-identical
 * across machines and browsers (§32: "zero floats ... in sim scope"). A `Fixed`
 * is a 32-bit-range integer where the low 16 bits are the fractional part.
 *
 * Range: roughly ±32,767.99998. Resolution: 1/65536 ≈ 0.0000153.
 *
 * IMPORTANT: never feed a float into the sim. Convert at the boundary with
 * `fromFloat` (config load only) and read out with `toFloat` (rendering only).
 */

export type Fixed = number;

export const SHIFT = 16;
export const ONE: Fixed = 1 << SHIFT; // 65536
export const HALF: Fixed = ONE >> 1;

/** Construct a Fixed from an integer. */
export function fromInt(n: number): Fixed {
  return (n << SHIFT) | 0;
}

/** Construct a Fixed from a float. Boundary use only (e.g. loading balance.json). */
export function fromFloat(n: number): Fixed {
  return Math.round(n * ONE) | 0;
}

/** Read a Fixed back as a float. Rendering / telemetry only — never in sim math. */
export function toFloat(a: Fixed): number {
  return a / ONE;
}

/** Truncate toward zero to a whole integer. */
export function toInt(a: Fixed): number {
  return a >= 0 ? a >> SHIFT : -(-a >> SHIFT);
}

export function add(a: Fixed, b: Fixed): Fixed {
  return (a + b) | 0;
}

export function sub(a: Fixed, b: Fixed): Fixed {
  return (a - b) | 0;
}

/**
 * Multiply two Fixed values. Uses BigInt for the intermediate product so the
 * 64-bit product never loses precision before the shift back down. Result is
 * deterministic on every platform.
 */
export function mul(a: Fixed, b: Fixed): Fixed {
  return Number((BigInt(a) * BigInt(b)) >> BigInt(SHIFT)) | 0;
}

/** Divide two Fixed values (a / b). Returns 0 on divide-by-zero (sim must never trap). */
export function div(a: Fixed, b: Fixed): Fixed {
  if (b === 0) return 0;
  return Number((BigInt(a) << BigInt(SHIFT)) / BigInt(b)) | 0;
}

export function clamp(a: Fixed, lo: Fixed, hi: Fixed): Fixed {
  return a < lo ? lo : a > hi ? hi : a;
}

export function min(a: Fixed, b: Fixed): Fixed {
  return a < b ? a : b;
}

export function max(a: Fixed, b: Fixed): Fixed {
  return a > b ? a : b;
}
