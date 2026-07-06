# FLOCK — Build Tree

_Build Tree Framework state. Reverse-engineered from the existing codebase on
2026-07-02 (REFACTOR mode); statuses verified by re-running the full suite that
day (build clean; sim 60/60, server 10/10 incl. live-WS lockstep smoke).
**2026-07-05:** B1.4 mapgen decomposed to atoms per the PROCGEN RULE (14 → 115
nodes, one leaf per pipeline stage / invariant / QA gate, derived from code);
baseline re-verified (sim 78/78). Goal lens: [GOAL.md](./GOAL.md); session
recon: [RECON.md](./RECON.md)._
Companion ledger: [BUILD_MANIFEST.md](./BUILD_MANIFEST.md) — the single source
of truth for per-node status. Design spec references (§N) point into
[DESIGN.md](./DESIGN.md)._

**Legend:** ⬜ NOT_STARTED · 🧩 STUBBED · 🔨 IN_PROGRESS · ✅ IMPLEMENTED · ✔️ VERIFIED · 🚫 BLOCKED · 🛑 BLOCKED_BY_POLICY

```
T   ✔️ TRUNK — TypeScript monorepo + THE DETERMINISM CONTRACT (§32/§40)
├── T.1  ✔️ Workspace scaffold (npm workspaces, strict tsconfig, CI build+test gate)
├── T.2  ✔️ Determinism substrate
│   ├── T.2.1 ✔️ fixed.ts — Q16.16 fixed-point math (only number type in sim scope)
│   ├── T.2.2 ✔️ rng.ts — seeded xoshiro RNG (all randomness via turn stream)
│   └── T.2.3 ✔️ hash.ts — StateHash (the lockstep/CI gate)
├── T.3  ✔️ types.ts — SimState, World (struct-of-arrays), core enums
├── T.4  ✔️ intents.ts — Intent protocol (discriminated union) + Turn
└── T.5  ✔️ snapshot.ts — toSnapshot/fromSnapshot join & resync codec

B1  ✔️ SIM — deterministic gameplay core (@flock/sim, runs bit-identically client & server)
├── B1.1  ✔️ sim.ts — createSim/step/applyIntent tick loop + KIT ability table
├── B1.2  ✔️ conversion.ts — fronts, pressure/resistance, creep, attrition, flips (§4)
├── B1.3  ✔️ economy.ts — followers, tithe, district income, dissent, Faith, Heat (§3)
├── B1.4  ✔️🎮 mapgen.ts + gridRoads.ts — THE PROCGEN SYSTEM (§2/§12/§2A)
│   │        Seeded small-town-America generator; 24 ordered stages inside a
│   │        pop-floor retry loop. Decomposed to atoms per the PROCGEN RULE:
│   │        one leaf per algorithm phase, invariant, metric, and QA gate.
│   │        (Render side is B5.2 — leaves here generate, they don't draw.)
│   ├── B1.4.0  ✔️ PIPELINE ORCHESTRATION — generateWorld (mapgen.ts:142)
│   │   ├── B1.4.0.1 ✔️ Ordered-stage pipeline — stage ORDER is a contract
│   │   │            (e.g. nature BEFORE farms so fields wrap timber, QA S1-B)
│   │   ├── B1.4.0.2 ✔️ Pop-floor retry loop — ≤5 attempts, rScale 1+0.12k
│   │   ├── B1.4.0.3 ✔️ Golden-ratio rng salt — every (seed,attempt) stream
│   │   │            distinct; fixed the adjacent-seed twin-town collision
│   │   ├── B1.4.0.4 ✔️ popFloors() — area-proportional floors (~0.32 souls/
│   │   │            tile: 64²≈1300 / 96²≈2900 / 128²≈5150) (feeds B8.5)
│   │   └── B1.4.0.5 ✔️ MapOpts contract — biomes[] + townType knobs;
│   │                FLOCK_BIOMES env + private-room host knobs plumbed
│   ├── B1.4.1  ✔️ STREET GRID — gridRoads.ts (axis-aligned; replaced tensor roads)
│   │   ├── B1.4.1.1 ✔️ Highway / Main Street — 2-lane pair (rows hy, hy+1)
│   │   ├── B1.4.1.2 ✔️ County route — the vertical artery
│   │   ├── B1.4.1.3 ✔️ Avenues — jittered horizontals stepping out from the
│   │   │            highway (tight downtown spacing, looser fringe)
│   │   ├── B1.4.1.4 ✔️ Streets — jittered verticals off the county route
│   │   │            → irregular real city blocks
│   │   ├── B1.4.1.5 ✔️ Cul-de-sacs — dead-end courts + bulbs in residential
│   │   │            blocks, named "X Court"
│   │   ├── B1.4.1.6 ✔️ Country roads — section-line roads leaving town with
│   │   │            90° jogs (traceRuralRoad; launch from painted endpoints)
│   │   ├── B1.4.1.7 ✔️ Elbow fill — fillRoadElbows bridges corner-only
│   │   │            road contact (orthogonality guarantee at the source)
│   │   ├── B1.4.1.8 ✔️ Street-segment registry — freshLabel → Street[] →
│   │   │            World.streets (every segment nameable)
│   │   └── B1.4.1.9 ✔️ Town shape — layoutHighwaysAndTown: cx/cy/r + highway
│   │                row + downtown extent (the geometry every stage reads)
│   ├── B1.4.2  ✔️ DIRT & LANES — the unpaved layer
│   │   ├── B1.4.2.1 ✔️ carveDirtLane — hash-oriented L-path (axis-at-a-time,
│   │   │            zero diagonal stair-steps)
│   │   ├── B1.4.2.2 ✔️ nearestRoad — bounded radial search (lane anchoring)
│   │   ├── B1.4.2.3 ✔️ Main-Street alleys — dirt service lanes at hy−2/hy+3
│   │   │            behind the commercial strip
│   │   └── B1.4.2.4 ✔️ Trailer court — one proper court: 4-tile dirt lane
│   │                off a street, trailers flanking (not just scatter)
│   ├── B1.4.3  ✔️ NAMING — deterministic place identity
│   │   ├── B1.4.3.1 ✔️ pickTownName — fresh town per seed from the corpus
│   │   ├── B1.4.3.2 ✔️ Street naming — every traced segment gets a corpus
│   │   │            name; Main Street resolves on the highway pair
│   │   ├── B1.4.3.3 ✔️ Corpus dependency — B6.6 gen_names.py banks (512
│   │   │            towns / 384 streets / 328 firsts / 512 surnames)
│   │   └── B1.4.3.4 ✔️ INVARIANT: name determinism + cross-seed variety +
│   │                household-name purity (mapgen.test.ts, 2 gates)
│   ├── B1.4.4  ✔️ ZONING & POPULATION FIT
│   │   ├── B1.4.4.1 ✔️ districtCoeffTable — authoritative §2 coefficients
│   │   ├── B1.4.4.2 ✔️ Household size ranges per district + empty-yard
│   │   │            chance table (lived-in variance)
│   │   ├── B1.4.4.3 ✔️ scatterExurbs — lone fringe households outside town
│   │   ├── B1.4.4.4 ✔️ rollLots — residents + hidden susceptibility per lot;
│   │   │            street-front lots run denser
│   │   ├── B1.4.4.5 ✔️ infillToFloor — yards become modest homes until the
│   │   │            floor holds (the retry loop's last resort)
│   │   └── B1.4.4.6 ✔️ INVARIANT: pop floor on 96² competitive worlds
│   │                (≥640 populated tiles, ≥2900 souls) (mapgen.test.ts)
│   ├── B1.4.5  ✔️ CONTRACT: World {townName, streets, biome}, snapshot
│   │            v7→v8, hashState coverage, round-trip hash-identical
│   ├── B1.4.6  ✔️ ZONING v2 — 8 districts (ResLow/ResHigh/Commercial/
│   │            Industrial + Downtown/OldTown/College/Trailer) w/ coeffs;
│   │            industrial by the rail, commercial on Main St
│   ├── B1.4.7  ✔️ KEYSTONE CIVICS — guaranteed every town
│   │   ├── B1.4.7.1 ✔️ keystone() stamp engine — try full size → shrink to
│   │   │            1×1 → force-place on first road-fronting lot
│   │   ├── B1.4.7.2 ✔️ The seven guarantees — elementary + high school,
│   │   │            sheriff, grocery, church, fire station, gas (feeds B1.18)
│   │   └── B1.4.7.3 ✔️ INVARIANT: keystone gate ×5 seeds (mapgen.test.ts)
│   ├── B1.4.8  ✔️ BLOCK INTERIORS & FRONTAGE
│   │   ├── B1.4.8.1 ✔️ enforceRoadFrontage — homes FRONT the street;
│   │   │            interiors are yards (revised away path corridors)
│   │   ├── B1.4.8.2 ✔️ orthogonalizePaths — safety net bridging any
│   │   │            corner-only path contact
│   │   └── B1.4.8.3 ✔️ INVARIANT: no home without street access within 1
│   │                orth tile (mapgen.test.ts frontage gate)
│   ├── B1.4.9  ✔️ FARMING — the working countryside
│   │   ├── B1.4.9.1 ✔️ layoutFarms — farmsteads anchored ON rural lanes
│   │   ├── B1.4.9.2 ✔️ Field parcels — rectangular, road-aligned, baulk
│   │   │            separators, river margins enforced
│   │   ├── B1.4.9.3 ✔️ Orchards — tree-row parcels
│   │   ├── B1.4.9.4 ✔️ Pastures — fenced livestock parcels
│   │   ├── B1.4.9.5 ✔️ fillFarmBelt — quarter-section fill: >20% of open
│   │   │            land cultivated, contiguous belt not islands
│   │   ├── B1.4.9.6 ✔️ Shelterbelts — windbreak woods rows at farmsteads
│   │   │            + field shelterbelt rows
│   │   ├── B1.4.9.7 ✔️ Road-field shoulders — 1-tile grass between
│   │   │            pavement and crop (#13)
│   │   ├── B1.4.9.8 ✔️ Farm outbuildings — barns/silos/greenhouses grown
│   │   │            beside farmhouses (placeTownBuildings farm pass)
│   │   └── B1.4.9.9 ✔️ INVARIANT: countryside farmed/watered/wooded gate
│   │                (mapgen.test.ts)
│   ├── B1.4.10 ✔️ BIOMES — configurable ground truth
│   │   ├── B1.4.10.1 ✔️ paintBiomes — blob-shaped biome painter
│   │   │            (desert/forest/autumn), order-independent, deduped
│   │   ├── B1.4.10.2 ✔️ Dominant-biome override — archetype towns sit
│   │   │            INSIDE a biome (desert/mountain, §2A)
│   │   ├── B1.4.10.3 ✔️ Temperate town margin — the oasis/valley rule with
│   │   │            fringe wobble (rim never reads as a circle)
│   │   ├── B1.4.10.4 ✔️ Desert ecotone — 3-ring transition, no hard edge
│   │   └── B1.4.10.5 ✔️ INVARIANT: biomes configurable, blob-shaped,
│   │                deterministic (mapgen.test.ts; default/[]/desert-only)
│   ├── B1.4.11 ✔️ RAIL & HYDROLOGY — the geographer realism pass
│   │   ├── B1.4.11.1 ✔️ layoutRail — fewest-street-crossing row selection;
│   │   │            right-of-way never runs ALONG an avenue
│   │   ├── B1.4.11.2 ✔️ Level crossings — roads keep pavement where the
│   │   │            line crosses (render: crossbucks, B5.2)
│   │   ├── B1.4.11.3 ✔️ Siding + grain elevator + depot at the industrial
│   │   │            edge (oceanside swaps elevator→cannery, B1.4.14.2)
│   │   ├── B1.4.11.4 ✔️ Industrial rail spur — stub track branches from
│   │   │            the main line into the works' own siding
│   │   ├── B1.4.11.5 ✔️ carveRiver — meandering river down one valley side;
│   │   │            widens 1→3→4 downstream
│   │   ├── B1.4.11.6 ✔️ carveCreek — 2 tributaries joining at confluence rows
│   │   ├── B1.4.11.7 ✔️ Lake plumbing — outlet channel + connectLakesToRiver
│   │   │            (no disconnected water bodies)
│   │   ├── B1.4.11.8 ✔️ Dam & millpond — low weir upstream of town w/
│   │   │            impounded pond (QA sweep #5)
│   │   ├── B1.4.11.9 ✔️ Riparian vegetation — forest bias toward water +
│   │   │            bank galleries
│   │   ├── B1.4.11.10 ✔️ Hedgerows — woods/field boundary rows
│   │   ├── B1.4.11.11 ✔️ Edge cemetery — at the town margin
│   │   └── B1.4.11.12 ✔️ INVARIANT: rail/elevator/depot anchor every town
│   │                (§2 rev. 5 gate, mapgen.test.ts, ×5 seeds)
│   ├── B1.4.12 ✔️🖼️ TERRAIN FIELDS v2 (§2 rev. 6) — elevation + moisture
│   │            value-noise fields (pixHash lattice, mult/add only — no
│   │            transcendentals) generated FIRST; river descends the
│   │            terrain (thalweg-blended, keeps the cxs[] contract);
│   │            biomes moisture-quantile-gated; woods seek wet ground,
│   │            the lake pools low; fields generation-local (never hashed)
│   ├── B1.4.13 ✔️🖼️ MAPGEN QA — QA_MAPGEN.md protocol, sweeps 1–3 complete
│   │   ├── B1.4.13.1 ✔️🖼️ Sweep record — 5 seeds × full map + crops; all
│   │   │            S1/S2 fixed (lake outlets, zoning colors, house/shop
│   │   │            variety, dam, water tower, marshes, curb cuts, alleys)
│   │   └── B1.4.13.2 ✔️🖼️ Render evidence — "QA gallery/" artifacts;
│   │                seeds logged with every sample (repro contract)
│   ├── B1.4.14 ✔️ TOWN ARCHETYPES (§2A) — applyTownArchetype (mapgen.ts:826)
│   │   │        (was undocumented in code; gated + QA'd 2026-07-05)
│   │   ├── B1.4.14.1 ✔️ farm — the default; archetype pass skips entirely
│   │   ├── B1.4.14.2 ✔️ oceanside — sea on the roomier edge w/ wavy coast;
│   │   │            river mouth becomes estuary; 2-tile beach strip;
│   │   │            highway stub becomes THE pier (others trimmed);
│   │   │            lighthouse; cannery + fish docks; elevator→cannery
│   │   ├── B1.4.14.3 ✔️ mountain/timber — conifer walls rim the valley;
│   │   │            slope farms reclaimed by stands; sawmill + log yard
│   │   │            on the rail EVERY seed (fallback fixed seed-3 gap)
│   │   ├── B1.4.14.4 ✔️ lakeside — big water body at the town edge; resort
│   │   │            shore: cabins + docks + boat ramp on town-facing shore
│   │   ├── B1.4.14.5 ✔️ desert — dominant desert biome + oasis margin
│   │   ├── B1.4.14.6 ✔️ INVARIANTS: 9 archetype gates in archetypes.test.ts
│   │   │            (determinism, floors, keystones, orthogonality, water
│   │   │            cleanliness, per-archetype anchors, snapshot round-trip)
│   │   ├── B1.4.14.7 ✔️🖼️ Archetype sample-set QA — 24 renders, 3 seeds × 4
│   │   │            archetypes, PASS ("QA gallery/Archetypes_2026-07-05/")
│   │   └── B1.4.14.8 ✔️🎮 Archetype match playability — 30 full bot matches
│   │                (5 types × 6 seeds, production founding path): 30/30
│   │                founded 4/4 + ended with a winner (PT-0003)
│   ├── B1.4.15 ✔️ TOWN BUILDING PLACEMENT — placeTownBuildings beyond keystones
│   │   ├── B1.4.15.1 ✔️ stamp() engine — wLots×hLots fitting; commercial
│   │   │            frontage must touch a road
│   │   ├── B1.4.15.2 ✔️ Downtown civic core — town hall, bank, post office
│   │   ├── B1.4.15.3 ✔️ Town green — civic square in the heart of downtown
│   │   ├── B1.4.15.4 ✔️ Commercial strip — shops/diner/cinema/offices on Main
│   │   ├── B1.4.15.5 ✔️ Industrial quarter — factory + warehouses + yard
│   │   ├── B1.4.15.6 ✔️ College quarter + school ballpark
│   │   ├── B1.4.15.7 ✔️ Old Town — chapel + diner + old churchyard
│   │   ├── B1.4.15.8 ✔️ Suburbs — corner shops, 2nd church, parks, playground
│   │   ├── B1.4.15.9 ✔️ Parsonage — every church keeps its household next door
│   │   ├── B1.4.15.10 ✔️ Highway motel + gas stations outside town
│   │   ├── B1.4.15.11 ✔️ Parking lots — opportunistic aprons + the GUARANTEE
│   │   │            pass (every civic anchor HAS one, clearing a yard if needed)
│   │   ├── B1.4.15.12 ✔️ Water tower lot (suburbs) + water-tower landmark
│   │   ├── B1.4.15.13 ✔️ placeDocks — shoreline docks w/ rowboats
│   │   └── B1.4.15.14 ✔️ Quarry scar — one gravel pit gouged off-road in
│   │                deep country (never in desert biome)
│   ├── B1.4.16 ✔️ NATURE & WATER BODIES
│   │   ├── B1.4.16.1 ✔️ organicBlob — the shared irregular-shape primitive
│   │   ├── B1.4.16.2 ✔️ placeNature — woods stands + the lake in open country
│   │   │            (riparian bias when a river exists)
│   │   └── B1.4.16.3 ✔️ ORDER INVARIANT: nature before farms — fields wrap
│   │                standing timber, never the reverse (QA S1-B)
│   ├── B1.4.17 ✔️ ROAD-GRAPH HYGIENE — the post-pass gauntlet
│   │   ├── B1.4.17.1 ✔️ roadComponents — 4-connected component labeling
│   │   ├── B1.4.17.2 ✔️ connectRoadComponents — stitch orphan road islands
│   │   ├── B1.4.17.3 ✔️ pruneRoadStubs + pruneAllDeadEnds — erase whatever
│   │   │            leads nowhere (incl. dirt lanes, orphaned spurs)
│   │   ├── B1.4.17.4 ✔️ extendEdgeRoads — rural roads run off-map, never
│   │   │            dying at the border
│   │   └── B1.4.17.5 ✔️ INVARIANT: strict orthogonality — no corner-only
│   │                contact, no orphan pixels (mapgen.test.ts, ×5 seeds)
│   ├── B1.4.18 ✔️ DETERMINISM & SEED CONTRACT (procgen rule §2)
│   │   ├── B1.4.18.1 ✔️ INVARIANT: same seed ⇒ identical world; adjacent
│   │   │            seeds ⇒ distinct worlds (mapgen.test.ts)
│   │   ├── B1.4.18.2 ✔️ INVARIANT: snapshot v8 round-trip hash-identical;
│   │   │            all mapgen fields inside hashState (→ lockstep gate)
│   │   └── B1.4.18.3 ✔️ Seed logging — QA samples named by seed
│   │                (11/21/42/77/99); every failure reproducible
│   ├── B1.4.19 ✔️ QUALITY METRICS (procgen rule §4) — tools/mapmetrics.mjs:
│   │            road connectivity, block count/median/p90, lot variety +
│   │            entropy, name uniqueness, farm/water share, per seed batch
│   │            & archetype; baseline values recorded in the Manifest
│   ├── B1.4.20 ✔️🎮 ARCHETYPE MECHANICAL IDENTITY — economic-anchor civics
│   │   │        (user waived the B7.9 gate). Zero new sim state: the anchors
│   │   │        join the proven civics-control engine (B1.18)
│   │   ├── B1.4.20.1 ✔️ Granary/Cannery — hold the town's economic anchor
│   │   │            (elevator, or the cannery §2A swaps in) → tithe ×1.1
│   │   ├── B1.4.20.2 ✔️ Sawmill — lumber at cost → build prices ×0.88,
│   │   │            discounted price shown live in the build palette
│   │   ├── B1.4.20.3 ✔️ Lighthouse — the beacon draws seekers → compound
│   │   │            outreach radius +2
│   │   └── B1.4.20.4 ✔️ HUD — Key Buildings panel lists only the anchors
│   │                THIS town has; balance knobs hot-patchable
│   └── B1.4.21 ⬜ TRANSCENDENTAL-FREE MAPGEN — 3 clusters remain (fields
│                v2 retired the meander + biome rims): coastline wobble,
│                town footprint rim, organicBlob rim. Risk CONTAINED by
│                B6.5 (3 engine families gated per push); batch with the
│                next intentional world-shape change
├── B1.5  ✔️ buildings.ts — full §6 table (Compounds…Supplement Labs)
├── B1.6  ✔️ entities.ts — Couriers, Vans, invisible Agents (§7)
├── B1.7  ✔️ PvP trio — raids / scandal→publish / court defection (§13/§15)
├── B1.8  ✔️ Strikes — Pamphlet Bomb, Exposé, Manifesto Drop + intercepts (§8)
├── B1.9  ✔️ diplomacy.ts — alliances, JUDAS betrayal, SCHISM → Splinter Sects (§16)
├── B1.10 ✔️ doctrine.ts — all 16 BITE nodes, milestones, tier gating (§10)
├── B1.11 ✔️ Archetype kits ×4 — Final Dawn / Radiant Path / Prosperity / Visitors (§11)
├── B1.12 ✔️ CPA — pickets @Heat60, Deprogrammer Bus @85, Town Hall immunity (§17)
├── B1.13 ✔️ Match flow — founding, victory paths, elimination, RECAP freeze (§18)
├── B1.14 ✔️ bots.ts — Drifter / Sect / Established Church tiers via Intent API (§21)
├── B1.15 ✔️ Input hardening — length-capped array intents (MAX_FRONT/PATH_TILES)
├── B1.16 ✔️ Tree felling — building/parcel placement fells Woods deterministically
├── B1.17 ✔️ Property engine — wilderness SPAWN founds a 5×5 parcel + compound
│            + bused-in congregation; BUY_PROPERTY intent (escalating cost);
│            wilderness builds require own property; crowding cap penalty
├── B1.18 ✔️ Civics engine — controlling police/elementary/high-school/
│            grocery/church grants realistic takeover effects in the engines
└── B1.19 ✔️ Compound outreach — fronts can target tiles within radius of an
             operational compound (targeted conversion from wilderness bases)

B2  ✔️ META — post-match systems (outside lockstep; float-safe by design)
├── B2.1 ✔️ ranked.ts — Glicko-2, FFA pairwise, tiers, seasonal soft reset (§20)
├── B2.2 ✔️ progression.ts — XP/levels, Relic earn band, ranked unlock (§22)
├── B2.3 ✔️ daily.ts — Daily Prophecy (§23)
├── B2.4 ✔️ economy.ts (meta) — earn/spend store, free rotation, no paid relics (§36)
├── B2.5 ✔️ recap.ts — match recap data + headline grammar (§25)
└── B2.6 ✔️ recapCard.ts — deterministic 1080×1350 share-card renderer (§25.1)

B3  ✔️ SERVER — hosted service (@flock/server, Node 22)
├── B3.1 ✔️ index.ts — HTTP entry, REST API, /health, WS upgrade + auth handshake
├── B3.2 ✔️ lobby.ts — LobbyDirector: concurrent matches, routing, persistMatch (§32)
├── B3.3 ✔️ matchWorker.ts — authoritative 10 Hz lockstep loop per match (§33)
├── B3.4 ✔️ store.ts — Store interface + InMemoryStore + durable JsonFileStore (§34)
├── B3.5 ✔️ auth.ts — guests, stateless HMAC sessions, pluggable AuthProvider (§26)
├── B3.6 ✔️ moderation.ts — leetspeak-aware name/chat filter (§30)
├── B3.7 ✔️ congregations.ts — clans + weekly best-10 ladder (§24)
├── B3.8 ✔️ metrics.ts — structured JSON logs, counters/gauges
├── B3.9 ✔️ protocol.ts — client↔server wire message types
└── B3.10 ✔️ 4-player cap — human seats per match clamped to 4

B4  ✔️ CLIENT — frontend spine (@flock/client, Vite + PixiJS)
├── B4.1 ✔️ main.ts — boot, app shell, input wiring, FTUE coachmark, recap overlay
├── B4.2 ✔️ net.ts — prediction + reconciliation, resync, session resume (§33)
├── B4.3 ✔️ render.ts — camera zoom→LOD/pan, fog of war (§14), minimap camera
├── B4.4 ✔️ hud.ts — in-match HUD (§27/§28)
│   ├── B4.4.1 ✔️ Core HUD — top bar, rails, build palette, doctrine grid,
│   │            minimap, player list, drama feed, help overlay, threat pings
│   ├── B4.4.2 ✔️ Live ability costs — D/F/G actives show cost/affordability
│   │            like builds/rituals already do (HANDOFF §9.6)
│   └── B4.4.3 ✔️ In-match chat input — UI box + keybind-focus isolation;
│                server sendChat + relay already exist (HANDOFF §9.5)
├── B4.5 ✔️ menu.ts — lobby, leaderboard/store/clans/profile via REST API (§28)
├── B4.6 ✔️ settings.ts — reduced-motion / mute / colorblind, persisted (§28)
├── B4.7 ✔️ Place identity — generated town name on the conversion bar +
│            hover chip (street / household / lot / landmark names)
├── B4.8 ✔️ Property UI — BUY LAND placement mode, wilderness founding hints,
│            property tint + crowding warning
└── B4.9 ✔️ Civics panel — key buildings, owner + takeover effect, click to target

B5  🔨 VISUALS — shared pixel renderer (SimState → RGBA, cosmetic boundary)
├── B5.1 ✔️ palette.ts — shared color tokens
├── B5.2 ✔️ townRender.ts — terrain, houses, lot buildings, landmark +
│   │        building icons, unit sprites, conversion auras (procedural)
│   ├── B5.2.1 ✔️ Road dressing — bridges over water (railings/planks),
│   │            downtown crosswalks, highway center line
│   ├── B5.2.2 ✔️ New lots — Cinema, TrailerHome, Playground, Dock, Greenhouse
│   │            (low-LOD procedural now; high-detail flagged 🧩)
│   ├── B5.2.3 ✔️ Cult building expansion — compound growth stages by cult
│   │            size; claim assets extended to grass verges
│   ├── B5.2.4 ✔️ ASSETS.md — full asset × LOD ledger; high-detail versions
│   │            tracked as 🧩 stubs per the Stub Law
│   └── B5.2.5 ✔️ Renderer v3 — biome palettes (desert/forest), footpaths,
│                bridge-crossing fix, wired powerlines, cul-de-sac bulbs,
│                orchards/pastures/warehouse/high-school, property stakes
└── B5.3 🚫 Authored content — audio (§31) + ~40 frame-by-frame sprite
    │        animations (§30). BLOCKED: artist/composer work, not code.
    └── B5.3.1 🧩 High-detail (LOD 3–4) asset variants — deferred art pass;
                 every deferred variant is itemized in ASSETS.md

B6  🔨 TOOLING & QA — headless harnesses (tools/) + CI
├── B6.1 ✔️ CI gate — build + determinism + full suite on every push (Node)
├── B6.2 ✔️ Art QA — screenshots.mjs, units.mjs, spritesheet.mjs
├── B6.3 ✔️ botleague.mjs — per-archetype win-rate balance harness (§40/§41)
├── B6.4 ✔️ soak.mjs — live load/desync soak vs running server (SLA assert)
├── B6.5 ✔️ Cross-browser determinism CI — identical probe (worldgen incl.
│            oceanside + 400 sim ticks) hashes byte-identically in Node/V8,
│            Chromium/V8, Firefox/SpiderMonkey, WebKit/JavaScriptCore; in
│            ci.yml on every push (tools/xbrowser_determinism.mjs)
└── B6.6 ✔️ tools/gen_names.py — Python faker → nameData.ts corpus generator
             (town/street/first/surname banks, checked in, regenerable)

B7  🚫 LAUNCH INFRASTRUCTURE — external provisioning (seams exist in code)
├── B7.1 ⬜ Postgres Store adapter + schema (JSON adapter is dev-only) (§34)
├── B7.2 🚫 OAuth AuthProvider.verify — Google/Discord/email. BLOCKED:
│            provider apps/secrets; guest+session flow already live (§26)
├── B7.3 🚫 TLS / ingress — wss:// termination at LB. BLOCKED: certs/infra
├── B7.4 ⬜ Horizontal scale — pinned worker process per match over IPC (§32)
├── B7.5 🚫 Telemetry — wire metrics/log to real sinks + §41 KPI dashboard.
│            BLOCKED: sink provisioning
├── B7.6 🚫 Moderation pipeline — maintained locale-aware blocklist + human
│            review. BLOCKED: external list/process (§30)
├── B7.7 🚫 Legal/compliance — ToS, privacy, GDPR deletion, age gating
├── B7.8 🚫 Payment gateway — money-priced recap frames (§36). BLOCKED: PSP
└── B7.9 🚫 Balance validation — human playtests + nightly botleague tuning
             of balance.json. BLOCKED: needs real players (§41)
```

