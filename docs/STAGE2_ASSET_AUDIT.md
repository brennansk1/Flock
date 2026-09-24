# Stage 2 — Asset & Worldgen Audit (baseline @ e64db12)

Phase 1 of Stage 2: a no-code-change audit of every generation feature and every sprite, run through both Dual-QA harnesses. Every item below gets a grade, the defect, an evidence reference (`docs/assets/audit/…`), and a disposition: **S2** = fixed in Stage 2, **S3** = deferred to the Stage 3 bulk-spriting pass.

**Grades:**
- **good**: ships as is.
- **weak**: reads, but is generic, noisy or off-era.
- **broken**: wrong or ugly output.
- **missing**: not rendered or not generated.

## 0. How the audit was run (and QA tooling defects found)

| Harness | Tool | Coverage |
|---|---|---|
| Worldgen overview | `tools/overview_grid.mjs` (new) | 5 town types × seeds 11/42/77; summer day, winter dusk, fall night → `overview.png`, `ov_winter_dusk.png`, `ov_fall_night.png` |
| Studio (A) | `tools/studio.mjs` (new): **difference-matte isolation**, where each subject is rendered with and without the asset and every unchanged pixel becomes flat `#181512` slate with 1px tile guides | 61 subjects in ROADMAP batches 2–5 → `2_…`, `3_…`, `4_…`, `5_…_summer_day.png` |
| Catalog (A+B) | `generate_catalog_inspection.mjs` + `tools/contact_sheet.mjs` (new) | all 121 catalog IDs, studio + map pairs |
| In-situ (B) | `tools/crop.mjs` | downtown, suburbs, high school, coast, sheriff close-ups |
| Animation | `tools/anim_strip.mjs` (new) | multi-frame strips `a_*.png` |
| Metrics | `mapmetrics.mjs`, `audit_mapgen.mjs` | 5 types × 5 seeds; 75-world invariants pass |

**The QA tools themselves had defects.** Several results before this audit were misleading:

| Tool | Defect | Grade | Fix |
|---|---|---|---|
| `generate_curated_suite.mjs` | Passed `{archetype}` instead of `{townType}`, so every "archetype" overview was the farm town | broken | fixed in e64db12 |
| `spritesheet.mjs` | Draws sprites on noisy grass, not slate; unusable for judging silhouettes | broken | replaced by `studio.mjs` (S2) |
| `vehicle_spritesheet.mjs` | Hard-coded Windows output path; the sheet shows two parked blobs and no fleet | broken | path fixed; a real fleet sheet comes with the S2 fleet |
| `generate_catalog_inspection.mjs` | About 25 IDs fall back to the same rail/depot map crop (silo, water tower, megachurch, radio tower, town hall, territory, …). Studio tiles clip multi-tile assets and paint a grass square behind every sprite. Uses legacy archetype ids (`final_dawn`…) | broken | S2: keep `studio.mjs` as the Harness A of record; retarget crops |

## 1. Worldgen: generation features

