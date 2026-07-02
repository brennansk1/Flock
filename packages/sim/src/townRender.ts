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
  compound: [
    "...##...",
    "...##...",
    ".######.",
    "...##...",
    ".######.",
    ".#o##o#.",
    ".#o##o#.",
    ".######.",
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
  watchtower: [
    ".######.",
    ".#o##o#.",
    ".######.",
    "..#oo#..",
    "..#oo#..",
    "..#oo#..",
    ".######.",
    ".######.",
  ],
  broadcast_tower: [
    "*..##..*",
    ".*.##.*.",
    "..###...",
    "...##...",
    "...##...",
    "..####..",
    ".##oo##.",
    ".######.",
  ],
  hotline_center: [
    "........",
    ".##..##.",
    ".#o##o#.",
    "..####..",
    "...##...",
    "..####..",
    ".######.",
    "........",
  ],
  print_shop: [
    "........",
    ".######.",
    ".#oooo#.",
    ".#o##o#.",
    ".#oooo#.",
    ".#o##o#.",
    ".######.",
    "..*..*..",
  ],
  garage: [
    "........",
    ".######.",
    ".#oooo#.",
    ".######.",
    ".#o##o#.",
    ".######.",
    "..#..#..",
    "........",
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

const C = {
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
  personNeutral: hexToRgb("#4a4440"),
  scorched: hexToRgb(COLOR_APOSTATE),
  waterDeep: hexToRgb("#33506e"),
  waterRipple: hexToRgb("#456c92"),
  canopy: hexToRgb("#3a5a30"),
  canopyLight: hexToRgb("#4f7440"),
  trunk: hexToRgb("#4a3a26"),
  meadow: hexToRgb("#a7b07c"),
  meadowLight: hexToRgb("#b4bd87"),
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
  grassHigh: hexToRgb("#b6bd84"),
  grassLow: hexToRgb("#9aa372"),
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
} as const;

/** Town building styles: [body, roof, accent]. */
const LOT_STYLE: Record<number, [RGB, RGB, RGB]> = {
  [Lot.Shop]: [hexToRgb("#cbb89a"), hexToRgb("#8c8c8c"), hexToRgb("#c8554a")],
  [Lot.Supermarket]: [hexToRgb("#d8d2c4"), hexToRgb("#b8b2a4"), hexToRgb("#3f7fbf")],
  [Lot.Diner]: [hexToRgb("#d7d7dc"), hexToRgb("#a9a9b4"), hexToRgb("#d23b3b")],
  [Lot.School]: [hexToRgb("#b0563f"), hexToRgb("#8c4030"), hexToRgb("#f0e6d0")],
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
  [Lot.HighSchool]: [hexToRgb("#9a5a42"), hexToRgb("#7a4634"), hexToRgb("#f0e6d0")],
  [Lot.Warehouse]: [hexToRgb("#aaa49a"), hexToRgb("#8a847a"), hexToRgb("#5f6670")],
  [Lot.Greenhouse]: [hexToRgb("#cfe8e2"), hexToRgb("#8fb0a8"), hexToRgb("#efe9da")],
};

/** roof palettes by district */
const ROOFS: RGB[] = [
  hexToRgb("#8a7a6a"), // none
  hexToRgb("#a4543e"), // suburbs — terracotta
  hexToRgb("#7a4e3a"), // college — brick
  hexToRgb("#5f6670"), // downtown — slate
  hexToRgb("#54483a"), // old town — weathered shake
  hexToRgb("#9c9489"), // trailer — tin
];

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
    for (let sy = 0; sy < S; sy++) {
      let o = ((by + sy) * W + bx) * 4;
      for (let sx = 0; sx < S; sx++) {
        data[o] = rgb[0];
        data[o + 1] = rgb[1];
        data[o + 2] = rgb[2];
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
    data[o] = rgb[0];
    data[o + 1] = rgb[1];
    data[o + 2] = rgb[2];
    data[o + 3] = 255;
  };
  const detail: Detail | null = S >= 2 ? { S, putF } : null;

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
  drawUnits(sim, opts.viewer ?? 0, fog, put);

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
    const tr = w.terrain[nty * w.width + ntx]!;
    if (tr !== Terrain.Woods && tr !== Terrain.Lake) return;
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
        return;
      }

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
          let c: RGB = highway ? shade(C.asphalt, 0.92) : C.asphalt;
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
            if (skirtN || skirtS || skirtW || skirtE) c = C.sidewalk;
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
          put(x0 + px, y0 + py, c);
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
      // TRAFFIC: cars run the roads — a pure (position, tick) hash, so every
      // client sees the same cars. Highways carry more; two directions ride
      // the two sides of the roadway.
      {
        const carC = [hexToRgb("#7088b0"), hexToRgb("#b06a60"), hexToRgb("#d8d2c4"), hexToRgb("#5a7340")];
        const tick2 = frameTick >> 1;
        const drawCar = (cx2: number, cy2: number, horiz2: boolean, col: RGB): void => {
          put(cx2, cy2, col);
          put(horiz2 ? cx2 + 1 : cx2, horiz2 ? cy2 : cy2 + 1, shade(col, 0.8));
        };
        const spacing = highway ? 22 : 44;
        if (roadE || roadW) {
          // eastbound on the lower half, westbound on the upper
          const posE = (tx * TILE_PX + tick2) % (spacing * TILE_PX);
          if (posE < TILE_PX && pixHash(ty, 1, 83) % 3 !== 0) {
            drawCar(x0 + posE, y0 + 5, true, carC[pixHash(ty, posE >> 3, 84) % 4]!);
          }
          const posW = (tx * TILE_PX - tick2 + spacing * TILE_PX * 8) % (spacing * TILE_PX);
          if (posW < TILE_PX && pixHash(ty, 2, 83) % 3 === 0) {
            drawCar(x0 + posW, y0 + 2, true, carC[pixHash(ty, posW >> 3, 85) % 4]!);
          }
        } else if (roadN || roadS) {
          const posS = (ty * TILE_PX + tick2) % (spacing * TILE_PX);
          if (posS < TILE_PX && pixHash(tx, 3, 83) % 3 === 0) {
            drawCar(x0 + 5, y0 + posS, false, carC[pixHash(tx, posS >> 3, 86) % 4]!);
          }
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
      return;
    }
    case Terrain.Pasture: {
      // fenced pasture: worn meadow, perimeter fence, a couple of cattle
      const fN = ty > 0 && w.terrain[t - w.width] !== Terrain.Pasture;
      const fS = ty < w.height - 1 && w.terrain[t + w.width] !== Terrain.Pasture;
      const fW = tx > 0 && w.terrain[t - 1] !== Terrain.Pasture;
      const fE = tx < w.width - 1 && w.terrain[t + 1] !== Terrain.Pasture;
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          let c: RGB = pixHash(x0 + px, y0 + py, 15) % 11 === 0 ? C.grassLow : C.meadow;
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
      if (pixHash(t, 8, 27) % 3 === 0) {
        const hx = x0 + 2 + (pixHash(t, 9, 27) % 4);
        const hy = y0 + 2 + (pixHash(t, 10, 27) % 4);
        const c = pixHash(t, 11, 27) % 2 === 0 ? C.cowWhite : C.cowBrown;
        put(hx, hy, c); // the cow
        put(hx + 1, hy, c);
        put(hx + 1, hy + 1, shade(c, 0.7));
      }
      return;
    }
    case Terrain.Grass: {
      // DESERT biome: the same rolling land, reskinned as sand and scrub
      if (w.biome[t] === 1 /* Biome.Desert */) {
        for (let py = 0; py < TILE_PX; py++) {
          for (let px = 0; px < TILE_PX; px++) {
            const gx = x0 + px;
            const gy = y0 + py;
            const h = pixHash(gx, gy, 65);
            let c: RGB = h % 3 === 0 ? C.sandDark : C.sandBg;
            if (valueNoise(gx, gy, 30, 66) > 0.68) c = shade(C.sandBg, 1.05); // dune crest
            if (h % 31 === 0) c = C.sandScrub; // dry brush
            const bleed = naturalEdgeBleed(w, tx, ty, px, py);
            if (bleed) c = bleed;
            put(gx, gy, c);
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
      const eC = elevAt(x0, y0);
      const eE = elevAt(x0 + TILE_PX, y0);
      const slope = eE - eC; // >0 means rising to the east → west face in shade
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const gx = x0 + px;
          const gy = y0 + py;
          const h = pixHash(gx, gy, 5);
          const elev = elevAt(gx, gy);
          const cell = pixHash(gx >> 3, gy >> 3, 13) % 3;
          let c = cell === 0 ? C.meadowLight : C.meadow;
          if (w.biome[t] === 2 /* Biome.Forest */) c = cell === 0 ? C.forestFloor : shade(C.forestFloor, 0.92);
          if (elev > 0.7) c = C.grassHigh; // hilltops catch the light
          else if (elev < 0.3) c = C.grassLow; // hollows sit in shade
          if (slope > 0.06 && px < 2) c = shade(c, 0.94); // west-facing bank
          if (h % 19 === 0) c = C.scrub;
          if (h % 211 === 0) c = C.flowerY;
          else if (h % 223 === 0) c = C.flowerW;
          // woods/lake spill a ragged sub-tile edge into this grass pixel
          const bleed = naturalEdgeBleed(w, tx, ty, px, py);
          if (bleed) c = bleed;
          put(gx, gy, c);
        }
      }
      // sparse rock outcrops on the higher, drier ground
      if (eC > 0.62 && pixHash(t, 4, 23) % 17 === 0) {
        put(x0 + 3, y0 + 4, C.rock);
        put(x0 + 4, y0 + 4, C.rockShade);
        put(x0 + 3, y0 + 5, C.rockShade);
      }
      // scattered low brush, clustered by a coarse noise band (flora pockets)
      if (valueNoise(x0, y0, 22, 88) > 0.6 && pixHash(t, 7, 31) % 5 === 0) {
        put(x0 + 2, y0 + 5, C.bush);
        put(x0 + 3, y0 + 5, C.bush);
        put(x0 + 3, y0 + 6, shade(C.bush, 0.85)); // bottom-right shadow
      }
      // the occasional lone country tree — matched to town-tree scale, with a
      // soft bottom-right cast shadow for depth
      if (pixHash(t, 3, 19) % 37 === 0) {
        put(x0 + 4, y0 + 5, C.shadow); // cast shadow
        put(x0 + 5, y0 + 5, C.shadow);
        put(x0 + 3, y0 + 3, C.canopy);
        put(x0 + 4, y0 + 3, C.canopyLight);
        put(x0 + 3, y0 + 4, C.canopyDark);
        put(x0 + 4, y0 + 4, C.canopy);
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
        const runH = roadS && ruralVerge; // pole line north of the road
        const runV = roadE && !roadS && ruralVerge; // west of the road
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
      // CROP VARIETY: each parcel (coarse 6-tile cell) rolls its planting —
      // corn gold, soy green, pale wheat, or fallow brown
      const parcel = pixHash((tx / 6) | 0, (ty / 6) | 0, 97) % 4;
      const cropA =
        parcel === 0 ? C.cropGold : parcel === 1 ? hexToRgb("#8aa54e") : parcel === 2 ? hexToRgb("#d8c88e") : hexToRgb("#a08458");
      const cropB =
        parcel === 0 ? C.cropRow : parcel === 1 ? hexToRgb("#71893c") : parcel === 2 ? hexToRgb("#c2b076") : hexToRgb("#8a7048");
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const gy = ty * TILE_PX + py;
          const row = gy % 3 === 0;
          let c = row ? cropB : cropA;
          if (pixHash(tx * TILE_PX + px, gy, 41) % 31 === 0) c = shade(c, 1.12);
          // fence posts along the field boundary
          if ((fenceN && py === 0 && px % 3 === 0) || (fenceW && px === 0 && py % 3 === 0))
            c = C.fence;
          put(x0 + px, y0 + py, c);
        }
      }
      // HAY BALES dot the harvested (fallow) parcels
      if (parcel === 3 && pixHash(t, 6, 98) % 5 === 0) {
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
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const gx = x0 + px;
          const gy = y0 + py;
          const h = pixHash(gx, gy, 9);
          put(gx, gy, h % 6 === 0 ? C.dirtEdge : C.dirt);
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
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const sand =
            (shoreN && py === 0) || (shoreS && py === TILE_PX - 1) ||
            (shoreW && px === 0) || (shoreE && px === TILE_PX - 1);
          if (sand) {
            put(x0 + px, y0 + py, C.sand);
            continue;
          }
          const gx = tx * TILE_PX + px;
          const gy = ty * TILE_PX + py;
          const ripple = (gy + (gx >> 2)) % 7 === 0;
          const glint = pixHash(gx, gy, 31) % 41 === 0;
          put(x0 + px, y0 + py, glint ? C.waterGlint : ripple ? C.waterRipple : C.waterDeep);
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
        for (let py = 2; py <= 6; py++) put(cx1, y0 + py, C.cactus); // trunk
        put(cx1 - 1, y0 + 3, C.cactusDark); // west arm
        put(cx1 - 1, y0 + 2, C.cactus);
        put(cx1 + 1, y0 + 4, C.cactusDark); // east arm
        put(cx1 + 1, y0 + 3, C.cactus);
        put(cx1 + 1, y0 + 7, C.shadow);
        return;
      }
      // Wilderness slowly becomes a cult compound (the fun part): woods near a
      // growing cult clear out and grow archetype-flavored assets — Dawn lights
      // bonfires, Radiant raises domes, the Circle paves and posts billboards,
      // the Visitors press crop circles. Intensity scales with the cult's size.
      const claim = woodsClaim(sim, t, tx, ty);
      const edgeN = ty > 0 && w.terrain[t - w.width] !== Terrain.Woods;
      const edgeW = tx > 0 && w.terrain[t - 1] !== Terrain.Woods;
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const gx = tx * TILE_PX + px;
          const gy = ty * TILE_PX + py;
          const h = pixHash(gx, gy);
          // clumpy canopy: cell-noise blobs of light/dark green + trunk gaps
          const blob = pixHash(gx >> 2, gy >> 2, 77) % 5;
          let c = blob < 2 ? C.canopy : blob < 4 ? C.canopyDark : C.canopyLight;
          if (h % 23 === 0) c = C.trunk;
          // sunlit fringe on north/west edges
          if ((edgeN && py === 0) || (edgeW && px === 0)) c = C.canopyLight;
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
  const lawnBase = hexToRgb(NEUTRAL_BY_DISTRICT[district % NEUTRAL_BY_DISTRICT.length]!);
  const lawnDistrict = district === 1 || district === 2 || district === 4 || district === 0;
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
        put(x0 + px, y0, C.sidewalk);
        put(x0 + px, y0 + 1, px % 4 === 0 ? shade(C.sidewalk, 0.9) : C.sidewalk);
      }
      if (lit && tx % 4 === 1) {
        put(x0 + 1, y0 + 1, C.iconDark); // lamp post
        put(x0 + 1, y0, C.windowLit); // warm head
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
    drawBlock(x0, y0, t, put); // downtown/ResHigh apartment block
  } else if (pop >= 3) {
    drawVerge(w, t, tx, ty, x0, y0, district, put); // driveway/walk + street tree
    if (district === 5) drawTrailerHome(x0, y0, t, put); // trailer fringe (§2)
    else drawHouse(x0, y0, district, t, put, detail, frameTick);
  } else if (pop >= 1) {
    // BACKYARD LIFE (§2 rev. 4): block interiors are the town's backyards —
    // sheds, the odd above-ground pool, vegetable rows, and back fences
    // between neighbors. Variety by pure tile hash.
    const roll = pixHash(t, 4, 91) % 10;
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
    // asphalt apron with painted bays + a parked car or two
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        let c: RGB = C.asphalt;
        if (px % 3 === 1 && py >= 2 && py <= 6) c = C.asphaltDash; // bay stripes
        put(x0 + px, y0 + py, c);
      }
    }
    if (pixHash(t, 1, 44) % 2 === 0) {
      const cc = pixHash(t, 2, 44) % 3;
      const car = cc === 0 ? hexToRgb("#7088b0") : cc === 1 ? hexToRgb("#b06a60") : hexToRgb("#d8d2c4");
      put(x0 + 2, y0 + 3, car);
      put(x0 + 2, y0 + 4, shade(car, 0.85));
    }
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
      put(x0 + px, y0 + py, roofRow ? roof : body);
    }
  }

  // type-specific dressing
  switch (lot) {
    case Lot.Chapel:
      put(x0 + 3, y0, accent); // steeple
      put(x0 + 4, y0, accent);
      put(x0 + 3, y0 + 1, roof);
      put(x0 + 4, y0 + 1, roof);
      put(x0 + 3, y0 + 4, C.windowDark);
      break;
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
      break;
    case Lot.GasStation:
      put(x0 + 1, y0 + 6, accent); // pumps
      put(x0 + 3, y0 + 6, accent);
      break;
    case Lot.School:
      if (!sameLeft && !sameUp) {
        put(x0 + 1, y0, accent); // flagpole on the corner tile
        put(x0 + 1, y0 + 1, accent);
      }
      if (!sameUp) put(x0 + 4, y0 + 4, C.windowDark);
      break;
    case Lot.Diner:
      put(x0 + 2, y0 + 1, accent); // neon strip
      put(x0 + 3, y0 + 1, accent);
      put(x0 + 4, y0 + 1, accent);
      put(x0 + 5, y0 + 1, accent);
      break;
    case Lot.Supermarket:
      if (!sameLeft) {
        put(x0 + 2, y0 + 1, accent);
        put(x0 + 3, y0 + 1, accent);
      }
      put(x0 + 3, y0 + 5, C.windowDark);
      put(x0 + 4, y0 + 5, C.windowDark);
      break;
    case Lot.Sheriff:
      put(x0 + 3, y0 + 1, accent); // the star
      break;
    case Lot.Church:
      // steeple with a cross on the top (north) tile, arched window below
      if (!sameUp) {
        put(x0 + 3, y0, accent);
        put(x0 + 4, y0, accent);
        put(x0 + 3, y0 - 0, accent);
        put(x0 + 4, y0 + 1, roof);
        put(x0 + 3, y0 + 1, roof);
      }
      if (sameUp) {
        put(x0 + 3, y0 + 3, C.windowDark); // tall nave window
        put(x0 + 4, y0 + 3, C.windowDark);
      }
      break;
    case Lot.Bank:
      // columned facade
      put(x0 + 2, y0 + 2, accent);
      put(x0 + 4, y0 + 2, accent);
      put(x0 + 2, y0 + 3, accent);
      put(x0 + 4, y0 + 3, accent);
      put(x0 + 2, y0 + 4, accent);
      put(x0 + 4, y0 + 4, accent);
      break;
    case Lot.PostOffice:
      put(x0 + 2, y0 + 1, accent); // flag/sign stripe
      put(x0 + 3, y0 + 1, accent);
      put(x0 + 4, y0 + 5, C.windowDark);
      break;
    case Lot.FireStation:
      // big garage bays
      if (!sameLeft) {
        put(x0 + 2, y0 + 4, accent);
        put(x0 + 2, y0 + 5, accent);
        put(x0 + 4, y0 + 4, accent);
        put(x0 + 4, y0 + 5, accent);
      }
      break;
    case Lot.Factory:
      // smokestacks + sawtooth roof
      if (!sameUp && !sameLeft) {
        put(x0 + 1, y0, C.iconDark);
        put(x0 + 1, y0 + 1, accent);
      }
      put(x0 + 2, y0 + 2, accent);
      put(x0 + 4, y0 + 2, accent);
      break;
    case Lot.Motel:
      // row of unit doors under a long eave
      put(x0 + 2, y0 + 5, C.door);
      put(x0 + 5, y0 + 5, C.door);
      put(x0 + 2, y0 + 1, accent); // neon "VACANCY"
      put(x0 + 3, y0 + 1, accent);
      break;
    case Lot.Office:
      for (let wy = 2; wy <= 5; wy += 2) {
        for (let wx = 2; wx <= 5; wx += 2) {
          put(x0 + wx, y0 + wy, pixHash(t, wx + wy) % 2 ? accent : C.windowDark);
        }
      }
      break;
    case Lot.Cinema:
      // the marquee: a lit strip over the entrance with a star bill
      if (!sameLeft) {
        put(x0 + 1, y0 + 2, accent);
        put(x0 + 2, y0 + 2, accent);
        put(x0 + 3, y0 + 2, accent);
        put(x0 + 4, y0 + 2, accent);
        put(x0 + 5, y0 + 2, accent);
        put(x0 + 2, y0 + 3, C.crosswalk); // the poster bill
        put(x0 + 3, y0 + 5, C.door);
        put(x0 + 4, y0 + 5, C.door);
      } else {
        put(x0 + 2, y0 + 2, accent);
        put(x0 + 4, y0 + 2, accent);
        put(x0 + 3, y0 + 4, C.windowDark);
      }
      break;
    case Lot.HighSchool:
      // brick block with a gym wing stripe + the school sign
      if (!sameLeft && !sameUp) {
        put(x0 + 1, y0, accent); // flagpole
        put(x0 + 1, y0 + 1, accent);
      }
      if (!sameUp) {
        put(x0 + 3, y0 + 4, C.windowDark);
        put(x0 + 5, y0 + 4, C.windowDark);
      }
      if (sameUp) {
        put(x0 + 2, y0 + 3, accent); // the gym doors
        put(x0 + 3, y0 + 3, accent);
      }
      break;
    case Lot.Warehouse:
      // long shed: roll-up bay doors + a loading dock strip
      put(x0 + 2, y0 + 4, C.iconDark);
      put(x0 + 2, y0 + 5, C.iconDark);
      put(x0 + 5, y0 + 4, C.iconDark);
      put(x0 + 5, y0 + 5, C.iconDark);
      if (!sameDown) {
        put(x0 + 2, y0 + 6, C.asphalt);
        put(x0 + 3, y0 + 6, C.asphalt);
        put(x0 + 4, y0 + 6, C.asphalt);
      }
      break;
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
    default: {
      // shops: awning stripe over the door
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
  const west = tx > 0 && isRoad(t - 1);
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
): void {
  castShadow(x0, y0, put);
  const roof = ROOFS[district % ROOFS.length]!;
  const flip = pixHash(t, 1) & 1; // door left/right variety
  for (let px = 1; px <= 6; px++) {
    put(x0 + px, y0 + 2, shade(roof, 1.1));
    put(x0 + px, y0 + 3, roof);
  }
  put(x0 + 2, y0 + 1, shade(roof, 1.1));
  put(x0 + 3, y0 + 1, shade(roof, 1.1));
  put(x0 + 4, y0 + 1, shade(roof, 1.1));
  put(x0 + 5, y0 + 1, shade(roof, 1.1));
  for (let py = 4; py <= 6; py++) {
    for (let px = 1; px <= 6; px++) {
      put(x0 + px, y0 + py, py === 4 ? C.wallShade : C.wall);
    }
  }
  // a brick chimney pokes above the ridge on the side away from the door
  const chimX = flip ? 5 : 2;
  put(x0 + chimX, y0, shade(roof, 0.6));
  put(x0 + chimX, y0 + 1, shade(roof, 0.6));
  // CHIMNEY SMOKE: a lazy animated wisp on some homes (pure tick hash)
  if (frameTick > 0 && pixHash(t, 6, 59) % 3 === 0) {
    const phase = ((frameTick >> 3) + t) % 4;
    const sy = y0 - 1 - (phase >> 1);
    if (sy >= 0) put(x0 + chimX + (phase % 2), sy, hexToRgb("#c9c4bc"));
  }
  const doorX = flip ? 2 : 5;
  put(x0 + doorX, y0 + 5, C.door);
  put(x0 + doorX, y0 + 6, C.door);
  // a covered porch over the door on some homes (suburbs/old town reads cosy)
  if (pixHash(t, 5, 53) % 2 === 0) {
    put(x0 + doorX - 1, y0 + 4, C.wallShade);
    put(x0 + doorX, y0 + 4, C.wallShade);
    put(x0 + (flip ? doorX + 1 : doorX - 1), y0 + 6, C.door); // porch post
  }
  const winX = flip ? 4 : 2;
  put(x0 + winX, y0 + 5, C.windowDark);

  // ---- zoom-in detail: things that only resolve up close ----
  if (detail) {
    const S = detail.S;
    const f = detail.putF;
    // shingle courses across the roof (fine horizontal lines)
    const shingle = shade(roof, 0.82);
    for (let px = 1; px <= 6; px++) {
      const bx = (x0 + px) * S;
      f(bx, (y0 + 2) * S + Math.floor(S / 2), shingle);
      f(bx + Math.floor(S / 2), (y0 + 3) * S + S - 1, shingle);
    }
    // window mullions: a cross of frame color inside the window pixel
    const frame = shade(C.wall, 0.7);
    const wbx = (x0 + winX) * S;
    const wby = (y0 + 5) * S;
    for (let i = 0; i < S; i++) {
      f(wbx + Math.floor(S / 2), wby + i, frame); // vertical bar
      f(wbx + i, wby + Math.floor(S / 2), frame); // horizontal bar
    }
    // a glint in the lit corner
    f(wbx + 1, wby + 1, C.windowLit);
    // door knob
    f((x0 + doorX) * S + (flip ? S - 2 : 1), (y0 + 5) * S + Math.floor(S / 2), C.iconAccent);
  }
}

/**
 * Trailer-fringe home: a long low mobile home — tin roof strip, a hitch
 * tongue at one end, a little propane tank — instead of the gabled family
 * house. Gives the outskirts their own visual identity (§2 districts).
 */
function drawTrailerHome(x0: number, y0: number, t: number, put: Put): void {
  castShadow(x0, y0, put);
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
  put(x0 + winX, y0 + 4, C.windowDark);
  put(x0 + (flip ? 7 : 0), y0 + 6, C.rock); // propane tank by the hitch end
}

/** downtown block: tall footprint with lit windows. */
function drawBlock(x0: number, y0: number, t: number, put: Put): void {
  castShadow(x0, y0, put);
  for (let py = 0; py <= 6; py++) {
    for (let px = 1; px <= 6; px++) {
      put(x0 + px, y0 + py, py === 0 ? C.blockShade : C.block);
    }
  }
  for (let wy = 1; wy <= 5; wy += 2) {
    for (let wx = 2; wx <= 5; wx += 2) {
      const lit = pixHash(t, wx * 8 + wy) % 3 !== 0;
      put(x0 + wx, y0 + wy, lit ? C.windowLit : C.windowDark);
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
 * Residents as living dots. Each house tile renders ceil(pop/3) dots (≤4).
 * Every dot runs a personal day-cycle, a pure hash of (tile, dot, tick):
 *
 *   home ──walk──▶ destination ──linger──▶ walk home ──rest──▶ …
 *
 * Walking follows a Manhattan elbow (along the street grid feel). The
 * destination is the dot's nearest attractor — its cult's buildings draw the
 * congregation (the staffing mechanic made visible), landmarks and downtown
 * draw everyone else.
 */
function drawResidents(sim: SimState, tick: number, fog: Uint8Array | null, put: Put): void {
  const w = sim.world;

  // attractor list: cult buildings, landmarks, and the town's own institutions
  // (shops, the school, the diner…) — everyone runs errands.
  const attractors: { tile: number; owner: number }[] = [];
  for (const bd of sim.buildings) {
    if (bd.buildTicksLeft === 0) attractors.push({ tile: bd.tile, owner: bd.player });
  }
  for (let t = 0; t < w.landmark.length; t++) {
    if (w.landmark[t] !== 0) attractors.push({ tile: t, owner: 0 });
    else if (w.lot[t] !== 0 && w.lot[t] !== Lot.Barn && w.lot[t] !== Lot.Silo) {
      attractors.push({ tile: t, owner: 0 });
    }
  }

  const CYCLE = 360; // 36s day-cycle per dot, phase-shifted by hash

  for (let t = 0; t < w.pop.length; t++) {
    const pop = w.pop[t]!;
    if (pop === 0 || w.terrain[t] !== Terrain.Citizen) continue;
    if (w.state[t] === TileState.Apostate) continue;
    if (fog && fog[t] !== 1) continue;

    const owner = w.owner[t]!;
    const color =
      owner === NEUTRAL ? C.personNeutral : hexToRgb(colorForPlayer(owner));
    const hx = t % w.width;
    const hy = (t / w.width) | 0;
    const dots = Math.min(4, Math.ceil(pop / 3));

    for (let i = 0; i < dots; i++) {
      const seed = pixHash(t, i, 91);
      const phase = (tick + (seed % CYCLE)) % CYCLE;

      // home pixel anchor (front yard / sidewalk side)
      const homeX = hx * TILE_PX + 1 + (seed % 6);
      const homeY = hy * TILE_PX + 6 + ((seed >> 8) % 2);

      // destination: nearest attractor this dot cares about. Converts commute
      // to their cult's buildings (staffing made visible); the unconverted are
      // homebodies — only half go out, and only to somewhere close.
      const maxTrip = owner === NEUTRAL ? 10 : 40;
      const commuter = owner !== NEUTRAL || (seed & 1) === 0;
      const dest = commuter
        ? pickAttractor(attractors, w.width, hx, hy, owner, seed, maxTrip)
        : hy * w.width + hx;
      const destX = (dest % w.width) * TILE_PX + 2 + ((seed >> 12) % 4);
      const destY = ((dest / w.width) | 0) * TILE_PX + TILE_PX - 1; // gather at the door

      let px = homeX;
      let py = homeY;
      if (phase < 140) {
        // at home, idling around the yard
        px = homeX + (((tick >> 4) + i) % 3) - 1;
      } else if (phase < 200) {
        // commute out: Manhattan elbow, x first then y
        const f = (phase - 140) / 60;
        const elbow = f < 0.5 ? f * 2 : 1;
        const climb = f < 0.5 ? 0 : (f - 0.5) * 2;
        px = Math.round(homeX + (destX - homeX) * elbow);
        py = Math.round(homeY + (destY - homeY) * climb);
      } else if (phase < 300) {
        // at the destination: congregating (tiny shuffle)
        px = destX + (((tick >> 3) + i) % 2);
        py = destY;
      } else {
        // commute home: y first then x
        const f = (phase - 300) / 60;
        const drop = f < 0.5 ? f * 2 : 1;
        const back = f < 0.5 ? 0 : (f - 0.5) * 2;
        px = Math.round(destX + (homeX - destX) * back);
        py = Math.round(destY + (homeY - destY) * drop);
      }

      put(px, py, color);
      put(px + 1, py, shade(color, 0.8));
    }
  }
}

function pickAttractor(
  attractors: { tile: number; owner: number }[],
  width: number,
  hx: number,
  hy: number,
  owner: number,
  seed: number,
  maxTrip: number,
): number {
  let best = -1;
  let bestD = maxTrip * maxTrip; // won't walk farther than this
  let second = -1;
  for (const a of attractors) {
    // converts visit their own cult's buildings; everyone visits landmarks
    if (a.owner !== 0 && a.owner !== owner) continue;
    const dx = (a.tile % width) - hx;
    const dy = ((a.tile / width) | 0) - hy;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      second = best;
      bestD = d;
      best = a.tile;
    }
  }
  if (best < 0) return hy * width + hx; // nowhere to go: stroll the block
  // a third of dots prefer the second-nearest spot — streets feel busier
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
    if (a.player === viewer && a.phase !== "travel") {
      const [x, y] = tilePx(a.tile);
      sprite(x + 4, y + 4, UNIT_SPRITES.agent, hexToRgb("#33354d"));
    }
  }
}
