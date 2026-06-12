/**
 * Conversion resolution (§4) — the combat system.
 *
 * Front-based territorial conversion with SIR flavor:
 *  1. Players commit their stance's follower share to Fronts (target regions).
 *  2. Each tick, committed followers spread evenly over the Front's *contested*
 *     border tiles, capped at `max_eff_per_border_tile` (60) — wide beats tall.
 *  3. Per contested tile:
 *       pressure/s = base × R0 × stance_mult × district_conv × S_mod(neutral)
 *                    × faith_mod × charisma / resistance
 *       resistance = (1 + defenders_per_tile/40) × district_retain
 *                    × fort_mult × defender_faith_mod
 *  4. A tile flips when accumulated pressure ≥ 100 (typ. 1.5–4 s mid-game).
 *  5. Attrition: attacker 0.6/s and defender 0.35/s per contested tile.
 *  6. Ambient creep: every owned border tile passively presses adjacent
 *     neutrals at 0.35 × R0 × district_conv. Healthy cults ooze.
 *  7. Apostate scar tiles are immune to ALL conversion until the scar expires.
 *
 * Everything here is fixed-point, RNG-free, and iterates in stable order
 * (players by array order, tiles ascending) — the lockstep contract.
 */

import { add, sub, mul, div, min, fromInt, ONE, type Fixed } from "./fixed.js";
import type { Balance, ArchetypeCoeffs } from "./balance.js";
import {
  NEUTRAL,
  Stance,
  Terrain,
  TileState,
  PROGRESS_STRIDE,
  type PlayerState,
  type SimState,
  type World,
  type TileId,
  type PlayerId,
} from "./types.js";

const HUNDRED: Fixed = fromInt(100);

/** faith_combat_mod = 0.85 + Faith/333 → 0.85..1.15 (§3.3). */
export function faithCombatMod(faith: Fixed): Fixed {
  return add(fp(0.85), div(faith, fromInt(333)));
}

/** S_mod = 0.5 + S/100 (§2), neutral tiles only. */
function sMod(s: Fixed): Fixed {
  return add(fp(0.5), div(s, HUNDRED));
}

function fp(n: number): Fixed {
  return Math.round(n * ONE) | 0;
}

function coeffsOf(b: Balance, p: PlayerState): ArchetypeCoeffs {
  return b.archetypes[p.archetype];
}

function stanceOf(b: Balance, p: PlayerState): { commit: Fixed; mult: Fixed } {
  switch (p.stance) {
    case Stance.Tend:
      return b.stances.tend;
    case Stance.Crusade:
      return b.stances.crusade;
    default:
      return b.stances.spread;
  }
}

/** 4-neighborhood, edge-clipped, in fixed N/W/E/S order. */
function forEachNeighbor(w: World, t: TileId, fn: (n: TileId) => void): void {
  const x = t % w.width;
  const y = (t / w.width) | 0;
  if (y > 0) fn(t - w.width);
  if (x > 0) fn(t - 1);
  if (x < w.width - 1) fn(t + 1);
  if (y < w.height - 1) fn(t + w.width);
}

/** Is `t` a conversion-eligible citizen tile (not terrain, not scarred)? */
function convertible(w: World, t: TileId): boolean {
  return (
    w.terrain[t] === Terrain.Citizen &&
    w.state[t] !== TileState.Apostate &&
    w.scarTicks[t] === 0
  );
}

/** Does player `p` own any 4-neighbor of `t`? (Fronts press from adjacency.) */
function adjacentToOwned(w: World, t: TileId, p: PlayerId): boolean {
  let found = false;
  forEachNeighbor(w, t, (n) => {
    if (w.owner[n] === p && w.state[n] === TileState.Believer) found = true;
  });
  return found;
}

interface ContestedWork {
  player: PlayerState;
  /** Sorted ascending contested tile ids for this player's fronts this tick. */
  tiles: TileId[];
  /** Effective attackers per contested tile (committed/n, capped). */
  attackersPerTile: Fixed;
  stanceMult: Fixed;
}

