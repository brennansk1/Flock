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
} from "./types.js";
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
  [Landmark.RadioTower]: ICONS.broadcast_tower,
  [Landmark.Megachurch]: ICONS.compound,
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

export interface RenderOpts {
  /** viewing player for fog + own-agent markers; 0 = omniscient (spectator) */
  viewer?: number;
  /** precomputed fog (1 = visible) or null for no fog */
  fog?: Uint8Array | null;
  /** animation clock; pass sim.tick */
  frameTick?: number;
}

export interface RenderedFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function renderTown(sim: SimState, opts: RenderOpts = {}): RenderedFrame {
  const w = sim.world;
  const W = w.width * TILE_PX;
  const H = w.height * TILE_PX;
  const data = new Uint8ClampedArray(W * H * 4);
  const tick = opts.frameTick ?? sim.tick;
  const fog = opts.fog ?? null;

  const archetypeOf = new Map<number, Archetype>();
  for (const p of sim.players) archetypeOf.set(p.id, p.archetype);

  const put = (gx: number, gy: number, rgb: RGB): void => {
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) return;
    const o = (gy * W + gx) * 4;
    data[o] = rgb[0];
    data[o + 1] = rgb[1];
    data[o + 2] = rgb[2];
    data[o + 3] = 255;
  };

  // ---- pass 1: ground + lots ----
  for (let ty = 0; ty < w.height; ty++) {
    for (let tx = 0; tx < w.width; tx++) {
      const t = ty * w.width + tx;
      drawTile(sim, t, tx, ty, put, archetypeOf);
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
  }

  // ---- pass 3: the people ----
  drawResidents(sim, tick, fog, put);
  drawUnits(sim, opts.viewer ?? 0, fog, put);

  // ---- pass 4: fog dimming ----
  if (fog) {
    for (let ty = 0; ty < w.height; ty++) {
      for (let tx = 0; tx < w.width; tx++) {
        if (fog[ty * w.width + tx] === 1) continue;
        for (let py = 0; py < TILE_PX; py++) {
          for (let px = 0; px < TILE_PX; px++) {
            const o = ((ty * TILE_PX + py) * W + tx * TILE_PX + px) * 4;
            data[o] = (data[o]! * 96) >> 8;
            data[o + 1] = (data[o + 1]! * 96) >> 8;
            data[o + 2] = (data[o + 2]! * 96) >> 8;
          }
        }
      }
    }
  }

  return { data, width: W, height: H };
}

// ---------------------------------------------------------------- tiles

type Put = (gx: number, gy: number, rgb: RGB) => void;

function drawTile(
  sim: SimState,
  t: number,
  tx: number,
  ty: number,
  put: Put,
  archetypeOf: Map<number, Archetype>,
): void {
  const w = sim.world;
  const x0 = tx * TILE_PX;
  const y0 = ty * TILE_PX;

  switch (w.terrain[t]) {
    case Terrain.Road: {
      const vRoad = ty > 0 && w.terrain[t - w.width] === Terrain.Road && ty < w.height - 1;
      // a road tile beside another horizontal road row = the 2-lane HIGHWAY
      const highway =
        (ty > 0 && w.terrain[t - w.width] === Terrain.Road &&
          tx > 0 && w.terrain[t - 1] === Terrain.Road &&
          tx < w.width - 1 && w.terrain[t + 1] === Terrain.Road) ||
        (ty < w.height - 1 && w.terrain[t + w.width] === Terrain.Road &&
          tx > 0 && w.terrain[t - 1] === Terrain.Road &&
          tx < w.width - 1 && w.terrain[t + 1] === Terrain.Road);
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          let c: RGB = highway ? shade(C.asphalt, 0.85) : C.asphalt;
          const edge = vRoad ? px === 0 || px === TILE_PX - 1 : py === 0 || py === TILE_PX - 1;
          if (edge) c = C.sidewalk;
          if (highway) {
            // yellow centerline along the seam between the two lanes
            const seamBelow = ty < w.height - 1 && w.terrain[t + w.width] === Terrain.Road;
            if (seamBelow && py === TILE_PX - 1 && (tx * TILE_PX + px) % 8 < 5) c = C.highwayLine;
          } else if (vRoad && px === TILE_PX / 2 && (ty * TILE_PX + py) % 6 < 3) {
            c = C.asphaltDash;
          } else if (!vRoad && py === TILE_PX / 2 && (tx * TILE_PX + px) % 6 < 3) {
            c = C.asphaltDash;
          }
          put(x0 + px, y0 + py, c);
        }
      }
      return;
    }
    case Terrain.Grass: {
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const gx = x0 + px;
          const gy = y0 + py;
          const h = pixHash(gx, gy, 5);
          const c = h % 17 === 0 ? C.scrub : h % 7 === 0 ? C.meadowLight : C.meadow;
          put(gx, gy, c);
        }
      }
      return;
    }
    case Terrain.Field: {
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const row = (ty * TILE_PX + py) % 3 === 0;
          put(x0 + px, y0 + py, row ? C.cropRow : C.cropGold);
        }
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
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const ripple = (ty * TILE_PX + py + ((tx * TILE_PX + px) >> 2)) % 7 === 0;
          put(x0 + px, y0 + py, ripple ? C.waterRipple : C.waterDeep);
        }
      }
      return;
    }
    case Terrain.Woods: {
      // Wilderness slowly becomes a cult compound (the fun part): woods near a
      // growing cult clear out and grow archetype-flavored assets — Dawn lights
      // bonfires, Radiant raises domes, the Circle paves and posts billboards,
      // the Visitors press crop circles. Intensity scales with the cult's size.
      const claim = woodsClaim(sim, t, tx, ty);
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const h = pixHash(tx * TILE_PX + px, ty * TILE_PX + py);
          let c = h % 7 === 0 ? C.canopyLight : h % 13 === 0 ? C.trunk : C.canopy;
          if (claim && h % 5 < claim.stage) c = shade(C.canopyLight, 1.15); // clearing
          put(x0 + px, y0 + py, c);
        }
      }
      if (claim) drawCompoundAssets(sim, claim, t, x0, y0, put);
      return;
    }
  }

  // citizen lot: lawn base, owned tint + pattern, then house/garden
  const owner = w.owner[t]!;
  const apostate = w.state[t] === TileState.Apostate;
  const lawnBase = hexToRgb(NEUTRAL_BY_DISTRICT[w.district[t]! % NEUTRAL_BY_DISTRICT.length]!);

  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      const gx = x0 + px;
      const gy = y0 + py;
      let c: RGB;
      if (apostate) {
        c = (gx + gy) % 3 === 0 ? shade(C.scorched, 1.2) : C.scorched;
      } else if (owner !== NEUTRAL) {
        const cult = hexToRgb(colorForPlayer(owner));
        // lawn tinted halfway to the cult color, with the archetype pattern
        const mixed: RGB = [
          (lawnBase[0] + cult[0]) >> 1,
          (lawnBase[1] + cult[1]) >> 1,
          (lawnBase[2] + cult[2]) >> 1,
        ];
        c =
          owner >= 900
            ? shade(mixed, 0.9)
            : territoryPixel(mixed, archetypeOf.get(owner) ?? "dawn", gx, gy);
      } else {
        c = (gx * 7 + gy * 13) % 11 === 0 ? shade(lawnBase, 0.94) : lawnBase;
      }
      put(gx, gy, c);
    }
  }

  if (apostate) return;
  const pop = w.pop[t]!;
  const district = w.district[t]!;
  const lot = w.lot[t]!;

  if (lot !== 0) {
    drawLotBuilding(w, t, tx, ty, x0, y0, lot, put);
  } else if (pop >= 8 && district === 3) {
    drawBlock(x0, y0, t, put); // downtown apartment block
  } else if (pop >= 3) {
    drawHouse(x0, y0, district, t, put);
  } else if (pop >= 1) {
    // garden: a few flowers
    for (let i = 0; i < 3; i++) {
      const h = pixHash(t, i, 7);
      put(x0 + 1 + (h % 6), y0 + 1 + ((h >> 4) % 6), shade(lawnBase, 0.8));
    }
  }
}

