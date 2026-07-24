# PLAN — Town generation, assets, cars & pathing upgrade

_Planned 2026-07-24. Grounded in the code as it stands, not in DESIGN.md.
Sequencing, contracts and evidence gates follow the Build Tree Framework._

---

## 0. The one fact that shapes everything

**Two of these four workstreams sit on opposite sides of the determinism
contract**, and that — not size — is what should drive the order.

| Workstream | Lives in | Inside the hash? | Risk |
|---|---|---|---|
| **A. Town generation** | `mapgen.ts`, `gridRoads.ts` | **YES** — world fields are hashed and snapshotted | **High** — a bad change desyncs lockstep |
| **B. Assets / fidelity** | `townRender.ts` | No — cosmetic boundary, floats allowed | Low |
| **C. Cars & traffic** | `townRender.ts` | No | Low |
| **D. Pathing (render-side)** | `townRender.ts` `roadPath()` | No | Low |

`HANDOFF.md §4` states the boundary explicitly: mapgen and `townRender`/
`recapCard` may use floats and are **not** hashed — but mapgen's *output* is.
So B/C/D can iterate freely and fast; A needs the full gate every time.

**Therefore: do B → D → C → A.** Ship the safe visual wins first, get the
pathing right underneath the cars, and take the hashed mapgen work last with the
most budget for verification. Doing A first would mean re-running the expensive
gate after every cosmetic tweak.

---

## 1. Baselines that must not regress

Every step below is measured against these. They already exist — no new
instrumentation needed except where noted.

**Performance** (B5.2.10, `node --cpu-prof`, 96² map):

| view | current | budget |
|---|---|---|
| full-map LOD1 | **160 ms/frame** (was 231) | must not exceed 160 |
| LOD3 | 10.0 ms | ≤ 12 ms (10 Hz) |
| LOD5 | 6.3 ms | ≤ 12 ms |

The client renders full zoom-out at ~3 Hz and zoomed views at 10 Hz. Cars and
denser assets are exactly the kind of change that quietly eats this, so **every
node in B and C carries a before/after frame-time number.** No number, no merge.

**Mapgen quality** (B1.4.19, `tools/mapmetrics.mjs`, farm 96², seeds 1/2/3/42/99):

```
roadConnectivity 0.991 · blocks 52 @ median 13 · 25 lot kinds @ 4.24 bits
nameCollisions 0 · farmShare 0.206 · waterShare 0.056
```

**Determinism**: `npm test` (sim 111 / server 17) + the cross-browser gate.
Only workstream A can break these, but the gate runs on all four anyway.

---

## 2. Workstream B — Asset upgrade (`townRender.ts`)

`ASSETS.md` is already the ledger, and every deferred item is a 🧩 row there
(B5.3.1 is the Stub-Law tracker). The plan is to **convert 🧩 rows to live**,
not to invent new assets.

**The trap to avoid:** the Visual QA Discipline's RESTRAINT clause. This
codebase has already been through a variety pass (B5.2.7) and a facade pass
(B5.2.6). Adding detail to a scene that already reads well makes it read
*worse*. So each node states what it *subtracts or replaces*, not just adds.

Proposed nodes, cheapest-and-most-visible first:

| ID | Node | Contract | Gate |
|---|---|---|---|
| B5.4.1 | **Seasonal crop stages** | `🧩 crop growth stages by match clock` — fields advance green→gold→stubble over the match. Reads match tick only; no new palette entries | 🖼️ + frame time |
| B5.4.2 | **Animated water** | `🧩 animated flow direction on the river` — ripple rows drift downstream; lake stays still. Direction from existing `cxs[]` | 🖼️ |
| B5.4.3 | **Night mode glow** | `🧩 night lamp glow` — streetlights and windows bloom at night. B5.2.8 already fixed `windowDark`; this extends to lamps | 🖼️ at 4 day phases |
| B5.4.4 | **Storefront signage** | `🧩 painted sign glyphs` on shops/diner. Uses the existing name corpus so signs read as the town's own businesses | 🖼️ RESTRAINT check — signage is the highest-risk-of-noise item here |
| B5.4.5 | **Level-crossing + trestle detail** | crossbucks already exist; add gates. `🧩 moving freight train` explicitly **CUT** for now — a moving train is a whole agent system, not an asset | ✂️ logged |

**Why B5.4.5 is partly a cut:** a moving freight train is workstream C in
disguise (an agent with a route and a schedule). Log it ✂️ rather than let it
smuggle scope into an asset pass.

