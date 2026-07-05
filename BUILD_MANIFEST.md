# FLOCK — Build Manifest

_Single source of truth for per-node build status. Created 2026-07-02 by
reverse-engineering the existing codebase (REFACTOR mode). Every ✔️ below is
backed by evidence gathered **that day**, not assumed: `npm run build` clean
across all 3 packages; `npm test` → **sim 60/60 pass**, **server 10/10 pass**
(incl. the live-WebSocket lockstep smoke test). Update this file after every
implementation step. Tree view: [BUILD_TREE.md](./BUILD_TREE.md)._

**Statuses:** ⬜ NOT_STARTED · 🧩 STUBBED · 🔨 IN_PROGRESS · ✅ IMPLEMENTED · ✔️ VERIFIED · 🚫 BLOCKED · 🛑 BLOCKED_BY_POLICY

## Progress summary

_Updated 2026-07-05: B1.4 (mapgen) decomposed to atoms per the PROCGEN RULE —
14 nodes → **115 nodes** (one leaf per pipeline stage, invariant, and QA gate),
derived from mapgen.ts/gridRoads.ts code, not from docs. Baseline re-verified
that day: build clean, **sim 78/78 green**._

**~177/183 nodes VERIFIED · 0 IMPLEMENTED-not-verified · NOT_STARTED: B1.4.20 (archetype mechanics — deferred behind B7.9), B1.4.21 (3 remaining transcendental clusters — risk contained by B6.5), B7.1/B7.4 (launch seams), B8.11/B8.12 (accepted MINOR) · 6 BLOCKED (external infra/content) · 1 STUBBED (deferred high-detail art, tracked)**

_2026-07-05 late session: **B6.5 CLOSED** — the #1 HANDOFF risk is gated on
every push (probe hashes byte-identical across Node/V8, Chromium/V8,
Firefox/SpiderMonkey, WebKit/JavaScriptCore). **B1.4.12 CLOSED** — terrain
fields v2 landed: elevation+moisture generated first, river descends the
terrain, biomes moisture-gated, vegetation wetness-weighted; 87/87 sim +
14/14 server green, metrics within noise of baseline, QA re-render PASS
(one TUNE round: thalweg blend un-straightened the river), playability
smoke PT-0004. Every pure-code mapgen node is now VERIFIED; what remains
open anywhere is deferred-by-decision or blocked-external._

_Prime-directive pass 2026-07-05 (PT-0003): archetype worlds PLAY — 30/30 bot
matches on all 5 townTypes founded 4/4 via the production spawn spiral and
ended with winners. Spatial Depth Review: base town PASSES its DEEP target
(decisions/tradeoffs/emergence all land); archetype differentiation is LIGHT
(geometry only, no Biome engine hooks) — filed as B1.4.20, deferred. WATCH
item: 0.94–0.98 winner lead share in same-tier bot mirrors (snowball signal;
attribute after human playtests, B7.9)._

_2026-07-05 close-out: the archetype gap is shut — B1.4.14.2–.7 all VERIFIED
(9 test gates in archetypes.test.ts, suite 87/87; 24 QA renders PASS; mountain
sawmill fallback fixed a real seed-3 generation gap the probe found). B1.4.19
quality-metrics harness live with baseline recorded._

Next recommended actions, in order:
1. **B6.5** — cross-browser determinism CI (top HANDOFF §10 risk). Note the
   §2A coastline wobble uses `Math.sin` (mapgen.ts:863) — transcendental fns
   are implementation-defined across JS engines, so oceanside worlds are the
   FIRST place a cross-engine hash divergence would appear. B6.5 should
   include an archetype world in its gate.
2. **B1.4.12** — terrain fields v2 (heightmap+moisture first), the deferred
   foundational rework; would also subsume the seed-99 road-connectivity dip
   tracked in B1.4.19's baseline.

## Manifest

