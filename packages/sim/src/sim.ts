/**
 * The simulation core (Part II). One `step` == one tick (100 ms, §32). Given a
 * Turn's intents and the same starting state, every machine must reach the same
 * next state — that is the lockstep contract.
 *
 * M0 systems in this file: state construction, intent application (stances,
 * spawns, fronts, compounds, rituals §9, Final Dawn kit §11.1), the per-tick
 * economy/decay loop (§3), timed-effect countdowns, Prophecy resolution, and
 * the victory/elimination state machine (§18). Conversion resolution (§4)
 * lives in conversion.ts.
 */

import { add, sub, mul, div, clamp, min, max, fromInt, ONE, type Fixed } from "./fixed.js";
import { seedRng, type RngState } from "./rng.js";
import type { Balance } from "./balance.js";
import { IntentType, type Intent, type Turn } from "./intents.js";
import {
  NEUTRAL,
  Stance,
  Terrain,
  TileState,
  TileFlag,
  Landmark,
  Lot,
  MatchStatus,
  type Building,
  type PlayerState,
  type SimState,
  type World,
  type PlayerId,
  type TileId,
  type DistrictId,
} from "./types.js";
import { resolveConversion } from "./conversion.js";
import { carveDirtLane } from "./mapgen.js";
import { newPlayer } from "./player.js";
import {
  BUILDING_DEFS,
  buildingCost,
  countBuildings,
  freeBroadcastTower,
  vanCapacity,
  stepBuildings,
} from "./buildings.js";
import {
  stepCouriers,
  stepVans,
  stepAgents,
  stepStrikes,
  stepCPA,
  dispatchAgent,
  publishScandal,
  gainHeatScaled,
  linePath,
  ownsLandmark,
  STRIKE_DEFS,
  WARNING_TICKS,
} from "./entities.js";
import {
  proposeAlliance,
  acceptAlliance,
  breakAlliance,
  stepSchism,
} from "./diplomacy.js";
import { pickDoctrine, titheMult, ownDissentMult, loveBombCostMult, strikeCostMult, tryAbsorbMassApostasy } from "./doctrine.js";
import {
  computeCivicControl,
  controlsCivic,
  executeCivicDecree,
  computeMonopolies,
  isEmergencyJamActive,
} from "./civics.js";

export { newPlayer } from "./player.js";

const HUNDRED: Fixed = fromInt(100);
const FIFTY: Fixed = fromInt(50);

/** ticks per second at the canonical 100ms tick */
const TPS = 10;

/**
 * Hard caps on client-supplied array intents (§33 hardening). The sim is
 * defensive by construction, but unbounded arrays would let a hostile client
 * force O(n) work 20×/s; legitimate use is far below these. A click-front is
 * 25 tiles; a van path only needs its endpoints.
 */
const MAX_FRONT_TILES = 128;
const MAX_PATH_TILES = 1024;

/** Ritual/ability tuning (§9, §11.1). ITVs; promote to balance.json when tuned. */
export const KIT = {
  sermon: { cooldown: 30 * TPS, faithGain: 12, buffTicks: 20 * TPS },
  festival: { cost: 25, cooldown: 120 * TPS, radius: 10, durTicks: 30 * TPS, heat: 8 },
  offering: {
    faithCost: 10,
    followerCost: 200,
    faithGain: 20,
    cooldown: 90 * TPS,
    dissent: 4,
    heat: 5,
  },
  atonement: { cost: 20, cooldown: 180 * TPS, durTicks: 30 * TPS },
  streetProphet: { cost: 12_000, cooldown: 45 * TPS, durTicks: 30 * TPS },
  stockpileSermon: { cost: 30, cooldown: 90 * TPS, durTicks: 12 * TPS, afterDissent: 10 },
  prophecy: {
    minTiles: 1500,
    /** dev-scale fallback: 10% of populated if the map is smaller than spec */
    minShareOfPopulated: 0.1,
    durTicks: 180 * TPS,
    heat: 15,
    winFaith: 30,
    failFaith: 40,
    failApostasyPct: 15,
    failDissent: 20,
    /** High-S band floor for the rapture flip */
    highS: 65,
    capShareOfMap: 0.12,
    borderRange: 4,
  },
  // §11.2 Radiant Path
  juiceCleanse: { cost: 20_000, cooldown: 60 * TPS },
  retreat: { cost: 35_000, cooldown: 90 * TPS, radius: 8, durTicks: 25 * TPS },
  // §11.3 Prosperity Circle
  seminarBlitz: { cost: 60_000, cooldown: 75 * TPS, followers: 2_500 },
  hostileAcquisition: { cost: 300_000, cooldown: 240 * TPS, maxTiles: 120 },
  // §11.4 Visitors' Fellowship
  cropCircle: { cost: 15_000, cooldown: 60 * TPS, durTicks: 60 * TPS },
  radioStatic: { faithCost: 20, cooldown: 90 * TPS, radius: 12, durTicks: 20 * TPS },
  saucerLanding: { cost: 25_000, cooldown: 150 * TPS, capBonus: 2_000 },
  agent: { cost: 6_000, maxAlive: 2 },
  van: { cost: 30_000 },
} as const;

export interface PlayerSpawn {
  id: PlayerId;
  archetype: PlayerState["archetype"];
}

/** Build an empty world. Mapgen (mapgen.ts) fills terrain/district/S; tests fill by hand. */
export function createWorld(width: number, height: number): World {
  const n = width * height;
  return {
    width,
    height,
    terrain: new Uint8Array(n),
    state: new Uint8Array(n),
    owner: new Uint32Array(n),
    susceptibility: new Int32Array(n),
    dissent: new Int32Array(n),
    scarTicks: new Uint16Array(n),
    district: new Uint32Array(n),
    districtCoeffs: [{ conv: ONE, retain: ONE, income: ONE }],
    pop: new Uint8Array(n),
    lot: new Uint8Array(n),
    landmark: new Uint8Array(n),
    holdTicks: new Uint16Array(n),
    flags: new Uint8Array(n),
    townName: "Mundane Falls",
    streets: [],
    biome: new Uint8Array(n),
    property: new Uint32Array(n),
  };
}

/** Construct a fresh, deterministic SimState. */
export function createSim(opts: {
  seed: number;
  balance: Balance;
  world: World;
  spawns: PlayerSpawn[];
  /** domination threshold in per-mille; default 720 (72%, S/M maps §1) */
  dominationPermille?: number;
  /** match timer in ticks; default 12 min (S map §1); 0 = untimed */
  timerTicks?: number;
  /** Revelation mode (§18/§19): alternate victory paths active */
  revelationMode?: boolean;
  disableCouriers?: boolean;
  disableCPA?: boolean;
  disableSchisms?: boolean;
  /** FOUNDING spawn-pick window in ticks (§18); 0 = skip straight to LIVE */
  foundingTicks?: number;
}): SimState {
  const rng: RngState = seedRng(opts.seed);
  let populated = 0;
  let totalPop = 0;
  for (let t = 0; t < opts.world.terrain.length; t++) {
    if (opts.world.terrain[t] === Terrain.Citizen) populated++;
    totalPop += opts.world.pop[t]!;
  }
  return {
    tick: 0,
    rng,
    world: opts.world,
    players: opts.spawns.map((s) => newPlayer(s.id, s.archetype, opts.balance)),
    fronts: [],
    nextFrontId: 1,
    progress: new Map(),
    populated,
    totalPop,
    dominationPermille: opts.dominationPermille ?? 720,
    timerTicks: opts.timerTicks ?? 12 * 60 * TPS,
    status: MatchStatus.Live,
    winner: 0,
    pylons: [],
    districtBuffs: [],
    auras: [],
    prophecies: [],
    activeDecrees: [],
    revelationMode: opts.revelationMode ?? false,
    disableCouriers: opts.disableCouriers ?? false,
    disableCPA: opts.disableCPA ?? false,
    disableSchisms: opts.disableSchisms ?? false,
    buildings: [],
    couriers: [],
    vans: [],
    agents: [],
    strikes: [],
    nextEntityId: 1,
    alliances: [],
    allianceOffers: [],
    grudges: [],
    scandals: [],
    cropCircles: [],
    pickets: [],
    raidLockouts: {},
    nextSplinterId: 900,
    cpaNextPicketTick: 0,
    cpaNextBusTick: 0,
    foundingTicksLeft: opts.foundingTicks ?? 0,
    recap: { betrayals: [], scandals: [], schisms: [], prophecies: [] },
  };
}