/**
 * Town institutions (Lot enum): flat-roofed civic/commercial boxes with
 * district variety. Multi-tile structures merge — shared edges drop their
 * walls so a 2×2 school reads as one building.
 */
function drawLotBuilding(
  w: { width: number; height: number; lot: Uint8Array },
  t: number,
  tx: number,
  ty: number,
  x0: number,
  y0: number,
  lot: number,
  put: Put,
): void {
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

  const [body, roof, accent] = LOT_STYLE[lot] ?? LOT_STYLE[Lot.Shop]!;
  const sameLeft = tx > 0 && w.lot[t - 1] === lot;
  const sameRight = tx < w.width - 1 && w.lot[t + 1] === lot;
  const sameUp = ty > 0 && w.lot[t - w.width] === lot;
  const sameDown = ty < w.height - 1 && w.lot[t + w.width] === lot;

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
    case Lot.Office:
      for (let wy = 2; wy <= 5; wy += 2) {
        for (let wx = 2; wx <= 5; wx += 2) {
          put(x0 + wx, y0 + wy, pixHash(t, wx + wy) % 2 ? accent : C.windowDark);
        }
      }
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

/** family house: roof, wall, door — roof color by district. */
function drawHouse(x0: number, y0: number, district: number, t: number, put: Put): void {
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
  const doorX = flip ? 2 : 5;
  put(x0 + doorX, y0 + 5, C.door);
  put(x0 + doorX, y0 + 6, C.door);
  put(x0 + (flip ? 4 : 2), y0 + 5, C.windowDark);
}

/** downtown block: tall footprint with lit windows. */
function drawBlock(x0: number, y0: number, t: number, put: Put): void {
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

function drawUnits(sim: SimState, viewer: number, fog: Uint8Array | null, put: Put): void {
  const w = sim.world;
  const mark = (t: number, rgb: RGB, big = false): void => {
    const x = (t % w.width) * TILE_PX + 3;
    const y = ((t / w.width) | 0) * TILE_PX + 3;
    put(x, y, rgb);
    put(x + 1, y, rgb);
    put(x, y + 1, rgb);
    put(x + 1, y + 1, rgb);
    if (big) {
      put(x - 1, y, shade(rgb, 0.7));
      put(x + 2, y, shade(rgb, 0.7));
      put(x, y - 1, shade(rgb, 0.7));
      put(x, y + 2, shade(rgb, 0.7));
    }
  };
  const visible = (t: number): boolean => !fog || fog[t] === 1;

  for (const c of sim.couriers) {
    const t = c.path[c.idx]!;
    if (visible(t)) mark(t, hexToRgb("#ffd700"));
  }
  for (const v of sim.vans) if (visible(v.tile)) mark(v.tile, hexToRgb("#f8f8ff"), true);
  for (const py of sim.pylons) if (visible(py.tile)) mark(py.tile, hexToRgb("#ff5555"), true);
  for (const pk of sim.pickets) if (visible(pk.tile)) mark(pk.tile, hexToRgb("#ff66ff"), true);
  for (const a of sim.agents) {
    if (a.player === viewer && a.phase !== "travel") mark(a.tile, hexToRgb("#222233"));
  }
}