---

## 3. Workstream D — Pathing upgrade (`roadPath()`)

Do this **before** cars, because cars ride on it. Reading the current
implementation (`townRender.ts:3704`), there are four concrete defects:

**D1 — the graph is unweighted.** BFS over `Road|Dirt` with a fixed 4-neighbour
order treats a dirt back-alley as equal to Main Street, so cars and walkers
route through alleys whenever the hop count ties. Real traffic prefers
arterials. *Fix:* Dijkstra with small integer weights (highway 1, street 2,
dirt/alley 4). Integer weights keep it deterministic; a binary heap or a
bucket queue keeps it near-BFS cost.

**D2 — the cache is unbounded.** `ROUTE_CACHE` is a `WeakMap<World, Map>` keyed
`from * n + to`, and nothing ever evicts. Every endpoint pair ever routed is
retained with its full path array for the life of the world. On a 96² map with
hundreds of residents doing lunch errands, that grows without limit.
*Fix:* an LRU bound (a few thousand entries) or — better — cache **per
destination** rather than per pair: one BFS from a destination yields the tree
for *every* origin, which is how the residents actually use it (many homes → a
few workplaces). That turns N searches into one.

**D3 — no turn cost.** Routes zig-zag across the grid where a human would take
one road then turn once. Straight-leg compression papers over this after the
fact. *Fix:* a small penalty for changing axis makes routes pick a road and
commit, which also makes the compression step cheaper and the result more
legible.

**D4 — pedestrians and vehicles share one graph.** Cars should not use footpaths
and pedestrians should prefer sidewalks. *Fix:* a `mode` parameter selecting the
walkable predicate and weights, with separate cache namespaces.

**Gate:** D is render-side, so no determinism risk — but it is on the hot path.
Node `B6.9` first: extend the existing profiling harness to report routing time
and cache size, so D1–D4 each land with a measured delta. The manifest records
a ~21 ms one-time warm-up today; that is the number to beat.

---

## 4. Workstream C — Car & traffic upgrade

B5.2.8 already did the hard part: cars are **agents**, not hash dressing —
driveway → in-lane driving with directional sprites → nose-in parking → owner
walks the last leg. The upgrade is the deferred layer on top.

| ID | Node | Contract |
|---|---|---|
| B5.5.1 | **Turning traffic at intersections** (`🧩` in ASSETS.md) | cars visibly slow and swing through the turn rather than pivoting on a pixel; requires D3's turn-aware routes to look intentional |
| B5.5.2 | **Signal-timed crossings** (explicitly DEFERRED by B5.2.8) | traffic lights cycle (`🧩 cycling phases`); cars queue at red, pedestrians wait for the walk phase. This is the single biggest "the town is alive" win available |
| B5.5.3 | **Vehicle variety by district** | delivery vans downtown, pickups on the farm fringe, school bus on a school route — reusing existing palette entries only |
| B5.5.4 | **Congestion read** | cars bunch behind a turning vehicle instead of passing through each other |

**Ordering note:** B5.5.2 depends on B5.5.1 which depends on D3. Signals before
turning looks broken; turning before weighted routes looks arbitrary. This chain
is the reason D precedes C.

**Restraint gate:** the Visual QA RESTRAINT clause applies hard here. More cars
is not better — cars must never obscure gameplay-critical information
(territory colour, front lines, unit dots). The acceptance criterion is
*legibility at LOD1 with a full match running*, not car count.

---

## 5. Workstream A — Town generation (the hashed one)

Three tranches, in increasing risk. All must hold the §1 metric baseline and
pass the cross-browser gate.

**A1 — `B1.4.21` transcendental-free mapgen** *(already an open manifest node)*
Replace the last three `Math.sin/cos/atan2` clusters — oceanside coastline
wobble (`mapgen.ts:916`), town footprint rim (`:1116–1169`), `organicBlob` rim
(`:2081–2087`) — with field-noise or LUT math. Risk is contained: B6.5 gates all
shipping engines on every push, and fields v2 already retired two of five
clusters. **Do this first in A** — it is the only tranche that reduces risk
rather than adding it, and it makes every later world-shape change safer.

**A2 — the deferred B1.4.12 reviewer items**
- `#1 river-anchored founding` — towns grow from the river crossing outward, which
  is how real towns sited themselves. Changes the town footprint ⇒ expect metric
  movement; judge by delta, not by pass/fail.
