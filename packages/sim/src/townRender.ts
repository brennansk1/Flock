/**
 * Town renderer — Mundane Falls as pixels, shared by the PixiJS client and
 * every headless renderer (screenshots, recap cards). Pure function of
 * SimState → RGBA buffer, so all viewers see the identical town.
 *
 * Visual grammar (§30, reframed for the city map):
 *  - streets: asphalt with dashes and sidewalks; lots form blocks
 *  - houses where pop ≥ 3 (district-styled roofs; downtown = lit blocks),
 *    yards/gardens elsewhere; owned lots tint toward the cult color with the
 *    archetype pattern in the lawn
 *  - PEOPLE ARE DOTS: every few residents render as a dot, colored by their
 *    cult (gray when unconverted). Dots live: they leave home, walk the
 *    streets Manhattan-style, visit buildings — cult buildings draw their
 *    congregation, landmarks draw crowds — and walk home. Movement is a pure
 *    hash of (tile, dot, tick), zero sim state, identical on every screen.
 *  - cult buildings render as 8×8 icons (chapel, plate, tower, antenna…)
 *    in the owner's color; landmarks get gold icons
 */

import {
  NEUTRAL,
  Terrain,
  TileState,
  Landmark,
  Lot,
  type SimState,
  type Building,
  type World,
} from "./types.js";
import { toFloat } from "./fixed.js";
import { watchtowerSees } from "./buildings.js";
import {
  hexToRgb,
  shade,
  territoryPixel,
  colorForPlayer,
  NEUTRAL_BY_DISTRICT,
  COLOR_APOSTATE,
  type RGB,
  type Archetype,
} from "./palette.js";

export const TILE_PX = 8;

// ---------------------------------------------------------------- sprites

/** 8×8 icon bitmaps: '.'=ground, '#'=dark outline, 'o'=owner color, '*'=accent. */
const ICONS: Record<Building["type"], string[]> = {
  // the meeting hall: gold cross on the ridge, gabled roof, lit windows
  // flanking a dark double door — a BUILDING first, a symbol second
  compound: [
    "...*....",
    "..***...",
    "...*....",
    ".######.",
    "#oooooo#",
    "#o#oo#o#",
    "#o.##.o#",
    "########",
  ],
  collection_plate: [
    "........",
    "..####..",
    ".#*##*#.",
    ".#####o.",
    ".o#####.",
    ".#*##*#.",
    "..####..",
    "........",
  ],
  // legged tower with a cabin and a searchlight sweeping off the corner
  watchtower: [
    "*.####..",
    ".*#oo#*.",
    ".######.",
    "..#oo#..",
    "...##...",
    "...##...",
    "..#..#..",
    ".##..##.",
  ],
  // guyed mast radiating over its equipment shed
  broadcast_tower: [
    "*..##..*",
    ".*.##.*.",
    "..#..#..",
    "...##...",
    "..#..#..",
    ".######.",
    ".#o##o#.",
    ".######.",
  ],
  supplement_lab: [
    "...##...",
    "...##...",
    "...##...",
    "..#oo#..",
    ".#oooo#.",
    ".#o**o#.",
    ".#oooo#.",
    "..####..",
  ],
  satellite: [
    "........",
    "...**...",
    "..####..",
    ".#oooo#.",
    "########",
    "..#..#..",
    ".#....#.",
    "........",
  ],
};

const LANDMARK_ICON: Record<number, string[]> = {
  // a tall guyed broadcast mast with a blinking top accent — taller/leaner than
  // the player Broadcast Tower so the landmark reads as a grand fixture.
  [Landmark.RadioTower]: [
    "...*....",
    "...#....",
    "..#o#...",
    "..#o#...",
    ".#o#o#..",
    ".#o#o#..",
    "#o#.#o#.",
    "#.....#.",
  ],
  // a megachurch: broad nave with a cross-topped spire and a rose window.
  [Landmark.Megachurch]: [
    "...*....",
    "...#....",
    "..#o#...",
    ".#ooo#..",
    ".#o*o#..",
    "#ooooo#.",
    "#o#o#o#.",
    "#######.",
  ],
  [Landmark.TownHall]: [
    "..****..",
    ".######.",
    ".#o##o#.",
    ".######.",
    ".#o##o#.",
    ".#o##o#.",
    ".######.",
    "########",
  ],
  [Landmark.Fairground]: [
    "...*....",
    "..***...",
    ".*****..",
    "*******.",
    "..#.#...",
    "..#.#...",
    ".##.##..",
    "........",
  ],
  [Landmark.WaterTower]: [
    "..####..",
    ".#oooo#.",
    ".#oooo#.",
    "..####..",
    "..#..#..",
    "..#..#..",
    ".#....#.",
    ".######.",
  ],
};

const DEFAULT_COLORS = {
  asphalt: hexToRgb("#6f6b66"),
  asphaltDash: hexToRgb("#b9b3a6"),
  sidewalk: hexToRgb("#9a958e"),
  wall: hexToRgb("#ddd2bd"),
  wallShade: hexToRgb("#c4b9a4"),
  door: hexToRgb("#5d4a33"),
  windowLit: hexToRgb("#ffd76a"),
  windowDark: hexToRgb("#3c4654"),
  block: hexToRgb("#8e8a84"),
  blockShade: hexToRgb("#7a766f"),
  iconDark: hexToRgb("#1c1c1c"),
  iconAccent: hexToRgb("#ffd76a"),
  landmarkGold: hexToRgb("#e9c46a"),
  personNeutral: hexToRgb("#7a6a58"), // warm putty — reads on asphalt AND lawn
  scorched: hexToRgb(COLOR_APOSTATE),
  waterDeep: hexToRgb("#33506e"),
  waterRipple: hexToRgb("#456c92"),
  canopy: hexToRgb("#3a5a30"),
  canopyLight: hexToRgb("#4f7440"),
  trunk: hexToRgb("#4a3a26"),
  meadow: hexToRgb("#829c5e"),
  meadowLight: hexToRgb("#90aa6c"),
  scrub: hexToRgb("#8d9a6a"),
  cropGold: hexToRgb("#c9a84c"),
  cropRow: hexToRgb("#a98c3a"),
  dirt: hexToRgb("#9a8164"),
  dirtEdge: hexToRgb("#86704f"),
  highwayLine: hexToRgb("#e0c34a"),
  sand: hexToRgb("#d8c89a"),
  waterGlint: hexToRgb("#9fc6e0"),
  canopyDark: hexToRgb("#2e4a26"),
  shoulder: hexToRgb("#8a8378"),
  flowerY: hexToRgb("#e8d24a"),
  flowerW: hexToRgb("#e8e4d8"),
  fence: hexToRgb("#8a7a5c"),
  grassHigh: hexToRgb("#a0ba7a"),
  grassLow: hexToRgb("#6e884d"),
  unitGlass: hexToRgb("#2a3550"),
  unitShadow: hexToRgb("#33302a"),
  rock: hexToRgb("#9c968a"),
  rockShade: hexToRgb("#7c766c"),
  bush: hexToRgb("#5a7340"),
  shadow: hexToRgb("#6f7a52"),
  plank: hexToRgb("#8a6f4d"),
  plankDark: hexToRgb("#745a3c"),
  rail: hexToRgb("#5d4a33"),
  crosswalk: hexToRgb("#d8d4c8"),
  glass: hexToRgb("#cfe8e2"),
  glassFrame: hexToRgb("#8fb0a8"),
  sandBg: hexToRgb("#d9c791"),
  sandDark: hexToRgb("#c9b57e"),
  sandScrub: hexToRgb("#a89a68"),
  cactus: hexToRgb("#4e7a3a"),
  cactusDark: hexToRgb("#3c6030"),
  forestFloor: hexToRgb("#8ba06c"),
  pathStone: hexToRgb("#b8b2a4"),
  pathEdge: hexToRgb("#9a958e"),
  cowWhite: hexToRgb("#e8e4d8"),
  cowBrown: hexToRgb("#8a5a3a"),
  wire: hexToRgb("#3a352e"),
  ballast: hexToRgb("#8a8178"),
  tie: hexToRgb("#5a4634"),
  railSteel: hexToRgb("#4a4a52"),
  boxcarA: hexToRgb("#8a4a3a"),
  boxcarB: hexToRgb("#6a6e54"),
  elevator: hexToRgb("#c8c2b4"),
  willowL: hexToRgb("#8eb85c"),
  willowD: hexToRgb("#628a38"),
};

const C = { ...DEFAULT_COLORS };
let currentSeason = "summer";
let currentTimeOfDay = "day";

/** Town building styles: [body, roof, accent]. */
const LOT_STYLE: Record<number, [RGB, RGB, RGB]> = {
  [Lot.Shop]: [hexToRgb("#cbb89a"), hexToRgb("#8c8c8c"), hexToRgb("#c8554a")],
  [Lot.Supermarket]: [hexToRgb("#d8d2c4"), hexToRgb("#b8b2a4"), hexToRgb("#3f7fbf")],
  [Lot.Diner]: [hexToRgb("#d7d7dc"), hexToRgb("#a9a9b4"), hexToRgb("#d23b3b")],
  [Lot.School]: [hexToRgb("#b0563f"), hexToRgb("#5f4a40"), hexToRgb("#f0e6d0")],
  [Lot.Library]: [hexToRgb("#bcb4a2"), hexToRgb("#968e7c"), hexToRgb("#6a6256")],
  [Lot.Chapel]: [hexToRgb("#efe9da"), hexToRgb("#7d7468"), hexToRgb("#efe9da")],
  [Lot.GasStation]: [hexToRgb("#d8d2c4"), hexToRgb("#cc4444"), hexToRgb("#f2d23b")],
  [Lot.Sheriff]: [hexToRgb("#b8ab90"), hexToRgb("#857a60"), hexToRgb("#caa53a")],
  [Lot.Office]: [hexToRgb("#9aa0a8"), hexToRgb("#7e848c"), hexToRgb("#cfd8e2")],
  [Lot.Barn]: [hexToRgb("#a8392e"), hexToRgb("#7e2b22"), hexToRgb("#efe6d0")],
  [Lot.Silo]: [hexToRgb("#c4c8cc"), hexToRgb("#9b9fa3"), hexToRgb("#8a8e92")],
  [Lot.Church]: [hexToRgb("#e7e0cf"), hexToRgb("#6f6456"), hexToRgb("#caa53a")],
  [Lot.Bank]: [hexToRgb("#d6cfb8"), hexToRgb("#b0a888"), hexToRgb("#3f5e7a")],
  [Lot.PostOffice]: [hexToRgb("#c9cdd2"), hexToRgb("#3f5e7a"), hexToRgb("#c8554a")],
  [Lot.FireStation]: [hexToRgb("#b03a30"), hexToRgb("#8c2c24"), hexToRgb("#e8e4d8")],
  [Lot.Factory]: [hexToRgb("#9a9088"), hexToRgb("#736a62"), hexToRgb("#5a5450")],
  [Lot.Motel]: [hexToRgb("#cabf9c"), hexToRgb("#7a6f58"), hexToRgb("#3fa0bf")],
  [Lot.Cinema]: [hexToRgb("#3a3f52"), hexToRgb("#2c3040"), hexToRgb("#ffd76a")],
  [Lot.HighSchool]: [hexToRgb("#9a5a42"), hexToRgb("#463e3a"), hexToRgb("#f0e6d0")],
  [Lot.Warehouse]: [hexToRgb("#aaa49a"), hexToRgb("#8a847a"), hexToRgb("#5f6670")],
  [Lot.GrainElevator]: [hexToRgb("#c8c2b4"), hexToRgb("#a8a294"), hexToRgb("#8a4a3a")],
  [Lot.Depot]: [hexToRgb("#9a5a42"), hexToRgb("#7a4634"), hexToRgb("#e8e4d8")],
  [Lot.Greenhouse]: [hexToRgb("#cfe8e2"), hexToRgb("#8fb0a8"), hexToRgb("#efe9da")],
  [Lot.Dam]: [hexToRgb("#8c8c8c"), hexToRgb("#5c5c5c"), hexToRgb("#cbe3f0")],
  [Lot.WaterTower]: [hexToRgb("#cbd2d6"), hexToRgb("#8a9399"), hexToRgb("#8a9399")],
  [Lot.Substation]: [hexToRgb("#8c8c8c"), hexToRgb("#5c5c5c"), hexToRgb("#caa53a")],
  [Lot.Lighthouse]: [hexToRgb("#f0ece2"), hexToRgb("#c0392b"), hexToRgb("#ffe88a")],
  [Lot.Cannery]: [hexToRgb("#7d8a94"), hexToRgb("#5d6a74"), hexToRgb("#d8e4ec")],
  [Lot.Sawmill]: [hexToRgb("#8a6a48"), hexToRgb("#6a4e32"), hexToRgb("#d8c89a")],
};

/** roof palettes by district */
const ROOFS: RGB[] = [
  hexToRgb("#8a7a6a"), // 0: none
  hexToRgb("#a4543e"), // 1: suburbs — terracotta
  hexToRgb("#7a4e3a"), // 2: college — brick
  hexToRgb("#5f6670"), // 3: downtown — slate
  hexToRgb("#54483a"), // 4: old town — weathered shake
  hexToRgb("#9c9489"), // 5: trailer — tin
  hexToRgb("#4c535c"), // 6: commercial — dark slate
  hexToRgb("#8c8c8c"), // 7: industrial — tin
  hexToRgb("#b2614b"), // 8: ResHigh — terracotta brick
];

const DISTRICT_WALLS: Record<number, RGB[]> = {
  1: [ // Suburbs
    hexToRgb("#ddd2bd"), // warm beige
    hexToRgb("#e8e0d0"), // cream
    hexToRgb("#d6cdc0"), // grey-beige
    hexToRgb("#c9d2c2"), // sage siding
    hexToRgb("#d9c9b0"), // butter tan
  ],
  2: [ // College
    hexToRgb("#cbbca8"), // warm tan
    hexToRgb("#b0a490"), // brown tan
    hexToRgb("#dcd3c5"), // light tan
    hexToRgb("#c2b49e"), // oat
  ],
  3: [ // Downtown
    hexToRgb("#ddd2bd"),
    hexToRgb("#cbbca8"),
    hexToRgb("#dcd3c5"),
  ],
  4: [ // Old Town
    hexToRgb("#c8cbb4"), // sage/grey
    hexToRgb("#bca89a"), // weathered wood
    hexToRgb("#efe9da"), // clean white
    hexToRgb("#c4b4c2"), // faded lilac (painted lady)
    hexToRgb("#b2bcc0"), // slate blue-grey
  ],
  5: [ // Trailer
    hexToRgb("#cbd6c8"), // pale green
    hexToRgb("#c8cbd6"), // pale blue
    hexToRgb("#d6cac8"), // pale pinkish
    hexToRgb("#d8d4c4"), // sun-bleached cream
  ],
  8: [ // ResHigh
    hexToRgb("#c8b0a0"), // reddish brick
    hexToRgb("#b8ab90"), // warm stone
    hexToRgb("#dcd2be"), // warm beige
    hexToRgb("#b5a493"), // brownstone
  ]
};

function pixHash(x: number, y: number, z = 0): number {
  let h = (x * 374761393 + y * 668265263 + z * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Smooth 0..1 value noise over a coarse lattice (cosine-interpolated). */
function valueNoise(x: number, y: number, cell: number, z = 0): number {
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = (1 - Math.cos((gx - x0) * Math.PI)) / 2;
  const fy = (1 - Math.cos((gy - y0) * Math.PI)) / 2;
  const at = (ix: number, iy: number): number => (pixHash(ix, iy, z) % 1000) / 1000;
  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const d = at(x0 + 1, y0 + 1);
  const top = a * (1 - fx) + b * fx;
  const bot = c * (1 - fx) + d * fx;
  return top * (1 - fy) + bot * fy;
}

export interface RenderOpts {
  /** viewing player for fog + own-agent markers; 0 = omniscient (spectator) */
  viewer?: number;
  /** precomputed fog (1 = visible) or null for no fog */
  fog?: Uint8Array | null;
  /** animation clock; pass sim.tick */
  frameTick?: number;
  /**
   * Level of detail: output pixels per logical sub-pixel. 1 = overview
   * (whole map, 8px/tile); 2+ = zoomed in, where extra fine detail is drawn
   * (window mullions, brick courses, finer terrain texture). The client picks
   * this from the zoom level and renders only the visible `view`.
   */
  lod?: number;
  /** visible tile rectangle to render; omitted = the whole map. */
  view?: { x: number; y: number; w: number; h: number };
  /** Season variant for map colors. Defaults to "summer". */
  season?: "spring" | "summer" | "fall" | "winter";
  /** Time of day variant for map lighting. Defaults to "day". */
  timeOfDay?: "dawn" | "day" | "dusk" | "night";
  /** Overlay per-district dissent heatmap. */
  showDissent?: boolean;
  /**
   * March pace for rendering mission cohorts (balance.missions
   * .marchTicksPerTile). Defaults to the shipped balance value so headless
   * renders match; pass the live value when balance is hot-patched.
   */
  marchTicksPerTile?: number;
}

export interface RenderedFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function renderTown(sim: SimState, opts: RenderOpts = {}): RenderedFrame {
  const w = sim.world;
  const S = Math.max(1, Math.floor(opts.lod ?? 1)); // output px per logical px
  // viewport in tile coords (clamped to the map)
  const vx = Math.max(0, Math.min(w.width - 1, opts.view?.x ?? 0));
  const vy = Math.max(0, Math.min(w.height - 1, opts.view?.y ?? 0));
  const vw = Math.max(1, Math.min(w.width - vx, opts.view?.w ?? w.width));
  const vh = Math.max(1, Math.min(w.height - vy, opts.view?.h ?? w.height));
  const W = vw * TILE_PX * S;
  const H = vh * TILE_PX * S;
  const data = new Uint8ClampedArray(W * H * 4);
  const tick = opts.frameTick ?? sim.tick;
  const fog = opts.fog ?? null;

  // Extract seasonal + time of day choices
  const season = opts.season ?? "summer";
  const timeOfDay = opts.timeOfDay ?? "day";
  currentSeason = season;
  currentTimeOfDay = timeOfDay;

  // Reset global color palette to default state
  Object.assign(C, DEFAULT_COLORS);

  // Apply seasonal palette modifications
  if (season === "spring") {
    C.meadow = hexToRgb("#6da344"); // vibrant fresh spring green
    C.meadowLight = hexToRgb("#82b955");
    C.grassHigh = hexToRgb("#9ad56c");
    C.grassLow = hexToRgb("#568f30");
    C.canopy = hexToRgb("#4c8a40"); // soft new-leaf green (muted)
    C.canopyLight = hexToRgb("#dcbcca"); // dusty-rose blossoms (muted)
    C.canopyDark = hexToRgb("#3b6b32");
    C.willowL = hexToRgb("#9cba74");
    C.willowD = hexToRgb("#799c48");
  } else if (season === "fall") {
    C.meadow = hexToRgb("#a49e60"); // dry golden rust meadow
    C.meadowLight = hexToRgb("#baa570");
    C.grassHigh = hexToRgb("#caa560");
    C.grassLow = hexToRgb("#7c6838");
    C.canopy = hexToRgb("#b06f33"); // russet orange (muted)
    C.canopyLight = hexToRgb("#c0a052"); // dry ochre gold (muted)
    C.canopyDark = hexToRgb("#96473a"); // brick red (muted)
    C.willowL = hexToRgb("#bd9a4d");
    C.willowD = hexToRgb("#94743a");
  } else if (season === "winter") {
    C.meadow = hexToRgb("#eef4f8"); // winter snow
    C.meadowLight = hexToRgb("#ffffff");
    C.grassHigh = hexToRgb("#ffffff");
    C.grassLow = hexToRgb("#dce5ec");
    C.dirt = hexToRgb("#bfaea0");
    C.dirtEdge = hexToRgb("#a29385");
    C.sandBg = hexToRgb("#e8e2cd");
    C.sandDark = hexToRgb("#cbbca4");
    C.canopy = hexToRgb("#5c4c38"); // bare wood branches
    C.canopyLight = hexToRgb("#ffffff"); // snowy caps
    C.canopyDark = hexToRgb("#46392a"); // bare shadow branches
    C.willowL = hexToRgb("#7a6c5a"); // bare winter willows
    C.willowD = hexToRgb("#54483b");
    C.waterDeep = hexToRgb("#aed5e8"); // frozen ice water sheet
    C.waterRipple = hexToRgb("#cbeefc");
    C.waterGlint = hexToRgb("#ffffff");
  }

  // Adjust window colors for night view
  if (timeOfDay === "night") {
    C.windowDark = hexToRgb("#caa23e"); // warm yellow-gold glowing windows
    C.windowLit = hexToRgb("#ffd76a"); // bright glowing windows
  }

  const applyLighting = (rgb: RGB): RGB => {
    if (timeOfDay === "day") return rgb;

    // Check if color is a glowing light source that bypasses lighting masks.
    // At night windowDark is remapped to a warm gold — without bypassing it
    // too, the "glowing" windows were being multiplied down to mud (the
    // houses-don't-glow bug).
    const isLit = (
      (rgb[0] === C.windowLit[0] && rgb[1] === C.windowLit[1] && rgb[2] === C.windowLit[2]) ||
      (timeOfDay === "night" &&
        rgb[0] === C.windowDark[0] && rgb[1] === C.windowDark[1] && rgb[2] === C.windowDark[2]) ||
      (rgb[0] === C.iconAccent[0] && rgb[1] === C.iconAccent[1] && rgb[2] === C.iconAccent[2]) ||
      (rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255) || // white headlight
      (rgb[0] === 255 && rgb[1] === 51 && rgb[2] === 51)      // red taillight
    );
    if (isLit) return rgb;

    if (timeOfDay === "dawn") {
      return [
        Math.min(255, Math.floor(rgb[0] * 1.12 + 15)),
        Math.min(255, Math.floor(rgb[1] * 0.95 + 8)),
        Math.min(255, Math.floor(rgb[2] * 0.82)),
      ];
    } else if (timeOfDay === "dusk") {
      return [
        Math.min(255, Math.floor(rgb[0] * 1.05 + 10)),
        Math.min(255, Math.floor(rgb[1] * 0.82 + 5)),
        Math.min(255, Math.floor(rgb[2] * 1.12 + 10)),
      ];
    } else if (timeOfDay === "night") {
      return [
        Math.floor(rgb[0] * 0.22),
        Math.floor(rgb[1] * 0.32),
        Math.floor(rgb[2] * 0.55),
      ];
    }
    return rgb;
  };

  const archetypeOf = new Map<number, Archetype>();
  for (const p of sim.players) archetypeOf.set(p.id, p.archetype);

  // logical (8px/tile) origin of the viewport
  const ox = vx * TILE_PX;
  const oy = vy * TILE_PX;
  const logW = vw * TILE_PX;
  const logH = vh * TILE_PX;

  // base put: a logical pixel paints an S×S block, offset by the viewport
  const put = (gx: number, gy: number, rgb: RGB): void => {
    const lx = gx - ox;
    const ly = gy - oy;
    if (lx < 0 || ly < 0 || lx >= logW || ly >= logH) return;
    const bx = lx * S;
    const by = ly * S;
    let finalColor = rgb;
    if (opts.showDissent) {
      const tx = (gx / TILE_PX) | 0;
      const ty = (gy / TILE_PX) | 0;
      const t = ty * w.width + tx;
      if (t >= 0 && t < w.dissent.length) {
        const owner = w.owner[t]!;
        if (owner !== NEUTRAL) {
          const dissVal = toFloat(w.dissent[t]!); // 0 to 100
          if (dissVal > 0) {
            const wRed = Math.min(0.7, (dissVal / 100) * 0.7);
            const redColor: RGB = [255, 50, 50];
            finalColor = [
              Math.floor(rgb[0] * (1 - wRed) + redColor[0] * wRed),
              Math.floor(rgb[1] * (1 - wRed) + redColor[1] * wRed),
              Math.floor(rgb[2] * (1 - wRed) + redColor[2] * wRed),
            ];
          }
        }
      }
    }
    const litRgb = applyLighting(finalColor);
    for (let sy = 0; sy < S; sy++) {
      let o = ((by + sy) * W + bx) * 4;
      for (let sx = 0; sx < S; sx++) {
        data[o] = litRgb[0];
        data[o + 1] = litRgb[1];
        data[o + 2] = litRgb[2];
        data[o + 3] = 255;
        o += 4;
      }
    }
  };
  // fine put: one output pixel on the S× sub-grid (for zoom-in detail).
  // fx,fy are in the logical-×S space (i.e. gx*S + subpixel).
  const putF = (fx: number, fy: number, rgb: RGB): void => {
    const lx = fx - ox * S;
    const ly = fy - oy * S;
    if (lx < 0 || ly < 0 || lx >= W || ly >= H) return;
    const o = (ly * W + lx) * 4;
    const litRgb = applyLighting(rgb);
    data[o] = litRgb[0];
    data[o + 1] = litRgb[1];
    data[o + 2] = litRgb[2];
    data[o + 3] = 255;
  };
  // SINGLE LOD (§14): one level of detail — zooming in magnifies the same
  // 8px pixels; the sub-pixel detail channel is permanently off. (putF and
  // the Detail plumbing stay for tooling, but no zoom tier activates them.)
  void putF;
  const detail: Detail | null = null;

  // tile range to draw: only the viewport (+1 margin for spillover detail)
  const tx0 = Math.max(0, vx - 1);
  const ty0 = Math.max(0, vy - 1);
  const tx1 = Math.min(w.width - 1, vx + vw);
  const ty1 = Math.min(w.height - 1, vy + vh);

  // ---- pass 1: ground + lots ----
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = ty * w.width + tx;
      drawTile(sim, t, tx, ty, put, archetypeOf, detail, tick);
      // purchased property: survey stakes + a boundary cord in the owner's
      // color mark bought land in the wilderness (§18 rev.)
      const propOwner = w.property[t]!;
      if (propOwner !== 0 && w.terrain[t] !== Terrain.Citizen && w.terrain[t] !== Terrain.Road) {
        const stake = hexToRgb(colorForPlayer(propOwner));
        const x0p = tx * TILE_PX;
        const y0p = ty * TILE_PX;
        const edgeN = ty === 0 || w.property[t - w.width] !== propOwner;
        const edgeS = ty === w.height - 1 || w.property[t + w.width] !== propOwner;
        const edgeW = tx === 0 || w.property[t - 1] !== propOwner;
        const edgeE = tx === w.width - 1 || w.property[t + 1] !== propOwner;
        // dotted boundary cord along parcel edges only — interiors stay land
        for (let i = 0; i < TILE_PX; i += 2) {
          if (edgeN) put(x0p + i, y0p, stake);
          if (edgeS) put(x0p + i, y0p + TILE_PX - 1, stake);
          if (edgeW) put(x0p, y0p + i, stake);
          if (edgeE) put(x0p + TILE_PX - 1, y0p + i, stake);
        }
      }
    }
  }

  // ---- pass 1.5: WELCOME SIGNS where the highway meets the town line ----
  // "WELCOME TO <town>" boards flank Main Street's ends, derived from the
  // named street records — no extra world state needed.
  {
    const main = w.streets.find((st) => st.name === "Main Street" && st.axis === 0);
    if (main) {
      for (const sx of [main.from - 3, main.to + 3]) {
        if (sx < 1 || sx >= w.width - 1) continue;
        const st2 = (main.at - 1) * w.width + sx;
        if (st2 < 0 || st2 >= w.terrain.length) continue;
        if (w.terrain[st2] !== Terrain.Grass) continue;
        const bx = sx * TILE_PX;
        const by = (main.at - 1) * TILE_PX;
        put(bx + 2, by + 3, C.crosswalk); // the board
        put(bx + 3, by + 3, C.crosswalk);
        put(bx + 4, by + 3, C.crosswalk);
        put(bx + 5, by + 3, C.crosswalk);
        put(bx + 3, by + 4, C.iconAccent); // painted town crest
        put(bx + 2, by + 4, C.crosswalk);
        put(bx + 4, by + 4, C.crosswalk);
        put(bx + 5, by + 4, C.crosswalk);
        put(bx + 3, by + 5, C.trunk); // posts
        put(bx + 5, by + 5, C.trunk);
      }
    }
  }

  // ---- pass 1.6: a parked grain consist on the siding by the elevator ----
  {
    let depot = -1;
    for (let t = 0; t < w.lot.length && depot < 0; t++) if (w.lot[t] === Lot.Depot) depot = t;
    if (depot >= 0) {
      const dy0 = (depot / w.width) | 0;
      let drawn = 0;
      for (let dx = -6; dx <= 6 && drawn < 4; dx++) {
        const x = (depot % w.width) + dx;
        if (x < 0 || x >= w.width) continue;
        for (const yy of [dy0 - 1, dy0 - 2, dy0 + 1]) {
          if (yy < 0 || yy >= w.height) continue;
          const rt = yy * w.width + x;
          if (w.terrain[rt] !== Terrain.Rail) continue;
          const bx = x * TILE_PX;
          const by = yy * TILE_PX;
          const col = pixHash(rt, 1, 88) % 2 === 0 ? C.boxcarA : C.boxcarB;
          for (let px = 0; px < TILE_PX; px++) {
            put(bx + px, by + 2, shade(col, 1.1));
            put(bx + px, by + 3, col);
            put(bx + px, by + 4, col);
            put(bx + px, by + 5, shade(col, 0.8));
          }
          drawn++;
          break;
        }
      }
    }
  }

  // ---- pass 2: landmarks + cult buildings as icons ----
  for (let t = 0; t < w.landmark.length; t++) {
    if (w.landmark[t] !== 0) {
      drawIcon(LANDMARK_ICON[w.landmark[t]!] ?? ICONS.compound, t, w.width, C.landmarkGold, put);
    }
  }
  for (const bd of sim.buildings) {
    if (fog && fog[bd.tile] !== 1) continue;
    const ownerRgb =
      bd.disabledTicks > 0
        ? hexToRgb("#7a3535")
        : bd.buildTicksLeft > 0
          ? hexToRgb("#9a9a9a")
          : hexToRgb(colorForPlayer(bd.player));
    // OWNERSHIP GLOW: every cult building sits in its owner's colored halo —
    // a bright ring around the tile with soft corner falloff, gently
    // breathing with the tick so live buildings read at a glance
    {
      const gx0 = (bd.tile % w.width) * TILE_PX;
      const gy0 = ((bd.tile / w.width) | 0) * TILE_PX;
      const pulse = 1.15 + 0.25 * Math.sin((tick + bd.tile) * 0.12);
      const halo = shade(ownerRgb, pulse);
      const dim = shade(ownerRgb, pulse * 0.62);
      for (let k = 0; k < TILE_PX; k++) {
        // full ring, alternating bright/dim so it shimmers instead of boxing
        const bright = (k + (tick >> 3)) % 2 === 0;
        put(gx0 + k, gy0 - 1, bright ? halo : dim);
        put(gx0 + k, gy0 + TILE_PX, bright ? halo : dim);
        put(gx0 - 1, gy0 + k, bright ? dim : halo);
        put(gx0 + TILE_PX, gy0 + k, bright ? dim : halo);
      }
    }
    drawIcon(ICONS[bd.type], bd.tile, w.width, ownerRgb, put);
    // compounds EXPAND as their cult grows: a perimeter fence appears once the
    // flock is established, then banners fly over a true headquarters (§30)
    if (bd.type === "compound" && bd.buildTicksLeft === 0) {
      const p = sim.players.find((pl) => pl.id === bd.player);
      const permille = p && sim.populated > 0 ? (p.ownedTiles * 1000) / sim.populated : 0;
      const stage = permille >= 150 ? 3 : permille >= 70 ? 2 : 1;
      const bx = (bd.tile % w.width) * TILE_PX;
      const by = ((bd.tile / w.width) | 0) * TILE_PX;
      if (stage >= 2) {
        const post = shade(ownerRgb, 0.55);
        for (const [fx, fy] of [[0, 0], [7, 0], [0, 7], [7, 7], [0, 3], [7, 3]] as const) {
          put(bx + fx, by + fy, post); // the compound fence going up
        }
      }
      if (stage >= 3) {
        put(bx + 1, by - 1, ownerRgb); // banners over the headquarters
        put(bx + 6, by - 1, ownerRgb);
        put(bx + 1, by - 2, C.iconAccent);
        put(bx + 6, by - 2, C.iconAccent);
      }
    }
  }

  // ---- pass 2.5: area effects (auras) under the people ----
  drawEffects(sim, tick, fog, put);

  // ---- pass 3: the people ----
  drawResidents(sim, tick, fog, put);
  drawCohorts(sim, tick, fog, put, opts.marchTicksPerTile ?? 2);
  drawUnits(sim, opts.viewer ?? 0, fog, put);

  // ---- pass 3.5: TERRITORY BORDERS (v3 M4 glow) — your converted town
  // paints itself in your colour as it grows (the OpenFront read) ----
  drawTerritoryBorders(sim, tick, fog, put);

  // ---- pass 4: fog dimming (operate on output blocks) ----
  if (fog) {
    for (let ty = vy; ty < vy + vh; ty++) {
      for (let tx = vx; tx < vx + vw; tx++) {
        if (fog[ty * w.width + tx] === 1) continue;
        const bx0 = (tx - vx) * TILE_PX * S;
        const by0 = (ty - vy) * TILE_PX * S;
        for (let py = 0; py < TILE_PX * S; py++) {
          let o = ((by0 + py) * W + bx0) * 4;
          for (let px = 0; px < TILE_PX * S; px++) {
            data[o] = (data[o]! * 96) >> 8;
            data[o + 1] = (data[o + 1]! * 96) >> 8;
            data[o + 2] = (data[o + 2]! * 96) >> 8;
            o += 4;
          }
        }
      }
    }
  }

  return { data, width: W, height: H };
}