**Spine parity note (Full-Stack Coverage Rule):** every backend capability has
its frontend consumer (REST API ↔ menu.ts screens; WS protocol ↔ net.ts/hud.ts;
sim intents ↔ HUD controls) except server `sendChat` — its missing consumer is
tracked as **B4.4.3**, not hidden. No catch-all UI nodes remain.

B8  ✔️ PLAYTEST READINESS — the 2026-07-02 sprint (rooms, civic day, safety, sims)
├── B8.1 ✔️ Private rooms — code-gated matches + host knobs (bots/size/town/founding)
├── B8.2 ✔️ Civic day — street-accurate resident routines (sidewalks, cars, rush hours)
│   └── B8.2.1 ✔️🖼️ Street-true routing — dots follow the REAL road graph
│                (cached BFS), turns at true intersections, lunch runs
│                depart the workplace, night streets read dead (2026-07-05)
├── B8.3 ✔️ Conversion read — person figures colored by conversion state
├── B8.4 ✔️ Ownership glow — cult buildings ringed in owner color
├── B8.5 ✔️ Population scaling — souls ∝ map area (constant density)
├── B8.6 ✔️ Tone guardrail — real cults/religions blocked from names
├── B8.7 ✔️ Van routing — manual VAN_MOVE controls (v / shift+V)
├── B8.8 ✔️ Ecumenical Pact — PACT_PICK simmed + doctrine-grid UI (§16)
├── B8.9 ✔️ QoL controls — close front (c), cancel build (z), surrender (F8)
├── B8.10 ✔️ Sim campaign — duration/balance/tier-ladder/pacing harness
├── B8.11 ⬜ Emote relay — accepted MINOR, post-playtest
└── B8.12 ⬜ Settings sync — accepted MINOR, per-device localStorage today
├── B8.13 ✔️ HUD redesign — "Interface Testament v3.0" pixel design system, menu + HUD + loading
└── B8.14 ✔️ Founding gate + solo pause — match waits for all founders; ⏸/✕ controls top-left
├── B8.15 ✔️ All-clickable — SCHEME panel gives every PvP/ops action a button (no hotkey needed)

