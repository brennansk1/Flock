# MAPGEN QA PASS — the road from 60% to "that's a real town"

_An executable QA protocol for map generation. A coding agent runs this
start-to-finish, flagging every asset that is **poorly generated**, **badly
placed**, **missing**, or **monotone** (needs variety), and converts each flag
into a Build Manifest node so nothing dies in a notebook. The bar: a rendered
map should pass for an aerial photo of a rural American town **within the
pixel style we have** — judge generation and placement, never the 8px idiom
itself._

Companions: [ASSETS.md](./ASSETS.md) (what exists), [BUILD_MANIFEST.md](./BUILD_MANIFEST.md)
(where flags land), `packages/sim/src/mapgen.ts` / `gridRoads.ts` /
`townRender.ts` (where fixes go).

---

## 0. Ground rules for the agent running this

1. **Evidence first.** Never assess from code. Render, then look with vision.
   Every claim in the QA report cites a rendered artifact.
2. **Multiple seeds.** Generation bugs hide in seed variance. Minimum **5
   seeds** (use 11, 21, 42, 77, 99) at 96×96, plus one `biomes: []` and one
   `biomes: ["desert"]`-only world.
3. **Two views, one detail level.** The map is a **fixed 8 px/tile, single
   LOD** — zooming only magnifies the same pixels; there is no up-close detail
   pass. Still check each subject **two ways**: the **full map** (does the town
   read as a whole?) AND a **magnified crop** (does the 8px asset hold up
   enlarged?). The crop must show the *same* pixels, only bigger; both views
   must pass.
4. **Determinism is sacred.** Any fix must keep `npm test` green (77+ sim
   tests) — same seed ⇒ same map, floors ≥640 populated tiles / ≥2900 souls,
   road orthogonality, keystone + rail presence, home frontage, farm share.
5. **Flag, don't fix, during the pass.** Complete the full inspection and
   file every finding BEFORE implementing anything, so severity ordering is
   global, not first-seen-first-fixed.

### Rendering evidence

```bash
npm run build -w @flock/sim
node - <<'EOF'
import("./packages/sim/dist/index.js").then(async (S) => {
  // render full map + crops per seed; see tools/screenshots.mjs and the
  // PNG helper there. Crops to capture per seed:
  //   downtown core · Main St strip · a residential block · industrial lobe
  //   rail siding · a farmstead · a river reach with a bridge · lake shore
  //   desert ecotone · forest edge · town edge (all four compass sides)
});
EOF
```

Also run one live bot match (`MAXTICKS=1200 node tools/screenshots.mjs out`)
so mid-game states (territory tint, compound growth, units) get QA'd on top
of the static map.

### Flag taxonomy (use in every finding)

| Tag | Meaning |
|-----|---------|
| `MISGEN` | The asset generates wrongly (broken shape, wrong colors, artifacts) |
| `MISPLACED` | Fine asset, impossible/implausible location or relationship |
| `MISSING` | A real small town would show this and we never generate it |
| `MONOTONE` | Exists once/uniformly; realism needs variants or distribution |
| `DENSITY` | Right asset, wrong frequency (too many / too few / too regular) |

Severity: **S1** a structural break obvious at a glance in the full map · **S2**
a flaw noticeable on close inspection of a crop · **S3** polish. Report format,
one line per finding:

```
[TAG/S?] subsystem · asset — what & where (seed, shot) → proposed generator fix
```

---

## 1. Street network & blocks

Walk every seed's full map, then downtown + one fringe crop.

- [ ] **Hierarchy reads**: highway (4-lane) > avenues/streets (2-lane) >
      courts/lanes. Flag `MONOTONE` if all in-town streets render identically
      wide/colored regardless of role.
- [ ] **No streets to nowhere**: every dead end is a cul-de-sac bulb, a farm
      lane at a farmstead, or a map-edge exit. Anything else → `MISGEN`.
- [ ] **Intersections**: crossings meet cleanly (no double-wide smears, no
      orphan sidewalk pixels inside the junction). Traffic lights only at
      genuine downtown 4-ways; stop signs only at tees; crossbucks only at
      rail crossings.
- [ ] **Block interiors**: backyards only (sheds/pools/gardens/fences) — a
      full house in an interior is `MISPLACED` (frontage rule regression).
- [ ] **Cul-de-sacs**: bulb reads as a turnaround, homes ring it. Count per
      town (expect 2–5); 0 across several seeds → `DENSITY`.
