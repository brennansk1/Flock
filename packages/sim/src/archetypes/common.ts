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

/** Progress (‰) toward `need`, capped at 1000. */
export function pct(have: number, need: number): number {
  return need <= 0 ? 1000 : Math.min(1000, Math.floor((have * 1000) / need));
}

/** Two-part path progress: the mean of both parts (each capped). */
export function both(a: number, b: number): number {
  return (Math.min(1000, a) + Math.min(1000, b)) >> 1;
}

export function addCapped(v: Fixed, amt: Fixed): Fixed {
  return min(add(v, amt), HUNDRED);
}
