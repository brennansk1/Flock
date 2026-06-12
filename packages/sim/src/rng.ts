/**
 * Seeded xoshiro128** PRNG (§32: "seeded xoshiro RNG in the turn stream").
 *
 * Deterministic, fast, and lives entirely in the sim's turn stream — there is
 * no Math.random or Date anywhere in sim scope. State is four 32-bit words so
 * it serializes cleanly into snapshots and hashes the same on every client.
 */

export interface RngState {
  s0: number;
  s1: number;
  s2: number;
  s3: number;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Seed the RNG from a single 32-bit value via splitmix32 expansion. */
export function seedRng(seed: number): RngState {
  let z = seed >>> 0;
  const next = (): number => {
    z = (z + 0x9e3779b9) >>> 0;
    let x = z;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
    return (x ^ (x >>> 15)) >>> 0;
  };
  return { s0: next(), s1: next(), s2: next(), s3: next() };
}

/** Advance the state and return the next unsigned 32-bit integer. Mutates `st`. */
export function nextU32(st: RngState): number {
  const result = (Math.imul(rotl(Math.imul(st.s1, 5) >>> 0, 7), 9) >>> 0) >>> 0;
  const t = (st.s1 << 9) >>> 0;
  st.s2 ^= st.s0;
  st.s3 ^= st.s1;
  st.s1 ^= st.s2;
  st.s0 ^= st.s3;
  st.s2 ^= t;
  st.s3 = rotl(st.s3, 11);
  return result >>> 0;
}

/** Uniform integer in [0, bound). bound must be > 0. */
export function nextRange(st: RngState, bound: number): number {
  // Rejection-free modulo is fine for gameplay rolls; bias is negligible.
  return nextU32(st) % bound;
}

export function cloneRng(st: RngState): RngState {
  return { s0: st.s0, s1: st.s1, s2: st.s2, s3: st.s3 };
}
