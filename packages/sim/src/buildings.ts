/**
 * Buildings (§6). Placed on owned tiles (1/tile), build timer, 50% cancel
 * refund, destroyed (not captured) when their tile flips, disabled by strikes.
 *
 * This module owns the authoritative §6 table and the spatial queries other
 * systems ask of it (fort_mult, hotline intercept coverage, watchtower vision,
 * print-shop discounts, supplement-lab adjacency).
 */

import { add, mul, fromInt, fromFloat, ONE, type Fixed } from "./fixed.js";
import type { Balance } from "./balance.js";
import {
  Terrain,
  TileState,
  type Building,
  type PlayerId,
  type SimState,
  type TileId,
} from "./types.js";

const TPS = 10;

export interface BuildingDef {
  cost: number;
  /** per-extra-copy cost growth (compound ×1.35, watchtower ×1.25) */
  costGrowth: number;
  buildTicks: number;
  radius: number;
  max: number;
  /**
   * Congregation required to run the place at full output: converted residents
   * within STAFF_RADIUS. Effectiveness = min(1, nearby/staff). Placement is
   * strategy: a Broadcast Tower in an empty field is a very expensive lawn
   * ornament.
   */
  staff: number;
  /** archetype gate, if any */
  archetype?: "radiant";
}

/** How far the congregation will walk to run a building. */
export const STAFF_RADIUS = 6;

/** Authoritative table (§6). Satellite is the Visitors' Saucer chapel (§11.4). */
export const BUILDING_DEFS: Record<Building["type"], BuildingDef> = {
  compound: { cost: 15_000, costGrowth: 1.35, buildTicks: 20 * TPS, radius: 8, max: 8, staff: 40 },
  collection_plate: { cost: 10_000, costGrowth: 1, buildTicks: 15 * TPS, radius: 0, max: 6, staff: 25 },
  watchtower: { cost: 12_000, costGrowth: 1.25, buildTicks: 18 * TPS, radius: 6, max: 10, staff: 20 },
  broadcast_tower: { cost: 250_000, costGrowth: 1, buildTicks: 45 * TPS, radius: 0, max: 2, staff: 90 },
  hotline_center: { cost: 60_000, costGrowth: 1, buildTicks: 25 * TPS, radius: 12, max: 4, staff: 50 },
  print_shop: { cost: 40_000, costGrowth: 1, buildTicks: 25 * TPS, radius: 10, max: 3, staff: 40 },
  garage: { cost: 8_000, costGrowth: 1, buildTicks: 12 * TPS, radius: 0, max: 3, staff: 15 },
  supplement_lab: {
    cost: 25_000,
    costGrowth: 1,
    buildTicks: 20 * TPS,
    radius: 5,
    max: 4,
    staff: 30,
    archetype: "radiant",
  },
  satellite: { cost: 25_000, costGrowth: 1, buildTicks: 0, radius: 0, max: 99, staff: 0 },
};

/**
 * Staffing ratio as Q16.16 in [0, ONE]: converted residents within
 * STAFF_RADIUS over the required congregation. Pure integer math (lockstep
 * scope). Popless test worlds report fully staffed.
 */
export function staffingRatio(s: SimState, bd: Building): Fixed {
  const def = BUILDING_DEFS[bd.type];
  if (def.staff === 0 || s.totalPop === 0) return ONE;
  const w = s.world;
  const bx = bd.tile % w.width;
  const by = (bd.tile / w.width) | 0;
  let nearby = 0;
  for (let dy = -STAFF_RADIUS; dy <= STAFF_RADIUS; dy++) {
    const y = by + dy;
    if (y < 0 || y >= w.height) continue;
    for (let dx = -STAFF_RADIUS; dx <= STAFF_RADIUS; dx++) {
      const x = bx + dx;
      if (x < 0 || x >= w.width) continue;
      if (dx * dx + dy * dy > STAFF_RADIUS * STAFF_RADIUS) continue;
      const t = y * w.width + x;
      if (w.owner[t] === bd.player && w.state[t] === TileState.Believer) nearby += w.pop[t]!;
    }
  }
  return nearby >= def.staff ? ONE : Math.floor((nearby * ONE) / def.staff);
}

export function countBuildings(s: SimState, player: PlayerId, type: Building["type"]): number {
  let n = 0;
  for (const b of s.buildings) if (b.player === player && b.type === type) n++;
  return n;
}

/** Cost of the player's next building of `type`, with per-copy growth. */
export function buildingCost(s: SimState, player: PlayerId, type: Building["type"]): Fixed {
  const def = BUILDING_DEFS[type];
  let cost = fromInt(def.cost);
  if (def.costGrowth !== 1) {
    const growth = fromFloat(def.costGrowth);
    const existing = countBuildings(s, player, type);
    for (let i = 0; i < existing; i++) cost = mul(cost, growth);
  }
  return cost;
}

export function isOperational(b: Building): boolean {
  return b.buildTicksLeft === 0 && b.disabledTicks === 0;
}

function dist2(w: { width: number }, a: TileId, t: TileId): number {
  const ax = a % w.width;
  const ay = (a / w.width) | 0;
  const tx = t % w.width;
  const ty = (t / w.width) | 0;
  const dx = ax - tx;
  const dy = ay - ty;
  return dx * dx + dy * dy;
}

/**
 * Watchtower fort_mult inside radius 6 of the defender's operational tower
 * (§6), scaled by staffing: an unmanned tower barely slows anyone.
 * fort = 1 + 4 × staffing.
 */