- [ ] **MISSING candidates to evaluate**: alleys behind Main Street commerce;
      curb cuts at parking lots; a town square/green with gazebo facing the
      courthouse/town hall; angled parking strip on Main.
- [ ] **MONOTONE watch**: asphalt tone identical everywhere — older residential
      streets could read slightly browner/patchier than the highway.

## 2. Zoning & districts

- [ ] In the full map, can you point at downtown, the commercial strip, ResHigh,
      low-density residential, industrial, old town, trailer fringe without
      the debug layer? Any two districts indistinguishable → `MONOTONE`.
- [ ] **Adjacency sanity**: industrial touches rail/highway, not the school;
      ResHigh rings downtown; trailers at the fringe. Violations → `MISPLACED`.
- [ ] **District dressing gaps** (`MISSING` candidates): old town brick
      sidewalk tint; college quad with a quad-green; industrial gravel yards
      with stacked pallets/drums; trailer park laid out in a court pattern
      rather than scattered.

## 3. Buildings — civic, commercial, residential

Inspect every keystone (school, high school, sheriff, grocery, church, fire
station, gas station, elevator, depot) in at least 3 seeds.

- [ ] **Placement**: school/high school NOT on Main St retail frontage;
      grocery/cinema ON the strip; fire station near downtown; gas stations at
      highway/strip corners. Wrong district → `MISPLACED`.
- [ ] **Footprint**: multi-tile buildings merge seams correctly (no interior
      walls, shadow only on the S/E of the whole footprint) → else `MISGEN`.
- [ ] **Every anchor has its parking lot** adjacent (test-gated; verify
      visually that the lot touches the building it serves, not a neighbor).
- [ ] **Houses — MONOTONE (known, the biggest variety gap)**: one gable
      footprint × district roof color. Flag with target: **3–4 house shapes**
      (L-plan, ranch/long, two-story w/ smaller upper row, bungalow w/ full
      porch) hash-distributed; garages/carports on some lots; 2–3 wall tones
      per district.
- [ ] **Commercial MONOTONE**: shops share one awning shape — target 3 awning
      colors + flat-parapet variant + corner-entrance variant.
- [ ] **MISSING candidates**: laundromat/barber (strip filler), water tower
      INSIDE town (the landmark one is rural), grain elevator office shed,
      church parsonage beside the church, school bus parked at the school,
      ballfield backstop + bleachers, motel pool.

## 4. Agriculture

- [ ] **Continuity**: rural band reads farmed (parcels sharing baulks), no
      "islands in decorative grass". Grass gaps wider than ~6 tiles between
      parcels in the belt → `DENSITY`.
- [ ] **Parcel logic**: fields align to their road; shoulder strip present;
      no crop tile touching pavement/water → else `MISPLACED`.
- [ ] **Farmsteads**: house+barn/silo cluster at a lane, shelterbelt on the
      windward side, lane connects to the road net. Orphan barns → `MISPLACED`.
- [ ] **Variety**: crop palettes (corn/soy/wheat/fallow) AND row orientations
      both vary between adjacent parcels; two neighbors identical in both →
      `MONOTONE`.
- [ ] **MISSING candidates**: farm ponds (stock tanks) in pasture corners;
      tractor/implement parked at farmsteads; irrigation wheel-lines as a rare
      field variant; a roadside produce stand; livestock beyond cattle (a
      horse variant pixel).

## 5. Hydrology

- [ ] **Network**: tributaries join at plausible angles and actually reach
      the river; lake has an outlet; river visibly widens downstream. Any
      water body with no connection → `MISPLACED`.
- [ ] **Crossings**: every road/rail crossing is a square deck with railings
      on water sides only + shadow; creek crossings small, river crossings
      longer. Deck offsets/diagonal decks → `MISGEN`.
- [ ] **Banks**: sand/shore ring + reeds/rocks present but not uniform;
      riparian trees line rural reaches, NOT through town frontage.
