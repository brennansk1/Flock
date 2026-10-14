/**
 * The cult-archetype registry (a leaf: engine modules import it freely).
 * Base-game cults are registered by `builtin.ts`, which the package entry
 * imports LAST so every engine module is initialised first. An
 * expansion calls `registerArchetype(def)` at boot (on every client AND the
 * server, before any match is created) and the whole engine — balance
 * loading, kit dispatch, passives, victory, bots, menus — picks it up.
 */
import type { ArchetypeDefinition, ArchetypeId, AbilityDefinition } from "./types.js";

const REGISTRY = new Map<ArchetypeId, ArchetypeDefinition>();
/** Ability id → owning archetype + definition (ability ids are globally unique). */
const ABILITIES = new Map<string, { arch: ArchetypeId; def: AbilityDefinition }>();

export function registerArchetype(def: ArchetypeDefinition): void {
  if (REGISTRY.has(def.id)) throw new Error(`archetype already registered: ${def.id}`);
  for (const a of def.abilities) {
    if (ABILITIES.has(a.id)) throw new Error(`ability id collision: ${a.id}`);
  }
  REGISTRY.set(def.id, def);
  for (const a of def.abilities) ABILITIES.set(a.id, { arch: def.id, def: a });
}

/** Built-in ids, in canonical (registration) order. */
export const BUILTIN_ARCHETYPES = ["dawn", "radiant", "circle", "visitors"] as const;
export type BuiltinArchetypeId = (typeof BUILTIN_ARCHETYPES)[number];

export function getArchetype(id: ArchetypeId): ArchetypeDefinition {
  const d = REGISTRY.get(id);
  if (!d) throw new Error(`unknown archetype: ${id}`);
  return d;
}

export function hasArchetype(id: ArchetypeId): boolean {
  return REGISTRY.has(id);
}

/** Every registered archetype, in registration order (deterministic). */
export function listArchetypes(): readonly ArchetypeDefinition[] {
  return [...REGISTRY.values()];
}

export function archetypeIds(): ArchetypeId[] {
  return [...REGISTRY.keys()];
}

export function findAbility(id: string): { arch: ArchetypeId; def: AbilityDefinition } | undefined {
  return ABILITIES.get(id);
}
