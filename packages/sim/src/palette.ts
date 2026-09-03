/**
 * Visual identity (§30) as data: territory colors, archetype patterns, district
 * tints, terrain, entity colors. Pure functions over (x, y, state) so the PixiJS
 * client and the headless screenshot/recap renderers produce identical pixels.
 *
 * Pattern redundancy is the colorblind-safety mechanism: Dawn=radiating-crack,
 * Radiant=gradient-bloom, Circle=pinstripe, Visitors=starfield.
 */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** 24 high-contrast territory colors (§30); index = (playerId − 1) mod 24. */
export const PLAYER_COLORS: readonly string[] = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#46f0f0",
  "#f032e6", "#bcf60c", "#fabebe", "#008080", "#e6beff", "#9a6324",
  "#fffac8", "#800000", "#aaffc3", "#808000", "#ffd8b1", "#000075",
  "#808080", "#ffe119", "#a9a9a9", "#f5f5f5", "#fa8072", "#7fffd4",
];

/** Splinter Sects render as desaturated parents (§16); ids ≥ 900. */
export const SPLINTER_COLOR = "#7a6f7a";

/**
 * Ground color under a BUILT lot, by district — the zoning read (§2 rev. 3).
 * Residential districts get proper lawn greens; the core/commercial strip is
 * concrete; industrial is gravel. Empty yards do NOT use these — they render
 * as open biome ground, so the town no longer sits on a pale blob.
 */
export const NEUTRAL_BY_DISTRICT: readonly string[] = [
  "#9aa372", // 0: None - unzoned fallback — grassy
  "#326e1c", // 1: Suburbs — rich dark green lawn
  "#3c8223", // 2: College — deep quad green
  "#c6c0b2", // 3: Downtown — concrete
  "#2e6319", // 4: Old Town — dark sage green lawn
  "#bba577", // 5: Trailer — dry dirt lot
  "#c0b7ab", // 6: Commercial — concrete commercial tint
  "#cbd0d4", // 7: Industrial — gravel gray
  "#bcae8c", // 8: ResHigh — warm paver ring
];

export const TERRAIN_COLORS = {
  woods: "#3a5a30",
  woodsAlt: "#456b39", // dappled canopy
  lake: "#33506e",
  lakeAlt: "#3c5d80", // ripple
  road: "#a89880",
  roadLine: "#bcae96", // center line
} as const;

export const COLOR_APOSTATE = "#5a4a4a";
export const COLOR_APOSTATE_ALT = "#665050";

export const ENTITY_COLORS = {
  buildingBody: "#2b2b2b",
  buildingTrim: "#efe6d0",
  buildingSite: "#8a8a8a", // under construction
  buildingDown: "#6b3535", // disabled
  landmark: "#ffe119",
  landmarkTrim: "#7a6300",
  courier: "#ffd700",
  van: "#f8f8ff",
  agent: "#222233",
  pylon: "#ff5555",
  picket: "#ff66ff",
  satellite: "#9bf6ff",
} as const;

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : n | 0;
}

export function shade(rgb: RGB, factor: number): RGB {
  return [clampByte(rgb[0] * factor), clampByte(rgb[1] * factor), clampByte(rgb[2] * factor)];
}

/** Deterministic per-pixel hash for starfield sparkle. */
function pixHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export type Archetype = "dawn" | "radiant" | "circle" | "visitors";

/**
 * Archetype territory pattern (§30), evaluated per *pixel* of the rendered
 * tile (px, py are pixel coordinates at the chosen tile scale).
 */
export function territoryPixel(base: RGB, archetype: string, px: number, py: number): RGB {
  switch (archetype) {
    case "dawn":
    case "final_dawn": {
      // Radiating-crack: molten crimson ember veins + sulfur sparks
      if ((px + py) % 7 === 0 || (px - py + 14) % 7 === 0) return hexToRgb("#b82e1f");
      if ((px * 3 + py * 5) % 19 === 0) return hexToRgb("#f3c334");
      return shade(base, 0.68);
    }
    case "radiant":
    case "radiant_path": {
      // Watercolor bloom: soft vertical breathing with lavender & sage botanical speckles
      if ((px * 11 + py * 7) % 17 === 0) return hexToRgb("#9678b6");
      if ((px * 5 + py * 13) % 19 === 0) return hexToRgb("#7aa364");
      const t = (py % 8) / 8;
      return shade(base, 0.92 + 0.16 * t);
    }
    case "circle":
    case "prosperity_circle": {
      // Executive pinstripe: crisp metallic gold pinlines on midnight ground
      if (px % 4 === 0) return hexToRgb("#c5a059");
      if (px % 4 === 1) return shade(base, 0.72);
      return base;
    }
    case "visitors":
    case "visitors_fellowship": {
      // Cosmic starfield: glowing cyan & violet nebula stars on deep space field
      const h = pixHash(px, py);
      if (h % 19 === 0) return hexToRgb("#00f0ff");
      if (h % 13 === 0) return hexToRgb("#a78bfa");
      return shade(base, 0.88);
    }
    default:
      return base;
  }
}

/** Splinter ids render desaturated regardless of archetype (§16). */
export function colorForPlayer(id: number): string {
  if (id >= 900) return SPLINTER_COLOR;
  return PLAYER_COLORS[(id - 1) % PLAYER_COLORS.length]!;
}