| Feature | Grade | Defect / evidence | Disp. |
|---|---|---|---|
| Town footprint & grid | **broken** | Every town type × seed is the same centred, square-ish orthogonal grid of 5×5 blocks with a highway cross (`overview.png`). There's no identity per type. | S2 |
| Farm town | weak | Readable, but the ~40%-wide town sits in a sea of identical fields; no grain-elevator / rail-siding focal point downtown | S2 (layout) |
| Lakeside | weak | The lake is a stair-stepped blob beside the town; the town never wraps the shore (seed 42 has lake arms cutting blocks) | S2 |
| Desert | weak | Desert sand biome around a *green* town island; no mesas, no adobe-town sparseness | S2 |
| Mountain | **broken** | There are no mountains: it's forest blobs on flat grass, the same as farm (`overview.png`). `Terrain.Rock` is unused. | S2 |
| Oceanside | **broken** | The sea is a strip on the map edge; the town stops 10–20 tiles short of it, and a lonely lighthouse sits on an empty beach (`crop_coast.png`). No boardwalk or pier in town. | S2 |
| Courthouse square | **missing** | TownHall is a 1-tile landmark icon inside an ordinary block; there's no square (`crop_downtown.png`) | S2 |
| Main Street | weak | A 4-row highway with crosswalk dashes; storefronts are small boxes ringing an empty green interior. No continuous party-wall frontage, no rear alleys or parking, no awnings. At rush hour there are no cars on Main St (`a_cars.png`). | S2 |
| Residential frontage | **broken** | The `crowded` rule in `rollLots` forces every other frontage tile to be an empty yard, so the street wall is gappy. Interiors are random garden speckle, not backyards (`crop_suburbs.png`). | S2 |
| Driveways / curb cuts | weak | Houses carry a 1px drive on some shapes; no curb cut in the sidewalk and no drive on E/W frontages | S2 |
| Backyards | weak | Interior tiles are noise (flowers/veg dots) instead of fence lines, sheds, pools, swing-sets | S2 |
| High school campus | **broken** | A 2×2 brick box indistinguishable from the elementary school, dropped inside a housing block. The ball field is a checkerboard; there's no track, bleachers or bus lot (`crop_highschool.png`, studio batch 3). | S2 |
| Rail siding + industry buffer | good | The spur, grain elevator and depot place correctly; the 6-tile buffer holds (audit passes) | — |
| Rivers | weak | Meander is fine; banks are stair-stepped 1-tile steps; no gravel bars or sandbars; water is a regular stripe texture | S2 |
| Coastline | **broken** | A hard staircase coast with a 2-tile sand strip; the surf line is static dots (`a_surf.png`) | S2 |
| Farms / farm belt | good | Varied parcels, farmsteads, shelterbelts | — |
| Terrain relief | **missing** | No elevation anywhere; mountain/desert types have no ridges or mesas | S2 |
| Grass ground | **broken** | Every grass tile is sprinkled with yellow/white/red flower pixels; at map scale it reads as noise and buries the town (`overview.png`) | S2 |
| Seasons: winter | weak | Snow is patchy (forest and desert biomes stay green or tan); snow speckle is noisy (`ov_winter_dusk` source) | S2 (grading pass) |
| Lighting: dusk | **broken** | Roads go purple and grass brown-magenta; **winter + dusk renders the whole map hot pink** (`ov_winter_dusk.png`) | S2 |
| Lighting: night | weak | Dark and readable, but the town glow is tiny; street lights barely register (`ov_fall_night.png`) | S3 |
| Metrics | good | roadConnectivity 0.98–1.0, blockMedian ~19, lot entropy 4.2–4.3 bits, 0 name collisions; 75/75 worlds clean | — |

## 2. Sprites by ROADMAP batch

### Batch 1: 1980s vehicle fleet

| ID | Asset | Grade | Defect | Disp. |
|---|---|---|---|---|
| NPC-06 | Passenger cars | **broken** | One 3×2 blob (`putCar`) for every car; no wagon, sedan, Blazer or pickup silhouettes; no cars on Main St at rush hour | S2 |
| — | Wood-panel station wagon | **missing** | only a colour entry in a parked-car palette | S2 |
| — | Chevy Blazer / pickup | **missing** | — | S2 |
| NPC-07 | Police cruisers | **broken** | 2px black/white dot pair; no bubble-light flash in any frame (`a_police.png`, `sheriff8.png`) | S2 |
| CIV-05 | School bus | weak | A 3px yellow strip at the curb; no hazard blink (`a_bus.png`) | S2 |
| — | BMX bikes | **missing** | not rendered anywhere | S2 |
| NPC-02/03 | CPA news van / deprogrammer bus | weak | generic boxes | S3 |
| CLT-02/08/14/20 | Cult vans | weak | identical grey van per cult; dormant system | S3 |
| NPC-01 | Tithe courier | weak | 2px dot; dormant system | S3 |

### Batch 2: Downtown & Main Street (studio `2_downtown_commercial_summer_day.png`)