// ---------------------------------------------------------------- tiles

type Put = (gx: number, gy: number, rgb: RGB) => void;

/**
 * Zoom-in detail channel. `putF` writes a single output pixel on the S× sub-
 * grid (coords in logical-×S space), letting draw paths add fine features —
 * window mullions, brick courses, ragged tree/water edges — that only exist
 * when the map is rendered close up. Null at LOD 1 (overview).
 */
export interface Detail {
  S: number;
  putF: (fx: number, fy: number, rgb: RGB) => void;
}

/**
 * Sub-tile bleed for woods & lake: terrain is a tile grid, but a hard
 * tile-aligned forest/shore edge reads as blocky. For a grass pixel beside a
 * woods/lake tile we let the blob spill a noise-ragged few pixels across the
 * shared border, so forests and lakes get organic edges finer than one tile.
 * Returns the override color, or null to keep grass.
 */
function naturalEdgeBleed(
  w: World,
  tx: number,
  ty: number,
  px: number,
  py: number,
): RGB | null {
  const gx = tx * TILE_PX + px;
  const gy = ty * TILE_PX + py;
  let bestKind = 0;
  let bestPen = 0;
  const consider = (ntx: number, nty: number, dist: number): void => {
    if (ntx < 0 || nty < 0 || ntx >= w.width || nty >= w.height) return;
    const nt = nty * w.width + ntx;
    const tr = w.terrain[nt]!;
    if (tr !== Terrain.Woods && tr !== Terrain.Lake) return;
    // a desert saguaro stand is sand, not canopy — it never bleeds green
    if (tr === Terrain.Woods && w.biome[nt] === 1 /* Biome.Desert */) return;
    const reach = 1 + valueNoise(gx, gy, 5, tr === Terrain.Lake ? 91 : 93) * 3.2;
    const pen = reach - dist;
    if (pen > bestPen) {
      bestPen = pen;
      bestKind = tr;
    }
  };
  consider(tx, ty - 1, py + 1); // N
  consider(tx, ty + 1, TILE_PX - py); // S
  consider(tx - 1, ty, px + 1); // W
  consider(tx + 1, ty, TILE_PX - px); // E
  if (bestKind === 0) return null;
  const h = pixHash(gx, gy, 7);
  if (bestKind === Terrain.Lake) {
    if (bestPen < 0.8) return C.sand; // a thin beach where water meets land
    return h % 41 === 0 ? C.waterGlint : (gy + (gx >> 2)) % 7 === 0 ? C.waterRipple : C.waterDeep;
  }
  // woods: canopy clumps thinning at the very fringe
  const blob = pixHash(gx >> 2, gy >> 2, 77) % 5;
  if (bestPen < 0.7 && h % 2 === 0) return null; // frayed outermost rim
  return h % 23 === 0 ? C.trunk : blob < 2 ? C.canopy : blob < 4 ? C.canopyDark : C.canopyLight;
}

