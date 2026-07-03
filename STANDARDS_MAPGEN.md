# MAPGEN STANDARDS — the target state for "that's a real town"

_The definition-of-done for map generation. Every subsystem below has a
**Standard** (what the finished thing looks like), **Acceptance criteria**
(measurable checks a coding agent can verify), a **Required assets** list
(including assets that do **not** exist yet), and **Fail flags** (what a
violation is tagged). Feed a numbered section to the goal command; the section
is satisfied only when every acceptance box is checkable against rendered
evidence._

**The one-line bar:** a rendered map must pass for an **aerial photo of a real
American town of its archetype** (farm, oceanside, desert, mountain, lakeside —
see §2A) — correct geography, complete infrastructure, and lived-in variety —
**within the 8px pixel idiom**. Judge generation and placement, never the pixel
style itself.

> ⚠️ **ASSETS.md is a partial ledger.** It lists what has been documented, not
> everything the town needs or everything the renderer already draws. Treat the
> **Required assets** lists here as the authority for what a finished town must
> contain. Where an asset is missing from both the map and ASSETS.md, it is
> still in scope — build it, then backfill ASSETS.md.

---

## 0. Ground rules (apply to every section)

**Files where fixes go:**
[`packages/sim/src/mapgen.ts`](packages/sim/src/mapgen.ts) (generation),
[`packages/sim/src/gridRoads.ts`](packages/sim/src/gridRoads.ts) (road net),
[`packages/sim/src/townRender.ts`](packages/sim/src/townRender.ts) (all pixels),
[`packages/sim/src/palette.ts`](packages/sim/src/palette.ts) (colors),
[`packages/sim/src/types.ts`](packages/sim/src/types.ts) (enums: `Terrain`,
`Biome`, `District`, `Landmark`, `Lot`). Companion QA protocol:
[QA_MAPGEN.md](QA_MAPGEN.md). Asset ledger: [ASSETS.md](ASSETS.md).

**Style contract (never violate, never "fix"):**
- Tile grid, **top-down**, **fixed 8 px/tile — a single level of detail.**
- **No zoom-dependent LOD tiers and no detail channel.** What the generator
  authors is exactly what renders at every zoom; zooming in just magnifies the
  same 8px pixels. There is no "up-close" pass that adds shingles, mullions, or
  ragged edges — every asset is complete in one render.
- Each asset must read as a clean **silhouette + a few colors at 8px**. If a
  feature can't be conveyed at 8px, it isn't drawn — pick a silhouette or a
  color that carries the meaning instead.
- All assets are **procedural**, drawn pixel-by-pixel in `townRender.ts`, shared
  bit-identically by the PixiJS client and every headless renderer.

**Evidence rule:** never assess from code. Render, then look with vision. Every
"done" claim cites a rendered artifact (full map + subject crop).

**Multi-seed rule:** a standard holds only if it holds across **≥5 seeds**
(11, 21, 42, 77, 99) at 96×96, **plus** one `biomes: []` world and one
`biomes: ["desert"]` world. Generation bugs hide in seed variance.

**Determinism is sacred:** every change keeps `npm test` green (77+ sim tests);
same seed ⇒ same map. Floors: ≥640 populated tiles, ≥2900 souls, road
orthogonality, keystone + rail presence, home frontage, farm share.

**Flag taxonomy (tag every finding):** `MISGEN` (generates wrongly — broken
shape/colors/artifacts) · `MISPLACED` (fine asset, impossible location) ·
`MISSING` (a real town shows this, we never generate it) · `MONOTONE` (exists
uniformly; realism needs variants) · `DENSITY` (right asset, wrong frequency).
**Severity:** **S1** — a structural break obvious at a glance (breaks the
aerial-photo illusion immediately) · **S2** — a flaw noticeable on close
inspection of a crop · **S3** — polish. A section is not "at standard" while any
S1/S2 remains open.

---

## 1. Terrain & elevation base

**Standard.** Open country is a continuous, subtly-varied rolling surface — no
visible grid, no banding, no tiling repeats. Elevation exists and *drives* the
rest of the map: water flows downhill, woods and floodplain sit low, the town
plats on the flatter/higher ground.

**Acceptance criteria**
- [x] Grass reads as one organic meadow: two-octave noise (light/shadow), scrub
      flecks, occasional flowers. **No lattice/grid artifact** visible at any
      zoom (`MISGEN` if a repeating seam appears).
- [ ] Elevation is a real field, not decorative: hydrology, forest, and town
      siting all reference it. Rivers run downhill end-to-end (monotonic drop);
      the lake sits in a local low; town avoids the steepest cells.
      _→ DEFERRED (B-node): needs a shared heightfield in `World`; today the
      river is monotonic by construction and the tint ramp is render-side._