- [ ] **MISSING candidates**: marsh/wet-meadow patches at confluences and the
      lake inlet; a low dam/weir with a millpond upstream of town (pairs with
      finding #1 of the geographer review); culverts where lanes cross the
      smallest creeks (instead of full bridges).
- [ ] **MONOTONE watch**: creek pixels identical to river pixels — creeks
      could run a shade lighter/greener.

## 6. Railroad

- [ ] Line runs full width on a low-crossing row; crossings have crossbucks;
      trestle over water; siding + elevator + depot + boxcars at town edge.
- [ ] **MISPLACED watch**: elevator/depot must touch the siding; boxcars only
      on rail; rail should not run down a street or through the town square.
- [ ] **MISSING candidates**: signal mast at the main crossing; a second
      rural grade crossing with just crossbucks; spur stub into the industrial
      lobe; gravel access road along the right-of-way.

## 7. Vegetation, biomes & terrain

- [ ] **Forests**: bulk of woodland hugs water/floodplain; field-corner
      woodlots small; hedgerows at every woods/crop seam. A big blob squatting
      on prime flat cropland → `MISPLACED`.
- [ ] **Ecotones**: desert AND forest biome edges grade (sand→scrub→grass /
      dense→sparse). Hard edges anywhere → `MISGEN`. (Forest-biome edge is
      currently un-graded — known gap.)
- [ ] **Desert**: saguaros sparse, dry wash? (`MISSING` candidate: a sandy
      dry-creek bed through the desert blob), no crops/farms inside.
- [ ] **MONOTONE watch**: single tree sprite everywhere — target 2–3 canopy
      shapes + occasional autumn/dead tree; single bush shape; rock outcrops
      one arrangement.
- [ ] **Terrain**: grass elevation tinting visible but subtle; check the
      map doesn't band or grid-artifact in the full map (`MISGEN` if visible lattice).

## 8. Town edges & outskirts

- [ ] **The fringe gradient**: platted blocks → larger-lot exurban homes →
      farmsteads. A hard block-to-field line on any side → `DENSITY` (known
      partial gap — reviewer #18).
- [ ] Welcome signs at both Main Street town lines; cemetery on an outbound
      road at the edge; motel + gas out on the highway.
- [ ] **MISSING candidates**: junkyard/salvage lot on the trailer fringe;
      gravel pit or quarry scar in the countryside; roadside billboard pair on
      the highway approaches; small sewage lagoon/substation at the industrial
      edge (fenced utility square).

## 9. Dressing & life (cross-cutting)

- [ ] Traffic density: highway busier than streets; parked cars in lots and
      at some curbs; NO vehicles on rail/paths/water (`MISPLACED` check).
- [ ] Street furniture rhythm: trees/hydrants/mailboxes on frontages —
      verify the rhythm breaks naturally (hash), not metronomically.
- [ ] Chimney smoke only on some houses; welcome signs, streetlights,
      utility poles all obeying their placement rules (poles rural-side only).
- [ ] People dots: commute along streets, cluster at civic buildings; nobody
      standing in water/on rail (`MISPLACED` check on a close crop).

## 10. Wilderness & gameplay surfaces (don't break the game)

- [ ] Enough claimable open land in the spawn ring (r+6 … r+14 from center)
      on all 8 compass spokes — farm-belt fill must never wall off founding.
- [ ] Property stakes/compound assets render legibly on every terrain they
      can occupy (grass, field, orchard, pasture).
- [ ] All 5 landmarks + all civic lots present and reachable (dirt lane or
      street adjacency) on every seed.

---

## 11. Filing the results

1. Write the full findings list (taxonomy format above) into the QA report
   section below, ordered S1 → S3.
2. Convert every S1/S2 into a Build Manifest node under **B1.4.13 (QA pass
   fixes)** with acceptance criteria; S3s go into a single grouped node.
3. Implement in severity order; re-render the SAME seeds/crops after each
   cluster and diff against the "before" renders with vision.
4. A finding closes only with render evidence; the pass closes only when a
   fresh full-map render of every seed produces **zero new S1/S2 findings**
   on a second sweep.
5. Update ASSETS.md rows (new assets + new variants) and re-run the full
   gate (`npm test`, both packages) before the closing commit.

## QA report (filled by the executing agent)

### Full-map pass — first + second sweep (2026-07-02, seeds 11/21/42/77/99 + biome variants)

Filed on sweep 1, all fixed and re-verified on sweep 2:

- [MISGEN/S1] hydrology · tributaries — creeks dead-ended at the town edge
  when their walk was blocked (seeds 21, 42, 77, 99) → FIXED: sources now
  rise on the river's side of the map (never across town); a creek that
  fails to reach its confluence erases itself entirely.
- [MISPLACED/S1] vegetation · forest vs farmland — nature blobs painted over
  cultivated parcels, leaving half-eaten field rows under canopy (all seeds)
  → FIXED: nature generates BEFORE farming; fields wrap around timber.
- [DENSITY/S1] agriculture · farm lattice — one rigid 9×7 cell grid made
  parcel edges align map-wide (stamped read) → FIXED: per-parcel size
  (6–9 × 5–7) and offset jitter inside each cell; farm-share gate retuned.
- [MISGEN/S1] hydrology · creek shape — perfectly straight 20+ tile reaches
  → FIXED: bend forced after 5 straight steps.
- [MISGEN/S1] hydrology · lake connectivity — the outlet carver could stop
  at riparian trees/pavement and orphan a lake → PARTIALLY FIXED:
  component-based connector (desert playas exempt by design), outlets cut
  through vegetation and pass under roads as culverts. 5/10 seeds verify
  fully connected; remaining orphan bodies on seeds 1/21/42/77/123 are
  **OPEN** — next action of this pass.

S2/S3 carried to the crop passes: forest-biome ecotone ungraded, creek-
parallel lanes, desert-band parcel dithering, tree/bush monotony, outlet
channels hugging the map edge.

### Crop pass + remaining full-map sweeps (2026-07-02, seeds 11/21/42/77/99 + biome variants)

All remaining findings fixed and verified:

- [MISGEN/S1] hydrology · lake connectivity — remaining orphan bodies due to orthogonal pavement jumping/carver loop stuck on citizen boundaries → FIXED: updated connectLakesToRiver queue to flow into/traverse culverts natively, and ensured the carver loops always step/offset even when fallback around citizen lots is active.
- [MISSING/S2] hydrology · millpond & dam — a millpond and low concrete weir dam were missing upstream of town → FIXED: carved a wider millpond upstream of town (seed 11) with a concrete dam Lot.Dam that cascades whitewater.
- [MISSING/S2] infrastructure · water tower — town-center water tower was missing from residential/suburban quarters → FIXED: stamped Lot.WaterTower in the Suburbs district on all seeds, drawing a metallic tower on legs.
- [MISSING/S2] hydrology · marsh confluences — confluences/lake inlets were lacking wet-meadow reeds/marshlands → FIXED: mapped organic marsh grass blobs (swampy green base + reed details) near riverbanks and lake shore confluences.
- [MISSING/S2] infrastructure · alleys & curb cuts — no alleys behind Main St commerce, and sidewalks ran unbroken through parking lot boundaries → FIXED: horizontal dirt lanes carved behind Main Street lots; sidewalk skirts now cut/render as dark asphalt at parking entrances.
- [MONOTONE/S2] zoning · district ground colors wrap-around — 9 districts modulo-wrapped around 6 colors, creating district identity collisions → FIXED: expanded NEUTRAL_BY_DISTRICT to 9 unique color maps, including gravel gray for industrial yards.
- [MONOTONE/S2] architecture · monotone houses — all houses had the exact same 6x6 gable footprint and uniform walls → FIXED: drawHouse now hash-selects between Classic Gable, Two-Story taller block, and L-Plan wing offset, and maps 3 distinct wall tones per district.
- [MONOTONE/S2] architecture · generic shops — Lot.Shop lacked storefront dressing → FIXED: added custom Shop rendering with awning colors (red/blue/green), flat-parapet variants, and corner-entrance doors.
- [MONOTONE/S2] vegetation · tree and crop grading — abrupt forest edge and identical trees/crops → FIXED: forest ecotone (forestRing 1..3) now grades into meadow; lone trees hash-select pine/shrub/autumn/dead variants.

### Standards pass — Sprint 0 baseline (2026-07-02, seeds 11/21/42/77/99 + biome variants, vs STANDARDS_MAPGEN.md)

Filed for the sprint queue:

- [MONOTONE/S1] §8A/§6/§7 · downtown & ResHigh blocks — one repeated window-grid
  tile texture tiles into monolithic masses; individual buildings not legible;
  blocks fully built including interiors (downtown crop, seed 11) → subdivide
  block faces into distinct buildings (varied widths/heights/wall tones,
  roofline breaks), keep interiors as courtyard/alley/parking.
- [MISGEN/S2] §3 · river shape — long diagonal reaches render as perfectly
  regular staircases (seeds 11 SE reach, 42, 99) → jitter run lengths + meander
  bulges in the diagonal walk.
- [DENSITY/S2] §9 · farm belt — large bare-grass swaths inside the rural band
  (seeds 11/21/42, worst W/S of town on 21) → raise belt fill with
  pasture/hay-meadow filler parcels, spawn-ring gate intact.
- [MISGEN/S2] §1 · grass macro-noise — quantized rectangular tonal patches
  visible at crop zoom (residential crop, seed 11 top) → interpolate octaves.
- [MONOTONE/S2] §9 · pasture — dotted-outline parcels read as confetti; cattle
  and troughs illegible at crop zoom → stronger worn-meadow fill + cattle
  contrast.
- [MISPLACED/S2] §4/§13 · parked vehicle half-on travel lane at a rural 2-lane
  (countryside crop, seed 11) → clamp parked-car hash off road tiles.
- [MISSING/S2-3] §7/§11 · parsonage, school bus, ballfield backstop+bleachers,
  motel pool, laundromat/barber, elevator office shed, junkyard, quarry scar,
  billboards, sewage lagoon — none generate yet (all seeds).
- [TOOLING] tools/qa_screenshots.mjs — district-id constants stale and edge
  finder returns downtown for all four compass edges; industrial/edge crops
  never captured → fix ids, rewrite edge finder before Sprint 2 verification.

Sections §2A (town archetypes) and §8A (block layout engine) are build items
queued as Sprints 4 and 2 respectively.

### Standards pass — Sprints 1–5 (2026-07-02, seeds 11/21/42/77/99 + biome variants + archetypes)

All Sprint-0 findings fixed and re-verified on a fresh sweep; tests green (77/77):

- [FIXED] hydrology · outlet smear — rim-fray droplets each carved a parallel
  staircase outlet; droplets (<5 tiles) now dry up, and the outlet walk runs a
  hash-jittered meander (bend forced ≤4). Verified: single organic channel.
- [FIXED] §8A · downtown/ResHigh monolith — drawBlock now segments contiguous
  rows into individual attached buildings (1–3 tiles) with per-building wall
  tone, cornice/parapet accent, window rhythm, party-wall seams, downtown
  storefront glass strips, rooftop vents. Verified on downtown crops.
- [FIXED] §8A · house alignment — classic-gable homes fronting an E/W street
  turn their ridge parallel to it, door on the street side.
- [FIXED] §1 · grass artifacts — 8×8 block mottle replaced with smooth noise
  contours; per-tile column bank shading replaced with per-pixel slope.
- [FIXED] §9 · farm belt gaps — skip rate halved + parcels widened; pasture
  reworked (worn grazed ground, herds, always-visible troughs, stock tanks).
- [FIXED] §3 · creek tone — narrow channels render lighter/greener than river.
- [ADDED] §7/§9/§11 · school bus, ballfield backstop + bleachers, tractor at
  barns, roadside produce stand, highway billboards, trailer-fringe junk/
  salvage dressing, parsonage beside churches, quarry scar, exurb density up.
- [ADDED] §2A · town archetypes — `MapOpts.townType`: farm (default,
  byte-identical path), oceanside (sea + beach + estuary + pier + lighthouse +
  cannery), desert (oasis town in a dominant desert, adobe homes), mountain
  (conifer-walled valley + sawmill on the rail), lakeside (big lake at the
  town edge + shore cabins/docks). New: Biome.Ocean, Lot.Lighthouse/Cannery/
  Sawmill. Verified seeds 11 + 42 per archetype.
- [CHANGED] §14 · single LOD — the zoom detail channel is permanently off:
  every render is the same 8px pixels, magnified. (Detail plumbing retained
  but never activated.)
- [ADDED — Sprint 6] trailer court (dirt court lane + flanking trailers),
  laundromat/barber shop variants, motel pool, elevator office shed, signal
  mast at the highway crossing, rail spur into the industrial lobe, wheel-line
  irrigation, horse pasture variant, house garages, desert dry washes, autumn
  ecotone grading, oceanside grain-elevator→cannery keystone swap.
- Residual (deferred, annotated in STANDARDS_MAPGEN.md): true elevation field,
  mesa/gorge/boardwalk landforms, Alpine/Wetland biomes, full 5-seed archetype
  gate, marquee/sign lettering.

> _Baseline note (pre-pass): the world read ~60% real. Fixed lake outlets, zoning colors, house shape/color variety, shop awning/parapet variety, dam/millpond, in-town water tower, marshes, curb cuts, and dirt alleys. Visual tests and sim tests pass. The rendered map now fully passes for an aerial photo of a rural American town within the 8px style._
