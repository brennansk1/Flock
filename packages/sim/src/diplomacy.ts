/**
 * Diplomacy & drama (§15.3, §16): alliances, betrayal (JUDAS), Schism, and
 * Court Defection. The splinter sect is a sim-level player so the whole event
 * replicates deterministically through the turn stream.
 */

import { add, sub, mul, div, fromInt, type Fixed } from "./fixed.js";
import type { Balance } from "./balance.js";
import { hasDoctrine } from "./doctrine.js";
import {
  NEUTRAL,
  TileState,
  type PlayerId,
  type PlayerState,
  type SimState,
  type DistrictId,
} from "./types.js";
import { newPlayer } from "./player.js";
import { destroyBuildingsOnTile } from "./buildings.js";

const TPS = 10;
const HUNDRED = fromInt(100);

export const ALLIANCE_TICKS = 10 * 60 * TPS; // 10:00 (§16)
export const OFFER_TICKS = 60 * TPS;
export const JUDAS_TICKS = 30 * TPS; // 30s −50% retention (§16)

function pairKey(a: PlayerId, b: PlayerId): [PlayerId, PlayerId] {
  return a < b ? [a, b] : [b, a];
}

export function areAllied(s: SimState, x: PlayerId, y: PlayerId): boolean {
  const [a, b] = pairKey(x, y);
  return s.alliances.some((al) => al.a === a && al.b === b && al.expiresTick > s.tick);
}

export function proposeAlliance(s: SimState, from: PlayerId, to: PlayerId): void {
  if (from === to || areAllied(s, from, to)) return;
  if (s.allianceOffers.some((o) => o.from === from && o.to === to)) return;
  s.allianceOffers.push({ from, to, expiresTick: s.tick + OFFER_TICKS });
}

export function acceptAlliance(s: SimState, accepter: PlayerId, proposer: PlayerId): void {
  const idx = s.allianceOffers.findIndex(
    (o) => o.from === proposer && o.to === accepter && o.expiresTick > s.tick,
  );
  if (idx < 0) return;
  s.allianceOffers.splice(idx, 1);
  const [a, b] = pairKey(accepter, proposer);
  s.alliances.push({ a, b, expiresTick: s.tick + ALLIANCE_TICKS });
}

/** Clean break (no JUDAS): dissolves the alliance without the betrayal stigma. */
export function breakAlliance(s: SimState, x: PlayerId, y: PlayerId): void {
  const [a, b] = pairKey(x, y);
  const idx = s.alliances.findIndex((al) => al.a === a && al.b === b);
  if (idx >= 0) s.alliances.splice(idx, 1);
  // Ecumenical Pact grants die with the alliance (§16)
  for (const p of s.players) {
    if ((p.id === x && p.pactWith === y) || (p.id === y && p.pactWith === x)) {
      p.pactNode = "";
      p.pactWith = 0;
    }
  }
}

/**
 * Betrayal (§16): triggered when a player opens aggression on an ally. The
 * alliance shatters, the JUDAS banner drops, and the marks are permanent:
 * traitor icon, 30s −50% retention everywhere, −15% conversion vs the victim.
 */
export function commitBetrayal(s: SimState, traitor: PlayerState, victim: PlayerId): void {
  breakAlliance(s, traitor.id, victim);
  traitor.traitor = true;
  traitor.judasTicks = JUDAS_TICKS;
  if (!s.grudges.some((g) => g.traitor === traitor.id && g.victim === victim)) {
    s.grudges.push({ traitor: traitor.id, victim });
    s.recap.betrayals.push({ traitor: traitor.id, victim, tick: s.tick });
  }
}

/** −15% conversion traitor→victim, forever (§16). */
export function grudgeMult(s: SimState, attacker: PlayerId, victim: PlayerId): Fixed {
  return s.grudges.some((g) => g.traitor === attacker && g.victim === victim)
    ? Math.round(0.85 * 65536)
    : 65536;
}