| ID | Asset | Grade | Defect | Disp. |
|---|---|---|---|---|
| CIV-01 / LMK-05 | Town Hall / Courthouse | **missing** | The 1-tile landmark badge; `Lot.Courthouse` has no sprite (falls back to a shop grid) | S2 |
| COM-01/02 | Main St block / strip shop | weak | Readable party walls, but tiny awnings; windows lit by day; no signage; all shops share one façade | S2 |
| COM-03 | Diner | good | chrome + red stripe reads | — |
| COM-04 | Gas station | good | canopy + pumps read | — |
| COM-05 | Laundromat | weak | shares the shop façade | S3 |
| COM-06 | Cinema | weak | dark box; marquee is a yellow line; no neon chase | S3 |
| COM-07 | Bank | good | columns portico reads | — |
| COM-08 | Post office | weak | tiny flag, generic box | S3 |
| COM-09 | Office block | weak | flat grey slab | S3 |
| COM-10/11 | Motel / pool | good | long room row + pool | — |
| CIV-02 | Sheriff | weak | façade fine; cruiser stalls unreadable (see NPC-07) | S2 |
| CIV-08 | Supermarket | good | blue fascia + lot | — |
| CIV-11 | Fire station | good | red bays read instantly | — |
| ST-06/07/08/09 | Crosswalks / lights / stop signs / streetlights | good | fine at 8px | — |
| — | Parking lot | good | stalls + cars | — |

### Batch 3: Residential & school campus (studio `3_residential_school_summer_day.png`)

| ID | Asset | Grade | Defect | Disp. |
|---|---|---|---|---|
| RES-01..04 | Houses (Suburbs / OldTown / ResHigh) | weak | 4 shapes exist, but in-situ they read as near-identical red-roof boxes; siding palette narrow | S2 |
| — | College-district houses | **broken** | all six are the same dark-red box | S2 |
| — | Desert adobe | weak | same shapes in tan; no flat-roof/vigas adobe form | S2 |
| RES-05/06 | Trailer home / court | good | — | — |
| RES-07 | Detached garage | weak | rarely visible; no driveway link | S2 |
| RES-08 | Backyards | **broken** | speckle noise, not yards | S2 |
| RES-09 | Above-ground pool | weak | 2px cyan dot | S2 |
| RES-10 | Front curbside (mailbox / hydrant / tree) | good | — | — |
| RES-11 | Chimney smoke | weak | 1px puff, invisible at 3× (`a_smoke.png`) | S2 |
| CIV-03 | High school | **broken** | identical to the elementary school; no ribbon windows | S2 |
| CIV-04 | Athletic stadium / ball field | **broken** | checkerboard dither fill | S2 |
| — | Running track (`Lot.Track`) | **missing** | falls back to a shop grid | S2 |
| CIV-06 | Elementary school | weak | fine alone, but a twin of the HS | S2 (differentiate) |
| CIV-07 | Playground | **broken** | checkerboard dither | S3 |
| CIV-09 | Church | good | white steeple reads | — |
| — | Chapel | good | — | — |
| CIV-10 | Cemetery | **broken** | checkerboard dither | S3 |
| — | Library | weak | small grey box | S3 |
| — | Park | good | — | — |

### Batch 4: Industrial & countryside (studio `4_industrial_rural_summer_day.png`)

| ID | Asset | Grade | Defect | Disp. |
|---|---|---|---|---|
| COM-12 | Factory | good | saw-tooth roof reads | — |
| COM-13 | Warehouse | good | — | — |
| COM-14 | Depot station | good | timber platform | — |
| AGR-07/08 | Silo / grain elevator | good | — | — |
| — | Sawmill / Cannery | good | — | — |
| — | Substation | good | — | — |
| AGR-01..04 | Fields | good | — | — |
| AGR-05/06 | Farmstead / gambrel barn | good | — | — |
| — | Orchard | **broken** | checkerboard dither | S3 |
| AGR-09 | Pasture livestock | weak | random 1px dots, no cow silhouettes, no grazing motion (`a_livestock.png`) | S2 |
| AGR-10 | Farm machinery | weak | 2px blob | S3 |
| ST-10..14 | Rail / trestle / crossbuck / siding / boxcars | good | — | — |
| LMK-01..04 | Megachurch / radio tower / fairground / water tower | weak | Rendered as 1-tile *icon badges* in a frame, not world buildings; radio beacon blink not visible (`a_beacon.png`) | S2: beacon · S3: sprites |
| — | Dock / Lighthouse / Dam | good | — | — |

### Batch 5: Hydrology & foliage (studio `5_nature_hydro_summer_day.png`)

