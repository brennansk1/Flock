/**
 * Units & live events: Tithe Couriers, Recruitment Vans, Agents (§7),
 * Deprogramming raids (§13), Scandal evidence (§15.2), Propaganda Strikes
 * (§8), and the Concerned Parents Association (§17).
 *
 * Movement is per-tick fractional advance along a precomputed straight-line
 * path (roads give couriers/vans their speed bonus). Everything is fixed-point
 * and order-stable; the only randomness (manifesto scatter)
 * draws from the sim RNG, which lives in the hashed state.
 */

import { add, sub, mul, div, clamp, min, fromInt, fromFloat, ONE, type Fixed } from "./fixed.js";
import { nextU32, nextRange } from "./rng.js";
import type { Balance } from "./balance.js";
import {
  NEUTRAL,
  Terrain,
  TileState,
  Landmark,
  Lot,
  type AgentUnit,
  type Cohort,
  type PlayerId,
  type PlayerState,
  type SimState,
  type StrikeCharge,
  type TileId,
} from "./types.js";
import { apostatize } from "./conversion.js";
import {
  watchtowerSees,
  disableBuildingsNear,
  isOperational,
  staffingRatio,
} from "./buildings.js";
import { heatGainMult, raidEffectMultAgainst, tryAbsorbMassApostasy, scarTicksFor } from "./doctrine.js";
import { computeMonopolies, isEmergencyJamActive, controlsCivic, computeCivicControl } from "./civics.js";

const TPS = 10;
const HUNDRED = fromInt(100);

export const STRIKE_DEFS = {
  pamphlet_bomb: { cost: 400_000, chargeTicks: 30 * TPS, radius: 8, heat: 10 },
  prime_time_expose: { cost: 900_000, chargeTicks: 60 * TPS, radius: 18, heat: 20 },
  manifesto_drop: { cost: 1_600_000, chargeTicks: 90 * TPS, radius: 6, heat: 0 }, // heat→100
} as const;

export const WARNING_TICKS = 10 * TPS; // §8: 10s incoming-warning banner

// ---------------------------------------------------------------- helpers

function tileXY(w: { width: number }, t: TileId): [number, number] {
  return [t % w.width, (t / w.width) | 0];
}

/** Straight-line tile path (Bresenham), endpoints included. */
export function linePath(w: { width: number }, from: TileId, to: TileId): TileId[] {
  let [x0, y0] = tileXY(w, from);
  const [x1, y1] = tileXY(w, to);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const path: TileId[] = [y0 * w.width + x0];
  while (x0 !== x1 || y0 !== y1) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
    path.push(y0 * w.width + x0);
  }
  return path;
}

export function gainHeatScaled(p: PlayerState, b: Balance, amount: number): void {
  const gain = mul(mul(fromInt(amount), b.archetypes[p.archetype].heat), heatGainMult(p));
  p.heat = clamp(add(p.heat, gain), 0, HUNDRED);
}

function manhattan(w: { width: number }, a: TileId, t: TileId): number {
  const [ax, ay] = tileXY(w, a);
  const [tx, ty] = tileXY(w, t);
  return Math.abs(ax - tx) + Math.abs(ay - ty);
}

// ---------------------------------------------------------------- couriers

/**
 * Courier economy (§3.2): each ordered pair of a player's operational Plates
 * spawns a courier every 20s carrying $4 × route_length (cap $1,200). Visible,
 * robbable by enemy Vans.
 */