/** Follower cap: cap_base + cap_per_compound × compounds + 2,000 per satellite (§3.1, §11.4). */
export function followerCap(p: PlayerState, b: Balance, s?: SimState): Fixed {
  let cap = add(b.economy.capBase, mul(b.economy.capPerCompound, fromInt(p.compounds)));
  if (s) {
    for (const bd of s.buildings) {
      if (bd.type === "satellite" && bd.player === p.id) {
        cap = add(cap, fromInt(KIT.saucerLanding.capBonus));
      }
    }
    // CROWDING (§18 rev.): a flock needs land. When the compound grounds run
    // out of free parcel tiles, the cap sags until more property is bought.
    const stats = propertyStats(s, p.id);
    if (stats.tiles > 0 && stats.free < b.property.crowdingFreeTiles) {
      cap = mul(cap, b.property.crowdingCapMult);
    }
  }
  return cap;
}

/** Ritual Faith cost after Fairground festival 50% (§12). */
function ritualFaithCost(s: SimState, p: PlayerState, base: number, festival = false): Fixed {
  let cost = fromInt(base);
  if (festival && ownsLandmark(s, p.id, Landmark.Fairground)) cost = mul(cost, fp(0.5));
  return cost;
}

/** Compound cost: $15,000 × 1.35^(existing compounds − 1); the first is free (§6). */
export function compoundCost(p: PlayerState): Fixed {
  let cost = fromInt(15000);
  const growth = fp(1.35);
  for (let i = 1; i < p.compounds; i++) cost = mul(cost, growth);
  return cost;
}

/** Heat gain via archetype coeff + E3 Clean Image (centralized in entities.ts). */
const gainHeat = gainHeatScaled;

function onCooldown(p: PlayerState, key: string): boolean {
  return (p.cooldowns[key] ?? 0) > 0;
}

function startCooldown(p: PlayerState, key: string, ticks: number): void {
  p.cooldowns[key] = ticks;
}

/** Claim a radius-`r` blob of neutral citizen tiles around `center` for `pid`. */
/** Terrain a land parcel can claim (wilderness incl. farmland + woods). */
function claimableTerrain(tr: number): boolean {
  return (
    tr === Terrain.Grass ||
    tr === Terrain.Field ||
    tr === Terrain.Orchard ||
    tr === Terrain.Pasture ||
    tr === Terrain.Woods
  );
}

/**
 * Claim a (2r+1)² PROPERTY parcel around `center` (§18 rev.): every claimable,
 * unowned tile becomes the player's land; woods inside are auto-felled — the
 * lot is cleared for construction. Returns tiles claimed.
 */
function claimParcel(s: SimState, pid: PlayerId, center: TileId, r: number): number {
  const w = s.world;
  const cx = center % w.width;
  const cy = (center / w.width) | 0;
  let claimed = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 1 || y < 1 || x >= w.width - 1 || y >= w.height - 1) continue;
      const t = y * w.width + x;
      if (w.property[t] !== 0 || !claimableTerrain(w.terrain[t]!)) continue;
      w.property[t] = pid;
      if (w.terrain[t] === Terrain.Woods) w.terrain[t] = Terrain.Grass; // felled
      claimed++;
    }
  }
  return claimed;
}

/**
 * Nearest tile to `want` where a parcel makes sense: claimable terrain,
 * unowned, with at least 60% of the parcel footprint claimable. Spirals out
 * deterministically so any honest click (or a bot's rough aim) lands.
 */
function findParcelAnchor(s: SimState, want: TileId, r: number): TileId {
  const w = s.world;
  const wx = want % w.width;
  const wy = (want / w.width) | 0;
  const need = Math.ceil((2 * r + 1) * (2 * r + 1) * 0.6);
  const fits = (cx: number, cy: number): boolean => {
    const t0 = cy * w.width + cx;
    if (w.property[t0] !== 0 || !claimableTerrain(w.terrain[t0]!)) return false;
    let n = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 1 || y < 1 || x >= w.width - 1 || y >= w.height - 1) continue;
        const t = y * w.width + x;
        if (w.property[t] === 0 && claimableTerrain(w.terrain[t]!)) n++;
      }
    }
    return n >= need;
  };
  for (let radius = 0; radius <= 24; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = wx + dx;
        const y = wy + dy;
        if (x < 2 || y < 2 || x >= w.width - 2 || y >= w.height - 2) continue;
        if (fits(x, y)) return y * w.width + x;
      }
    }
  }
  return -1;
}

/** Escalating land price: base × growth^parcels (§18 rev.). */
export function propertyCost(p: PlayerState, b: Balance): Fixed {
  let cost = b.property.baseCost;
  for (let i = 0; i < p.parcels; i++) cost = mul(cost, b.property.costGrowth);
  return cost;
}

/** Property occupancy for the crowding rule + the client's land readout. */
export function propertyStats(
  s: SimState,
  pid: PlayerId,
): { tiles: number; used: number; free: number } {
  const w = s.world;
  let tiles = 0;
  for (let t = 0; t < w.property.length; t++) if (w.property[t] === pid) tiles++;
  let used = 0;
  for (const bd of s.buildings) {
    if (bd.player === pid && w.property[bd.tile] === pid) used++;
  }
  return { tiles, used, free: tiles - used };
}

function claimBlob(s: SimState, pid: PlayerId, center: TileId, r: number): number {
  const w = s.world;
  const cx = center % w.width;
  const cy = (center / w.width) | 0;
  let claimed = 0;
  let joined = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
      if (dx * dx + dy * dy > r * r) continue;
      const t = y * w.width + x;
      if (w.terrain[t] !== Terrain.Citizen) continue;
      if (w.owner[t] !== NEUTRAL || w.state[t] !== TileState.Neutral) continue;
      w.owner[t] = pid;
      w.state[t] = TileState.Believer;
      claimed++;
      joined += w.pop[t]!;
    }
  }
  if (joined > 0) {
    const p = s.players.find((pl) => pl.id === pid);
    if (p) p.followers = add(p.followers, fromInt(joined));
  }
  return claimed;
}