- [x] Grass elevation tinting is **visible but subtle** — high ground slightly
      lighter/drier, lows slightly richer. Never a hard contour line.
- [x] Rock outcrops cluster on high ground only; brush pockets scatter with cast
      shadows. Neither tiles uniformly (`MONOTONE`).

**Required assets:** rolling grass (multi-octave), rock outcrops, brush pockets,
elevation tint ramp. **Fail flags:** visible grid/banding → `MISGEN`; flat
uniform green → `MONOTONE`.

---

## 2. Biomes & ecotones

**Standard.** Accent biomes (`Biome.Desert`, `Biome.Forest`, `Biome.Autumn`)
stamp as **organic blobs** over the temperate base and **grade** into it — no
biome ever meets grass on a hard edge. Each biome reskins ground, vegetation,
and water shore consistently.

**Acceptance criteria**
- [x] **Every** biome edge is a graded ecotone ≥3 tiles wide: desert
      (sand → scrub → grass), forest (dense → sparse → meadow), autumn (foliage
      fade). A hard biome boundary anywhere → `MISGEN`.
- [x] Desert interior: sparse saguaro stands, dune crests, dry scrub; **no
      crops, farms, or pasture inside** the desert blob (`MISPLACED` if any).
      Includes a sandy **dry-wash / dry-creek bed** cutting the blob.
- [x] Desert water: sand shores + green oasis margins with date palms near
      riverbanks. Forest water: darker forest-floor grass, grey gravel/stone
      shores. Temperate water: grey gravel shores + gallery willows.
- [x] Biome selection honors `MapOpts.biomes` deterministically; `biomes: []`
      yields a pure-temperate world that still passes §1.

**Required assets:** desert ground/dune/saguaro/scrub/dry-wash/oasis-palm;
forest floor/dense-stand; autumn foliage; 3-ring graded ecotone for each biome.
**Fail flags:** hard edge → `MISGEN`; crops in desert → `MISPLACED`; forest-edge
ungraded → `MISGEN` (known historical gap — verify closed).

---

## 2A. Town archetypes & world types

**Standard.** The generator produces recognizably **different kinds of town** —
not one plat reskinned by biome. A **town archetype** (selectable per seed via a
`MapOpts.townType` knob; default = the current farm town, so all existing tests
stay green) reshapes **geography, economy, zoning mix, road pattern, palette
accent, and signature landmarks** together, so an oceanside town reads as a
completely different place from a desert town or a mountain town — while every
one still satisfies §1–§16.

**Archetypes to support** (each a coherent package — geography + economy +
signature assets):

| Archetype | Dominant geography | Signature economy / assets |
|-----------|--------------------|----------------------------|
| **Farm / Plains** (default) | flat cropland, river, rail | grain elevator, depot, farm belt, silos |
| **Oceanside / Coastal** | ocean edge with beach + surf, coastal road | harbor/marina, piers, boardwalk, lighthouse, seawall, cannery/seafood, moored boats, beach houses, no dominant grain elevator |
| **Desert** | desert biome dominant, mesas/buttes, arroyos | adobe/stucco buildings, water tank, mine headframe, sparse-or-no farm belt, cacti, dust palette |
| **Mountain / Foothill** | elevation relief, conifer slopes, rock cliffs, river gorge | logging mill, lumber yard, switchback roads, trestle over gorge, A-frame/cabin homes |
| **Lakeside / Riverport** | large lake or wide river port | docks, boat ramps, resort cabins, marina, fish shack |

(Additional archetypes — mining town, bayou/wetland town — are welcome once the
five above pass.)

**Acceptance criteria**
- [x] `MapOpts.townType` selects an archetype **deterministically**; omitting it
      reproduces the current farm town **byte-for-byte** (StateHash unchanged,
      all tests green).
- [x] Each archetype visibly differs from the default in **all** of: dominant
      biome/terrain edge, signature economy building set, road pattern, palette
      accent, and countryside/fringe character. A blind viewer can name the
      archetype from the full map. Indistinguishable from default → `MONOTONE`.
- [ ] Every archetype's **signature geography** is present and correctly placed
      _→ PARTIAL: ocean+beach+estuary+pier ✓, desert oasis-valley ✓, timber
      valley ✓, lake-at-town ✓; mesas/arroyo landforms, mountain gorge, and
      boardwalk/seawall are DEFERRED (B-node)._
      (ocean+beach+surf edge, mesa/arroyo, mountain relief+gorge, port). Missing
      signature geography → `MISSING`; an ungraded ocean/mountain/desert edge →
      `MISGEN`.
- [x] The **keystone set adapts** per archetype (a coastal town swaps the grain
      elevator for a harbor/cannery; a mountain town for a sawmill) but still
      guarantees civic anchors (school, sheriff, church, fire, grocery, etc.).