function drawTile(
  sim: SimState,
  t: number,
  tx: number,
  ty: number,
  put: Put,
  archetypeOf: Map<number, Archetype>,
  detail: Detail | null = null,
  frameTick = 0,
): void {
  const w = sim.world;
  const x0 = tx * TILE_PX;
  const y0 = ty * TILE_PX;

  switch (w.terrain[t]) {
    case Terrain.Road: {
      const roadAt = (n: number): boolean =>
        n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Road;
      const roadN = ty > 0 && roadAt(t - w.width);
      const roadS = ty < w.height - 1 && roadAt(t + w.width);
      const roadE = tx < w.width - 1 && roadAt(t + 1);
      const roadW = tx > 0 && roadAt(t - 1);
      const waterAt = (n: number): boolean =>
        n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Lake;

      // BRIDGE: only a true CROSSING gets a deck — the water must continue on
      // BOTH sides perpendicular to travel (through the other highway lane if
      // this is the 2-lane). A road that merely runs along a shore is a road.
      const waterBeyond = (n: number, n2: number): boolean =>
        waterAt(n) || (roadAt(n) && waterAt(n2));
      const crossH =
        (roadE || roadW) &&
        ty > 1 &&
        ty < w.height - 2 &&
        waterBeyond(t - w.width, t - 2 * w.width) &&
        waterBeyond(t + w.width, t + 2 * w.width);
      const crossV =
        (roadN || roadS) &&
        tx > 1 &&
        tx < w.width - 2 &&
        waterBeyond(t - 1, t - 2) &&
        waterBeyond(t + 1, t + 2);
      if (crossH || crossV) {
        const horiz = crossH;
        // railings only on the sides that actually face water — the seam
        // between the two highway lanes stays open deck
        const railLo = horiz ? waterAt(t - w.width) : waterAt(t - 1);
        const railHi = horiz ? waterAt(t + w.width) : waterAt(t + 1);
        for (let py = 0; py < TILE_PX; py++) {
          for (let px = 0; px < TILE_PX; px++) {
            const along = horiz ? px : py; // plank seams run across travel
            let c: RGB = along % 2 === 0 ? C.plank : C.plankDark;
            const perp = horiz ? py : px;
            const isRail =
              (perp === 0 && railLo) || (perp === TILE_PX - 1 && railHi);
            if (isRail) c = along % 2 === 0 ? C.rail : C.plankDark; // posts
            put(x0 + px, y0 + py, c);
          }
        }
        // the deck casts onto the water below (depth cue)
        if (horiz && waterAt(t + w.width)) {
          for (let px = 0; px < TILE_PX; px += 2) put(x0 + px, y0 + TILE_PX, shade(C.waterDeep, 0.7));
        } else if (!horiz && waterAt(t + 1)) {
          for (let py = 0; py < TILE_PX; py += 2) put(x0 + TILE_PX, y0 + py, shade(C.waterDeep, 0.7));
        }
        return;
      }

      // LEVEL CROSSING: the rail line runs through this road tile
      const railAt = (n: number): boolean =>
        n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Rail;
      const crossingH = tx > 0 && tx < w.width - 1 && railAt(t - 1) && railAt(t + 1);
      const crossingV = ty > 0 && ty < w.height - 1 && railAt(t - w.width) && railAt(t + w.width);
      // a road tile beside another horizontal road row = the 2-lane HIGHWAY
      const highway = (roadN || roadS) && roadW && roadE;
      const highwayTopLane = highway && roadS && !roadN;
      // sidewalks only where the street fronts town lots; gravel shoulders out
      // in the country — the same road reads urban downtown and rural beyond
      let fronted = false;
      let downtownFront = false;
      for (const n of [t - 1, t + 1, t - w.width, t + w.width]) {
        if (n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Citizen) {
          fronted = true;
          if (w.district[n] === 3) downtownFront = true; // Districts.Downtown
        }
      }
      // CROSSWALKS: zebra dashes where two downtown streets meet
      const intersection = downtownFront && (roadN || roadS) && (roadE || roadW);
      const fourWay = downtownFront && roadN && roadS && roadE && roadW;
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          let baseRoad = C.asphalt;
          if (!highway) {
            const d = w.district[t]!;
            if (d === 4 /* Districts.OldTown */) {
              baseRoad = hexToRgb("#69635b"); // older browner road
            } else if (d === 1 /* Districts.Suburbs */) {
              baseRoad = hexToRgb("#63605c"); // worn residential grey
            }
          }
          let c: RGB = highway ? shade(C.asphalt, 0.92) : baseRoad;
          const gx = tx * TILE_PX + px;
          const gy = ty * TILE_PX + py;
          if (pixHash(gx, gy, 51) % 29 === 0) c = shade(c, 1.06); // worn patches
          const onEdge = px === 0 || px === TILE_PX - 1 || py === 0 || py === TILE_PX - 1;
          // only skirt edges that don't abut another road tile, so the surface
          // stays continuous through intersections
          if (onEdge && fronted) {
            const skirtN = py === 0 && !roadN;
            const skirtS = py === TILE_PX - 1 && !roadS;
            const skirtW = px === 0 && !roadW;
            const skirtE = px === TILE_PX - 1 && !roadE;
            if (skirtN || skirtS || skirtW || skirtE) {
              const isParkingN = skirtN && ty > 0 && w.lot[t - w.width] === Lot.Parking;
              const isParkingS = skirtS && ty < w.height - 1 && w.lot[t + w.width] === Lot.Parking;
              const isParkingW = skirtW && tx > 0 && w.lot[t - 1] === Lot.Parking;
              const isParkingE = skirtE && tx < w.width - 1 && w.lot[t + 1] === Lot.Parking;
              if (isParkingN || isParkingS || isParkingW || isParkingE) {
                c = shade(C.asphalt, 0.85); // curb cut
              } else {
                let sideCol = C.sidewalk;
                if (w.district[t] === 4 /* Districts.OldTown */) {
                  sideCol = hexToRgb("#8c685c"); // brick sidewalk tint
                }
                c = sideCol;
              }
            }
          }
          // 4-LANE HIGHWAY: yellow center seam + dashed white lane lines
          if (highwayTopLane && py === TILE_PX - 1 && gx % 6 < 3) c = C.highwayLine;
          if (highway && py === 3 && gx % 8 < 3) c = C.asphaltDash; // lane line
          // 2-LANE STREETS: faint center dashes along the travel axis
          if (!highway) {
            const horiz2 = roadE && roadW && !roadN && !roadS;
            const vert2 = roadN && roadS && !roadE && !roadW;
            if (horiz2 && py === 3 && gx % 8 < 3) c = shade(C.asphaltDash, 0.9);
            if (vert2 && px === 3 && gy % 8 < 3) c = shade(C.asphaltDash, 0.9);
          }
          // crosswalk bars across the entries of a downtown intersection
          if (intersection && px % 2 === 1 && (py === 1 || py === TILE_PX - 2)) c = C.crosswalk;
          // the tracks continue straight across the pavement
          if (crossingH && (py === 2 || py === 5)) c = C.railSteel;
          if (crossingV && (px === 2 || px === 5)) c = C.railSteel;
          put(x0 + px, y0 + py, c);
        }
      }
      // crossbuck posts flank a level crossing
      if (crossingH || crossingV) {
        put(x0 + 1, y0 + 1, C.crosswalk); // X sign
        put(x0 + 1, y0 + 2, C.iconDark);
        put(x0 + 6, y0 + 5, C.crosswalk);
        put(x0 + 6, y0 + 6, C.iconDark);
        // SIGNAL MAST (§5) at the main (highway) crossing: red lamp on a post
        if (highway) {
          put(x0 + 6, y0 + 1, hexToRgb("#d23b3b"));
          put(x0 + 6, y0 + 2, C.iconDark);
          put(x0 + 6, y0 + 3, C.iconDark);
        }
      }
      // TRAFFIC LIGHTS: paired signal heads on the corners of a 4-way
      if (fourWay) {
        put(x0 + 6, y0 + 2, C.iconDark); // NE pole
        put(x0 + 6, y0 + 1, hexToRgb("#d23b3b")); // red head
        put(x0 + 1, y0 + 5, C.iconDark); // SW pole
        put(x0 + 1, y0 + 6, hexToRgb("#3cb44b")); // green head
      } else if (
        fronted &&
        !highway &&
        (roadN ? 1 : 0) + (roadS ? 1 : 0) + (roadE ? 1 : 0) + (roadW ? 1 : 0) === 3
      ) {
        // STOP SIGN where a side street tees into a through street
        put(x0 + 6, y0 + 1, hexToRgb("#c8352a"));
        put(x0 + 6, y0 + 2, C.iconDark);
      }
      // (No hash traffic here: every car on the road is a RESIDENT'S car —
      // drawResidents routes them driveway → streets → parking bay and back,
      // so what you see driving is somebody actually going somewhere.)
      return;
    }
    case Terrain.Rail: {
      // railroad: ballast bed, ties across the travel axis, twin steel rails
      const railE = tx < w.width - 1 && (w.terrain[t + 1] === Terrain.Rail || w.terrain[t + 1] === Terrain.Road);
      const railW = tx > 0 && (w.terrain[t - 1] === Terrain.Rail || w.terrain[t - 1] === Terrain.Road);
      const horizR = railE || railW;
      const overWater =
        (ty > 0 && w.terrain[t - w.width] === Terrain.Lake) ||
        (ty < w.height - 1 && w.terrain[t + w.width] === Terrain.Lake);
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const gx = x0 + px;
          const gy = y0 + py;
          let c: RGB = overWater
            ? (px + py) % 2 === 0
              ? C.plankDark
              : C.plank // trestle deck over the water
            : pixHash(gx, gy, 73) % 5 === 0
              ? shade(C.ballast, 0.9)
              : C.ballast;
          if (horizR) {
            if (gx % 2 === 0 && py >= 2 && py <= 5) c = C.tie;
            if (py === 2 || py === 5) c = C.railSteel;
          } else {
            if (gy % 2 === 0 && px >= 2 && px <= 5) c = C.tie;
            if (px === 2 || px === 5) c = C.railSteel;
          }
          put(gx, gy, c);
        }
      }
      return;
    }
    case Terrain.Path: {
      // block-interior footpath: stone walk with a worn edge
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const h = pixHash(x0 + px, y0 + py, 57);
          let c: RGB = h % 7 === 0 ? C.pathEdge : C.pathStone;
          if (px === 0 || px === TILE_PX - 1 || py === 0 || py === TILE_PX - 1) {
            c = shade(C.pathEdge, 0.94);
          }
          put(x0 + px, y0 + py, c);
        }
      }
      return;
    }
    case Terrain.Orchard: {
      // orchard: mown ground with tree rows every other tile-row
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          put(x0 + px, y0 + py, (px + py) % 2 === 0 ? C.meadowLight : C.meadow);
        }
      }
      const rowY = ty % 2 === 0 ? 2 : 5;
      for (const cxp of [1, 4, 6]) {
        put(x0 + cxp + 1, y0 + rowY + 1, C.shadow);
        put(x0 + cxp, y0 + rowY, C.canopy);
        put(x0 + cxp + (pixHash(t, cxp, 3) % 2), y0 + rowY - 1 < 0 ? 0 : y0 + rowY - 1, C.canopyLight);
      }
      if (detail) {
        const fruitHash = pixHash(t, 19);
        let fruitCol = null;
        if (currentSeason === "spring") {
          fruitCol = fruitHash % 2 === 0 ? hexToRgb("#ffd0e8") : hexToRgb("#ffffff"); // blossoms
        } else if (currentSeason === "summer") {
          fruitCol = fruitHash % 2 === 0 ? hexToRgb("#d23b3b") : hexToRgb("#d87a24"); // red apples / peaches
        } else if (currentSeason === "fall") {
          fruitCol = fruitHash % 2 === 0 ? hexToRgb("#e6b830") : null; // pears
        }
        if (fruitCol) {
          for (const cxp of [1, 4, 6]) {
            const fx = x0 + cxp + (fruitHash % 2);
            const fy = y0 + rowY - (fruitHash % 2);
            put(fx, fy, fruitCol);
          }
        }
      }
      return;
    }
    case Terrain.Pasture: {
      // fenced pasture: worn meadow, perimeter fence, a couple of cattle
      const fN = ty > 0 && w.terrain[t - w.width] !== Terrain.Pasture;
      const fS = ty < w.height - 1 && w.terrain[t + w.width] !== Terrain.Pasture;
      const fW = tx > 0 && w.terrain[t - 1] !== Terrain.Pasture;
      const fE = tx < w.width - 1 && w.terrain[t + 1] !== Terrain.Pasture;
      const worn = hexToRgb("#96945e"); // grazed-down dry patches
      const wornDark = hexToRgb("#87855a");
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const gx = x0 + px;
          const gy = y0 + py;
          // worn/grazed read (§9): browner trampled ground in noise pockets
          const wear = valueNoise(gx, gy, 7, 27);
          let c: RGB =
            wear > 0.62 ? (pixHash(gx, gy, 15) % 3 === 0 ? wornDark : worn)
            : pixHash(gx, gy, 15) % 11 === 0 ? C.grassLow
            : shade(C.meadow, 0.96);
          if (
            (fN && py === 0 && px % 2 === 0) ||
            (fS && py === TILE_PX - 1 && px % 2 === 0) ||
            (fW && px === 0 && py % 2 === 0) ||
            (fE && px === TILE_PX - 1 && py % 2 === 0)
          )
            c = C.fence;
          put(x0 + px, y0 + py, c);
        }
      }
      // stock tank (§9 farm pond): a small water pocket with a mud ring
      if (pixHash(t, 21, 27) % 13 === 0) {
        const mud = hexToRgb("#7a6a4a");
        for (let dy = 0; dy < 3; dy++)
          for (let dx = 0; dx < 3; dx++) put(x0 + 4 + dx, y0 + 4 + dy, mud);
        put(x0 + 5, y0 + 5, hexToRgb("#3f6272"));
        put(x0 + 5, y0 + 4, hexToRgb("#4a7080"));
        put(x0 + 4, y0 + 5, hexToRgb("#3f6272"));
      }
      if (pixHash(t, 8, 27) % 3 !== 2) {
        const hx = x0 + 2 + (pixHash(t, 9, 27) % 4);
        const hy = y0 + 2 + (pixHash(t, 10, 27) % 3);
        // a HORSE on some pastures (§9): darker chestnut with a black mane
        if (pixHash(t, 14, 27) % 5 === 0) {
          const chest = hexToRgb("#7a4a2a");
          put(hx, hy, chest);
          put(hx + 1, hy, chest);
          put(hx + 1, hy - 1 < y0 + 1 ? y0 + 1 : hy - 1, C.iconDark); // mane
          put(hx + 1, hy + 1, shade(chest, 0.7));
          return;
        }
        const c = pixHash(t, 11, 27) % 2 === 0 ? C.cowWhite : C.cowBrown;
        put(hx, hy, c); // the cow
        put(hx + 1, hy, c);
        put(hx + 1, hy + 1, shade(c, 0.7));
        // a second head some tiles — herds, not lone statues
        if (pixHash(t, 12, 27) % 3 === 0) {
          const c2 = pixHash(t, 13, 27) % 2 === 0 ? C.cowWhite : C.cowBrown;
          put(hx - 2 < x0 + 1 ? x0 + 1 : hx - 2, hy + 2 > y0 + 6 ? y0 + 6 : hy + 2, c2);
          put((hx - 1 < x0 + 1 ? x0 + 1 : hx - 2) + 1, hy + 2 > y0 + 6 ? y0 + 6 : hy + 2, c2);
        }
      }
      if (pixHash(t, 15) % 2 === 0) {
        const tx_trough = x0 + 1 + (pixHash(t, 16) % 2);
        const ty_trough = y0 + 1 + ((pixHash(t, 16) >> 4) % 2);
        put(tx_trough, ty_trough, hexToRgb("#8c8c8c")); // metal trough rim
        put(tx_trough + 1, ty_trough, hexToRgb("#3f7fbf")); // water inside
      }
      return;
    }
    case Terrain.Grass: {
      // desert borders grade through a scrub ecotone (no hard biome line):
      // ring 1 = heavy sand mix, rings 2-3 = sparse sand + dry scrub
      let desertRing = 0;
      if (w.biome[t] !== 1) {
        outer: for (let ring = 1; ring <= 3; ring++) {
          for (let dy = -ring; dy <= ring; dy++) {
            for (let dx = -ring; dx <= ring; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
              const x = tx + dx;
              const y = ty + dy;
              if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
              if (w.biome[y * w.width + x] === 1) {
                desertRing = ring;
                break outer;
              }
            }
          }
        }
      }
      // DESERT biome: the same rolling land, reskinned as sand and scrub, or oasis verges
      if (w.biome[t] === 1 /* Biome.Desert */) {
        const nearWater =
          (ty > 0 && w.terrain[t - w.width] === Terrain.Lake) ||
          (ty < w.height - 1 && w.terrain[t + w.width] === Terrain.Lake) ||
          (tx > 0 && w.terrain[t - 1] === Terrain.Lake) ||
          (tx < w.width - 1 && w.terrain[t + 1] === Terrain.Lake);

        for (let py = 0; py < TILE_PX; py++) {
          for (let px = 0; px < TILE_PX; px++) {
            const gx = x0 + px;
            const gy = y0 + py;
            const h = pixHash(gx, gy, 65);
            let c: RGB;
            if (nearWater) {
              c = h % 3 === 0 ? hexToRgb("#61b53e") : hexToRgb("#4c962b"); // oasis grass
            } else {
              c = h % 3 === 0 ? C.sandDark : C.sandBg;
              if (valueNoise(gx, gy, 30, 66) > 0.68) c = shade(C.sandBg, 1.05); // dune crest
              if (h % 31 === 0) c = C.sandScrub; // dry brush
              // DRY WASH (§2): a winding dry-creek bed cut through the blob —
              // a narrow noise-contour band of darker packed sand + stones
              const wash = valueNoise(gx, gy, 22, 55);
              if (wash > 0.47 && wash < 0.53) {
                c = h % 7 === 0 ? hexToRgb("#b8a276") : hexToRgb("#c7b284");
                if (h % 23 === 0) c = C.rockShade; // wash stones
              }
            }
            const bleed = naturalEdgeBleed(w, tx, ty, px, py);
            if (bleed) c = bleed;
            put(gx, gy, c);
          }
        }

        if (nearWater && detail) {
          // Draw a beautiful date palm at LOD 3!
          const palmHash = pixHash(t, 87);
          const px0 = x0 + 2 + (palmHash % 3);
          const py0 = y0 + 2 + ((palmHash >> 4) % 3);
          // Trunk
          put(px0, py0 + 3, C.trunk);
          put(px0, py0 + 2, C.trunk);
          // Palm fronds
          const frond = hexToRgb("#338a24");
          const frondLight = hexToRgb("#5cb54c");
          put(px0 - 1, py0 + 1, frond);
          put(px0 + 1, py0 + 1, frond);
          put(px0, py0 + 1, frondLight);
          put(px0, py0, frondLight);
        } else if (detail) {
          const detailHash = pixHash(t, 88);
          if (detailHash % 29 === 0) {
            // bleached skull
            const bx = x0 + 3 + (detailHash % 3);
            const by = y0 + 3 + ((detailHash >> 4) % 3);
            put(bx, by, hexToRgb("#fcfaf2"));
            put(bx + 1, by, hexToRgb("#ebdcc5"));
          } else if (detailHash % 17 === 0) {
            // tumbleweed
            const bx = x0 + 3 + (detailHash % 3);
            const by = y0 + 3 + ((detailHash >> 4) % 3);
            put(bx, by, hexToRgb("#b0987c"));
            put(bx + 1, by + 1, hexToRgb("#967d60"));
          }
        }
        return;
      }
      // gentle rolling elevation: a low-frequency noise field tints grass from
      // shaded valleys (grassLow) up to sunlit rises (grassHigh), and its slope
      // (the east-west gradient) shades west-facing banks for a hilly read.
      // two octaves: a broad rolling field (cell 40) broken up by finer mottle
      // (cell 12) so the country reads as continuous meadow, not hard blobs.
      const elevAt = (gx: number, gy: number): number =>
        0.62 * valueNoise(gx, gy, 40, 71) + 0.38 * valueNoise(gx, gy, 12, 77);
      // graded forest + autumn ecotone check (§2: every biome edge grades)
      let forestRing = 0;
      let autumnRing = 0;
      {
        outer: for (let ring = 1; ring <= 3; ring++) {
          for (let dy = -ring; dy <= ring; dy++) {
            for (let dx = -ring; dx <= ring; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
              const x = tx + dx;
              const y = ty + dy;
              if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
              const nb = w.biome[y * w.width + x];
              if (nb === 2 && w.biome[t] !== 2 && !forestRing) forestRing = ring;
              if (nb === 3 && w.biome[t] !== 3 && !autumnRing) autumnRing = ring;
              if (forestRing && autumnRing) break outer;
            }
          }
        }
      }

      // marsh detection: adjacent to lake/river (water) and in wet meadow pockets
      const nearWater =
        (ty > 0 && w.terrain[t - w.width] === Terrain.Lake) ||
        (ty < w.height - 1 && w.terrain[t + w.width] === Terrain.Lake) ||
        (tx > 0 && w.terrain[t - 1] === Terrain.Lake) ||
        (tx < w.width - 1 && w.terrain[t + 1] === Terrain.Lake);
      const isMarsh = nearWater && valueNoise(x0, y0, 8, 91) > 0.65 && w.biome[t] !== 1;

      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const gx = x0 + px;
          const gy = y0 + py;
          const h = pixHash(gx, gy, 5);
          const elev = elevAt(gx, gy);
          // organic meadow mottle: smooth noise contours, never tile-aligned
          // rectangles (QA sprint-1: quantized patches at crop zoom)
          const cell = valueNoise(gx, gy, 9, 13) > 0.55 ? 0 : 1;
          let c = cell === 0 ? C.meadowLight : C.meadow;
          if (w.biome[t] === 2 /* Biome.Forest */) c = cell === 0 ? C.forestFloor : shade(C.forestFloor, 0.92);
          else if (w.biome[t] === 3 /* Biome.Autumn */) c = cell === 0 ? hexToRgb("#d0a75c") : hexToRgb("#c2964b"); // golden rust ground
          else if (w.biome[t] === 4 /* Biome.Ocean */) {
            // the BEACH (§2A): dry sand with shell flecks and beach grass tufts
            c = cell === 0 ? shade(C.sandBg, 1.06) : C.sandBg;
            if (h % 37 === 0) c = hexToRgb("#f4f0e4"); // shell
            else if (h % 23 === 0) c = hexToRgb("#a8a86c"); // beach grass
            put(gx, gy, c);
            continue;
          }

          if (isMarsh) {
            c = cell === 0 ? hexToRgb("#82935c") : hexToRgb("#6e7e4c"); // swampy green
          }

          if (elev > 0.7) c = C.grassHigh; // hilltops catch the light
          else if (elev < 0.3) c = C.grassLow; // hollows sit in shade
          // west-facing banks in shade — per-pixel slope, so the shading
          // follows the terrain contour instead of tile-aligned columns
          if (elevAt(gx + 2, gy) - elev > 0.045) c = shade(c, 0.94);
          if (h % 19 === 0) c = C.scrub;
          if (h % 211 === 0) c = C.flowerY;
          else if (h % 223 === 0) c = C.flowerW;
          
          // graded ecotone: heavy sand at ring 1, thinning scrub to ring 3
          if (desertRing === 1 && h % 3 === 0) c = C.sandBg;
          else if (desertRing === 2 && h % 6 === 0) c = h % 12 === 0 ? C.sandScrub : C.sandBg;
          else if (desertRing === 3 && h % 12 === 0) c = C.sandScrub;

          // graded forest ecotone: blend forestFloor at ring 1-3
          if (forestRing === 1 && h % 2 === 0) c = C.forestFloor;
          else if (forestRing === 2 && h % 4 === 0) c = C.forestFloor;
          else if (forestRing === 3 && h % 8 === 0) c = C.forestFloor;
          // graded autumn ecotone: golden-rust ground fades out over 3 rings
          const autumnGround = hexToRgb("#c9a054");
          if (autumnRing === 1 && h % 2 === 0) c = autumnGround;
          else if (autumnRing === 2 && h % 4 === 0) c = autumnGround;
          else if (autumnRing === 3 && h % 8 === 0) c = autumnGround;

          // woods/lake spill a ragged sub-tile edge into this grass pixel
          const bleed = naturalEdgeBleed(w, tx, ty, px, py);
          if (bleed) c = bleed;
          put(gx, gy, c);
        }
      }

      // marsh details: little reed shoots at LOD 3
      if (isMarsh && detail) {
        const hMarsh = pixHash(t, 99);
        const rx = x0 + 2 + (hMarsh % 4);
        const ry = y0 + 2 + ((hMarsh >> 4) % 4);
        put(rx, ry, hexToRgb("#566632")); // dark reed green
        put(rx, ry - 1, hexToRgb("#7ca142")); // light tip
      }

      // Forest biome details at LOD 3: mushrooms, fallen logs, ferns
      if (w.biome[t] === 2 /* Biome.Forest */ && detail) {
        const forestHash = pixHash(t, 94);
        if (forestHash % 19 === 0) {
          // Red mushroom
          const mx = x0 + 3 + (forestHash % 3);
          const my = y0 + 4 + ((forestHash >> 4) % 2);
          put(mx, my, hexToRgb("#d23b3b"));
          put(mx, my + 1, hexToRgb("#f7f5f0"));
        } else if (forestHash % 23 === 0) {
          // Fallen log
          const lx = x0 + 2 + (forestHash % 2);
          const ly = y0 + 4 + ((forestHash >> 4) % 2);
          const logC = hexToRgb("#6e5030");
          const mossC = hexToRgb("#567838");
          put(lx, ly, logC);
          put(lx + 1, ly, mossC);
          put(lx + 2, ly, logC);
        } else if (forestHash % 17 === 0) {
          // Fern
          const fx = x0 + 3 + (forestHash % 3);
          const fy = y0 + 4 + ((forestHash >> 4) % 2);
          const fernC = hexToRgb("#44a036");
          put(fx, fy, fernC);
          put(fx - 1, fy + 1, fernC);
          put(fx + 1, fy + 1, fernC);
        }
      }

      // sparse rock outcrops with shape variety on the higher, drier ground
      if (elevAt(x0 + 4, y0 + 4) > 0.62 && pixHash(t, 4, 23) % 17 === 0) {
        const rockVar = pixHash(t, 45) % 3;
        if (rockVar === 1) {
          // single larger rock
          put(x0 + 3, y0 + 4, C.rock);
          put(x0 + 4, y0 + 4, C.rockShade);
          put(x0 + 4, y0 + 5, C.shadow);
        } else if (rockVar === 2) {
          // scattered pair
          put(x0 + 2, y0 + 4, C.rock);
          put(x0 + 5, y0 + 5, C.rockShade);
        } else {
          // default 3-px cluster
          put(x0 + 3, y0 + 4, C.rock);
          put(x0 + 4, y0 + 4, C.rockShade);
          put(x0 + 3, y0 + 5, C.rockShade);
        }
      }
      // scattered low brush with variety
      if (valueNoise(x0, y0, 22, 88) > 0.6 && pixHash(t, 7, 31) % 5 === 0) {
        const bushVar = pixHash(t, 46) % 2;
        if (bushVar === 1) {
          put(x0 + 2, y0 + 4, C.bush);
          put(x0 + 3, y0 + 5, C.bush);
          put(x0 + 3, y0 + 6, shade(C.bush, 0.85));
        } else {
          put(x0 + 2, y0 + 5, C.bush);
          put(x0 + 3, y0 + 5, C.bush);
          put(x0 + 3, y0 + 6, shade(C.bush, 0.85)); // bottom-right shadow
        }
      }
      // the occasional lone country tree with canopy variety, or a weeping willow near water
      if (nearWater && w.biome[t] !== 1 && pixHash(t, 32, 91) % 12 === 0) {
        put(x0 + 4, y0 + 5, C.shadow); // cast shadow
        put(x0 + 5, y0 + 5, C.shadow);
        // Trunk
        put(x0 + 4, y0 + 4, C.trunk);
        put(x0 + 4, y0 + 5, C.trunk);
        // Weeping willow canopy (drooping light-green fronds)
        put(x0 + 3, y0 + 2, C.willowL);
        put(x0 + 4, y0 + 2, C.willowL);
        put(x0 + 2, y0 + 3, C.willowL);
        put(x0 + 3, y0 + 3, C.willowL);
        put(x0 + 4, y0 + 3, C.willowL);
        put(x0 + 5, y0 + 3, C.willowL);
        // Drooping willow tips
        put(x0 + 2, y0 + 4, C.willowD);
        put(x0 + 5, y0 + 4, C.willowD);
        put(x0 + 1, y0 + 4, C.willowD);
        put(x0 + 6, y0 + 4, C.willowD);
      } else if (pixHash(t, 3, 19) % 37 === 0) {
        const treeVar = pixHash(t, 12, 19) % 5;
        put(x0 + 4, y0 + 5, C.shadow); // cast shadow
        put(x0 + 5, y0 + 5, C.shadow);
        
        let cBase = C.canopy;
        let cLight = C.canopyLight;
        let cDark = C.canopyDark;
        if (treeVar === 3 && currentSeason === "fall") {
          // Autumn tree (Orange/Gold)
          cBase = hexToRgb("#d97b25");
          cLight = hexToRgb("#eba33d");
          cDark = hexToRgb("#bd5b1b");
        } else if (treeVar === 4) {
          // Dead tree
          put(x0 + 3, y0 + 3, C.trunk);
          put(x0 + 4, y0 + 3, C.trunk);
          put(x0 + 4, y0 + 4, C.trunk);
          put(x0 + 3, y0 + 4, C.trunk);
        }

        if (treeVar !== 4) {
          if (treeVar === 1) {
            // Taller pine shape
            put(x0 + 3, y0 + 2, cLight);
            put(x0 + 3, y0 + 3, cBase);
            put(x0 + 4, y0 + 3, cBase);
            put(x0 + 2, y0 + 4, cDark);
            put(x0 + 3, y0 + 4, cBase);
            put(x0 + 4, y0 + 4, cDark);
          } else if (treeVar === 2) {
            // Shrubby round tree
            put(x0 + 2, y0 + 3, cLight);
            put(x0 + 3, y0 + 3, cBase);
            put(x0 + 4, y0 + 3, cLight);
            put(x0 + 2, y0 + 4, cDark);
            put(x0 + 3, y0 + 4, cBase);
            put(x0 + 4, y0 + 4, cDark);
            put(x0 + 5, y0 + 4, cDark);
          } else {
            // Default tree
            put(x0 + 3, y0 + 3, cBase);
            put(x0 + 4, y0 + 3, cLight);
            put(x0 + 3, y0 + 4, cDark);
            put(x0 + 4, y0 + 4, cBase);
          }
        }
      }
      // utility poles marching along a rural road: a grass verge beside a road
      // gets a telephone pole every few tiles, lining up like real power lines.
      {
        const roadN = ty > 0 && w.terrain[t - w.width] === Terrain.Road;
        const roadS = ty < w.height - 1 && w.terrain[t + w.width] === Terrain.Road;
        const roadE = tx < w.width - 1 && w.terrain[t + 1] === Terrain.Road;
        const roadW = tx > 0 && w.terrain[t - 1] === Terrain.Road;
        // utility lines belong on the RURAL side of town: one verge line,
        // north of east-west roads / west of north-south roads, and only
        // where no lots front the street (keeps town streets uncluttered)
        let ruralVerge = true;
        for (const n of [t - 1, t + 1, t - w.width, t + w.width]) {
          if (n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Citizen) ruralVerge = false;
        }
        const runH = roadS && ruralVerge && (roadW || roadE); // pole line north of the road
        const runV = roadE && !roadS && ruralVerge && (roadN || roadS); // west of the road
        if (runH || runV) {
          const pole = runH ? tx % 2 === 0 : ty % 2 === 0;
          // the WIRE sags in a U between poles: attached high at the
          // crossarm, dipping a pixel (or two mid-span) between them
          if (runH) {
            for (let px = 0; px < TILE_PX; px++) {
              const dip = pole
                ? px >= 3 && px <= 5
                  ? 0 // at the crossarm
                  : 1
                : px >= 3 && px <= 4
                  ? 2 // deepest mid-span
                  : 1;
              put(x0 + px, y0 + 2 + dip, C.wire);
            }
          } else {
            for (let py = 0; py < TILE_PX; py++) {
              const dip = pole ? (py >= 3 && py <= 5 ? 0 : 1) : py >= 3 && py <= 4 ? 2 : 1;
              put(x0 + 4 + dip - 1, y0 + py, C.wire);
            }
          }
          if (pole) {
            const cxp = x0 + 4;
            for (let py = 1; py <= 6; py++) put(cxp, y0 + py, C.trunk); // pole
            put(cxp - 1, y0 + 2, C.trunk); // crossarm
            put(cxp + 1, y0 + 2, C.trunk);
            put(cxp + 2, y0 + 7, C.shadow); // foot shadow
          }
        }
        // billboard pair on the highway approaches (§11): a rare verge tile
        // beside the 4-lane, out in open country, carries a roadside board
        if (runH && w.district[t] === 0 && pixHash(tx >> 2, ty, 143) % 19 === 0 && tx % 4 === 1) {
          const board = hexToRgb("#e8e2d0");
          for (let px = 1; px <= 6; px++) {
            put(x0 + px, y0 + 1, board);
            put(x0 + px, y0 + 2, board);
          }
          put(x0 + 2, y0 + 1, hexToRgb("#b03a2a")); // ad blocks
          put(x0 + 3, y0 + 1, hexToRgb("#b03a2a"));
          put(x0 + 4, y0 + 2, hexToRgb("#3a5a8c"));
          put(x0 + 2, y0 + 3, C.trunk); // legs
          put(x0 + 5, y0 + 3, C.trunk);
          put(x0 + 3, y0 + 4, C.shadow);
        }
      }
      // an established cult spills camp assets onto the open ground around its
      // territory — sparser than the woods takeover, but the land reads claimed
      {
        const claim = woodsClaim(sim, t, tx, ty);
        if (claim && claim.stage >= 2 && pixHash(t, 5, 99) % 3 === 0) {
          drawCompoundAssets(sim, claim, t, x0, y0, put);
        }
      }
      return;
    }
    case Terrain.Field: {
      const fenceN = ty > 0 && w.terrain[t - w.width] !== Terrain.Field;
      const fenceW = tx > 0 && w.terrain[t - 1] !== Terrain.Field;
      const roadN = ty > 0 && w.terrain[t - w.width] === Terrain.Road;
      const roadW = tx > 0 && w.terrain[t - 1] === Terrain.Road;
      const roadS = ty < w.height - 1 && w.terrain[t + w.width] === Terrain.Road;
      const roadE = tx < w.width - 1 && w.terrain[t + 1] === Terrain.Road;
      // CROP VARIETY: each parcel (coarse 6-tile cell) rolls its planting —
      // corn gold, soy green, pale wheat, or fallow brown
      const parcel = pixHash((tx / 6) | 0, (ty / 6) | 0, 97) % 4;
      let cropA =
        parcel === 0 ? C.cropGold : parcel === 1 ? hexToRgb("#8aa54e") : parcel === 2 ? hexToRgb("#d8c88e") : hexToRgb("#a08458");
      let cropB =
        parcel === 0 ? C.cropRow : parcel === 1 ? hexToRgb("#71893c") : parcel === 2 ? hexToRgb("#c2b076") : hexToRgb("#8a7048");

      if (currentSeason === "spring") {
        cropA = hexToRgb("#5c4832"); // brown soil
        cropB = hexToRgb("#4a3824");
      } else if (currentSeason === "fall") {
        cropA = hexToRgb("#baa57c"); // tan stubble
        cropB = hexToRgb("#6d5338"); // tilled soil
      } else if (currentSeason === "winter") {
        cropA = hexToRgb("#ffffff"); // snow cover
        cropB = hexToRgb("#dce5ec");
      }

      const vertRows = pixHash((tx / 6) | 0, (ty / 6) | 0, 99) % 2 === 0; // rotation
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const gy = ty * TILE_PX + py;
          const gx2 = tx * TILE_PX + px;
          const row = (vertRows ? gx2 : gy) % 3 === 0;
          let c = row ? cropB : cropA;
          if (currentSeason === "spring" && row && pixHash(gx2, gy, 47) % 3 === 0) {
            c = hexToRgb("#82cf3c"); // young sprouts
          }
          if (pixHash(tx * TILE_PX + px, gy, 41) % 31 === 0) c = shade(c, 1.12);
          
          const ditchN = roadN && py === 0;
          const ditchS = roadS && py === TILE_PX - 1;
          const ditchW = roadW && px === 0;
          const ditchE = roadE && px === TILE_PX - 1;
          const woodsN = ty > 0 && w.terrain[t - w.width] === Terrain.Woods;
          const woodsW = tx > 0 && w.terrain[t - 1] === Terrain.Woods;
          
          if (ditchN || ditchS || ditchW || ditchE) {
            c = (gx2 + gy) % 6 === 0 ? hexToRgb("#7fc4e8") : hexToRgb("#66513e"); // mud + water glint
          } else if ((woodsN && py === 0) || (woodsW && px === 0)) {
            if ((px + py) % 2 === 0) c = C.bush;
          } else if ((fenceN && py === 0 && px % 4 < 3) || (fenceW && px === 0 && py % 4 < 3)) {
            c = C.fence;
          }
          put(x0 + px, y0 + py, c);
        }
      }
      // WHEEL-LINE IRRIGATION (§9): a rare field carries the long silver
      // sprinkler pipe with its wheels — a thin dotted line across the rows
      if (pixHash(t, 27, 98) % 29 === 0) {
        const wy2 = y0 + 3;
        for (let px = 0; px < TILE_PX; px++) {
          put(x0 + px, wy2, px % 3 === 0 ? hexToRgb("#d8dee2") : hexToRgb("#aab4ba"));
        }
        put(x0 + 1, wy2 + 1, hexToRgb("#8a9399")); // wheels
        put(x0 + 5, wy2 + 1, hexToRgb("#8a9399"));
      }
      // ROADSIDE PRODUCE STAND (§9): a rare road-fronting field corner keeps
      // a little white-roof stand with crates out front
      if ((roadN || roadS || roadW || roadE) && pixHash(t, 19, 98) % 23 === 0) {
        const sx = x0 + (roadW ? 1 : roadE ? 5 : 3);
        const sy = y0 + (roadN ? 1 : roadS ? 5 : 3);
        put(sx, sy, hexToRgb("#f0ece0")); // canopy
        put(sx + 1, sy, hexToRgb("#f0ece0"));
        put(sx, sy + 1, hexToRgb("#8a6a42")); // counter
        put(sx + 1, sy + 1, hexToRgb("#c94f38")); // produce crate
      }
      // HAY BALES dot the harvested (fallow) parcels in Fall
      if (currentSeason === "fall" && pixHash(t, 6, 98) % 7 === 0) {
        const bx2 = x0 + 2 + (pixHash(t, 7, 98) % 4);
        const by2 = y0 + 2 + (pixHash(t, 8, 98) % 4);
        put(bx2, by2, hexToRgb("#d8c88e"));
        put(bx2 + 1, by2, hexToRgb("#c2b076"));
        put(bx2, by2 + 1, hexToRgb("#c2b076"));
        put(bx2 + 1, by2 + 1, C.shadow);
      }
      // Visitors press crop circles into the fields they're colonizing: a ring
      // of flattened (darkened) crop with a swirl center.
      const fieldClaim = woodsClaim(sim, t, tx, ty);
      if (fieldClaim && fieldClaim.archetype === "visitors") {
        const cxp = x0 + 4;
        const cyp = y0 + 4;
        const flat = shade(C.cropRow, 0.7);
        for (let a = 0; a < 8; a++) {
          const ax = cxp + Math.round(2.4 * Math.cos((a / 8) * Math.PI * 2));
          const ay = cyp + Math.round(2.4 * Math.sin((a / 8) * Math.PI * 2));
          put(ax, ay, flat);
        }
        if (fieldClaim.stage >= 2) put(cxp, cyp, flat);
        if (fieldClaim.stage >= 3) put(cxp, cyp, hexToRgb("#9bf6ff"));
      }
      return;
    }
    case Terrain.Dirt: {
      const isDirtOrRoad = (n: number) => {
        if (n < 0 || n >= w.terrain.length) return false;
        const tr = w.terrain[n];
        return tr === Terrain.Dirt || tr === Terrain.Road || tr === Terrain.Citizen;
      };
      const nDirt = ty > 0 && isDirtOrRoad(t - w.width);
      const sDirt = ty < w.height - 1 && isDirtOrRoad(t + w.width);
      const wDirt = tx > 0 && isDirtOrRoad(t - 1);
      const eDirt = tx < w.width - 1 && isDirtOrRoad(t + 1);

      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const gx = x0 + px;
          const gy = y0 + py;

          let drawDirt = false;
          if (px >= 3 && px <= 4 && py >= 3 && py <= 4) drawDirt = true;
          if (nDirt && py < 3 && px >= 3 && px <= 4) drawDirt = true;
          if (sDirt && py > 4 && px >= 3 && px <= 4) drawDirt = true;
          if (wDirt && px < 3 && py >= 3 && py <= 4) drawDirt = true;
          if (eDirt && px > 4 && py >= 3 && py <= 4) drawDirt = true;

          if (drawDirt) {
            const h = pixHash(gx, gy, 9);
            put(gx, gy, h % 6 === 0 ? C.dirtEdge : C.dirt);
          } else {
            put(gx, gy, C.meadow);
          }
        }
      }
      return;
    }
    case Terrain.Lake: {
      // shoreline: sand ring where water meets land
      const shoreN = ty > 0 && w.terrain[t - w.width] !== Terrain.Lake;
      const shoreS = ty < w.height - 1 && w.terrain[t + w.width] !== Terrain.Lake;
      const shoreW = tx > 0 && w.terrain[t - 1] !== Terrain.Lake;
      const shoreE = tx < w.width - 1 && w.terrain[t + 1] !== Terrain.Lake;
      // creek read (§3): a narrow channel (shore on both sides of an axis)
      // runs a shade lighter/greener than open river/lake water
      const isCreek = (shoreW && shoreE) || (shoreN && shoreS);
      const deepC = isCreek ? hexToRgb("#3f6272") : C.waterDeep;
      const rippleC = isCreek ? hexToRgb("#4a7080") : C.waterRipple;
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const sand =
            (shoreN && py === 0) || (shoreS && py === TILE_PX - 1) ||
            (shoreW && px === 0) || (shoreE && px === TILE_PX - 1);
          if (sand) {
            const isDesert = w.biome[t] === 1 || w.biome[t] === 4; // desert or ocean beach
            if (isDesert) {
              put(x0 + px, y0 + py, C.sand);
            } else {
              const sh = pixHash(tx * TILE_PX + px, ty * TILE_PX + py, 101);
              const gravelC = sh % 3 === 0 ? hexToRgb("#cbd0d4") : sh % 3 === 1 ? hexToRgb("#a8b0b5") : hexToRgb("#8c9296");
              put(x0 + px, y0 + py, gravelC);
            }
            continue;
          }
          const gx = tx * TILE_PX + px;
          const gy = ty * TILE_PX + py;
          const ripple = (gy + (gx >> 2)) % 7 === 0;
          const glint = pixHash(gx, gy, 31) % 41 === 0;
          put(x0 + px, y0 + py, glint ? C.waterGlint : ripple ? rippleC : deepC);
        }
      }
      // shallows dressing: reeds along the shore, the odd rock breaking water
      if ((shoreN || shoreS || shoreW || shoreE) && pixHash(t, 5, 37) % 4 === 0) {
        const rx2 = x0 + 2 + (pixHash(t, 6, 37) % 4);
        const ry2 = shoreN ? y0 + 1 : shoreS ? y0 + 6 : y0 + 2 + (pixHash(t, 7, 37) % 4);
        put(rx2, ry2, C.bush); // reeds
        put(rx2, ry2 + 1 > y0 + 7 ? y0 + 7 : ry2 + 1, shade(C.bush, 0.8));
      } else if (pixHash(t, 8, 37) % 23 === 0) {
        put(x0 + 3, y0 + 3, C.rock);
        put(x0 + 4, y0 + 3, C.rockShade);
      }
      return;
    }
    case Terrain.Woods: {
      // DESERT: a woods stand is a saguaro patch, not canopy
      if (w.biome[t] === 1 /* Biome.Desert */) {
        for (let py = 0; py < TILE_PX; py++) {
          for (let px = 0; px < TILE_PX; px++) {
            const h = pixHash(x0 + px, y0 + py, 65);
            put(x0 + px, y0 + py, h % 3 === 0 ? C.sandDark : C.sandBg);
          }
        }
        const cx1 = x0 + 2 + (pixHash(t, 1, 67) % 3);
        if (detail) {
          // Large detailed cactus at LOD 3
          for (let py = 2; py <= 6; py++) put(cx1, y0 + py, C.cactus); // trunk
          put(cx1 - 1, y0 + 3, C.cactusDark); // west arm
          put(cx1 - 1, y0 + 2, C.cactus);
          put(cx1 + 1, y0 + 4, C.cactusDark); // east arm
          put(cx1 + 1, y0 + 3, C.cactus);
          put(cx1 + 1, y0 + 7, C.shadow);
        } else {
          // Tiny subtle cactus at LOD 1 (overview)
          put(cx1, y0 + 4, C.cactus);
          put(cx1, y0 + 5, C.cactus);
          put(cx1, y0 + 6, C.cactus);
          put(cx1 - 1, y0 + 5, C.cactusDark);
          put(cx1 + 1, y0 + 6, C.shadow);
        }
        return;
      }
      // Wilderness slowly becomes a cult compound (the fun part)
      const claim = woodsClaim(sim, t, tx, ty);
      const edgeN = ty > 0 && w.terrain[t - w.width] !== Terrain.Woods;
      const edgeW = tx > 0 && w.terrain[t - 1] !== Terrain.Woods;
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const gx = tx * TILE_PX + px;
          const gy = ty * TILE_PX + py;
          const h = pixHash(gx, gy);
          
          let c: RGB;
          if (w.biome[t] === 3 /* Biome.Autumn */ && currentSeason === "fall") {
            const colorRoll = pixHash(gx >> 2, gy >> 2, 79) % 3;
            const aRed = hexToRgb("#96473a"); // muted brick
            const aOrange = hexToRgb("#b06f33"); // muted russet
            const aGold = hexToRgb("#c0a052"); // dry ochre
            const baseCol = colorRoll === 0 ? aRed : colorRoll === 1 ? aOrange : aGold;
            c = h % 3 === 0 ? baseCol : h % 3 === 1 ? shade(baseCol, 0.82) : shade(baseCol, 1.15);
          } else {
            // clumpy canopy: cell-noise blobs of light/dark green + trunk gaps
            const blob = pixHash(gx >> 2, gy >> 2, 77) % 5;
            c = blob < 2 ? C.canopy : blob < 4 ? C.canopyDark : C.canopyLight;
          }
          
          if (h % 23 === 0) c = C.trunk;
          // sunlit fringe on north/west edges
          if ((edgeN && py === 0) || (edgeW && px === 0)) {
            if (w.biome[t] === 3 /* Biome.Autumn */ && currentSeason === "fall") {
              c = hexToRgb("#d2c070"); // soft golden sunlight edge (muted)
            } else {
              c = C.canopyLight;
            }
          }
          if (claim && h % 5 < claim.stage) c = shade(C.canopyLight, 1.18); // clearing
          put(x0 + px, y0 + py, c);
        }
      }
      if (claim) drawCompoundAssets(sim, claim, t, x0, y0, put);
      return;
    }
  }

  // citizen lot. Ground rule (§2 rev. 3): only BUILT parcels (a home or a
  // town building) take the district ground — lawns in the residential zones,
  // concrete downtown/commercial, gravel in industrial — which is what makes
  // zoning readable at map scale. Empty yards render as open biome ground, so
  // the town sits IN the land instead of on a pale blob.
  const owner = w.owner[t]!;
  const apostate = w.state[t] === TileState.Apostate;
  const pop = w.pop[t]!;
  const district = w.district[t]!;
  const lot = w.lot[t]!;
  const built = lot !== 0 || pop >= 3;
  let lawnBase = hexToRgb(NEUTRAL_BY_DISTRICT[district % NEUTRAL_BY_DISTRICT.length]!);
  const lawnDistrict = district === 1 || district === 2 || district === 4 || district === 0;
  if (lawnDistrict) {
    if (currentSeason === "winter") {
      lawnBase = hexToRgb("#ffffff"); // covered in snow!
    } else if (currentSeason === "fall") {
      lawnBase = hexToRgb("#8a8b54"); // dry autumn lawn
    } else if (currentSeason === "spring") {
      lawnBase = hexToRgb("#4c9c28"); // fresh spring green
    }
  }
  const desertY = w.biome[t] === 1;

  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      const gx = x0 + px;
      const gy = y0 + py;
      let c: RGB;
      if (apostate) {
        c = (gx + gy) % 3 === 0 ? shade(C.scorched, 1.2) : C.scorched;
      } else {
        if (built) {
          if (lawnDistrict) {
            // mown lawn: alternating mowing stripes, the proper green
            c = ((gx >> 1) + (gy >> 1)) % 2 === 0 ? lawnBase : shade(lawnBase, 1.07);
            if (pixHash(gx, gy, 33) % 37 === 0) c = shade(lawnBase, 0.85); // clover
          } else {
            // hard ground: concrete/pavers/gravel speckle
            c = pixHash(gx, gy, 33) % 9 === 0 ? shade(lawnBase, 0.92) : lawnBase;
          }
        } else {
          // open yard: biome ground
          if (desertY) {
            c = pixHash(gx, gy, 65) % 3 === 0 ? C.sandDark : C.sandBg;
          } else {
            const cell = pixHash(gx >> 3, gy >> 3, 13) % 3;
            c = cell === 0 ? C.meadowLight : C.meadow;
            if (w.biome[t] === 2) c = cell === 0 ? C.forestFloor : shade(C.forestFloor, 0.92);
            if (pixHash(gx, gy, 5) % 19 === 0) c = C.scrub;
            if (pixHash(gx, gy, 5) % 211 === 0) c = C.flowerY;
          }
        }
        if (owner !== NEUTRAL) {
          const cult = hexToRgb(colorForPlayer(owner));
          const mixed: RGB = [
            (c[0] + cult[0]) >> 1,
            (c[1] + cult[1]) >> 1,
            (c[2] + cult[2]) >> 1,
          ];
          c =
            owner >= 900
              ? shade(mixed, 0.9)
              : territoryPixel(mixed, archetypeOf.get(owner) ?? "dawn", gx, gy);
        }
      }
      put(gx, gy, c);
    }
  }

  // SIDEWALKS: a concrete strip along every road-facing lot edge — the
  // continuous line a real street front has. Drawn on all citizen tiles so
  // the sidewalk runs unbroken past yards and homes alike. Downtown and the
  // strip get STREETLIGHTS on a steady rhythm.
  if (!apostate) {
    const lit = district === 3 || district === 6;
    const roadSide = (n: number): boolean =>
      n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Road;
    if (ty > 0 && roadSide(t - w.width)) {
      for (let px = 0; px < TILE_PX; px++) {
        const worn = pixHash(x0 + px, y0, 43) % 13 === 0;
        put(x0 + px, y0, worn ? shade(C.sidewalk, 0.85) : C.sidewalk);
        put(x0 + px, y0 + 1, px % 4 === 0 ? shade(C.sidewalk, 0.9) : C.sidewalk);
      }
      if (lit && tx % 4 === 1) {
        put(x0 + 2, y0 + 2, C.shadow); // lamp shadow (13)
        put(x0 + 1, y0 + 1, C.iconDark); // lamp post
        put(x0 + 1, y0, C.windowLit); // warm head
      }
      // downtown street furniture on the off-lamp rhythm: a bench, then a
      // planter, a bus shelter, a trash can — main-street dressing
      if (lit && tx % 4 === 3) {
        put(x0 + 4, y0 + 1, C.plank); // bench
        put(x0 + 5, y0 + 1, C.plankDark);
      }
      if (lit && tx % 8 === 6) {
        put(x0 + 2, y0 + 1, C.rockShade); // planter pot
        put(x0 + 2, y0, C.bush); // its shrub
      }
      if (lit && tx % 16 === 2) {
        put(x0 + 4, y0, C.glassFrame); // bus shelter roof
        put(x0 + 5, y0, C.glassFrame);
        put(x0 + 6, y0, C.glassFrame);
        put(x0 + 4, y0 + 1, C.glass); // glass walls
        put(x0 + 6, y0 + 1, C.glass);
      }
      if (lit && tx % 8 === 4) {
        put(x0 + 6, y0 + 1, hexToRgb("#4a6a42")); // trash can
      }
    }
    if (ty < w.height - 1 && roadSide(t + w.width)) {
      for (let px = 0; px < TILE_PX; px++) {
        put(x0 + px, y0 + TILE_PX - 1, C.sidewalk);
        put(x0 + px, y0 + TILE_PX - 2, px % 4 === 0 ? shade(C.sidewalk, 0.9) : C.sidewalk);
      }
    }
    if (tx > 0 && roadSide(t - 1)) {
      for (let py = 0; py < TILE_PX; py++) {
        put(x0, y0 + py, C.sidewalk);
        put(x0 + 1, y0 + py, py % 4 === 0 ? shade(C.sidewalk, 0.9) : C.sidewalk);
      }
    }
    if (tx < w.width - 1 && roadSide(t + 1)) {
      for (let py = 0; py < TILE_PX; py++) {
        put(x0 + TILE_PX - 1, y0 + py, C.sidewalk);
        put(x0 + TILE_PX - 2, y0 + py, py % 4 === 0 ? shade(C.sidewalk, 0.9) : C.sidewalk);
      }
    }
  }

  if (apostate) return;

  if (lot !== 0) {
    drawLotBuilding(w, t, tx, ty, x0, y0, lot, put);
  } else if (pop >= 8 && (district === 3 || district === 8)) {
    drawBlock(w, tx, ty, x0, y0, t, put); // downtown/ResHigh: segmented building row (§8A)
  } else if (pop >= 3) {
    drawVerge(w, t, tx, ty, x0, y0, district, put); // driveway/walk + street tree
    if (district === 5) drawTrailerHome(x0, y0, t, put, detail); // trailer fringe (§2)
    else if (district === 7) drawIndustrialShed(x0, y0, t, put, detail); // industrial shed
    else if (district === 6 || district === 3) drawCommercialStorefront(x0, y0, t, put, detail); // storefront
    else if (district === 2) drawCollegeBlock(x0, y0, t, put, detail); // campus classroom block
    else {
      // §8A: which side does this lot front? S wins ties (classic draw)
      const isRoad = (n: number): boolean =>
        n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Road;
      const frontage: 0 | 1 | 2 | 3 =
        ty < w.height - 1 && isRoad(t + w.width) ? 0
        : tx < w.width - 1 && isRoad(t + 1) ? 2
        : tx > 0 && isRoad(t - 1) ? 3
        : 1;
      drawHouse(x0, y0, district, t, put, detail, frameTick, frontage, w.biome[t] === 1);
    }
  } else if (pop >= 1) {
    // BACKYARD LIFE (§2 rev. 4): block interiors are the town's backyards —
    // sheds, the odd above-ground pool, vegetable rows, and back fences
    // between neighbors. Variety by pure tile hash.
    const roll = pixHash(t, 4, 91) % 10;
    // trailer-fringe salvage read (§11): junk piles, tires, a rusted car
    if (district === 5 && roll < 4) {
      const rust = hexToRgb("#8a5a3a");
      put(x0 + 2, y0 + 3, rust); // dead car body
      put(x0 + 3, y0 + 3, rust);
      put(x0 + 4, y0 + 3, shade(rust, 0.8));
      put(x0 + 2, y0 + 4, C.iconDark); // wheels off
      put(x0 + 5, y0 + 5, C.iconDark); // tire pile
      put(x0 + 6, y0 + 5, C.iconDark);
      put(x0 + 5, y0 + 2, hexToRgb("#9a948a")); // scrap sheet
    }
    if (roll < 2) {
      // garden shed with a shadow
      put(x0 + 5, y0 + 5, C.shadow);
      put(x0 + 3, y0 + 2, hexToRgb("#8a847a"));
      put(x0 + 4, y0 + 2, hexToRgb("#8a847a"));
      put(x0 + 3, y0 + 3, hexToRgb("#9a948a"));
      put(x0 + 4, y0 + 3, hexToRgb("#9a948a"));
      put(x0 + 3, y0 + 4, C.door);
    } else if (roll === 2) {
      // above-ground pool
      put(x0 + 3, y0 + 3, hexToRgb("#7fc4e8"));
      put(x0 + 4, y0 + 3, hexToRgb("#9fd4f0"));
      put(x0 + 3, y0 + 4, hexToRgb("#9fd4f0"));
      put(x0 + 4, y0 + 4, hexToRgb("#7fc4e8"));
      put(x0 + 2, y0 + 3, C.crosswalk); // rim
      put(x0 + 5, y0 + 4, C.crosswalk);
    } else if (roll < 6) {
      // vegetable garden rows
      for (let gy2 = 2; gy2 <= 5; gy2 += 2) {
        for (let gx2 = 2; gx2 <= 5; gx2++) put(x0 + gx2, y0 + gy2, gy2 === 2 ? C.bush : C.cropRow);
      }
    } else {
      // flowers on the open ground
      for (let i = 0; i < 3; i++) {
        const h = pixHash(t, i, 7);
        put(x0 + 1 + (h % 6), y0 + 1 + ((h >> 4) % 6), i === 0 ? C.flowerW : C.flowerY);
      }
    }
    // back fence between adjacent interior yards (west/north seams)
    const yard = (n: number): boolean =>
      n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Citizen && w.lot[n] === 0 && w.pop[n]! > 0 && w.pop[n]! < 3;
    if (tx > 0 && yard(t - 1)) for (let fy = 1; fy < TILE_PX; fy += 2) put(x0, y0 + fy, C.fence);
    if (ty > 0 && yard(t - w.width)) for (let fx = 1; fx < TILE_PX; fx += 2) put(x0 + fx, y0, C.fence);
  } else {
    // EMPTY YARD (pop 0): still somebody's back lot, never a bare hole —
    // mown stripes, and a shade tree or a bit of clutter on most of them
    const roll = pixHash(t, 5, 97) % 10;
    for (let py = 1; py < TILE_PX; py += 3) {
      for (let px = 0; px < TILE_PX; px++) {
        if ((px + py) % 2 === 0) put(x0 + px, y0 + py, shade(C.meadow, 0.97));
      }
    }
    if (currentSeason === "winter" && roll < 3) {
      // a snowman holds the yard all winter
      put(x0 + 3, y0 + 3, hexToRgb("#ffffff"));
      put(x0 + 3, y0 + 4, hexToRgb("#f0f0f4"));
      put(x0 + 3, y0 + 2, C.iconDark); // the hat
      put(x0 + 4, y0 + 3, hexToRgb("#d23b3b")); // scarf tail
    } else if (currentSeason === "fall" && roll < 3) {
      // raked leaf piles
      put(x0 + 2, y0 + 4, hexToRgb("#b06f33"));
      put(x0 + 3, y0 + 4, hexToRgb("#96473a"));
      put(x0 + 3, y0 + 5, hexToRgb("#c0a052"));
      put(x0 + 5, y0 + 2, hexToRgb("#b06f33"));
    } else if (roll < 4) {
      // back-lot shade tree
      const hx = 2 + (pixHash(t, 6, 97) % 4);
      const hy = 2 + (pixHash(t, 7, 97) % 4);
      put(x0 + hx, y0 + hy, currentSeason === "spring" ? hexToRgb("#e8b8c8") : C.canopy);
      put(x0 + hx + 1, y0 + hy, C.canopyLight);
      put(x0 + hx, y0 + hy + 1, C.canopyDark);
      put(x0 + hx + 1, y0 + hy + 1, C.canopy);
      put(x0 + hx + 2, y0 + hy + 2, C.shadow);
    } else if (roll < 6) {
      // clothesline between two posts
      put(x0 + 2, y0 + 3, C.trunk);
      put(x0 + 6, y0 + 3, C.trunk);
      put(x0 + 3, y0 + 3, C.crosswalk);
      put(x0 + 4, y0 + 3, hexToRgb("#9fd4f0"));
      put(x0 + 5, y0 + 3, C.crosswalk);
    } else if (roll < 8) {
      // wildflower corner
      put(x0 + 2 + (pixHash(t, 8, 97) % 3), y0 + 2, C.flowerW);
      put(x0 + 3, y0 + 5, C.flowerY);
      put(x0 + 5, y0 + 4, C.bush);
    }
    // fences against neighboring yards keep the parcel read
    const yard0 = (n: number): boolean =>
      n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Citizen && w.lot[n] === 0 && w.pop[n]! < 3;
    if (tx > 0 && yard0(t - 1)) for (let fy = 1; fy < TILE_PX; fy += 2) put(x0, y0 + fy, C.fence);
    if (ty > 0 && yard0(t - w.width)) for (let fx = 1; fx < TILE_PX; fx += 2) put(x0 + fx, y0, C.fence);
  }
}

