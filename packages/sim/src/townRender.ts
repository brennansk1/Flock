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

import { getSkin, type SkinLoadout } from "./skins.js";
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
import { footprintOf } from "./footprints.js";
import { watchtowerSees } from "./buildings.js";
import {
  hexToRgb,
  shade,
  territoryPixel,
  colorForPlayer,
  NEUTRAL_BY_DISTRICT,
  type RGB,
  type Archetype,
} from "./palette.js";

export { TILE_PX } from "./render/core.js";
import { makeGrader, EMISSIVE } from "./render/grade.js";
import { drawRock, screeAt } from "./render/rock.js";
import { drawCourthouse, drawTrack, drawBallField } from "./render/civic.js";
import { drawStorefront, drawBackRoom, shopFrontOf } from "./render/storefront.js";
import { drawAmbientTraffic } from "./render/traffic.js";
import { lotFrontage, roadClass } from "./render/frontage.js";
import { drawParkingTile, diagonalStall } from "./render/parking.js";
import { edgeBlend, wildGround, wildMask } from "./render/ground.js";
import { composeFacade } from "./render/compose.js";
import { drawWater, pointBarAt, bleedWater } from "./render/water.js";
import { drawHouse, drawBackyard, drawApartment, frontageOf, isHouseTile, curbCutAt, homeCarSpot } from "./render/houses.js";
import { drawVehicle, householdVehicle, householdPaint, dirOf, vehicleSize, type VehicleKind } from "./render/vehicles.js";
import { drawPlanned, planFrame, drawPlanOverhangs } from "./render/plan.js";
import { drawPark, drawOrchard, drawDock, drawPierOverWater, drawPivotTile } from "./render/grounds.js";
import { PLANNED } from "./render/registry.js";
import { drawTransmissionLines } from "./render/utility.js";
import { canopyPx } from "./render/canopy.js";
import { drawTrain, mainLine } from "./render/train.js";
import { desertGround } from "./render/desert.js";
import { drawWaterLot, drawTailwater, drawJetty, seaFill, standsInWater } from "./render/waterworks.js";
import { COMPOUND_LOTS, drawLotOverlays } from "./render/landmarks.js";
import { TILE_PX, RS, C, DEFAULT_COLORS, pixHash, valueNoise, isLitHour, type Put } from "./render/core.js";

// ---------------------------------------------------------------- sprites

/** 8×8 Compound silhouettes per faction archetype (§30). */
const COMPOUND_ICONS: Record<Archetype, string[]> = {
  dawn: [
    "#.*..*.#", // Flaming braziers flanking parapets
    "########", // Heavy fortified parapet
    "#oo##oo#", // Slit firing ports
    "#oooooo#", // Reinforced blast walls
    "#oo##oo#", // Sandbag reinforced tier
    "########", // Heavy steel blast gate
    "##o##o##", // Embrasures
    "########", // Foundation
  ],
  radiant: [
    "...**...", // Apex crystal spire
    "..#**#..", // Crystal spire
    ".#oooo#.", // Faceted geodesic glass dome
    "#o#oo#o#", // Geodesic struts & glass panes
    "#oooooo#", // Solar greenhouse tiers
    "#o#oo#o#", // Structural arches
    ".######.", // Terraced botanical base
    "...##...", // Entrance steps
  ],
  circle: [
    "..####..", // Modern corporate rooftop
    ".#*##*#.", // Helipad & beacon lamp
    ".######.", // Tinted glass curtain
    ".#o##o#.", // Executive boardroom suites
    ".#o##o#.", // Mid-level offices
    ".#o##o#.", // Mid-level offices
    ".######.", // Grand entrance atrium
    "########", // Granite corporate plaza
  ],
  visitors: [
    "..****..", // Rotating parabolic radar dish
    "...##...", // Antenna mast
    "..####..", // Observatory dome
    ".#oooo#.", // Spherical telescope bay
    "#o#**#o#", // Telemetry aperture & glowing beacon
    "#oooooo#", // Reinforced science facility
    ".######.", // Pylon strut mounts
    "..####..", // Sub-station base
  ],
};

/**
 * 16×16 (2×2 tiles) Cult Asset Bitmaps.
 * Pixel codes:
 *  '.' = transparent (ground/halo visible)
 *  '#' = dark structural outline / deep shadow
 *  'o' = primary faction body color
 *  'O' = bright highlight of faction color
 *  'x' = structural material (concrete / steel / brass / glass)
 *  '*' = radiant animated archetype emission (fire/crystal/ticker/beam)
 *  '+' = intense white/glint specular reflection
 *  '-' = shaded underside
 */
export const CULT_ICONS_16: Record<string, string[]> = {
  compound_dawn: [
    "..**........**..", // 0: Corner flame braziers emitting sparks
    ".+**+......+**+.", // 1: Hot glowing coal embers
    "################", // 2: Heavy parapet steel battlements
    "#oo##oo##oo##oo#", // 3: Slit firing ports
    "#oooooooooooooo#", // 4: Reinforced concrete command bunker
    "#oo#xxxxxxxx#oo#", // 5: Steel blast shield with heavy bolts
    "#oo#x*o**o*x#oo#", // 6: Crimson sunburst / final dawn sigil
    "#oo#xxxxxxxx#oo#", // 7: Steel armor plate
    "################", // 8: Mid-level reinforced masonry belt
    "#xxxx######xxxx#", // 9: Sandbag defensive berms
    "#xxxx#oooo#xxxx#", // 10: Hydraulic vault blast door
    "#xxxx#oooo#xxxx#", // 11: Vault door lower hinge
    "################", // 12: Reinforced concrete sill
    ".#xx########xx#.", // 13: Sloped foundation buttresses
    "..############..", // 14: Barbed-wire apron footing
    "................", // 15:
  ],
  compound_radiant: [
    ".......++.......", // 0: Apex crystal beam glint
    "......+**+......", // 1: Radiant crystal spire top
    "......#**#......", // 2: Faceted crystal spire
    ".....##**##.....", // 3: Crystal mount collar
    "....#oooooo#....", // 4: Faceted geodesic glass dome
    "...#o#oooo#o#...", // 5: Geodesic structural struts
    "..#oo#oooo#oo#..", // 6: Light refraction panes
    ".#oooo#oo#oooo#.", // 7: Mid-level glass canopy
    "################", // 8: Titanium tension ring
    "#xoxoxoxoxoxoxx#", // 9: Botanical terrace planters with herbs
    "#o#oooooooooo#o#", // 10: Greenhouse gallery windows
    "#o#xx##oo##xx#o#", // 11: Grand arched colonnade entrance
    "################", // 12: Polished marble terrace
    ".#xxxxxxxxxxxx#.", // 13: Radial curved marble steps (tier 1)
    "..#xxxxxxxxxx#..", // 14: Radial curved marble steps (tier 2)
    "...##########...", // 15: Zen pebble apron
  ],
  compound_circle: [
    ".....######.....", // 0: Rooftop helipad perimeter
    "....#x+**+x#....", // 1: Helipad deck with blinking beacon
    "....#x*##*x#....", // 2: Helipad 'H' marking
    "....#xxxxxx#....", // 3: Penthouse mechanical floor
    "...############...", // 4: Upper setback cornice
    "..#xoxxoxxoxxox#..", // 5: Tinted navy glass with gold mullions
    "..#xoxxoxxoxxox#..", // 6: Executive suites
    "..#xoxxoxxoxxox#..", // 7: Executive suites
    "..#************#..", // 8: Illuminated stock ticker ribbon
    "..#xoxxoxxoxxox#..", // 9: Corporate trading floor
    "..#xoxxoxxoxxox#..", // 10: Trading floor lower tier
    "..#x#oooooooo#x#..", // 11: Double-height glass atrium
    "..#x#oo####oo#x#..", // 12: Revolving brass entrance doors
    ".################.", // 13: Polished black granite plinth
    ".#xxxxxxxxxxxxxx#.", // 14: Corporate plaza flags & pavers
    "##################", // 15: Plaza base
  ],
  compound_visitors: [
    "....+******+....", // 0: Parabolic microwave radar dish rim
    ".....#****#.....", // 1: Concentric receiver dish
    "......#**#......", // 2: Focal feed horn
    ".......##.......", // 3: Rotating gantry turret
    "....########....", // 4: Spherical observatory dome top
    "...#oooooooo#...", // 5: Observatory dome shell
    "..#oo#+**+#oo#..", // 6: Telescope aperture emitting cyan pulse
    "..#oooooooooo#..", // 7: Observatory dome lower rim
    ".################.", // 8: Saucer fuselage upper rim
    "#o*o*o*o*o*o*o*o#", // 9: Ring of flashing telemetry indicator pods
    "#oooooooooooooo#", // 10: Pressurized science lab deck
    ".#xx########xx#.", // 11: Saucer bevel underside
    "..#x#..##..#x#..", // 12: Hydraulic landing strut legs
    "..#x#..##..#x#..", // 13: Strut pads & umbilical
    ".###........###.", // 14: Heavy landing footpads
    "................", // 15: Scorched crop landing ring
  ],
  watchtower: [
    "......+**+......", // 0: Peak beacon / flame
    ".....######.....", // 1: Sniper platform roof
    "....#oo**oo#....", // 2: Observation deck slits & lantern
    "....#oooooo#....", // 3: Enclosed guard room
    ".....######.....", // 4: Guard deck railing
    ".....#xxxx#.....", // 5: Braced platform mount
    "....#x#..#x#....", // 6: A-frame lattice legs
    "....#x#..#x#....", // 7: Lattice legs
    "...#x#....#x#...", // 8: Cross-braced structural steel
    "...#x#*..*#x#...", // 9: Faction pennants flying
    "..#x#......#x#..", // 10: Expanding base stance
    "..#x#..xx..#x#..", // 11: Central ladder
    ".#x#...xx...#x#.", // 12: Access ladder
    ".#x#...xx...#x#.", // 13: Base ladder
    "###..........###", // 14: Concrete pad anchor footings
    "................", // 15:
  ],
  collection_plate: [
    ".....######.....", // 0: Baroque pediment
    "....#+****+#....", // 1: Glowing denomination marquee ($$$)
    "...#xxxxxxxx#...", // 2: Polished brass canopy
    "..#x#oooooo#x#..", // 3: Upper stock-ticker board
    "..#x#o+**+o#x#..", // 4: Active transaction hologram
    "..#x#oooooo#x#..", // 5: Display console
    "..#x#xxxxxx#x#..", // 6: Keypad & biometric scanner
    "..#x#oooooo#x#..", // 7: Illuminated collection hopper
    "..#x#oooooo#x#..", // 8: Vault safe body
    "..#x#xxxxxx#x#..", // 9: Heavy safe hinges & dial
    ".#x#........#x#.", // 10: Velvet rope stanchions
    ".#*#..####..#*#.", // 11: Brass stanchion balls
    "################", // 12: Velvet runner carpet
    ".#xxxxxxxxxxxx#.", // 13: Polished brass threshold
    "..############..", // 14: Foundation plinth
    "................", // 15:
  ],
  broadcast_tower: [
    ".......**.......", // 0: Red warning beacon
    ".......##.......", // 1: Mast tip
    "......#**#......", // 2: Microwave dipole radiator
    ".....#o##o#.....", // 3: High-gain directional array
    "......####......", // 4: Mast junction
    ".....#x##x#.....", // 5: Diamond lattice frame
    "....#x#..#x#....", // 6: Expanding mast section
    "...#x#....#x#...", // 7: Guy-wire attachment collar
    "..#x#..##..#x#..", // 8: Center waveguide conduit
    ".#x#...##...#x#.", // 9: Tower lattice struts
    "#x#....##....#x#", // 10: Wide base spread
    "#x#....##....#x#", // 11: Equipment shack roof
    "#x#..######..#x#", // 12: Transmitter shelter
    "#x#..#oooo#..#x#", // 13: Equipment shelter door & lights
    "###..######..###", // 14: Concrete anchor footings
    "................", // 15:
  ],
  supplement_lab: [
    "......####......", // 0: Copper cupola vent
    ".....#+**+#.....", // 1: Distillation condenser spire
    "....#xxxxxx#....", // 2: Glass pavilion roof cap
    "...#xoooooox#...", // 3: Multi-faceted glass roof
    "..#xooooooooox#..", // 4: Steamer glass panels
    ".################.", // 5: Octagonal eave ring
    "#xoxoxoxoxoxoxox#", // 6: Alembic cooling coils & glass tubing
    "#o#+**+####+**+#o#", // 7: Bubbling distillation vats
    "#o#****#oo#****#o#", // 8: Glowing elixir distillation
    "#o#+**+####+**+#o#", // 9: Glowing collection flasks
    "#o#oooooooooooo#o#", // 10: Polished tile lab bench
    "#o#xx##oooo##xx#o#", // 11: Arched entrance & brass fixtures
    "################", // 12: Laboratory stone foundation
    ".#xxxxxxxxxxxx#.", // 13: Perimeter drainage gutter
    "..############..", // 14: Foundation footing
    "................", // 15:
  ],
  satellite: [
    ".......**.......", // 0: Telemetry probe tip
    ".......##.......", // 1: Antenna stem
    "......####......", // 2: Upper sensor turret
    "....########....", // 3: Pressurized crew dome
    "...#oooooooo#...", // 4: Dome observation windows
    "..#oooooooooo#..", // 5: Saucer upper fuselage
    ".################.", // 6: Saucer primary ring perimeter
    "#o*o*o*o*o*o*o*o#", // 7: Flashing navigation strobe lights
    "#oooooooooooooo#", // 8: Saucer underside bevel
    ".#xxxxxxxxxxxx#.", // 9: Anti-gravity emitter coils
    "..#+********+#..", // 10: Blinding cyan anti-gravity thruster core
    "...#+******+#...", // 11: Plasma thruster glow beam
    "....#+****+#....", // 12: Atmospheric ionization column
    ".....#+**+#.....", // 13: Ground hover contact point
    "....########....", // 14: Concentric ground resonance ring
    "...##########...", // 15: Outer landing scorched ground
  ],
};

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
  /**
   * Season transition, 0..1 toward the NEXT season (spring → summer → fall
   * → winter → spring): the frame is rendered in both seasons and the two
   * cross-faded, so leaves turn, snow arrives and melts smoothly. 0 / omitted
   * = the plain season (no extra cost).
   */
  seasonBlend?: number;
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
  /** Per-player cosmetic loadouts (skins.ts) — presentation only, never simulated. */
  skins?: Record<number, SkinLoadout>;
}