/** Any of the player's believer lots within radius `r` of `tile`? */
function nearOwnTerritory(s: SimState, pid: PlayerId, tile: TileId, r: number): boolean {
  const w = s.world;
  const cx = tile % w.width;
  const cy = (tile / w.width) | 0;
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= w.height) continue;
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= w.width) continue;
      if (dx * dx + dy * dy > r * r) continue;
      if (w.owner[y * w.width + x] === pid) return true;
    }
  }
  return false;
}

/** Add dissent to every owned-or-not citizen tile of a district. */
function addDistrictDissent(w: World, district: DistrictId, amount: number): void {
  const amt = fromInt(amount);
  for (let t = 0; t < w.district.length; t++) {
    if (w.district[t] !== district || w.terrain[t] !== Terrain.Citizen) continue;
    w.dissent[t] = min(add(w.dissent[t]!, amt), HUNDRED);
  }
}

function applyRitual(s: SimState, p: PlayerState, b: Balance, intent: Intent): void {
  if (intent.t !== IntentType.RITUAL) return;
  switch (intent.ritual) {
    case "sermon": {
      // §9: must be in Tend/Spread; channel modeled as cooldown for M0.
      if (p.stance === Stance.Crusade || onCooldown(p, "sermon")) return;
      const hasCanopy = computeMonopolies(s, p.id).sacredCanopy;
      const faithGain = hasCanopy ? Math.floor(KIT.sermon.faithGain * 1.5) : KIT.sermon.faithGain;
      const buffTicks = hasCanopy ? Math.floor(KIT.sermon.buffTicks * 1.5) : KIT.sermon.buffTicks;
      p.faith = clamp(add(p.faith, fromInt(faithGain)), 0, HUNDRED);
      p.sermonBuffTicks = buffTicks;
      startCooldown(p, "sermon", KIT.sermon.cooldown);
      return;
    }
    case "midnight_festival": {
      const cost = ritualFaithCost(s, p, KIT.festival.cost, true); // Fairground 50% (§12)
      if (onCooldown(p, "festival") || p.faith < cost) return;
      const tile = intent.tile ?? -1;
      if (tile < 0 || tile >= s.world.terrain.length) return;
      p.faith = sub(p.faith, cost);
      const radius = ownsLandmark(s, p.id, Landmark.Fairground)
        ? Math.floor(KIT.festival.radius * 1.5) // Fairground +50% radius (§12)
        : KIT.festival.radius;
      s.auras.push({
        player: p.id,
        tile,
        radius,
        ticksLeft: KIT.festival.durTicks,
        kind: "festival",
      });
      gainHeat(p, b, KIT.festival.heat);
      startCooldown(p, "festival", KIT.festival.cooldown);
      return;
    }
    case "the_offering": {
      if (
        onCooldown(p, "offering") ||
        p.faith < fromInt(KIT.offering.faithCost) ||
        p.followers < fromInt(KIT.offering.followerCost)
      )
        return;
      // pay 10 Faith + 200 followers; gain +20 Faith (cartoon poof + halo, always)
      p.faith = clamp(
        add(sub(p.faith, fromInt(KIT.offering.faithCost)), fromInt(KIT.offering.faithGain)),
        0,
        HUNDRED,
      );
      p.followers = sub(p.followers, fromInt(KIT.offering.followerCost));
      const district =
        intent.district ?? (intent.tile !== undefined ? s.world.district[intent.tile]! : 0);
      // B3 Curfews: own-action dissent −40% (§10); integer math keeps it exact
      const dAmt = Math.floor((KIT.offering.dissent * toFloatlessPct(ownDissentMult(p))) / 100);
      if (district > 0) addDistrictDissent(s.world, district, dAmt);
      gainHeat(p, b, KIT.offering.heat);
      startCooldown(p, "offering", KIT.offering.cooldown);
      return;
    }
    case "day_of_atonement": {
      if (onCooldown(p, "atonement") || p.faith < fromInt(KIT.atonement.cost)) return;
      p.faith = sub(p.faith, fromInt(KIT.atonement.cost));
      p.atonementTicks = KIT.atonement.durTicks;
      startCooldown(p, "atonement", KIT.atonement.cooldown);
      return;
    }
  }
}