- [ ] **New biomes** required by these archetypes are added to the `Biome` enum
      _→ PARTIAL: `Biome.Ocean` shipped (sand shores, beach ground, no
      willows); Alpine and Wetland are DEFERRED (B-node)._
      (Ocean/Coast, Alpine/Mountain, Wetland, …) each with a graded ecotone per
      §2, and reskin ground + vegetation + shore consistently.
- [ ] Every archetype independently passes **all** core sections — hydrology
      _→ PARTIAL: verified seeds 11 + 42 per archetype (renders in QA
      gallery); the full 5-seed × 4-archetype gate runs with the next QA
      sweep._
      connectivity, road legibility, block refinement (§8A), determinism, spawn
      ring, reachable civic lots — across the 5-seed + biome-variant sweep.

**Required assets (new, by archetype):** ocean water + surf/beach/dune, pier,
boardwalk, marina, moored boats, lighthouse, seawall, jetty, cannery; adobe/
stucco building set, mesa/butte, arroyo, mine headframe, desert water tank;
conifer slope, rock cliff/gorge, sawmill/lumber yard, cabin/A-frame, switchback
road; boat ramp, resort cabin, fish shack. **Fail flags:** archetype ==
default → `MONOTONE`; missing signature geography/asset → `MISSING`; ungraded
world edge → `MISGEN`; archetype breaks a core gate → block.

---

## 3. Hydrology

**Standard.** A **living, connected** water network: a river that enters one
map edge and exits another, widening downstream; tributary creeks that actually
reach it at plausible angles; a lake with a real inlet and outlet. Every water
body connects to the network or is a deliberate desert playa. Water shapes the
town (mills, bridges, riparian woods), it isn't decoration.

**Acceptance criteria**
- [x] **Connectivity (S1):** zero orphan water bodies across all seeds (desert
      playas exempt by design). Every lake has an inlet **and** an outlet;
      every creek reaches its confluence or **erases itself** if it can't. Verify
      by component analysis, not eyeball.
- [x] River **widens downstream** and runs a continuous course edge-to-edge.
      Creeks meander — **bend forced within ≤5 straight tiles** (no 20-tile
      rulers). Tributaries join at acute downstream angles, never head-on/perp.
- [x] Creeks read distinct from the river: a shade lighter/greener, narrower
      (`MONOTONE` if creek pixels == river pixels).
- [x] **Crossings:** every road/rail-over-water is a square deck, railings on
      the water sides only, cast shadow. Creek crossings short; river crossings
      longer; the smallest lane-over-creek uses a **culvert**, not a full
      bridge. No diagonal/offset decks (`MISGEN`). Rail-over-water = trestle.
- [x] **Banks:** sand/gravel shore ring + reeds/rocks, non-uniform. Riparian
      trees (willows) line **rural** reaches only — **not** through in-town
      frontage.
- [x] **Required water features present:** a low concrete **dam/weir with a
      millpond** upstream of town; **marsh / wet-meadow** patches at confluences
      and the lake inlet; whitewater below the dam.

**Required assets:** river, creek, lake, dam/weir (`Lot.Dam`), millpond,
marsh/reeds, sand/gravel shore, riparian willow, bridge deck, culvert, rail
trestle, dry-wash (desert), dock (`Lot.Dock`). **Fail flags:** orphan body /
lake with no outlet → `MISPLACED`; straight creek or diagonal deck → `MISGEN`;
creek==river tone → `MONOTONE`.

---

## 4. Street & road network

**Standard.** A legible road **hierarchy** that reads at a glance: a 4-lane
highway through/around town, 2-lane avenues and streets forming blocks, and
courts/lanes serving homes. Every road goes somewhere; every dead end is
intentional. Intersections are clean.

**Acceptance criteria**
- [x] **Hierarchy reads:** highway (4-lane, yellow center seam + white dashes) >
      avenues/streets (2-lane, faint center dashes) > courts/lanes (narrow).
      All in-town streets identical width/color → `MONOTONE`.
- [x] **No streets to nowhere:** every dead end is a **cul-de-sac bulb**, a farm
      lane at a farmstead, or a map-edge exit. Anything else → `MISGEN`.
      Cul-de-sacs: **2–5 per town**, homes ringing the bulb; 0 across seeds →
      `DENSITY`.
- [x] **Intersections:** crossings meet cleanly — no double-wide smears, no
      orphan sidewalk pixels inside the junction (`MISGEN`). Traffic lights
      **only** at genuine downtown 4-ways; stop signs **only** where a side
      street tees; crossbucks **only** at rail crossings. Crosswalk zebra dashes
      at downtown intersections.
- [x] **Orthogonality:** no corner-only diagonal road/dirt tiles (test-gated);
      paths are stitched — no orphan road islands.
- [x] **Surface variety:** older residential asphalt reads slightly
      browner/patchier than the highway; gravel shoulders in the country;
      sidewalk skirts where lots front the road, cut at parking-lot entrances.

