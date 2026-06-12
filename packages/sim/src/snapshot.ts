/**
 * State snapshot codec (§33): the server snapshots every 600 turns and on
 * client join; a desynced client restores from the latest snapshot and replays
 * forward. JSON-shaped for the skeleton (a binary codec swaps in later — the
 * shape is already explicit and versioned).
 *
 * Round-trip invariant: hashState(fromSnapshot(toSnapshot(s))) === hashState(s).
 */

import type { Fixed } from "./fixed.js";
import type { RngState } from "./rng.js";
import type { SimState, World, PlayerState, Front } from "./types.js";

export const SNAPSHOT_VERSION = 1;

export interface Snapshot {
  v: number;
  tick: number;
  rng: RngState;
  world: {
    width: number;
    height: number;
    terrain: number[];
    state: number[];
    owner: number[];
    susceptibility: number[];
    dissent: number[];
    scarTicks: number[];
    district: number[];
    districtCoeffs: { conv: Fixed; retain: Fixed; income: Fixed }[];
  };
  players: PlayerState[];
  fronts: Front[];
  nextFrontId: number;
  /** progress map flattened to [key, value] pairs, sorted by key. */
  progress: [number, Fixed][];
}

export function toSnapshot(s: SimState): Snapshot {
  const w = s.world;
  return {
    v: SNAPSHOT_VERSION,
    tick: s.tick,
    rng: { ...s.rng },
    world: {
      width: w.width,
      height: w.height,
      terrain: [...w.terrain],
      state: [...w.state],
      owner: [...w.owner],
      susceptibility: [...w.susceptibility],
      dissent: [...w.dissent],
      scarTicks: [...w.scarTicks],
      district: [...w.district],
      districtCoeffs: w.districtCoeffs.map((d) => ({ ...d })),
    },
    players: s.players.map((p) => ({ ...p })),
    fronts: s.fronts.map((f) => ({ ...f, tiles: [...f.tiles] })),
    nextFrontId: s.nextFrontId,
    progress: [...s.progress.entries()].sort((a, z) => a[0] - z[0]),
  };
}

export function fromSnapshot(snap: Snapshot): SimState {
  if (snap.v !== SNAPSHOT_VERSION) {
    throw new Error(`snapshot version mismatch: got ${snap.v}, want ${SNAPSHOT_VERSION}`);
  }
  const sw = snap.world;
  const world: World = {
    width: sw.width,
    height: sw.height,
    terrain: Uint8Array.from(sw.terrain),
    state: Uint8Array.from(sw.state),
    owner: Uint32Array.from(sw.owner),
    susceptibility: Int32Array.from(sw.susceptibility),
    dissent: Int32Array.from(sw.dissent),
    scarTicks: Uint16Array.from(sw.scarTicks),
    district: Uint32Array.from(sw.district),
    districtCoeffs: sw.districtCoeffs.map((d) => ({ ...d })),
  };
  return {
    tick: snap.tick,
    rng: { ...snap.rng },
    world,
    players: snap.players.map((p) => ({ ...p })),
    fronts: snap.fronts.map((f) => ({ ...f, tiles: [...f.tiles] })),
    nextFrontId: snap.nextFrontId,
    progress: new Map(snap.progress),
  };
}