function applyAbility(s: SimState, p: PlayerState, b: Balance, intent: Intent): void {
  if (intent.t !== IntentType.ABILITY) return;
  switch (intent.ability) {
    case "street_prophet": {
      // §11.1 Final Dawn active 1: fear-pressure pylon.
      if (p.archetype !== "dawn") return;
      if (onCooldown(p, "street_prophet") || p.usd < fromInt(KIT.streetProphet.cost)) return;
      const t = intent.target ?? -1;
      if (t < 0 || t >= s.world.terrain.length || s.world.terrain[t] !== Terrain.Citizen) return;
      p.usd = sub(p.usd, fromInt(KIT.streetProphet.cost));
      s.pylons.push({ player: p.id, tile: t, ticksLeft: KIT.streetProphet.durTicks });
      startCooldown(p, "street_prophet", KIT.streetProphet.cooldown);
      return;
    }
    case "stockpile_sermon": {
      // §11.1 Final Dawn active 2: one contested district, pressure ×3 for 12s.
      if (p.archetype !== "dawn") return;
      if (onCooldown(p, "stockpile_sermon") || p.faith < fromInt(KIT.stockpileSermon.cost)) return;
      const t = intent.target ?? -1;
      if (t < 0 || t >= s.world.district.length) return;
      const district = s.world.district[t]!;
      if (district === 0) return;
      p.faith = sub(p.faith, fromInt(KIT.stockpileSermon.cost));
      s.districtBuffs.push({ player: p.id, district, ticksLeft: KIT.stockpileSermon.durTicks });
      startCooldown(p, "stockpile_sermon", KIT.stockpileSermon.cooldown);
      return;
    }

    case "juice_cleanse": {
      // §11.2 Radiant active 1: zero one district's dissent.
      if (p.archetype !== "radiant") return;
      if (onCooldown(p, "juice_cleanse") || p.usd < fromInt(KIT.juiceCleanse.cost)) return;
      const t = intent.target ?? -1;
      if (t < 0 || t >= s.world.district.length) return;
      const district = s.world.district[t]!;
      if (district === 0) return;
      p.usd = sub(p.usd, fromInt(KIT.juiceCleanse.cost));
      const w = s.world;
      for (let i = 0; i < w.district.length; i++) {
        if (w.district[i] === district && w.owner[i] === p.id) w.dissent[i] = 0;
      }
      startCooldown(p, "juice_cleanse", KIT.juiceCleanse.cooldown);
      return;
    }

    case "free_retreat_weekend": {
      // §11.2 Radiant active 2: radius-8 love-bomb, zero Heat. E1 discounts.
      if (p.archetype !== "radiant") return;
      const cost = mul(fromInt(KIT.retreat.cost), loveBombCostMult(p));
      if (onCooldown(p, "retreat") || p.usd < cost) return;
      const t = intent.target ?? -1;
      if (t < 0 || t >= s.world.terrain.length) return;
      p.usd = sub(p.usd, cost);
      s.auras.push({
        player: p.id,
        tile: t,
        radius: KIT.retreat.radius,
        ticksLeft: KIT.retreat.durTicks,
        kind: "retreat",
      });
      startCooldown(p, "retreat", KIT.retreat.cooldown);
      return;
    }

    case "seminar_blitz": {
      // §11.3 Circle active 1: the only money→manpower conversion in the game.
      if (p.archetype !== "circle") return;
      if (onCooldown(p, "seminar_blitz") || p.usd < fromInt(KIT.seminarBlitz.cost)) return;
      p.usd = sub(p.usd, fromInt(KIT.seminarBlitz.cost));
      const cap = followerCap(p, b, s);
      p.followers = min(add(p.followers, fromInt(KIT.seminarBlitz.followers)), cap);
      startCooldown(p, "seminar_blitz", KIT.seminarBlitz.cooldown);
      return;
    }

    case "hostile_acquisition": {
      // §11.3 Circle active 2: buy a neutral sub-region (≤120 tiles) outright.
      if (p.archetype !== "circle") return;
      if (onCooldown(p, "hostile_acquisition") || p.usd < fromInt(KIT.hostileAcquisition.cost))
        return;
      const t = intent.target ?? -1;
      const w = s.world;
      if (t < 0 || t >= w.owner.length) return;
      if (w.owner[t] !== NEUTRAL || w.terrain[t] !== Terrain.Citizen) return;
      p.usd = sub(p.usd, fromInt(KIT.hostileAcquisition.cost));
      // BFS neutral tiles of the target's district, capped
      const district = w.district[t]!;
      const queue = [t];
      const seen = new Set<number>([t]);
      let bought = 0;
      while (queue.length > 0 && bought < KIT.hostileAcquisition.maxTiles) {
        const cur = queue.shift()!;
        if (w.owner[cur] === NEUTRAL && w.state[cur] === TileState.Neutral) {
          w.owner[cur] = p.id;
          w.state[cur] = TileState.Believer;
          bought++;
        }
        const x = cur % w.width;
        const y = (cur / w.width) | 0;
        for (const n of [
          y > 0 ? cur - w.width : -1,
          x > 0 ? cur - 1 : -1,
          x < w.width - 1 ? cur + 1 : -1,
          y < w.height - 1 ? cur + w.width : -1,
        ]) {
          if (n < 0 || seen.has(n)) continue;
          if (w.district[n] !== district || w.terrain[n] !== Terrain.Citizen) continue;
          if (w.owner[n] !== NEUTRAL) continue;
          seen.add(n);
          queue.push(n);
        }
      }
      p.ownedTiles += bought;
      startCooldown(p, "hostile_acquisition", KIT.hostileAcquisition.cooldown);
      return;
    }

    case "crop_circle": {
      // §11.4 Visitors active 1: +30 S on a district, for EVERYONE (bait/gift/trap).
      if (p.archetype !== "visitors") return;
      if (onCooldown(p, "crop_circle") || p.usd < fromInt(KIT.cropCircle.cost)) return;
      const t = intent.target ?? -1;
      if (t < 0 || t >= s.world.district.length) return;
      const district = s.world.district[t]!;
      if (district === 0) return;
      p.usd = sub(p.usd, fromInt(KIT.cropCircle.cost));
      s.cropCircles.push({ district, ticksLeft: KIT.cropCircle.durTicks });
      startCooldown(p, "crop_circle", KIT.cropCircle.cooldown);
      return;
    }

    case "radio_static": {
      // §11.4 Visitors active 2: enemy Broadcast Towers offline 20s.
      if (p.archetype !== "visitors") return;
      if (onCooldown(p, "radio_static") || p.faith < fromInt(KIT.radioStatic.faithCost)) return;
      const t = intent.target ?? -1;
      if (t < 0 || t >= s.world.owner.length) return;
      p.faith = sub(p.faith, fromInt(KIT.radioStatic.faithCost));
      const r2 = KIT.radioStatic.radius * KIT.radioStatic.radius;
      const w = s.world;
      const tx = t % w.width;
      const ty = (t / w.width) | 0;
      for (const bd of s.buildings) {
        if (bd.player === p.id) continue;
        if (bd.type !== "broadcast_tower") continue;
        const bx = bd.tile % w.width;
        const by = (bd.tile / w.width) | 0;
        if ((bx - tx) * (bx - tx) + (by - ty) * (by - ty) <= r2) {
          bd.disabledTicks = Math.max(bd.disabledTicks, KIT.radioStatic.durTicks);
        }
      }
      startCooldown(p, "radio_static", KIT.radioStatic.cooldown);
      return;
    }

    case "saucer_landing": {
      // §11.4 Visitors SIGNATURE: satellite chapel on ANY tile, even across water.
      if (p.archetype !== "visitors") return;
      if (onCooldown(p, "saucer_landing") || p.usd < fromInt(KIT.saucerLanding.cost)) return;
      const t = intent.target ?? -1;
      const w = s.world;
      if (t < 0 || t >= w.owner.length) return;
      if (w.terrain[t] !== Terrain.Citizen || w.owner[t] !== NEUTRAL) return;
      if (w.state[t] !== TileState.Neutral) return;
      p.usd = sub(p.usd, fromInt(KIT.saucerLanding.cost));
      w.owner[t] = p.id;
      w.state[t] = TileState.Believer;
      p.followers = add(p.followers, fromInt(w.pop[t]!)); // the household looks up
      p.ownedTiles++;
      s.buildings.push({
        id: s.nextEntityId++,
        player: p.id,
        type: "satellite",
        tile: t,
        buildTicksLeft: 0,
        disabledTicks: 0,
      });
      carveDirtLane(w, t); // pilgrims need a way in
      startCooldown(p, "saucer_landing", KIT.saucerLanding.cooldown);
      return;
    }
  }
}

function applySignature(s: SimState, p: PlayerState, b: Balance): void {
  // §11.1 Final Dawn SIGNATURE — Prophecy Countdown. Other signatures land
  // with their archetype kits (Radiant=Labs, Circle=Ledger, Visitors=Saucer).
  if (p.archetype !== "dawn" || p.prophecyUsed) return;
  const minTiles = Math.min(
    KIT.prophecy.minTiles,
    Math.max(1, Math.floor(s.populated * KIT.prophecy.minShareOfPopulated)),
  );
  if (p.ownedTiles < minTiles) return;
  p.prophecyUsed = true;
  gainHeat(p, b, KIT.prophecy.heat);
  s.prophecies.push({
    player: p.id,
    snapshotPermille: Math.floor((p.ownedTiles * 1000) / Math.max(1, s.populated)),
    ticksLeft: KIT.prophecy.durTicks,
  });
}

