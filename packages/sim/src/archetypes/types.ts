/**
 * The modular cult-archetype contract (DLC-ready).
 *
 * Every cult — base game or expansion — is ONE `ArchetypeDefinition` dropped
 * into the registry. The engine never branches on archetype ids; it asks the
 * registry for coefficients, kit abilities, passive hooks, the cult's own
 * victory path and bot preferences.
 *
 * Determinism contract: every hook runs inside the lockstep sim. Hooks must
 * use Q16.16 fixed-point (`fixed.ts`) and the seeded RNG only — no
 * Math.random, no Date, no float accumulation. `theme` is presentation data
 * and must never be read by simulation code.
 */
import type { Fixed } from "../fixed.js";
import type { Balance } from "../balance.js";
import type { PlayerId, PlayerState, SimState, TileId } from "../types.js";
import type { VictoryStats } from "../victory.js";

/** Archetype ids are open strings so expansions can register new cults. */
export type ArchetypeId = string;

/** Float tuning defaults (converted at balance load, never in-tick). */
export interface ArchetypeCoeffDefaults {
  r0: number;
  retain: number;
  income: number;
  heat: number;
  growth: number;
}

export interface AbilityCost {
  usd?: Fixed;
  faith?: Fixed;
}

export type AbilityTargeting = "none" | "tile" | "district";

export interface AbilityContext {
  s: SimState;
  p: PlayerState;
  b: Balance;
  /** Target tile, or -1 when the intent carried none. */
  target: TileId;
}

export interface AbilityDefinition {
  id: string;
  name: string;
  blurb: string;
  /** HUD placement: primary/secondary actives or the signature power. */
  slot: "primary" | "secondary" | "signature";
  targeting: AbilityTargeting;
  /** Bot targeting hint: the frontier (default), own ground, a rival, or anywhere. */
  aim?: "frontier" | "own" | "rival" | "remote";
  cooldownKey: string;
  cooldownTicks: number;
  /** Current price (Fixed). The host checks & charges it. */
  cost(p: PlayerState): AbilityCost;
  /** Target validation, after cooldown/affordability checks, before charging. */
  validate(ctx: AbilityContext): boolean;
  /** The effect, run after the cost is charged and before the cooldown starts. */
  effect(ctx: AbilityContext): void;
}

/** The SIGNATURE intent (a once-per-match or charge-gated power). */
export interface SignatureDefinition {
  name: string;
  blurb: string;
  apply(s: SimState, p: PlayerState, b: Balance): void;
}

/** Engine hook points. All optional; absent = neutral (×1 / no-op). */
export interface ArchetypePassives {
  /** Global attack-pressure multiplier. */
  attackMult?(s: SimState, p: PlayerState): Fixed;
  /** Defender retention multiplier applied at the civic-bonus stage. */
  retainCivicMult?(s: SimState, defender: PlayerState, civics: Map<number, PlayerId>): Fixed;
  /** Defender retention multiplier for a specific held tile. */
  retainTileMult?(s: SimState, defender: PlayerState, t: TileId): Fixed;
  /** A tile of `loser` was just captured. Return true if the hook consumed the flip. */
  onTileLost?(s: SimState, b: Balance, loser: PlayerState, t: TileId, prevOwner: PlayerId): boolean;
  /** `p` just captured `t`; `worked` = a cohort worked it this tick (vs ambient creep). */
  onTileCaptured?(s: SimState, p: PlayerState, t: TileId, worked: boolean): void;
  /** Courier cargo multiplier. */
  courierMult?(s: SimState, p: PlayerState): Fixed;
  /** Transforms the follower-loss percent a published scandal inflicts. */
  scandalLossPct?(pct: Fixed): Fixed;
  /** True if this player's strikes skip the rival warning banner. */
  hidesStrikeWarning?(s: SimState, p: PlayerState): boolean;
}

/** An archetype-exclusive route to victory, telegraphed to every player. */
export interface VictoryPathDefinition {
  id: string;
  name: string;
  blurb: string;
  /** Progress toward the win in permille (0..1000), for the Victory Race HUD. */
  progress(s: SimState, p: PlayerState, b: Balance, st: VictoryStats): number;
  /** True when the win condition is met this tick (then the Ascension countdown runs). */
  achieved(s: SimState, p: PlayerState, b: Balance, st: VictoryStats): boolean;
}

/** Presentation-only identity (menus, HUD accents, recap). Never read by the sim. */
export interface ArchetypeTheme {
  name: string;
  short: string;
  tagline: string;
  /** One-paragraph "how this cult plays" pitch for the select screen. */
  playstyle: string;
  /** 1 = forgiving, 3 = expert. */
  difficulty: 1 | 2 | 3;
  accent: string;
  glyph: string;
}

export interface ArchetypeDefinition {
  id: ArchetypeId;
  coeffs: ArchetypeCoeffDefaults;
  abilities: readonly AbilityDefinition[];
  signature?: SignatureDefinition;
  passives: ArchetypePassives;
  victory?: VictoryPathDefinition;
  bot: {
    /** Key lots this cult's bots siege first (its victory ground). */
    prefLots: readonly number[];
    /** Doctrine build order for bots. */
    doctrine: readonly string[];
  };
  theme: ArchetypeTheme;
}
