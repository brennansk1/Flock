/**
 * Deterministic StateHash (§33). A mismatch between client and server hashes is
 * a desync; the client resyncs from a server snapshot. The hash must be stable
 * across Node/Chrome/Firefox — this is the CI gate that protects everything.
 *
 * We use a 64-bit FNV-1a folded into a hex string. It is not cryptographic; it
 * only needs to be collision-resistant enough to catch divergence, and above
 * all bit-identical everywhere. Implemented with BigInt for portable 64-bit math.
 */

import type { SimState } from "./types.js";

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

class Fnv {
  private h = FNV_OFFSET;

  byte(b: number): void {
    this.h = ((this.h ^ BigInt(b & 0xff)) * FNV_PRIME) & MASK64;
  }

  u32(n: number): void {
    this.byte(n & 0xff);
    this.byte((n >>> 8) & 0xff);
    this.byte((n >>> 16) & 0xff);
    this.byte((n >>> 24) & 0xff);
  }

  bytes(arr: ArrayLike<number>): void {
    for (let i = 0; i < arr.length; i++) this.byte(arr[i]!);
  }

  words(arr: { length: number; [i: number]: number }): void {
    for (let i = 0; i < arr.length; i++) this.u32(arr[i]! | 0);
  }

  hex(): string {
    return this.h.toString(16).padStart(16, "0");
  }
}

export function hashState(s: SimState): string {
  const f = new Fnv();
  f.u32(s.tick);
  f.u32(s.rng.s0);
  f.u32(s.rng.s1);
  f.u32(s.rng.s2);
  f.u32(s.rng.s3);

  const w = s.world;
  f.u32(w.width);
  f.u32(w.height);
  f.bytes(w.terrain);
  f.bytes(w.state);
  f.words(w.owner);
  f.words(w.susceptibility);
  f.words(w.dissent);
  for (let i = 0; i < w.scarTicks.length; i++) f.u32(w.scarTicks[i]!);
  f.words(w.district);

  for (const p of s.players) {
    f.u32(p.id);
    f.byte(p.alive ? 1 : 0);
    f.u32(p.followers | 0);
    f.u32(p.usd | 0);
    f.u32(p.faith | 0);
    f.u32(p.heat | 0);
    f.u32(p.compounds);
    f.u32(p.ownedTiles);
  }
  return f.hex();
}