/** Apply a single validated intent. Mutating, deterministic, no I/O. */
export function applyIntent(s: SimState, intent: Intent, b: Balance): void {
  const p = s.players.find((pl) => pl.id === intent.player);
  if (!p || !p.alive) return;
  switch (intent.t) {
    case IntentType.SET_STANCE:
      if (!isEmergencyJamActive(s, p.id)) {
        p.stance = intent.stance;
      }
      break;

    case IntentType.CIVIC_DECREE:
      executeCivicDecree(s, p.id, intent.decree, b, followerCap(p, b, s));
      break;

    case IntentType.SPAWN: {
      // FOUNDING (§18 rev.): the cult BUYS PROPERTY in the open country —
      // a parcel of land outside town, cleared of trees, with the First
      // Compound already standing and the founding congregation bused in
      // (start_followers). From there it's conversion warfare.
      if (p.spawned) break;
      const r = b.property.parcelRadius;
      const anchor = findParcelAnchor(s, intent.tile, r);
      if (anchor < 0) {
        // On a real map a click with no parcel anchor (deep in town, on
        // water…) is simply REJECTED — the founding prompt keeps asking and
        // the player picks again. The classic congregation-blob founding
        // survives ONLY for degenerate hand-built test grids, where there is
        // no open country at all: a blob spawn on a real map left the player
        // "bused in" with no compound, no land, and no vision.
        if (s.world.width <= 32) {
          const claimed = claimBlob(s, p.id, intent.tile, 3);
          if (claimed > 0) {
            p.ownedTiles += claimed;
            p.spawned = true;
          }
        }
        break;
      }
      claimParcel(s, p.id, anchor, r);
      p.parcels = 1;
      s.buildings.push({
        id: s.nextEntityId++,
        player: p.id,
        type: "compound",
        tile: anchor,
        buildTicksLeft: 0, // the First Compound comes with the land (§3.1)
        disabledTicks: 0,
      });
      carveDirtLane(s.world, anchor); // pilgrims need a way in
      p.spawned = true;
      break;
    }

    case IntentType.BUY_PROPERTY: {
      // Expansion land (§18 rev.): escalating price, must adjoin the empire.
      const w = s.world;
      const t = intent.tile;
      if (t < 0 || t >= w.property.length) break;
      if (w.property[t] !== 0 || !claimableTerrain(w.terrain[t]!)) break;
      // linked expansion: within reach of existing property or a building
      const maxD = b.property.maxLinkDist;
      const tx = t % w.width;
      const ty2 = (t / w.width) | 0;
      let linked = false;
      for (let dy = -maxD; dy <= maxD && !linked; dy++) {
        const y = ty2 + dy;
        if (y < 0 || y >= w.height) continue;
        for (let dx = -maxD; dx <= maxD && !linked; dx++) {
          const x = tx + dx;
          if (x < 0 || x >= w.width) continue;
          if (w.property[y * w.width + x] === p.id) linked = true;
        }
      }
      if (!linked) break;
      const cost = propertyCost(p, b);
      if (p.usd < cost) break;
      const anchor = findParcelAnchor(s, t, b.property.parcelRadius);
      if (anchor < 0) break;
      p.usd = sub(p.usd, cost);
      claimParcel(s, p.id, anchor, b.property.parcelRadius);
      p.parcels++;
      break;
    }

    case IntentType.OPEN_FRONT: {
      // Commit toward a target region (§4.1). Tiles are length-capped (a hostile
      // client must not be able to ship a giant array 20×/s, §33 rate limit),
      // deduped, sorted, and bounds-checked; eligibility (adjacency,
      // convertibility) is re-checked every tick by resolveConversion, so stale
      // fronts are harmless.
      const w = s.world;
      const tiles = [...new Set(intent.tiles.slice(0, MAX_FRONT_TILES))]
        .filter((t) => t >= 0 && t < w.owner.length)
        .sort((a, z) => a - z);
      if (tiles.length === 0) break;
      s.fronts.push({ id: s.nextFrontId++, player: p.id, tiles });
      break;
    }

    case IntentType.CLOSE_FRONT: {
      const idx = s.fronts.findIndex((f) => f.id === intent.front && f.player === p.id);
      if (idx >= 0) s.fronts.splice(idx, 1);
      break;
    }

    case IntentType.BUILD: {
      // Full §6 table. Satellites are placed by the Saucer ability, not BUILD.
      // Compounds rise on owned lots OR in the open country near your flock —
      // wilderness builds auto-carve a dirt access road (OpenFront-style).
      const type = intent.building as Building["type"];
      const def = BUILDING_DEFS[type];
      if (!def || type === "satellite") break;
      if (def.archetype && p.archetype !== def.archetype) break;
      if (countBuildings(s, p.id, type) >= def.max) break;
      const w = s.world;
      const t = intent.tile;
      if (t < 0 || t >= w.owner.length) break;
      const onOwnedLot = w.owner[t] === p.id && w.terrain[t] === Terrain.Citizen;
      // Wilderness construction happens on YOUR LAND (§18 rev.): the tile must
      // be property you bought. Woods on the lot are felled by the build.
      const inWilderness = claimableTerrain(w.terrain[t]!) && w.property[t] === p.id;
      if (!onOwnedLot && !inWilderness) break;
      if (s.buildings.some((bd) => bd.tile === t)) break; // 1 per tile (§6)
      const cost = buildingCost(s, p.id, type);
      if (p.usd < cost) break;
      p.usd = sub(p.usd, cost);
      s.buildings.push({
        id: s.nextEntityId++,
        player: p.id,
        type,
        tile: t,
        buildTicksLeft: def.buildTicks,
        disabledTicks: 0,
      });
      if (inWilderness) {
        w.terrain[t] = Terrain.Grass; // stake the lot (fields/woods cleared)
        // construction fells the trees crowding the site (§2 rev. 3)
        for (const n of [t - 1, t + 1, t - w.width, t + w.width]) {
          if (n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Woods && w.property[n] === p.id) {
            w.terrain[n] = Terrain.Grass;
          }
        }
        carveDirtLane(w, t); // the access road auto-generates
      }
      if (type === "compound") p.compounds++;
      break;
    }

    case IntentType.CANCEL_BUILD: {
      // 50% refund while still under construction (§6).
      const idx = s.buildings.findIndex(
        (bd) => bd.tile === intent.tile && bd.player === p.id && bd.buildTicksLeft > 0,
      );
      if (idx < 0) break;
      const bd = s.buildings[idx]!;
      // refund half of the *current* price tier — close enough, and simple
      const refund = div(buildingCost(s, p.id, bd.type), fromInt(2));
      if (bd.type === "compound" && p.compounds > 0) p.compounds--;
      s.buildings.splice(idx, 1);
      p.usd = add(p.usd, refund);
      break;
    }

    case IntentType.VAN_MOVE: {
      // Buy/route a Recruitment Van (§7). `van` < 0 buys a new one.
      const capacity = vanCapacity(s, p.id);
      const mine = s.vans.filter((v) => v.player === p.id);
      const w = s.world;
      // Only the endpoints matter (linePath re-routes); cap before filtering so
      // a giant path array can't force unbounded work.
      const path = intent.path.slice(0, MAX_PATH_TILES).filter((t) => t >= 0 && t < w.owner.length);
      if (path.length === 0) break;
      if (intent.van >= 0) {
        const v = mine.find((vv) => vv.id === intent.van);
        if (!v) break;
        v.path = linePath(w, v.tile, path[path.length - 1]!);
        v.idx = 0;
        v.moveProgress = 0;
      } else {
        if (mine.length >= capacity || p.usd < fromInt(KIT.van.cost)) break;
        p.usd = sub(p.usd, fromInt(KIT.van.cost));
        const start = path[0]!;
        s.vans.push({
          id: s.nextEntityId++,
          player: p.id,
          tile: start,
          path: linePath(w, start, path[path.length - 1]!),
          idx: 0,
          moveProgress: 0,
        });
      }
      break;
    }

    case IntentType.AGENT_DISPATCH: {
      // §13/§15.2: $6,000, max 2 alive.
      const alive = s.agents.filter((a) => a.player === p.id).length;
      if (alive >= KIT.agent.maxAlive || p.usd < fromInt(KIT.agent.cost)) break;
      p.usd = sub(p.usd, fromInt(KIT.agent.cost));
      dispatchAgent(s, p, intent.district, intent.mission);
      break;
    }

    case IntentType.STRIKE: {
      // §8: needs a free Broadcast Tower; pay up front; charge → warn → land.
      const def = STRIKE_DEFS[intent.strike];
      if (!def) break;
      if (!freeBroadcastTower(s, p.id)) break;
      const w = s.world;
      const t = intent.target;
      if (t < 0 || t >= w.owner.length) break;
      const victim = w.owner[t]!;
      if (victim === NEUTRAL || victim === p.id) break;
      let cost = mul(fromInt(def.cost), strikeCostMult(p)); // I3 −20% (§10)
      if (ownsLandmark(s, p.id, Landmark.RadioTower)) cost = mul(cost, fp(0.7)); // §12
      if (p.usd < cost) break;
      p.usd = sub(p.usd, cost);
      s.strikes.push({
        id: s.nextEntityId++,
        player: p.id,
        type: intent.strike,
        target: t,
        victim,
        chargeTicksLeft: def.chargeTicks,
        warningTicksLeft: WARNING_TICKS,
      });
      break;
    }

    case IntentType.DOCTRINE_PICK:
      pickDoctrine(p, intent.node);
      break;

    case IntentType.ALLY_PROPOSE:
      proposeAlliance(s, p.id, intent.target);
      break;

    case IntentType.ALLY_ACCEPT:
      acceptAlliance(s, p.id, intent.target);
      break;

    case IntentType.ALLY_BREAK:
      breakAlliance(s, p.id, intent.target);
      break;

    case IntentType.PUBLISH_SCANDAL:
      publishScandal(s, p, intent.target, b);
      break;

    case IntentType.RITUAL:
      applyRitual(s, p, b, intent);
      break;

    case IntentType.ABILITY:
      applyAbility(s, p, b, intent);
      break;

    case IntentType.SIGNATURE:
      applySignature(s, p, b);
      break;

    case IntentType.SURRENDER:
      p.alive = false;
      break;

    case IntentType.PACT_PICK: {
      // Ecumenical Pact (§16): share one doctrine node you OWN with your
      // ally — they enjoy its effect while the alliance holds. Re-picking
      // replaces the previous gift.
      const al = s.alliances.find((x) => x.a === p.id || x.b === p.id);
      if (!al) break;
      const allyId = al.a === p.id ? al.b : al.a;
      const ally = s.players.find((pl) => pl.id === allyId);
      if (!ally || !ally.alive) break;
      if (!p.doctrine.includes(intent.node)) break; // only share what you own
      ally.pactNode = intent.node;
      ally.pactWith = p.id;
      break;
    }

    // CHAT/EMOTE are relayed by the server, never simulated.
    default:
      break;
  }
}