// ------------------------------------------- special-building facades (§7 rev. 2)
//
// The civic/commercial anchors compose ONE front-facing building across their
// whole contiguous footprint instead of repeating per-tile dressing — a 3×2
// school is a single 24×16 facade (roof band, brick wall, window rhythm,
// signed entrance, front lawn/walk), not six red slabs. Each tile draws only
// its own 8×8 slice of the shared design (clipped), so draw order and
// viewport clipping stay correct. All art stays at the fixed 8px/tile logical
// resolution — this is composition, not extra pixel density. The outermost
// 1px ring of the footprint is left untouched so the territory tint (the
// conversion read) still rings the building.

const FACADE_LOTS = new Set<number>([
  Lot.School,
  Lot.HighSchool,
  Lot.Sheriff,
  Lot.Supermarket,
  Lot.Church,
  Lot.Chapel,
  Lot.FireStation,
  Lot.GasStation,
  Lot.Bank,
  Lot.Library,
  Lot.PostOffice,
  Lot.Cinema,
  Lot.Factory,
  Lot.Office,
  Lot.Warehouse,
  Lot.Motel,
]);

/** Top-left anchor + extent of the contiguous same-lot rectangle (stamps are rects). */
function lotRect(
  w: World,
  tx: number,
  ty: number,
  lot: number,
): { ax: number; ay: number; fw: number; fh: number } {
  let ax = tx;
  while (ax > 0 && w.lot[ty * w.width + ax - 1] === lot) ax--;
  let ay = ty;
  while (ay > 0 && w.lot[(ay - 1) * w.width + tx] === lot) ay--;
  let fw = 1;
  while (ax + fw < w.width && w.lot[ay * w.width + ax + fw] === lot && fw < 4) fw++;
  let fh = 1;
  while (ay + fh < w.height && w.lot[(ay + fh) * w.width + ax] === lot && fh < 4) fh++;
  return { ax, ay, fw, fh };
}

/**
 * A real parking lot composed over the whole Parking strip: asphalt with
 * wear, a concrete curb along the building side, painted bays facing the
 * building, a clear aisle, open on the road side. Bays stay empty — cars
 * are a moving system (they drive in and park), never static dressing.
 */
function drawParkingLot(
  w: World,
  ax: number,
  ay: number,
  fw: number,
  fh: number,
  clip: Put,
): void {
  const W = fw * TILE_PX;
  const H = fh * TILE_PX;
  const AX = ax * TILE_PX;
  const AY = ay * TILE_PX;
  const p = (x: number, y: number, c: RGB): void => clip(AX + x, AY + y, c);
  // which side has the street? bays face the OTHER way (the building)
  const counts = [0, 0, 0, 0]; // S, N, E, W
  for (let dx = 0; dx < fw; dx++) {
    if (ay + fh < w.height && w.terrain[(ay + fh) * w.width + ax + dx] === Terrain.Road) counts[0]!++;
    if (ay - 1 >= 0 && w.terrain[(ay - 1) * w.width + ax + dx] === Terrain.Road) counts[1]!++;
  }
  for (let dy = 0; dy < fh; dy++) {
    if (ax + fw < w.width && w.terrain[(ay + dy) * w.width + ax + fw] === Terrain.Road) counts[2]!++;
    if (ax - 1 >= 0 && w.terrain[(ay + dy) * w.width + ax - 1] === Terrain.Road) counts[3]!++;
  }
  let side = 0;
  for (let i = 1; i < 4; i++) if (counts[i]! > counts[side]!) side = i;
  const vert = side <= 1; // depth runs along y
  const DEPTH = vert ? H : W;
  const LAT = vert ? W : H;
  // (l, d) → canvas px, with d=0 on the building side and d=DEPTH-1 at the road
  const at = (l: number, d: number): [number, number] =>
    vert ? [l, side === 0 ? d : DEPTH - 1 - d] : [side === 2 ? d : DEPTH - 1 - d, l];
  // asphalt base with wear
  for (let l = 0; l < LAT; l++) {
    for (let d = 0; d < DEPTH; d++) {
      const [x, y] = at(l, d);
      p(x, y, pixHash(AX + x, AY + y, 53) % 11 === 0 ? shade(C.asphalt, 1.08) : C.asphalt);
    }
  }
  // concrete curb along the building side
  for (let l = 0; l < LAT; l++) {
    const [x, y] = at(l, 0);
    p(x, y, shade(C.sidewalk, 0.95));
  }
  // painted bays (3px pitch) — kept EMPTY: cars are a moving system (they
  // drive in and park), never static dressing
  for (let l = 1; l + 2 < LAT; l += 3) {
    for (let d = 1; d <= 3 && d < DEPTH - 2; d++) {
      const [x, y] = at(l, d);
      p(x, y, C.asphaltDash); // bay stripe
    }
  }
  // final stripe closing the last bay
  if ((LAT - 1) % 3 !== 0) {
    for (let d = 1; d <= 3 && d < DEPTH - 2; d++) {
      const [x, y] = at(LAT - 1, d);
      p(x, y, C.asphaltDash);
    }
  }
}

