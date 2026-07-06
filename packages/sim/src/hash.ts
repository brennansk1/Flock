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

  str(sv: string): void {
    this.u32(sv.length);
    for (let i = 0; i < sv.length; i++) this.byte(sv.charCodeAt(i));
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
  f.bytes(w.pop);
  f.bytes(w.lot);
  f.bytes(w.landmark);
  for (let i = 0; i < w.holdTicks.length; i++) f.u32(w.holdTicks[i]!);
  f.bytes(w.flags);
  f.bytes(w.biome);
  f.words(w.property);
  f.str(w.townName);
  f.u32(w.streets.length);
  for (const st of w.streets) {
    f.str(st.name);
    f.byte(st.axis);
    f.u32(st.at);
    f.u32(st.from);
    f.u32(st.to);
  }

  for (const p of s.players) {
    f.u32(p.id);
    f.byte(p.alive ? 1 : 0);
    f.byte(p.spawned ? 1 : 0);
    f.byte(p.prophecyUsed ? 1 : 0);
    f.byte(p.e4Spent ? 1 : 0);
    f.byte(p.traitor ? 1 : 0);
    f.fix(p.followers);
    f.fix(p.usd);
    f.fix(p.faith);
    f.fix(p.heat);
    f.fix(p.maxFollowers);
    f.u32(p.compounds);
    f.u32(p.ownedTiles);
    f.u32(p.sermonBuffTicks);
    f.u32(p.atonementTicks);
    f.u32(p.judasTicks);
    f.u32(p.retentionDebuffTicks);
    f.u32(p.schismRiskTicks);
    f.fix(p.usdEarned);
    f.u32(p.faithHoldTicks);
    f.u32(p.channelTicks);
    f.u32(p.parcels);
    // v3 cohorts (push order is deterministic state)
    f.u32(p.cohorts.length);
    for (const c of p.cohorts) {
      f.u32(c.target);
      f.str(c.mode);
      f.fix(c.mass);
      f.u32(c.age);
      f.byte(c.recalling ? 1 : 0);
      f.u32(c.recallAge);
    }
    f.str(p.doctrine.join(","));
    f.str(p.pactNode);
    f.u32(p.pactWith);
    const cdKeys = Object.keys(p.cooldowns).sort();
    f.u32(cdKeys.length);
    for (const k of cdKeys) {
      f.str(k);
      f.u32(p.cooldowns[k]!);
    }
  }

  // Match flow + timed effects.
  f.byte(s.status);
  f.u32(s.winner);
  f.u32(s.populated);
  f.u32(s.totalPop);
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

  // M1 systems: buildings, units, strikes, diplomacy, scandal, CPA.
  f.byte(s.revelationMode ? 1 : 0);
  f.byte(s.disableCouriers ? 1 : 0);
  f.byte(s.disableCPA ? 1 : 0);
  f.byte(s.disableSchisms ? 1 : 0);
  f.u32(s.nextEntityId);
  f.u32(s.nextSplinterId);
  f.u32(s.cpaNextPicketTick);
  f.u32(s.cpaNextBusTick);
  f.u32(s.foundingTicksLeft);
  f.u32(s.recap.betrayals.length);
  for (const e of s.recap.betrayals) {
    f.u32(e.traitor);
    f.u32(e.victim);
    f.u32(e.tick);
  }
  f.u32(s.recap.scandals.length);
  for (const e of s.recap.scandals) {
    f.u32(e.attacker);
    f.u32(e.victim);
    f.u32(e.tick);
  }
  f.u32(s.recap.schisms.length);
  for (const e of s.recap.schisms) {
    f.u32(e.parent);
    f.u32(e.splinter);
    f.u32(e.tick);
  }
  f.u32(s.recap.prophecies.length);
  for (const e of s.recap.prophecies) {
    f.u32(e.player);
    f.byte(e.fulfilled ? 1 : 0);
    f.u32(e.tick);
  }
  f.u32(s.buildings.length);
  for (const e of s.buildings) {
    f.u32(e.id);
    f.u32(e.player);
    f.str(e.type);
    f.u32(e.tile);
    f.u32(e.buildTicksLeft);
    f.u32(e.disabledTicks);
  }
  f.u32(s.couriers.length);
  for (const e of s.couriers) {
    f.u32(e.id);
    f.u32(e.player);
    f.u32(e.path.length);
    f.u32(e.idx);
    f.fix(e.moveProgress);
    f.fix(e.usd);
  }
  f.u32(s.vans.length);
  for (const e of s.vans) {
    f.u32(e.id);
    f.u32(e.player);
    f.u32(e.tile);
    f.u32(e.idx);
    f.fix(e.moveProgress);
  }
  f.u32(s.agents.length);
  for (const e of s.agents) {
    f.u32(e.id);
    f.u32(e.player);
    f.u32(e.tile);
    f.u32(e.targetDistrict);
    f.u32(e.victim);
    f.str(e.mission);
    f.str(e.phase);
    f.u32(e.travelTicks);
    f.u32(e.channelTicks);
    f.u32(e.exposedTicks);
  }
  f.u32(s.strikes.length);
  for (const e of s.strikes) {
    f.u32(e.id);
    f.u32(e.player);
    f.str(e.type);
    f.u32(e.target);
    f.u32(e.victim);
    f.u32(e.chargeTicksLeft);
    f.u32(e.warningTicksLeft);
  }
  f.u32(s.alliances.length);
  for (const e of s.alliances) {
    f.u32(e.a);
    f.u32(e.b);
    f.u32(e.expiresTick);
  }
  f.u32(s.allianceOffers.length);
  for (const e of s.allianceOffers) {
    f.u32(e.from);
    f.u32(e.to);
    f.u32(e.expiresTick);
  }
  f.u32(s.grudges.length);
  for (const e of s.grudges) {
    f.u32(e.traitor);
    f.u32(e.victim);
  }
  f.u32(s.scandals.length);
  for (const e of s.scandals) {
    f.u32(e.attacker);
    f.u32(e.victim);
    f.fix(e.evidence);
    f.byte(e.notified ? 1 : 0);
    f.byte(e.published ? 1 : 0);
  }
  f.u32(s.cropCircles.length);
  for (const e of s.cropCircles) {
    f.u32(e.district);
    f.u32(e.ticksLeft);
  }
  f.u32(s.pickets.length);
  for (const e of s.pickets) {
    f.u32(e.target);
    f.u32(e.tile);
    f.u32(e.ticksLeft);
  }
  for (const rec of [s.raidLockouts]) {
    const rkeys = Object.keys(rec)
      .map(Number)
      .sort((a, z) => a - z);
    f.u32(rkeys.length);
    for (const k of rkeys) {
      f.u32(k);
      f.u32(rec[k]!);
    }
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
