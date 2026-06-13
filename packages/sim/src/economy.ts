/**
 * Earn/spend economy (§22/§36). Two hard policies, enforced by code, not just
 * docs:
 *   1. Relics (earned soft currency) are NEVER purchasable for money — the
 *      earn-economy and the spend-economy never touch. No catalog item grants
 *      relics, and `purchase` refuses any item priced in money that yields
 *      relics.
 *   2. The free archetype rotation means nobody is ever locked out of
 *      asymmetry: two archetypes are free for everyone each day.
 *
 * META module (outside lockstep). Operates on a minimal Wallet so it's shared
 * by the server Account without a dependency cycle.
 */

import { ARCHETYPE_UNLOCK_COST } from "./progression.js";
import type { Archetype } from "./palette.js";

export const ALL_ARCHETYPES: readonly Archetype[] = ["dawn", "radiant", "circle", "visitors"];

export type Currency = "relics" | "shards" | "money";

export type ItemKind = "archetype" | "recolor" | "recap_frame";

export interface CatalogItem {
  id: string;
  kind: ItemKind;
  name: string;
  cost: number;
  currency: Currency;
  /** what owning it unlocks (archetype id, cosmetic id). */
  grants: string;
}

/** The launch catalog (§36). Note: NOTHING priced in `money` grants relics. */
export const CATALOG: readonly CatalogItem[] = [
  // archetypes — relics only (a week of casual play each), never money
  { id: "unlock_dawn", kind: "archetype", name: "The Final Dawn", cost: ARCHETYPE_UNLOCK_COST, currency: "relics", grants: "dawn" },
  { id: "unlock_radiant", kind: "archetype", name: "The Radiant Path", cost: ARCHETYPE_UNLOCK_COST, currency: "relics", grants: "radiant" },
  { id: "unlock_circle", kind: "archetype", name: "The Prosperity Circle", cost: ARCHETYPE_UNLOCK_COST, currency: "relics", grants: "circle" },
  { id: "unlock_visitors", kind: "archetype", name: "The Visitors' Fellowship", cost: ARCHETYPE_UNLOCK_COST, currency: "relics", grants: "visitors" },
  // recolors — shards only (cosmetic dust from Spectator+ betting / events)
  { id: "recolor_ember", kind: "recolor", name: "Ember Recolor", cost: 200, currency: "shards", grants: "recolor_ember" },
  { id: "recolor_frost", kind: "recolor", name: "Frost Recolor", cost: 200, currency: "shards", grants: "recolor_frost" },
  // recap frames — the sellable, advertising cosmetics (§25/§36): real money
  { id: "frame_neon", kind: "recap_frame", name: "Neon Sigil Frame", cost: 499, currency: "money", grants: "frame_neon" },
  { id: "frame_gilded", kind: "recap_frame", name: "Gilded Testament Frame", cost: 799, currency: "money", grants: "frame_gilded" },
];

export interface Wallet {
  relics: number;
  shards: number;
  unlocks: string[];
}

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.id === id);
}

/**
 * Two archetypes are free for everyone each day (§22), rotated deterministically
 * so the whole world shares the same free pair (and nobody is locked out).
 */
export function freeRotation(day: number): Archetype[] {
  const a = day % ALL_ARCHETYPES.length;
  const b = (a + 1 + (day % 3)) % ALL_ARCHETYPES.length;
  const second = b === a ? (b + 1) % ALL_ARCHETYPES.length : b;
  return [ALL_ARCHETYPES[a]!, ALL_ARCHETYPES[second]!];
}

/** Can this wallet play this archetype right now (owned or in the free pair)? */
export function canPlayArchetype(wallet: Wallet, archetype: Archetype, day: number): boolean {
  return wallet.unlocks.includes(archetype) || freeRotation(day).includes(archetype);
}

export interface PurchaseResult {
  ok: boolean;
  reason?: string;
  wallet: Wallet;
}

/**
 * Attempt to buy a catalog item. `moneyPaid` is the verified real-money
 * authorization (cents) from the payment provider for `money`-priced items —
 * the server passes it only after the charge succeeds. Relic/shard items ignore
 * it. Returns a NEW wallet on success; never mutates the input.
 */
export function purchase(wallet: Wallet, itemId: string, moneyPaid = 0): PurchaseResult {
  const item = catalogItem(itemId);
  if (!item) return { ok: false, reason: "unknown item", wallet };
  if (wallet.unlocks.includes(item.grants)) return { ok: false, reason: "already owned", wallet };

  // POLICY: real money never yields relics, and relics are never sold for money.
  // No catalog item violates this, but guard against a mispriced future item.
  if (item.currency === "money" && item.kind === "archetype") {
    return { ok: false, reason: "archetypes are earned with Relics, never bought", wallet };
  }

  const next: Wallet = { relics: wallet.relics, shards: wallet.shards, unlocks: [...wallet.unlocks] };
  switch (item.currency) {
    case "relics":
      if (wallet.relics < item.cost) return { ok: false, reason: "not enough Relics", wallet };
      next.relics -= item.cost;
      break;
    case "shards":
      if (wallet.shards < item.cost) return { ok: false, reason: "not enough Shards", wallet };
      next.shards -= item.cost;
      break;
    case "money":
      if (moneyPaid < item.cost) return { ok: false, reason: "payment not authorized", wallet };
      break; // money is collected by the payment provider, not the wallet
  }
  next.unlocks.push(item.grants);
  return { ok: true, wallet: next };
}