function drawFacade(
  w: World,
  lot: number,
  ax: number,
  ay: number,
  fw: number,
  fh: number,
  clip: Put,
): void {
  const W = fw * TILE_PX;
  const H = fh * TILE_PX;
  const AX = ax * TILE_PX;
  const AY = ay * TILE_PX;
  const seed = ay * w.width + ax;
  // local put in canvas coords; the outer ring stays ground (territory read)
  const p = (x: number, y: number, c: RGB): void => {
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
    clip(AX + x, AY + y, c);
  };
  const [body, roofC, accent] = LOT_STYLE[lot] ?? LOT_STYLE[Lot.Shop]!;

  // ---- shared scaffold ------------------------------------------------
  const apronH = fh >= 2 ? 3 : 2; // lawn/pavement strip in front of the wall
  const bx0 = 1;
  const bx1 = W - 2;
  const by0 = 1;
  const by1 = H - 1 - apronH; // last wall row; apron below
  const wallW = bx1 - bx0 + 1;
  const cx = (W >> 1) - 1; // door center-left px (doors are 2 wide)

  /** ground apron: the DISTRICT'S own built ground (drawTile's formula), so
   * the lawn around walks/steps meets the neighboring lots without a seam */
  const district = w.district[seed]!;
  let lawnBase = hexToRgb(NEUTRAL_BY_DISTRICT[district % NEUTRAL_BY_DISTRICT.length]!);
  const lawnDistrict = district === 1 || district === 2 || district === 4 || district === 0;
  if (lawnDistrict) {
    if (currentSeason === "winter") lawnBase = hexToRgb("#ffffff");
    else if (currentSeason === "fall") lawnBase = hexToRgb("#8a8b54");
    else if (currentSeason === "spring") lawnBase = hexToRgb("#4c9c28");
  }
  const groundAt = (x: number, y: number): RGB => {
    const gx = AX + x;
    const gy = AY + y;
    if (lawnDistrict)
      return ((gx >> 1) + (gy >> 1)) % 2 === 0 ? lawnBase : shade(lawnBase, 1.07);
    return pixHash(gx, gy, 33) % 9 === 0 ? shade(lawnBase, 0.92) : lawnBase;
  };
  const apron = (kind: "lawn" | "pave"): void => {
    for (let y = by1 + 1; y < H; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (kind === "lawn") {
          p(x, y, groundAt(x, y));
        } else {
          p(x, y, pixHash(AX + x, AY + y, 53) % 9 === 0 ? shade(C.asphalt, 1.1) : C.asphalt);
        }
      }
    }
  };
  /** the front walk from the door down through the apron */
  const walk = (): void => {
    for (let y = by1 + 1; y < H; y++) {
      p(cx, y, C.pathStone);
      p(cx + 1, y, y % 2 === 0 ? C.pathStone : shade(C.pathStone, 0.92));
    }
  };
  /** wall box with subtle texture, an east shade column, a south shadow */
  const wallBox = (x0: number, y0: number, x1: number, y1: number, base: RGB): void => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let c = pixHash(AX + x, AY + y, 71) % 11 === 0 ? shade(base, 0.93) : base;
        if (x === x1) c = shade(c, 0.85); // sun from NW: shaded east face
        p(x, y, c);
      }
    }
    for (let x = x0 + 1; x <= x1 + 1; x++) p(x, y1 + 1, C.shadow); // cast shadow
  };
  /** flat roof band with a lit ridge and an eave shadow */
  const roofBand = (x0: number, x1: number, y0: number, rows: number, c: RGB): void => {
    for (let y = y0; y < y0 + rows; y++) {
      for (let x = x0; x <= x1; x++) {
        p(x, y, y === y0 ? shade(c, 1.12) : y === y0 + rows - 1 ? shade(c, 0.8) : c);
      }
    }
  };
  const win = (x: number, y: number, lit = false): void => {
    p(x, y, lit ? C.windowLit : C.windowDark);
  };
  /** a rhythm of paired windows across the wall */
  const winRow = (y: number, x0: number, x1: number, every = 4): void => {
    for (let x = x0; x + 1 <= x1; x += every) {
      const lit = pixHash(AX + x, AY + y, 19) % 3 === 0;
      win(x, y, lit);
      win(x + 1, y, lit);
    }
  };
  const doorAt = (x: number, y: number, tall = 2): void => {
    for (let i = 0; i < tall; i++) {
      p(x, y - i, C.door);
      p(x + 1, y - i, C.door);
    }
  };

  switch (lot) {
    case Lot.School:
    case Lot.HighSchool: {
      const isHigh = lot === Lot.HighSchool;
      apron("lawn");
      walk();
      const roofRows = fh >= 2 ? 3 : 2;
      roofBand(bx0, bx1, by0, roofRows, roofC);
      wallBox(bx0, by0 + roofRows, bx1, by1, body);
      p(cx, by0 + roofRows, accent); // trim over the entrance
      p(cx + 1, by0 + roofRows, accent);
      // window rhythm both sides of the door, a course every 3 rows
      for (let wy = by0 + roofRows + 2; wy <= by1 - 1; wy += 3) {
        winRow(wy, bx0 + 2, cx - 2);
        winRow(wy, cx + 3, bx1 - 2);
      }
      doorAt(cx, by1, 2);
      p(cx, by1 - 2, accent); // fanlight
      p(cx + 1, by1 - 2, accent);
      if (isHigh) {
        // gym wing: the right third rises into a windowless brick block
        const gx = bx1 - Math.max(4, wallW >> 2);
        for (let y = by0; y <= by1; y++) {
          for (let x = gx; x <= bx1; x++) {
            p(x, y, x === bx1 ? shade(body, 0.65) : y <= by0 + 1 ? shade(body, 0.7) : shade(body, 0.82));
          }
        }
        p(gx + 1, by1, C.door); // gym doors
        p(gx + 2, by1, C.door);
        // marquee sign board on the lawn
        p(bx0 + 1, H - 2, C.iconDark);
        p(bx0 + 1, H - 3, C.crosswalk);
        p(bx0 + 2, H - 3, C.crosswalk);
        p(bx0 + 3, H - 3, C.crosswalk);
      } else {
        // elementary: white belfry on the ridge + the flagpole by the walk
        p(cx, by0, hexToRgb("#ffffff"));
        p(cx + 1, by0, hexToRgb("#ffffff"));
        p(cx, by0 + 1, C.windowDark);
        const fx = cx - 3;
        for (let y = H - 5; y < H - 1; y++) p(fx, y, C.iconDark);
        p(fx + 1, H - 5, hexToRgb("#d23b3b")); // the flag
      }
      break;
    }

    case Lot.Supermarket: {
      apron("pave");
      // big-box: parapet + rooftop HVAC, sign band, full glass storefront
      roofBand(bx0, bx1, by0, 2, roofC);
      p(bx0 + 3, by0, C.rockShade); // HVAC units on the roof
      p(bx0 + 4, by0, C.rock);
      p(bx1 - 4, by0, C.rockShade);
      p(bx1 - 3, by0, C.rock);
      // tall sign band in the brand color with white "letters"
      for (let y = by0 + 2; y <= by0 + 3; y++) {
        for (let x = bx0; x <= bx1; x++) p(x, y, accent);
      }
      for (let x = bx0 + 2; x <= bx1 - 2; x += 3) p(x, by0 + 2, C.crosswalk);
      wallBox(bx0, by0 + 4, bx1, by1, body);
      // glass front: full width, dark panes behind pale frame ribs
      for (let y = by1 - 1; y <= by1; y++) {
        for (let x = bx0 + 1; x <= bx1 - 1; x++) {
          p(x, y, x % 3 === 0 ? C.glassFrame : C.windowDark);
        }
      }
      doorAt(cx, by1, 2);
      // cart corral on the pad
      p(bx1 - 2, H - 2, C.rock);
      p(bx1 - 1, H - 2, C.rockShade);
      break;
    }

    case Lot.Sheriff: {
      apron("pave");
      walk();
      roofBand(bx0, bx1, by0, 2, roofC);
      wallBox(bx0, by0 + 2, bx1, by1, body);
      // navy department band with the gold star — the "SHERIFF" read
      for (let x = bx0; x <= bx1; x++) p(x, by0 + 2, hexToRgb("#3a4a5e"));
      p(cx, by0 + 2, accent);
      p(cx + 1, by0 + 2, accent);
      p(cx, by0 + 3, accent);
      p(cx + 1, by0 + 3, accent);
      // barred holding-cell window (right end)
      p(bx1 - 2, by1 - 1, C.windowDark);
      p(bx1 - 1, by1 - 1, C.iconDark);
      winRow(by1 - 1, bx0 + 2, cx - 2);
      doorAt(cx, by1, 2);
      // comms mast off the west end of the roof
      p(bx0 + 1, by0, C.iconDark);
      p(bx0 + 1, Math.max(1, by0 - 1), C.iconDark);
      break;
    }

    case Lot.Church:
    case Lot.Chapel: {
      apron("lawn");
      const white = body;
      if (W >= 16) {
        // the classic small-town church: corner bell tower + gabled nave
        const tx0 = bx0 + 1;
        const tw = 3;
        for (let y = by0 + 1; y <= by1; y++) {
          for (let x = tx0; x < tx0 + tw; x++) {
            p(x, y, x === tx0 + tw - 1 ? shade(white, 0.85) : white);
          }
        }
        p(tx0 + 1, by0, C.landmarkGold); // the cross over the tower
        p(tx0, by0 + 1, C.landmarkGold);
        p(tx0 + 1, by0 + 1, C.landmarkGold);
        p(tx0 + 2, by0 + 1, C.landmarkGold);
        for (let x = tx0; x < tx0 + tw; x++) p(x, by0 + 2, roofC); // spire cap
        p(tx0 + 1, by0 + 4, C.windowDark); // the bell
        // the nave: pitched roof band + white wall
        const nx0 = tx0 + tw;
        roofBand(nx0, bx1, by0 + 3, 3, roofC);
        wallBox(nx0, by0 + 6, bx1, by1, white);
        // stained glass flanking the doors
        p(nx0 + 1, by1 - 1, hexToRgb("#4477aa"));
        p(nx0 + 1, by1 - 2, hexToRgb("#cc9933"));
        p(bx1 - 1, by1 - 1, hexToRgb("#4477aa"));
        p(bx1 - 1, by1 - 2, hexToRgb("#cc9933"));
        // double doors under a gold fanlight, with their own front walk
        const dx = nx0 + ((bx1 - nx0 - 1) >> 1);
        doorAt(dx, by1, 2);
        p(dx, by1 - 2, accent);
        p(dx + 1, by1 - 2, accent);
        for (let y = by1 + 1; y < H; y++) {
          p(dx, y, C.pathStone);
          p(dx + 1, y, y % 2 === 0 ? C.pathStone : shade(C.pathStone, 0.92));
        }
        break;
      }
      walk();
      // steeple: spire + cross above, bell window below
      const sx = cx;
      const steepleH = Math.min(5, by1 - by0 - 2);
      p(sx, by0, C.landmarkGold); // the cross
      p(sx - 1, by0 + 1, C.landmarkGold);
      p(sx, by0 + 1, C.landmarkGold);
      p(sx + 1, by0 + 1, C.landmarkGold);
      for (let y = by0 + 2; y < by0 + steepleH; y++) {
        p(sx, y, white);
        p(sx + 1, y, shade(white, 0.85));
      }
      p(sx, by0 + 2, C.windowDark); // the bell
      // pitched roof over the nave
      const roofY = by0 + steepleH;
      roofBand(bx0, bx1, roofY, 2, roofC);
      wallBox(bx0, roofY + 2, bx1, by1, white);
      // arched stained glass flanking the doors (only when the nave wall is
      // tall enough that they sit on wall, not roof — the 1×1 chapel skips)
      if (bx1 - bx0 >= 5 && by1 - roofY >= 4) {
        p(bx0 + 1, by1 - 1, hexToRgb("#4477aa"));
        p(bx0 + 1, by1 - 2, hexToRgb("#cc9933"));
        p(bx1 - 1, by1 - 1, hexToRgb("#4477aa"));
        p(bx1 - 1, by1 - 2, hexToRgb("#cc9933"));
      }
      doorAt(cx, by1, 2);
      p(cx, H - 1 - apronH + 1, shade(C.pathStone, 1.05)); // the steps
      p(cx + 1, H - 1 - apronH + 1, shade(C.pathStone, 1.05));
      break;
    }

    case Lot.FireStation: {
      apron("pave");
      roofBand(bx0, bx1, by0, 2, roofC);
      // white sign band ("F D" dashes)
      for (let x = bx0; x <= bx1; x++) p(x, by0 + 2, C.crosswalk);
      p(cx, by0 + 2, hexToRgb("#b03a30"));
      p(cx + 1, by0 + 2, hexToRgb("#b03a30"));
      wallBox(bx0, by0 + 3, bx1, by1, body);
      // two roll-up bays with panel lines — the engines live here
      const bayW = Math.max(3, (wallW - 6) >> 1);
      for (const bx of [bx0 + 2, bx1 - 1 - bayW]) {
        for (let y = by1 - 3; y <= by1; y++) {
          for (let x = bx; x < bx + bayW; x++) {
            p(x, y, y % 2 === 0 ? C.crosswalk : shade(C.crosswalk, 0.88));
          }
        }
      }
      // hose tower on the west end
      for (let y = by0; y <= by0 + 3; y++) {
        p(bx0, y, shade(body, 0.8));
        p(bx0 + 1, y, shade(body, 0.9));
      }
      p(bx0 + 1, by0, C.landmarkGold); // the bell
      break;
    }

    case Lot.GasStation: {
      apron("pave");
      // pavement under everything — the whole lot is an apron
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          p(x, y, pixHash(AX + x, AY + y, 53) % 9 === 0 ? shade(C.asphalt, 1.1) : C.asphalt);
        }
      }
      if (fw === 1) {
        // roadside 1×1: just the canopy, pumps, and a price sign
        for (let x = 1; x <= 6; x++) {
          p(x, 2, hexToRgb("#ffffff"));
          p(x, 3, accent);
        }
        p(1, 4, C.rockShade);
        p(6, 4, C.rockShade);
        p(3, 5, hexToRgb("#cc3333"));
        p(4, 5, hexToRgb("#3f7fbf"));
        p(1, H - 2, C.iconDark);
        p(1, H - 3, accent);
        break;
      }
      // the shop box at the back-east corner
      const shopX = Math.max(bx0, bx1 - 5);
      roofBand(shopX, bx1, by0, 1, hexToRgb("#cc4444"));
      wallBox(shopX, by0 + 1, bx1, by0 + 3, body);
      p(bx1 - 2, by0 + 3, C.door);
      p(shopX + 1, by0 + 2, C.windowDark);
      // the canopy over the pump island (west half)
      const canX1 = Math.min(shopX - 2, bx0 + 6);
      for (let x = bx0 + 1; x <= canX1; x++) {
        p(x, by0 + 1, hexToRgb("#ffffff"));
        p(x, by0 + 2, accent);
      }
      p(bx0 + 1, by0 + 3, C.rockShade); // posts
      p(canX1, by0 + 3, C.rockShade);
      // pumps on their island
      const py = by0 + 4;
      for (let x = bx0 + 1; x <= canX1; x++) p(x, py + 1, shade(C.asphalt, 1.15));
      p(bx0 + 2, py, hexToRgb("#cc3333"));
      p(bx0 + 4, py, hexToRgb("#3f7fbf"));
      // price sign at the corner
      p(bx0, H - 3, C.iconDark);
      p(bx0, H - 4, accent);
      break;
    }

    case Lot.Bank: {
      apron("pave");
      walk();
      // temple front: pediment, columns, tall dark entrance
      p(cx, by0, accent);
      p(cx + 1, by0, accent);
      for (let x = bx0 + 1; x <= bx1 - 1; x++) p(x, by0 + 1, accent);
      wallBox(bx0, by0 + 2, bx1, by1, body);
      for (let y = by0 + 2; y <= by1; y++) {
        p(bx0 + 1, y, hexToRgb("#efe9da")); // the columns
        p(bx1 - 1, y, hexToRgb("#efe9da"));
      }
      doorAt(cx, by1, 3);
      break;
    }

    case Lot.Library: {
      apron("lawn");
      walk();
      // flat cornice (vs the bank's pediment), round window, wide steps
      roofBand(bx0, bx1, by0, 2, roofC);
      wallBox(bx0, by0 + 2, bx1, by1, body);
      p(cx, by0 + 3, C.windowLit); // the round reading-room window
      p(cx + 1, by0 + 3, C.windowLit);
      winRow(by1 - 1, bx0 + 1, cx - 2);
      winRow(by1 - 1, cx + 3, bx1 - 1);
      doorAt(cx, by1, 2);
      for (let x = cx - 1; x <= cx + 2; x++) p(x, by1 + 1, shade(C.pathStone, 1.05));
      break;
    }

    case Lot.PostOffice: {
      apron("pave");
      walk();
      roofBand(bx0, bx1, by0, 2, roofC);
      for (let x = bx0; x <= bx1; x++) p(x, by0 + 2, accent); // the eagle stripe
      wallBox(bx0, by0 + 3, bx1, by1, body);
      winRow(by1 - 1, bx0 + 1, cx - 2);
      doorAt(cx, by1, 2);
      p(bx1 - 1, by1, hexToRgb("#3f5e7a")); // the collection box
      // the flag mast
      p(bx0 + 1, by0, C.iconDark);
      p(bx0 + 1, Math.max(1, by0 - 1), C.iconDark);
      p(bx0 + 2, Math.max(1, by0 - 1), hexToRgb("#d23b3b"));
      break;
    }

    case Lot.Cinema: {
      apron("pave");
      roofBand(bx0, bx1, by0, 2, roofC);
      wallBox(bx0, by0 + 2, bx1, by1, body);
      // the blade sign: a lit vertical strip at the west end
      for (let y = by0; y <= by1 - 1; y++) {
        p(bx0 + 1, y, y % 2 === 0 ? accent : shade(accent, 0.7));
      }
      // marquee canopy: lit gold strip over the entrance
      for (let x = bx0 + 3; x <= bx1 - 1; x++) p(x, by1 - 2, accent);
      doorAt(cx, by1, 2);
      // poster bills flanking the doors
      p(cx - 2, by1, C.crosswalk);
      p(cx + 3, by1, C.crosswalk);
      break;
    }

    case Lot.Factory: {
      apron("pave");
      // sawtooth roof: alternating lit/dark 2px teeth
      for (let y = by0; y < by0 + 2; y++) {
        for (let x = bx0; x <= bx1; x++) {
          p(x, y, ((x - bx0) >> 1) % 2 === 0 ? shade(roofC, 1.1) : shade(roofC, 0.75));
        }
      }
      wallBox(bx0, by0 + 2, bx1, by1, body);
      // the smokestack rises off the east end
      p(bx1 - 1, by0, C.iconDark);
      p(bx1 - 1, Math.max(1, by0 - 1), C.iconDark);
      p(bx1 - 2, by0, shade(C.iconDark, 1.6));
      // big industrial window grids
      for (let x = bx0 + 2; x <= bx1 - 4; x += 4) {
        p(x, by0 + 3, C.windowDark);
        p(x + 1, by0 + 3, C.glassFrame);
        p(x, by0 + 4, C.glassFrame);
        p(x + 1, by0 + 4, C.windowDark);
      }
      // loading dock: roll door + concrete slab
      const dx = bx1 - 3;
      for (let y = by1 - 2; y <= by1; y++) {
        p(dx, y, C.iconDark);
        p(dx + 1, y, shade(C.iconDark, 1.8));
      }
      for (let x = dx - 1; x <= dx + 2; x++) p(x, by1 + 1, C.rock);
      doorAt(bx0 + 2, by1, 2);
      break;
    }

    case Lot.Office: {
      apron("pave");
      walk();
      roofBand(bx0, bx1, by0, 1, roofC);
      wallBox(bx0, by0 + 1, bx1, by1, body);
      // the curtain-wall window grid
      for (let y = by0 + 2; y <= by1 - 1; y += 2) {
        for (let x = bx0 + 1; x <= bx1 - 1; x += 2) {
          p(x, y, pixHash(AX + x, AY + y, 23) % 3 === 0 ? C.windowLit : accent);
        }
      }
      // glass entry
      p(cx, by1, C.glass);
      p(cx + 1, by1, C.glass);
      p(cx, by1 - 1, C.glassFrame);
      p(cx + 1, by1 - 1, C.glassFrame);
      // planters by the door
      p(cx - 2, H - 2, C.bush);
      p(cx + 3, H - 2, C.bush);
      break;
    }

    case Lot.Warehouse: {
      apron("pave");
      // ribbed steel shed: long roof with vertical rib lines
      for (let y = by0; y < by0 + 3; y++) {
        for (let x = bx0; x <= bx1; x++) {
          p(x, y, (x - bx0) % 3 === 0 ? shade(roofC, 0.85) : roofC);
        }
      }
      wallBox(bx0, by0 + 3, bx1, by1, body);
      // two big roll doors + the dock slab
      for (const dx of [bx0 + 2, bx1 - 3]) {
        for (let y = by1 - 1; y <= by1; y++) {
          p(dx, y, C.iconDark);
          p(dx + 1, y, shade(C.iconDark, 1.8));
        }
      }
      for (let x = bx0 + 1; x <= bx1 - 1; x++) p(x, by1 + 1, C.rock);
      break;
    }

    case Lot.Motel: {
      apron("pave");
      // the long eave over a row of unit doors + windows
      roofBand(bx0, bx1, by0, 2, roofC);
      for (let x = bx0; x <= bx1; x++) p(x, by0 + 2, shade(roofC, 0.7)); // eave shadow line
      wallBox(bx0, by0 + 2, bx1, by1, body);
      for (let x = bx0 + 2; x + 1 <= bx1 - 1; x += 3) {
        p(x, by1, C.door);
        p(x + 1, by1 - 1, C.windowDark);
      }
      // the VACANCY pylon on the road end
      p(bx0, H - 2, C.iconDark);
      p(bx0, H - 3, accent);
      p(bx0, H - 4, accent);
      // the pool glints on the east end of the pad
      p(bx1 - 2, H - 2, hexToRgb("#7fc4e8"));
      p(bx1 - 1, H - 2, hexToRgb("#9fd4f0"));
      break;
    }
  }
}

/**
 * Town institutions (Lot enum): flat-roofed civic/commercial boxes with
 * district variety. Multi-tile structures merge — shared edges drop their
 * walls so a 2×2 school reads as one building.
 */
function drawLotBuilding(
  w: World,
  t: number,
  tx: number,
  ty: number,
  x0: number,
  y0: number,
  lot: number,
  put: Put,
): void {
  // the specials compose one front-facing building over their footprint
  if (FACADE_LOTS.has(lot)) {
    const { ax, ay, fw, fh } = lotRect(w, tx, ty, lot);
    const clip: Put = (gx, gy, c) => {
      if (gx >= x0 && gx < x0 + TILE_PX && gy >= y0 && gy < y0 + TILE_PX) put(gx, gy, c);
    };
    // castShadow on the footprint's south/east tiles keeps the drop shadow
    const sameRight = tx < w.width - 1 && w.lot[t + 1] === lot;
    const sameDown = ty < w.height - 1 && w.lot[t + w.width] === lot;
    if (!sameDown || !sameRight) castShadow(x0, y0, put);
    drawFacade(w, lot, ax, ay, fw, fh, clip);
    return;
  }
  if (lot === Lot.Playground) {
    // a mown play lot: swing frame, slide, sandbox
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        put(x0 + px, y0 + py, (px + py) % 2 === 0 ? C.meadowLight : C.meadow);
      }
    }
    put(x0 + 1, y0 + 2, C.trunk); // swing frame
    put(x0 + 1, y0 + 3, C.trunk);
    put(x0 + 3, y0 + 2, C.trunk);
    put(x0 + 3, y0 + 3, C.trunk);
    put(x0 + 2, y0 + 1, C.trunk); // crossbar
    put(x0 + 2, y0 + 3, hexToRgb("#c8554a")); // the swing seat
    put(x0 + 5, y0 + 2, hexToRgb("#3f7fbf")); // slide
    put(x0 + 6, y0 + 3, hexToRgb("#3f7fbf"));
    put(x0 + 5, y0 + 5, C.sand); // sandbox
    put(x0 + 6, y0 + 5, C.sand);
    return;
  }
  if (lot === Lot.Dock) {
    // a plank walkway reaching into the water, rowboat moored at its end
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        put(x0 + px, y0 + py, (px * 7 + py * 13) % 11 === 0 ? shade(C.meadow, 0.94) : C.meadow);
      }
    }
    const waterE = tx < w.width - 1 && w.terrain[t + 1] === Terrain.Lake;
    const waterW = tx > 0 && w.terrain[t - 1] === Terrain.Lake;
    const waterN = ty > 0 && w.terrain[t - w.width] === Terrain.Lake;
    if (waterE || waterW) {
      const dir = waterE ? 1 : -1;
      const sx = waterE ? 2 : 5;
      for (let i = 0; i < 6; i++) {
        put(x0 + sx + dir * i, y0 + 3, i % 2 === 0 ? C.plank : C.plankDark);
        put(x0 + sx + dir * i, y0 + 4, i % 2 === 0 ? C.plankDark : C.plank);
      }
      put(x0 + sx + dir * 5, y0 + 6, C.wall); // the rowboat
      put(x0 + sx + dir * 4, y0 + 6, C.wall);
    } else {
      const dir = waterN ? -1 : 1;
      const sy = waterN ? 5 : 2;
      for (let i = 0; i < 6; i++) {
        put(x0 + 3, y0 + sy + dir * i, i % 2 === 0 ? C.plank : C.plankDark);
        put(x0 + 4, y0 + sy + dir * i, i % 2 === 0 ? C.plankDark : C.plank);
      }
      put(x0 + 6, y0 + sy + dir * 5, C.wall);
      put(x0 + 6, y0 + sy + dir * 4, C.wall);
    }
    return;
  }
  if (lot === Lot.Parking) {
    // one composed lot across the whole strip: curb on the building side,
    // a row of painted bays, an aisle, and an open curb cut on the road side
    const { ax, ay, fw, fh } = lotRect(w, tx, ty, lot);
    const clip: Put = (gx, gy, c) => {
      if (gx >= x0 && gx < x0 + TILE_PX && gy >= y0 && gy < y0 + TILE_PX) put(gx, gy, c);
    };
    drawParkingLot(w, ax, ay, fw, fh, clip);
    return;
  }
  if (lot === Lot.Park) {
    // pocket park: tree + path
    for (let i = 0; i < 5; i++) {
      const h = pixHash(t, i, 21);
      const px = 1 + (h % 6);
      const py = 1 + ((h >> 5) % 6);
      put(x0 + px, y0 + py, i < 3 ? C.canopy : C.canopyLight);
    }
    put(x0 + 4, y0 + 6, C.dirt);
    put(x0 + 5, y0 + 6, C.dirt);
    return;
  }
  if (lot === Lot.Cemetery) {
    // mown grass with neat rows of little headstones + a shade tree
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        put(x0 + px, y0 + py, (px + py) % 2 === 0 ? C.meadow : shade(C.meadow, 0.95));
      }
    }
    for (let ry = 1; ry <= 6; ry += 2) {
      for (let rx = 1; rx <= 6; rx += 2) {
        const c = pixHash(t, rx * 8 + ry, 61) % 4 === 0 ? C.rockShade : C.rock;
        put(x0 + rx, y0 + ry, c); // headstone
        put(x0 + rx, y0 + ry + 1, C.shadow); // its little shadow
      }
    }
    return;
  }
  if (lot === Lot.BallField) {
    // a green outfield with the brown infield diamond + base paths
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        put(x0 + px, y0 + py, (px + py) % 2 === 0 ? C.meadowLight : C.meadow);
      }
    }
    // diamond of skinned dirt in the lower-left corner (home plate)
    for (let py = 3; py <= 6; py++) {
      for (let px = 1; px <= 4; px++) {
        if (Math.abs(px - 1) + Math.abs(py - 6) <= 3) put(x0 + px, y0 + py, C.dirt);
      }
    }
    put(x0 + 1, y0 + 6, C.wall); // home plate
    // backstop arc behind home plate + a bleacher strip along the foul line (§7)
    put(x0, y0 + 5, C.iconDark);
    put(x0, y0 + 6, C.iconDark);
    put(x0 + 1, y0 + 7, C.iconDark);
    put(x0 + 4, y0 + 1, hexToRgb("#b0a890")); // bleachers
    put(x0 + 5, y0 + 1, hexToRgb("#b0a890"));
    put(x0 + 6, y0 + 1, hexToRgb("#b0a890"));
    put(x0 + 5, y0 + 2, shade(hexToRgb("#b0a890"), 0.8));
    put(x0 + 6, y0 + 2, shade(hexToRgb("#b0a890"), 0.8));
    return;
  }

  const [body, roof, accent] = LOT_STYLE[lot] ?? LOT_STYLE[Lot.Shop]!;
  const sameLeft = tx > 0 && w.lot[t - 1] === lot;
  const sameRight = tx < w.width - 1 && w.lot[t + 1] === lot;
  const sameUp = ty > 0 && w.lot[t - w.width] === lot;
  const sameDown = ty < w.height - 1 && w.lot[t + w.width] === lot;

  // shadow on the south/east faces of the whole footprint (sun from NW)
  if (!sameDown || !sameRight) castShadow(x0, y0, put);

  const xL = sameLeft ? 0 : 1;
  const xR = sameRight ? TILE_PX - 1 : TILE_PX - 2;
  const yT = sameUp ? 0 : 1;
  const yB = sameDown ? TILE_PX - 1 : TILE_PX - 2;

  for (let py = yT; py <= yB; py++) {
    for (let px = xL; px <= xR; px++) {
      const roofRow = !sameUp && py <= yT + 1;
      let c = roofRow ? roof : body;
      // Seam shadow on boundaries to delineate adjacent building parts
      if ((px === 0 && sameLeft) || (px === TILE_PX - 1 && sameRight) || (py === 0 && sameUp)) {
        c = shade(c, 0.85);
      }
      put(x0 + px, y0 + py, c);
    }
  }

  // type-specific dressing
  switch (lot) {
    case Lot.Silo:
      // cylinder: round the corners, dome cap
      put(x0 + 2, y0, accent);
      put(x0 + 3, y0, accent);
      put(x0 + 4, y0, accent);
      put(x0 + 5, y0, accent);
      break;
    case Lot.Barn:
      put(x0 + 3, y0 + 3, accent); // the white X door
      put(x0 + 4, y0 + 4, accent);
      put(x0 + 4, y0 + 3, accent);
      put(x0 + 3, y0 + 4, accent);
      // a tractor parked by the barn on some farmsteads (§9)
      if (pixHash(t, 17, 43) % 2 === 0) {
        const tractorC = pixHash(t, 18, 43) % 2 === 0 ? hexToRgb("#2f6e2f") : hexToRgb("#b03a2a");
        put(x0 + 6, y0 + 6, tractorC);
        put(x0 + 6, y0 + 5, tractorC);
        put(x0 + 7, y0 + 6, C.iconDark); // rear wheel
      }
      break;
    case Lot.Diner:
      // Retro Diner: chrome panel walls, neon strip, large glass storefront
      for (let py = 3; py <= 5; py++) {
        for (let px = 1; px <= 6; px++) {
          put(x0 + px, y0 + py, hexToRgb("#cbd2d6")); // shiny chrome siding
        }
      }
      for (let px = 0; px < TILE_PX; px++) put(x0 + px, y0 + 2, hexToRgb("#d23b3b")); // red neon strip
      put(x0 + 2, y0 + 4, hexToRgb("#3f7fbf")); // big windows
      put(x0 + 5, y0 + 4, hexToRgb("#3f7fbf"));
      put(x0 + 3, y0 + 5, C.door);
      break;
    case Lot.GrainElevator: {
      const lightSteel = hexToRgb("#dce2e6");
      const darkSteel = hexToRgb("#8a9399");
      const redLight = hexToRgb("#d23b3b");
      if (!sameLeft) {
        // Left part: Tall cylindrical concrete silos
        for (let py = 1; py <= 6; py++) {
          put(x0 + 1, y0 + py, lightSteel);
          put(x0 + 2, y0 + py, darkSteel);
          put(x0 + 3, y0 + py, darkSteel);
          put(x0 + 5, y0 + py, lightSteel);
          put(x0 + 6, y0 + py, darkSteel);
        }
        // Silo dome tops
        put(x0 + 2, y0, lightSteel);
        put(x0 + 6, y0, lightSteel);
      } else {
        // Right part: Main headhouse tower (extends higher)
        for (let py = 0; py <= 6; py++) {
          put(x0 + 2, y0 + py, darkSteel);
          put(x0 + 3, y0 + py, lightSteel);
          put(x0 + 4, y0 + py, darkSteel);
        }
        // Red warning beacon on top of headhouse
        put(x0 + 3, y0 - 1 < 0 ? 0 : y0 - 1, redLight);
        // Grain loading spout chute
        put(x0 + 5, y0 + 2, darkSteel);
        put(x0 + 6, y0 + 3, darkSteel);
        // the OFFICE SHED (§7): a small scale-house at the elevator's foot
        put(x0 + 5, y0 + 5, hexToRgb("#9a8468"));
        put(x0 + 6, y0 + 5, hexToRgb("#9a8468"));
        put(x0 + 5, y0 + 6, hexToRgb("#8a7458"));
        put(x0 + 6, y0 + 6, C.door);
      }
      break;
    }
    case Lot.Depot: {
      const brick = hexToRgb("#a25b42");
      const brickDark = hexToRgb("#7d402b");
      const wood = hexToRgb("#c5a059");
      const bench = hexToRgb("#6b4c2b");
      const windowC = C.windowDark;
      // Brick walls
      for (let py = 2; py <= 5; py++) {
        for (let px = 1; px <= 6; px++) {
          put(x0 + px, y0 + py, px % 2 === 0 ? brick : brickDark);
        }
      }
      // Overhanging roof
      for (let px = 0; px < TILE_PX; px++) {
        put(x0 + px, y0 + 1, accent);
        put(x0 + px, y0 + 2, shade(accent, 0.7));
      }
      put(x0 + 2, y0 + 3, windowC);
      put(x0 + 5, y0 + 3, windowC);
      put(x0 + 3, y0 + 4, C.door);
      // Wood platform
      for (let px = 0; px < TILE_PX; px++) {
        put(x0 + px, y0 + 6, wood);
        if (px % 3 === 0) put(x0 + px, y0 + 7, shade(wood, 0.8));
      }
      put(x0 + 5, y0 + 5, bench);
      put(x0 + 6, y0 + 5, bench);
      break;
    }
    case Lot.Greenhouse:
      // glass panes with frame ribs + a sun glint
      for (let gy2 = 2; gy2 <= 5; gy2++) {
        for (let gx2 = 2; gx2 <= 5; gx2++) {
          put(x0 + gx2, y0 + gy2, gx2 % 2 === 0 ? C.glassFrame : C.glass);
        }
      }
      put(x0 + 3, y0 + 3, C.crosswalk); // glint
      put(x0 + 3, y0 + 6, C.door);
      break;
    case Lot.Shop: {
      const shopHash = pixHash(t, 29);
      const isFlatParapet = shopHash % 3 === 0;
      const doorX = (shopHash % 3 === 1) ? 2 : (shopHash % 3 === 2) ? 5 : 3;

      for (let py = 3; py <= 6; py++) {
        for (let px = 1; px <= 6; px++) {
          put(x0 + px, y0 + py, body);
        }
      }

      if (isFlatParapet) {
        const cornice = shade(roof, 0.8);
        for (let px = 1; px <= 6; px++) put(x0 + px, y0 + 2, cornice);
        const winX = doorX === 2 ? 5 : 2;
        put(x0 + winX, y0 + 4, C.windowDark);
        put(x0 + winX + 1, y0 + 4, C.windowDark);
      } else {
        for (let px = 1; px <= 6; px++) put(x0 + px, y0 + 2, roof);
        const awnCol = [hexToRgb("#d23b3b"), hexToRgb("#3f7fbf"), hexToRgb("#3fbf7f")][shopHash % 3]!;
        for (let px = 1; px <= 6; px++) {
          const isStripe = px % 2 === 0;
          put(x0 + px, y0 + 3, isStripe ? awnCol : shade(awnCol, 0.85));
        }
      }

      put(x0 + doorX, y0 + 5, C.door);
      put(x0 + doorX, y0 + 6, C.door);
      // strip fillers (§7): some shops read as the LAUNDROMAT (a porthole
      // washer window row) or the BARBER (red/white pole by the door)
      const filler = pixHash(t, 31) % 5;
      if (filler === 0) {
        put(x0 + 2, y0 + 4, hexToRgb("#cfd8de")); // washer portholes
        put(x0 + 4, y0 + 4, hexToRgb("#cfd8de"));
        put(x0 + 6, y0 + 4, hexToRgb("#cfd8de"));
      } else if (filler === 1) {
        const poleX = doorX <= 3 ? doorX + 1 : doorX - 1;
        put(x0 + poleX, y0 + 4, hexToRgb("#d23b3b")); // the barber pole
        put(x0 + poleX, y0 + 5, hexToRgb("#f0f0f0"));
        put(x0 + poleX, y0 + 6, hexToRgb("#3f5fbf"));
      }
      break;
    }
    case Lot.Dam: {
      const concrete = hexToRgb("#8c8c8c");
      const shadowC = hexToRgb("#5c5c5c");
      const whiteWater = hexToRgb("#cbe3f0");
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          if (py <= 2) {
            put(x0 + px, y0 + py, concrete);
          } else if (py === 3) {
            put(x0 + px, y0 + py, shadowC);
          } else if (py === 4 || py === 5) {
            put(x0 + px, y0 + py, pixHash(x0 + px, y0 + py, 77) % 2 === 0 ? whiteWater : C.waterRipple);
          } else {
            put(x0 + px, y0 + py, C.waterDeep);
          }
        }
      }
      break;
    }
    case Lot.WaterTower: {
      const metal = hexToRgb("#cbd2d6");
      const metalDark = hexToRgb("#8a9399");
      const shadowC = C.shadow;
      for (let py = 4; py <= 6; py++) {
        put(x0 + 2, y0 + py, metalDark);
        put(x0 + 5, y0 + py, metalDark);
      }
      put(x0 + 3, y0 + 6, metalDark);
      put(x0 + 4, y0 + 6, metalDark);
      put(x0 + 2, y0 + 1, metal);
      put(x0 + 3, y0 + 1, metal);
      put(x0 + 4, y0 + 1, metal);
      put(x0 + 5, y0 + 1, metal);
      put(x0 + 1, y0 + 2, metal);
      put(x0 + 2, y0 + 2, metalDark);
      put(x0 + 3, y0 + 2, metal);
      put(x0 + 4, y0 + 2, metal);
      put(x0 + 5, y0 + 2, metalDark);
      put(x0 + 6, y0 + 2, metal);
      put(x0 + 2, y0 + 3, metal);
      put(x0 + 3, y0 + 3, metal);
      put(x0 + 4, y0 + 3, metal);
      put(x0 + 5, y0 + 3, metal);
      put(x0 + 2, y0 + 7, shadowC);
      put(x0 + 5, y0 + 7, shadowC);
      break;
    }
    case Lot.Substation: {
      const gravel = hexToRgb("#cbd0d4");
      const metal = hexToRgb("#8a9399");
      const fence = C.iconDark;
      const warning = hexToRgb("#d23b3b"); // danger sign
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          put(x0 + px, y0 + py, gravel);
        }
      }
      for (let i = 0; i < TILE_PX; i++) {
        if (i % 2 === 0) {
          put(x0 + i, y0, fence);
          put(x0 + i, y0 + TILE_PX - 1, fence);
          put(x0, y0 + i, fence);
          put(x0 + TILE_PX - 1, y0 + i, fence);
        }
      }
      put(x0 + 2, y0 + 2, metal);
      put(x0 + 2, y0 + 3, metal);
      put(x0 + 5, y0 + 2, metal);
      put(x0 + 5, y0 + 3, metal);
      put(x0 + 4, y0 + 5, warning);
      put(x0 + 3, y0 + 2, C.glassFrame);
      put(x0 + 4, y0 + 2, C.glassFrame);
      put(x0 + 2, y0 + 1, C.wire);
      put(x0 + 3, y0 + 1, C.wire);
      put(x0 + 4, y0 + 1, C.wire);
      put(x0 + 5, y0 + 1, C.wire);
      break;
    }
    case Lot.Lighthouse: {
      // white tower with the red lamp room — the coast's landmark (§2A)
      for (let py = 1; py <= 6; py++) {
        put(x0 + 3, y0 + py, body);
        put(x0 + 4, y0 + py, shade(body, 0.88));
      }
      put(x0 + 3, y0 + 1, roof); // lamp room
      put(x0 + 4, y0 + 1, roof);
      put(x0 + 3, y0, accent); // the light
      put(x0 + 4, y0, accent);
      put(x0 + 2, y0 + 4, shade(body, 0.8)); // gallery band
      put(x0 + 5, y0 + 4, shade(body, 0.8));
      break;
    }
    case Lot.Cannery: {
      // long low fish house: gray body, skylight strip, crate stack
      put(x0 + 2, y0 + 2, accent); // skylights
      put(x0 + 4, y0 + 2, accent);
      put(x0 + 2, y0 + 5, hexToRgb("#8a6a42")); // crates
      put(x0 + 3, y0 + 5, hexToRgb("#8a6a42"));
      put(x0 + 5, y0 + 4, C.door);
      break;
    }
    case Lot.Sawmill: {
      // timber shed + the log deck (stacked butts) out front
      if (!sameLeft) {
        put(x0 + 1, y0 + 5, hexToRgb("#c8a25c")); // log butts
        put(x0 + 1, y0 + 6, hexToRgb("#b08a48"));
        put(x0 + 2, y0 + 6, hexToRgb("#c8a25c"));
      }
      put(x0 + 4, y0 + 2, accent); // roof vent
      put(x0 + 3, y0 + 5, C.door);
      if (!sameRight) put(x0 + 6, y0 + 1, C.iconDark); // sawdust burner
      break;
    }
    default: {
      put(x0 + 2, y0 + 3, accent);
      put(x0 + 3, y0 + 3, accent);
      put(x0 + 4, y0 + 3, accent);
      put(x0 + 5, y0 + 3, accent);
      put(x0 + 3, y0 + 5, C.door);
      break;
    }
  }
}