export function stepCouriers(s: SimState, b: Balance): void {
  const w = s.world;

  // spawn: every courier_interval, one courier per plate pair (i<j)
  const interval = 20 * TPS;
  if (s.tick % interval === 0) {
    const byPlayer = new Map<PlayerId, TileId[]>();
    for (const bd of s.buildings) {
      if (bd.type !== "collection_plate" || !isOperational(bd)) continue;
      if (staffingRatio(s, bd) < ONE >> 1) continue; // nobody to pass the plate (§6 staffing)
      const arr = byPlayer.get(bd.player) ?? [];
      arr.push(bd.tile);
      byPlayer.set(bd.player, arr);
    }
    for (const [pid, plates] of byPlayer) {
      plates.sort((a, z) => a - z);
      for (let i = 0; i < plates.length; i++) {
        for (let j = i + 1; j < plates.length; j++) {
          const path = linePath(w, plates[i]!, plates[j]!);
          let usd = min(
            mul(b.economy.courierPerTile, fromInt(path.length)),
            b.economy.courierCap,
          );
          const ownerPl = s.players.find((pl) => pl.id === pid);
          if (ownerPl?.archetype === "circle" && controlsCivic(computeCivicControl(s), Lot.Bank, pid)) {
            usd = mul(usd, fromInt(3)); // Franchise Megacenter: triples courier cash
          }
          s.couriers.push({
            id: s.nextEntityId++,
            player: pid,
            path,
            idx: 0,
            moveProgress: 0,
            usd,
          });
        }
      }
    }
  }

  // move: 1.5 tiles/s, 2× on roads (§7)
  for (let i = s.couriers.length - 1; i >= 0; i--) {
    const c = s.couriers[i]!;
    const onRoad = w.terrain[c.path[c.idx]!] === Terrain.Road;
    const speed = onRoad ? fromFloat(3.0) : fromFloat(1.5);
    c.moveProgress = add(c.moveProgress, mul(speed, b.dt));
    while (c.moveProgress >= ONE && c.idx < c.path.length - 1) {
      c.moveProgress = sub(c.moveProgress, ONE);
      c.idx++;
    }
    if (c.idx >= c.path.length - 1) {
      // delivered
      const p = s.players.find((pl) => pl.id === c.player);
      if (p && p.alive) {
        p.usd = add(p.usd, c.usd);
        p.usdEarned = add(p.usdEarned, c.usd);
      }
      s.couriers.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- vans

/**
 * Recruitment Vans (§7): mobile converter (handled as pressure in
 * conversion.ts), courier robber, agent killer. Move 2 tiles/s, 4× on roads;
 * the only unit allowed through Woods.
 */
export function stepVans(s: SimState, b: Balance): void {
  const w = s.world;
  for (const v of s.vans) {
    if (v.idx >= v.path.length - 1) continue;
    const onRoad = w.terrain[v.tile] === Terrain.Road;
    let speed = onRoad ? fromFloat(8.0) : fromFloat(2.0);
    if (computeMonopolies(s, v.player).foodAndFuelCartel) {
      speed = mul(speed, fromFloat(1.35));
    }
    v.moveProgress = add(v.moveProgress, mul(speed, b.dt));
    while (v.moveProgress >= ONE && v.idx < v.path.length - 1) {
      v.moveProgress = sub(v.moveProgress, ONE);
      v.idx++;
      const next = v.path[v.idx]!;
      if (w.terrain[next] === Terrain.Lake) {
        // lakes stay impassable even for vans — path truncates here
        v.path = v.path.slice(0, v.idx);
        v.idx = v.path.length - 1;
        break;
      }
      v.tile = next;
    }
  }

  // robbery: enemy van on a courier's tile takes 100% (§3.2)
  for (let i = s.couriers.length - 1; i >= 0; i--) {
    const c = s.couriers[i]!;
    const ct = c.path[c.idx]!;
    const robber = s.vans.find((v) => v.player !== c.player && v.tile === ct);
    if (!robber) continue;
    const p = s.players.find((pl) => pl.id === robber.player);
    if (p && p.alive) {
      p.usd = add(p.usd, c.usd);
      p.usdEarned = add(p.usdEarned, c.usd);
      gainHeatScaled(p, b, 2); // +2 heat per robbery (§3.5)
    }
    s.couriers.splice(i, 1);
  }

  // van–agent contact: screens/kills agents (§7)
  for (let i = s.agents.length - 1; i >= 0; i--) {
    const a = s.agents[i]!;
    if (a.phase === "travel") continue; // in transit = not yet on the ground
    if (s.vans.some((v) => v.player !== a.player && manhattan(w, v.tile, a.tile) <= 1)) {
      s.agents.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- agents

const AGENT_SPEED_TILES_PER_S = 1.8;
const RAID_CHANNEL_TICKS = 6 * TPS;
const EXPOSURE_KILL_TICKS = 3 * TPS;

/** Dispatch validation lives in sim.ts; this creates the unit. */
export function dispatchAgent(
  s: SimState,
  p: PlayerState,
  district: number,
  mission: AgentUnit["mission"],
): void {
  const w = s.world;
  // origin: player's first compound (or any owned tile)
  let origin = -1;
  for (const bd of s.buildings) {
    if (bd.type === "compound" && bd.player === p.id) {
      origin = bd.tile;
      break;
    }
  }
  if (origin < 0) {
    for (let t = 0; t < w.owner.length; t++) {
      if (w.owner[t] === p.id) {
        origin = t;
        break;
      }
    }
  }
  if (origin < 0) return;

  // destination: the middle of the victim's holdings in the district, so the
  // radius-3 blob actually lands on believers
  let victim: PlayerId = NEUTRAL;
  const victimTiles: TileId[] = [];
  for (let t = 0; t < w.district.length; t++) {
    if (w.district[t] !== district) continue;
    const o = w.owner[t]!;
    if (o === NEUTRAL || o === p.id) continue;
    if (victim === NEUTRAL) victim = o;
    if (o === victim) victimTiles.push(t);
  }
  if (victim === NEUTRAL || victimTiles.length === 0) return;
  const dest = victimTiles[victimTiles.length >> 1]!;

  const travel = Math.ceil((manhattan(w, origin, dest) / AGENT_SPEED_TILES_PER_S) * TPS);
  s.agents.push({
    id: s.nextEntityId++,
    player: p.id,
    tile: dest,
    targetDistrict: district,
    victim,
    mission,
    phase: "travel",
    travelTicks: travel,
    channelTicks: RAID_CHANNEL_TICKS,
    exposedTicks: 0,
  });
}

export function stepAgents(s: SimState, b: Balance): void {
  const w = s.world;
  for (let i = s.agents.length - 1; i >= 0; i--) {
    const a = s.agents[i]!;

    if (a.phase === "travel") {
      if (--a.travelTicks <= 0) a.phase = a.mission === "deprogram" ? "channel" : "gather";
      continue;
    }

    // Town Machine monopoly: victim auto-arrests stealth agents in district
    if (computeMonopolies(s, a.victim).townMachine) {
      s.agents.splice(i, 1);
      continue;
    }

    // watchtower exposure: 3s inside victim vision = killed (§13)
    if (watchtowerSees(s, a.victim, a.tile)) {
      if (++a.exposedTicks >= EXPOSURE_KILL_TICKS) {
        s.agents.splice(i, 1);
        continue;
      }
    } else {
      a.exposedTicks = 0;
    }

    if (a.phase === "channel") {
      if (--a.channelTicks > 0) continue;
      executeRaid(s, a, b);
      s.agents.splice(i, 1);
      continue;
    }

    // gather: scandal evidence (§15.2)
    const file = getScandal(s, a.player, a.victim);
    if (file.published) {
      s.agents.splice(i, 1);
      continue;
    }
    // 1.2%/s; 0.6%/s while any victim watchtower watches the district borders
    const slowed = victimHasWatchtower(s, a.victim);
    const rate = slowed ? b.scandal.evidenceWatchedPerS : b.scandal.evidencePerS;
    file.evidence = min(add(file.evidence, mul(rate, b.dt)), HUNDRED);
    if (!file.notified && file.evidence >= b.scandal.notifyAt) {
      file.notified = true; // "Someone is asking questions about you." (§15.2)
    }
    if (file.evidence >= HUNDRED) s.agents.splice(i, 1); // holds the Publish button
  }
}

function victimHasWatchtower(s: SimState, victim: PlayerId): boolean {
  return s.buildings.some(
    (bd) => bd.type === "watchtower" && bd.player === victim && isOperational(bd),
  );
}

export function getScandal(s: SimState, attacker: PlayerId, victim: PlayerId) {
  let file = s.scandals.find((sc) => sc.attacker === attacker && sc.victim === victim);
  if (!file) {
    file = { attacker, victim, evidence: 0, notified: false, published: false };
    s.scandals.push(file);
  }
  return file;
}

/** Deprogramming raid impact (§13): radius-3 apostate blob + 15 district dissent. */
function executeRaid(s: SimState, a: AgentUnit, b: Balance): void {
  const w = s.world;
  const victim = s.players.find((pl) => pl.id === a.victim);

  // diminishing-returns lockout: −50% effect within 60s of the last raid (§13)
  const locked = (s.raidLockouts[a.targetDistrict] ?? 0) > s.tick;
  s.raidLockouts[a.targetDistrict] = s.tick + 60 * TPS;
  let radius = locked ? 2 : 3;
  // E2 Family Now: −50% effect (§10)
  if (raidEffectMultAgainst(victim) !== ONE) radius = Math.max(1, radius >> 1);

  const [cx, cy] = [a.tile % w.width, (a.tile / w.width) | 0];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
      const t = y * w.width + x;
      if (w.owner[t] !== a.victim || w.state[t] !== TileState.Believer) continue;
      apostatize(w, t, b, s.players);
      w.scarTicks[t] = scarTicksFor(victim, w.scarTicks[t]!);
    }
  }
  // +15 dissent in the district (§13)
  const amt = fromInt(15);
  for (let t = 0; t < w.district.length; t++) {
    if (w.district[t] !== a.targetDistrict || w.owner[t] !== a.victim) continue;
    w.dissent[t] = min(add(w.dissent[t]!, amt), HUNDRED);
  }
}

/** Publish a 100%-evidence scandal (§15.2). Returns true if it landed. */
export function publishScandal(s: SimState, attacker: PlayerState, victimId: PlayerId, b: Balance): boolean {
  const file = s.scandals.find((sc) => sc.attacker === attacker.id && sc.victim === victimId);
  if (!file || file.published || file.evidence < HUNDRED) return false;
  file.published = true;
  s.recap.scandals.push({ attacker: attacker.id, victim: victimId, tick: s.tick });
  gainHeatScaled(attacker, b, 10); // mud sticks to the thrower

  const victim = s.players.find((pl) => pl.id === victimId);
  if (!victim || !victim.alive) return true;
  if (tryAbsorbMassApostasy(victim)) return true; // E4 UNSHAKEABLE

  // lose clamp(Heat × 0.6, 5, 35)% of followers; ×1.5 vs Prosperity Circle
  let pct = clamp(mul(victim.heat, b.scandal.dmgHeatCoef), b.scandal.dmgMin, b.scandal.dmgMax);
  if (victim.archetype === "circle") pct = mul(pct, fromFloat(1.5));
  victim.followers = mul(victim.followers, sub(ONE, div(pct, HUNDRED)));
  victim.faith = victim.faith > fromInt(25) ? sub(victim.faith, fromInt(25)) : 0;
  return true;
}

// ---------------------------------------------------------------- strikes

/** Charge → 10s warning → land (§8). */
export function stepStrikes(s: SimState, b: Balance): void {
  for (let i = s.strikes.length - 1; i >= 0; i--) {
    const c = s.strikes[i]!;
    if (c.chargeTicksLeft > 0) {
      if (!isEmergencyJamActive(s, c.player)) {
        c.chargeTicksLeft--;
      }
      continue;
    }
    if (c.warningTicksLeft > 0) {
      c.warningTicksLeft--;
      continue;
    }
    s.strikes.splice(i, 1);
    landStrike(s, c, b);
  }
}

function landStrike(s: SimState, c: StrikeCharge, b: Balance): void {
  const attacker = s.players.find((pl) => pl.id === c.player);
  if (!attacker || !attacker.alive) return;
  const def = STRIKE_DEFS[c.type];

  if (c.type === "manifesto_drop") {
    // un-interceptable; 6 scattered pamphlet-level zones across the victim (§8)
    attacker.heat = HUNDRED;
    const victimTiles: TileId[] = [];
    const w = s.world;
    for (let t = 0; t < w.owner.length; t++) if (w.owner[t] === c.victim) victimTiles.push(t);
    for (let z = 0; z < 6 && victimTiles.length > 0; z++) {
      const t = victimTiles[nextRange(s.rng, victimTiles.length)]!;
      pamphletImpact(s, attacker, c.victim, t, def.radius, b);
    }
    return;
  }



  if (c.type === "pamphlet_bomb") {
    pamphletImpact(s, attacker, c.victim, c.target, STRIKE_DEFS.pamphlet_bomb.radius, b);
    gainHeatScaled(attacker, b, STRIKE_DEFS.pamphlet_bomb.heat);
  } else {
    // prime-time exposé (§8)
    gainHeatScaled(attacker, b, STRIKE_DEFS.prime_time_expose.heat);
    const victim = s.players.find((pl) => pl.id === c.victim);
    if (!victim || !victim.alive) return;
    if (tryAbsorbMassApostasy(victim)) return; // E4
    victim.faith = victim.faith > fromInt(25) ? sub(victim.faith, fromInt(25)) : 0;
    victim.retentionDebuffTicks = 45 * TPS; // retention halved 45s
    victim.followers = mul(victim.followers, fromFloat(0.95)); // 5% apostatize
  }
}

function pamphletImpact(
  s: SimState,
  attacker: PlayerState,
  victim: PlayerId,
  center: TileId,
  radius: number,
  b: Balance,
): void {
  const w = s.world;
  const [cx, cy] = [center % w.width, (center / w.width) | 0];
  const amt = fromInt(35);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
      const t = y * w.width + x;
      if (w.owner[t] === victim && w.state[t] === TileState.Believer) {
        w.dissent[t] = min(add(w.dissent[t]!, amt), HUNDRED);
      }
    }
  }
  disableBuildingsNear(s, victim, center, radius, 30 * TPS); // 30s downtime (§8)
}

// ---------------------------------------------------------------- CPA (§17)

/**
 * The Concerned Parents Association: targets only the single highest-Heat
 * player. Heat ≥ 60: picket lines on their biggest mission every 60s. Heat ≥ 85:
 * a Deprogrammer Bus raids their highest-dissent district every 45s. Tuned to
 * slow, never to kill.
 */
export function stepCPA(s: SimState, b: Balance): void {
  // tick down pickets
  for (let i = s.pickets.length - 1; i >= 0; i--) {
    if (--s.pickets[i]!.ticksLeft <= 0) s.pickets.splice(i, 1);
  }

  // find the single highest-heat player (ties: larger cult)
  let target: PlayerState | undefined;
  for (const p of s.players) {
    if (!p.alive || !p.spawned) continue;
    if (!target || p.heat > target.heat || (p.heat === target.heat && p.ownedTiles > target.ownedTiles)) {
      target = p;
    }
  }
  if (!target) return;

  // Town Hall owned: CPA ignores you below Heat 75 (§12)
  // Town Machine monopoly (Town Hall + Sheriff): raised to Heat 85!
  const hasMachine = computeMonopolies(s, target.id).townMachine;
  const hasTownHall = ownsLandmark(s, target.id, Landmark.TownHall);
  const harassFloor = hasMachine ? fromInt(85) : hasTownHall ? fromInt(75) : b.heat.cpaHarass;

  if (target.heat >= harassFloor && s.tick >= s.cpaNextPicketTick) {
    s.cpaNextPicketTick = s.tick + 60 * TPS;
    // busiest push (M2 retarget: pickets used to anchor on the largest front):
    // the target's biggest deployed cohort — picket where the flock works.
    // Ties resolve to the earlier slot; recalled cohorts are already leaving.
    let busiest: Cohort | undefined;
    for (const c of target.cohorts) {
      if (!c.recalling && (!busiest || c.mass > busiest.mass)) busiest = c;
    }
    const w = s.world;
    const anchor = busiest?.target ?? firstOwnedTile(s, target.id);
    if (anchor !== undefined && anchor >= 0) {
      for (let k = 0; k < 2; k++) {
        const off = k * 3;
        const tile = Math.min(w.owner.length - 1, anchor + off);
        s.pickets.push({ target: target.id, tile, ticksLeft: 45 * TPS });
      }
    }
  }

  if (target.heat >= b.heat.cpaSiege && s.tick >= s.cpaNextBusTick) {
    s.cpaNextBusTick = s.tick + 45 * TPS;
    // deprogrammer bus: §13-equivalent raid on the highest-dissent district
    const w = s.world;
    const sums = new Map<number, Fixed>();
    for (let t = 0; t < w.owner.length; t++) {
      if (w.owner[t] !== target.id) continue;
      const d = w.district[t]!;
      sums.set(d, add(sums.get(d) ?? 0, w.dissent[t]!));
    }
    let bestD = -1;
    let bestSum: Fixed = -1;
    for (const [d, sum] of [...sums.entries()].sort((a, z) => a[0] - z[0])) {
      if (sum > bestSum) {
        bestSum = sum;
        bestD = d;
      }
    }
    if (bestD >= 0) {
      // synthesize a CPA raid: same impact path as an agent raid
      const fake: AgentUnit = {
        id: -1,
        player: 0,
        tile: firstDistrictTile(s, target.id, bestD),
        targetDistrict: bestD,
        victim: target.id,
        mission: "deprogram",
        phase: "channel",
        travelTicks: 0,
        channelTicks: 0,
        exposedTicks: 0,
      };
      if (fake.tile >= 0) executeRaid(s, fake, b);
    }
  }
}

function firstOwnedTile(s: SimState, pid: PlayerId): number {
  const w = s.world;
  for (let t = 0; t < w.owner.length; t++) if (w.owner[t] === pid) return t;
  return -1;
}

function firstDistrictTile(s: SimState, pid: PlayerId, district: number): number {
  const w = s.world;
  for (let t = 0; t < w.owner.length; t++)
    if (w.owner[t] === pid && w.district[t] === district) return t;
  return -1;
}

export function ownsLandmark(s: SimState, pid: PlayerId, kind: number): boolean {
  if (pid === NEUTRAL) return false;
  const w = s.world;
  for (let t = 0; t < w.landmark.length; t++) {
    if (
      w.landmark[t] === kind &&
      w.owner[t] === pid &&
      w.state[t] === TileState.Believer &&
      w.scarTicks[t] === 0
    ) {
      return true;
    }
  }
  return false;
}
