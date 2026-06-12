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

  /** 64-bit value (Fixed can exceed 32 bits) as two u32 words, sign-extended. */
  fix(n: number): void {
    const v = BigInt.asUintN(64, BigInt(Math.trunc(n)));
    this.u32(Number(v & 0xffffffffn));
    this.u32(Number((v >> 32n) & 0xffffffffn));
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
    f.byte(p.spawned ? 1 : 0);
    f.byte(p.prophecyUsed ? 1 : 0);
    f.fix(p.followers);
    f.fix(p.usd);
    f.fix(p.faith);
    f.fix(p.heat);
    f.u32(p.compounds);
    f.u32(p.ownedTiles);
    f.u32(p.sermonBuffTicks);
    f.u32(p.atonementTicks);
    const cdKeys = Object.keys(p.cooldowns).sort();
    f.u32(cdKeys.length);
    for (const k of cdKeys) {
      for (let i = 0; i < k.length; i++) f.byte(k.charCodeAt(i));
      f.u32(p.cooldowns[k]!);
    }
  }

  // Match flow + timed effects.
  f.byte(s.status);
  f.u32(s.winner);
  f.u32(s.populated);
  f.u32(s.dominationPermille);
  f.u32(s.timerTicks);
  f.u32(s.pylons.length);
  for (const e of s.pylons) {
    f.u32(e.player);
    f.u32(e.tile);
    f.u32(e.ticksLeft);
  }
  f.u32(s.districtBuffs.length);
  for (const e of s.districtBuffs) {
    f.u32(e.player);
    f.u32(e.district);
    f.u32(e.ticksLeft);
  }
  f.u32(s.auras.length);
  for (const e of s.auras) {
    f.u32(e.player);
    f.u32(e.tile);
    f.u32(e.radius);
    f.u32(e.ticksLeft);
  }
  f.u32(s.prophecies.length);
  for (const e of s.prophecies) {
    f.u32(e.player);
    f.u32(e.snapshotPermille);
    f.u32(e.ticksLeft);
  }

  // Fronts (already kept in insertion order with sorted tile lists).
  f.u32(s.fronts.length);
  for (const fr of s.fronts) {
    f.u32(fr.id);
    f.u32(fr.player);
    f.u32(fr.tiles.length);
    for (const t of fr.tiles) f.u32(t);
  }

  // Conversion progress, iterated in sorted-key order for stability.
  const keys = [...s.progress.keys()].sort((a, z) => a - z);
  f.u32(keys.length);
  for (const k of keys) {
    f.u32(k);
    f.fix(s.progress.get(k)!);
  }
  return f.hex();
}
