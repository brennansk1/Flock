/**
 * Victory — ONE rule, many roads (Stage 1 redesign).
 *
 * Every way to win works the same way: meet a path's condition and an
 * ASCENSION countdown starts, broadcast to the whole lobby. Keep the
 * condition true until it hits zero and you win. Rivals break it by breaking
 * the condition (take ground back, capture the Megachurch, topple a saucer
 * chapel...) or by publishing a scandal on the ascending cult, which resets
 * the clock. Learn it once; every cult's own win reads the same way.
 *
 * Universal paths:  Domination (soul share) · Revelation (Megachurch + Faith)
 * Archetype paths:  from the registry (`ArchetypeDefinition.victory`).
 *
 * Determinism: integer / Q16.16 only; players iterate in seat order.
 */
import type { Balance } from "./balance.js";
import { Landmark, Lot, MatchStatus, NEUTRAL, TileState, type PlayerState, type SimState } from "./types.js";
import { ownsLandmark } from "./entities.js";
import { getArchetype } from "./archetypes/registry.js";

/** Per-tick aggregates every path reads (recomputed; never serialized). */
export interface VictoryStats {
  /** Holy-ground tiles in town (Church/Chapel lots + Megachurch landmark). */
  holyTotal: number;
  holyOwned: Map<number, number>;
  /** Sum of dissent (Fixed) over each player's believer tiles. */
  dissentSum: Map<number, number>;
  believerTiles: Map<number, number>;
  satellites: Map<number, number>;
  /** Soul share per player (‰) as of this read. */
  soulsPermille: Map<number, number>;
}

export function isHolyGround(s: SimState, t: number): boolean {
  const w = s.world;
  return w.lot[t] === Lot.Church || w.lot[t] === Lot.Chapel || w.landmark[t] === Landmark.Megachurch;
}

/**
 * One pass over the world (sim-side): refresh every player's `soulsPermille` (share of
 * the town's residents who believe in them; tile share on popless test
 * worlds) and gather the path aggregates.
 */
export function refreshVictoryStats(s: SimState): VictoryStats {
  const st = computeVictoryStats(s);
  for (const p of s.players) p.soulsPermille = st.soulsPermille.get(p.id) ?? 0;
  return st;
}

/** Pure read: the same aggregates without writing to the sim (HUD / tools). */
export function computeVictoryStats(s: SimState): VictoryStats {
  const w = s.world;
  const pop = new Map<number, number>();
  const holyOwned = new Map<number, number>();
  const dissentSum = new Map<number, number>();
  const believerTiles = new Map<number, number>();
  let holyTotal = 0;
  for (let t = 0; t < w.owner.length; t++) {
    const holy = isHolyGround(s, t);
    if (holy) holyTotal++;
    const o = w.owner[t]!;
    if (o === NEUTRAL || w.state[t] !== TileState.Believer) continue;
    pop.set(o, (pop.get(o) ?? 0) + w.pop[t]!);
    believerTiles.set(o, (believerTiles.get(o) ?? 0) + 1);
    dissentSum.set(o, (dissentSum.get(o) ?? 0) + w.dissent[t]!);
    if (holy) holyOwned.set(o, (holyOwned.get(o) ?? 0) + 1);
  }
  const satellites = new Map<number, number>();
  for (const bd of s.buildings) {
    if (bd.type === "satellite") satellites.set(bd.player, (satellites.get(bd.player) ?? 0) + 1);
  }
  const soulsPermille = new Map<number, number>();
  for (const p of s.players) {
    soulsPermille.set(p.id,
      s.totalPop > 0
        ? Math.floor(((pop.get(p.id) ?? 0) * 1000) / s.totalPop)
        : s.populated > 0
          ? Math.floor((p.ownedTiles * 1000) / s.populated)
          : 0);
  }
  return { holyTotal, holyOwned, dissentSum, believerTiles, satellites, soulsPermille };
}

/** Map class for scaled targets: S ≤ 64², M ≤ 112², L beyond. */
export function mapClass(s: SimState): "S" | "M" | "L" {
  const area = s.world.width * s.world.height;
  return area <= 64 * 64 ? "S" : area <= 112 * 112 ? "M" : "L";
}

/**
 * The Tipping Point: the Domination bar starts at the lobby's threshold and
 * slides linearly to the floor between tippingStart and tippingEnd, so a
 * stalled town always tips eventually. A threshold of 1000 (disabled) stays put.
 */
export function dominationThreshold(s: SimState, b: Balance): number {
  const base = s.dominationPermille;
  const v = b.victory;
  if (base >= 1000 || base <= v.tippingFloorPermille || s.tick <= v.tippingStartTick) return base;
  if (s.tick >= v.tippingEndTick) return v.tippingFloorPermille;
  const span = Math.max(1, v.tippingEndTick - v.tippingStartTick);
  return base - Math.floor(((base - v.tippingFloorPermille) * (s.tick - v.tippingStartTick)) / span);
}

export interface PathStatus {
  id: string;
  name: string;
  /** 0..1000 — how close the condition is to being met (HUD race bar). */
  progress: number;
  met: boolean;
}

/** Every path open to `p`, universal first, then the archetype's own. */
export function victoryPaths(s: SimState, p: PlayerState, b: Balance, st: VictoryStats): PathStatus[] {
  const dom = dominationThreshold(s, b);
  const out: PathStatus[] = [
    {
      id: "domination",
      name: "Domination",
      progress: Math.min(1000, Math.floor((p.soulsPermille * 1000) / Math.max(1, dom))),
      met: p.soulsPermille >= dom,
    },
  ];
  // Revelation: hold the Megachurch with Faith high (only on maps that have one).
  const megachurch = ownsLandmark(s, p.id, Landmark.Megachurch);
  const faithFloor = b.victory.revelationFaith;
  const faithPart = Math.min(1000, Math.floor((p.faith * 1000) / Math.max(1, faithFloor)));
  out.push({
    id: "revelation",
    name: "Revelation",
    progress: megachurch ? Math.min(999, 500 + (faithPart >> 1)) : faithPart >> 1,
    met: megachurch && p.faith >= faithFloor,
  });
  const v = getArchetype(p.archetype).victory;
  if (v) {
    out.push({ id: v.id, name: v.name, progress: v.progress(s, p, b, st), met: v.achieved(s, p, b, st) });
  }
  return out;
}

/** A published scandal on an ascending cult resets its countdown (§counterplay). */
export function breakAscension(p: PlayerState, b: Balance): boolean {
  if (p.ascendPath === "") return false;
  p.ascendTicks = b.victory.ascendTicks;
  return true;
}

/**
 * Advance every contender's Ascension. Returns true if the match ended.
 * A cult ascends on the first met path (fixed priority order); if its path
 * changes the countdown restarts, if no path is met the countdown collapses.
 */
export function stepAscension(s: SimState, b: Balance, contenders: PlayerState[], st: VictoryStats): boolean {
  for (const p of contenders) {
    const met = victoryPaths(s, p, b, st).find((x) => x.met);
    if (!met) {
      p.ascendPath = "";
      p.ascendTicks = 0;
      continue;
    }
    if (p.ascendPath !== met.id) {
      p.ascendPath = met.id;
      p.ascendTicks = b.victory.ascendTicks;
      continue;
    }
    if (p.ascendTicks > 0) p.ascendTicks--;
  }
  // Resolve winners in seat order (deterministic tie-break).
  for (const p of contenders) {
    if (p.ascendPath !== "" && p.ascendTicks === 0) {
      s.status = MatchStatus.Ended;
      s.winner = p.id;
      s.winPath = p.ascendPath;
      return true;
    }
  }
  return false;
}