export function fortMultAt(s: SimState, defender: PlayerId, tile: TileId): Fixed {
  let best: Fixed = ONE;
  for (const b of s.buildings) {
    if (b.type !== "watchtower" || b.player !== defender || !isOperational(b)) continue;
    if (dist2(s.world, b.tile, tile) > 36) continue;
    const fort = ONE + 4 * staffingRatio(s, b); // 1 → 5 fully staffed
    if (fort > best) best = fort;
  }
  return best;
}

/** Compound conversion anchor: +10% defense in radius 8 (§6). */
export function compoundDefenseAt(s: SimState, defender: PlayerId, tile: TileId): Fixed {
  for (const b of s.buildings) {
    if (b.type !== "compound" || b.player !== defender || !isOperational(b)) continue;
    if (dist2(s.world, b.tile, tile) <= 64) return fromFloat(1.1);
  }
  return ONE;
}

/** Is `tile` inside any of `player`'s operational Watchtower vision (radius 10, §6)? */
export function watchtowerSees(s: SimState, player: PlayerId, tile: TileId): boolean {
  for (const b of s.buildings) {
    if (b.type !== "watchtower" || b.player !== player || !isOperational(b)) continue;
    if (dist2(s.world, b.tile, tile) <= 100) return true;
  }
  return false;
}

/** Victim Hotline coverage of an impact point: 75% intercept chance (§8). */
export function hotlineCovers(s: SimState, victim: PlayerId, tile: TileId): boolean {
  for (const b of s.buildings) {
    if (b.type !== "hotline_center" || b.player !== victim || !isOperational(b)) continue;
    if (dist2(s.world, b.tile, tile) <= 144) return true;
  }
  return false;
}

/** Print Shop (§6): rituals −25% Faith cost, strike cooldowns −20%, if any operational. */
export function hasPrintShop(s: SimState, player: PlayerId): boolean {
  for (const b of s.buildings) {
    if (b.type === "print_shop" && b.player === player && isOperational(b)) return true;
  }
  return false;
}

/**
 * Operational, ≥50%-staffed Broadcast Tower without a strike already charging
 * (§6: one at a time). Nobody to run the booth, nobody to run the smear.
 */
export function freeBroadcastTower(s: SimState, player: PlayerId): Building | undefined {
  const charging = s.strikes.filter((c) => c.player === player).length;
  const towers = s.buildings.filter(
    (b) =>
      b.type === "broadcast_tower" &&
      b.player === player &&
      isOperational(b) &&
      staffingRatio(s, b) >= ONE >> 1,
  );
  return charging < towers.length ? towers[0] : undefined;
}

/** Garage capacity: 3 Vans per operational Garage (§6), needing drivers. */
export function vanCapacity(s: SimState, player: PlayerId): number {
  let cap = 0;
  for (const b of s.buildings) {
    if (b.type === "garage" && b.player === player && isOperational(b)) {
      cap += (3 * staffingRatio(s, b)) >> 16;
    }
  }
  return cap;
}

/** Destroy (not capture) any building standing on a tile that flipped (§6). */
export function destroyBuildingsOnTile(s: SimState, tile: TileId): void {
  for (let i = s.buildings.length - 1; i >= 0; i--) {
    const b = s.buildings[i]!;
    if (b.tile !== tile) continue;
    if (b.type === "compound") {
      const p = s.players.find((pl) => pl.id === b.player);
      if (p && p.compounds > 0) p.compounds--;
    }
    s.buildings.splice(i, 1);
  }
}

/** Disable every building in `radius` of `tile` belonging to `victim` (strikes/static). */
export function disableBuildingsNear(
  s: SimState,
  victim: PlayerId,
  tile: TileId,
  radius: number,
  ticks: number,
  types?: Building["type"][],
): void {
  const r2 = radius * radius;
  for (const b of s.buildings) {
    if (b.player !== victim) continue;
    if (types && !types.includes(b.type)) continue;
    if (dist2(s.world, b.tile, tile) <= r2) {
      b.disabledTicks = Math.max(b.disabledTicks, ticks);
    }
  }
}

/**
 * Per-tick building upkeep: construction progress, downtime countdown, and the
 * Supplement Lab trickle ("they already buy the tea", §6).
 */
export function stepBuildings(s: SimState, b: Balance): void {
  for (const bd of s.buildings) {
    if (bd.buildTicksLeft > 0) {
      bd.buildTicksLeft--;
      continue;
    }
    if (bd.disabledTicks > 0) bd.disabledTicks--;

    if (bd.type === "supplement_lab" && isOperational(bd)) {
      const p = s.players.find((pl) => pl.id === bd.player);
      if (!p || !p.alive) continue;
      // adjacent non-owned citizen tiles pay $0.004/tile/sec within radius 5
      const w = s.world;
      let tiles = 0;
      const bx = bd.tile % w.width;
      const by = (bd.tile / w.width) | 0;
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
          if (dx * dx + dy * dy > 25) continue;
          const x = bx + dx;
          const y = by + dy;
          if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
          const t = y * w.width + x;
          if (w.terrain[t] === Terrain.Citizen && w.owner[t] !== bd.player) tiles++;
        }
      }
      // 0.004 $/tile/sec, scaled by how many believers actually brew the tea
      let tea = mul(mul(fromFloat(0.004), fromInt(tiles)), b.dt);
      tea = mul(tea, staffingRatio(s, bd));
      p.usd = add(p.usd, tea);
      p.usdEarned = add(p.usdEarned, tea);
    }
  }
}