B9  🔨 THE MISSION REWORK — core loop v3 (DESIGN_MISSIONS.md is the contract)
├── B9.1 ✔️ M1 Cohort substrate — cohort state {target, mode, mass} ×3 max,
│            SEND/RECALL intents, EXACT inner-circle floor, snapshot v9 +
│            hash; 5 gates; lockstep smoke on v9 (commit c53af4e)
├── B9.2 ✔️ M2 Presence conversion engine — travel model (march out / walk
│            home), door-work auto-spread through the unchanged factor
│            pipeline, Tend holds, Crusade attrition+Heat, JUDAS on allied
│            doors (M2a). FRONTS DELETED ✂ (M2b): bots send missions, client
│            interim send, snapshot v10, 6 test files migrated to cohorts.
│            97/97 sim + 14/14 server, 4-engine PASS. BOT LEAD SHARE
│            0.52–0.66 (was 0.94–0.98) — the anti-snowball gate (<0.90) MET
├── B9.3 ⬜ M3 Economy rewire — recruits-from-believers growth; rituals ✂ →
│            doctrine costs Faith; build palette ✂ → commune stages 1–5
├── B9.4 ⬜ M4 Key-building sieges — tug-of-war meter per civic/anchor lot,
│            decay when uncontested, glow-outline state for converted homes
├── B9.5 ⬜ M5 Bot brain v3 — three verbs (send/recall/upgrade); botleague +
│            playtest campaigns re-baselined (gate: lead share < 0.90)
├── B9.6 ⬜ M6 Client — RIGHT-CLICK MISSION WHEEL (Spread/Tend/Crusade arcs
│            + %-of-flock slider, targets a map tile OR a key building),
│            cohort chips w/ recall, right-rail building bars, glow
│            outlines, victory threshold marker + path readout
│            (domination only; Revelation ✂). Browser-verified.
├── B9.7 ⬜ M7 Protocol/rooms/tutorial — wire intents, room defaults,
│            tutorial rewritten around the three-verb loop
└── B9.8 ⬜ M8 Audit — Phase-6 sweep: depth review vs §8 gates, QA renders,
             ✂ ledger closed, docs reconciled with DESIGN.md