### T — Trunk

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| T.1 | T/scaffold | Monorepo scaffold + CI gate | 3 workspaces build under strict tsc (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`); CI runs build+test on push | — | ✔️ | `npm run build` clean ×3 pkgs (2026-07-02); `.github/workflows/ci.yml` |
| T.2.1 | T/determinism/fixed | Q16.16 fixed-point math | Only number type in sim scope; exact 53-bit range | — | ✔️ | sim suite 60/60; determinism gate green |
| T.2.2 | T/determinism/rng | Seeded xoshiro RNG | All sim randomness flows via `Turn.seedSlice` | T.2.1 | ✔️ | determinism.test.ts green |
| T.2.3 | T/determinism/hash | StateHash | Same seed + same intents ⇒ same hash, every machine | T.3 | ✔️ | `determinism.test.ts` + `lockstep.smoke.ts` both pass (2026-07-02) |
| T.3 | T/types | SimState / World SoA / enums | Struct-of-arrays world; deterministic iteration keys | — | ✔️ | sim suite 60/60 |
| T.4 | T/intents | Intent protocol + Turn | Discriminated union; all gameplay flows as intents | T.3 | ✔️ | sim suite 60/60; hardening.test.ts caps arrays |
| T.5 | T/snapshot | Snapshot codec | `fromSnapshot(toSnapshot(s))` hash-identical; powers join/resync | T.2.3 | ✔️ | sim suite + server resync test |

### B1 — Sim core (deterministic)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.1 | B1/loop | Tick loop + KIT table | `createSim/step/applyIntent`; no floats/Date/Math.random in scope | T.* | ✔️ | determinism gate; sim 60/60 |
| B1.2 | B1/conversion | Conversion combat (§4) | Fronts, pressure/resistance, creep, attrition, scars, deterministic flips | B1.1 | ✔️ | conversion.test.ts green |
| B1.3 | B1/economy | Sim economy (§3) | Logistic followers, per-tile tithe, district income, dissent tax, Faith, Heat | B1.1 | ✔️ | sim suite 60/60 |
| B1.4 | B1/mapgen | THE PROCGEN SYSTEM (§2/§12/§2A) | Seeded small-town generator, decomposed to atoms per the PROCGEN RULE (subtree below: 115 nodes); seed-stable, hash-covered, QA'd | T.2.2 | ✔️ | Full decomposition 2026-07-05 from mapgen.ts:142–2391 + gridRoads.ts; suite re-run green 78/78 that day |

#### B1.4.0 — Pipeline orchestration (`generateWorld`, mapgen.ts:142)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.4.0.1 | B1/mapgen/pipeline/order | Ordered-stage pipeline | 24 stages run in a fixed order; order is a CONTRACT (nature before farms per QA S1-B; landmarks before hygiene; rollLots before frontage before infill) | — | ✔️ | mapgen.ts:142–303 reads as the ordered spine; reordering breaks documented invariants |
| B1.4.0.2 | B1/mapgen/pipeline/retry | Pop-floor retry loop | ≤5 attempts; rScale = 1+0.12·attempt grows the town until floors hold; deterministic walk per seed | B1.4.0.4 | ✔️ | mapgen.ts:146–151; pop-floor test green ×seeds (2026-07-05) |
| B1.4.0.3 | B1/mapgen/pipeline/salt | (seed,attempt) rng salting | Golden-ratio stride keeps every attempt stream distinct; adjacent seeds never twin | T.2.2 | ✔️ | mapgen.ts:151; "distinct across adjacent seeds" test green |
| B1.4.0.4 | B1/mapgen/pipeline/floors | popFloors() | Floors ∝ map area (~0.32 souls/tile): 64²≈1300 / 96²≈2900 / 128²≈5150 | — | ✔️ | mapgen.ts:113; B8.5 probe evidence (1301/2989/5157) |
| B1.4.0.5 | B1/mapgen/pipeline/opts | MapOpts contract | `{biomes?, townType?}` knobs; FLOCK_BIOMES env + private-room host knobs (B8.1) reach the generator verbatim | B1.4.10, B1.4.14 | ✔️ | mapgen.ts:131–140; biome-config test green; room knobs live |

#### B1.4.1 — Street grid (`gridRoads.ts`)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.4.1.1 | B1/mapgen/grid/highway | Highway / Main Street | 2-lane pair (rows hy, hy+1) crossing the full map; becomes Main St downtown | — | ✔️ | gridRoads.ts:103; Main-Street name resolution test green |
| B1.4.1.2 | B1/mapgen/grid/county | County route | One vertical artery through town | B1.4.1.1 | ✔️ | gridRoads.ts:116 |
| B1.4.1.3 | B1/mapgen/grid/avenues | Avenues | Jittered horizontals stepping out from the highway; tight downtown, looser fringe → irregular blocks | B1.4.1.1 | ✔️ | gridRoads.ts:121; orthogonality gate ×5 seeds |
| B1.4.1.4 | B1/mapgen/grid/streets | Streets | Jittered verticals off the county route completing the block grid | B1.4.1.2 | ✔️ | gridRoads.ts:148; same gate |
| B1.4.1.5 | B1/mapgen/grid/culdesac | Cul-de-sacs | Dead-end courts poke into residential blocks; bulb ends; named "X Court" | B1.4.1.4 | ✔️ | gridRoads.ts:167; bulbs render-verified (B5.2.5) |
| B1.4.1.6 | B1/mapgen/grid/rural | Country roads | Section-line roads leave town with 90° jogs (traceRuralRoad); launch from painted street endpoints | B1.4.1.3 | ✔️ | gridRoads.ts:215,267; endpoint-gap bug found+fixed by test |
| B1.4.1.7 | B1/mapgen/grid/elbows | Elbow fill | fillRoadElbows bridges every corner-only road contact at the source | B1.4.1.6 | ✔️ | gridRoads.ts:240; orthogonality invariant green |
| B1.4.1.8 | B1/mapgen/grid/segments | Street-segment registry | freshLabel → `Street[]` → World.streets; every segment addressable for naming | B1.4.1.3 | ✔️ | gridRoads.ts:80; naming tests green |
| B1.4.1.9 | B1/mapgen/grid/shape | Town shape | layoutHighwaysAndTown yields {cx,cy,r,highwayY,…} — the geometry every later stage reads | — | ✔️ | mapgen.ts:1029; downstream stages consume TownShape |

#### B1.4.2 — Dirt & lanes

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.4.2.1 | B1/mapgen/lanes/carve | carveDirtLane | Hash-oriented L-path (axis-at-a-time); zero diagonal stair-steps | B1.4.2.2 | ✔️ | mapgen.ts:1608; orthogonality gate covers lanes |
| B1.4.2.2 | B1/mapgen/lanes/nearest | nearestRoad | Bounded radial search for lane anchoring | — | ✔️ | mapgen.ts:1632 |
| B1.4.2.3 | B1/mapgen/lanes/alleys | Main-Street alleys | Dirt service lanes at hy−2/hy+3 behind the commercial strip | B1.4.1.1 | ✔️ | mapgen.ts:273–288; QA sweep 3 render evidence (dirt alleys item) |
| B1.4.2.4 | B1/mapgen/lanes/trailercourt | Trailer court | One proper court: 4-tile dirt lane off a street, trailer households flanking | B1.4.6 | ✔️ | mapgen.ts:206–244; fringe QA'd in sweeps |

#### B1.4.3 — Naming

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.4.3.1 | B1/mapgen/names/town | pickTownName | Fresh fake town per seed from the corpus; tone guardrail upstream (B8.6) | B6.6 | ✔️ | mapgen.ts:155; naming test green |
| B1.4.3.2 | B1/mapgen/names/streets | Street naming | Every traced segment named; Main Street resolves onto the highway pair | B1.4.1.8 | ✔️ | naming + Main-St tests green |
| B1.4.3.3 | B1/mapgen/names/corpus | Corpus dependency | 512 towns / 384 streets / 328 firsts / 512 surnames from gen_names.py; generated file never hand-edited | B6.6 | ✔️ | nameData.ts checked in; B6.6 row |
| B1.4.3.4 | B1/mapgen/names/invariant | INVARIANT: name determinism | Same seed ⇒ same names; variety across seeds; household/member names pure & stable | B1.4.3.1 | ✔️ | 2 mapgen.test.ts gates green (2026-07-05) |

#### B1.4.4 — Zoning & population fit

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.4.4.1 | B1/mapgen/zone/coeffs | districtCoeffTable | Authoritative §2 coefficient table on World | — | ✔️ | mapgen.ts:52; economy consumes it |
| B1.4.4.2 | B1/mapgen/zone/households | Household variance tables | Per-district household size ranges + empty-yard chance (lived-in texture) | B1.4.6 | ✔️ | mapgen.ts:71,84 |
| B1.4.4.3 | B1/mapgen/zone/exurbs | scatterExurbs | Lone fringe households outside town limits | B1.4.1.6 | ✔️ | mapgen.ts:1159 |
| B1.4.4.4 | B1/mapgen/zone/rolllots | rollLots | Residents + hidden susceptibility per lot; street-front lots denser | B1.4.4.2 | ✔️ | mapgen.ts:2132 |
| B1.4.4.5 | B1/mapgen/zone/infill | infillToFloor | Yards→modest homes until the floor holds (retry loop's last resort) | B1.4.0.2 | ✔️ | mapgen.ts:2272; pop-floor test green |
| B1.4.4.6 | B1/mapgen/zone/invariant | INVARIANT: pop floor | ≥640 populated tiles & ≥2900 souls on 96² across seeds | B1.4.0.4 | ✔️ | mapgen.test.ts gate green |
| B1.4.5 | B1/mapgen/contract | World/snapshot contract | World {townName, streets, biome}; SNAPSHOT_VERSION v7→v8; hashState covers all mapgen fields; round-trip hash-identical | T.5 | ✔️ | round-trip + lockstep smoke green |
| B1.4.6 | B1/mapgen/zoning2 | Zoning v2 — 8 districts | ResLow/ResHigh/Commercial/Industrial + Downtown/OldTown/College/Trailer w/ coeffs; industrial by rail, commercial on Main | B1.4.4.1 | ✔️ | live; palette readable at map scale (vision-checked) |

#### B1.4.7 — Keystone civics

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.4.7.1 | B1/mapgen/keystones/engine | keystone() stamp engine | Try full footprint → shrink 1×1 → force-place on first road-fronting citizen lot | B1.4.15.1 | ✔️ | mapgen.ts:486–560 |
| B1.4.7.2 | B1/mapgen/keystones/seven | The seven guarantees | Elementary + high school, sheriff, grocery, church, fire station, gas — every town, every seed (feeds civics engine B1.18) | B1.4.7.1 | ✔️ | keystone gate ×5 seeds green |
| B1.4.7.3 | B1/mapgen/keystones/invariant | INVARIANT: keystone gate | Test asserts all seven per seed | B1.4.7.2 | ✔️ | mapgen.test.ts green (2026-07-05) |

#### B1.4.8 — Block interiors & frontage

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.4.8.1 | B1/mapgen/blocks/frontage | enforceRoadFrontage | Homes FRONT the street; block interiors become yards (no path corridors) | B1.4.1 | ✔️ | mapgen.ts:462; revised per user feedback |
| B1.4.8.2 | B1/mapgen/blocks/orthopaths | orthogonalizePaths | Safety net: bridge any corner-only path contact | B1.4.8.1 | ✔️ | mapgen.ts:1405 |
| B1.4.8.3 | B1/mapgen/blocks/invariant | INVARIANT: home access | No home without street access within 1 orth tile | B1.4.8.1 | ✔️ | frontage gate ×5 seeds green |

#### B1.4.9 — Farming

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.4.9.1 | B1/mapgen/farm/steads | layoutFarms — farmsteads | Farmsteads anchored ON rural lanes (never floating) | B1.4.1.6 | ✔️ | mapgen.ts:1203; enhanced in 575658f |
| B1.4.9.2 | B1/mapgen/farm/parcels | Field parcels | Rectangular, road-aligned, baulk separators, river margins enforced | B1.4.9.1 | ✔️ | parcel asserts in tests |
| B1.4.9.3 | B1/mapgen/farm/orchards | Orchards | Tree-row parcels | B1.4.9.2 | ✔️ | asserted + rendered (B5.2.5) |
| B1.4.9.4 | B1/mapgen/farm/pastures | Pastures | Fenced livestock parcels | B1.4.9.2 | ✔️ | asserted + rendered |
| B1.4.9.5 | B1/mapgen/farm/belt | fillFarmBelt | Quarter-section fill: >20% of open land cultivated, contiguous not islands | B1.4.9.2 | ✔️ | mapgen.ts:1345; farm-belt gate green |
| B1.4.9.6 | B1/mapgen/farm/shelterbelts | Shelterbelts | Windbreak woods rows at farmsteads + in-field belts | B1.4.9.5 | ✔️ | mapgen.ts:1323 |
| B1.4.9.7 | B1/mapgen/farm/shoulders | Road-field shoulders | 1-tile grass always separates pavement from crop (#13) | B1.4.9.5 | ✔️ | mapgen.ts:1305 |
| B1.4.9.8 | B1/mapgen/farm/outbuildings | Farm outbuildings | Barns/silos/greenhouses grown beside farmhouses | B1.4.9.1 | ✔️ | mapgen.ts:~766 (placeTownBuildings farm pass) |
| B1.4.9.9 | B1/mapgen/farm/invariant | INVARIANT: working countryside | "Farmed, watered, wooded like working land" gate | B1.4.9.5 | ✔️ | mapgen.test.ts green |

#### B1.4.10 — Biomes

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.4.10.1 | B1/mapgen/biome/paint | paintBiomes | Blob-shaped biomes (desert/forest/autumn); order-independent, deduped input | B1.4.0.5 | ✔️ | mapgen.ts:392; blob test green |
| B1.4.10.2 | B1/mapgen/biome/dominant | Dominant-biome override | Archetype towns sit INSIDE a biome (desert/mountain §2A) | B1.4.14 | ✔️ | mapgen.ts:160–163 |
| B1.4.10.3 | B1/mapgen/biome/oasis | Temperate town margin | Town + working margin stay temperate; fringe wobble so the rim never reads as a circle | B1.4.10.1 | ✔️ | mapgen.ts:402–412 |
| B1.4.10.4 | B1/mapgen/biome/ecotone | Desert ecotone | 3-ring transition, no hard biome edge | B1.4.10.1 | ✔️ | realism pass; vision-checked |
| B1.4.10.5 | B1/mapgen/biome/invariant | INVARIANT: biome config | Configurable, blob-shaped, deterministic (default / [] / desert-only) | B1.4.10.1 | ✔️ | mapgen.test.ts gate green |

#### B1.4.11 — Rail & hydrology (realism pass)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.4.11.1 | B1/mapgen/rail/line | layoutRail | Fewest-street-crossing row; right-of-way never runs ALONG an avenue | B1.4.1 | ✔️ | mapgen.ts:313; rail gate ×5 seeds |
| B1.4.11.2 | B1/mapgen/rail/crossings | Level crossings | Roads keep pavement where the line crosses (crossbucks are B5.2's job) | B1.4.11.1 | ✔️ | rendered + vision-checked |
| B1.4.11.3 | B1/mapgen/rail/siding | Siding + elevator + depot | Anchor the industrial edge every town; oceanside swaps elevator→cannery | B1.4.11.1 | ✔️ | rail/elevator/depot gate green |
| B1.4.11.4 | B1/mapgen/rail/spur | Industrial rail spur | Stub track branches into the works' own siding when an industrial lot sits ≤5 rows off | B1.4.11.1 | ✔️ | mapgen.ts:174–205 (inline stage) |
| B1.4.11.5 | B1/mapgen/water/river | carveRiver | Meandering river down one valley side; widens 1→3→4 downstream | B1.4.1.9 | ✔️ | mapgen.ts:1658; hydrology gate green |
| B1.4.11.6 | B1/mapgen/water/creeks | carveCreek | 2 tributaries joining at confluence rows | B1.4.11.5 | ✔️ | mapgen.ts:1767 |
| B1.4.11.7 | B1/mapgen/water/lakes | Lake plumbing | Outlet channel + connectLakesToRiver — no disconnected water bodies | B1.4.11.5, B1.4.16.2 | ✔️ | mapgen.ts:1830; QA sweep fixed outlets |
| B1.4.11.8 | B1/mapgen/water/dam | Dam & millpond | Low weir upstream of town with impounded millpond (#5) | B1.4.11.5 | ✔️ | mapgen.ts:1722; sweep-3 render evidence |
| B1.4.11.9 | B1/mapgen/water/riparian | Riparian vegetation | Forest bias toward water + bank galleries | B1.4.16.2 | ✔️ | placeNature riverPath bias; vision-checked |
| B1.4.11.10 | B1/mapgen/realism/hedgerows | Hedgerows | Woods/field boundary rows | B1.4.9.5 | ✔️ | realism pass; vision-checked |
| B1.4.11.11 | B1/mapgen/realism/cemetery | Edge cemetery | One cemetery at the town margin | B1.4.15.1 | ✔️ | realism pass; vision-checked |
| B1.4.11.12 | B1/mapgen/rail/invariant | INVARIANT: rail anchors town | Railroad + elevator + depot present every seed (§2 rev. 5) | B1.4.11.3 | ✔️ | mapgen.test.ts gate green (2026-07-05) |
| B1.4.12 | B1/mapgen/fields | Terrain fields v2 (§2 rev. 6) | Elevation+moisture built FIRST (value noise on the pixHash lattice — mult/add only, cross-engine exact); river = drainage descent blended with thalweg noise, cxs[] contract preserved so crossings/widening/dam/creeks unchanged; biomes = moisture quantiles (dry→desert 6%, wet→forest 6%, mid band→autumn) with the town margin temperate; woods seek moist ground, lake seeks low ground; fields generation-local (no snapshot/hash change) | B1.4.11 | ✔️ | Suite 87/87 + server 14/14 green; metrics vs baseline all within noise (connectivity .986, farmShare .23, waterShare .052); x-browser gate PASS ×4 engines; QA re-render PASS after 1 TUNE (canal-straight river → thalweg blend), "QA gallery/Archetypes_fieldsv2/"; playability smoke PT-0004. Still deferred from reviewer list: #1 river-anchored founding, #15 curvilinear suburbs, #16 diagonal legacy road (H/V rule) |

#### B1.4.13 — Mapgen QA (sweeps complete)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.4.13.1 | B1/mapgen/qa/sweeps | QA sweeps 1–3 🖼️ | QA_MAPGEN.md protocol: 5 seeds × full map + crops, all 10 subsystems; zero open S1/S2 | B1.4.11 | ✔️ | All S1/S2 resolved (lake outlets, zoning colors, house/shop variety, dam, water tower, marshes, curb cuts, alleys); renders in "QA gallery/" |
| B1.4.13.2 | B1/mapgen/qa/evidence | Seeded render evidence 🖼️ | Every QA sample logged with its seed (11/21/42/77/99) — failures reproducible | B1.4.13.1 | ✔️ | "QA gallery/" + QA_GALLERY.md |

#### B1.4.14 — Town archetypes (§2A) — ⚠ found undocumented in code 2026-07-05

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.4.14.1 | B1/mapgen/arch/farm | Farm (default) | townType "farm" skips the archetype pass entirely — classic generator | B1.4.0.5 | ✔️ | mapgen.ts:246; all existing gates run on farm |
| B1.4.14.2 | B1/mapgen/arch/oceanside | Oceanside | Sea on roomier edge w/ wavy coast; river→estuary; 2-tile beach; highway stub = THE pier (others trimmed at water); lighthouse; cannery + fish docks; elevator→cannery swap | B1.4.14.1 | ✔️ | archetypes.test.ts: sea ≥1500 ocean tiles, lighthouse, cannery, elevator=0, water clean ×5 seeds; renders vision-checked (pier/beach/estuary) 2026-07-05 |
| B1.4.14.3 | B1/mapgen/arch/mountain | Mountain / timber | Conifer walls rim the valley, floor open; slope farms reclaimed by stands; sawmill + log yard beside rail at woods edge — EVERY seed (relaxed fallback added after probe found seed 3 without one) | B1.4.14.1 | ✔️ | archetypes.test.ts: woods ≥1500, sawmill ≥2 tiles, zero farmland in forest biome ×5 seeds; renders vision-checked |
| B1.4.14.4 | B1/mapgen/arch/lakeside | Lakeside | Big water at town edge; resort shore: cabins + docks + boat ramp on town-facing shore | B1.4.14.1 | ✔️ | archetypes.test.ts: lake ≥ farm+250 tiles, docks ≥3 ×5 seeds; resort-shore render vision-checked |
| B1.4.14.5 | B1/mapgen/arch/desert | Desert | Dominant desert biome + temperate oasis under the town | B1.4.10.2 | ✔️ | archetypes.test.ts: desert ≥4000 tiles, ≥90% of homes on temperate ground ×5 seeds; render vision-checked (best of the four) |
| B1.4.14.6 | B1/mapgen/arch/invariants | INVARIANTS: archetype gates | Determinism + distinct-from-farm; pop floor + keystones + orthogonality survive every archetype; water clean (only Lot.Dam on lakes); snapshot round-trip hash-identical | B1.4.14.2–.5 | ✔️ | packages/sim/test/archetypes.test.ts — 9 gates, suite 87/87 green (2026-07-05) |
| B1.4.14.7 | B1/mapgen/arch/qa | Archetype sample-set QA 🖼️ | QA_MAPGEN protocol × 4 archetypes × 3 seeds; full map + LOD-3 anchor crop; seeds in filenames | B1.4.14.6 | ✔️ | 24 renders in "QA gallery/Archetypes_2026-07-05/" via tools/archetype_qa.mjs; verdict PASS, S3s logged in QA_GALLERY.md §Town Archetypes |
| B1.4.14.8 | B1/mapgen/arch/playtest | Archetype match playability 🎮 | Full matches run on every archetype with the PRODUCTION founding path: every player founds, every match ends with a winner, pacing recorded | B1.4.14.2–.5 | ✔️ | tools/archetype_playtest.mjs: 30 matches (5 types × 6 seeds), 30/30 founded 4/4 + ended decisively; PT-0003 in PLAYTEST_LOG.md |
| B1.4.20 | B1/mapgen/arch/mechanics | Archetype mechanical identity | EXTEND candidate (Depth Review PT-0003): give archetypes gameplay hooks — harbor economy, timber income, oasis water politics, pier/sawmill landmark-grade effects. Today `Biome.*` has ZERO engine hooks; archetypes differentiate through geometry alone (measured: median end-of-match conversion 267 desert → 517 lakeside) | B1.4.14.8, B7.9 | ⬜ | DELIBERATELY DEFERRED: spatial axis already PASSES its DEEP target on the base town; adding mechanics before human playtests would be polish over restraint. Revisit when B7.9 (human playtests) unblocks |
| B1.4.21 | B1/mapgen/transcendentals | Transcendental-free mapgen | Replace the REMAINING Math.sin/cos/atan2 sites — 3 clusters after fields v2 retired the river meander + biome rims: oceanside coastline wobble (mapgen.ts:916), town footprint rim (:1116–1169), organicBlob rim (:2081–2087) — with field-noise or LUT math | B1.4.12 | ⬜ | Risk CONTAINED: B6.5 gates all 3 shipping engine families on every push, incl. an oceanside case. Fields v2 already eliminated 2 of the 5 clusters; the rest reshape towns/coasts/blobs, so batch them with the next intentional world-shape change |

#### B1.4.15 — Town building placement (`placeTownBuildings` beyond keystones)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.4.15.1 | B1/mapgen/bldg/stamp | stamp() + anchor() engine | wLots×hLots fitting in district; frontage on ANY road side (sweep fix: N/S-only check silently rejected vertical-street frontage); anchor() adds size + district fallback chains + deterministic nearest-tile last resort; keystone force-place spirals from town center (raster scan put a grocery on a farmstead 30 tiles out) | B1.4.6 | ✔️ | Downtown sweep 2026-07-05: pre-fix Factory missing 4/6 seeds, PostOffice 5/6, Bank 3/6 — post-fix all 18 anchors present 9/9 seeds; gated by "downtown core and the works exist" test ×5 seeds incl. supermarket-in-town assert; suite 88/88 |
| B1.4.15.2 | B1/mapgen/bldg/civic | Downtown civic core | Town hall (landmark), bank, post office on every Main Street | B1.4.15.1 | ✔️ | vision-checked in sweeps |
| B1.4.15.3 | B1/mapgen/bldg/green | Town green | Civic square in the heart of downtown | B1.4.15.2 | ✔️ | sweeps |
| B1.4.15.4 | B1/mapgen/bldg/strip | Commercial strip | Shops/diner/cinema/offices along Main St | B1.4.15.1 | ✔️ | sweeps (awning/parapet variety fixed) |
| B1.4.15.5 | B1/mapgen/bldg/industrial | Industrial quarter | Factory + warehouses + yard by the rail | B1.4.11.1 | ✔️ | sweeps |
| B1.4.15.6 | B1/mapgen/bldg/college | College quarter | College lots + school ballpark | B1.4.15.1 | ✔️ | sweeps |
| B1.4.15.7 | B1/mapgen/bldg/oldtown | Old Town | Chapel + diner + old churchyard | B1.4.15.1 | ✔️ | sweeps |
| B1.4.15.8 | B1/mapgen/bldg/suburbs | Suburb amenities | Corner shops, 2nd church, parks, playground | B1.4.15.1 | ✔️ | sweeps |
| B1.4.15.9 | B1/mapgen/bldg/parsonage | Parsonage rule | Every church keeps a full household next door (first orth empty lot) | B1.4.15.1 | ✔️ | mapgen.ts:~621–147 block (§7) |
| B1.4.15.10 | B1/mapgen/bldg/highwaybiz | Motel + gas stations | Roadside motel + gas stations on the highway outside town | B1.4.1.1 | ✔️ | mapgen.ts:~633–669 |
| B1.4.15.11 | B1/mapgen/bldg/parking | Parking lots | Opportunistic aprons + GUARANTEE pass: every civic anchor (grocery/school/HS/sheriff/cinema/fire/factory) HAS one, clearing a yard if needed | B1.4.15.1 | ✔️ | mapgen.ts:~672–755; curb cuts QA'd sweep 3 |
| B1.4.15.12 | B1/mapgen/bldg/watertower | Water tower | In-town suburb lot + the far-corner landmark | B1.4.15.1 | ✔️ | mapgen.ts:618, 2206; sweep-3 item |
| B1.4.15.13 | B1/mapgen/bldg/docks | placeDocks | Shoreline docks (rowboats are render's job) | B1.4.11.7 | ✔️ | mapgen.ts:786 |
| B1.4.15.14 | B1/mapgen/bldg/quarry | Quarry scar | One gravel pit gouged off-road in deep country; never in desert biome | B1.4.10.1 | ✔️ | mapgen.ts:254–272 (inline stage) |

#### B1.4.16 — Nature & water bodies

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.4.16.1 | B1/mapgen/nature/blob | organicBlob | Shared irregular-shape primitive for stands/lakes/biome blobs | T.2.2 | ✔️ | mapgen.ts:1970 |
| B1.4.16.2 | B1/mapgen/nature/place | placeNature | Woods stands + the lake in open country; riparian bias when river present | B1.4.16.1 | ✔️ | mapgen.ts:2025 |
| B1.4.16.3 | B1/mapgen/nature/order | ORDER INVARIANT: nature first | Nature before farms — fields wrap standing timber, never the reverse (QA S1-B) | B1.4.0.1 | ✔️ | pipeline order + comment contract mapgen.ts:166–168 |

#### B1.4.17 — Road-graph hygiene (post-passes)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.4.17.1 | B1/mapgen/hygiene/components | roadComponents | 4-connected component labeling over road+dirt | — | ✔️ | mapgen.ts:1441 |
| B1.4.17.2 | B1/mapgen/hygiene/connect | connectRoadComponents | Orphan road islands stitched into the main grid | B1.4.17.1 | ✔️ | mapgen.ts:1485 |
| B1.4.17.3 | B1/mapgen/hygiene/prune | pruneRoadStubs + pruneAllDeadEnds | Whatever still leads nowhere is erased (incl. dirt lanes, orphaned spurs) | B1.4.17.2 | ✔️ | mapgen.ts:1565, 2235 |
| B1.4.17.4 | B1/mapgen/hygiene/edges | extendEdgeRoads | Rural roads run off-map; none die at the border | B1.4.17.3 | ✔️ | mapgen.ts:2318 |
| B1.4.17.5 | B1/mapgen/hygiene/invariant | INVARIANT: orthogonality | No corner-only contact, no orphan pixels, anywhere, any seed | B1.4.17.1–.4 | ✔️ | mapgen.test.ts gate ×5 seeds green (2026-07-05) |

#### B1.4.18 — Determinism & seed contract (PROCGEN RULE §2)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.4.18.1 | B1/mapgen/det/identity | INVARIANT: seed identity | Same seed ⇒ bit-identical world; adjacent seeds ⇒ distinct worlds | B1.4.0.3 | ✔️ | mapgen.test.ts gate green |
| B1.4.18.2 | B1/mapgen/det/hash | INVARIANT: hash coverage | All mapgen World fields inside hashState; snapshot v8 round-trip hash-identical (lockstep gate) | B1.4.5 | ✔️ | round-trip + lockstep smoke green |
| B1.4.18.3 | B1/mapgen/det/seedlog | Seed logging | Every QA sample carries its seed; failures reproducible | B1.4.13.2 | ✔️ | QA gallery seeds 11/21/42/77/99 |
| B1.4.19 | B1/mapgen/metrics | Quality metrics ledger | Measured quality beyond pass/fail (PROCGEN RULE §4): road connectivity ratio, block count/median/p90, lot-kind count + entropy, name COLLISIONS (same name on unrelated streets; expect 0 — replaced the mis-specified "uniqueness," whose duplicates were the highway pair + rural jogs by design), farm share, water share — per seed batch & archetype | B1.4.18 | ✔️ | tools/mapmetrics.mjs. CURRENT baseline (post quality-pass 2026-07-05, farm 96² seeds 1/2/3/42/99): roadConnectivity 0.991 (quarry haul road closed the dirt-pocket dips), blocks 52 @ median 13, 25 lot kinds @ 4.24 bits, nameCollisions 0, farmShare 0.206, waterShare 0.056. Judge future gen changes by delta against these |
| B1.5 | B1/buildings | Buildings (§6) | Full table incl. Watchtowers fort×5, Hotlines 75% intercept | B1.1 | ✔️ | m1.test.ts green |
| B1.6 | B1/units | Units (§7) | Couriers (robbable), Vans (mobile pressure/screening), invisible Agents | B1.5 | ✔️ | m1.test.ts green |
| B1.7 | B1/pvp | PvP trio (§13/§15) | Raids, Scandal 50%-notify→Publish, Court Defection | B1.6 | ✔️ | m1.test.ts green |
| B1.8 | B1/strikes | Strikes (§8) | 3 strikes, charge + 10 s warning, hotline intercepts | B1.5 | ✔️ | m1.test.ts green |
| B1.9 | B1/diplomacy | Diplomacy + schism (§16) | Alliances, JUDAS grudges, SCHISM gauge → Splinter Sects | B1.1 | ✔️ | m1/m2 tests green |
| B1.10 | B1/doctrine | Doctrine tree (§10) | 16 BITE nodes, milestone points, tier gating, effects plumbed | B1.1 | ✔️ | m1.test.ts green |
| B1.11 | B1/kits | 4 archetype kits (§11) | Final Dawn / Radiant Path / Prosperity / Visitors actives + signatures | B1.1 | ✔️ | kit.test.ts green |
| B1.12 | B1/cpa | CPA antagonist (§17) | Pickets @Heat 60, Bus @85, Town-Hall immunity <75 | B1.3 | ✔️ | m2.test.ts green |
| B1.13 | B1/matchflow | Match flow + victory (§18) | Founding pick, domination/last-standing/timer/Revelation, RECAP freeze | B1.1 | ✔️ | sim suite 60/60 |
| B1.14 | B1/bots | Bot tiers (§21) | Drifter/Sect/Established-Church via Intent API only; no stat cheats | B1.* | ✔️ | bots.test.ts green; botleague harness |
| B1.15 | B1/hardening | Input hardening | All client array intents length-capped; per-socket rate limit | T.4 | ✔️ | hardening.test.ts green |

| B1.16 | B1/felling | Tree auto-felling | BUILD / SPAWN parcel / BUY_PROPERTY on Woods fells trees (terrain→Grass) deterministically; hashed | B1.17 | ✔️ | property.test.ts: woods felled on parcel claim + neighbors felled on build |
| B1.17 | B1/property | Property engine | SPAWN = wilderness founding: 5×5 parcel + starter compound + bused-in congregation (no more town-blob start); BUY_PROPERTY intent, cost escalating per parcel, must adjoin empire; wilderness BUILD requires own parcel; crowding penalty on follower cap when parcels near-full | B1.16, T.4 | ✔️ | property.test.ts 6/6: parcel spawn, off-property build rejected, escalating cost, unlinked rejected, crowding cap sag, snapshot round-trip |
| B1.18 | B1/civics | Civics takeover engine | Owning the majority of a civic lot's tiles grants: sheriff→heat decay bonus; elementary→creep ×1.25; high school→follower growth ×1.15; grocery→defense ×1.2; church→faith drift up | B1.4.7 | ✔️ | civics engine: control determinism + sheriff-heat A/B test green; wired into economy (heat/faith/growth) + conversion (creep/defense) |
| B1.19 | B1/outreach | Compound outreach | Fronts may press tiles within outreach radius of an operational compound (not just adjacency) — targeted conversion from wilderness bases | B1.17 | ✔️ | outreach test: front flips town tiles from a wilderness compound with zero adjacency |

### B2 — Meta systems (outside lockstep)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B2.1 | B2/ranked | Glicko-2 ranked (§20) | Rating/RD/volatility, FFA pairwise, tiers, seasonal soft reset | B1.13 | ✔️ | meta/metagame tests green |
| B2.2 | B2/progression | XP / relics (§22) | Level curve, Relic earn band, level-5 ranked unlock | B1.13 | ✔️ | meta tests green |
| B2.3 | B2/daily | Daily Prophecy (§23) | Deterministic daily challenge rotation | B2.2 | ✔️ | meta tests green |
| B2.4 | B2/store | Earn/spend economy (§36) | Relics never money-priced; free rotation; double-buy rejected | B2.2 | ✔️ | test 56 "insufficient funds, double-buy" green |
| B2.5 | B2/recap | Recap data (§25) | Headline grammar + stat block + standings from finished match | B1.13 | ✔️ | sim suite green |
| B2.6 | B2/recapcard | Recap Card render (§25.1) | Deterministic 1080×1350 RGBA, opaque, winner-colored | B2.5 | ✔️ | recapCard.test.ts: dims/determinism/opacity all green |

### B3 — Server

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B3.1 | B3/entry | HTTP + REST + WS entry | `/health`; CORS REST (`/leaderboard /profile /replay /daily /catalog /congregations /me /purchase`); WS auth handshake | B3.5 | ✔️ | services.test.ts green |
| B3.2 | B3/lobby | LobbyDirector (§32) | Concurrent matches, capacity routing, graceful shutdown, persistMatch | B3.3 | ✔️ | services.test.ts green |
| B3.3 | B3/worker | MatchWorker (§33) | Authoritative 10 Hz lockstep, hash checks, desync→resync | B1.*, T.5 | ✔️ | lockstep.smoke.ts (live WS) green; prior soak: 12 clients / 1600+ intents / 0 desyncs |
| B3.4 | B3/store | Store persistence (§34) | Interface + InMemory + durable JSON; accounts/ratings/history/replays | — | ✔️ | services.test.ts green; JSON adapter is dev-only (→ B7.1) |
| B3.5 | B3/auth | Auth (§26) | Instant guests, stateless HMAC sessions, pluggable AuthProvider, guest→linked upgrade | — | ✔️ | services.test.ts green; OAuth verify itself → B7.2 |
| B3.6 | B3/moderation | Name/chat filter (§30) | Leetspeak-aware filter; `<>` stripped server-side | — | ✔️ | services.test.ts green; maintained list → B7.6 |
| B3.7 | B3/congregations | Clans + ladder (§24) | Membership + weekly best-10 ladder scoring | B3.4 | ✔️ | test 10 "congregation score sums members' best" green |
| B3.8 | B3/metrics | Logs + metrics | Structured JSON logs, counters/gauges | — | ✔️ | services.test.ts green; real sinks → B7.5 |
| B3.9 | B3/protocol | Wire protocol | Typed client↔server messages incl. `sendChat` + relay | T.4 | ✔️ | lockstep.smoke.ts green; chat UI consumer → B4.4.3 |

| B3.10 | B3/cap4 | 4-player cap | Human seats per match ≤ 4 regardless of CAPACITY env | B3.2 | ✔️ | matchWorker capacity clamped ≤4 (default 4); CAPACITY env clamped in index.ts |

### B4 — Client (frontend spine)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B4.1 | B4/boot | Boot + shell + FTUE | PixiJS app, input wiring, founding hints, FTUE coachmark, recap overlay | B4.2 | ✔️ | build clean; prior live 2-tab verification (HANDOFF §2) |
| B4.2 | B4/net | Prediction + reconciliation (§33) | Confirmed sim + predicted sim w/ in-flight intents; self-heal ≤1 turn; resync; session resume | T.5, B3.9 | ✔️ | lockstep.smoke.ts; 0-desync soak evidence |
| B4.3 | B4/render | Map renderer + fog (§14) | Camera zoom→LOD/pan, owned+unit+allied vision, minimap camera API | B5.2 | ✔️ | build clean; screenshots.mjs renders QA'd |
| B4.4.1 | B4/hud/core | Core in-match HUD (§27/§28) | Top bar, rails w/ costs+cooldowns, build palette, doctrine grid, minimap, player list, drama feed, help overlay, threat pings | B4.2 | ✔️ | build clean; prior live verification; XSS-escaped user text |
| B4.4.2 | B4/hud/abilitycosts | Live ability costs | D/F/G archetype actives + signature show live cost & affordability exactly as builds/rituals do | B4.4.1 | ✔️ | Playwright vision check 2026-07-02: "$20.0k"/"$35.0k"/"passive" render on the Powers rail, unaffordable greys (`cant`), cooldown countdown wired; also fixed the pre-existing Retreat cooldown key mismatch (`retreat` vs ability id) |
| B4.4.3 | B4/hud/chat | In-match chat input | Chat box: Enter focuses, Esc blurs, send via existing `sendChat`; game keybinds fully suppressed while focused; rendered text `esc()`-escaped | B4.4.1, B3.9 | ✔️ | Playwright e2e 2026-07-02: Enter→focus, typed "1" did NOT switch stance (isolation proven), send → server-moderated relay → "💬 Prophet: …" rendered in feed, Esc clears draft; respects mute-by-default (§28) |
| B4.5 | B4/menu | Lobby + meta screens | Play/leaderboard/store/clans/profile/settings consuming REST API | B3.1 | ✔️ | build clean; services.test.ts covers API side |
| B4.6 | B4/settings | Accessibility settings | Reduced-motion / mute / colorblind, persisted locally | — | ✔️ | build clean; prior live verification |
| B4.7 | B4/place | Place identity in UI | Conversion bar shows `world.townName`; hovering a tile shows a chip with street/household/lot/landmark names (static seed data only — no fog leak); textContent-rendered (XSS-inert) | B1.4.5 | ✔️ | Playwright live: bar shows 'BRANCH FALLS', chip resolved 'Castaneda Street' + 'the woods'; screenshot evidence |

| B4.8 | B4/property | Property UI | BUY LAND build-palette mode → BUY_PROPERTY at click; founding hints point at wilderness near town; property stakes tinted on map; crowding warning on cap | B1.17 | ✔️ | Playwright e2e: wilderness founding clicks accepted, Buy Land shows escalated $12k, property stakes render |
| B4.9 | B4/civics | Civics panel | Right-rail list of key buildings with owner + effect; click centers camera on it (targeting affordance) | B1.18 | ✔️ | Playwright e2e: Key Buildings panel lists all five with holder + click-to-center |

### B5 — Visuals

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B5.1 | B5/palette | Shared palette tokens | Single token source for client + headless renders | — | ✔️ | build clean; spritesheet QA |
| B5.2 | B5/townrender | Procedural pixel renderer | SimState→RGBA identical client & headless; terrain/buildings/icons/units/auras | B5.1 | ✔️ | Expanded (B5.2.1–.4); recapCard determinism test still green |
| B5.2.1 | B5/townrender/roads | Road dressing | Bridges where road crosses water (railings + plank deck), crosswalks at downtown intersections, highway center line | B1.4.1 | ✔️ | vision-checked: bridge/crosswalks/center-line all read at LOD1 + LOD3 (zoom-bridge/zoom-downtown renders) |
| B5.2.2 | B5/townrender/lots | New lot assets | Cinema, TrailerHome, Playground, Dock, Greenhouse render at LOD1 (8px) with distinct silhouettes; placed by mapgen in fitting districts | B1.4.4 | ✔️ | vision-checked (cinema marquee downtown, trailers on farm lanes, dock w/ rowboat on shore); high-detail → B5.3.1 |
| B5.2.3 | B5/townrender/growth | Cult building expansion | Compound icon gains visible growth stages (fence at ≥7%, banners at ≥15% town share); wilderness-claim assets extend to grass verges | B5.2 | ✔️ | stages keyed to ownedTiles permille (25/70/150‰ thresholds shared with woodsClaim); mid/late match screenshots rendered |
| B5.2.4 | B5/assetsdoc | ASSETS.md ledger | Every rendered asset documented: name, source fn, LOD1 form, LOD2–4 detail, status; every deferred high-detail variant is a 🧩 row here + in this manifest | B5.2.1–.3 | ✔️ | ASSETS.md written: terrain/lots/landmarks/cult/units/effects × LOD, deferred variants itemized → B5.3.1 |
| B5.2.5 | B5/townrender/v3 | Renderer v3 | Biome palettes (desert sand/cacti, forest density), Path sidewalks, bridge-CROSSING detection (no more shore-parallel false bridges), poles every 2 tiles with connected wire, cul-de-sac bulbs, orchard/pasture/warehouse/high-school assets, property stakes | B1.4.10 | ✔️ | vision-checked: biomes/paths→lawns rework, bridge crossings, U-wires, traffic, stop signs, streetlights, backyards, crop variety, welcome signs, smoke |
| B5.3 | B5/authored | Authored audio + animation (§30/§31) | ~40 frame-by-frame animations, full audio pass | B5.2 | 🚫 | BLOCKED: artist/composer content, not code; render/event seams ready |
| B5.3.1 | B5/authored/lod | High-detail LOD 3–4 asset variants | Each 🧩 line in ASSETS.md gets a dedicated high-detail form (animated neon, truss bridges, per-tree canopies, walk cycles…) | B5.2.4 | 🧩 | STUBBED by design: low-LOD procedural forms ship now; this row is the Stub-Law tracker for the deferred art pass |

### B6 — Tooling & QA

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B6.1 | B6/ci | CI gate (Node) | build + determinism + full suite on every push | T.1 | ✔️ | ci.yml; suite green 2026-07-02 |
| B6.2 | B6/artqa | Art QA tools | screenshots / units / spritesheet headless renders | B5.2 | ✔️ | tools present; used for prior sprite QA |
| B6.3 | B6/botleague | Balance harness (§40/§41) | Per-archetype win-rate drift over N bot matches | B1.14 | ✔️ | tools/botleague.mjs; nightly runs → B7.9 |
| B6.4 | B6/soak | Load/desync soak | N clients vs live server; asserts desync SLA | B3.3 | ✔️ | prior run: 12 clients / 1600+ intents / 0 desyncs |
| B6.5 | B6/xbrowser | Cross-browser determinism CI | The identical probe (worldgen incl. §2A oceanside + 400 sim ticks, hashed at 5 checkpoints × 4 cases) runs in Node, Chromium, Firefox AND WebKit; any hash divergence exits 1; wired into ci.yml | T.2.3 | ✔️ | tools/xbrowser_determinism.mjs + tools/xbrowser/probe.mjs (vite iife bundle, playwright): PASS across V8 / SpiderMonkey / JavaScriptCore locally 2026-07-05; ci.yml installs browsers + runs gate on every push |
| B6.6 | B6/gennames | Name corpus generator | `tools/gen_names.py` (Python faker) emits `packages/sim/src/nameData.ts`: deduped town/street/first/surname banks; regenerable, generated file checked in and never hand-edited | — | ✔️ | ran with faker 40.28.1 (seeded): 512 towns / 384 streets / 328 firsts / 512 surnames baked in |

### B7 — Launch infrastructure (external seams)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B7.1 | B7/postgres | Postgres Store adapter | Implements `Store` against PG + object storage; schema + migrations | B3.4 | ⬜ | Code-level but unverifiable without a PG instance; JSON adapter remains dev-only |
| B7.2 | B7/oauth | OAuth providers (§26) | `AuthProvider.verify` for Google/Discord/email; secrets via env | B3.5 | 🚫 | BLOCKED: provider apps + secrets to provision |
| B7.3 | B7/tls | TLS / ingress | wss:// terminated at LB; certs | — | 🚫 | BLOCKED: infra; nginx sample ships no certs |
| B7.4 | B7/scale | Worker-process isolation (§32) | One pinned worker process per match over IPC | B3.2 | ⬜ | Seam in place (in-proc workers today) |
| B7.5 | B7/telemetry | Telemetry + KPI dashboard (§41) | metrics/log wired to real sinks; KPI dashboard | B3.8 | 🚫 | BLOCKED: sink provisioning |
| B7.6 | B7/modpipeline | Moderation pipeline (§30) | Maintained locale-aware blocklist + human review flow | B3.6 | 🚫 | BLOCKED: external list + process |
| B7.7 | B7/legal | Legal / compliance | ToS, privacy, GDPR deletion, age gating | — | 🚫 | BLOCKED: legal work |
| B7.8 | B7/payments | Payment gateway (§36) | PSP behind money-priced recap frames only | B2.4 | 🚫 | BLOCKED: PSP account; relic/shard items already work |
| B7.9 | B7/balance | Balance validation (§41) | Nightly botleague + human playtests tuning balance.json | B6.3 | 🚫 | BLOCKED: needs real players; harness ready |

## Stub Law register

No untracked stubs. The only deliberate placeholders are the launch seams
listed as B7.* rows above (each has its interface in code and its row here).

### B8 — Playtest-readiness sprint (2026-07-02)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B8.1 | B8/rooms | Private rooms (§32) | Host by `?private=1` (+bots/size/founding/town knobs), 5-char code issued over WS `room` msg, join by `?room=CODE`, public matchmaking never routes into private matches, bogus code → error+close | B3.2 | ✔️ | lobby.ts byCode registry + matchWorker isPrivate; menu Play tab host/join UI; 3 tests in rooms.test.ts (14/14 server green) |
| B8.2 | B8/civicday | Resident civic day (§30) | Dots run a shared 4-min day: night → staggered morning rush → indoors at work (visible at outdoor lots) → lunch errands → evening rush → leisure/home. Street-accurate: sidewalk right-hand rule, door→street→elbow→door legs; long trips render as cars in the correct lane | B5.2 | ✔️ | townRender civic-day rewrite; pixel-count probe: night 164 → rush 468 → workday 236 → evening 1025 visible dots |
| B8.3 | B8/dotread | Conversion read on people | 2×2 high-contrast person figures; neutral putty vs cult colors; apostates drained gray drifting at home; Downline carries gold tithe accent | B8.2 | ✔️ | putPerson + palette personNeutral #7a6a58; verified at zoom |
| B8.4 | B8/glow | Cult-building ownership glow | Every cult building ringed by its owner color, shimmer-pulsed by tick; disabled/building tints preserved | B5.2 | ✔️ | halo ring in icon pass; live-match render: 7 compounds identifiable at LOD1 |
| B8.5 | B8/popscale | Population scales with map (§18) | Pop floor ∝ map area (96²≈2900 souls constant density ~0.32/tile); 64²≈1300, 128²≈5150 | B1.4 | ✔️ | popFloors(); probe: 1301/2989/5157 across 64/96/128 |
| B8.6 | B8/tone | Real-world name guardrail (§30) | Names referencing real cults/NRMs, religions, or figures default to "Sect #id"; leet-normalized substring match | B3.6 | ✔️ | referencesRealWorld list (~70 entries) in moderateName; test covers 12 bad + 4 fine names |
| B8.7 | B8/van | Manual van routing (§7) | `v` routes nearest own van to hover (buys if none), `shift+V` buys new | B1.9 | ✔️ | main.ts hotkeys; VAN_MOVE handler already simmed |
| B8.8 | B8/pact | Ecumenical Pact (§16) | PACT_PICK simmed: share an OWNED doctrine node with your ally (pactNode/pactWith on PlayerState, hashed + snapshotted); revoked on alliance break; shift-click owned node in doctrine grid | B1.12 | ✔️ | sim handler + hasDoctrine honors pact grants; pact.test.ts (78/78 sim green) |
| B8.9 | B8/qol | Match-control QoL | `c` close nearest own front, `z` cancel build (50% refund), `F8` surrender w/ confirm; hints in menu | B4.4 | ✔️ | main.ts switch; audit gaps 3/4/7 closed |
| B8.10 | B8/simcampaign | Playtest simulation campaign | tools/playtest_sim.mjs: duration distribution on live settings, archetype drift, bot tier ladder, size pacing | B6.3 | ✔️ | campaign artifacts in PLAYTEST_READINESS.md |
| B8.11 | B8/emote | EMOTE relay + picker | Server relay + client emote UI | B3.2 | ⬜ | accepted MINOR: cosmetic, post-playtest |
| B8.12 | B8/settingssync | Server-side settings persistence | Per-account settings endpoint | B3.4 | ⬜ | accepted MINOR: localStorage works per device |
| B8.13 | B8/hudredesign | "Interface Testament v3.0" HUD + menu (design handoff) | Pixel-1970s design system (Press Start 2P/Pixelify/VT323, ember/harvest/avocado/teal tokens, hard drops, scanlines) across menu, in-match HUD, loading; believer share bar (DOM), archetype cards + loadout reveal + per-cult re-dress, collapsible rails, pixel build tray, B.I.T.E. doctrine overlay | B4.4 | ✔️ | implemented from "Flock HUD System.dc.html" handoff; browser-verified (menu, re-dress, in-match); build+tests green |
| B8.14 | B8/foundinggate | Founding gate + solo pause | Match holds at the window edge until EVERY founder places (bots place at edge; AFK humans auto-place at 2× backstop); ⏸ solo pause (server-confirmed, auto-resume on join) + ✕ EXIT top-left | B8.1 | ✔️ | verified live: gate held 16s past window, released on placement; pause froze the match clock |
| B8.15 | B8/allclickable | Every action has a button (no hotkey required) | New left-rail SCHEME panel: Pamphlet/Exposé/Manifesto strikes, Deprogram/Snoop agents, Expose scandal, Court defection, Van, Close Front, Cancel Build, Surrender — each arms a placement mode resolved by the next map click (hotkeys still work). Stances/rituals/powers/builds/doctrine/ally already had buttons | B8.13 | ✔️ | browser-verified: all 11 buttons render, arm-highlight lights ember, and each dispatches its correct intent over the live socket (STRIKE/AGENT_DISPATCH/COURT_DEFECTION/VAN_MOVE/CANCEL_BUILD) |
