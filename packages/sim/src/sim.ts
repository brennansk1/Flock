/**
 * The simulation core (Part II). One `step` == one tick (100 ms, §32). Given a
 * Turn's intents and the same starting state, every machine must reach the same
 * next state — that is the lockstep contract.
 *
 * M0 systems in this file: state construction, intent application (stances,
 * spawns, missions, compounds, kit actives §11.1), the per-tick
 * economy/decay loop (§3), timed-effect countdowns, Prophecy resolution, and
 * the victory/elimination state machine (§18). Conversion resolution (§4)
 * lives in conversion.ts.
 */

import { archCoeffs } from "./balance.js";
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
  MAX_COHORTS,
  type Cohort,
  type Building,
  type PlayerState,
  type SimState,
  type World,
  type PlayerId,
  type TileId,
  type DistrictId,
} from "./types.js";
import { resolveConversion } from "./conversion.js";
import { cohortTransit, cohortArrived } from "./cohorts.js";
import { carveDirtLane } from "./mapgen.js";
import { refreshVictoryStats, stepAscension } from "./victory.js";
import { getArchetype, findAbility, DAWN_KIT, RADIANT_KIT, CIRCLE_KIT, VISITORS_KIT } from "./archetypes/index.js";
import { newPlayer } from "./player.js";
import {
  BUILDING_DEFS,
  buildingCost,
  countBuildings,
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
import { hasDoctrine, pickDoctrine, titheMult, ownDissentMult, loveBombCostMult, strikeCostMult, tryAbsorbMassApostasy } from "./doctrine.js";
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
 * Hard cap on client-supplied array intents (§33 hardening). The sim is
 * defensive by construction, but an unbounded array would let a hostile client
 * force O(n) work 20×/s; a van path only needs its endpoints. (MISSION_SEND is
 * scalar-only — its permille payload is clamped where it applies.)
 */
const MAX_PATH_TILES = 1024;

/** Ability tuning (§11.1). ITVs; promote to balance.json when tuned.
 *  (Rituals were cut in v3 M3.2b — Faith now buys doctrine directly.) */
export const KIT = {
  sermon: { faithGain: 12, buffTicks: 15 * TPS, cooldown: 30 * TPS },
  // Archetype kits live with their cults (archetypes/kits.ts); re-exposed
  // here for existing callers.
  ...DAWN_KIT,
  ...RADIANT_KIT,
  ...CIRCLE_KIT,
  ...VISITORS_KIT,
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
  /** Domination threshold in per-mille; default from balance (65%). 1000 disables. */
  dominationPermille?: number;
  /** match timer in ticks; default 12 min (S map §1); 0 = untimed */
  timerTicks?: number;
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
    progress: new Map(),
    populated,
    totalPop,
    dominationPermille: opts.dominationPermille ?? opts.balance.victory.dominationPermille,
    timerTicks: opts.timerTicks ?? 12 * 60 * TPS,
    status: MatchStatus.Live,
    winner: 0,
    pylons: [],
    districtBuffs: [],
    auras: [],
    prophecies: [],
    activeDecrees: [],
    winPath: "",
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

/** The commune tops out at stage 5 (v3 §2). `p.compounds` IS the stage: 1 at
 *  founding, up to COMMUNE_MAX_STAGE via UPGRADE_COMMUNE. */
export const COMMUNE_MAX_STAGE = 5;

/** Cost to raise the commune the NEXT stage: $15,000 × 1.35^(stage−1). Same
 *  escalation the old multi-compound build used — reused as the money sink. */
export function compoundCost(p: PlayerState): Fixed {
  let cost = fromInt(2000); // STAGE1 §6 rescale (was 15k — never affordable)
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
      if (p.stance === Stance.Crusade || onCooldown(p, "sermon")) return;
      const hasCanopy = computeMonopolies(s, p.id).sacredCanopy;
      const faithGain = hasCanopy ? Math.floor(KIT.sermon.faithGain * 1.5) : KIT.sermon.faithGain;
      const buffTicks = hasCanopy ? Math.floor(KIT.sermon.buffTicks * 1.5) : KIT.sermon.buffTicks;
      p.faith = clamp(add(p.faith, fromInt(faithGain)), 0, HUNDRED);
      p.sermonBuffTicks = buffTicks;
      startCooldown(p, "sermon", KIT.sermon.cooldown);
      return;
    }
  }
}

