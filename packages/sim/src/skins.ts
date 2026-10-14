/**
 * Cosmetic skins (monetization-safe by construction).
 *
 * A skin is PRESENTATION ONLY: it is never stored in SimState, never hashed,
 * never read by a simulation step — so no skin can ever desync a lockstep
 * match or change an outcome. Loadouts travel beside the match (lobby →
 * client → `RenderOpts.skins`) and the renderer resolves colours through
 * `skinnedPlayerColor`. New cosmetics = one `registerSkin` call + a store item
 * whose `grants` is the skin id.
 */
export type SkinSlot = "livery";

export interface SkinDefinition {
  id: string;
  name: string;
  slot: SkinSlot;
  /** Territory / building / banner tint (replaces the seat colour). */
  color: string;
  /** Highlight used for building glows and van trim. */
  accent: string;
}

/** What one player wears. Unknown ids are ignored (render falls back to defaults). */
export interface SkinLoadout {
  livery?: string;
}

const SKINS = new Map<string, SkinDefinition>();

export function registerSkin(def: SkinDefinition): void {
  if (SKINS.has(def.id)) throw new Error(`skin already registered: ${def.id}`);
  SKINS.set(def.id, def);
}

export function getSkin(id: string | undefined): SkinDefinition | undefined {
  return id ? SKINS.get(id) : undefined;
}

export function listSkins(): readonly SkinDefinition[] {
  return [...SKINS.values()];
}

/** Keep only well-formed, registered skin ids (server-side sanitisation). */
export function sanitizeLoadout(raw: unknown, owns: (id: string) => boolean = () => true): SkinLoadout {
  const out: SkinLoadout = {};
  if (raw && typeof raw === "object") {
    const livery = (raw as Record<string, unknown>)["livery"];
    if (typeof livery === "string" && getSkin(livery)?.slot === "livery" && owns(livery)) out.livery = livery;
  }
  return out;
}

// ---- base-game cosmetics (store items `recolor_ember` / `recolor_frost`) ----
registerSkin({ id: "recolor_ember", name: "Ember", slot: "livery", color: "#e0542a", accent: "#ffb347" });
registerSkin({ id: "recolor_frost", name: "Frost", slot: "livery", color: "#7fd3f7", accent: "#e8f7ff" });