- `#15 curvilinear suburbs` — outer residential streets curve instead of
  gridding. **This one conflicts with the orthogonality invariant
  (`B1.4.17.5`: no corner-only contact, any seed).** Either the invariant gets an
  explicit carve-out for curved segments or the feature is ✂️ cut. *Decide before
  implementing* — this is a contract question, not a coding one.
- `#16 diagonal legacy road` — same conflict, same decision.

**A3 — asset-driven generation** (new)
Only after A1/A2 settle: place the assets B enabled where generation can reason
about them (e.g. signage needs business names on the right lots; signals need
intersections classified as major/minor). This is where A and B meet, and it is
last because it depends on both.

**Gate for every A node:** `npm test` + cross-browser determinism + 20-sample
QA render set with seeds logged (PROCGEN rule) + `tools/mapmetrics.mjs` delta
against the §1 baseline + a playability smoke (does the town still play?).

---

## 6. Order of work, and why

```
B5.4.x  assets          ← safe, visible, no dependencies
   ↓
B6.9    routing profiler ← so D can be measured
   ↓
D1–D4   pathing          ← cars ride on this
   ↓
B5.5.x  cars & signals   ← needs D3 turn costs to look intentional
   ↓
A1      transcendentals  ← reduces risk before touching world shape
   ↓
A2      river founding / curvilinear (contract decision first)
   ↓
A3      asset-driven generation
```

### Decisions — settled 2026-07-24

1. **Placement (H): you place the FIRST compound, the rest auto-place around it.**
   User-settled. The founding pick already exists (§18/B4.8), so the manual
   decision that matters — where you plant your first stake — is preserved, and
   every later building is bought rather than clicked onto a tile. This is a
   better answer than my auto-place-with-override suggestion: it keeps exactly
   one siting decision instead of repeating a weaker one every build.