/**
 * Per-tick economy + decay (§3). Pure fixed-point, RNG-free, order-stable.
 * Iterates players in id order so the result never depends on array shuffling.
 */
function stepEconomy(s: SimState, b: Balance): void {
  const dt = b.dt;
  const w = s.world;
  const civics = computeCivicControl(s); // key-building takeovers (§13 rev.)

  // Per-owner aggregates over owned tiles: income coeff sum + dissent sum.
  const incomeSum = new Map<PlayerId, Fixed>();
  const dissentSum = new Map<PlayerId, Fixed>();
  for (let t = 0; t < w.owner.length; t++) {
    const o = w.owner[t]!;
    if (o === NEUTRAL || w.state[t] !== TileState.Believer) continue;
    const dc = w.districtCoeffs[w.district[t]!] ?? { conv: ONE, retain: ONE, income: ONE };
    // Prosperity Circle Downline: creep-flipped tiles pay 2× tithe forever (§11.3)
    const income =
      (w.flags[t]! & TileFlag.Downline) !== 0 ? mul(dc.income, fromInt(2)) : dc.income;
    incomeSum.set(o, add(incomeSum.get(o) ?? 0, income));
    dissentSum.set(o, add(dissentSum.get(o) ?? 0, w.dissent[t]!));
  }

  for (const p of s.players) {
    if (!p.alive) continue;

    // Followers — logistic growth (§3.1). faith_growth_mod = 0.8 + Faith/250.
    const cap = followerCap(p, b, s);
    if (cap > 0) {
      let faithGrowthMod = add(fp(0.8), div(p.faith, fromInt(250)));
      // stance growth side-effects (§5): Tend +10%, CRUSADE −20%
      if (p.stance === Stance.Tend) faithGrowthMod = mul(faithGrowthMod, fp(1.1));
      else if (p.stance === Stance.Crusade) faithGrowthMod = mul(faithGrowthMod, fp(0.8));
      const utilization = sub(ONE, div(p.followers, cap)); // (1 − F/cap)
      let dF = mul(b.economy.followerGrowth, mul(p.followers, utilization));
      dF = mul(dF, faithGrowthMod);
      // High-school takeover: youth recruitment feeds the flock (§13 rev.)
      if (controlsCivic(civics, Lot.HighSchool, p.id)) dF = mul(dF, b.civics.highschoolGrowthMult);
      if (computeMonopolies(s, p.id).indoctrinationPipeline) dF = mul(dF, fp(1.20));
      p.followers = clamp(add(p.followers, mul(dF, dt)), 0, cap);
    }

    // Tithe (§3.2): $/sec = tithe_per_follower × F × income_avg × dissent_tax,
    // income_avg = mean district income over owned tiles; archetype income coeff.
    let incomeAvg = ONE;
    let dissentTax = ONE;
    if (p.ownedTiles > 0) {
      const n = fromInt(p.ownedTiles);
      incomeAvg = div(incomeSum.get(p.id) ?? 0, n);
      const avgDissent = div(dissentSum.get(p.id) ?? 0, n);
      dissentTax = sub(ONE, div(avgDissent, fromInt(200))); // 100 avg = half income
    }
    let tithePerSec = mul(mul(b.economy.tithePerFollower, p.followers), mul(incomeAvg, dissentTax));
    tithePerSec = mul(tithePerSec, b.archetypes[p.archetype].income);
    tithePerSec = mul(tithePerSec, titheMult(p)); // B1 Tithing Drill +10% (§10)
    const tithe = mul(tithePerSec, dt);
    p.usd = add(p.usd, tithe);
    p.usdEarned = add(p.usdEarned, tithe);

    // doctrine milestones track the high-water follower count (§10)
    p.maxFollowers = max(p.maxFollowers, p.followers);

    // Faith base drift toward 50 at ±0.05/s (§3.3); Megachurch +0.15/s (§12).
    const drift = fp(0.05);
    const hasCanopy = computeMonopolies(s, p.id).sacredCanopy;
    if (hasCanopy && p.faith < FIFTY) {
      p.faith = FIFTY;
    } else {
      if (p.faith > FIFTY) p.faith = clamp(sub(p.faith, mul(drift, dt)), FIFTY, HUNDRED);
      else if (p.faith < FIFTY) p.faith = clamp(add(p.faith, mul(drift, dt)), 0, FIFTY);
    }
    if (ownsLandmark(s, p.id, Landmark.Megachurch)) {
      p.faith = clamp(add(p.faith, mul(fp(0.15), dt)), 0, HUNDRED);
    }
    // Church takeover: the pulpit preaches for you (§13 rev.)
    if (controlsCivic(civics, Lot.Church, p.id)) {
      p.faith = clamp(add(p.faith, mul(b.civics.churchFaithPerS, dt)), 0, HUNDRED);
    }

    // Heat decay (§3.5) base −0.08/s; Town Hall extra −0.25/s (§12); crusade gain.
    let heat = p.heat;
    if (p.stance === Stance.Crusade)
      heat = add(heat, mul(mul(b.stances.crusade.heatPerS, b.archetypes[p.archetype].heat), dt));
    heat = sub(heat, mul(b.heat.decay, dt));
    if (p.atonementTicks > 0) heat = sub(heat, mul(fp(0.35), dt)); // Apology vents Heat fast!
    if (ownsLandmark(s, p.id, Landmark.TownHall)) heat = sub(heat, mul(fp(0.25), dt));
    // Sheriff takeover: complaints get lost in the filing (§13 rev.)
    if (controlsCivic(civics, Lot.Sheriff, p.id)) heat = sub(heat, mul(b.civics.sheriffHeatDecay, dt));
    p.heat = clamp(heat, 0, HUNDRED);
  }

  // Dissent decay (§3.4): −0.15/s base; Tend stance 2×; Atonement 4× (§9).
  const baseDecay = mul(fp(0.15), dt);
  const decayFor = new Map<PlayerId, Fixed>();
  for (const p of s.players) {
    let d = baseDecay;
    if (p.stance === Stance.Tend) d = mul(d, fromInt(2));
    if (p.atonementTicks > 0) d = mul(d, fromInt(4));
    decayFor.set(p.id, d);
  }
  for (let i = 0; i < w.dissent.length; i++) {
    const o = w.owner[i]!;
    if (o === NEUTRAL) continue;
    const dec = decayFor.get(o) ?? baseDecay;
    const d = (w.dissent[i]! - dec) | 0;
    w.dissent[i] = d < 0 ? 0 : d;
  }

  // Apostate scar countdown (§4.7) + Glow hold timers (§11.2) in one pass.
  for (let i = 0; i < w.scarTicks.length; i++) {
    if (w.scarTicks[i]! > 0) {
      const remaining = w.scarTicks[i]! - 1;
      w.scarTicks[i] = remaining;
      if (remaining === 0) {
        w.state[i] = TileState.Neutral;
        w.owner[i] = NEUTRAL;
      }
    } else if (w.owner[i] !== NEUTRAL && w.state[i] === TileState.Believer) {
      if (w.holdTicks[i]! < 2000) w.holdTicks[i] = w.holdTicks[i]! + 1; // cap = +80% Glow
    }
  }
}

