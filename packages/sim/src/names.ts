/**
 * World naming (§2 flavor): every match gets a fresh fake town — a town name,
 * named streets, and household names — drawn deterministically from the
 * faker-generated corpora in nameData.ts (see tools/gen_names.py).
 *
 * Two kinds of determinism here:
 *  - town/street names are picked with the seeded mapgen RNG and STORED on the
 *    World (they ship in the snapshot), so every client reads the same map;
 *  - household/member names are PURE tile hashes computed on demand (like the
 *    renderer's people-dots) — no state, identical everywhere, free.
 */

import { nextRange, type RngState } from "./rng.js";
import { TOWN_NAMES, STREET_BASES, FIRST_NAMES, SURNAMES } from "./nameData.js";

/** A named, axis-aligned street segment (axis 0 = horizontal, 1 = vertical). */
export interface Street {
  name: string;
  axis: 0 | 1;
  /** the fixed row (axis 0) or column (axis 1) the street runs along */
  at: number;
  /** inclusive span along the street's axis */
  from: number;
  to: number;
}

/** Fresh town name for this seed (e.g. "Copeland Falls"). */
export function pickTownName(rng: RngState): string {
  return TOWN_NAMES[nextRange(rng, TOWN_NAMES.length)]!;
}

/**
 * Name one street. Road class decides the suffix the way real plats do:
 * horizontal town streets are Avenues, vertical ones Streets, rural routes
 * Roads, lanes Lanes — with the town's two arteries fixed as "Main Street"
 * and "<name> Highway".
 */
export function streetLabel(
  rng: RngState,
  kind: "main" | "highway" | "avenue" | "street" | "road" | "lane" | "court",
): string {
  const base = STREET_BASES[nextRange(rng, STREET_BASES.length)]!;
  switch (kind) {
    case "main":
      return "Main Street";
    case "highway":
      return `${base} Highway`;
    case "avenue":
      return `${base} Avenue`;
    case "street":
      return `${base} Street`;
    case "road":
      return `${base} Road`;
    case "lane":
      return `${base} Lane`;
    case "court":
      return `${base} Court`;
  }
}

/** The same integer hash the renderer uses for stateless per-tile variety. */
function tileHash(t: number, salt: number): number {
  let h = (t * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Household surname for a lot — "the Hendersons". Pure, stateless. */
export function householdName(tile: number): string {
  return SURNAMES[tileHash(tile, 11) % SURNAMES.length]!;
}

/** A named resident of a lot (dot i) — used for cult-member flavor text. */
export function memberName(tile: number, i: number): string {
  const first = FIRST_NAMES[tileHash(tile, 23 + i) % FIRST_NAMES.length]!;
  return `${first} ${householdName(tile)}`;
}

/**
 * Street label at a tile, if a named street runs through it (streets are
 * 1 tile wide on their `at` row/column; the 2-lane highway matches both rows).
 */
export function streetAt(streets: readonly Street[], width: number, tile: number): string | null {
  const x = tile % width;
  const y = (tile / width) | 0;
  for (const s of streets) {
    if (s.axis === 0) {
      if (y === s.at && x >= s.from && x <= s.to) return s.name;
    } else if (x === s.at && y >= s.from && y <= s.to) {
      return s.name;
    }
  }
  return null;
}