interface WoodsClaim {
  owner: number;
  archetype: Archetype;
  /** 1..3 — how far along the takeover is */
  stage: number;
}

/** Which cult is colonizing this patch of wilderness, and how hard. */
function woodsClaim(sim: SimState, t: number, tx: number, ty: number): WoodsClaim | null {
  const w = sim.world;
  // majority owner within radius 2
  const counts = new Map<number, number>();
  for (let dy = -2; dy <= 2; dy++) {
    const y = ty + dy;
    if (y < 0 || y >= w.height) continue;
    for (let dx = -2; dx <= 2; dx++) {
      const x = tx + dx;
      if (x < 0 || x >= w.width) continue;
      const o = w.owner[y * w.width + x]!;
      if (o !== NEUTRAL) counts.set(o, (counts.get(o) ?? 0) + 1);
    }
  }
  let owner = 0;
  let best = 2; // need at least 3 owned tiles nearby to start moving in
  for (const [o, n] of [...counts.entries()].sort((a, z) => a[0] - z[0])) {
    if (n > best) {
      best = n;
      owner = o;
    }
  }
  if (!owner) return null;
  const p = sim.players.find((pl) => pl.id === owner);
  if (!p || !p.alive) return null;
  const permille = sim.populated > 0 ? (p.ownedTiles * 1000) / sim.populated : 0;
  const stage = permille >= 150 ? 3 : permille >= 70 ? 2 : permille >= 25 ? 1 : 0;
  if (stage === 0) return null;
  return { owner, archetype: p.archetype, stage };
}

/** Archetype set-dressing in claimed wilderness; density scales with stage. */
function drawCompoundAssets(
  sim: SimState,
  claim: WoodsClaim,
  t: number,
  x0: number,
  y0: number,
  put: Put,
): void {
  const h = pixHash(t, claim.owner, 3);
  if (h % 4 >= claim.stage) return; // sparse at stage 1, common at stage 3
  const ax = x0 + 1 + (h % 5);
  const ay = y0 + 1 + ((h >> 6) % 5);
  const cult = hexToRgb(colorForPlayer(claim.owner));
  switch (claim.archetype) {
    case "dawn": {
      // bonfire: flame over an effigy post
      put(ax, ay + 2, C.trunk);
      put(ax, ay + 1, hexToRgb("#e25822"));
      put(ax, ay, hexToRgb("#ffb347"));
      if (claim.stage >= 2) put(ax + 1, ay + 1, hexToRgb("#e25822"));
      break;
    }
    case "radiant": {
      // geodesic dome (suspiciously nice yurt)
      put(ax, ay + 1, hexToRgb("#efe6d0"));
      put(ax + 1, ay + 1, hexToRgb("#efe6d0"));
      put(ax, ay, shade(hexToRgb("#efe6d0"), 0.85));
      put(ax + 1, ay, shade(hexToRgb("#efe6d0"), 0.85));
      if (claim.stage >= 2) put(ax + 2, ay + 1, cult); // prayer flag
      break;
    }
    case "circle": {
      // billboard on posts, gold $ gleam
      put(ax, ay, cult);
      put(ax + 1, ay, C.iconAccent);
      put(ax + 2, ay, cult);
      put(ax, ay + 1, C.trunk);
      put(ax + 2, ay + 1, C.trunk);
      break;
    }
    case "visitors": {
      // crop-circle ring (stage 3 adds the saucer glint)
      put(ax, ay + 1, C.canopyLight);
      put(ax + 2, ay + 1, C.canopyLight);
      put(ax + 1, ay, C.canopyLight);
      put(ax + 1, ay + 2, C.canopyLight);
      if (claim.stage >= 3) put(ax + 1, ay + 1, hexToRgb("#9bf6ff"));
      break;
    }
  }
}

/**
 * Directional drop shadow: a soft dark fringe along the south and east of a
 * footprint (sun from the north-west), giving every structure a 3D pop. Cast
 * onto the lot ground before the building body is drawn over it.
 */
function castShadow(x0: number, y0: number, put: Put, w = 6): void {
  for (let px = 2; px <= w + 1; px++) put(x0 + px, y0 + TILE_PX - 1, C.shadow);
  for (let py = 3; py <= TILE_PX - 1; py++) put(x0 + TILE_PX - 1, y0 + py, C.shadow);
}

/**
 * Street furniture on a house lot's road frontage (§2 rev. 4): NO driveway
 * blobs — the lawn runs to the sidewalk. Instead: street trees at a regular
 * civic rhythm, a fire hydrant every few lots, and a mailbox at the curb.
 */
function drawVerge(
  w: World,
  t: number,
  tx: number,
  ty: number,
  x0: number,
  y0: number,
  district: number,
  put: Put,
): void {
  void district;
  const isRoad = (n: number): boolean =>
    n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Road;
  const south = isRoad(t + w.width);
  const north = ty > 0 && isRoad(t - w.width);
  const east = tx < w.width - 1 && isRoad(t + 1);
  const west = tx > 0 && w.terrain[t - 1] === Terrain.Road;
  if (!(south || north || east || west)) return;
  const edgeY = south ? y0 + 7 : north ? y0 : y0 + 4;
  const edgeX = east ? x0 + 7 : west ? x0 : x0 + 1;
  // street trees on a regular rhythm — every 3rd frontage lot
  const along = south || north ? tx : ty;
  if (along % 3 === 0) {
    put(edgeX, edgeY, C.canopyDark);
    put(edgeX, Math.max(y0, edgeY - 1), C.canopy);
  }
  // fire hydrant every ~6 lots (squat red pixel by the curb)
  if (along % 6 === 2) {
    const hx = south || north ? x0 + 6 : edgeX;
    const hy = south ? y0 + 6 : north ? y0 + 1 : y0 + 6;
    put(hx, hy, hexToRgb("#d23b3b"));
  }
  // mailbox at the curb of the remaining lots
  if (along % 3 === 1) {
    const mx = south || north ? x0 + 2 : edgeX;
    const my = south ? y0 + 6 : north ? y0 + 1 : y0 + 2;
    put(mx, my, C.trunk);
    put(mx, my - 1 < y0 ? y0 : my - 1, C.rockShade);
  }
}

/** family house: roof, wall, door — roof color by district. */
function drawHouse(
  x0: number,
  y0: number,
  district: number,
  t: number,
  put: Put,
  detail: Detail | null = null,
  frameTick = 0,
  frontage: 0 | 1 | 2 | 3 = 0, // 0=S (default) · 1=N · 2=E · 3=W — fronting road side
  adobe = false, // §2A desert archetype: clay walls + earthen roofs
): void {
  castShadow(x0, y0, put);
  const houseLit = currentTimeOfDay === "night" && pixHash(t, 42) % 10 < 6;
  const houseWindow = houseLit ? C.windowLit : C.windowDark;
  // per-house roof tone variance — sun-faded and re-shingled roofs mixed in
  const roofVar = [0.92, 1, 1.07][pixHash(t, 35) % 3]!;
  const roof =
    currentSeason === "winter" ? hexToRgb("#ffffff")
    : adobe ? [hexToRgb("#b08252"), hexToRgb("#9a6e44")][pixHash(t, 40) % 2]!
    : shade(ROOFS[district % ROOFS.length]!, roofVar);
  const flip = pixHash(t, 1) & 1; // left/right flip

  const ADOBE_WALLS = [hexToRgb("#d8b88a"), hexToRgb("#c9a877"), hexToRgb("#e2cba0")];
  const wallColors = adobe ? ADOBE_WALLS : (DISTRICT_WALLS[district] ?? DISTRICT_WALLS[1]!);
  const wallColor = wallColors[pixHash(t, 2) % wallColors.length]!;
  const wallShadeColor = shade(wallColor, 0.88);

  const shape = pixHash(t, 34) % 3;

  // §8A alignment: a gable fronting an E/W street turns its ridge to run
  // parallel to that street — the roofline follows the plat, and the door
  // sits on the street side. (N/S frontages keep the classic S-facing draw;
  // at aerial scale the walk + driveway carry that read.)
  if (shape === 0 && (frontage === 2 || frontage === 3)) {
    const east = frontage === 2;
    const wallX = east ? [4, 5, 6] : [1, 2, 3]; // walls on the street side
    const roofX = east ? [1, 2, 3] : [4, 5, 6];
    for (let py = 1; py <= 5; py++) {
      put(x0 + roofX[1]!, y0 + py, shade(roof, 1.1)); // lit ridge col
      put(x0 + roofX[0]!, y0 + py, roof);
      put(x0 + roofX[2]!, y0 + py, roof);
      put(x0 + wallX[0]!, y0 + py, wallShadeColor);
      put(x0 + wallX[1]!, y0 + py, py <= 1 ? wallShadeColor : wallColor);
      put(x0 + wallX[2]!, y0 + py, py <= 1 ? wallShadeColor : wallColor);
    }
    const chimY = flip ? 4 : 1;
    put(x0 + roofX[1]!, y0 + chimY, shade(roof, 0.6));
    if (frameTick > 0 && pixHash(t, 6, 59) % 3 === 0) {
      const phase = ((frameTick >> 3) + t) % 4;
      const sy = y0 + chimY - 1 - (phase >> 1);
      if (sy >= 0) put(x0 + roofX[1]! + (phase % 2 ? 1 : 0), sy, hexToRgb("#c9c4bc"));
    }
    const doorY = flip ? 1 : 4;
    put(x0 + wallX[2]!, y0 + doorY, C.door);
    put(x0 + wallX[2]!, y0 + doorY + 1 > y0 + 6 ? y0 + 6 : y0 + doorY + 1, C.door);
    put(x0 + wallX[2]!, y0 + (flip ? 4 : 1), houseWindow);
    return;
  }

  if (shape === 1) {
    // ---- Two-Story House (shifted up to show driveway) ----
    // Top ridge: y=0, x=3..4
    put(x0 + 3, y0, shade(roof, 1.1));
    put(x0 + 4, y0, shade(roof, 1.1));
    // Top roof: y=1, x=2..5
    for (let px = 2; px <= 5; px++) put(x0 + px, y0 + 1, roof);
    // Upper wall: y=2, x=2..5
    for (let px = 2; px <= 5; px++) put(x0 + px, y0 + 2, wallShadeColor);
    // Lower roof: y=3, x=1..6
    for (let px = 1; px <= 6; px++) put(x0 + px, y0 + 3, roof);
    // Lower wall: y=4..5, x=1..6
    for (let px = 1; px <= 6; px++) {
      put(x0 + px, y0 + 4, wallShadeColor);
      put(x0 + px, y0 + 5, wallColor);
    }
    // Chimney: y=0..1, x=2
    put(x0 + 2, y0, shade(roof, 0.6));
    put(x0 + 2, y0 + 1, shade(roof, 0.6));
    if (frameTick > 0 && pixHash(t, 6, 59) % 3 === 0) {
      const phase = ((frameTick >> 3) + t) % 4;
      const sy = y0 - (phase >> 1);
      if (sy >= 0) put(x0 + 2 + (phase % 2), sy, hexToRgb("#c9c4bc"));
    }
    // Door: y=4..5, x=doorX
    const doorX = flip ? 2 : 5;
    put(x0 + doorX, y0 + 4, C.door);
    put(x0 + doorX, y0 + 5, C.door);
    // Window: y=2 (upper), y=4 (lower)
    put(x0 + (flip ? 4 : 3), y0 + 2, houseWindow);
    put(x0 + (flip ? 5 : 2), y0 + 4, houseWindow);

    if (detail) {
      const S = detail.S;
      const f = detail.putF;
      // Window mullions (lower)
      const frame = shade(wallColor, 0.7);
      const wbx = (x0 + (flip ? 5 : 2)) * S;
      const wby = (y0 + 4) * S;
      for (let i = 0; i < S; i++) {
        f(wbx + Math.floor(S / 2), wby + i, frame);
        f(wbx + i, wby + Math.floor(S / 2), frame);
      }
      f(wbx + 1, wby + 1, C.windowLit);
    }
  } else if (shape === 2) {
    // ---- L-Plan House (shifted up to show driveway) ----
    if (!flip) {
      // Wing (x=1..3), Main (x=4..6)
      // Main ridge: y=0, x=5
      put(x0 + 5, y0, shade(roof, 1.1));
      // Main roof: y=1..2, x=4..6
      for (let py = 1; py <= 2; py++) {
        for (let px = 4; px <= 6; px++) put(x0 + px, y0 + py, roof);
      }
      // Wing ridge: y=1, x=2
      put(x0 + 2, y0 + 1, shade(roof, 1.1));
      // Wing roof: y=2, x=1..3
      for (let px = 1; px <= 3; px++) put(x0 + px, y0 + 2, roof);
      // Walls
      for (let px = 1; px <= 3; px++) {
        put(x0 + px, y0 + 3, wallShadeColor);
        put(x0 + px, y0 + 4, wallColor);
        put(x0 + px, y0 + 5, wallColor);
      }
      for (let px = 4; px <= 6; px++) {
        put(x0 + px, y0 + 3, wallShadeColor);
        put(x0 + px, y0 + 4, wallColor);
      }
      // Door (recessed corner): x=4, y=4
      put(x0 + 4, y0 + 4, C.door);
      // Window: wing center x=2, y=4
      put(x0 + 2, y0 + 4, houseWindow);
    } else {
      // Main (x=1..3), Wing (x=4..6)
      // Main ridge: y=0, x=2
      put(x0 + 2, y0, shade(roof, 1.1));
      // Main roof: y=1..2, x=1..3
      for (let py = 1; py <= 2; py++) {
        for (let px = 1; px <= 3; px++) put(x0 + px, y0 + py, roof);
      }
      // Wing ridge: y=1, x=5
      put(x0 + 5, y0 + 1, shade(roof, 1.1));
      // Wing roof: y=2, x=4..6
      for (let px = 4; px <= 6; px++) put(x0 + px, y0 + 2, roof);
      // Walls
      for (let px = 1; px <= 3; px++) {
        put(x0 + px, y0 + 3, wallShadeColor);
        put(x0 + px, y0 + 4, wallColor);
      }
      for (let px = 4; px <= 6; px++) {
        put(x0 + px, y0 + 3, wallShadeColor);
        put(x0 + px, y0 + 4, wallColor);
        put(x0 + px, y0 + 5, wallColor);
      }
      // Door (recessed corner): x=3, y=4
      put(x0 + 3, y0 + 4, C.door);
      // Window: wing center x=5, y=4
      put(x0 + 5, y0 + 4, houseWindow);
    }
  } else {
    // ---- Classic Gable (shape 0) (shifted up to show driveway) ----
    for (let px = 1; px <= 5; px++) {
      put(x0 + px, y0 + 1, shade(roof, 1.1));
      put(x0 + px, y0 + 2, roof);
    }
    put(x0 + 2, y0, shade(roof, 1.1));
    put(x0 + 3, y0, shade(roof, 1.1));
    put(x0 + 4, y0, shade(roof, 1.1));
    for (let py = 3; py <= 5; py++) {
      for (let px = 1; px <= 5; px++) {
        put(x0 + px, y0 + py, py === 3 ? wallShadeColor : wallColor);
      }
    }
    const chimX = flip ? 4 : 2;
    put(x0 + chimX, y0 - 1, shade(roof, 0.6));
    put(x0 + chimX, y0, shade(roof, 0.6));
    if (frameTick > 0 && pixHash(t, 6, 59) % 3 === 0) {
      const phase = ((frameTick >> 3) + t) % 4;
      const sy = y0 - 2 - (phase >> 1);
      if (sy >= 0) put(x0 + chimX + (phase % 2 ? 1 : 0), sy, hexToRgb("#c9c4bc"));
    }
    const doorX = flip ? 1 : 4;
    put(x0 + doorX, y0 + 4, C.door);
    put(x0 + doorX, y0 + 5, C.door);
    put(x0 + (flip ? 4 : 2), y0 + 4, houseWindow);
    
    if (pixHash(t, 5, 53) % 2 === 0) {
      put(x0 + doorX - 1, y0 + 4, wallShadeColor);
      put(x0 + doorX, y0 + 4, wallShadeColor);
      put(x0 + (flip ? doorX + 1 : doorX - 1), y0 + 5, C.door);
    }
    // GARAGE (§8): a flat-roof bay tucked on the corner of some lots
    if (pixHash(t, 7, 53) % 3 === 0) {
      const gxr = flip ? x0 + 6 : x0 + 0;
      const garage = hexToRgb("#9c968c");
      put(gxr, y0 + 5, garage);
      put(gxr + (flip ? 1 : 0), y0 + 5, garage);
      put(gxr, y0 + 6, shade(garage, 0.75)); // the bay door
      put(gxr + (flip ? 1 : 0), y0 + 6, shade(garage, 0.75));
      // driveway basketball hoop on half the garages
      if (pixHash(t, 9, 53) % 2 === 0) {
        put(gxr, y0 + 4, C.crosswalk); // backboard
        put(gxr, y0 + 5, hexToRgb("#e08a2a")); // the rim
      }
    }
    // DORMER: a lit attic window punched through some roofs
    if (pixHash(t, 11, 53) % 4 === 0) {
      put(x0 + (flip ? 2 : 4), y0 + 1, houseWindow);
    }
    // FRONT PORCH deck under some doors; a flower bed for the rest
    if (pixHash(t, 12, 53) % 3 === 0) {
      put(x0 + doorX - 1, y0 + 6, C.plank);
      put(x0 + doorX, y0 + 6, C.plank);
      put(x0 + doorX + 1, y0 + 6, C.plankDark);
    } else if (pixHash(t, 13, 53) % 3 === 0) {
      put(x0 + 2, y0 + 6, C.flowerY);
      put(x0 + 3, y0 + 6, C.bush);
    }
    const winX = flip ? 4 : 2;
    put(x0 + winX, y0 + 5, houseWindow);

    if (detail) {
      const S = detail.S;
      const f = detail.putF;
      const shingle = shade(roof, 0.82);
      for (let px = 1; px <= 6; px++) {
        const bx = (x0 + px) * S;
        f(bx, (y0 + 2) * S + Math.floor(S / 2), shingle);
        f(bx + Math.floor(S / 2), (y0 + 3) * S + S - 1, shingle);
      }
      const frame = shade(wallColor, 0.7);
      const wbx = (x0 + winX) * S;
      const wby = (y0 + 5) * S;
      for (let i = 0; i < S; i++) {
        f(wbx + Math.floor(S / 2), wby + i, frame);
        f(wbx + i, wby + Math.floor(S / 2), frame);
      }
      f(wbx + 1, wby + 1, C.windowLit);
      f((x0 + doorX) * S + (flip ? S - 2 : 1), (y0 + 5) * S + Math.floor(S / 2), C.iconAccent);
    }
  }
}