export interface RenderedFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Loadouts for the frame being rendered (render-scoped; see renderTown). */
let activeSkins: Record<number, SkinLoadout> | undefined;

/** Seat colour, or the player's equipped livery. */
function playerColor(id: number): string {
  return getSkin(activeSkins?.[id]?.livery)?.color ?? colorForPlayer(id);
}

/** Livery accent override for glows / van trim, if the player wears one. */
function skinAccent(id: number): RGB | undefined {
  const sk = getSkin(activeSkins?.[id]?.livery);
  return sk ? hexToRgb(sk.accent) : undefined;
}

const NEXT_SEASON = { spring: "summer", summer: "fall", fall: "winter", winter: "spring" } as const;

export function renderTown(sim: SimState, opts: RenderOpts = {}): RenderedFrame {
  activeSkins = opts.skins;
  try {
    const k = opts.seasonBlend ?? 0;
    if (!(k > 0)) return renderTownFrame(sim, opts);
    const from = opts.season ?? "summer";
    const to = NEXT_SEASON[from];
    if (k >= 1) return renderTownFrame(sim, { ...opts, season: to });
    // SEASON CROSS-FADE: both palettes rendered, blended per pixel (fixed-
    // point weights — presentation only, deterministic per frame)
    const a = renderTownFrame(sim, { ...opts, season: from });
    const b = renderTownFrame(sim, { ...opts, season: to });
    const wb = Math.round(k * 256), wa = 256 - wb;
    const out = a.data;
    const bd = b.data;
    for (let i = 0; i < out.length; i += 4) {
      out[i] = (out[i]! * wa + bd[i]! * wb) >> 8;
      out[i + 1] = (out[i + 1]! * wa + bd[i + 1]! * wb) >> 8;
      out[i + 2] = (out[i + 2]! * wa + bd[i + 2]! * wb) >> 8;
    }
    return a;
  } finally {
    activeSkins = undefined;
  }
}