**Required assets (some missing — build them):** 4-lane highway, 2-lane street,
narrow lane/court, cul-de-sac bulb, dirt farm lane, asphalt tone variants, lane
markings, crosswalk, stop sign, traffic light, streetlight, sidewalk skirt,
gravel shoulder, **alleys behind Main St commerce**, **curb cuts at parking
lots**, **angled parking strip on Main**. **Fail flags:** uniform street width →
`MONOTONE`; dead-end-to-nowhere or junction smear → `MISGEN`.

---

## 5. Railroad

**Standard.** A single rail line crosses the **full map width** on a low
elevation row, defines the industrial edge, and carries the town's grain
economy. It never runs down a street or through the square.

**Acceptance criteria**
- [x] Line runs edge-to-edge: ballast bed, ties, twin steel rails. Trestle over
      water. Level crossings with crossbucks where **streets** cross it.
- [x] **Rail economy clusters at the town edge:** siding + **grain elevator**
      (`Lot.GrainElevator`, the skyline) + **depot** (`Lot.Depot`) + parked
      **boxcars**, all touching the siding (`MISPLACED` if elevator/depot don't
      touch rail; boxcars only on rail).
- [x] Rail **never** overlaps a street centerline or the town square
      (`MISPLACED`).
- [x] **Required rail dressing:** signal mast at the main crossing; a second
      rural grade crossing (crossbucks only); a **spur stub into the industrial
      lobe**; a gravel right-of-way access road.

**Required assets:** rail bed/ties/rails, trestle, crossbuck crossing, siding,
grain elevator, depot, boxcars, signal mast, spur, ROW access road. **Fail
flags:** rail on a street → `MISPLACED`; floating elevator/depot → `MISPLACED`;
missing signal/spur → `MISSING`.

---

## 6. Zoning & districts

**Standard.** With **no debug layer**, a viewer can point at each district by
look alone: downtown, commercial strip, high-density residential, low-density
suburbs, old town, college, industrial, trailer fringe. Districts sit in
plausible relationships to each other and the infrastructure.

Districts in code (`District` enum): `Suburbs`, `College`, `Downtown`,
`OldTown`, `Trailer` — plus the land-use zones used for ground color
(`NEUTRAL_BY_DISTRICT`: None/Suburbs/College/Downtown/OldTown/Trailer/
Commercial/Industrial/ResHigh). **Every district id must have a unique ground
tint** — no modulo wrap-around collisions.

**Acceptance criteria**
- [x] All districts visually distinguishable by ground tone + building character.
      Any two indistinguishable → `MONOTONE`.
- [x] **Adjacency sanity:** industrial touches rail/highway (not the school);
      ResHigh rings downtown; commercial strip is linear along Main; trailers at
      the fringe; college quad is coherent. Violations → `MISPLACED`.
- [x] Plat reads **inside-out** like a real town: dense core → residential rings
      → exurban lots → farmland (see §11).
- [x] **District dressing present:** old-town brick sidewalk tint; college quad
      **green**; industrial **gravel yards** with stacked pallets/drums;
      **trailer park in a court pattern**, not scattered.

**Required assets:** 9 unique district ground tints, brick sidewalk tint, quad
green, gravel yard + pallets/drums, trailer-court layout. **Fail flags:**
color-wrap collisions or flat zoning → `MONOTONE`; misplaced district →
`MISPLACED`; missing dressing → `MISSING`.

---

## 7. Civic & commercial buildings (keystones)

**Standard.** Every real small town has a fixed set of civic anchors, each in
the **right district**, each with its **service parking**, each a distinct
recognizable silhouette. Multi-tile buildings render as one mass.

Keystone guarantee — present and correctly placed on **every seed**: school,
high school, sheriff, grocery/supermarket, church + chapel, fire station, gas
station, grain elevator, depot, bank, post office, library, town hall
(landmark), cinema, diner, motel, factory. (`Lot` enum has all of these.)

**Acceptance criteria**
- [x] **Placement by role:** school/high school **not** on Main St retail
      frontage; grocery/cinema/diner **on** the strip; fire station near
      downtown; gas stations at highway/strip corners; factory/warehouse on the
      industrial edge by rail. Wrong district → `MISPLACED`.
- [x] **Footprint:** multi-tile buildings merge seams — no interior walls,
      shadow only on the S/E of the **whole** footprint → else `MISGEN`.
- [x] **Every anchor has its parking lot** adjacent, and the lot touches the
      building it serves (not a neighbor). Test-gated + visually verified.
- [x] **Commercial variety:** shops vary — **3 awning colors** (red/blue/green)
      + flat-parapet variant + corner-entrance variant. One awning shape →
      `MONOTONE`.
