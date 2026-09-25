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
  [Lot.Courthouse]: { w: 3, h: 3, alt: { w: 3, h: 2 }, real: "~45 m county courthouse + clock cupola; the square is its whole block, remainder lawn" },
  [Lot.Shop]: { w: 1, h: 2, alt: { w: 1, h: 1 }, real: "25 ft storefront, 100 ft deep: sales floor + back room to the rear lot" },
  [Lot.Diner]: { w: 2, h: 1, alt: { w: 1, h: 1 }, real: "~20 m chrome diner car + counter annex" },
  [Lot.Bank]: { w: 2, h: 2, alt: { w: 2, h: 1 }, real: "columned bank + drive-up teller lane, ~25 m" },
  [Lot.PostOffice]: { w: 2, h: 2, alt: { w: 2, h: 1 }, real: "brick federal post office + loading dock, ~30 m" },
  [Lot.Office]: { w: 2, h: 2, alt: { w: 2, h: 1 }, real: "2–3 storey office block, ~30 m" },
  [Lot.Cinema]: { w: 2, h: 2, alt: { w: 2, h: 1 }, real: "single-screen theatre with marquee, ~30 m" },
  [Lot.Supermarket]: { w: 3, h: 2, alt: { w: 2, h: 2 }, real: "~45×30 m grocery box (+ its customer lot)" },
  [Lot.Sheriff]: { w: 2, h: 1, real: "sheriff's office + cruiser apron" },
  [Lot.FireStation]: { w: 2, h: 2, alt: { w: 2, h: 1 }, real: "2-bay firehouse + apron" },
  [Lot.GasStation]: { w: 2, h: 2, alt: { w: 2, h: 1 }, real: "pole sign, canopy over 2 pump islands, service bays, ~30 m" },
  [Lot.Motel]: { w: 3, h: 1, alt: { w: 2, h: 1 }, real: "12-room strip motel, ~45 m" },
  [Lot.Parking]: { w: 2, h: 1, real: "~12 stalls; rear lots fill block interiors" },
  // ---- Civic / residential / campus ----
  [Lot.HighSchool]: { w: 4, h: 2, alt: { w: 3, h: 2 }, real: "red-brick 1-storey HS w/ ribbon windows + gym wing, ~120×60 m compressed" },
  [Lot.Track]: { w: 6, h: 4, alt: { w: 5, h: 3 }, real: "football field + cinder track + bleachers (compressed 50%)" },
  [Lot.School]: { w: 3, h: 2, alt: { w: 2, h: 2 }, real: "elementary school, ~45×30 m (+ playground)" },
  [Lot.Library]: { w: 2, h: 2, alt: { w: 2, h: 1 }, real: "Carnegie-style library, ~25 m" },
  [Lot.Church]: { w: 2, h: 2, real: "steepled church (+ churchyard + lot)" },
  [Lot.Chapel]: { w: 1, h: 2, alt: { w: 1, h: 1 }, real: "clapboard chapel, ~10×25 m" },
  [Lot.Cemetery]: { w: 2, h: 2, alt: { w: 2, h: 1 }, real: "churchyard rows" },
  [Lot.Park]: { w: 2, h: 2, alt: { w: 1, h: 1 }, real: "pocket park / square lawn" },
  [Lot.Playground]: { w: 1, h: 2, alt: { w: 1, h: 1 }, real: "swings + slide + jungle gym" },
  [Lot.BallField]: { w: 2, h: 2, real: "little-league diamond" },
  // ---- Industrial / rail ----
  [Lot.Factory]: { w: 3, h: 2, alt: { w: 2, h: 2 }, real: "saw-tooth works, ~45×30 m" },
  [Lot.Warehouse]: { w: 2, h: 2, real: "loading-dock warehouse" },
  [Lot.GrainElevator]: { w: 3, h: 2, alt: { w: 2, h: 2 }, real: "concrete elevator head house + silo row along the siding (compressed)" },
  [Lot.Depot]: { w: 2, h: 1, real: "timber depot + platform on the siding" },
  [Lot.Sawmill]: { w: 3, h: 2, alt: { w: 2, h: 2 }, real: "mill shed + saw line (+ dirt log yard)" },
  [Lot.Cannery]: { w: 3, h: 2, alt: { w: 2, h: 2 }, real: "harbor cannery shed + ice house" },
  [Lot.Substation]: { w: 2, h: 2, alt: { w: 1, h: 1 }, real: "fenced transformer yard, ~30 m" },
  [Lot.WaterTower]: { w: 2, h: 2, alt: { w: 1, h: 1 }, real: "elevated tank on legs in a fenced lot (the town's name painted on it)" },
  // ---- Rural / waterfront ----
  [Lot.Barn]: { w: 2, h: 1, alt: { w: 1, h: 1 }, real: "red gambrel barn, ~30×15 m" },
  [Lot.Silo]: { w: 1, h: 1, real: "farm silo" },
  [Lot.Greenhouse]: { w: 2, h: 1, alt: { w: 1, h: 1 }, real: "hoop house, ~30×10 m" },
  [Lot.Dock]: { w: 1, h: 1, real: "one dock segment; piers chain N segments" },
  [Lot.Lighthouse]: { w: 2, h: 1, alt: { w: 1, h: 1 }, real: "lighthouse tower + keeper's cottage" },
  [Lot.Dam]: { w: 1, h: 1, real: "one weir segment across the channel" },
  // ---- Landmark compounds (the Landmark id stays on ONE anchor tile) ----
  [Lot.Megachurch]: { w: 4, h: 3, alt: { w: 3, h: 3 }, real: "the old megachurch: sanctuary + fellowship hall + bell tower, ~60×45 m" },
  [Lot.Fairground]: { w: 6, h: 5, alt: { w: 5, h: 4 }, real: "county fairground: grandstand + dirt oval, midway rides, ferris wheel, exhibition barns (compressed)" },
  [Lot.RadioTower]: { w: 3, h: 3, real: "AM mast with guy wires anchored across the lot + transmitter shack" },
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