/** Count down pylons, district buffs, auras, cooldowns, personal buff timers. */
function stepEffects(s: SimState, b: Balance): void {
  for (const p of s.players) {
    if (p.sermonBuffTicks > 0) p.sermonBuffTicks--;
    if (p.atonementTicks > 0) p.atonementTicks--;
    if (p.judasTicks > 0) p.judasTicks--;
    if (p.retentionDebuffTicks > 0) p.retentionDebuffTicks--;

    // Doctrinal victory progress (§18, Revelation): Faith pinned at 100 for
    // 90s, then a 20s uninterrupted channel at an owned Megachurch.
    if (s.revelationMode && p.alive) {
      if (p.faith >= HUNDRED) {
        p.faithHoldTicks++;
        if (p.faithHoldTicks >= 90 * TPS && ownsLandmark(s, p.id, Landmark.Megachurch)) {
          p.channelTicks++;
        } else {
          p.channelTicks = 0; // megachurch lost mid-channel = interrupted
        }
      } else {
        p.faithHoldTicks = 0;
        p.channelTicks = 0;
      }
    }
    for (const key of Object.keys(p.cooldowns).sort()) {
      const left = p.cooldowns[key]! - 1;
      if (left <= 0) delete p.cooldowns[key];
      else p.cooldowns[key] = left;
    }
  }

  for (let i = s.pylons.length - 1; i >= 0; i--) {
    if (--s.pylons[i]!.ticksLeft <= 0) s.pylons.splice(i, 1);
  }
  for (let i = s.auras.length - 1; i >= 0; i--) {
    if (--s.auras[i]!.ticksLeft <= 0) s.auras.splice(i, 1);
  }
  for (let i = s.cropCircles.length - 1; i >= 0; i--) {
    if (--s.cropCircles[i]!.ticksLeft <= 0) s.cropCircles.splice(i, 1);
  }
  for (let i = s.activeDecrees.length - 1; i >= 0; i--) {
    if (--s.activeDecrees[i]!.ticksLeft <= 0) s.activeDecrees.splice(i, 1);
  }
  // expire stale alliance offers and lapsed alliances (§16)
  for (let i = s.allianceOffers.length - 1; i >= 0; i--) {
    if (s.allianceOffers[i]!.expiresTick <= s.tick) s.allianceOffers.splice(i, 1);
  }
  for (let i = s.alliances.length - 1; i >= 0; i--) {
    if (s.alliances[i]!.expiresTick <= s.tick) s.alliances.splice(i, 1);
  }
  for (let i = s.districtBuffs.length - 1; i >= 0; i--) {
    const buff = s.districtBuffs[i]!;
    if (--buff.ticksLeft <= 0) {
      // Stockpile Sermon aftershock: +10 dissent in the district (§11.1).
      addDistrictDissent(s.world, buff.district, KIT.stockpileSermon.afterDissent);
      s.districtBuffs.splice(i, 1);
    }
  }

  resolveProphecies(s, b);
}

/** Resolve expired Prophecy Countdowns (§11.1 SIGNATURE). */
function resolveProphecies(s: SimState, b: Balance): void {
  for (let i = s.prophecies.length - 1; i >= 0; i--) {
    const pr = s.prophecies[i]!;
    if (--pr.ticksLeft > 0) continue;
    s.prophecies.splice(i, 1);
    const p = s.players.find((pl) => pl.id === pr.player);
    if (!p || !p.alive) continue;

    const nowPermille = Math.floor((p.ownedTiles * 1000) / Math.max(1, s.populated));
    if (nowPermille > pr.snapshotPermille) {
      prophecyRapture(s, p);
      p.faith = clamp(add(p.faith, fromInt(KIT.prophecy.winFaith)), 0, HUNDRED);
      s.recap.prophecies.push({ player: p.id, fulfilled: true, tick: s.tick });
    } else if (tryAbsorbMassApostasy(p)) {
      // E4 UNSHAKEABLE eats the backfire (§10)
    } else {
      s.recap.prophecies.push({ player: p.id, fulfilled: false, tick: s.tick });
      p.faith = clamp(sub(p.faith, fromInt(KIT.prophecy.failFaith)), 0, HUNDRED);
      p.followers = mul(p.followers, fp(1 - KIT.prophecy.failApostasyPct / 100));
      const w = s.world;
      const amt = fromInt(KIT.prophecy.failDissent);
      for (let t = 0; t < w.owner.length; t++) {
        if (w.owner[t] === p.id) w.dissent[t] = min(add(w.dissent[t]!, amt), HUNDRED);
      }
    }
  }
}