function renderTownFrame(sim: SimState, opts: RenderOpts): RenderedFrame {
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
  RS.season = season;
  RS.time = timeOfDay;
  RS.lod = S;
  RS.tick = tick;
  planFrame();

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
    C.meadow = hexToRgb("#eaf0f4"); // winter snow
    C.meadowLight = hexToRgb("#f4f7f9");
    C.grassHigh = hexToRgb("#f7f9fa");
    C.grassLow = hexToRgb("#dce5ec");
    C.dirt = hexToRgb("#bfaea0");
    C.dirtEdge = hexToRgb("#a29385");
    // snow lies on EVERY biome: desert and forest floors take the same
    // blue-white cover (a thin dusting — tan shows through as sandDark)
    C.sandBg = hexToRgb("#e9ecee");
    C.sandDark = hexToRgb("#d8d2c6");
    C.sandScrub = hexToRgb("#b8ad9c");
    C.forestFloor = hexToRgb("#e2e9ee");
    C.scrub = hexToRgb("#cfd6da"); // dry stalks poking through
    C.bush = hexToRgb("#5c5a4a");
    C.canopy = hexToRgb("#5c4c38"); // bare wood branches
    C.canopyLight = hexToRgb("#f2f6f8"); // snowy caps
    C.canopyDark = hexToRgb("#46392a"); // bare shadow branches
    C.willowL = hexToRgb("#7a6c5a"); // bare winter willows
    C.willowD = hexToRgb("#54483b");
    C.waterDeep = hexToRgb("#aed5e8"); // frozen ice water sheet
    C.waterRipple = hexToRgb("#cbeefc");
    C.waterGlint = hexToRgb("#f4f8fa");
  }

  // Adjust window colors for night view
  if (timeOfDay === "night") {
    C.windowDark = hexToRgb("#caa23e"); // warm yellow-gold glowing windows
    C.windowLit = hexToRgb("#ffd76a"); // bright glowing windows
  }

  const applyLighting = makeGrader(timeOfDay);

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
  // (+2 rows below: a tall lot just south of the view still composes, so
  // its spire / mast overhang reaches into the view — drawPlanOverhangs)
  const ty1 = Math.min(w.height - 1, vy + vh + 2);

  // ---- pass 1: ground + lots ----
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = ty * w.width + tx;
      drawTile(sim, t, tx, ty, put, archetypeOf, detail, tick);
      // purchased property: survey stakes + a boundary cord in the owner's
      // color mark bought land in the wilderness (§18 rev.)
      const propOwner = w.property[t]!;
      if (propOwner !== 0 && w.terrain[t] !== Terrain.Citizen && w.terrain[t] !== Terrain.Road) {
        const stake = hexToRgb(playerColor(propOwner));
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
          if (mainLine(w)?.on[rt]) continue; // the siding only: the main line carries the moving freight
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

  // ---- pass 1.62: the scheduled FREIGHT TRAIN on the main line ----
  drawTrain(w, tick, put);

  // ---- pass 1.65: TALL structures rising over the tiles behind them ----
  drawPlanOverhangs(w, put);
  // the transmission line feeding each substation / leaving the powerhouse
  drawTransmissionLines(w, put, { x0: tx0, y0: ty0, x1: tx1, y1: ty1 });

  // ---- pass 1.7: overlays reaching past a footprint (lighthouse beam) ----
  drawLotOverlays(w, tick, put, { x0: tx0, y0: ty0, x1: tx1, y1: ty1 });

  // ---- pass 2: landmarks + cult buildings as icons ----
  for (let t = 0; t < w.landmark.length; t++) {
    if (w.landmark[t] !== 0) {
      const lm = w.landmark[t]!;
      // the courthouse IS the town hall: its building carries the landmark
      if (lm === Landmark.TownHall && w.lot[t] === Lot.Courthouse) continue;
      // landmark compounds draw the whole compound from their Lot
      if (COMPOUND_LOTS.has(w.lot[t]!)) continue;
      if (lm === Landmark.RadioTower) {
        // 2-frame blinking red aviation warning beacon (1.0s cycle)
        const isBeaconLit = ((tick >> 3) % 2) === 0;
        const beaconCol = isBeaconLit ? EMISSIVE.beacon : hexToRgb("#551111");
        drawIcon(LANDMARK_ICON[Landmark.RadioTower]!, t, w.width, C.landmarkGold, put, beaconCol);
        // the lit beacon throws a small red halo (day and night) and a
        // second obstruction lamp half-way up the mast blinks in antiphase
        const bx = (t % w.width) * TILE_PX + 3, by = ((t / w.width) | 0) * TILE_PX;
        if (isBeaconLit) {
          put(bx - 1, by, hexToRgb("#c83a30"));
          put(bx + 1, by, hexToRgb("#c83a30"));
          put(bx, by - 1, hexToRgb("#c83a30"));
        } else {
          put(bx, by + 4, EMISSIVE.beacon);
        }
      } else {
        drawIcon(LANDMARK_ICON[lm] ?? ICONS.compound, t, w.width, C.landmarkGold, put);
      }
    }
  }
  for (const bd of sim.buildings) {
    if (fog && fog[bd.tile] !== 1) continue;
    const ownerRgb =
      bd.disabledTicks > 0
        ? hexToRgb("#7a3535")
        : bd.buildTicksLeft > 0
          ? hexToRgb("#9a9a9a")
          : hexToRgb(playerColor(bd.player));
    const ownerPl = sim.players.find((pl) => pl.id === bd.player);
    const rawArch = String(ownerPl?.archetype ?? "dawn");
    const archKey =
      rawArch.includes("dawn") ? "dawn" :
      rawArch.includes("radiant") ? "radiant" :
      rawArch.includes("circle") ? "circle" :
      "visitors";
    const accentCol = skinAccent(bd.player) ??
      (archKey === "dawn" ? hexToRgb("#ffaa00") :
      archKey === "radiant" ? hexToRgb("#38bdf8") :
      archKey === "circle" ? hexToRgb("#fbbf24") :
      hexToRgb("#22d3ee"));

    const iconKey = bd.type === "compound" ? `compound_${archKey}` : bd.type;
    const bitmap16 = CULT_ICONS_16[iconKey];

    if (bitmap16) {
      // 16×16 (2×2 tiles) Cult Asset with pulsating radiant glow
      drawCultAsset16(bitmap16, bd.tile, w.width, ownerRgb, put, accentCol, tick, true);
    } else {
      // Fallback 8×8
      const gx0 = (bd.tile % w.width) * TILE_PX;
      const gy0 = ((bd.tile / w.width) | 0) * TILE_PX;
      const pulse = 1.15 + 0.25 * Math.sin((tick + bd.tile) * 0.12);
      const halo = shade(ownerRgb, pulse);
      const dim = shade(ownerRgb, pulse * 0.62);
      for (let k = 0; k < TILE_PX; k++) {
        const bright = (k + (tick >> 3)) % 2 === 0;
        put(gx0 + k, gy0 - 1, bright ? halo : dim);
        put(gx0 + k, gy0 + TILE_PX, bright ? halo : dim);
        put(gx0 - 1, gy0 + k, bright ? dim : halo);
        put(gx0 + TILE_PX, gy0 + k, bright ? dim : halo);
      }
      const iconBmp = bd.type === "compound" ? (COMPOUND_ICONS[archKey as Archetype] ?? ICONS.compound) : ICONS[bd.type];
      drawIcon(iconBmp, bd.tile, w.width, ownerRgb, put);
    }

    // Compounds EXPAND as their cult grows: 16×16 perimeter fence posts and flying banners
    if (bd.type === "compound" && bd.buildTicksLeft === 0) {
      const p = sim.players.find((pl) => pl.id === bd.player);
      const permille = p && sim.populated > 0 ? (p.ownedTiles * 1000) / sim.populated : 0;
      const stage = permille >= 150 ? 3 : permille >= 70 ? 2 : 1;
      const bx = (bd.tile % w.width) * TILE_PX;
      const by = ((bd.tile / w.width) | 0) * TILE_PX;
      if (stage >= 2) {
        const post = shade(ownerRgb, 0.55);
        for (const [fx, fy] of [[-1, -1], [16, -1], [-1, 16], [16, 16], [-1, 7], [16, 7], [7, -1], [7, 16]] as const) {
          put(bx + fx, by + fy, post); // 16×16 perimeter fence posts
        }
      }
      if (stage >= 3) {
        put(bx + 2, by - 2, ownerRgb); // banners over the headquarters
        put(bx + 13, by - 2, ownerRgb);
        put(bx + 2, by - 3, C.iconAccent);
        put(bx + 13, by - 3, C.iconAccent);
      }
    }
  }

  // ---- pass 2.5: area effects (auras) under the people ----
  drawEffects(sim, tick, fog, put);

  // ---- pass 3: the people ----
  drawResidents(sim, tick, fog, put);
  drawAmbientTraffic(w, tick, fog, put, ROUTE_KIT);
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
const t0Of = (w: World, tx: number, ty: number): number => ty * w.width + tx;

function naturalEdgeBleed(
  w: World,
  tx: number,
  ty: number,
  px: number,
  py: number,
): RGB | null {
  const gx = tx * TILE_PX + px;
  const gy = ty * TILE_PX + py;
  const bar = pointBarAt(w, tx, ty, px, py);
  if (bar) return bar;
  let bestKind = 0;
  let bestPen = 0;
  let bestT = 0;
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
      bestT = nt;
    }
  };
  consider(tx, ty - 1, py + 1); // N
  consider(tx, ty + 1, TILE_PX - py); // S
  consider(tx - 1, ty, px + 1); // W
  consider(tx + 1, ty, TILE_PX - px); // E
  if (bestKind === 0) return screeAt(w, tx, ty, px, py);
  const h = pixHash(gx, gy, 7);
  if (bestKind === Terrain.Lake) {
    if (bestPen < 0.8) {
      // the bank where water meets land: beach sand on coasts and in the
      // desert, a grey-brown gravel margin inland
      const b = w.biome[t0Of(w, tx, ty)];
      if (b === 1 || b === 4) return C.sand;
      return h % 3 === 0 ? hexToRgb("#a8a08a") : hexToRgb("#b8ae94");
    }
    return bleedWater(w, bestT, gx, gy);
  }
  // woods: canopy clumps thinning at the very fringe
  const blob = pixHash(gx >> 2, gy >> 2, 77) % 5;
  if (bestPen < 0.7 && h % 2 === 0) return null; // frayed outermost rim
  void blob;
  return canopyPx(gx, gy, w.biome[bestT] === 3 ? 0.08 : w.biome[bestT] === 2 ? 0.55 : 0.22); // the same crowns as the stand
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
      // Main Street through downtown carries angled curb stalls on the
      // side(s) where the storefronts are
      const mainSt = roadClass(w)[t] === 5 && (roadE || roadW);
      const dtAt = (n: number): boolean => n >= 0 && n < w.terrain.length && w.terrain[n] === Terrain.Citizen && w.district[n] === 3;
      const diagN = mainSt && !roadN && dtAt(t - w.width);
      const diagS = mainSt && !roadS && dtAt(t + w.width);
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
              } else if (curbCutAt(w, t, px, py)) {
                c = hexToRgb("#8f897e"); // driveway apron: the curb dips to the drive
              } else {
                let sideCol = C.sidewalk;
                if (w.district[t] === 4 /* Districts.OldTown */) {
                  sideCol = hexToRgb("#8c685c"); // brick sidewalk tint
                }
                c = sideCol;
              }
            }
          }
          // 4-LANE HIGHWAY: yellow center seam + delicate dashed lane lines + thin weathered fog lines
          if (highwayTopLane && py === TILE_PX - 1 && gx % 6 < 3) {
            c = C.highwayLine; // yellow center line on dividing seam
          } else if (highway && py === 3 && gx % 8 < 2) {
            c = shade(C.asphaltDash, 0.92); // delicate 2px dashed lane line
          } else if (highwayTopLane && py === 0 && !fronted && !roadN) {
            c = hexToRgb("#b3aca0"); // subtle weathered northern fog line (outer shoulder only)
          } else if (highway && !highwayTopLane && py === TILE_PX - 1 && !fronted && !roadS) {
            c = hexToRgb("#b3aca0"); // subtle weathered southern fog line (outer shoulder only)
          }

          // 2-LANE STREETS: faint, refined center dashes along the travel axis
          if (!highway) {
            const horiz2 = roadE && roadW && !roadN && !roadS;
            const vert2 = roadN && roadS && !roadE && !roadW;
            if (horiz2 && py === 3 && gx % 8 < 2) c = shade(C.asphaltDash, 0.85);
            if (vert2 && px === 3 && gy % 8 < 2) c = shade(C.asphaltDash, 0.85);
          }

          // DOWNTOWN INTERSECTIONS: crisp pedestrian crosswalk dashes at street entry edges
          if (intersection && !fourWay && px % 2 === 1 && (py === 1 || py === TILE_PX - 2)) {
            c = shade(C.crosswalk, 0.9);
          }

          // DIAGONAL CURB PARKING along Main Street through downtown
          if (diagN && (py === 1 || py === 2)) c = diagonalStall(gx, py - 1, ty * 2) ?? c;
          else if (diagS && (py === 5 || py === 6)) c = diagonalStall(gx, py - 5, ty * 2 + 1) ?? c;
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
      if (w.lot[t] === Lot.Jetty) {
        // the stone breakwater runs out over open water
        seaFill(w, t, tx, ty, put, frameTick);
        drawJetty(w, t, tx, ty, put, frameTick);
        return;
      }
      if (w.biome[t] === 4 /* Biome.Ocean */) {
        // BOARDWALK: weathered grey-brown planks laid across the walk,
        // dark seams, a rail along the surf side, sand-drift at the ends
        const surfE = tx < w.width - 1 && w.terrain[t + 1] === Terrain.Lake;
        const surfW = tx > 0 && w.terrain[t - 1] === Terrain.Lake;
        const surfN = ty > 0 && w.terrain[t - w.width] === Terrain.Lake;
        const surfS = ty < w.height - 1 && w.terrain[t + w.width] === Terrain.Lake;
        const along = !(surfN || surfS) && (surfE || surfW || (ty > 0 && w.terrain[t - w.width] === Terrain.Path));
        const plank = RS.season === "winter" ? hexToRgb("#b8b2a8") : hexToRgb("#a08a6a");
        for (let py = 0; py < TILE_PX; py++) {
          for (let px = 0; px < TILE_PX; px++) {
            const k = along ? py : px; // planks run across the walk
            let c = k % 2 === 0 ? plank : shade(plank, 0.86);
            if (pixHash(x0 + px, y0 + py, 57) % 17 === 0) c = shade(plank, 1.1); // weathered board
            if ((surfE && px === TILE_PX - 1) || (surfW && px === 0) || (surfN && py === 0) || (surfS && py === TILE_PX - 1)) {
              c = (along ? py : px) % 3 === 0 ? hexToRgb("#5a4a3a") : hexToRgb("#c8bca8"); // rail posts
            }
            put(x0 + px, y0 + py, c);
          }
        }
        return;
      }
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
      drawOrchard(t, x0, y0, put); // true tree grid, seasonal (grounds.ts)
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
        // GRAZING HERD: 2×1 cow silhouettes (body + darker head) that amble
        // a pixel every few seconds, turn around at the fence, and dip their
        // heads to graze — deterministic from (tile, cow, tick)
        const n = 1 + (pixHash(t, 12, 27) % 3);
        const horse = pixHash(t, 14, 27) % 5 === 0;
        for (let k = 0; k < n; k++) {
          const hk = pixHash(t, 20 + k, 27);
          const step = (frameTick + (hk & 255) * 7) >> 6; // one move per ~6 s
          const span = 4; // pace back and forth across the pen
          const lap = (step + (hk >> 8)) % (span * 2);
          const facingE = lap < span;
          const along = facingE ? lap : span * 2 - 1 - lap;
          const cx = x0 + 1 + along;
          const cy = y0 + 1 + ((hk >> 12) % 5) + ((step >> 3) & 1) * (k === 1 ? 1 : 0);
          const body = horse && k === 0 ? hexToRgb("#7a4a2a") : (hk >> 16) % 3 === 0 ? C.cowBrown : (hk >> 16) % 3 === 1 ? C.cowWhite : hexToRgb("#2e2a26");
          const grazing = ((frameTick >> 4) + k) % 5 < 2;
          const head = grazing ? shade(body, 0.55) : shade(body, 0.75);
          put(facingE ? cx : cx + 1, cy, body);
          put(facingE ? cx + 1 : cx, cy, head);
          if (body === C.cowWhite && !grazing) put(facingE ? cx : cx + 1, cy, (hk & 1) ? C.cowWhite : shade(C.cowWhite, 0.85)); // holstein patch
          put(cx, cy + 1, C.shadow);
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
              c = RS.season === "winter" ? (h % 3 === 0 ? C.sandDark : C.sandBg) : h % 3 === 0 ? hexToRgb("#61b53e") : hexToRgb("#4c962b"); // oasis grass
            } else {
              c = desertGround(gx, gy); // red soil · sand · dune ripples · caliche (render/desert.ts)
              // DRY WASH (§2): a winding dry-creek bed cut through the blob —
              // a narrow noise-contour band of darker packed sand + stones
              const wash = valueNoise(gx, gy, 22, 55);
              if (wash > 0.47 && wash < 0.53) {
                c = RS.season === "winter" ? (h % 3 === 0 ? C.sandScrub : C.sandDark) : h % 7 === 0 ? hexToRgb("#b8a276") : hexToRgb("#c7b284");
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
          else if (w.biome[t] === 3 /* Biome.Autumn */ && RS.season !== "winter") c = cell === 0 ? hexToRgb("#d0a75c") : hexToRgb("#c2964b"); // golden rust ground
          else if (w.biome[t] === 4 /* Biome.Ocean */) {
            // the BEACH (§2A): dry sand with shell flecks and beach grass tufts
            c = cell === 0 ? shade(C.sandBg, 1.06) : C.sandBg;
            if (h % 37 === 0) c = hexToRgb("#f4f0e4"); // shell
            else if (h % 23 === 0) c = hexToRgb("#a8a86c"); // beach grass
            put(gx, gy, c);
            continue;
          }

          if (isMarsh && RS.season !== "winter") {
            c = cell === 0 ? hexToRgb("#82935c") : hexToRgb("#6e7e4c"); // swampy green
          }

          if (elev > 0.7) c = C.grassHigh; // hilltops catch the light
          else if (elev < 0.3) c = C.grassLow; // hollows sit in shade
          // west-facing banks in shade — per-pixel slope, so the shading
          // follows the terrain contour instead of tile-aligned columns
          if (elevAt(gx + 2, gy) - elev > 0.045) c = shade(c, 0.94);
          // subtle tonal tufts only — no flower confetti (S2 grass pass);
          // a very rare wildflower survives in spring/summer
          if (h % 31 === 0) c = C.scrub;
          else if (h % 1733 === 0 && (RS.season === "summer" || RS.season === "spring")) c = C.flowerY;

          // graded ecotone: heavy sand at ring 1, thinning scrub to ring 3
          if (desertRing === 1 && h % 3 === 0) c = C.sandBg;
          else if (desertRing === 2 && h % 6 === 0) c = h % 12 === 0 ? C.sandScrub : C.sandBg;
          else if (desertRing === 3 && h % 12 === 0) c = C.sandScrub;

          // graded forest ecotone: blend forestFloor at ring 1-3
          if (forestRing === 1 && h % 2 === 0) c = C.forestFloor;
          else if (forestRing === 2 && h % 4 === 0) c = C.forestFloor;
          else if (forestRing === 3 && h % 8 === 0) c = C.forestFloor;
          // graded autumn ecotone: golden-rust ground fades out over 3 rings
          const autumnGround = RS.season === "winter" ? C.meadow : hexToRgb("#c9a054");
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

      // sparse rock outcrops with shape variety on the higher, drier ground (Cool grey shore boulders)
      if (elevAt(x0 + 4, y0 + 4) > 0.62 && pixHash(t, 4, 23) % 17 === 0) {
        drawRockOutcrop(x0, y0, put, pixHash(t, 45) % 3);
      }
      // scattered low brush with variety (leafy bramble thickets with wild berries)
      if (valueNoise(x0, y0, 22, 88) > 0.6 && pixHash(t, 7, 31) % 5 === 0) {
        drawBrushPocket(x0, y0, put, pixHash(t, 46) % 2);
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
        drawCountryTree(x0, y0, put, pixHash(t, 12, 19) % 5, RS.season);
      }
      // Utility poles marching along rural roadsides:
      // Spaced every 4 tiles (32px), featuring wooden T-poles, white ceramic insulators,
      // and continuous soft silver-grey overhead power cables.
      // TERMINAL & SPACING GUARANTEE: Even 4-tile spacing relative to run start, zero orphan poles.
      {
        const isRoad = (x: number, y: number): boolean =>
          x >= 0 && y >= 0 && x < w.width && y < w.height && w.terrain[y * w.width + x] === Terrain.Road;

        // A horizontal verge runs north of an east-west road
        const isRoadS = isRoad(tx, ty + 1);
        const hasRoadW = isRoad(tx - 1, ty + 1);
        const hasRoadE = isRoad(tx + 1, ty + 1);

        // A vertical verge runs west of a north-south road
        const isRoadE = isRoad(tx + 1, ty);
        const hasRoadN = isRoad(tx + 1, ty - 1);
        const hasRoadS_V = isRoad(tx + 1, ty + 1);

        // Check if tile is in a rural area OUTSIDE of town (no citizen lots within 3 tiles)
        let isRuralArea = true;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const nx = tx + dx;
            const ny = ty + dy;
            if (nx >= 0 && ny >= 0 && nx < w.width && ny < w.height) {
              if (Number(w.terrain[ny * w.width + nx]) === Terrain.Citizen) {
                isRuralArea = false;
                break;
              }
            }
          }
          if (!isRuralArea) break;
        }

        const runH = isRoadS && (hasRoadW || hasRoadE) && isRuralArea;
        const runV = isRoadE && (hasRoadN || hasRoadS_V) && !isRoadS && isRuralArea;

        if (runH || runV) {
          const wireColor = hexToRgb("#64748b"); // subtle silver-grey overhead cable
          const poleWood = hexToRgb("#7e6244");  // treated wooden utility pole
          const insulator = hexToRgb("#ffffff"); // white ceramic insulator cap
          const spacing: number = 4;

          if (runH) {
            const isStartWest = !hasRoadW;
            const isEndEast = !hasRoadE;

            // Measure tile distance from start of horizontal verge run for even 4-tile pole spacing
            let distFromStart = 0;
            let checkX = tx - 1;
            while (
              checkX >= 0 &&
              isRoad(checkX, ty + 1) &&
              Number(w.terrain[ty * w.width + checkX]) !== Terrain.Citizen
            ) {
              distFromStart++;
              checkX--;
            }

            // Pole placement: at start of run (dist 0), every 4 tiles after (dist % 4 === 0),
            // or at end of run if at least 2 tiles from previous pole
            const isPoleTile = (distFromStart % spacing === 0) || (isEndEast && distFromStart % spacing >= 2);
            const dip = (distFromStart % spacing === 2 && !isStartWest && !isEndEast) ? 1 : 0; // 1px sag at mid-span

            // Continuous overhead cable line bounded by terminal poles
            const pxStart = isStartWest ? 4 : 0;
            const pxEnd = isEndEast ? 4 : TILE_PX - 1;

            if (pxEnd >= pxStart) {
              for (let px = pxStart; px <= pxEnd; px++) {
                put(x0 + px, y0 + 2 + dip, wireColor);
              }
            }

            // Utility pole ONLY spawns when connected to wires (no orphan poles)
            if (isPoleTile && pxEnd >= pxStart) {
              const cxp = x0 + 4;
              for (let py = 2; py <= 6; py++) put(cxp, y0 + py, poleWood); // main pole
              put(cxp - 2, y0 + 2, poleWood); // crossarm
              put(cxp - 1, y0 + 2, poleWood);
              put(cxp + 1, y0 + 2, poleWood);
              put(cxp + 2, y0 + 2, poleWood);
              put(cxp - 2, y0 + 1, insulator); // insulators on crossarm tips
              put(cxp + 2, y0 + 1, insulator);
              put(cxp + 1, y0 + 7, C.shadow); // ground shadow
            }
          } else if (runV) {
            const isStartNorth = !hasRoadN;
            const isEndSouth = !hasRoadS_V;

            // Measure tile distance from start of vertical verge run
            let distFromStart = 0;
            let checkY = ty - 1;
            while (
              checkY >= 0 &&
              isRoad(tx + 1, checkY) &&
              !isRoad(tx, checkY) &&
              Number(w.terrain[checkY * w.width + tx]) !== Terrain.Citizen
            ) {
              distFromStart++;
              checkY--;
            }

            const isPoleTile = (distFromStart % spacing === 0) || (isEndSouth && distFromStart % spacing >= 2);

            // Continuous vertical overhead cable bounded by terminal poles
            const pyStart = isStartNorth ? 4 : 0;
            const pyEnd = isEndSouth ? 4 : TILE_PX - 1;

            if (pyEnd >= pyStart) {
              for (let py = pyStart; py <= pyEnd; py++) {
                put(x0 + 3, y0 + py, wireColor);
              }
            }

            // Utility pole ONLY spawns when connected to wires (no orphan poles)
            if (isPoleTile && pyEnd >= pyStart) {
              const cxp = x0 + 3;
              for (let py = 1; py <= 6; py++) put(cxp, y0 + py, poleWood); // main pole
              put(cxp - 1, y0 + 1, poleWood);
              put(cxp, y0 + 1, poleWood);
              put(cxp + 1, y0 + 1, poleWood);
              put(cxp, y0, insulator); // top insulator cap
              put(cxp + 1, y0 + 7, C.shadow); // ground shadow
            }
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
      if (drawPivotTile(w, t, x0, y0, put)) return; // desert center pivot
      const fenceN = ty > 0 && w.terrain[t - w.width] !== Terrain.Field;
      const fenceW = tx > 0 && w.terrain[t - 1] !== Terrain.Field;
      const roadN = ty > 0 && w.terrain[t - w.width] === Terrain.Road;
      const roadW = tx > 0 && w.terrain[t - 1] === Terrain.Road;
      const roadS = ty < w.height - 1 && w.terrain[t + w.width] === Terrain.Road;
      const roadE = tx < w.width - 1 && w.terrain[t + 1] === Terrain.Road;
      // CROP VARIETY (§10): 5 distinct crop varieties per parcel —
      // Golden Wheat, Corn Rows, Canola Blossom, Rich Soybeans, or Dark Soil Furrows
      const parcel = pixHash((tx / 6) | 0, (ty / 6) | 0, 97) % 5;
      let cropA =
        parcel === 0 ? hexToRgb("#d4b247") : parcel === 1 ? hexToRgb("#54802a") : parcel === 2 ? hexToRgb("#e6c832") : parcel === 3 ? hexToRgb("#4f8c2e") : hexToRgb("#6b523b");
      let cropB =
        parcel === 0 ? hexToRgb("#f0d675") : parcel === 1 ? hexToRgb("#e6c832") : parcel === 2 ? hexToRgb("#62a838") : parcel === 3 ? hexToRgb("#3a6921") : hexToRgb("#4e3b29");

      if (RS.season === "spring") {
        cropA = hexToRgb("#5c4832"); // brown soil
        cropB = hexToRgb("#4a3824");
      } else if (RS.season === "fall") {
        cropA = hexToRgb("#baa57c"); // tan stubble
        cropB = hexToRgb("#6d5338"); // tilled soil
      } else if (RS.season === "winter") {
        cropA = hexToRgb("#f4f7f9"); // snow cover (off-white: pure white is a light source)
        cropB = hexToRgb("#dce5ec");
      }

      const vertRows = pixHash((tx / 6) | 0, (ty / 6) | 0, 99) % 2 === 0; // rotation
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const gy = ty * TILE_PX + py;
          const gx2 = tx * TILE_PX + px;
          const row = (vertRows ? gx2 : gy) % 3 === 0;
          let c = row ? cropB : cropA;
          if (RS.season === "spring" && row && pixHash(gx2, gy, 47) % 3 === 0) {
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
          } else {
            // Sub-tile agricultural dirt paths (2px wide) connecting parcels and farmsteads
            const isAgriPath = (tx % 6 === 0 && (px === 0 || px === 1)) || (ty % 6 === 0 && (py === 0 || py === 1));
            if (isAgriPath) {
              const darkDirt = RS.season === "winter" ? hexToRgb("#5e5246") : hexToRgb("#483726");
              c = (gx2 + gy) % 2 === 0 ? darkDirt : shade(darkDirt, 0.88);
            }
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
      if (RS.season === "fall" && pixHash(t, 6, 98) % 7 === 0) {
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
      drawWater(w, t, tx, ty, put, frameTick);
      // lots standing IN the water: jetty, dam, chained piers / marina;
      // the lighthouse (and a powerhouse on the tailrace) compose on top
      const wl = w.lot[t]!;
      if (!drawWaterLot(w, t, tx, ty, put, frameTick)) drawPierOverWater(w, t, tx, ty, put);
      drawTailwater(w, tx, ty, put, frameTick);
      if (wl === Lot.Lighthouse || wl === Lot.Powerhouse) drawLotBuilding(w, t, tx, ty, x0, y0, wl, put);
      return;
    }
    case Terrain.Rock: {
      drawRock(w, t, tx, ty, put);
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
          
          // crown-by-crown canopy, per season (render/canopy.ts); the
          // autumn-maple biome keeps fewer conifers, highlands more
          let c: RGB = canopyPx(gx, gy, w.biome[t] === 3 ? 0.08 : w.biome[t] === 2 ? 0.55 : 0.22);
          void h; void edgeN; void edgeW;
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
  // the radio mast stands in the open land: its lot keeps the natural ground
  const built = lot === Lot.RadioTower ? false : lot !== 0 || pop >= 3;
  let lawnBase = hexToRgb(NEUTRAL_BY_DISTRICT[district % NEUTRAL_BY_DISTRICT.length]!);
  const lawnDistrict = district === 1 || district === 2 || district === 4 || district === 0;
  if (lawnDistrict) {
    if (RS.season === "winter") {
      // snow, but BLUE-GREY snow: pure white here made white winter roofs
      // dissolve into the ground and buildings read as cut off
      lawnBase = hexToRgb("#dfe7ee");
    } else if (RS.season === "fall") {
      lawnBase = hexToRgb("#8a8b54"); // dry autumn lawn
    } else if (RS.season === "spring") {
      lawnBase = hexToRgb("#4c9c28"); // fresh spring green
    }
  }
  const desertY = w.biome[t] === 1;
  if (RS.season === "winter" && district === 5) lawnBase = hexToRgb("#d6dce0"); // trailer lots under packed snow

  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      const gx = x0 + px;
      const gy = y0 + py;
      let c: RGB;
      if (apostate) {
        c = (gx + gy) % 3 === 0 ? shade(C.scorched, 1.2) : C.scorched;
      } else {
        if (built) {
          if (lawnDistrict && desertY) {
            // desert yard: no irrigated turf — packed caliche + gravel, a
            // rare saltbush; the green lives only by the house (drawHouse)
            c = pixHash(gx, gy, 33) % 4 === 0 ? C.sandDark : pixHash(gx, gy, 35) % 29 === 0 ? hexToRgb("#8a9a6a") : shade(C.sandBg, 0.96);
          } else if (lawnDistrict) {
            // mown lawn: alternating mowing stripes, the proper green
            c = ((gx >> 1) + (gy >> 1)) % 2 === 0 ? lawnBase : shade(lawnBase, 1.07);
            if (pixHash(gx, gy, 33) % 41 === 0) c = shade(lawnBase, 0.93); // clover
          } else {
            // hard ground: concrete/pavers/gravel speckle
            c = pixHash(gx, gy, 33) % 9 === 0 ? shade(lawnBase, 0.92) : lawnBase;
          }
          // the lot's edge facing open country blends into the land
          if (lawnDistrict) {
            const eb = edgeBlend(w, t, tx, ty, px, py);
            if (eb) c = eb;
          }
        } else {
          // open yard: the land's own ground (identical to the Grass tiles,
          // so fringe yards never seam against the country)
          c = wildGround(w, t, gx, gy);
        }
        if (owner !== NEUTRAL) {
          const cult = hexToRgb(playerColor(owner));
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
        put(x0 + px, y0, worn ? shade(C.sidewalk, 0.85) : px % 4 === 0 ? shade(C.sidewalk, 0.93) : C.sidewalk);
        // (single-row lot sidewalk: the road skirt supplies the curb row)
      }
      if (lit && tx % 4 === 1) {
        put(x0 + 2, y0 + 2, C.shadow); // lamp shadow (13)
        put(x0 + 1, y0 + 1, C.iconDark); // lamp post
        put(x0 + 1, y0, (isLitHour() ? C.windowLit : C.crosswalk)); // warm head
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
        // (single-row lot sidewalk: the road skirt supplies the curb row)
      }
    }
    if (tx > 0 && roadSide(t - 1)) {
      for (let py = 0; py < TILE_PX; py++) {
        put(x0, y0 + py, C.sidewalk);
        // (single-row lot sidewalk: the road skirt supplies the curb row)
      }
    }
    if (tx < w.width - 1 && roadSide(t + 1)) {
      for (let py = 0; py < TILE_PX; py++) {
        put(x0 + TILE_PX - 1, y0 + py, C.sidewalk);
        // (single-row lot sidewalk: the road skirt supplies the curb row)
      }
    }
  }

  if (apostate) return;

  if (lot !== 0) {
    drawLotBuilding(w, t, tx, ty, x0, y0, lot, put);
  } else if (pop >= 8 && district === 8) {
    castShadow(x0, y0, put);
    drawApartment(w, t, x0, y0, put); // ResHigh walk-up: one building per tile
  } else if (pop >= 8 && district === 3) {
    castShadow(x0, y0, put);
    drawStorefront(w, t, x0, y0, put); // downtown commercial block
  } else if (pop >= 3) {
    if (district === 5) {
      drawVerge(w, t, tx, ty, x0, y0, district, put);
      drawTrailerHome(x0, y0, t, put, detail); // trailer fringe (§2)
    } else if (district === 7) {
      drawVerge(w, t, tx, ty, x0, y0, district, put);
      drawIndustrialShed(x0, y0, t, put, detail); // industrial shed
    } else if (district === 6 || district === 3) {
      drawStorefront(w, t, x0, y0, put); // Main St / strip storefront
    } else if (!isHouseTile(w, t)) {
      drawVerge(w, t, tx, ty, x0, y0, district, put);
      drawCollegeBlock(x0, y0, t, put, detail); // campus classroom block
    } else {
      castShadow(x0, y0, put);
      drawHouse(w, t, x0, y0, district, put, frameTick);
    }
  } else if (frontageOf(w, t) < 0) {
    // BACKYARD (S2): block interiors are the town's backyards — a fence on
    // the property line and 80s yard life, never speckle
    if (district === 5 && pixHash(t, 4, 91) % 10 < 4) {
      const rust = hexToRgb("#8a5a3a"); // trailer-fringe salvage: a dead car + tires
      put(x0 + 2, y0 + 3, rust); put(x0 + 3, y0 + 3, rust); put(x0 + 4, y0 + 3, shade(rust, 0.8));
      put(x0 + 2, y0 + 4, C.iconDark); put(x0 + 5, y0 + 5, C.iconDark); put(x0 + 6, y0 + 5, C.iconDark);
    } else {
      drawBackyard(w, t, tx, ty, x0, y0, put);
    }
  } else {
    // VACANT street lot: mown, a shade tree or a realtor's FOR SALE sign
    const roll = pixHash(t, 5, 97) % 10;
    if (RS.season === "winter" && roll < 2) {
      put(x0 + 3, y0 + 3, hexToRgb("#fafafa")); put(x0 + 3, y0 + 4, hexToRgb("#f0f0f4"));
      put(x0 + 3, y0 + 2, C.iconDark); put(x0 + 4, y0 + 3, hexToRgb("#d23b3b"));
    } else if (roll < 5) {
      const hx2 = 2 + (pixHash(t, 6, 97) % 3);
      const hy2 = 1 + (pixHash(t, 7, 97) % 3);
      const leaf = RS.season === "winter" ? hexToRgb("#6a5a44") : RS.season === "fall" ? hexToRgb("#b06f33") : C.canopy;
      put(x0 + hx2, y0 + hy2, shade(leaf, 1.2)); put(x0 + hx2 + 1, y0 + hy2, leaf);
      put(x0 + hx2, y0 + hy2 + 1, leaf); put(x0 + hx2 + 1, y0 + hy2 + 1, shade(leaf, 0.8));
      put(x0 + hx2 + 1, y0 + hy2 + 2, C.trunk); put(x0 + hx2 + 2, y0 + hy2 + 2, C.shadow);
    } else if (roll === 5) {
      put(x0 + 4, y0 + 3, hexToRgb("#f0ece0")); put(x0 + 5, y0 + 3, hexToRgb("#c8352a")); // FOR SALE
      put(x0 + 4, y0 + 4, C.trunk);
    }
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

// (the downtown / civic / school lots moved to the plan kit — render/
// registry.ts; the facade path keeps the remaining anchors)
const FACADE_LOTS = new Set<number>([
  Lot.Sheriff,
  Lot.Church,
  Lot.FireStation,
  Lot.Factory,
  Lot.Warehouse,
  Lot.Motel,
]);

/** Bounding rect of a park's whole connected component (the square's lawn
 * ring included, courthouse tiles counted as part of it), cached per world. */
const PARK_RECT = new WeakMap<World, Map<number, { ax: number; ay: number; fw: number; fh: number }>>();
function parkRect(w: World, t: number): { ax: number; ay: number; fw: number; fh: number } {
  let m = PARK_RECT.get(w);
  if (!m) { m = new Map(); PARK_RECT.set(w, m); }
  const hit = m.get(t);
  if (hit) return hit;
  const isP = (n: number): boolean => w.lot[n] === Lot.Park || w.lot[n] === Lot.Courthouse;
  const comp: number[] = [t];
  const seen = new Set<number>([t]);
  let x0 = t % w.width, x1 = x0, y0 = (t / w.width) | 0, y1 = y0;
  for (let i = 0; i < comp.length; i++) {
    const c = comp[i]!;
    const cx = c % w.width, cy = (c / w.width) | 0;
    x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
    for (const n of [cx > 0 ? c - 1 : -1, cx < w.width - 1 ? c + 1 : -1, c - w.width, c + w.width]) {
      if (n < 0 || n >= w.lot.length || seen.has(n) || !isP(n)) continue;
      seen.add(n);
      comp.push(n);
    }
  }
  const r = { ax: x0, ay: y0, fw: x1 - x0 + 1, fh: y1 - y0 + 1 };
  for (const c of comp) m.set(c, r);
  return r;
}

/** Top-left anchor + extent of the contiguous same-lot rectangle (stamps are rects). */
function lotRect(
  w: World,
  tx: number,
  ty: number,
  lot: number,
): { ax: number; ay: number; fw: number; fh: number } {
  // the contiguous same-lot component's bounding rows/cols through (tx, ty)
  const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w.width && y < w.height && w.lot[y * w.width + x] === lot;
  let cx0 = tx;
  while (at(cx0 - 1, ty)) cx0--;
  let cx1 = tx;
  while (at(cx1 + 1, ty)) cx1++;
  let cy0 = ty;
  while (at(tx, cy0 - 1)) cy0--;
  let cy1 = ty;
  while (at(tx, cy1 + 1)) cy1++;
  const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;
  // S2 (buildings read as their OWN building): a component bigger than the
  // lot's footprint is several buildings — chunk it into footprint-sized
  // pieces anchored at the component's top-left
  const fp = footprintOf(lot as Lot);
  const fits = (a: number, b: number): boolean => cw <= a && ch <= b;
  if (lot === Lot.Parking || lot === Lot.Park || fits(fp.w, fp.h) || fits(fp.h, fp.w) || (fp.alt && (fits(fp.alt.w, fp.alt.h) || fits(fp.alt.h, fp.alt.w)))) {
    return { ax: cx0, ay: cy0, fw: cw, fh: ch };
  }
  // orient the footprint along the component's long axis
  const long = Math.max(fp.w, fp.h), short = Math.min(fp.w, fp.h);
  const pw = cw >= ch ? long : short;
  const ph = cw >= ch ? short : long;
  const ix = Math.floor((tx - cx0) / pw), iy = Math.floor((ty - cy0) / ph);
  const ax = cx0 + ix * pw, ay = cy0 + iy * ph;
  return { ax, ay, fw: Math.min(pw, cx1 - ax + 1), fh: Math.min(ph, cy1 - ay + 1) };
}

/** Reusable facade canvas (presentation scratch — never sim state). */
const FBUF: Array<RGB | null> = new Array(64 * 64).fill(null);

function drawFacade(
  w: World,
  lot: number,
  ax: number,
  ay: number,
  fw0: number,
  fh0: number,
  clip: Put,
): void {
  // ORIENTATION: the building is authored facing SOUTH on a canvas whose
  // width runs along its street (L) and height into the lot (D), then
  // composed onto the footprint for its real frontage (see composeFacade)
  const facing = lotFrontage(w, ax, ay, fw0, fh0);
  const o = facing < 0 ? 0 : facing;
  const fw = o <= 1 ? fw0 : fh0;
  const fh = o <= 1 ? fh0 : fw0;
  const W = fw * TILE_PX;
  const H = fh * TILE_PX;
  const AX = ax * TILE_PX;
  const AY = ay * TILE_PX;
  const seed = ay * w.width + ax;
  for (let i = 0; i < W * H; i++) FBUF[i] = null;
  // local put in canvas coords; the outer ring stays ground (territory read)
  const p = (x: number, y: number, c: RGB): void => {
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
    FBUF[y * W + x] = c;
  };
  /** first row of the front wall face (below the roof band) */
  let faceTop = -1;
  /** whole-plan flip (no roof/face split), e.g. the paved gas station */
  let planFlip = false;
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
    if (RS.season === "winter") lawnBase = hexToRgb("#dfe7ee");
    else if (RS.season === "fall") lawnBase = hexToRgb("#8a8b54");
    else if (RS.season === "spring") lawnBase = hexToRgb("#4c9c28");
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
    p(x, y, lit && isLitHour() ? C.windowLit : C.windowDark);
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

    case Lot.Church: {
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
        faceTop = by0 + 6;
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
      faceTop = roofY + 2;
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

    case Lot.Warehouse: {
      faceTop = by0 + 3;
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
  if (faceTop < 0) faceTop = Math.min(by1, by0 + 2);
  composeFacade(FBUF, W, H, o, by0, faceTop, by1, bx0, bx1, body, planFlip, AX, AY, fw0 * TILE_PX, fh0 * TILE_PX, clip);
}

/**
 * Town institutions (Lot enum): flat-roofed civic/commercial boxes with
 * district variety. Multi-tile structures merge — shared edges drop their
 * walls so a 2×2 school reads as one building.
 */
export function drawLotBuilding(
  w: World,
  t: number,
  tx: number,
  ty: number,
  x0: number,
  y0: number,
  lot: number,
  put: Put,
): void {
  // Stage-2 set pieces: one composition across the whole footprint
  if (lot === Lot.Courthouse || lot === Lot.Track || lot === Lot.BallField) {
    const { ax, ay, fw, fh } = lotRect(w, tx, ty, lot);
    if (lot === Lot.Track) drawTrack(w, ax, ay, fw, fh, x0, y0, put);
    else if (lot === Lot.BallField) drawBallField(ax, ay, fw, fh, x0, y0, put);
    else {
      const clip: Put = (gx, gy, c) => {
        if (gx >= x0 && gx < x0 + TILE_PX && gy >= y0 && gy < y0 + TILE_PX) put(gx, gy, c);
      };
      drawCourthouse(w, ax, ay, fw, fh, clip);
    }
    return;
  }
  // the lighthouse's pad out at the end of its jetty: open water round it
  if (lot === Lot.Lighthouse && w.terrain[t] !== Terrain.Lake && standsInWater(w, tx, ty)) {
    seaFill(w, t, tx, ty, put, RS.tick);
  }
  // water-works lots on a land tile (a jetty root, a dam abutment)
  if (lot === Lot.Jetty || lot === Lot.Dam) {
    drawWaterLot(w, t, tx, ty, put, RS.tick);
    return;
  }
  // plan-kit lots (render/registry.ts): one composed building / compound
  // over the whole footprint, authored once in frontage-local space
  const author = PLANNED[lot];
  if (author) {
    const { ax, ay, fw, fh } = lotRect(w, tx, ty, lot);
    drawPlanned(w, lot, ax, ay, fw, fh, x0, y0, put, author);
    return;
  }
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
  if (lot === Lot.Shop) {
    // 1×2 shop: storefront on the street tile, its back room behind it
    const back = shopFrontOf(w, t);
    castShadow(x0, y0, put);
    if (back) drawBackRoom(w, t, back[0], back[1], x0, y0, put);
    else drawStorefront(w, t, x0, y0, put);
    return;
  }
  if (lot === Lot.Dock) {
    drawDock(w, t, x0, y0, put); // the pier runs on over the water tile (grounds.ts)
    return;
  }
  if (lot === Lot.Parking) {
    drawParkingTile(w, t, tx, ty, x0, y0, put);
    return;
  }
  if (lot === Lot.Park) {
    const r = parkRect(w, t);
    drawPark(w, t, tx, ty, x0, y0, put, r.ax, r.ay, r.fw, r.fh);
    return;
  }

  const [body, roof, accent] = LOT_STYLE[lot] ?? LOT_STYLE[Lot.Shop]!;
  // merge only within this building's footprint chunk (lotRect)
  const ch = lotRect(w, tx, ty, lot);
  const sameLeft = tx > ch.ax;
  const sameRight = tx < ch.ax + ch.fw - 1;
  const sameUp = ty > ch.ay;
  const sameDown = ty < ch.ay + ch.fh - 1;

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
    case Lot.Silo: {
      // Grain Silo: silver domed roof cap + corrugated metal cylinder
      const domeCap = hexToRgb("#d0d8dc");
      const domeGlint = hexToRgb("#ffffff");
      put(x0 + 3, y0, domeGlint);
      put(x0 + 4, y0, domeCap);
      put(x0 + 2, y0 + 1, domeCap);
      put(x0 + 5, y0 + 1, domeCap);
      break;
    }
    case Lot.Depot: {
      const brick = hexToRgb("#9e543b");
      const brickDark = hexToRgb("#773824");
      const wood = hexToRgb("#bfa168");
      const woodDark = hexToRgb("#8c7143");
      const bench = hexToRgb("#5e4125");
      const trim = hexToRgb("#eae4d2");
      const windowC = C.windowDark;
      const lantern = hexToRgb("#ffdd66");

      // Brick facade with corner quoin trim
      for (let py = 2; py <= 5; py++) {
        for (let px = 1; px <= 6; px++) {
          const isQuoin = (px === 1 || px === 6) && py % 2 === 0;
          put(x0 + px, y0 + py, isQuoin ? trim : (px % 2 === 0 ? brick : brickDark));
        }
      }
      // Overhanging hipped roof with eaves
      for (let px = 0; px < TILE_PX; px++) {
        put(x0 + px, y0 + 1, accent);
        put(x0 + px, y0 + 2, shade(accent, 0.72));
      }
      // Gabled dormer / station clock in roof center
      put(x0 + 3, y0, trim);
      put(x0 + 4, y0, trim);
      put(x0 + 3, y0 + 1, hexToRgb("#ffffff"));
      put(x0 + 4, y0 + 1, hexToRgb("#1c1c1c")); // clock hands

      // Windows with lintels and station lantern
      put(x0 + 2, y0 + 3, windowC);
      put(x0 + 5, y0 + 3, windowC);
      put(x0 + 2, y0 + 2, trim); // lintel
      put(x0 + 5, y0 + 2, trim);
      put(x0 + 3, y0 + 4, C.door);
      put(x0 + 4, y0 + 4, C.door);
      put(x0 + 4, y0 + 3, lantern); // warm station lantern

      // Weathered timber passenger platform
      for (let px = 0; px < TILE_PX; px++) {
        put(x0 + px, y0 + 6, px % 2 === 0 ? wood : woodDark);
        put(x0 + px, y0 + 7, px % 3 === 0 ? shade(woodDark, 0.75) : woodDark);
      }
      // Platform luggage cart & baggage crates on west side
      put(x0 + 1, y0 + 5, hexToRgb("#684e2a")); // crate
      put(x0 + 2, y0 + 5, hexToRgb("#8c6b3e")); // crate
      put(x0 + 1, y0 + 6, hexToRgb("#222222")); // iron wheel

      // Waiting bench on east side
      put(x0 + 5, y0 + 5, bench);
      put(x0 + 6, y0 + 5, bench);
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
  const cult = hexToRgb(playerColor(claim.owner));
  const gold = hexToRgb("#ffd700");
  const fireOrange = hexToRgb("#ff5500");
  const fireYellow = hexToRgb("#ffcc00");

  switch (claim.archetype) {
    case "dawn": {
      // Final Dawn: Blazing Bonfire, Sacred Effigy Totem & Ritual Stone Ring
      put(ax, ay + 2, C.trunk);
      put(ax, ay + 1, fireOrange);
      put(ax, ay, fireYellow);
      if (claim.stage >= 2) {
        put(ax + 1, ay + 1, fireOrange);
        put(ax - 1, ay + 2, C.rock); // ritual stone ring
        put(ax + 1, ay + 2, C.rock);
      }
      if (claim.stage >= 3) {
        put(ax, ay - 1 < y0 ? y0 : ay - 1, gold); // golden sun emblem on effigy top
      }
      break;
    }
    case "radiant": {
      // Radiant Path: Geodesic Dome, Wellness Canopy & Crystal Energy Spire
      const glassCyan = hexToRgb("#40e0ff");
      const violetTent = hexToRgb("#a040ff");
      put(ax, ay + 1, glassCyan);
      put(ax + 1, ay + 1, glassCyan);
      put(ax, ay, shade(glassCyan, 0.85));
      put(ax + 1, ay, shade(glassCyan, 0.85));
      if (claim.stage >= 2) {
        put(ax + 2, ay + 1, violetTent); // wellness canopy
        put(ax + 2, ay, cult);
      }
      if (claim.stage >= 3) {
        put(ax, ay - 1 < y0 ? y0 : ay - 1, [255, 255, 255]); // energy spire glint
        put(ax + 1, ay - 1 < y0 ? y0 : ay - 1, glassCyan);
      }
      break;
    }
    case "circle": {
      // Prosperity Circle: Executive Billboard, MLM Chart & Gold Coin Vault
      put(ax, ay, cult);
      put(ax + 1, ay, gold); // $ gold symbol
      put(ax + 2, ay, cult);
      put(ax, ay + 1, C.trunk);
      put(ax + 2, ay + 1, C.trunk);
      if (claim.stage >= 2) {
        put(ax + 1, ay + 1, hexToRgb("#d4af37")); // MLM chart board
      }
      if (claim.stage >= 3) {
        put(ax + 1, ay + 2 > y0 + 7 ? y0 + 7 : ay + 2, gold); // gold coin stack
        put(ax + 2, ay + 2 > y0 + 7 ? y0 + 7 : ay + 2, gold);
      }
      break;
    }
    case "visitors": {
      // The Visitors: Crop Circle, Saucer Beam & Levitating Pod Disc
      const limeBiolum = hexToRgb("#39ff14");
      const cyanBeam = hexToRgb("#9bf6ff");
      put(ax, ay + 1, limeBiolum);
      put(ax + 2, ay + 1, limeBiolum);
      put(ax + 1, ay, limeBiolum);
      put(ax + 1, ay + 2 > y0 + 7 ? y0 + 7 : ay + 2, limeBiolum);
      if (claim.stage >= 2) {
        put(ax + 1, ay + 1, cyanBeam);
      }
      if (claim.stage >= 3) {
        put(ax + 1, ay - 1 < y0 ? y0 : ay - 1, hexToRgb("#e0ffff")); // levitating saucer disc
        put(ax, ay - 1 < y0 ? y0 : ay - 1, cyanBeam);
        put(ax + 2, ay - 1 < y0 ? y0 : ay - 1, cyanBeam);
      }
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
export function drawVerge(
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

export function drawTrailerHome(
  x0: number,
  y0: number,
  t: number,
  put: Put,
  detail: Detail | null = null,
): void {
  castShadow(x0, y0, put);
  const trailerLit = RS.time === "night" && pixHash(t, 42) % 10 < 7;
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
  // Twin white propane cylinders by the hitch end
  const propX = flip ? 7 : 0;
  put(x0 + propX, y0 + 5, hexToRgb("#e4e8ec")); // cylinder cap
  put(x0 + propX, y0 + 6, hexToRgb("#a0a8b0")); // cylinder tank

  // awning + porch chair + junk dressing for trailer fringe
  const awnCol = [hexToRgb("#bf3f3f"), hexToRgb("#3f7fbf"), hexToRgb("#bf9f3f")][pixHash(t, 3) % 3]!;
  put(x0 + doorX - 1, y0 + 3, awnCol);
  put(x0 + doorX, y0 + 3, awnCol);
  put(x0 + doorX + 1, y0 + 3, awnCol);
  // Lawn folding chair on trailer porch
  put(x0 + (flip ? doorX - 2 : doorX + 2), y0 + 6, hexToRgb("#3acfe8"));

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
function drawIcon(bitmap: string[], tile: number, width: number, body: RGB, put: Put, accentCol: RGB = C.iconAccent): void {
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
          put(x0 + px, y0 + py, accentCol);
          break;
      }
    }
  }
}

/**
 * 16×16 Cult Asset (2×2 tiles) renderer with pulsing atmospheric glow.
 */
export function drawCultAsset16(
  bitmap: string[],
  tile: number,
  mapWidth: number,
  body: RGB,
  put: Put,
  accentCol: RGB = C.iconAccent,
  tick: number = 0,
  glow: boolean = true,
): void {
  const x0 = (tile % mapWidth) * TILE_PX;
  const y0 = ((tile / mapWidth) | 0) * TILE_PX;

  // 1. Realistic atmospheric gradient glow around the 16×16 perimeter with low opacity
  if (glow) {
    const pulse = 1.0 + 0.18 * Math.sin((tick + tile * 7) * 0.14);
    const maxRadius = 4.2;

    for (let py = -4; py <= 19; py++) {
      for (let px = -4; px <= 19; px++) {
        // Skip inside building bounding box
        if (px >= 0 && px < 16 && py >= 0 && py < 16) continue;

        const dx = px < 0 ? -px : px >= 16 ? px - 15 : 0;
        const dy = py < 0 ? -py : py >= 16 ? py - 15 : 0;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= maxRadius) {
          // Soft realistic low-opacity gradient glow (peak alpha <= 0.28)
          const norm = 1.0 - dist / maxRadius;
          const alpha = Math.min(0.28, Math.pow(norm, 2.0) * 0.28 * pulse);
          // Tint toward owner body color with subtle illumination
          const glowCol: RGB = [
            Math.min(255, Math.round(body[0] * 1.15 + 20)),
            Math.min(255, Math.round(body[1] * 1.15 + 20)),
            Math.min(255, Math.round(body[2] * 1.15 + 20)),
          ];
          // Blend with underlying background
          const bgCol = C.meadow;
          const blended: RGB = [
            Math.round(bgCol[0] * (1 - alpha) + glowCol[0] * alpha),
            Math.round(bgCol[1] * (1 - alpha) + glowCol[1] * alpha),
            Math.round(bgCol[2] * (1 - alpha) + glowCol[2] * alpha),
          ];
          put(x0 + px, y0 + py, blended);
        }
      }
    }
  }

  // 2. 16×16 Pixel Art
  const highlight = shade(body, 1.4);
  const shadow = shade(body, 0.45);
  const trimColor = shade(body, 0.78);
  const whiteGlint: RGB = [255, 255, 255];

  for (let py = 0; py < 16; py++) {
    const row = bitmap[py] ?? "................";
    for (let px = 0; px < 16; px++) {
      const ch = row[px];
      if (!ch || ch === ".") continue;
      switch (ch) {
        case "#":
          put(x0 + px, y0 + py, C.iconDark);
          break;
        case "o":
          put(x0 + px, y0 + py, body);
          break;
        case "O":
          put(x0 + px, y0 + py, highlight);
          break;
        case "x":
          put(x0 + px, y0 + py, trimColor);
          break;
        case "*":
          put(x0 + px, y0 + py, accentCol);
          break;
        case "+":
          put(x0 + px, y0 + py, whiteGlint);
          break;
        case "-":
          put(x0 + px, y0 + py, shadow);
          break;
      }
    }
  }
}

/**
 * Grey shore rock outcrops with tiered boulders, quartz glints, and stone shadows.
 */
export function drawRockOutcrop(x0: number, y0: number, put: Put, rockVar = 0): void {
  const quartz = hexToRgb("#f4f6f8"); // Bright quartz glint
  const shoreMid = hexToRgb("#a8b0b5"); // Shore granite mid-tone
  if (rockVar === 1) {
    // Tiered shore boulder formation with quartz vein
    put(x0 + 2, y0 + 4, C.rock);
    put(x0 + 3, y0 + 3, quartz);
    put(x0 + 4, y0 + 3, C.rock);
    put(x0 + 3, y0 + 4, shoreMid);
    put(x0 + 4, y0 + 4, shoreMid);
    put(x0 + 5, y0 + 4, C.rockShade);
    put(x0 + 3, y0 + 5, C.rockShade);
    put(x0 + 4, y0 + 5, C.shadow);
  } else if (rockVar === 2) {
    // Twin jagged shore stones
    put(x0 + 1, y0 + 4, C.rock);
    put(x0 + 2, y0 + 4, shoreMid);
    put(x0 + 2, y0 + 5, C.rockShade);
    put(x0 + 4, y0 + 3, quartz);
    put(x0 + 5, y0 + 4, C.rock);
    put(x0 + 5, y0 + 5, C.rockShade);
    put(x0 + 6, y0 + 5, C.shadow);
  } else {
    // Broad flat shore ledge shelf
    put(x0 + 2, y0 + 3, C.rock);
    put(x0 + 3, y0 + 3, quartz);
    put(x0 + 4, y0 + 3, C.rock);
    put(x0 + 2, y0 + 4, shoreMid);
    put(x0 + 3, y0 + 4, shoreMid);
    put(x0 + 4, y0 + 4, shoreMid);
    put(x0 + 5, y0 + 4, C.rockShade);
    put(x0 + 3, y0 + 5, C.rockShade);
    put(x0 + 4, y0 + 5, C.shadow);
  }
}

/**
 * Wild leafy bramble brush thickets with sunlit sprigs and crimson berries.
 */
export function drawBrushPocket(x0: number, y0: number, put: Put, bushVar = 0): void {
  const leafLight = hexToRgb("#7ca84c"); // Sunlit leaf sprig
  const leafDark = hexToRgb("#344e26"); // Shaded bramble interior
  // berries only on a late-summer bramble now and then — no red confetti
  const berry = RS.season === "summer" && ((x0 ^ y0) & 24) === 24 ? hexToRgb("#a83a32") : leafDark;
  if (bushVar === 1) {
    put(x0 + 2, y0 + 4, leafLight);
    put(x0 + 3, y0 + 4, C.bush);
    put(x0 + 4, y0 + 4, berry);
    put(x0 + 2, y0 + 5, C.bush);
    put(x0 + 3, y0 + 5, leafDark);
    put(x0 + 4, y0 + 5, C.bush);
    put(x0 + 3, y0 + 6, shade(C.bush, 0.82));
  } else {
    put(x0 + 1, y0 + 4, C.bush);
    put(x0 + 2, y0 + 4, leafLight);
    put(x0 + 3, y0 + 4, berry);
    put(x0 + 2, y0 + 5, C.bush);
    put(x0 + 3, y0 + 5, leafDark);
    put(x0 + 4, y0 + 5, leafLight);
    put(x0 + 2, y0 + 6, shade(C.bush, 0.82));
    put(x0 + 3, y0 + 6, shade(C.bush, 0.82));
  }
}

/**
 * Standalone country tree with wooden trunk, spreading leafy crown, and cast shadow.
 */
export function drawCountryTree(
  x0: number,
  y0: number,
  put: Put,
  treeVar = 0,
  season = "summer",
): void {
  put(x0 + 4, y0 + 5, C.shadow); // cast shadow
  put(x0 + 5, y0 + 5, C.shadow);

  let cBase = C.canopy;
  let cLight = C.canopyLight;
  let cDark = C.canopyDark;
  if (treeVar === 3 && season === "fall") {
    cBase = hexToRgb("#d97b25");
    cLight = hexToRgb("#eba33d");
    cDark = hexToRgb("#bd5b1b");
  } else if (treeVar === 4) {
    put(x0 + 3, y0 + 3, C.trunk);
    put(x0 + 4, y0 + 3, C.trunk);
    put(x0 + 4, y0 + 4, C.trunk);
    put(x0 + 3, y0 + 4, C.trunk);
    return;
  }

  if (treeVar === 1) {
    // Taller pine shape
    put(x0 + 3, y0 + 1, cLight);
    put(x0 + 3, y0 + 2, cLight);
    put(x0 + 3, y0 + 3, cBase);
    put(x0 + 4, y0 + 3, cBase);
    put(x0 + 2, y0 + 4, cDark);
    put(x0 + 3, y0 + 4, cBase);
    put(x0 + 4, y0 + 4, cDark);
    put(x0 + 3, y0 + 5, C.trunk);
  } else if (treeVar === 2) {
    // Shrubby round tree
    put(x0 + 2, y0 + 2, cLight);
    put(x0 + 3, y0 + 2, cLight);
    put(x0 + 4, y0 + 2, cLight);
    put(x0 + 2, y0 + 3, cLight);
    put(x0 + 3, y0 + 3, cBase);
    put(x0 + 4, y0 + 3, cLight);
    put(x0 + 2, y0 + 4, cDark);
    put(x0 + 3, y0 + 4, cBase);
    put(x0 + 4, y0 + 4, cDark);
    put(x0 + 5, y0 + 4, cDark);
    put(x0 + 3, y0 + 5, C.trunk);
  } else {
    // Spreading country oak with prominent wooden trunk
    put(x0 + 3, y0 + 1, cLight);
    put(x0 + 4, y0 + 1, cLight);
    put(x0 + 2, y0 + 2, cLight);
    put(x0 + 3, y0 + 2, cBase);
    put(x0 + 4, y0 + 2, cLight);
    put(x0 + 5, y0 + 2, cLight);
    put(x0 + 2, y0 + 3, cDark);
    put(x0 + 3, y0 + 3, cBase);
    put(x0 + 4, y0 + 3, cLight);
    put(x0 + 5, y0 + 3, cDark);
    put(x0 + 3, y0 + 4, cDark);
    put(x0 + 4, y0 + 4, cDark);
    put(x0 + 3, y0 + 5, C.trunk);
    put(x0 + 4, y0 + 5, C.trunk);
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
  if (isHouseTile(w, t)) {
    const hs = homeCarSpot(w, t);
    if (hs) return hs;
  }
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

const ROUTE_KIT = {
  build: (w: World, a: number, b: number, ax: number, ay: number, bx: number, by: number): Leg[] => buildRoute(w, a, b, ax, ay, bx, by),
  point: (legs: Leg[], d: number, driving: boolean) => routePoint(legs, d, driving),
  len: (legs: Leg[]) => routeLen(legs),
};

function routeLen(legs: Leg[]): number {
  let n = 0;
  for (const leg of legs) n += leg.len;
  return n;
}

/**
 * A person: 2×2 high-contrast figure — bright head, body, soft shadow — so
 * dots read against asphalt, lawn, and sand alike. `vivid` marks CULT
 * members: a white beacon head (which also glows through the night mask)
 * and a boosted body, so every believer and their car is instantly
 * spottable — the conversion read is gameplay, not decoration.
 */
function putPerson(px: number, py: number, color: RGB, put: Put, vivid = false): void {
  if (vivid) {
    put(px, py - 1, hexToRgb("#ffffff")); // beacon head
    put(px, py, shade(color, 1.3));
    put(px + 1, py, color);
    put(px + 1, py + 1, C.shadow);
    return;
  }
  put(px, py - 1, SKIN); // a skin-tone head reads against lawn AND asphalt
  put(px, py, color); // body
  put(px + 1, py, shade(color, 0.72)); // shaded side
  // STEPPING: at lod ≥ 2 the legs/shadow pixel alternates sides as they walk
  const stepL = RS.lod >= 2 && ((RS.tick + px + py) >> 2) & 1;
  put(stepL ? px : px + 1, py + 1, C.shadow);
}
const SKIN = hexToRgb("#d8a880");

/**
 * Fleet car at a putCar-convention centre (E–W: px−1..px+1 × py..py+1;
 * N–S: px..px+1 × py−1..py+1). Cult cars keep their kind but wear the
 * cult colour with a hot roof, so converts stay spottable.
 */
function putFleetCar(
  px: number,
  py: number,
  color: RGB,
  dx: number,
  dy: number,
  put: Put,
  vivid: boolean,
  kind: VehicleKind,
): void {
  const dir = dirOf(dx, dy);
  // centre along the heading (3- and 4-long kinds alike)
  const len = vehicleSize(kind, 0).w;
  const x = dir < 2 ? px - ((len - 1) >> 1) : px;
  const y = dir < 2 ? py : py - ((len - 1) >> 1);
  drawVehicle(put, kind, x, y, dir, vivid ? shade(color, 1.15) : color);
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
        : hexToRgb(playerColor(owner));
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
      const carColor = owner === NEUTRAL ? householdPaint(seed) : color;
      const carKind = householdVehicle(seed);
      const putCar = (px2: number, py2: number, col: RGB, dx2: number, dy2: number, _put: Put, vivid: boolean): void =>
        putFleetCar(px2, py2, col, dx2, dy2, put, vivid, carKind);
      const homeCar = (): void => {
        if (i === 0 && ownsCar) {
          const dv = drivewayPoint(w, t, homeX, homeY);
          putCar(dv.px, dv.py, carColor, dv.dx, dv.dy, put, owner !== NEUTRAL);
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
          putPerson(homeX, homeY, color, put, owner !== NEUTRAL);
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
            putCar(bayX, bayY, carColor, 0, -1, put, owner !== NEUTRAL); // nose-in at its bay
            const lot = w.lot[dest]!;
            if (!(OUTDOOR_LOTS.has(lot) || w.landmark[dest] !== 0)) continue;
            px = destX + (((tick >> 3) + i) % 3) - 1;
            py = destY - (((tick >> 4) + i) % 3);
            putPerson(px, py, color, put, owner !== NEUTRAL);
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
            putCar(dv.px, dv.py, carColor, dv.dx, dv.dy, put, owner !== NEUTRAL);
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
            putCar(pt.px, pt.py, carColor, hdx, hdy, put, owner !== NEUTRAL);
          } else if (et < tDrive + tWalk) {
            const pt = routePoint(walkLegs, (et - tDrive) * WALK_SPEED, false);
            putPerson(pt.px, pt.py, color, put, owner !== NEUTRAL);
          } else {
            // arrived: car in its bay; the person only if the lot is outdoor
            putCar(bayX, bayY, carColor, 0, -1, put, owner !== NEUTRAL);
            const lot = w.lot[dest]!;
            if (OUTDOOR_LOTS.has(lot) || w.landmark[dest] !== 0) {
              putPerson(destX, destY, color, put, owner !== NEUTRAL);
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

      putPerson(px, py, color, put, owner !== NEUTRAL);
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
    const color = hexToRgb(playerColor(p.id));
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
          putPerson(pt.px, pt.py, color, put, true);
        }
      } else {
        // on the ground: the column works its block
        for (let k = 0; k < 3; k++) {
          const h = pixHash(c.target, k + ci * 7, 99);
          const px2 = dstX + ((h + (tick >> 4)) % 5) - 2;
          const py2 = dstY - ((h >> 4) % 3);
          putPerson(px2, py2, color, put, true);
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
  // Tithe Courier — a walker with a golden money satchel
  courier: ["..#...", ".#o#..", ".#o#**", "##oo**", ".#o#..", ".#.#.."],
  // Recruitment Van — generic fallback
  van: ["s####s", "#w#ww#", "#oooo#", "oooooo", "s#ss#s", "..ss.."],
  // Agent — generic fallback
  agent: ["..##..", ".#oo#.", ".#oo#.", ".#oo#.", ".s##s.", "......"],
  // Street Prophet pylon — a speaker on a post, radiating
  pylon: ["*#oo#*", "#oooo#", "*#oo#*", "..##..", "..##..", ".s##s."],
  // CPA picket — a protester holding a sign
  picket: ["####..", "#oo#.o", "####.o", "...#oo", "...oo.", "..s.s."],
} as const;

/** Faction-specific Recruitment Vans (§30). */
const VAN_SPRITES: Record<Archetype, string[]> = {
  // Final Dawn: Armored ram-van with roof megaphone horns and hazard skirt
  dawn: [
    "*####*", // Roof megaphones
    "#w#ww#", // Reinforced ballistic glass
    "#oooo#", // Matte-black armor body
    "oooooo", // Hazard stripe skirt
    "s#ss#s", // Offroad treads / heavy dual wheels
    "..ss..",
  ],
  // Radiant Path: VW-style camper van with herbal drying racks
  radiant: [
    ".****.", // Roof rack of drying herbs
    "#wwww#", // Panoramic tinted glass
    "#oooo#", // Pastel sage/cream curved body
    "oooooo", // Wooden trim skirt
    "s#ss#s", // Light rolling wheels
    "..ss..",
  ],
  // Prosperity Circle: Glossy executive sprinter van with tinted privacy glass & chrome trim
  circle: [
    "s####s", // Aerodynamic roof rail
    "#wwww#", // Dark executive privacy glass
    "#oooo#", // Glossy midnight navy body
    "**oo**", // Chrome / gold trim runner
    "s#ss#s", // Polished alloy wheels
    "..ss..",
  ],
  // Visitors' Fellowship: Retro chrome van with rooftop rotating antenna dish
  visitors: [
    "..**..", // Rotating antenna dish
    ".*##*.", // Science telemetry mount
    "#wwww#", // Visor glass windshield
    "#oooo#", // Curved silver fuselage
    "s*ss*s", // Glowing cyan hubcaps
    "..ss..",
  ],
};

const VAN_COLORS: Record<Archetype, RGB> = {
  dawn: hexToRgb("#2b1110"), // Obsidian Black
  radiant: hexToRgb("#e8ecd8"), // Pastel Linen Cream
  circle: hexToRgb("#0e1a2f"), // Midnight Navy
  visitors: hexToRgb("#dcdcdc"), // Chrome Silver
};

/** Faction-specific Agents (§30). */
const AGENT_SPRITES: Record<Archetype, string[]> = {
  // Final Dawn: Red-hooded stealth figure with concealed dagger
  dawn: [
    "..**..", // Crimson peaked cowl hood
    ".#oo#.", // Masked face
    ".#oo#.", // Dark armored tunic
    ".#oo#.", // Dagger sheath
    ".s##s.", // Stalking combat boots
    "......",
  ],
  // Radiant Path: Robed barefoot figure carrying botanical specimen pouch
  radiant: [
    "..##..", // Hair / linen headwrap
    ".#oo#.", // Calm serene face
    ".#oo#*", // Flowing sage robe + herb satchel
    ".#oo#.", // Long linen skirt
    "..##..", // Barefoot
    "......",
  ],
  // Prosperity Circle: Sharp dark suit executive carrying leather briefcase
  circle: [
    "..##..", // Slicked hair
    ".#oo#.", // Sharp collar & tie
    ".#oo#*", // Midnight blazer + brass briefcase
    ".#oo#.", // Slacks
    ".s##s.", // Polished oxford shoes
    "......",
  ],
  // Visitors' Fellowship: Retro astronaut in silver space-jumpsuit with cyan visor
  visitors: [
    "..**..", // Bubble helmet dome
    ".*ww*.", // Glowing cyan communication visor
    ".#oo#.", // Pressurized silver jumpsuit
    ".#oo#.", // Life support pack
    ".s##s.", // Magnetic moon boots
    "......",
  ],
};

const AGENT_COLORS: Record<Archetype, RGB> = {
  dawn: hexToRgb("#b82e1f"), // Molten Crimson Hood
  radiant: hexToRgb("#7aa364"), // Botanical Sage
  circle: hexToRgb("#c5a059"), // Executive Gold Trim / Dark Suit
  visitors: hexToRgb("#00f0ff"), // Electric Cyan Visor / Chrome
};

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
      col = shade(hexToRgb(playerColor(o)), pulse);
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
  for (const v of sim.vans) {
    const pl = sim.players.find((p) => p.id === v.player);
    const arch: Archetype = (pl?.archetype as Archetype) ?? "dawn";
    const bmp = VAN_SPRITES[arch] ?? UNIT_SPRITES.van;
    const col = skinAccent(v.player) ?? VAN_COLORS[arch] ?? hexToRgb("#eef0ff");
    drawMover(v.path, v.idx, v.moveProgress, v.tile, bmp, col);
  }
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
      const pl = sim.players.find((p) => p.id === a.player);
      const arch: Archetype = (pl?.archetype as Archetype) ?? "dawn";
      const bmp = AGENT_SPRITES[arch] ?? UNIT_SPRITES.agent;
      const col = AGENT_COLORS[arch] ?? hexToRgb("#33354d");
      const [x, y] = tilePx(a.tile);
      sprite(x + 4, y + 4, bmp, col);
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