2. **✂️ CUT: curvilinear suburbs (#15) and the diagonal legacy road (#16).**
   User: *"I don't want any diagonal roads, I like it how it is with the grid
   pattern."* This is the good outcome — both features conflicted with the
   orthogonality invariant `B1.4.17.5`, so cutting them **preserves the
   invariant intact** and removes the only contract conflict in workstream A.
   A2 now contains just `#1 river-anchored founding`.
3. **✂️ CUT: moving freight train** — an agent system wearing an asset costume.

## 7. What I will not do

- **No new palette entries without a cut.** B5.2.7 already passed a RESTRAINT
  gate; every added hue must justify itself or replace one.
- **No mapgen change without a metrics delta.** The B1.4.19 baseline exists
  precisely so world-shape changes are judged by number.
- **No car count increase as a "win".** Legibility at LOD1 is the criterion.
- **No touching `packages/sim` tick-path math** for any of this. Cars, routing
  and assets are render-side; if a node seems to need sim state, that is a
  design smell to raise, not to route around.

---

## 8. Added scope — building fidelity & vegetation (user-directed, 2026-07-24)

Grounded in an actual Visual QA pass, not assumption: rendered
`tools/spritesheet.mjs` (all lot icons) and `tools/qa_screenshots.mjs` (downtown
core, forest edge, four seasons, day/night) and looked at them.

### E — Building fidelity: 36 lot types, ~16 with real facades

`Lot` defines **36 building types**. B5.2.6 gave composed multi-tile facades to
roughly **16 anchors**. The rest still render as single-tile icons, and it shows.

**What the downtown-core render actually says:**
- The **church reads instantly** — steeple, white walls, correct silhouette.
  That is the bar, and it proves the facade system can hit it.
- **Almost nothing else announces what it is.** School, sheriff, post office,
  bank and office are near-identical tan/grey slabs at LOD1. A player cannot
  tell which building grants which civic effect without the HUD panel — which
  breaks the "which buildings do I take over" decision the strategy work just
  made load-bearing.
- **Flat-slab problem**: several lots are featureless rectangles with no roof
  band, window rhythm, or entrance.
- **Residential repetition**: house variants exist (B5.2.7) but *cluster* — the
  same red-roof house repeats along a run. The defect is variant **distribution**,
  not variant count.

| ID | Node | Contract |
|---|---|---|
| E1 | **Key-building identity pass** | Each of the 7 guaranteed keystones (elementary, high school, sheriff, grocery, church, fire, gas) is identifiable **from silhouette + colour alone at LOD1**, without labels. Church is the reference. Gate: a blind-ID test — render each and confirm it reads as what it is. |
| E2 | **Facade coverage for the remaining ~20 types** | Every lot ≥2 tiles gets a composed facade (roof band, wall texture, window rhythm, signed entrance). Single-tile lots get a distinguishing motif instead. |
| E3 | **Variant distribution, not variant count** | Break house clustering — vary roof tone/plan by lot hash so runs don't repeat. **No new palette entries**; this is a distribution fix. |
| E4 | **Missing-asset sweep** | Walk the 36 types against the render and list what has no distinct form at all; fill the gaps. |

E1 is first and highest value: it serves the gameplay decision, not just looks.

### F — Vegetation & forest overhaul

The forest-edge render is the weakest terrain in the game, and it is a
single-pass fix rather than an art-asset problem.

**What is wrong, specifically:**
1. **Forest is a flat two-tone mass.** No individual canopies, no size variation,
   no understory. At LOD3 you should see trees; you see a green blob.
2. **No edge feathering.** Woodland meets grass on a hard line — no scrub
   margin, no scattered outlier trees. Real edges transition.
3. **Uniform fleck density.** Wildflower/scrub specks are spread evenly across
   every grass tile, which reads as noise rather than as patches.
4. **Grass mottle is too large and too soft** — it reads as a texture artifact
   rather than as meadow relief.

Crops and pastures are the *strongest* terrain (row striping and livestock both
work), so the fix is to bring woodland up to that standard.

| ID | Node | Contract |
|---|---|---|
| F1 | **Canopy individuation** | Trees get per-tree size/tone variation from the tile hash so a stand reads as trees, not a mass. |
| F2 | **Edge feathering** | A scrub/sapling margin ring where woods meet open ground; scattered outliers beyond it. Pairs with the existing `B1.4.11.9` riparian bias. |
| F3 | **Clustered ground cover** | Flecks driven by a low-frequency field so flowers appear in patches. Also fixes #4 by giving the eye real structure. |
| F4 | **Seasonal vegetation response** | Woods and ground cover shift per season — the QA tool already renders spring/summer/fall/winter × day/night, so the evidence gate exists. Winter especially: bare deciduous vs conifer. |

### G — Seasons & time of day

`tools/qa_screenshots.mjs` **already renders the full matrix** (4 seasons ×
day/night). So this is a quality pass with an existing gate, not new plumbing.
Fold F4 in here, plus B5.4.3 night glow. Judge every change against the same
six renders.

### Revised order

```
E1 key-building identity   ← serves the strategy decision; highest value
F1-F3 vegetation           ← biggest "realistic town" win per unit of work
E2/E4 facade coverage + missing assets
G/F4 seasonal + night polish
E3 variant distribution
   ↓ (then the original plan)
B6.9 → D pathing → C cars → A1 → A2(#1 only)
```

E and F are both render-side, so they carry no determinism risk and can start
immediately — but they do consume frame budget, so §1's 160 ms full-map ceiling
applies to every one of them.

---

## 9. Added scope — cult buildings, placement UX, siting realism (user-directed)

### H — Cult buildings: purchase → auto-place → construction animation

**This is a gameplay change, not a visual one**, so it is called out separately
and needs its own contract. Requested model (OpenFront-style): the player *buys*
a building, the game *chooses the site*, and the building visibly *goes up*.

Today the flow is manual: BUILD arms a placement mode and the player clicks a
tile (`B4.8`, and `B8.15` gave every action a button). Moving to buy-and-
auto-place touches sim, not just render:

| ID | Node | Contract | Spine |
|---|---|---|---|
| H1 | **Auto-siting rule** | Given a building type and a player, pick the site deterministically from owned/legal ground — nearest-to-front for defensive types, nearest-to-density for economic. **Must be pure + fixed-point + seeded**: this runs inside `applyIntent`, so it is inside the determinism contract. | B1 🎮 |
| H2 | **Construction state** | Buildings gain a `buildTicksLeft`; they occupy their tile immediately but grant no effect until complete. Adds a field to the hashed state ⇒ **snapshot version bump** and a round-trip test. | B1 🎮 |
| H3 | **Construction animation** | Scaffold → frame → finished, driven by `buildTicksLeft`. Render-side, free of determinism risk. | B5 🖼️ |
| H4 | **Purchase UX** | Build tray becomes buy-and-forget; the camera flashes the chosen site (the `flashTile` affordance from `B4.9` already exists). | B4 🖼️ |

**Design caution worth raising before building it:** auto-placement removes a
decision the player currently makes. The strategy work this session was about
*adding* meaningful choices, and siting a compound near a front vs. deep in safe
territory is a real one. Recommendation: **auto-place as the default with an
opt-in manual override** (buy → suggested site flashes → click elsewhere to
place manually). That keeps the convenience without deleting the decision.
H2's construction delay actually *adds* depth — a building under construction
is a vulnerable commitment, which is exactly the kind of tradeoff the Depth
Review wants.

### I — Siting realism: no farms in the forest

**Measured, not assumed.** A probe over seeds 11/21/42/77/99 at 96²:

| seed | farm tiles | ringed by woods (≥5 of 8 neighbours) |
|---|---|---|
| 11 | 1018 | 10 (1.0%) |
| 21 | 766 | 9 (1.2%) |
| 42 | 864 | 13 (1.5%) |
| 77 | 902 | 28 (**3.1%**) |
| 99 | 1117 | 9 (0.8%) |

So the "nature before farms" order invariant (`B1.4.16.3`) holds in bulk —
fields do wrap timber rather than the reverse — but **9–28 tiles per map leak
through as cultivated ground enclosed by trees.** Small counts, high visual
cost: an isolated gold patch inside a dark stand is exactly what the eye
catches.

| ID | Node | Contract |
|---|---|---|
| I1 | **Enclosed-farmland hygiene pass** | After `fillFarmBelt`, any cultivated tile with ≥5 of 8 wooded neighbours reverts to grass (or is felled into the field, whichever the surrounding parcel implies). Runs with the other post-passes (`B1.4.17`). |
| I2 | **INVARIANT test** | "no cultivated tile is enclosed by woods" — gated ×5 seeds, alongside the existing orthogonality and pop-floor gates. |

Mapgen-side ⇒ inside the hash ⇒ full gate + metrics delta (`farmShare` 0.206
baseline; a fix this small should move it by <0.005).

### J — Building footprints: what should be bigger than a house

The keystone engine already shrinks 3×2 → 2×2 → 2×1 → 1×1 (`B1.4.7.1`), and
that scan-based fix stopped anchors silently collapsing to 1×1. But the
*target* sizes were never revisited against realism. A grain elevator the same
footprint as a bungalow is why some blocks read wrong.

Proposed footprint tiers (to confirm before implementing):

| Tier | Types | Rationale |
|---|---|---|
| **Large (3×2+)** | Factory, Warehouse, Supermarket, HighSchool, School, Cannery, Sawmill, GrainElevator, Depot | industrial/institutional buildings dwarf houses in a real town |
| **Medium (2×2)** | Church, Chapel, Sheriff, FireStation, Bank, PostOffice, Library, Cinema, Motel, Office | civic anchors, already partly sized |
| **Small (1×1)** | Shop, Diner, GasStation, Barn, Silo, Greenhouse, WaterTower, Substation | genuinely house-scale or vertical-not-wide |

J pairs with **E2** (facade coverage): a bigger footprint is only an improvement
if the facade composes across it, which is precisely what `drawFacade` does.

### K — Yards, lawns and frontage realism

`B1.4.8.5` already dresses empty yards (mow stripes, shade tree, clothesline,
wildflowers, parcel fences) and `B1.4.8.1` fronts homes on the street. The gap
the downtown render shows is **uniformity**: every lawn is dressed to the same
density, so a block reads as a repeating tile rather than as neighbours who
maintain their yards differently.

| ID | Node | Contract |
|---|---|---|
| K1 | **Per-household yard character** | Tidiness varies by household hash — mown/overgrown, fenced/open, planted/bare. Same asset vocabulary, different distribution. Pairs with **E3**, which is the same class of fix for houses. |
| K2 | **Frontage depth by district** | Deep setbacks + long driveways on the fringe, shallow-to-zero downtown. Currently closer to uniform. |
| K3 | **Back-yard vs front-yard distinction** | Front = presentation (walk, planting, tidy), back = utility (shed, laundry, junk). Today both read alike. |

### Where this lands in the order

E1 (key-building identity) and F1–F3 (vegetation) stay first — both serve the
most-visible-per-unit-work test. Then:

```
E1 → F1-F3 → I1/I2 (farm-in-forest, cheap + measurable) → J footprints
   → E2/E4 facades → K yards → G/F4 seasonal → E3 distribution
   → H1-H4 cult buildings + placement UX (gameplay contract; needs the
     auto-place-vs-manual decision first)
   → B6.9 → D pathing → C cars → A1 → A2(#1)
```

H is sequenced late deliberately: it is the only item here that changes the
hashed state and removes a player decision, so it wants the auto-place/manual
question settled and the visual work stable underneath it.