| ID | Asset | Grade | Defect | Disp. |
|---|---|---|---|---|
| ENV-01 | Temperate grass | **broken** | flower speckle noise (see §1) | S2 |
| ENV-02 | Rock outcrops | weak | 3px grey dot | S2 (with Rock terrain) |
| — | `Terrain.Rock` ridges | **missing** | renders as dotted grass | S2 |
| ENV-04/05/13 | Trees / woods / forest floor | good | — | — |
| ENV-14 | Autumn foliage | good | — | — |
| ENV-06/07 | River / creek | weak | stair-stepped banks, regular stripes; ripple animation faint (`a_river.png`) | S2 |
| — | Gravel bars / sandbars | **missing** | — | S2 |
| ENV-08 | Lake | weak | rectangular sand rim, hard corners | S2 |
| — | Ocean surf | **broken** | static white dot fringe on a staircase coast (`a_surf.png`) | S2 |
| ENV-09..12 | Desert dunes / saguaro / wash / oasis | good | — | — |
| ENV-15 | Riparian willows | good | — | — |
| ENV-16..20 | Poles / hedgerows / shelterbelts / stock pond / ecotones | good | — | — |

### Cult & NPC entities (Stage 3 batch; logged for completeness)

| ID | Grade | Note |
|---|---|---|
| CLT-01/07/13/19 compounds | good | strong, faction-coded silhouettes |
| CLT-04/10/16/22 signature buildings | good | — |
| CLT-03/09/15/21 agents | missing | nothing renders (dormant system); S3 decides keep or delete |
| CLT-05/11/17/23 territory | good | border lines render in-game (the catalog crop was wrong) |
| CLT-06/12/18/24 conquered lot | good | tinted lot |
| NPC-04 picket line | weak | 3 dots; S3 |
| NPC-05 residents | weak | 1px walkers barely visible at 3× (`a_walkers.png`); S2 makes them readable |

## 3. Micro-animations

| Animation | Grade | Evidence | Disp. |
|---|---|---|---|
| River ripples | weak | `a_river.png`: stripes shift ~1px; hard to perceive | S2 |
| Ocean surf foam | **broken** | `a_surf.png`: static | S2 |
| Police bubble lights | **missing** | `a_police.png`: identical frames | S2 |
| Bus hazards | **missing** | `a_bus.png` | S2 |
| Radio-tower beacon | weak | `a_beacon.png`: not visible at night | S2 |
| Winter chimney smoke | weak | `a_smoke.png`: 1px | S2 |
| Grazing livestock | weak | `a_livestock.png` | S2 |
| Walking residents | weak | `a_walkers.png` | S2 |
| BMX bikes | **missing** | — | S2 |
| Neon / flags | good | cinema & diner neon, flags present | — |

## 4. Stage 2 fix list (priority order)

1. **Town plan**:
   - Courthouse Square with storefronts facing it.
   - Solid Main St blocks with rear alleys and parking.
   - Unbroken residential frontage with a driveway on every house, and real backyards.
   - Edge-of-town HS campus (school, track and football field, bleachers, bus lot).
2. **Town-type geography**:
   - mountain: a valley between `Rock` ridges;
   - desert: `Rock` mesas and a sparse adobe town;
   - oceanside: the town fronts the shore with a boardwalk and pier;
   - lakeside: the town wraps the lake.
   Also smooth coastlines and banks, and add gravel bars and sandbars.
3. **Ground and grading**:
   - kill the grass speckle noise;
   - fix the dusk and winter colour grading (pink map);
   - consistent snow cover.
4. **Sprites**:
   - Courthouse, Track, football field, HS vs. elementary;
   - house variants (ranch, split-level, two-story, siding and roof palettes; College fix; adobe form);
   - shop awnings and signage, with no daytime-lit windows;
   - Rock ridges;
   - backyard kit (fence, shed, pool, swing-set).
5. **Fleet**: wagon, boxy sedan, Blazer and pickup silhouettes; bubble-light cruiser; school bus; BMX. Cars actually use Main St.
6. **Animations**: surf breakers, visible ripples, police lights, bus hazards, beacon, smoke, grazing cows, readable walkers, BMX.
7. **Linters** (`npm test`):
   - frontage;
   - driveways;
   - one campus per town;
   - a courthouse square;
   - nothing built on water or rock;
   - Rock blocks the spread of ideas.

**Deferred to Stage 3:**
- the checkerboard fills (orchard, cemetery, playground);
- landmark world sprites to replace the icon badges;
- cinema, post office, office and library façades;
- cult vans and agents;
- CPA vehicles;
- night-light polish.
