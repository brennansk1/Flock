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
import type {
  SimState,
  World,
  PlayerState,
  Pylon,
  DistrictBuff,
  Aura,
  Prophecy,
  MatchStatus,
  Building,
  Courier,
  Van,
  AgentUnit,
  StrikeCharge,
  Alliance,
  AllianceOffer,
  Grudge,
  Scandal,
  CropCircle,
  Picket,
  RecapEvents,
  ActiveDecree,
} from "./types.js";
import type { Street } from "./names.js";

export const SNAPSHOT_VERSION = 10; // v10: fronts removed (v3 missions)

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
    pop: number[];
    lot: number[];
    landmark: number[];
    holdTicks: number[];
    flags: number[];
    townName: string;
    streets: Street[];
    biome: number[];
    property: number[];
  };
  players: PlayerState[];
  /** progress map flattened to [key, value] pairs, sorted by key. */
  progress: [number, Fixed][];
  populated: number;
  totalPop: number;
  dominationPermille: number;
  timerTicks: number;
  status: MatchStatus;
  winner: number;
  pylons: Pylon[];
  districtBuffs: DistrictBuff[];
  auras: Aura[];
  prophecies: Prophecy[];
  activeDecrees: ActiveDecree[];
  winPath: string;
  disableCouriers: boolean;
  disableCPA: boolean;
  disableSchisms: boolean;
  buildings: Building[];
  couriers: Courier[];
  vans: Van[];
  agents: AgentUnit[];
  strikes: StrikeCharge[];
  nextEntityId: number;
  alliances: Alliance[];
  allianceOffers: AllianceOffer[];
  grudges: Grudge[];
  scandals: Scandal[];
  cropCircles: CropCircle[];
  pickets: Picket[];
  raidLockouts: Record<number, number>;
  nextSplinterId: number;
  cpaNextPicketTick: number;
  cpaNextBusTick: number;
  foundingTicksLeft: number;
  recap: RecapEvents;
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
      pop: [...w.pop],
      lot: [...w.lot],
      landmark: [...w.landmark],
      holdTicks: [...w.holdTicks],
      flags: [...w.flags],
      townName: w.townName,
      streets: w.streets.map((s) => ({ ...s })),
      biome: [...w.biome],
      property: [...w.property],
    },
    players: s.players.map((p) => ({
      ...p,
      cooldowns: { ...p.cooldowns },
      doctrine: [...p.doctrine],
      cohorts: p.cohorts.map((c) => ({ ...c })),
    })),
    progress: [...s.progress.entries()].sort((a, z) => a[0] - z[0]),
    populated: s.populated,
    totalPop: s.totalPop,
    dominationPermille: s.dominationPermille,
    timerTicks: s.timerTicks,
    status: s.status,
    winner: s.winner,
    pylons: s.pylons.map((e) => ({ ...e })),
    districtBuffs: s.districtBuffs.map((e) => ({ ...e })),
    auras: s.auras.map((e) => ({ ...e })),
    prophecies: s.prophecies.map((e) => ({ ...e })),
    activeDecrees: s.activeDecrees.map((e) => ({ ...e })),
    winPath: s.winPath,
    disableCouriers: s.disableCouriers,
    disableCPA: s.disableCPA,
    disableSchisms: s.disableSchisms,
    buildings: s.buildings.map((e) => ({ ...e })),
    couriers: s.couriers.map((e) => ({ ...e, path: [...e.path] })),
    vans: s.vans.map((e) => ({ ...e, path: [...e.path] })),
    agents: s.agents.map((e) => ({ ...e })),
    strikes: s.strikes.map((e) => ({ ...e })),
    nextEntityId: s.nextEntityId,
    alliances: s.alliances.map((e) => ({ ...e })),
    allianceOffers: s.allianceOffers.map((e) => ({ ...e })),
    grudges: s.grudges.map((e) => ({ ...e })),
    scandals: s.scandals.map((e) => ({ ...e })),
    cropCircles: s.cropCircles.map((e) => ({ ...e })),
    pickets: s.pickets.map((e) => ({ ...e })),
    raidLockouts: { ...s.raidLockouts },
    nextSplinterId: s.nextSplinterId,
    cpaNextPicketTick: s.cpaNextPicketTick,
    cpaNextBusTick: s.cpaNextBusTick,
    foundingTicksLeft: s.foundingTicksLeft,
    recap: {
      betrayals: s.recap.betrayals.map((e) => ({ ...e })),
      scandals: s.recap.scandals.map((e) => ({ ...e })),
      schisms: s.recap.schisms.map((e) => ({ ...e })),
      prophecies: s.recap.prophecies.map((e) => ({ ...e })),
    },
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
    pop: Uint8Array.from(sw.pop),
    lot: Uint8Array.from(sw.lot),
    landmark: Uint8Array.from(sw.landmark),
    holdTicks: Uint16Array.from(sw.holdTicks),
    flags: Uint8Array.from(sw.flags),
    townName: sw.townName,
    streets: sw.streets.map((s) => ({ ...s })),
    biome: Uint8Array.from(sw.biome),
    property: Uint32Array.from(sw.property),
  };
  return {
    tick: snap.tick,
    rng: { ...snap.rng },
    world,
    players: snap.players.map((p) => ({
      ...p,
      cooldowns: { ...p.cooldowns },
      doctrine: [...p.doctrine],
      cohorts: p.cohorts.map((c) => ({ ...c })),
    })),
    progress: new Map(snap.progress),
    populated: snap.populated,
    totalPop: snap.totalPop,
    dominationPermille: snap.dominationPermille,
    timerTicks: snap.timerTicks,
    status: snap.status,
    winner: snap.winner,
    pylons: snap.pylons.map((e) => ({ ...e })),
    districtBuffs: snap.districtBuffs.map((e) => ({ ...e })),
    auras: snap.auras.map((e) => ({ ...e })),
    prophecies: snap.prophecies.map((e) => ({ ...e })),
    activeDecrees: (snap.activeDecrees ?? []).map((e) => ({ ...e })),
    winPath: snap.winPath,
    disableCouriers: snap.disableCouriers,
    disableCPA: snap.disableCPA,
    disableSchisms: snap.disableSchisms,
    buildings: snap.buildings.map((e) => ({ ...e })),
    couriers: snap.couriers.map((e) => ({ ...e, path: [...e.path] })),
    vans: snap.vans.map((e) => ({ ...e, path: [...e.path] })),
    agents: snap.agents.map((e) => ({ ...e })),
    strikes: snap.strikes.map((e) => ({ ...e })),
    nextEntityId: snap.nextEntityId,
    alliances: snap.alliances.map((e) => ({ ...e })),
    allianceOffers: snap.allianceOffers.map((e) => ({ ...e })),
    grudges: snap.grudges.map((e) => ({ ...e })),
    scandals: snap.scandals.map((e) => ({ ...e })),
    cropCircles: snap.cropCircles.map((e) => ({ ...e })),
    pickets: snap.pickets.map((e) => ({ ...e })),
    raidLockouts: { ...snap.raidLockouts },
    nextSplinterId: snap.nextSplinterId,
    cpaNextPicketTick: snap.cpaNextPicketTick,
    cpaNextBusTick: snap.cpaNextBusTick,
    foundingTicksLeft: snap.foundingTicksLeft,
    recap: {
      betrayals: snap.recap.betrayals.map((e) => ({ ...e })),
      scandals: snap.recap.scandals.map((e) => ({ ...e })),
      schisms: snap.recap.schisms.map((e) => ({ ...e })),
      prophecies: snap.recap.prophecies.map((e) => ({ ...e })),
    },
  };
}