- [x] **Landmarks** (`Landmark` enum: RadioTower, Megachurch, TownHall,
      Fairground, WaterTower) all present and reachable by street/lane on every
      seed.
- [x] **MISSING candidates to build:** laundromat/barber (strip filler), church
      **parsonage** beside the church, **school bus** parked at the school,
      grain-elevator **office shed**, ballfield **backstop + bleachers**, motel
      **pool**, downtown storefront **signage**.

**Required assets:** all `Lot` civic/commercial silhouettes + service parking +
the MISSING list above. **Fail flags:** wrong-district anchor → `MISPLACED`;
seam/shadow error → `MISGEN`; one shop style → `MONOTONE`; missing anchor →
`MISSING`.

---

## 8. Residential (houses, lots, backyards)

**Standard.** Streets of homes that read as a **neighborhood**, not a stamp:
multiple house footprints, per-district wall/roof palettes, garages on some
lots, and lived-in backyards. Homes **front the street** (frontage rule);
interiors are backyards only.

**Acceptance criteria**
- [x] **House shape variety (the historical #1 gap):** ≥**3–4 footprints**
      hash-distributed — Classic Gable, Two-Story (taller block), L-Plan (wing
      offset), plus a bungalow-with-porch target. Single 6×6 gable everywhere →
      `MONOTONE`.
- [x] **Color variety:** 2–3 wall tones **per district** + district roof
      palette. All identical → `MONOTONE`.
- [x] **Garages/carports** on a fraction of lots; porches on some.
- [x] **Frontage rule:** a full house in a block **interior** is `MISPLACED`
      (regression). Interiors carry backyards only: sheds, above-ground pools,
      vegetable rows, back fences, flowers.
- [x] **Trailer fringe:** `drawTrailerHome` — long tin mobile home, hitch, skirt,
      propane tank, plastic awning + tire/junk pile; laid out in a **court**.
- [x] Street furniture on frontages (trees, hydrants, mailboxes) with a **hashed
      rhythm** that breaks naturally — never metronomic.

**Required assets:** 3–4 house footprints × per-district palettes, garage/
carport, porch, trailer home, backyard kit (shed/pool/garden/fence/flowers),
street trees/hydrants/mailboxes, chimney smoke (subset of homes).
**Fail flags:** one house shape/color → `MONOTONE`; interior house → `MISPLACED`.

---

## 8A. City-block refinement & legibility (zoomed-in)

**Standard.** Zoom into **any** block and it looks deliberately platted and
finished: buildings sit on real lots with clean setbacks, **never overlap or
merge into an unreadable blob**, each is **individually identifiable** by
silhouette and color, and the block has a **realistic layout** — lots facing the
street, yards/alley in the interior, corner lots addressing the corner. This is
the crop-level polish gate for every built district (downtown, commercial,
residential, old town, trailer, college).

**Acceptance criteria**
- [x] **No overlaps / no merges:** two building footprints never collide or share
      tiles; each lot holds **one** primary structure. Adjacent buildings never
      fuse into one mass — there is a visible lot line or gap between them.
      Overlap, bleed, or merge → `MISGEN`.
- [x] **Setbacks & spacing:** a consistent **front setback** from the street,
      **side yards** between detached neighbors (≥1 tile separation or a clean
      shared lot line), and a **rear yard**. Detached buildings flush against
      each other with no gap → `MISGEN`.
- [x] **Legibility:** each building's silhouette + palette clearly says **what it
      is** — a house reads as a house, a church as a church, a shop as a shop —
      at both full-map and crop. Two neighbors that read as one shape, or a
      building whose type is ambiguous → `MISGEN` (refine the silhouette).
- [x] **Realistic block layout:** rectangular blocks bounded by streets; lots
      **front the street** along the block edges; the **interior is yards/alley,
      never more buildings** (`MISPLACED` if a structure sits mid-block);
      **corner lots** carry a building oriented to the corner.
- [x] **Alignment:** buildings sit **parallel to their frontage** with
      consistent orientation within a block. Random rotation/jitter that breaks
      the plat read → `MISGEN`.
- [x] **Downtown rows are intentional, not accidental:** attached Main-Street
      storefronts sharing party walls are correct — but each storefront stays
      **individually legible** (distinct awning/parapet/entrance) and no tower
      lands in the block interior.
- [x] **Service placement:** parking lots and alleys sit **behind/beside**
      commercial buildings and serve the building they touch — never wedged
      between two houses.
- [x] **Verify on magnified crops** of: a **downtown block**, a **dense
      residential block**, a **commercial strip block**, and a **mixed corner**.
      Each must pass every check above.

**Required assets / logic:** lot-subdivision within blocks, setback + frontage
placement, side/rear-yard spacing, corner-lot orientation, downtown party-wall
row layout, driveways, rear alleys, per-lot single-structure guarantee.
**Fail flags:** overlapping/merged buildings → `MISGEN`; ambiguous/unreadable
building → `MISGEN`; mid-block structure → `MISPLACED`; misaligned/rotated
building → `MISGEN`; missing/uneven setback → `MISGEN`.

---

## 9. Agriculture & countryside

**Standard.** Outside town every plowable acre is **worked** — a continuous
quilt of parcels sharing baulks, each aligned to its access road, with farmsteads
at the lanes. No "islands of crop in decorative grass," no orphan barns.

**Acceptance criteria**
- [x] **Continuity:** the rural band reads farmed; grass gaps **> ~6 tiles**
      between parcels in the belt → `DENSITY`. Parcels share baulks/edges.
- [x] **Parcel logic:** each field aligns to its road; shoulder/drainage strip
      present; **no crop tile touches pavement or water** → else `MISPLACED`.
      Per-parcel size jitter (≈6–9 × 5–7) + offset — **no single rigid map-wide
      lattice** (`DENSITY` if edges align map-wide).
- [x] **Crop + orientation variety:** palettes (corn / soy / wheat / fallow) AND
      row orientation both vary between **adjacent** parcels; two neighbors
      identical in both → `MONOTONE`. Hay bales on fallow/mown.
- [x] **Farmsteads:** house + barn/silo cluster at a lane, **shelterbelt on the
      windward (north) side**, lane connects to the road net. Orphan barn →
      `MISPLACED`.
- [x] **Pasture & orchard:** `Terrain.Pasture` fenced worn meadow with grazing
      cattle + watering trough; `Terrain.Orchard` mown rows with tree lines and
      fruit/blossom color.
- [x] **MISSING candidates:** farm ponds / stock tanks in pasture corners;
      tractor/implement parked at farmsteads; irrigation wheel-line (rare field
      variant); roadside produce stand; a horse variant beside cattle.

**Required assets:** crop parcels (4 crops) + row striping, baulks, drainage
ditch, shelterbelt, farmstead (house+barn+silo), pasture+cattle+trough, orchard,
hay bales, farm pond, parked tractor, produce stand. **Fail flags:** crop
islands / lattice → `DENSITY`; crop on pavement/water or orphan barn →
`MISPLACED`; identical neighbors → `MONOTONE`.

---

## 10. Vegetation & woods

**Standard.** Woodland sits where it belongs — hugging water and floodplain,
filling field corners — never squatting on prime cropland. Trees have variety;
every woods/crop seam has a hedgerow.

**Acceptance criteria**
- [x] **Placement:** the bulk of woodland hugs water/floodplain; field-corner
      woodlots are small; a big blob on prime flat cropland → `MISPLACED`.
      **Nature generates BEFORE farming** so fields wrap timber (regression
      guard).
- [x] **Hedgerows** at every woods/crop seam; **shelterbelts** on farmstead
      north sides (both distinct from bulk woods).
- [x] **Tree variety:** ≥**2–3 canopy shapes** + occasional autumn/dead tree;
      lone trees hash-select pine/shrub/autumn/dead. Single tree sprite
      everywhere → `MONOTONE`. Single bush shape / one rock arrangement →
      `MONOTONE`.
- [x] Woods render with clumped light/dark canopy, trunk gaps, sunlit N/W
      fringe, and sub-tile edge bleed onto neighbors — not a flat green mass.

**Required assets:** woods canopy (clumped, edge-bleed), 2–3 lone-tree species +
autumn/dead, bush variants, hedgerow, shelterbelt, riparian willow. **Fail
flags:** woods on cropland → `MISPLACED`; single tree/bush → `MONOTONE`.

---

## 11. Town edges & outskirts

**Standard.** The town **doesn't end at a hard line.** Density falls off:
platted blocks → larger-lot exurban homes → farmsteads → open country, on **all
four sides**. Edge-of-town assets appear on the outbound roads.

**Acceptance criteria**
- [ ] **Fringe gradient** present on every compass side: block → exurban lot →
      _→ CONSTRAINED by §15: the spawn ring (r+6…r+14) must stay claimable
      open land, so the gradient reads block → fringe row → open ring →
      farmsteads. Exurb density raised to 50%; verified S/E sides._
      farmstead. A hard block-to-field line on any side → `DENSITY` (known
      partial gap — verify closed). `scatterExurbs` fills the transition.
- [x] **Welcome signs** flank Main Street at both town lines; **cemetery**
      (`Lot.Cemetery`) on an outbound road at the edge; **motel + gas** out on
      the highway.
- [x] **MISSING candidates:** junkyard/salvage lot on the trailer fringe;
      gravel pit / quarry scar in the countryside; roadside **billboard pair**
      on highway approaches; **sewage lagoon / substation** (`Lot.Substation`)
      at the industrial edge as a fenced utility square.

**Required assets:** exurban large-lot homes, welcome sign, cemetery, highway
motel/gas cluster, junkyard, quarry scar, billboard, sewage lagoon, substation.
**Fail flags:** hard town/field boundary → `DENSITY`; missing edge assets →
`MISSING`.

---

## 12. Infrastructure & utilities

**Standard.** The invisible-until-you-look layer that sells realism: power,
water, and communications threading through town and country.

**Acceptance criteria**
- [x] **Utility poles** march every ~3 tiles along **rural** roads (poles
      rural-side only), suppressed on dead-end verges; wire spans read between
      poles.
- [x] **In-town water tower** (`Lot.WaterTower`) in a residential/suburban
      quarter on every seed **and** the rural landmark water tower
      (`Landmark.WaterTower`) — the two are distinct.
- [x] **Substation** (`Lot.Substation`) fenced square at the industrial/utility
      edge.
- [x] Streetlights on downtown/commercial sidewalks; radio tower landmark with
      blinking top.

**Required assets:** utility poles + wire spans, in-town water tower, landmark
water tower, substation, streetlights, radio tower. **Fail flags:** poles in
town / on dead ends → `MISPLACED`; missing tower/substation → `MISSING`.

---

## 13. Dressing & life (cross-cutting)

**Standard.** The static map is populated with plausible motion and detail:
traffic obeys the road hierarchy, people commute, and small-scale life
(furniture, smoke) breaks the emptiness — all deterministic.

**Acceptance criteria**
- [x] **Traffic:** deterministic cars (hash of position × tick), denser on the
      highway than streets, two directions; parked cars in lots and at some
      curbs. **No vehicles on rail/paths/water** → `MISPLACED`.
- [x] **People dots:** 2px residents commute along streets, cluster at civic
      buildings; **nobody standing in water or on rail** → `MISPLACED`.
- [x] **Chimney smoke** on ~⅓ of homes only (tick hash), not all.
- [x] Street furniture, welcome signs, streetlights, poles all obey their
      placement rules with hashed (non-metronomic) rhythm.

**Required assets:** moving traffic, parked cars, resident dots, chimney smoke,
furniture rhythm. **Fail flags:** vehicle/person on water/rail → `MISPLACED`;
uniform furniture spacing → `MONOTONE`.

---

## 14. Color palette & rendering style

**Standard.** A coherent, muted, aerial-photo palette — greens and earths, not
saturated game colors. Zoning reads through **ground tone**. Everything is drawn
in a **single 8px pass** — nothing tiles or bands, and no feature depends on a
zoom level to appear.

**Acceptance criteria**
- [x] `NEUTRAL_BY_DISTRICT` gives **9 unique** ground tints (no wrap-around).
      Empty yards render as **open biome ground**, not a pale district blob.
- [x] Terrain palette stays muted/naturalistic (see `TERRAIN_COLORS`); water,
      road, woods tones read like an aerial photo, not neon.
- [x] **Single-LOD contract:** every asset is legible as a silhouette + a few
      colors at 8px and carries all its meaning in that one pass — no reliance
      on an up-close detail layer. Verify each asset in a full-map render **and**
      a magnified crop; the crop must show the *same* pixels, only larger.
- [x] Territory/archetype overlays (Dawn/Radiant/Circle/Visitors patterns) stay
      colorblind-safe (pattern-redundant) and never obscure the base map read.

**Fail flags:** color-wrap zoning collision or pale town blob → `MONOTONE`;
over-saturated tone → `MISGEN`; asset illegible at 8px → `MISGEN`.

---

## 15. Determinism, performance & gameplay guarantees

**Standard.** Realism must never break the simulation. The map is also a
playfield.

**Acceptance criteria**
- [x] Same seed ⇒ same map (StateHash stable). `npm test` green across both
      packages after every change.
- [x] Floors hold: ≥640 populated tiles, ≥2900 souls, farm-share within gate,
      keystone + rail present, home frontage enforced, road orthogonality.
- [x] **Founding not walled off:** enough claimable open land in the spawn ring
      (r+6 … r+14 from center) on **all 8 compass spokes** — the farm belt must
      never seal the town in.
- [x] Property stakes / compound assets render legibly on **every** terrain they
      can occupy (grass, field, orchard, pasture).
- [x] All 5 landmarks + all civic lots present and **reachable** (dirt lane or
      street adjacency) on every seed.

**Fail flags:** hash drift / test regression → block; sealed spawn ring →
`MISPLACED`/`DENSITY`; unreachable civic lot → `MISPLACED`.

---

## 16. Definition of done (the closing gate)

The map is at standard only when **all** of these hold:

1. Across seeds 11/21/42/77/99 + `biomes:[]` + `biomes:["desert"]` **and every
   `townType` archetype (§2A)**, a fresh full-map render produces **zero open
   S1/S2** findings on a second sweep.
2. Every **Required assets** list in §1–§14 (including §2A archetypes and §8A
   block layout) is fully present (built, not just documented), verified with
   render evidence — full map + a magnified crop of the subject.
3. Every subsystem's acceptance boxes are checkable against a cited artifact.
4. **Block-refinement gate (§8A):** magnified crops of a downtown, dense
   residential, commercial-strip, and corner block all pass — no overlaps, every
   building individually legible, realistic plat layout.
5. `npm test` green (both packages); StateHash deterministic per seed **and per
   archetype** (default `townType` is byte-identical to today).
6. ASSETS.md updated with new assets + variants; QA_MAPGEN.md report section
   reflects the closing sweep.
7. Blind read test: a viewer with no debug layer can name the **town archetype**
   and every district, trace the water network, find each keystone, and read the
   town-to-country gradient — and it looks like an **aerial photo of a real
   American town** of that type within the 8px style.

---

## Appendix A — Subsystem → code map

| Subsystem | Generation | Rendering |
|-----------|-----------|-----------|
| Town archetype / world type (§2A) | `mapgen.ts` `generateWorld` (new `MapOpts.townType` branch), `paintBiomes` | archetype signature draws in `drawTile` / `drawLotBuilding` |
| Block layout & refinement (§8A) | `mapgen.ts` `layoutHighwaysAndTown` (lot subdivision, setbacks), `enforceRoadFrontage` | `drawLotBuilding`, `drawHouse`, `drawBlock` |
| Terrain / biome / ecotone | `mapgen.ts` `paintBiomes`, elevation | `townRender.ts` `drawTile` |
| Hydrology | `mapgen.ts` (river/creek/lake/dam, `connectLakesToRiver`), `placeDocks` | `drawTile` (water/bridge/trestle) |
| Roads / streets | `mapgen.ts` `layoutHighwaysAndTown`, `orthogonalizePaths`, `roadComponents`; `gridRoads.ts` | `drawTile` (road/markings), verge |
| Railroad | `mapgen.ts` `layoutRail` | `drawTile` (rail), `Lot.GrainElevator/Depot` |
| Zoning / districts | `mapgen.ts` (district assignment), `districtCoeffTable` | `palette.ts` `NEUTRAL_BY_DISTRICT` |
| Civic / commercial | `mapgen.ts` `placeTownBuildings` (keystone guarantee) | `drawLotBuilding` (per-`Lot` cases) |
| Residential | `mapgen.ts` `enforceRoadFrontage`, `scatterExurbs` | `drawHouse`, `drawTrailerHome`, `drawBlock` |
| Agriculture | `mapgen.ts` `layoutFarms`, `fillFarmBelt` | `drawTile` (field/pasture/orchard) |
| Vegetation | `mapgen.ts` (nature before farming) | `drawTile` (woods/trees/hedgerow) |
| Edges / outskirts | `mapgen.ts` `scatterExurbs` | edge lots, welcome signs |
| Dressing / life | sim | `drawResidents`, `drawEffects`, `drawUnits`, traffic |
| Palette / style | — | `palette.ts`, `townRender.ts` |

## Appendix B — Enum reference (target-state must respect these)

- **`Terrain`:** Citizen, Woods, Lake, Road, Grass, Field, Dirt, Path, Orchard,
  Pasture, Rail.
- **`Biome`:** Temperate, Desert, Forest, Autumn _(extend for §2A archetypes:
  Ocean/Coast, Alpine/Mountain, Wetland — each with a graded ecotone per §2)._
- **`townType` (new, §2A):** Farm _(default)_, Oceanside, Desert, Mountain,
  Lakeside — a `MapOpts` knob; default reproduces today's farm town exactly.
- **`District`:** Suburbs, College, Downtown, OldTown, Trailer (+ land-use
  ground zones: Commercial, Industrial, ResHigh in `NEUTRAL_BY_DISTRICT`).
- **`Landmark`:** RadioTower, Megachurch, TownHall, Fairground, WaterTower.
- **`Lot`:** Shop, Supermarket, Diner, School, Library, Chapel, GasStation,
  Sheriff, Office, Barn, Silo, Park, Church, Bank, PostOffice, FireStation,
  Factory, Motel, Parking, Cemetery, BallField, Cinema, Playground, Dock,
  Greenhouse, HighSchool, Warehouse, GrainElevator, Depot, Dam, WaterTower,
  Substation.

_New realism assets identified above (laundromat, barber, parsonage, school bus,
backstop/bleachers, motel pool, produce stand, tractor, farm pond, junkyard,
quarry, billboard, sewage lagoon, angled parking, alleys, curb cuts, culverts,
horse, wheel-line irrigation, etc.) either extend `Lot`/`Terrain` or render as
sub-tile dressing — decide per asset, then record it in ASSETS.md._