function drawTrailerHome(
  x0: number,
  y0: number,
  t: number,
  put: Put,
  detail: Detail | null = null,
): void {
  castShadow(x0, y0, put);
  const trailerLit = currentTimeOfDay === "night" && pixHash(t, 42) % 10 < 7;
  const trailerWindow = trailerLit ? C.windowLit : C.windowDark;
  const flip = pixHash(t, 2) & 1; // hitch end left/right
  const tin = hexToRgb("#c4c8cc");
  const tinShade = hexToRgb("#9b9fa3");
  const skirtC = hexToRgb("#8a8378");
  for (let px = 1; px <= 6; px++) {
    put(x0 + px, y0 + 3, tinShade); // roof strip
    put(x0 + px, y0 + 4, tin); // body
    put(x0 + px, y0 + 5, tin);
    put(x0 + px, y0 + 6, skirtC); // skirting
  }
  const hitchX = flip ? 0 : 7;
  put(x0 + hitchX, y0 + 5, C.iconDark); // the tow hitch
  const doorX = flip ? 5 : 2;
  put(x0 + doorX, y0 + 5, C.door);
  const winX = flip ? 2 : 5;
  put(x0 + winX, y0 + 4, trailerWindow);
  put(x0 + (flip ? 7 : 0), y0 + 6, C.rock); // propane tank by the hitch end

  // awning + junk-yard dressing for trailer fringe
  const awnCol = [hexToRgb("#bf3f3f"), hexToRgb("#3f7fbf"), hexToRgb("#bf9f3f")][pixHash(t, 3) % 3]!;
  put(x0 + doorX - 1, y0 + 3, awnCol);
  put(x0 + doorX, y0 + 3, awnCol);
  put(x0 + doorX + 1, y0 + 3, awnCol);

  const junkX = flip ? 6 : 1;
  put(x0 + junkX, y0 + 6, C.iconDark); // tire/junk pile

  if (detail) {
    // Add extra details here if needed in the future
  }
}

/**
 * Downtown / ResHigh block row (§8A): contiguous block tiles are segmented
 * into INDIVIDUAL attached buildings 1–3 tiles wide — per-building wall tone,
 * cornice, window rhythm, and a dark party-wall seam at each boundary — so a
 * row reads as a street of distinct buildings, never one repeated texture.
 */
function drawBlock(w: World, tx: number, ty: number, x0: number, y0: number, t: number, put: Put): void {
  const isBlockTile = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w.width || y >= w.height) return false;
    const n = y * w.width + x;
    return (
      w.terrain[n] === Terrain.Citizen &&
      w.lot[n] === 0 &&
      (w.pop[n] ?? 0) >= 8 &&
      (w.district[n] === 3 || w.district[n] === 8) &&
      w.district[n] === w.district[t]
    );
  };
  // find this row-run's start, then hash-chain building widths (1–3 tiles)
  // from the run anchor so every tile in a building agrees on its identity
  let runStart = tx;
  while (isBlockTile(runStart - 1, ty)) runStart--;
  const anchor = ty * w.width + runStart;
  let segStart = runStart;
  let segW = 1 + (pixHash(anchor, segStart, 61) % 3);
  while (tx >= segStart + segW) {
    segStart += segW;
    segW = 1 + (pixHash(anchor, segStart, 61) % 3);
  }
  const segId = ty * w.width + segStart; // stable per-building hash key
  const d = w.district[t]!;
  // per-building wall tone: downtown = brick/stone range, ResHigh = warmer
  const tones =
    d === 3
      ? [C.block, shade(C.block, 0.86), hexToRgb("#8a6a52"), hexToRgb("#7d7468")]
      : [shade(C.block, 1.08), hexToRgb("#93755c"), shade(C.block, 0.92)];
  const wall = tones[pixHash(segId, 3, 67) % tones.length]!;
  const cornice = shade(wall, 0.72);
  const accent = pixHash(segId, 9, 67) % 3 === 0; // parapet accent band
  const isSegStart = tx === segStart;
  const isSegEnd = tx === segStart + segW - 1 || !isBlockTile(tx + 1, ty);
  const isRunEnd = !isBlockTile(tx + 1, ty);
  castShadow(x0, y0, put);
  // body: fuse across tiles inside a building; dark seam at building edges
  // Vary the depth (startY) of the building slightly to break the monolith
  const startY = pixHash(segId, 17, 67) % 3; // 0, 1, or 2
  const pxFrom = isSegStart ? 1 : 0;
  const pxTo = isRunEnd ? 6 : isSegEnd ? 6 : 7;
  for (let py = startY; py <= 6; py++) {
    for (let px = pxFrom; px <= pxTo; px++) {
      put(x0 + px, y0 + py, py === startY ? (accent ? shade(wall, 1.25) : cornice) : wall);
    }
  }
  if (isSegStart) for (let py = startY; py <= 6; py++) put(x0, y0 + py, shade(wall, 0.5)); // party-wall seam
  // window rhythm: per-building offset + lit density
  const wxOff = 2 + (pixHash(segId, 5, 67) % 2);
  const litMod = 3 + (pixHash(segId, 7, 67) % 3);
  for (let wy = startY + 1; wy <= 5; wy += 2) {
    for (let wx = wxOff; wx <= 6; wx += 2) {
      const lit = pixHash(t, wx * 8 + wy) % litMod !== 0;
      put(x0 + wx, y0 + wy, lit ? C.windowLit : C.windowDark);
    }
  }
  // downtown ground floor: storefront glass strip + door on the street row
  if (d === 3) {
    for (let px = pxFrom + 1; px <= pxTo - 1; px++) put(x0 + px, y0 + 6, hexToRgb("#3a4650"));
    if (pixHash(segId, 11, 67) % 2 === 0 && isSegStart) put(x0 + 2, y0 + 6, shade(wall, 1.3)); // door
  }
  // aerial flavor: a rooftop vent/AC unit on some buildings
  if (pixHash(t, 13, 67) % 5 === 0) put(x0 + 3 + (pixHash(t, 15, 67) % 3), y0 + startY + 1, shade(wall, 0.6));
  
  // Sidewalk for the entire block if there's a road fronting it
  if (ty < w.height - 1 && w.terrain[t + w.width] === Terrain.Road) {
    for (let px = 0; px < TILE_PX; px++) {
      put(x0 + px, y0 + 7, C.sidewalk);
      if (px % 4 === 0) put(x0 + px, y0 + 7, shade(C.sidewalk, 0.9)); // sidewalk expansion joints
    }
  }
}

function drawIcon(bitmap: string[], tile: number, width: number, body: RGB, put: Put): void {
  const x0 = (tile % width) * TILE_PX;
  const y0 = ((tile / width) | 0) * TILE_PX;
  for (let py = 0; py < TILE_PX; py++) {
    const row = bitmap[py] ?? "........";
    for (let px = 0; px < TILE_PX; px++) {
      switch (row[px]) {
        case "#":
          put(x0 + px, y0 + py, C.iconDark);
          break;
        case "o":
          put(x0 + px, y0 + py, body);
          break;
        case "*":
          put(x0 + px, y0 + py, C.iconAccent);
          break;
      }
    }
  }
}

// ---------------------------------------------------------------- people

/**
 * Residents as living dots — the CIVIC DAY overhaul. Every populated tile
 * renders ceil(pop/3) dots (≤4), each running a shared deterministic day:
 *
 *   night → morning rush → workday (INSIDE their building) → lunch errand →
 *   evening rush → home / leisure → night …
 *
 * Movement is street-accurate: a dot leaves its front door, joins its
 * fronting street, walks the Manhattan grid ON THE SIDEWALK (right-hand
 * rule: eastbound takes the south walk, westbound the north walk), crosses
 * at the elbow, and disappears INTO its destination building for the stay —
 * except at outdoor lots (parks, ballfields, docks…) where people remain
 * visible. Long commutes go BY CAR: the dot renders as a 3×2 car in the
 * correct road lane at driving speed.
 *
 * Color is the conversion read: neutral gray-blue · converts in their cult's
 * color · apostates a drained gray-brown drifting near home · Downline tiles
 * carry a gold tithe accent. Everything is a pure hash of (tile, dot, tick).
 */
const DAY = 2400; // 4 min at 10 TPS — the shared civic day
const T_MORNING = 240; // rush hour begins
const T_WORK = 640; // everyone who's going is at work
const T_LUNCH0 = 1000; // lunch-errand window
const T_LUNCH1 = 1240;
const T_EVENING = 1400; // rush home begins
const T_HOME = 1800; // evening at home / leisure
const WALK_SPEED = 0.9; // px per tick on foot
const CAR_SPEED = 3.0; // px per tick behind the wheel
const CAR_TRIP = 12; // tiles: farther than this and the household drives

/** Job lots: where the unconverted clock in. */
const JOB_LOTS: ReadonlySet<number> = new Set<number>([
  Lot.Shop, Lot.Supermarket, Lot.Diner, Lot.School, Lot.Library, Lot.GasStation,
  Lot.Sheriff, Lot.Office, Lot.Bank, Lot.PostOffice, Lot.FireStation,
  Lot.Factory, Lot.Motel, Lot.Cinema, Lot.HighSchool, Lot.Warehouse,
  Lot.GrainElevator, Lot.Depot, Lot.Greenhouse, Lot.Cannery, Lot.Sawmill,
]);
/** Errand lots: the lunch run. */
const ERRAND_LOTS: ReadonlySet<number> = new Set<number>([
  Lot.Shop, Lot.Supermarket, Lot.Diner,
]);
/** Leisure lots: evenings + the unemployed's day out. */
const LEISURE_LOTS: ReadonlySet<number> = new Set<number>([
  Lot.Park, Lot.BallField, Lot.Playground, Lot.Cinema, Lot.Diner, Lot.Dock,
  Lot.Church, Lot.Chapel,
]);
/** Outdoor lots: people stay visible during their stay. */
const OUTDOOR_LOTS: ReadonlySet<number> = new Set<number>([
  Lot.Park, Lot.BallField, Lot.Playground, Lot.Cemetery, Lot.Dock, Lot.Parking,
]);

interface Spot { tile: number; owner: number; lot: number }

/** One leg of a street route, in pixel space. */
interface Leg { x0: number; y0: number; x1: number; y1: number; len: number; onRoad: boolean }

/**
 * ROAD-GRAPH ROUTING (dot-pathing upgrade): the old two-elbow route assumed
 * a continuous road spanned the whole horizontal + vertical legs — on the
 * jittered plat it often didn't, so walkers cut across lawns and THROUGH
 * houses mid-block. Routes now follow the actual street network: BFS over
 * Road/Dirt tiles (4-connected, fixed neighbor order — deterministic),
 * cached per world + endpoint pair (the road net never changes mid-match,
 * and forward/reverse share one search).
 */
const ROUTE_CACHE = new WeakMap<World, Map<number, number[] | null>>();

function roadPath(w: World, from: number, to: number): number[] | null {
  let cache = ROUTE_CACHE.get(w);
  if (!cache) {
    cache = new Map();
    ROUTE_CACHE.set(w, cache);
  }
  const n = w.terrain.length;
  const key = from * n + to;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const walkable = (t: number): boolean =>
    w.terrain[t] === Terrain.Road || w.terrain[t] === Terrain.Dirt;
  let path: number[] | null = null;
  if (walkable(from) && walkable(to)) {
    const parent = new Int32Array(n).fill(-2); // -2 unseen, -1 root
    parent[from] = -1;
    const queue = [from];
    for (let qi = 0; qi < queue.length; qi++) {
      const c = queue[qi]!;
      if (c === to) break;
      const x = c % w.width;
      for (const nb of [c - w.width, c + w.width, x > 0 ? c - 1 : -1, x < w.width - 1 ? c + 1 : -1]) {
        if (nb < 0 || nb >= n || parent[nb] !== -2 || !walkable(nb)) continue;
        parent[nb] = c;
        queue.push(nb);
      }
    }
    if (parent[to] !== -2) {
      path = [];
      for (let c = to; c !== -1; c = parent[c]!) path.push(c);
      path.reverse();
    }
  }
  cache.set(key, path);
  cache.set(to * n + from, path ? [...path].reverse() : null);
  return path;
}

/**
 * Build the street route home→dest as legs: door → fronting street →
 * Manhattan elbow along the grid → dest street → dest door. Falls back to a
 * straight elbow when a tile has no fronting road (shouldn't happen — the
 * frontage rule guarantees one).
 */
function buildRoute(
  w: World,
  homeT: number,
  destT: number,
  homePx: number,
  homePy: number,
  destPx: number,
  destPy: number,
): Leg[] {
  const frontRoad = (t: number): number => {
    const x = t % w.width;
    const y = (t / w.width) | 0;
    if (y < w.height - 1 && w.terrain[t + w.width] === Terrain.Road) return t + w.width;
    if (x < w.width - 1 && w.terrain[t + 1] === Terrain.Road) return t + 1;
    if (x > 0 && w.terrain[t - 1] === Terrain.Road) return t - 1;
    if (y > 0 && w.terrain[t - w.width] === Terrain.Road) return t - w.width;
    // dirt lanes serve farmsteads/courts
    if (y < w.height - 1 && w.terrain[t + w.width] === Terrain.Dirt) return t + w.width;
    if (x < w.width - 1 && w.terrain[t + 1] === Terrain.Dirt) return t + 1;
    if (x > 0 && w.terrain[t - 1] === Terrain.Dirt) return t - 1;
    if (y > 0 && w.terrain[t - w.width] === Terrain.Dirt) return t - w.width;
    return -1;
  };
  const legs: Leg[] = [];
  const push = (x0: number, y0: number, x1: number, y1: number, onRoad: boolean): void => {
    const len = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    if (len > 0) legs.push({ x0, y0, x1, y1, len, onRoad });
  };
  const hr = frontRoad(homeT);
  const dr = frontRoad(destT);
  if (hr < 0 || dr < 0) {
    // no street access: straight elbow (old behavior)
    push(homePx, homePy, destPx, homePy, false);
    push(destPx, homePy, destPx, destPy, false);
    return legs;
  }
  // street anchor points: centers of the fronting road tiles
  const hrx = (hr % w.width) * TILE_PX + 4;
  const hry = ((hr / w.width) | 0) * TILE_PX + 4;
  const drx = (dr % w.width) * TILE_PX + 4;
  const dry = ((dr / w.width) | 0) * TILE_PX + 4;
  // door → street, axis-at-a-time (nobody cuts diagonally across a yard)
  push(homePx, homePy, homePx, hry, false);
  push(homePx, hry, hrx, hry, false);
  const path = roadPath(w, hr, dr);
  if (path && path.length > 1) {
    // follow the REAL street network, compressed into straight legs —
    // turns land on actual intersections, so crossings happen where a
    // pedestrian would cross and cars never leave pavement
    let sx = hrx;
    let sy = hry;
    let runDx = 0;
    let runDy = 0;
    for (let i = 1; i < path.length; i++) {
      const px = (path[i]! % w.width) * TILE_PX + 4;
      const py = ((path[i]! / w.width) | 0) * TILE_PX + 4;
      const prevPx = (path[i - 1]! % w.width) * TILE_PX + 4;
      const prevPy = ((path[i - 1]! / w.width) | 0) * TILE_PX + 4;
      const dx = Math.sign(px - prevPx);
      const dy = Math.sign(py - prevPy);
      if ((dx !== runDx || dy !== runDy) && (runDx !== 0 || runDy !== 0)) {
        push(sx, sy, prevPx, prevPy, true); // the straight run ends: emit it
        sx = prevPx;
        sy = prevPy;
      }
      runDx = dx;
      runDy = dy;
    }
    const endPx = (path[path.length - 1]! % w.width) * TILE_PX + 4;
    const endPy = ((path[path.length - 1]! / w.width) | 0) * TILE_PX + 4;
    push(sx, sy, endPx, endPy, true);
  } else {
    // road nets disconnected between these two (shouldn't happen —
    // hygiene stitches components): old two-elbow approximation
    push(hrx, hry, drx, hry, true);
    push(drx, hry, drx, dry, true);
  }
  // street → door, axis-at-a-time
  push(drx, dry, destPx, dry, false);
  push(destPx, dry, destPx, destPy, false);
  return legs;
}

/** A plain axis-at-a-time walking path between two pixels. */
function lPath(x0: number, y0: number, x1: number, y1: number): Leg[] {
  const legs: Leg[] = [];
  if (x1 !== x0) legs.push({ x0, y0, x1, y1: y0, len: Math.abs(x1 - x0), onRoad: false });
  if (y1 !== y0) legs.push({ x0: x1, y0, x1, y1, len: Math.abs(y1 - y0), onRoad: false });
  return legs;
}

/** Where this lot's car sits: the parcel edge facing its street, nose out. */
function drivewayPoint(
  w: World,
  t: number,
  fallbackX: number,
  fallbackY: number,
): { px: number; py: number; dx: number; dy: number } {
  const x = t % w.width;
  const y = (t / w.width) | 0;
  const bx = x * TILE_PX;
  const by = y * TILE_PX;
  const road = (n: number): boolean =>
    n >= 0 && n < w.terrain.length && (w.terrain[n] === Terrain.Road || w.terrain[n] === Terrain.Dirt);
  if (y < w.height - 1 && road(t + w.width)) return { px: bx + 5, py: by + 6, dx: 0, dy: 1 };
  if (x < w.width - 1 && road(t + 1)) return { px: bx + 6, py: by + 5, dx: 1, dy: 0 };
  if (x > 0 && road(t - 1)) return { px: bx + 1, py: by + 5, dx: -1, dy: 0 };
  if (y > 0 && road(t - w.width)) return { px: bx + 5, py: by + 1, dx: 0, dy: -1 };
  return { px: fallbackX, py: fallbackY, dx: 0, dy: 1 };
}

/**
 * A parking bay near dest: candidates spread across EVERY parking tile in
 * range (so a full lot fills in neat rows instead of stacking one tile),
 * slotted on the painted 3px stripe pitch.
 */
function parkingBay(
  parking: number[],
  width: number,
  dest: number,
  r: number,
  seed: number,
): { tile: number; px: number; py: number } | null {
  const dx0 = dest % width;
  const dy0 = (dest / width) | 0;
  const near: number[] = [];
  for (const pt of parking) {
    const dx = (pt % width) - dx0;
    const dy = ((pt / width) | 0) - dy0;
    if (dx * dx + dy * dy <= r * r) near.push(pt);
  }
  if (near.length === 0) return null;
  const tile = near[(seed >>> 3) % near.length]!;
  const slot = (seed >>> 9) % 2;
  return {
    tile,
    px: (tile % width) * TILE_PX + 2 + slot * 3,
    py: ((tile / width) | 0) * TILE_PX + 2 + ((seed >>> 11) % 2) * 3,
  };
}

/**
 * Position along a route at distance d (px). Sidewalk offset on road legs:
 * right-hand rule — eastbound walks the south edge, westbound the north,
 * southbound the west, northbound the east. Cars ride the center lanes.
 */
function routePoint(legs: Leg[], d: number, driving: boolean): { px: number; py: number } {
  let rem = d;
  for (const leg of legs) {
    if (rem > leg.len) {
      rem -= leg.len;
      continue;
    }
    const f = leg.len === 0 ? 0 : rem / leg.len;
    let px = Math.round(leg.x0 + (leg.x1 - leg.x0) * f);
    let py = Math.round(leg.y0 + (leg.y1 - leg.y0) * f);
    if (leg.onRoad) {
      const horiz = Math.abs(leg.x1 - leg.x0) >= Math.abs(leg.y1 - leg.y0);
      if (horiz) {
        const east = leg.x1 > leg.x0;
        // cars ride the center lanes; walkers hug the CURB rows so their
        // 2px bodies overlap the sidewalk strip, never the roadway
        const rowTop = ((leg.y0 / TILE_PX) | 0) * TILE_PX;
        py = driving ? rowTop + (east ? 4 : 3) : rowTop + (east ? 7 : 0);
      } else {
        const south = leg.y1 > leg.y0;
        const colLeft = ((leg.x0 / TILE_PX) | 0) * TILE_PX;
        px = driving ? colLeft + (south ? 3 : 4) : colLeft + (south ? 0 : 7);
      }
    }
    return { px, py };
  }
  const last = legs[legs.length - 1];
  return last ? { px: last.x1, py: last.y1 } : { px: 0, py: 0 };
}

function routeLen(legs: Leg[]): number {
  let n = 0;
  for (const leg of legs) n += leg.len;
  return n;
}

/**
 * A person: 2×2 high-contrast figure — bright head, body, soft shadow — so
 * dots read against asphalt, lawn, and sand alike.
 */
function putPerson(px: number, py: number, color: RGB, put: Put): void {
  put(px, py - 1, shade(color, 1.35)); // head catches the light
  put(px, py, color); // body
  put(px + 1, py, shade(color, 0.72)); // shaded side
  put(px + 1, py + 1, C.shadow); // cast shadow
}

/** Real-world car paint for neutral households (cult cars wear cult colors). */
const CAR_COLORS: RGB[] = [
  hexToRgb("#c8c4bc"), // silver
  hexToRgb("#e8e4dc"), // white
  hexToRgb("#2e2e32"), // black
  hexToRgb("#a03028"), // red
  hexToRgb("#3a5a8c"), // blue
  hexToRgb("#4a6a42"), // green
  hexToRgb("#b09a6a"), // tan
  hexToRgb("#6a3038"), // maroon
];

/**
 * A commuting car with a FACE: the windshield glass sits on the leading end
 * and the body form turns with the travel axis, so northbound and eastbound
 * cars read differently at a glance.
 */
function putCar(px: number, py: number, color: RGB, dx: number, dy: number, put: Put): void {
  if (dy === 0) {
    // east/west: 3×2, glass on the leading end, wheels under both ends
    const east = dx >= 0;
    put(px - 1, py, east ? shade(color, 0.8) : C.unitGlass);
    put(px, py, color);
    put(px + 1, py, east ? C.unitGlass : shade(color, 0.8));
    put(px - 1, py + 1, C.iconDark);
    put(px + 1, py + 1, C.iconDark);
  } else {
    // north/south: 1×3 body with side wheels, glass toward travel
    const south = dy >= 0;
    put(px, py - 1, south ? shade(color, 0.8) : C.unitGlass);
    put(px, py, color);
    put(px, py + 1, south ? C.unitGlass : shade(color, 0.8));
    put(px - 1, py, C.iconDark);
    put(px + 1, py, C.iconDark);
  }
}

