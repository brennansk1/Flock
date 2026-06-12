/**
 * Q16.16 fixed-point arithmetic.
 *
 * The entire simulation runs in fixed-point so that math is bit-identical
 * across machines and browsers (§32: "zero floats ... in sim scope"). A `Fixed`
 * is an integer-valued JS number where the low 16 bits are the fractional
 * part. Values stay within JS's exact-integer range (±2^53), giving ~±1.37e11
 * of usable magnitude — comfortably above the economy's millions ($1.6M
 * Manifesto, 200k followers) with full fractional precision.
 *
 * Determinism: every operation is integer-exact. Products go through BigInt so
 * the intermediate never rounds; add/sub/clamp are exact integer ops below
 * 2^53 on every JS engine.
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
  return n * ONE;
}

/** Construct a Fixed from a float. Boundary use only (e.g. loading balance.json). */
export function fromFloat(n: number): Fixed {
  return Math.round(n * ONE);
}

/** Read a Fixed back as a float. Rendering / telemetry only — never in sim math. */
export function toFloat(a: Fixed): number {
  return a / ONE;
}

/** Truncate toward zero to a whole integer. */
export function toInt(a: Fixed): number {
  return Math.trunc(a / ONE);
}

export function add(a: Fixed, b: Fixed): Fixed {
  return a + b;
}

export function sub(a: Fixed, b: Fixed): Fixed {
  return a - b;
}

/**
 * Multiply two Fixed values. BigInt intermediate keeps the full product exact
 * before the shift back down; the result is deterministic on every platform.
 */
export function mul(a: Fixed, b: Fixed): Fixed {
  return Number((BigInt(a) * BigInt(b)) >> BigInt(SHIFT));
}

/** Divide two Fixed values (a / b). Returns 0 on divide-by-zero (sim must never trap). */
export function div(a: Fixed, b: Fixed): Fixed {
  if (b === 0) return 0;
  return Number((BigInt(a) << BigInt(SHIFT)) / BigInt(b));
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