/**


/**
 * Schism watcher (§16): territory ≥ 35% of populated AND cult-avg dissent ≥ 40,
 * both sustained 30s (the visible Schism Risk gauge), then the contiguous
 * highest-dissent region equal to 25% of the cult's tiles secedes as a Splinter
 * Sect — a fresh sim player with proportional followers and zeroed dissent.
 */
export function stepSchism(s: SimState, b: Balance): void {
  const w = s.world;
  for (const p of [...s.players]) {
    if (!p.alive || !p.spawned) continue;
    const territoryOk = p.ownedTiles * 1000 >= s.populated * b.schism.territorySharePermille;
    let dissentOk = false;
    if (territoryOk && p.ownedTiles > 0) {
      let sum: Fixed = 0;
      for (let t = 0; t < w.owner.length; t++) {
        if (w.owner[t] === p.id && w.state[t] === TileState.Believer) sum = add(sum, w.dissent[t]!);
      }
      dissentOk = div(sum, fromInt(p.ownedTiles)) >= b.schism.avgDissent;
    }
    if (territoryOk && dissentOk) {
      p.schismRiskTicks++;
      if (p.schismRiskTicks >= b.schism.sustainTicks) {
        p.schismRiskTicks = 0;
        eruptSchism(s, p, b);
      }
    } else {
      p.schismRiskTicks = 0;
    }
  }
}

function eruptSchism(s: SimState, parent: PlayerState, b: Balance): void {
  const w = s.world;
  // seed: parent's highest-dissent tile
  let seed = -1;
  let seedDissent: Fixed = -1;
  for (let t = 0; t < w.owner.length; t++) {
    if (w.owner[t] !== parent.id || w.state[t] !== TileState.Believer) continue;
    if (w.dissent[t]! > seedDissent) {
      seedDissent = w.dissent[t]!;
      seed = t;
    }
  }
  if (seed < 0) return;

  const target = Math.max(1, Math.floor((parent.ownedTiles * b.schism.secedeSharePermille) / 1000)); // §16
  const splinterId = s.nextSplinterId++;
  const splinter = newPlayer(splinterId, parent.archetype, b);
  splinter.spawned = true;
  // proportional followers; the righteous always feel great at first (dissent 0)
  const QUARTER = 16384; // 0.25 in Q16.16
  const share = mul(parent.followers, QUARTER);
  splinter.followers = share;
  parent.followers = sub(parent.followers, share);
  s.players.push(splinter);

  // contiguous BFS from the seed across parent territory
  const queue = [seed];
  const taken = new Set<number>([seed]);
  let count = 0;
  while (queue.length > 0 && count < target) {
    const t = queue.shift()!;
    w.owner[t] = splinterId;
    w.dissent[t] = 0;
    w.holdTicks[t] = 0;
    destroyBuildingsOnTile(s, t);
    count++;
    const x = t % w.width;
    const y = (t / w.width) | 0;
    const neighbors = [
      y > 0 ? t - w.width : -1,
      x > 0 ? t - 1 : -1,
      x < w.width - 1 ? t + 1 : -1,
      y < w.height - 1 ? t + w.width : -1,
    ];
    for (const n of neighbors) {
      if (n < 0 || taken.has(n)) continue;
      if (w.owner[n] === parent.id && w.state[n] === TileState.Believer) {
        taken.add(n);
        queue.push(n);
      }
    }
  }
  parent.ownedTiles = Math.max(0, parent.ownedTiles - count);
  splinter.ownedTiles = count;
  s.recap.schisms.push({ parent: parent.id, splinter: splinterId, tick: s.tick });

  // each Schism: parent −20 Faith (§3.3). (Splinter↔parent alliance lockout
  // arrives with the alliance UI; splinters are AI-driven for now, §16/§21.)
  parent.faith = parent.faith > fromInt(20) ? sub(parent.faith, fromInt(20)) : 0;
}
