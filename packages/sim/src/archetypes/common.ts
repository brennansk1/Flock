/** Small shared helpers for archetype kits (call-time only; no top-level use). */
import { add, min, fromInt, type Fixed } from "../fixed.js";
import { Terrain, type SimState, type TileId, type World } from "../types.js";

export const TPS = 10;
export const HUNDRED: Fixed = fromInt(100);

/** Literal rate → Fixed (boundary-only, identical to the engine's `fp`). */
export function fp(n: number): Fixed {
  return Math.round(n * 65536) | 0;
}

export const usd = (n: number) => ({ usd: fromInt(n) });
export const faith = (n: number) => ({ faith: fromInt(n) });

export function inBounds(s: SimState, t: TileId): boolean {
  return t >= 0 && t < s.world.terrain.length;
}

export function isCitizen(w: World, t: TileId): boolean {
  return w.terrain[t] === Terrain.Citizen;
}

/** District of a target tile, or 0 when out of bounds / wilderness. */
export function districtAt(s: SimState, t: TileId): number {
  return inBounds(s, t) ? s.world.district[t]! : 0;
}

export function addCapped(v: Fixed, amt: Fixed): Fixed {
  return min(add(v, amt), HUNDRED);
}