function drawResidents(sim: SimState, tick: number, fog: Uint8Array | null, put: Put): void {
  const w = sim.world;

  // spot lists: cult buildings (converts' workplaces), civic jobs, errands,
  // leisure — built once per frame, hash-picked per dot.
  const cultSpots: Spot[] = [];
  for (const bd of sim.buildings) {
    if (bd.buildTicksLeft === 0) cultSpots.push({ tile: bd.tile, owner: bd.player, lot: 0 });
  }
  const jobSpots: Spot[] = [];
  const errandSpots: Spot[] = [];
  const leisureSpots: Spot[] = [];
  const parkingSpots: number[] = [];
  for (let t = 0; t < w.lot.length; t++) {
    const lot = w.lot[t]!;
    if (lot !== 0) {
      if (lot === Lot.Parking) parkingSpots.push(t);
      if (JOB_LOTS.has(lot)) jobSpots.push({ tile: t, owner: 0, lot });
      if (ERRAND_LOTS.has(lot)) errandSpots.push({ tile: t, owner: 0, lot });
      if (LEISURE_LOTS.has(lot)) leisureSpots.push({ tile: t, owner: 0, lot });
    } else if (w.landmark[t] !== 0) {
      leisureSpots.push({ tile: t, owner: 0, lot: 0 });
    }
  }

  for (let t = 0; t < w.pop.length; t++) {
    const pop = w.pop[t]!;
    if (pop === 0 || w.terrain[t] !== Terrain.Citizen) continue;
    if (fog && fog[t] !== 1) continue;

    const owner = w.owner[t]!;
    const apostate = w.state[t] === TileState.Apostate;
    const downline = (w.flags[t]! & 1) !== 0; // TileFlag.Downline
    const color = apostate
      ? hexToRgb("#5a4a4a")
      : owner === NEUTRAL
        ? C.personNeutral
        : hexToRgb(colorForPlayer(owner));
    const hx = t % w.width;
    const hy = (t / w.width) | 0;
    const dots = Math.min(4, Math.ceil(pop / 3));

    for (let i = 0; i < dots; i++) {
      const seed = pixHash(t, i, 91);
      // the whole town shares one day; each dot staggers within ±2 min so
      // rush hour reads as a wave, not a stampede
      const stagger = seed % 120;
      const day = (tick + stagger) % DAY;

      // home pixel anchor (front yard, by the door)
      const homeX = hx * TILE_PX + 1 + (seed % 6);
      const homeY = hy * TILE_PX + 6 + ((seed >> 8) % 2);

      // APOSTATES drift listlessly near home all day — nobody to be
      if (apostate) {
        const wob = pixHash(t, i + 16, 93);
        const px = homeX + (((tick >> 5) + wob) % 5) - 2;
        const py = homeY - (((tick >> 6) + i) % 2);
        putPerson(px, py, color, put);
        continue;
      }

      // WHO IS THIS DOT? workplace + habits, all hash-stable per (tile, dot)
      const retiree = owner === NEUTRAL && seed % 5 === 0; // no job: errands + leisure only
      let workT = -1;
      if (!retiree) {
        if (owner !== NEUTRAL && cultSpots.length > 0) {
          workT = pickSpot(cultSpots, w.width, hx, hy, owner, seed, 44);
        }
        if (workT < 0) workT = pickSpot(jobSpots, w.width, hx, hy, 0, seed, 30);
      }
      // the household car: dot 0's commute decides whether one exists, and
      // it's VISIBLE whenever it isn't on the road — in the driveway at home,
      // in a parking bay at work. Cars are never hash dressing.
      const commuteTiles =
        workT >= 0
          ? Math.abs((workT % w.width) - hx) + Math.abs(((workT / w.width) | 0) - hy)
          : 0;
      const ownsCar = workT >= 0 && commuteTiles > CAR_TRIP && seed % 3 !== 0;
      // neutral households drive real-world paint; converts fly the colors
      const carColor = owner === NEUTRAL ? CAR_COLORS[(seed >>> 13) % CAR_COLORS.length]! : color;
      const homeCar = (): void => {
        if (i === 0 && ownsCar) {
          const dv = drivewayPoint(w, t, homeX, homeY);
          putCar(dv.px, dv.py, carColor, dv.dx, dv.dy, put);
        }
      };
      const errandT = pickSpot(errandSpots, w.width, hx, hy, 0, seed >> 3, 20);
      const leisureT = pickSpot(leisureSpots, w.width, hx, hy, 0, seed >> 6, 16);
      const doesLunch = errandT >= 0 && seed % 4 === 0;
      const doesLeisure = leisureT >= 0 && seed % 3 === 0;

      // today's primary destination by day phase
      let dest = -1;
      let phase: "home" | "out" | "back" | "stay" = "home";
      let legStart = 0; // tick the leg began
      let lunchFromWork = false; // lunch runs depart the workplace, not home
      if (day < T_MORNING) {
        phase = "home"; // night — indoors (a rare night owl on the porch;
        // 3 a.m. streets should read DEAD, not lively)
        homeCar(); // the car sleeps in the driveway
        if (seed % 17 !== 0) continue;
      } else if (day < T_WORK && workT >= 0) {
        phase = "out";
        dest = workT;
        // departures spread across the window — the rush reads as a wave
        legStart = T_MORNING + ((seed >> 4) % 280);
        if (day < legStart) {
          // hasn't left yet: on the porch, keys in hand, car still parked
          homeCar();
          putPerson(homeX, homeY, color, put);
          continue;
        }
      } else if (day < T_LUNCH0 && workT >= 0) {
        phase = "stay";
        dest = workT;
      } else if (day < T_LUNCH1 && workT >= 0 && doesLunch) {
        // lunch errand: quick round trip to the shop/diner FROM WORK —
        // the old route ran home→shop, so midday read as residential
        // streams instead of workers stepping out (pathing-upgrade fix)
        dest = errandT;
        lunchFromWork = true;
        const lf = (day - T_LUNCH0) / (T_LUNCH1 - T_LUNCH0);
        phase = lf < 0.35 ? "out" : lf < 0.65 ? "stay" : "back";
        legStart = lf < 0.35 ? T_LUNCH0 : T_LUNCH0 + Math.floor((T_LUNCH1 - T_LUNCH0) * 0.65);
      } else if (day < T_EVENING && workT >= 0) {
        phase = "stay";
        dest = workT;
      } else if (day < T_HOME && workT >= 0) {
        phase = "back";
        dest = workT;
        // quitting time varies too
        legStart = T_EVENING + ((seed >> 7) % 220);
        if (day < legStart) {
          phase = "stay";
        }
      } else if (doesLeisure && day >= T_HOME && day < T_HOME + 400) {
        const lf = (day - T_HOME) / 400;
        dest = leisureT;
        phase = lf < 0.3 ? "out" : lf < 0.75 ? "stay" : "back";
        legStart = lf < 0.3 ? T_HOME : T_HOME + 300;
      } else {
        phase = "home";
      }
      // retirees + the jobless: a midday errand instead of work
      if (workT < 0 && !doesLeisure && errandT >= 0 && day >= T_LUNCH0 && day < T_LUNCH1 + 200) {
        dest = errandT;
        const lf = (day - T_LUNCH0) / (T_LUNCH1 + 200 - T_LUNCH0);
        phase = lf < 0.3 ? "out" : lf < 0.7 ? "stay" : "back";
        legStart = lf < 0.3 ? T_LUNCH0 : T_LUNCH0 + Math.floor((T_LUNCH1 + 200 - T_LUNCH0) * 0.7);
      }

      let px: number;
      let py: number;
      let asCar = false;

      if (phase === "home" || dest < 0) {
        // idling in the yard / on the porch; the car back in its driveway
        homeCar();
        px = homeX + (((tick >> 4) + i) % 3) - 1;
        py = homeY;
      } else {
        // trip origin: home, except the lunch run which departs the workplace
        const originT = lunchFromWork && workT >= 0 ? workT : t;
        const originX =
          lunchFromWork && workT >= 0
            ? (workT % w.width) * TILE_PX + 2 + ((seed >> 9) % 4)
            : homeX;
        const originY =
          lunchFromWork && workT >= 0
            ? ((workT / w.width) | 0) * TILE_PX + TILE_PX - 1
            : homeY;
        const ox = originT % w.width;
        const oy = (originT / w.width) | 0;
        const dx0 = (dest % w.width) - ox;
        const dy0 = ((dest / w.width) | 0) - oy;
        const tripTiles = Math.abs(dx0) + Math.abs(dy0);
        asCar = tripTiles > CAR_TRIP && seed % 3 !== 0; // most long trips drive
        const destX = (dest % w.width) * TILE_PX + 2 + ((seed >> 12) % 4);
        const destY = ((dest / w.width) | 0) * TILE_PX + TILE_PX - 1; // the door

        if (asCar) {
          // BY CAR: back out of the driveway, drive the streets in lane,
          // park in the destination's lot (or at its curb), and WALK the
          // last leg like a real errand. The car stays visible in its bay
          // for the whole visit — cars are agents' cars, never dressing.
          const bay = parkingBay(parkingSpots, w.width, dest, 8, seed);
          const anchorT = bay ? bay.tile : dest;
          const bayX = bay ? bay.px : (dest % w.width) * TILE_PX + 2 + ((seed >> 5) % 2) * 3;
          const bayY = bay
            ? bay.py
            : ((dest / w.width) | 0) * TILE_PX + 2 + ((seed >> 7) % 2) * 3;
          const dv = drivewayPoint(w, originT, originX, originY);
          if (phase === "stay") {
            putCar(bayX, bayY, carColor, 0, -1, put); // nose-in at its bay
            const lot = w.lot[dest]!;
            if (!(OUTDOOR_LOTS.has(lot) || w.landmark[dest] !== 0)) continue;
            px = destX + (((tick >> 3) + i) % 3) - 1;
            py = destY - (((tick >> 4) + i) % 3);
            putPerson(px, py, color, put);
            continue;
          }
          const carLegs = buildRoute(w, originT, anchorT, dv.px, dv.py, bayX, bayY);
          const walkLegs = lPath(bayX, bayY, destX, destY);
          const carPxLen = routeLen(carLegs);
          const tDrive = carPxLen / CAR_SPEED;
          const tWalk = routeLen(walkLegs) / WALK_SPEED;
          const elapsed = Math.max(0, day - legStart);
          // progress measured along the OUTWARD direction for both phases
          const et = phase === "out" ? elapsed : Math.max(0, tDrive + tWalk - elapsed);
          if (et <= 0) {
            // back home: the car returns to the driveway
            putCar(dv.px, dv.py, carColor, dv.dx, dv.dy, put);
          } else if (et <= tDrive) {
            const d0 = et * CAR_SPEED;
            const pt = routePoint(carLegs, d0, true);
            // heading: sample a touch ahead (reversed for the homeward run)
            const ahead = routePoint(carLegs, Math.min(carPxLen, d0 + 2), true);
            let hdx = Math.sign(ahead.px - pt.px);
            let hdy = Math.sign(ahead.py - pt.py);
            if (phase === "back") {
              hdx = -hdx;
              hdy = -hdy;
            }
            if (hdx === 0 && hdy === 0) hdx = 1;
            putCar(pt.px, pt.py, carColor, hdx, hdy, put);
          } else if (et < tDrive + tWalk) {
            const pt = routePoint(walkLegs, (et - tDrive) * WALK_SPEED, false);
            putPerson(pt.px, pt.py, color, put);
          } else {
            // arrived: car in its bay; the person only if the lot is outdoor
            putCar(bayX, bayY, carColor, 0, -1, put);
            const lot = w.lot[dest]!;
            if (OUTDOOR_LOTS.has(lot) || w.landmark[dest] !== 0) {
              putPerson(destX, destY, color, put);
            }
          }
          continue;
        }

        const legs = buildRoute(w, originT, dest, originX, originY, destX, destY);
        const total = routeLen(legs);
        if (phase === "stay") {
          // INSIDE the building — visible only at outdoor lots, or briefly
          // at the door on arrival
          const lot = w.lot[dest]!;
          const outdoor = OUTDOOR_LOTS.has(lot) || w.landmark[dest] !== 0;
          if (!outdoor) continue; // they're indoors
          px = destX + (((tick >> 3) + i) % 3) - 1;
          py = destY - (((tick >> 4) + i) % 3);
        } else {
          const elapsed = Math.max(0, day - legStart);
          const dist = Math.min(total, elapsed * WALK_SPEED);
          const along = phase === "out" ? dist : Math.max(0, total - dist);
          const pt = routePoint(legs, along, false);
          px = pt.px;
          py = pt.py;
          // already arrived (short trip): they're indoors until the phase turns
          if (phase === "out" && dist >= total) {
            const lot = w.lot[dest]!;
            if (!(OUTDOOR_LOTS.has(lot) || w.landmark[dest] !== 0)) continue;
          }
          if (phase === "back" && dist >= total) {
            px = originX;
            py = originY;
          }
        }
      }

      putPerson(px, py, color, put);
      if (downline) put(px, py - 2, hexToRgb("#ffd700")); // tithe gold
    }
  }
}

/**
 * v3 MISSION COHORTS MARCH (the send-out tie-in): a deployed cohort renders
 * as a single-file column of believers walking the real street network from
 * its compound to the mission target — same sidewalk rules as every other
 * pedestrian — and walks home when recalled. Arrived cohorts mill at their
 * ground. Pace mirrors cohorts.ts (marchTicksPerTile), so the column reaches
 * the target exactly when the sim says the mission starts working.
 */
function drawCohorts(
  sim: SimState,
  tick: number,
  fog: Uint8Array | null,
  put: Put,
  mtpt: number,
): void {
  const w = sim.world;
  for (const p of sim.players) {
    if (!p.spawned || p.cohorts.length === 0) continue;
    const color = hexToRgb(colorForPlayer(p.id));
    for (let ci = 0; ci < p.cohorts.length; ci++) {
      const c = p.cohorts[ci]!;
      if (fog && fog[c.target] !== 1) continue;
      // nearest operational compound — mirrors cohortTransit()
      const tx = c.target % w.width;
      const ty = (c.target / w.width) | 0;
      let bestT = -1;
      let best = -1;
      for (const bd of sim.buildings) {
        if (bd.player !== p.id || bd.type !== "compound" || bd.buildTicksLeft > 0) continue;
        const d = Math.abs((bd.tile % w.width) - tx) + Math.abs(((bd.tile / w.width) | 0) - ty);
        if (best < 0 || d < best) {
          best = d;
          bestT = bd.tile;
        }
      }
      if (bestT < 0) continue;
      const transit = Math.max(1, best * mtpt);
      const srcX = (bestT % w.width) * TILE_PX + 4;
      const srcY = ((bestT / w.width) | 0) * TILE_PX + 7;
      const dstX = tx * TILE_PX + 3;
      const dstY = ty * TILE_PX + 6;
      let frac: number;
      let marching = true;
      if (c.recalling) {
        frac = Math.max(0, 1 - c.recallAge / transit);
      } else if (c.age < transit) {
        frac = c.age / transit;
      } else {
        frac = 1;
        marching = false;
      }
      if (marching) {
        const legs = buildRoute(w, bestT, c.target, srcX, srcY, dstX, dstY);
        const total = routeLen(legs);
        const head = total * frac;
        for (let k = 0; k < 3; k++) {
          const pt = routePoint(legs, Math.max(0, head - k * 3), false);
          putPerson(pt.px, pt.py, color, put);
        }
      } else {
        // on the ground: the column works its block
        for (let k = 0; k < 3; k++) {
          const h = pixHash(c.target, k + ci * 7, 99);
          const px2 = dstX + ((h + (tick >> 4)) % 5) - 2;
          const py2 = dstY - ((h >> 4) % 3);
          putPerson(px2, py2, color, put);
        }
      }
    }
  }
}

/** Nearest spot (plus a hash-spread to the runner-up) within maxTrip tiles. */
function pickSpot(
  spots: Spot[],
  width: number,
  hx: number,
  hy: number,
  owner: number,
  seed: number,
  maxTrip: number,
): number {
  let best = -1;
  let bestD = maxTrip * maxTrip;
  let second = -1;
  for (const a of spots) {
    if (owner !== 0 && a.owner !== 0 && a.owner !== owner) continue;
    if (owner !== 0 && a.owner === 0) continue; // converts staff their own cult
    const dx = (a.tile % width) - hx;
    const dy = ((a.tile / width) | 0) - hy;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      second = best;
      bestD = d;
      best = a.tile;
    }
  }
  if (best < 0) return -1;
  // a third of dots prefer the runner-up — spreads the crowd
  return second >= 0 && seed % 3 === 0 ? second : best;
}

// ---------------------------------------------------------------- units

/**
 * Tiny unit sprites (legend: '.' clear · 'o' body · '#' dark outline · '*'
 * light accent · 'w' glass · 's' soft shadow). Drawn centred on the unit's
 * (possibly sub-tile) position so they read as little objects, not dots.
 */
const UNIT_SPRITES = {
  // Tithe Courier — a walker with a money satchel
  courier: ["..#...", ".#o#..", ".#o#.*", "##oo#*", ".#o#..", ".#.#.."],
  // Recruitment Van — a boxy minibus, side view, with glass + wheels
  van: ["s####s", "#wwww#", "oooooo", "oooooo", "s#ss#s", "..ss.."],
  // Agent — a hooded figure (own-side only; invisible to others)
  agent: ["..##..", ".#oo#.", ".#oo#.", ".#oo#.", ".s##s.", "......"],
  // Street Prophet pylon — a speaker on a post, radiating
  pylon: ["*#oo#*", "#oooo#", "*#oo#*", "..##..", "..##..", ".s##s."],
  // CPA picket — a protester holding a sign
  picket: ["####..", "#oo#.o", "####.o", "...#oo", "...oo.", "..s.s."],
} as const;

/**
 * Conversion auras (§9 Midnight Festival, §11.2 Free Retreat Weekend): a
 * shimmering ring + twinkling sparkles over the boosted radius so players can
 * see where conversion is supercharged. Festival reads warm-gold, retreat
 * reads bloom-green. Animated by frameTick for a gentle glimmer.
 */
/**
 * TERRITORY BORDERS (v3 M4 glow): paint an owner-colour edge wherever a
 * converted citizen tile meets non-owned ground — the OpenFront map-painting
 * read, so your town grows in YOUR colour as you convert it. Only the outer
 * boundary of a holding is drawn (same-owner neighbours suppress the shared
 * edge), so interiors stay readable (Visual QA restraint). A gentle
 * tick-shimmer reads as "glow". Render-only, deterministic in tick.
 */
function drawTerritoryBorders(sim: SimState, tick: number, fog: Uint8Array | null, put: Put): void {
  const w = sim.world;
  const pulse = 1 + 0.14 * Math.sin(tick * 0.12); // shimmer, not a hard box
  const colorOf = new Map<number, RGB>();
  for (let t = 0; t < w.owner.length; t++) {
    const o = w.owner[t]!;
    if (o === NEUTRAL || w.state[t] !== TileState.Believer || w.terrain[t] !== Terrain.Citizen) continue;
    if (fog && fog[t] !== 1) continue;
    let col = colorOf.get(o);
    if (!col) {
      col = shade(hexToRgb(colorForPlayer(o)), pulse);
      colorOf.set(o, col);
    }
    const x = t % w.width;
    const y = (t / w.width) | 0;
    const gx0 = x * TILE_PX;
    const gy0 = y * TILE_PX;
    const mine = (nt: number): boolean =>
      nt >= 0 && nt < w.owner.length && w.owner[nt] === o && w.state[nt] === TileState.Believer;
    if (y === 0 || !mine(t - w.width)) for (let k = 0; k < TILE_PX; k++) put(gx0 + k, gy0, col);
    if (y === w.height - 1 || !mine(t + w.width)) for (let k = 0; k < TILE_PX; k++) put(gx0 + k, gy0 + TILE_PX - 1, col);
    if (x === 0 || !mine(t - 1)) for (let k = 0; k < TILE_PX; k++) put(gx0, gy0 + k, col);
    if (x === w.width - 1 || !mine(t + 1)) for (let k = 0; k < TILE_PX; k++) put(gx0 + TILE_PX - 1, gy0 + k, col);
  }
}

function drawEffects(sim: SimState, tick: number, fog: Uint8Array | null, put: Put): void {
  const w = sim.world;
  for (const aura of sim.auras) {
    const cx = aura.tile % w.width;
    const cy = (aura.tile / w.width) | 0;
    const r = aura.radius;
    const glow = aura.kind === "festival" ? hexToRgb("#ffe08a") : hexToRgb("#a6f08a");
    const spark = aura.kind === "festival" ? hexToRgb("#fff4c8") : hexToRgb("#e2ffd0");
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
        const t = y * w.width + x;
        if (fog && fog[t] !== 1) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r) continue;
        const ox = x * TILE_PX;
        const oy = y * TILE_PX;
        // dotted perimeter ring
        if (Math.abs(d - r) < 0.55 && (x + y + (tick >> 3)) % 2 === 0) {
          put(ox + 4, oy + 4, glow);
        }
        // sparse interior twinkle that drifts with the frame tick
        const h = pixHash(t, 0, 61) + (tick >> 2);
        if (h % 11 === 0) {
          put(ox + (h % 7), oy + ((h >> 3) % 7), spark);
        }
      }
    }
  }
}

function drawUnits(sim: SimState, viewer: number, fog: Uint8Array | null, put: Put): void {
  const w = sim.world;
  const visible = (t: number): boolean => !fog || fog[t] === 1;
  const tilePx = (t: number): [number, number] => [(t % w.width) * TILE_PX, ((t / w.width) | 0) * TILE_PX];

  /** Paint a centred sprite at integer pixel (cx,cy) in the body colour. */
  const sprite = (cx: number, cy: number, bmp: readonly string[], body: RGB): void => {
    const bw = bmp[0]!.length;
    const ox = Math.round(cx) - (bw >> 1);
    const oy = Math.round(cy) - (bmp.length >> 1);
    const dark = shade(body, 0.32);
    const light = shade(body, 1.4);
    for (let py = 0; py < bmp.length; py++) {
      const row = bmp[py]!;
      for (let px = 0; px < bw; px++) {
        const ch = row[px];
        if (ch === "." || ch === undefined) continue;
        const c =
          ch === "o" ? body : ch === "#" ? dark : ch === "*" ? light : ch === "w" ? C.unitGlass : C.unitShadow;
        put(ox + px, oy + py, c);
      }
    }
  };

  /**
   * Glide a path-follower along its route by its fractional moveProgress so it
   * walks/drives smoothly between tiles instead of snapping. A faint trail dot
   * gives a sense of heading.
   */
  const drawMover = (path: number[], idx: number, progress: number, fallback: number, bmp: readonly string[], rgb: RGB): void => {
    const from = path[idx] ?? fallback;
    if (!visible(from)) return;
    const to = path[Math.min(idx + 1, path.length - 1)] ?? from;
    const f = Math.max(0, Math.min(1, toFloat(progress)));
    const [fx, fy] = tilePx(from);
    const [tx, ty] = tilePx(to);
    const cx = fx + 4 + (tx - fx) * f;
    const cy = fy + 4 + (ty - fy) * f;
    if (f > 0.2 && f < 0.85) put(Math.round(fx + 4 + (tx - fx) * (f - 0.2)), Math.round(fy + 4 + (ty - fy) * (f - 0.2)), shade(rgb, 0.5));
    sprite(cx, cy, bmp, rgb);
  };

  for (const c of sim.couriers) drawMover(c.path, c.idx, c.moveProgress, c.path[c.idx] ?? 0, UNIT_SPRITES.courier, hexToRgb("#ffd24a"));
  for (const v of sim.vans) drawMover(v.path, v.idx, v.moveProgress, v.tile, UNIT_SPRITES.van, hexToRgb("#eef0ff"));
  for (const py of sim.pylons) {
    if (!visible(py.tile)) continue;
    const [x, y] = tilePx(py.tile);
    sprite(x + 4, y + 4, UNIT_SPRITES.pylon, hexToRgb("#ff5555"));
  }
  for (const pk of sim.pickets) {
    if (!visible(pk.tile)) continue;
    const [x, y] = tilePx(pk.tile);
    sprite(x + 4, y + 4, UNIT_SPRITES.picket, hexToRgb("#ff66ff"));
  }
  for (const a of sim.agents) {
    const revealed = a.player === viewer || (a.victim === viewer && (a.exposedTicks > 0 || watchtowerSees(sim, viewer, a.tile)));
    if (revealed && a.phase !== "travel") {
      const [x, y] = tilePx(a.tile);
      sprite(x + 4, y + 4, UNIT_SPRITES.agent, hexToRgb("#33354d"));
    }
  }
}

function drawIndustrialShed(x0: number, y0: number, t: number, put: Put, detail: Detail | null): void {
  void detail;
  castShadow(x0, y0, put);
  const variant = pixHash(t, 3, 87) % 3;
  if (variant === 0) {
    // corrugated steel shed with a roll-up door and pallet stack
    const metal = hexToRgb("#8a9399");
    const metalDark = hexToRgb("#737c82");
    const roof = hexToRgb("#5a6266");
    for (let px = 1; px <= 6; px++) put(x0 + px, y0 + 2, roof);
    for (let py = 3; py <= 6; py++) {
      for (let px = 1; px <= 6; px++) {
        put(x0 + px, y0 + py, px % 2 === 0 ? metal : metalDark);
      }
    }
    const rollUp = hexToRgb("#cbd0d4");
    for (let py = 4; py <= 6; py++) {
      put(x0 + 2, y0 + py, rollUp);
      put(x0 + 3, y0 + py, rollUp);
      put(x0 + 4, y0 + py, rollUp);
    }
    put(x0 + 6, y0 + 5, hexToRgb("#bfa26b")); // pallets
    put(x0 + 6, y0 + 6, hexToRgb("#967e54"));
  } else if (variant === 1) {
    // taller tan metal workshop: office window, side door, oil drums
    const tan = hexToRgb("#b3a58c");
    const tanDark = shade(tan, 0.85);
    for (let px = 1; px <= 6; px++) {
      put(x0 + px, y0 + 1, shade(tanDark, 0.9)); // parapet
      put(x0 + px, y0 + 2, tanDark);
    }
    for (let py = 3; py <= 6; py++) {
      for (let px = 1; px <= 6; px++) {
        put(x0 + px, y0 + py, px === 6 ? tanDark : tan);
      }
    }
    put(x0 + 2, y0 + 4, C.windowDark); // office window
    put(x0 + 3, y0 + 4, C.windowDark);
    put(x0 + 5, y0 + 5, C.door); // crew door
    put(x0 + 5, y0 + 6, C.door);
    put(x0 + 1, y0 + 6, hexToRgb("#8a4a3a")); // rusted drums
    put(x0 + 2, y0 + 6, hexToRgb("#5a6a52"));
  } else {
    // low brick works: skylight, thin stack pipe, crate out front
    const brick = hexToRgb("#a25b42");
    const brickDark = hexToRgb("#7d402b");
    for (let px = 1; px <= 6; px++) put(x0 + px, y0 + 3, shade(brickDark, 0.85));
    put(x0 + 3, y0 + 3, C.glass); // skylight glint
    for (let py = 4; py <= 6; py++) {
      for (let px = 1; px <= 6; px++) {
        put(x0 + px, y0 + py, px % 2 === 0 ? brick : brickDark);
      }
    }
    put(x0 + 6, y0 + 2, C.iconDark); // stack pipe
    put(x0 + 6, y0 + 1, C.iconDark);
    put(x0 + 3, y0 + 5, C.iconDark); // roll door
    put(x0 + 4, y0 + 5, shade(C.iconDark, 1.8));
    put(x0 + 3, y0 + 6, C.iconDark);
    put(x0 + 4, y0 + 6, shade(C.iconDark, 1.8));
    put(x0 + 1, y0 + 6, hexToRgb("#bfa26b")); // crate
  }
}

function drawCommercialStorefront(x0: number, y0: number, t: number, put: Put, detail: Detail | null): void {
  castShadow(x0, y0, put);
  const brick = pixHash(t, 8) % 2 === 0 ? hexToRgb("#b0563f") : hexToRgb("#cbb89a");
  const brickDark = shade(brick, 0.85);
  const roof = hexToRgb("#6e665e");
  
  // Cornice / roof line
  for (let px = 1; px <= 6; px++) {
    put(x0 + px, y0 + 2, roof);
    put(x0 + px, y0 + 1, brickDark);
  }
  // Brick walls
  for (let py = 3; py <= 6; py++) {
    for (let px = 1; px <= 6; px++) {
      put(x0 + px, y0 + py, px % 2 === 0 ? brick : brickDark);
    }
  }
  // Large display window
  const windowC = hexToRgb("#3f7fbf"); // blue glass
  put(x0 + 1, y0 + 4, windowC);
  put(x0 + 2, y0 + 4, windowC);
  put(x0 + 1, y0 + 5, windowC);
  put(x0 + 2, y0 + 5, windowC);
  
  // Store door
  put(x0 + 4, y0 + 4, C.glassFrame);
  put(x0 + 4, y0 + 5, C.door);
  
  // Awning above window (striped red/white or blue/white)
  const awnC = pixHash(t, 9) % 2 === 0 ? hexToRgb("#d23b3b") : hexToRgb("#3f7fbf");
  put(x0 + 1, y0 + 3, awnC);
  put(x0 + 2, y0 + 3, C.crosswalk);
  put(x0 + 3, y0 + 3, awnC);
}

function drawCollegeBlock(x0: number, y0: number, t: number, put: Put, detail: Detail | null): void {
  castShadow(x0, y0, put);
  const brick = hexToRgb("#853b30");
  const brickDark = shade(brick, 0.85);
  const slate = hexToRgb("#5f6670");
  
  // Slate roof
  put(x0 + 3, y0 + 1, slate);
  put(x0 + 4, y0 + 1, slate);
  for (let px = 2; px <= 5; px++) put(x0 + px, y0 + 2, slate);
  
  // Brick walls
  for (let py = 3; py <= 6; py++) {
    for (let px = 1; px <= 6; px++) {
      put(x0 + px, y0 + py, px % 2 === 0 ? brick : brickDark);
    }
  }
  // Arched campus windows
  put(x0 + 2, y0 + 4, C.crosswalk);
  put(x0 + 5, y0 + 4, C.crosswalk);
  // Double entrance door
  put(x0 + 3, y0 + 5, C.door);
  put(x0 + 4, y0 + 5, C.door);
}