function applyAbility(s: SimState, p: PlayerState, b: Balance, intent: Intent): void {
  if (intent.t !== IntentType.ABILITY) return;
  const found = findAbility(intent.ability);
  if (!found || found.arch !== p.archetype) return;
  const a = found.def;
  const cost = a.cost(p);
  if (onCooldown(p, a.cooldownKey)) return;
  if (cost.usd !== undefined && p.usd < cost.usd) return;
  if (cost.faith !== undefined && p.faith < cost.faith) return;
  const ctx = { s, p, b, target: intent.target ?? -1 };
  if (!a.validate(ctx)) return;
  if (cost.usd !== undefined) p.usd = sub(p.usd, cost.usd);
  if (cost.faith !== undefined) p.faith = sub(p.faith, cost.faith);
  a.effect(ctx);
  startCooldown(p, a.cooldownKey, a.cooldownTicks);
}

function applySignature(s: SimState, p: PlayerState, b: Balance): void {
  getArchetype(p.archetype).signature?.apply(s, p, b);
}

/** Apply a single validated intent. Mutating, deterministic, no I/O. */
export function applyIntent(s: SimState, intent: Intent, b: Balance): void {
  const p = s.players.find((pl) => pl.id === intent.player);
  if (!p || !p.alive) return;
  switch (intent.t) {
    case IntentType.SET_STANCE:
      // Retired (STAGE1 §2): the per-mission mode replaced the global stance.
      // Kept in the protocol for old clients; deliberately a no-op.
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

    case IntentType.MISSION_SEND: {
      // v3 missions (DESIGN_MISSIONS.md §1): commit a slice of the flock to
      // work the town around a target. Mass is CONSERVED — it leaves the
      // home flock now and only returns when a recall completes. The inner
      // circle (20‰ floor) can never deploy: one bad minute must be a
      // setback, not an elimination.
      if (!p.spawned || !p.alive) break;
      const w = s.world;
      const tgt = intent.tile;
      if (tgt < 0 || tgt >= w.terrain.length) break;
      const mode = intent.mode;
      if (mode !== Stance.Spread && mode !== Stance.Tend && mode !== Stance.Crusade) break;
      if (p.cohorts.length >= MAX_COHORTS) break;
      const pm = Math.max(
        b.missions.minSendPermille,
        Math.min(b.missions.maxSendPermille, intent.permille | 0),
      );
      const deployed = p.cohorts.reduce((a, c) => add(a, c.mass), 0 as Fixed);
      const flockTotal = add(p.followers, deployed);
      // integer permille, rounded DOWN — the inner circle holds exactly
      const perMille = div(flockTotal, fromInt(1000));
      const deployCap = mul(perMille, fromInt(1000 - b.missions.innerCirclePermille));
      const headroom = sub(deployCap, deployed);
      const mass = min(min(mul(perMille, fromInt(pm)), headroom), p.followers);
      if (mass <= 0) break;
      p.followers = sub(p.followers, mass);
      p.cohorts.push({ target: tgt, mode, mass, age: 0, recalling: false, recallAge: 0 });
      break;
    }

    case IntentType.MISSION_RECALL: {
      const c = p.cohorts[intent.slot | 0];
      if (!c || c.recalling) break;
      c.recalling = true;
      c.recallAge = 0;
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
      const cost = buildingCost(s, p.id, type, computeCivicControl(s), b); // sawmill discount (§2A)
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

    case IntentType.UPGRADE_COMMUNE: {
      // v3 money→power loop (§2): pay to raise the commune one stage (1→5),
      // lifting the flock cap via followerCap's per-stage term. No new
      // building — the single founding commune grows in place.
      if (!p.spawned || p.compounds >= COMMUNE_MAX_STAGE) break;
      let cost = compoundCost(p);
      // Sawmill takeover (§13 rev., v3 retarget): the old "cheaper construction"
      // applied to buildings that no longer exist — lumber-at-cost now discounts
      // building UP the commune, the one thing you still construct.
      if (controlsCivic(computeCivicControl(s), Lot.Sawmill, p.id)) cost = mul(cost, b.civics.sawmillBuildMult);
      if (p.usd < cost) break;
      p.usd = sub(p.usd, cost);
      p.compounds++;
      break;
    }

    case IntentType.BUY_RECRUITS: {
      // Prosperity Gospel (§2C): a recruitment drive — cash buys flock. Adds a
      // fixed ‰ of the CURRENT flock, so the batch stays relevant as you grow
      // and its cost rises with you (a save-then-spike lever). The price is a
      // flat usd/recruit however you slice it, so no compounding exploit.
      // Universal, but Circle's income edge funds it hardest — this is what
      // finally makes `income` a live stat. Its instant-burst cousin is the
      // Circle-only seminar_blitz ability.
      if (!p.spawned) break;
      const cap = followerCap(p, b, s);
      const room = sub(cap, p.followers);
      if (room <= 0) break; // already at the cap
      // batch = ‰ of current flock, but never past the cap — and you only pay
      // for what you actually get (no charging for clamped-off recruits).
      let gained = div(mul(p.followers, fromInt(b.economy.recruitDrivePermille)), fromInt(1000));
      if (gained <= 0) break;
      if (gained > room) gained = room;
      const cost = mul(gained, b.economy.recruitCostPer);
      if (p.usd < cost) break;
      p.usd = sub(p.usd, cost);
      p.followers = add(p.followers, gained);
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
      const refund = div(buildingCost(s, p.id, bd.type, computeCivicControl(s), b), fromInt(2));
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
      // §8 strikes are a pure MONEY op in v3 (broadcast_tower cut, M3.3b) —
      // no structure gate; pay up front; charge → warn → land.
      const def = STRIKE_DEFS[intent.strike];
      if (!def) break;
      const w = s.world;
      const t = intent.target;
      if (t < 0 || t >= w.owner.length) break;
      const victim = w.owner[t]!;
      if (victim === NEUTRAL || victim === p.id) break;
      let cost = mul(fromInt(def.cost), strikeCostMult(p)); // I3 −20% (§10)
      if (ownsLandmark(s, p.id, Landmark.RadioTower)) cost = mul(cost, fp(0.7)); // §12
      if (p.usd < cost) break;
      const isDeepSpaceTransmitter =
        getArchetype(p.archetype).passives.hidesStrikeWarning?.(s, p) ?? false;
      s.strikes.push({
        id: s.nextEntityId++,
        player: p.id,
        type: intent.strike,
        target: t,
        victim,
        chargeTicksLeft: def.chargeTicks,
        warningTicksLeft: isDeepSpaceTransmitter ? 0 : WARNING_TICKS,
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

  // Per-owner aggregates over owned tiles: income coeff sum + dissent sum +
  // believer souls (v3: converted townsfolk recruit into the mobile flock).
  const incomeSum = new Map<PlayerId, Fixed>();
  const dissentSum = new Map<PlayerId, Fixed>();
  const believerPop = new Map<PlayerId, Fixed>();
  for (let t = 0; t < w.owner.length; t++) {
    const o = w.owner[t]!;
    if (o === NEUTRAL || w.state[t] !== TileState.Believer) continue;
    const dc = w.districtCoeffs[w.district[t]!] ?? { conv: ONE, retain: ONE, income: ONE };
    // Prosperity Circle Downline: creep-flipped tiles pay 2× tithe forever (§11.3)
    const income =
      (w.flags[t]! & TileFlag.Downline) !== 0 ? mul(dc.income, fromInt(2)) : dc.income;
    incomeSum.set(o, add(incomeSum.get(o) ?? 0, income));
    dissentSum.set(o, add(dissentSum.get(o) ?? 0, w.dissent[t]!));
    believerPop.set(o, add(believerPop.get(o) ?? 0, fromInt(w.pop[t]!)));
  }

  for (const p of s.players) {
    if (!p.alive) continue;

    // Followers grow from BELIEVERS (v3 §4): converted townsfolk recruit into
    // the mobile flock — territory feeds the army, closing the core loop.
    // recruits/s = (base + believerPop × per-believer) × faith/stance/civic mods.
    // A small base keeps a young cult trickling before it holds ground; the cap
    // (raised by commune stages, M3.3) is the ceiling.
    const cap = followerCap(p, b, s);
    if (cap > 0 && p.followers < cap) {
      let mod = add(fp(0.8), div(p.faith, fromInt(250))); // faith_growth_mod
      if (p.stance === Stance.Tend) mod = mul(mod, fp(1.1)); // nurture recruits better
      else if (p.stance === Stance.Crusade) mod = mul(mod, fp(0.8));
      if (archCoeffs(b, p.archetype).growth) {
        mod = mul(mod, archCoeffs(b, p.archetype).growth);
      }
      // High-school takeover: youth recruitment feeds the flock (§13 rev.)
      if (controlsCivic(civics, Lot.HighSchool, p.id)) mod = mul(mod, b.civics.highschoolGrowthMult);
      if (computeMonopolies(s, p.id).indoctrinationPipeline) mod = mul(mod, fp(1.20));
      const recruits = add(
        b.economy.baseRecruitsPerS,
        mul(believerPop.get(p.id) ?? 0, b.economy.recruitsPerBeliever),
      );
      p.followers = clamp(add(p.followers, mul(mul(recruits, mod), dt)), 0, cap);
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
    tithePerSec = mul(tithePerSec, archCoeffs(b, p.archetype).income);
    tithePerSec = mul(tithePerSec, titheMult(p)); // B1 Tithing Drill +10% (§10)
    // Economic anchor (§2A mechanics, B1.4.20): whoever holds the town's
    // granary — or the cannery that replaced it on the coast — skims the
    // harvest money. One anchor per town; the mult applies once.
    if (
      controlsCivic(civics, Lot.GrainElevator, p.id) ||
      controlsCivic(civics, Lot.Cannery, p.id)
    )
      tithePerSec = mul(tithePerSec, b.civics.anchorTitheMult);
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
    heat = sub(heat, mul(b.heat.decay, dt));
    // I4 Official Story: the story holds while you're under the radar — 2× decay below 60.
    if (hasDoctrine(p, "I4") && heat < b.heat.cpaHarass) heat = sub(heat, mul(b.heat.decay, dt));
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

    // Cohort upkeep (v3 missions, M2 travel model): the sortie marches out
    // at marchTicksPerTile from the nearest compound, works on arrival, and
    // walks the same distance home on recall — friction both ways. Crusade
    // cohorts pay attrition and stoke Heat while deployed.
    if (p.cohorts.length > 0) {
      const attr = fp(1 - b.missions.crusadeAttritionPermillePerS / 1000 / 10); // per tick
      for (const c of p.cohorts) {
        c.age++;
        if (c.recalling) c.recallAge++;
        if (!c.recalling && cohortArrived(s, p, c, b)) {
          if (c.mode === Stance.Crusade) {
            c.mass = mul(c.mass, attr); // the hard sell wears the flock down
          } else if (c.mode === Stance.Tend) {
            // Tend gathers the faithful (v3 §2): a working tend mission is the
            // Faith engine — this is how you bank conviction to buy doctrine.
            p.faith = clamp(add(p.faith, mul(b.missions.tendFaithPerS, b.dt)), 0, HUNDRED);
          }
        }
      }
      const done = (c: Cohort): boolean => c.recalling && c.recallAge >= cohortTransit(s, p, c, b);
      if (p.cohorts.some(done)) {
        for (const c of p.cohorts) if (done(c)) p.followers = add(p.followers, c.mass);
        p.cohorts = p.cohorts.filter((c) => !done(c));
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
  const stats = refreshVictoryStats(s);

  // Last cult standing (only meaningful once the lobby had rivals).
  if (contenders.length === 1 && s.players.filter((p) => p.spawned).length >= 2) {
    s.status = MatchStatus.Ended;
    s.winner = contenders[0]!.id;
    s.winPath = "last_standing";
    return;
  }

  // Every other win is an Ascension: a met path held through a public
  // countdown (victory.ts). Domination, Revelation and each cult's own path.
  if (stepAscension(s, b, contenders, stats)) return;

  // Timer expiry → most souls, then cash, then Faith.
  if (s.timerTicks > 0 && s.tick >= s.timerTicks && contenders.length > 0) {
    let best = contenders[0]!;
    for (const p of contenders.slice(1)) {
      if (
        p.soulsPermille > best.soulsPermille ||
        (p.soulsPermille === best.soulsPermille && p.usd > best.usd) ||
        (p.soulsPermille === best.soulsPermille && p.usd === best.usd && p.faith > best.faith)
      ) {
        best = p;
      }
    }
    s.status = MatchStatus.Ended;
    s.winner = best.id;
    s.winPath = "timer";
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