/**
 * Resolve one tick of conversion: front pressure, ambient creep, flips,
 * attrition, scars. Mutates `s` in place.
 */
export function resolveConversion(s: SimState, b: Balance): void {
  const w = s.world;
  const dt = b.dt;

  // ---- Pass 1: gather each player's contested tiles from their fronts. ----
  const work: ContestedWork[] = [];
  /** tiles-under-attack count per defending player id (for defender spread). */
  const defendedCount = new Map<PlayerId, number>();

  for (const p of s.players) {
    if (!p.alive) continue;
    const seen = new Set<TileId>();
    for (const f of s.fronts) {
      if (f.player !== p.id) continue;
      for (const t of f.tiles) {
        if (seen.has(t)) continue;
        if (!convertible(w, t)) continue;
        if (w.owner[t] === p.id) continue;
        if (!adjacentToOwned(w, t, p.id)) continue;
        seen.add(t);
      }
    }
    if (seen.size === 0) continue;
    const tiles = [...seen].sort((a, z) => a - z);
    const st = stanceOf(b, p);
    const committed = mul(p.followers, st.commit);
    const perTile = min(div(committed, fromInt(tiles.length)), b.conversion.maxEffPerBorderTile);
    work.push({ player: p, tiles, attackersPerTile: perTile, stanceMult: st.mult });
    for (const t of tiles) {
      const owner = w.owner[t]!;
      if (owner !== NEUTRAL) defendedCount.set(owner, (defendedCount.get(owner) ?? 0) + 1);
    }
  }

  // Defender spread: uncommitted followers split across all tiles under attack.
  const defendersPerTile = new Map<PlayerId, Fixed>();
  for (const [pid, count] of defendedCount) {
    const d = s.players.find((pl) => pl.id === pid);
    if (!d || !d.alive) continue;
    const st = stanceOf(b, d);
    const uncommitted = mul(d.followers, sub(ONE, st.commit));
    defendersPerTile.set(pid, div(uncommitted, fromInt(count)));
  }

  // ---- Pass 2: apply front pressure into the progress map. ----
  for (const wk of work) {
    const p = wk.player;
    const co = coeffsOf(b, p);
    const atkFaith = faithCombatMod(p.faith);
    for (const t of wk.tiles) {
      const dc = w.districtCoeffs[w.district[t]!] ?? { conv: ONE, retain: ONE, income: ONE };
      const owner = w.owner[t]!;

      // pressure numerator
      let pr = mul(b.conversion.basePressure, co.r0);
      pr = mul(pr, wk.stanceMult);
      pr = mul(pr, dc.conv);
      if (owner === NEUTRAL) pr = mul(pr, sMod(w.susceptibility[t]!));
      pr = mul(pr, atkFaith);
      pr = mul(pr, b.charismaItems);
      // attacker headcount scaling: effective attackers / cap → 0..1 of full rate
      pr = mul(pr, div(wk.attackersPerTile, b.conversion.maxEffPerBorderTile));

      // resistance denominator
      let res = ONE;
      if (owner !== NEUTRAL) {
        const defender = s.players.find((pl) => pl.id === owner);
        const dpt = defendersPerTile.get(owner) ?? 0;
        res = add(ONE, div(dpt, fromInt(40)));
        res = mul(res, dc.retain);
        if (defender) {
          res = mul(res, coeffsOf(b, defender).retain);
          res = mul(res, faithCombatMod(defender.faith));
        }
        // fort_mult (Watchtower=5) joins here when buildings land.
      }
      pr = div(pr, res);

      const key = t * PROGRESS_STRIDE + p.id;
      s.progress.set(key, add(s.progress.get(key) ?? 0, mul(pr, dt)));
    }
  }

  // ---- Pass 3: ambient creep onto neutral tiles (§4.6). ----
  for (let t = 0; t < w.owner.length; t++) {
    const owner = w.owner[t]!;
    if (owner === NEUTRAL || w.state[t] !== TileState.Believer) continue;
    const p = s.players.find((pl) => pl.id === owner);
    if (!p || !p.alive) continue;
    const r0 = coeffsOf(b, p).r0;
    forEachNeighbor(w, t, (n) => {
      if (w.owner[n] !== NEUTRAL || !convertible(w, n)) return;
      const dc = w.districtCoeffs[w.district[n]!] ?? { conv: ONE, retain: ONE, income: ONE };
      const pr = mul(mul(b.conversion.ambientCreep, r0), dc.conv);
      const key = n * PROGRESS_STRIDE + owner;
      s.progress.set(key, add(s.progress.get(key) ?? 0, mul(pr, dt)));
    });
  }

  // ---- Pass 4: flips. Sorted keys → deterministic winner on ties. ----
  const flipped = new Map<TileId, PlayerId>(); // tile → winner
  const best = new Map<TileId, Fixed>();
  const keys = [...s.progress.keys()].sort((a, z) => a - z);
  for (const key of keys) {
    const prog = s.progress.get(key)!;
    if (prog < b.conversion.flipThreshold) continue;
    const t = (key / PROGRESS_STRIDE) | 0;
    const attacker = key % PROGRESS_STRIDE;
    if (!convertible(w, t)) continue;
    if (w.owner[t] === attacker) continue;
    // highest progress wins; ties resolve to the lower key (lower player id)
    if (!flipped.has(t) || prog > (best.get(t) ?? 0)) {
      flipped.set(t, attacker);
      best.set(t, prog);
    }
  }

  for (const [t, winner] of flipped) {
    const prevOwner = w.owner[t]!;
    const p = s.players.find((pl) => pl.id === winner);
    if (!p) continue;

    if (prevOwner !== NEUTRAL) {
      const loser = s.players.find((pl) => pl.id === prevOwner);
      if (loser) loser.ownedTiles = Math.max(0, loser.ownedTiles - 1);
    }
    w.owner[t] = winner;
    w.state[t] = TileState.Believer;
    p.ownedTiles++;

    // CRUSADE captures stoke dissent on the taken tile (§3.4).
    if (p.stance === Stance.Crusade) {
      w.dissent[t] = min(add(w.dissent[t]!, b.stances.crusade.dissentPerCapture), HUNDRED);
    }

    // Clear all attackers' progress on the flipped tile.
    for (const pl of s.players) s.progress.delete(t * PROGRESS_STRIDE + pl.id);
  }

  // ---- Pass 5: attrition (§4.5). Pushing costs manpower; turtling is cheaper. ----
  for (const wk of work) {
    const cost = mul(mul(b.conversion.attritionAttacker, fromInt(wk.tiles.length)), dt);
    wk.player.followers = wk.player.followers > cost ? sub(wk.player.followers, cost) : 0;
  }
  for (const [pid, count] of defendedCount) {
    const d = s.players.find((pl) => pl.id === pid);
    if (!d || !d.alive) continue;
    const cost = mul(mul(b.conversion.attritionDefender, fromInt(count)), dt);
    d.followers = d.followers > cost ? sub(d.followers, cost) : 0;
  }
}

/** Mark a Believer tile Apostate (§4.7): scar timer, no owner, S −15 on revert. */
export function apostatize(w: World, t: TileId, b: Balance, players: PlayerState[]): void {
  const prev = w.owner[t]!;
  if (prev !== NEUTRAL) {
    const loser = players.find((pl) => pl.id === prev);
    if (loser) loser.ownedTiles = Math.max(0, loser.ownedTiles - 1);
  }
  w.owner[t] = NEUTRAL;
  w.state[t] = TileState.Apostate;
  w.scarTicks[t] = b.conversion.apostateScarTicks;
  const reduced = sub(w.susceptibility[t]!, fromInt(15));
  w.susceptibility[t] = reduced < fromInt(5) ? fromInt(5) : reduced;
}