/** Fulfilled Prophecy: flip High-S tiles within range of borders, capped (§11.1). */
function prophecyRapture(s: SimState, p: PlayerState): void {
  const w = s.world;
  // multi-source BFS from all owned tiles, range ≤ borderRange
  const dist = new Int16Array(w.owner.length).fill(-1);
  const queue: TileId[] = [];
  for (let t = 0; t < w.owner.length; t++) {
    if (w.owner[t] === p.id && w.state[t] === TileState.Believer) {
      dist[t] = 0;
      queue.push(t);
    }
  }
  const cap = Math.max(1, Math.floor(s.populated * KIT.prophecy.capShareOfMap));
  let flipped = 0;
  const highS = fromInt(KIT.prophecy.highS);
  for (let qi = 0; qi < queue.length && flipped < cap; qi++) {
    const t = queue[qi]!;
    const d = dist[t]!;
    if (d >= KIT.prophecy.borderRange) continue;
    const x = t % w.width;
    const y = (t / w.width) | 0;
    const neighbors = [
      y > 0 ? t - w.width : -1,
      x > 0 ? t - 1 : -1,
      x < w.width - 1 ? t + 1 : -1,
      y < w.height - 1 ? t + w.width : -1,
    ];
    for (const n of neighbors) {
      if (n < 0 || dist[n] !== -1) continue;
      dist[n] = d + 1;
      queue.push(n);
      if (
        w.terrain[n] === Terrain.Citizen &&
        w.state[n] !== TileState.Apostate &&
        w.scarTicks[n] === 0 &&
        w.owner[n] !== p.id &&
        w.susceptibility[n]! >= highS &&
        flipped < cap
      ) {
        const prev = w.owner[n]!;
        if (prev !== NEUTRAL) {
          const loser = s.players.find((pl) => pl.id === prev);
          if (loser) loser.ownedTiles = Math.max(0, loser.ownedTiles - 1);
        }
        w.owner[n] = p.id;
        w.state[n] = TileState.Believer;
        p.ownedTiles++;
        flipped++;
      }
    }
  }
}

/** Victory checks, per tick, in §18 priority order; plus elimination. */
function checkVictory(s: SimState, b: Balance): void {
  if (s.status === MatchStatus.Ended) return;

  // Elimination (§18 rev.): spawned, zero tiles AND zero standing buildings.
  // A landless cult with a compound on its property is besieged, not dead —
  // the property start starts everyone at zero tiles.
  for (const p of s.players) {
    if (!p.alive || !p.spawned || p.ownedTiles > 0) continue;
    const hasBuilding = s.buildings.some((bd) => bd.player === p.id);
    if (!hasBuilding) p.alive = false;
  }

  const contenders = s.players.filter((p) => p.alive && p.spawned);

  // (1) Domination threshold — measured in SOULS, not acreage. The game is
  // about converting the town; tile share is only the fallback for popless
  // test worlds.
  if (s.totalPop > 0) {
    const w = s.world;
    const popByOwner = new Map<PlayerId, number>();
    for (let t = 0; t < w.owner.length; t++) {
      const o = w.owner[t]!;
      if (o === NEUTRAL || w.state[t] !== TileState.Believer) continue;
      popByOwner.set(o, (popByOwner.get(o) ?? 0) + w.pop[t]!);
    }
    for (const p of contenders) {
      if ((popByOwner.get(p.id) ?? 0) * 1000 >= s.totalPop * s.dominationPermille) {
        s.status = MatchStatus.Ended;
        s.winner = p.id;
        return;
      }
    }
  } else {
    for (const p of contenders) {
      if (s.populated > 0 && p.ownedTiles * 1000 >= s.populated * s.dominationPermille) {
        s.status = MatchStatus.Ended;
        s.winner = p.id;
        return;
      }
    }
  }

  // (2) Last cult standing (only meaningful once the lobby had rivals).
  if (contenders.length === 1 && s.players.filter((p) => p.spawned).length >= 2) {
    s.status = MatchStatus.Ended;
    s.winner = contenders[0]!.id;
    return;
  }

  // (3) [Revelation] Doctrinal: Faith 100 held 90s + 20s Megachurch channel (§18).
  if (s.revelationMode) {
    for (const p of contenders) {
      if (p.channelTicks >= 20 * 10) {
        s.status = MatchStatus.Ended;
        s.winner = p.id;
        return;
      }
    }
  }

  // (4) [Revelation] Economic: The Ledger — bank ≥ map target (§11.3/§18).
  if (s.revelationMode) {
    const target = fromInt(1_200_000); // S-map target; M/L wire in with map sizes
    for (const p of contenders) {
      if (p.archetype === "circle" && p.usd >= target) {
        s.status = MatchStatus.Ended;
        s.winner = p.id;
        return;
      }
    }
  }

  // (5) Timer expiry → highest tiles, then $ earned, then Faith (§1).
  if (s.timerTicks > 0 && s.tick >= s.timerTicks && contenders.length > 0) {
    let best = contenders[0]!;
    for (const p of contenders.slice(1)) {
      if (
        p.ownedTiles > best.ownedTiles ||
        (p.ownedTiles === best.ownedTiles && p.usd > best.usd) ||
        (p.ownedTiles === best.ownedTiles && p.usd === best.usd && p.faith > best.faith)
      ) {
        best = p;
      }
    }
    s.status = MatchStatus.Ended;
    s.winner = best.id;
  }
}

/** Advance the sim by one tick using a Turn's intents. Returns the same state. */
export function step(s: SimState, turn: Turn, b: Balance): SimState {
  // Fold the turn's seed slice into the RNG stream so server and client agree.
  s.rng.s3 = (s.rng.s3 ^ (turn.seedSlice >>> 0)) >>> 0;

  if (s.status === MatchStatus.Ended) {
    s.tick++;
    return s; // frozen — RECAP state (§18)
  }

  // Intents apply in their given (server-bundled) order for determinism.
  for (const intent of turn.intents) applyIntent(s, intent, b);

  // FOUNDING (§18): spawn picks land, but the town holds its breath. The
  // window counts down to its last tick, then HOLDS there until every founder
  // has broken ground — the match never begins with an unplaced player. (The
  // server auto-places bots at the window edge and AFK humans at a hard cap,
  // so the hold always resolves.)
  if (s.foundingTicksLeft > 1) {
    s.foundingTicksLeft--;
    s.tick++;
    return s;
  }
  if (s.foundingTicksLeft === 1) {
    if (s.players.every((p) => p.spawned)) s.foundingTicksLeft = 0;
    s.tick++;
    return s;
  }

  stepEconomy(s, b);
  stepBuildings(s, b); // construction, downtime, supplement labs (§6)
  if (!s.disableCouriers) stepCouriers(s, b); //  courier economy (§3.2)
  stepVans(s, b); //      vans: movement, robbery, agent screening (§7)
  stepAgents(s, b); //    raids + scandal evidence (§13, §15.2)
  resolveConversion(s, b);
  stepStrikes(s, b); //   charge → warn → land (§8)
  if (!s.disableCPA) stepCPA(s, b); //       the Concerned Parents Association (§17)
  if (!s.disableSchisms) stepSchism(s, b); //    schism risk gauge + eruption (§16)
  stepEffects(s, b);
  checkVictory(s, b);

  s.tick++;
  return s;
}

/**
 * Tiny helper to express a small literal rate as Fixed without importing the
 * float path everywhere. Boundary-only, like balance loading.
 */
function fp(n: number): Fixed {
  return Math.round(n * ONE) | 0;
}

/** Fixed multiplier → integer percent (e.g. Q(0.6) → 60). Exact integer math. */
function toFloatlessPct(m: Fixed): number {
  return Math.round((m * 100) / ONE);
}
