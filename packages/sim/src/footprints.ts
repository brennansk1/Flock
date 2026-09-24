/**
 * Asset footprint scale (Stage 2) — the single source of truth for how many
 * tiles every town asset occupies. Mapgen stamps these footprints; the
 * renderer draws each multi-tile lot as ONE building across the footprint;
 * the linters check placed lots against it.
 *
 * SCALE: 1 tile ≈ 15 m (50 ft) — one single-family lot frontage, the unit a
 * 1980s Midwest plat is drawn in. A standard block is 6 tiles road-to-road
 * (5×5 buildable + street), i.e. ~300 ft, exactly the classic small-town
 * block. At 8 px/tile a car (~4.5 m) is ~3 px long and a person 1 px.
 *
 * Real sizes are kept for small and medium buildings. Big facilities (the
 * high-school stadium, the grain elevator complex, farm parcels) are
 * COMPRESSED to ~50% so they read as landmarks without swallowing the
 * playable town — the same convention SimCity-era top-down games used.
 *
 * Orientation: `w × h` is the footprint with its street frontage on the
 * long side; mapgen may rotate it 90° to face a N/S street.
 */
import { Lot } from "./types.js";

export interface Footprint {
  /** Tiles along the street frontage. */
  w: number;
  /** Tiles deep from the street. */
  h: number;
  /** Acceptable alternative (small blocks / tight maps), same orientation rule. */
  alt?: { w: number; h: number };
  /** Real-world reference, for the art and for reviewers. */
  real: string;
}

export const FOOTPRINTS: Partial<Record<Lot, Footprint>> = {
  // ---- Downtown / Main Street ----
  [Lot.Courthouse]: { w: 3, h: 3, alt: { w: 3, h: 2 }, real: "~45 m square county courthouse + clock cupola; the square is its whole 5×5 block, remainder lawn (Park)" },
  [Lot.Shop]: { w: 1, h: 1, real: "two 25 ft storefronts under one awning run" },
  [Lot.Diner]: { w: 1, h: 1, real: "~15 m chrome diner car" },
  [Lot.Bank]: { w: 1, h: 1, real: "columned 1-storey bank" },
  [Lot.PostOffice]: { w: 1, h: 1, real: "brick post office" },
  [Lot.Office]: { w: 2, h: 1, real: "2-storey office block, ~30 m frontage" },
  [Lot.Cinema]: { w: 2, h: 2, alt: { w: 2, h: 1 }, real: "single-screen theatre with marquee, ~30 m" },
  [Lot.Supermarket]: { w: 2, h: 2, real: "~30 m grocery box (+ its 2×1 lot)" },
  [Lot.Sheriff]: { w: 2, h: 1, real: "sheriff's office + cruiser apron" },
  [Lot.FireStation]: { w: 2, h: 2, alt: { w: 2, h: 1 }, real: "2-bay firehouse + apron" },
  [Lot.GasStation]: { w: 2, h: 1, real: "canopy + 2 pump islands + kiosk" },
  [Lot.Motel]: { w: 3, h: 1, alt: { w: 2, h: 1 }, real: "12-room strip motel, ~45 m" },
  [Lot.Parking]: { w: 2, h: 1, real: "~12 stalls; bus lot 2×1, rear lots fill block interiors" },
  // ---- Civic / residential / campus ----
  [Lot.HighSchool]: { w: 3, h: 2, real: "red-brick 1-storey HS w/ ribbon windows, ~80×50 m compressed" },
  [Lot.Track]: { w: 6, h: 4, alt: { w: 5, h: 3 }, real: "football field + cinder track + bleachers (400 m track = 12×6 real, compressed 50%)" },
  [Lot.School]: { w: 2, h: 2, real: "elementary school (+ 1×2 playground)" },
  [Lot.Library]: { w: 1, h: 1, real: "Carnegie-style library" },
  [Lot.Church]: { w: 2, h: 2, real: "steepled church (+ 2×1 cemetery)" },
  [Lot.Chapel]: { w: 1, h: 1, real: "small clapboard chapel" },
  [Lot.Cemetery]: { w: 2, h: 1, alt: { w: 2, h: 2 }, real: "churchyard rows" },
  [Lot.Park]: { w: 2, h: 2, alt: { w: 1, h: 1 }, real: "pocket park / square lawn" },
  [Lot.Playground]: { w: 1, h: 2, alt: { w: 1, h: 1 }, real: "swings + slide + jungle gym" },
  [Lot.BallField]: { w: 2, h: 2, real: "little-league diamond (the HS football field lives inside Track)" },
  // ---- Industrial / rail ----
  [Lot.Factory]: { w: 3, h: 2, alt: { w: 2, h: 2 }, real: "saw-tooth works" },
  [Lot.Warehouse]: { w: 2, h: 2, real: "loading-dock warehouse" },
  [Lot.GrainElevator]: { w: 2, h: 2, real: "concrete elevator + silo row (compressed)" },
  [Lot.Depot]: { w: 2, h: 1, real: "timber depot + platform on the siding" },
  [Lot.Sawmill]: { w: 2, h: 2, real: "mill shed (+ dirt log yard)" },
  [Lot.Cannery]: { w: 2, h: 2, real: "harbor cannery shed" },
  [Lot.Substation]: { w: 1, h: 1, real: "fenced transformer yard" },
  [Lot.WaterTower]: { w: 1, h: 1, real: "tank on legs" },
  // ---- Rural / waterfront ----
  [Lot.Barn]: { w: 1, h: 1, real: "red gambrel barn" },
  [Lot.Silo]: { w: 1, h: 1, real: "farm silo" },
  [Lot.Greenhouse]: { w: 1, h: 1, real: "hoop house" },
  [Lot.Dock]: { w: 1, h: 1, real: "one dock segment; piers chain N segments" },
  [Lot.Lighthouse]: { w: 1, h: 1, real: "lighthouse + keeper's cottage" },
  [Lot.Dam]: { w: 1, h: 1, real: "one weir segment across the channel" },
};

/** Non-lot scale references (renderer sprite sizes, in 8-px-tile pixels). */
export const SPRITE_SCALE = {
  /** single-family house: 1 tile lot; the house itself ~6×5 px, drive + yard fill the rest */
  house: "1 tile",
  /** block: 6 tiles road-to-road (5×5 buildable) */
  block: "6 tiles",
  /** car / wagon / Blazer / pickup: 3×2 px (E–W) · 2×3 px (N–S) */
  car: "3x2 px",
  /** police cruiser: car + 1 px bubble-light bar */
  cruiser: "3x2 px + lightbar",
  /** school bus ~12 m: 6×2 px */
  bus: "6x2 px",
  /** BMX + rider: 2×1 px */
  bmx: "2x1 px",
  /** person: 1×1 px (2 px tall when walking at lod ≥ 2) */
  person: "1x1 px",
  /** farm parcel: 6×6 tiles (compressed) */
  field: "6x6 tiles",
} as const;

/** Footprint for a lot, or 1×1 when unlisted. */
export function footprintOf(lot: Lot): Footprint {
  return FOOTPRINTS[lot] ?? { w: 1, h: 1, real: "1 tile" };
}
