# FLOCK: Master Implementation & Production Sprint Roadmap

> **Program Objective:** Transition *Flock* from an M1 functional state into a commercial-grade, fully balanced, visually stunning (9.5/10), and release-ready multiplayer territory RTS deployable in a single Docker command.

---

## 1. Executive Program Summary & Release Definition of Done (DoD)

### 1.1 The Target Quality Standard
- **Strategy & Balance:** Deep building-centric institutional warfare featuring 7 Active Civic Decrees, 4 Municipal Monopolies, and 4 refined, highly distinct cult archetypes balanced to a $45\%\text{--}55\%$ winrate band across 1,000 automated bot matches.
- **World Generation & Visual Realism (The 6/10 $\rightarrow$ 9.5/10 Push):** Within the 8px top-down pixel idiom, every map reads as a believable aerial photo of a real American town: authentic rectilinear city blocks with backyard interiors, realistic zoning separation (zero industrial near schools), contiguous agricultural belts with livestock, dedicated adjacent blacktop parking lots for every commercial/civic building, and **strict ecological placement sanity (zero farms in forests, zero crops in deserts)**.
- **Automated QA & Visual Asset Inspection System:** Built-in automated mapgen linter (`tools/audit_mapgen.mjs`), isolated asset calibration testbed (`tools/asset_inspection.mjs`), and visual HTML regression report verifying all 119 cataloged assets across multi-seed benchmarks.
- **UI/UX Frontend Polish:** Crisp DOM HUD over the chunky pixel world. Real-time institutional ownership ribbon, clickable decree triggers, monopoly status banners, high-contrast telegraph warnings (50% Scandal, 60% Ledger, 10s strike cones), and hover inspection tooltips.
- **Engine Determinism & Architecture:** Bit-identical Q16.16 fixed-point simulation on client and server. Zero floats, zero desyncs over 50-client load soaks.
- **Deployment:** Production-hardened multi-stage Docker container with automated healthcheck probes, stateless HMAC authentication, persistent storage volumes, and single-command deployment via Docker Compose.

```
                           PROGRAM SPRINT PIPELINE
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   SPRINT 1   │ ──► │   SPRINT 2   │ ──► │   SPRINT 3   │ ──► │   SPRINT 4   │ ──► │   SPRINT 5   │ ──► │   SPRINT 6   │
│ Sim Core &   │     │ Cult Kit &   │     │ World Gen &  │     │ UI/UX Master │     │ Balance &    │     │ Docker &     │
│ Civic Engine │     │ Cool Assets  │     │ Asset Realism│     │ Polish       │     │ Determinism  │     │ Release Ops  │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

---

## 2. Sprint 1: Sim Engine — Civic Decrees, Monopolies & Building Warfare

**Objective:** Implement the finalized building takeover mechanics, Active Civic Decrees, and Municipal Monopoly evaluator into the core deterministic simulation package (`@flock/sim`).

### 2.1 User Stories & Deliverables
1. **As a player**, when I hold majority control of a civic institution (Sheriff, Schools, Supermarket, Church, Town Hall, Radio Tower), I want to trigger its Active Municipal Decree so that I can impact the tactical flow of battle.
2. **As a player**, when I hold both buildings of a monopoly pair (e.g. Town Hall + Sheriff), I want the monopoly bonus to activate immediately and provide clear strategic leverage.
3. **As an opponent**, when I convert a single peripheral tile of a rival's civic lot, I want their majority to break and their decree/monopoly bonuses to shut down instantly.
4. **As an attacker**, when I deprogram or bomb an enemy-held institution, I want all its tiles to turn into Apostate Scar tissue for 90 seconds, disabling all buffs.

### 2.2 Technical Task Breakdown
- [x] **Task 1.1: Intent Protocol Update (`intents.ts`)** *(COMPLETED)*
  - Added `CIVIC_DECREE` intent: `{ t: typeof IntentType.CIVIC_DECREE, player: PlayerId, decree: CivicDecreeId, tile?: TileId }`.
  - Validated issuing player holds majority control of required institution and is not on cooldown.
- [x] **Task 1.2: Decree State Machine & Cooldowns (`civics.ts`, `sim.ts`, `conversion.ts`, `buildings.ts`)** *(COMPLETED)*
  - Extended `SimState` to track active decrees and player cooldowns.
  - Implemented execution handlers for all 7 decrees:
    - *Town Curfew* (Sheriff): District front freeze (15s).
    - *Pep Rally* (High School): Spawns $+1,200$ followers (overflow converted to $\$0.50$ tithe).
    - *Parent-Teacher Night* (Elementary): $2\times$ ambient creep speed for 30s.
    - *Food Rationing* (Supermarket): $+35\%$ retention in district for 25s.
    - *Evangelical Revival* (Church): $+15$ Faith, $+20$ neutral pulse.
    - *Municipal Injunction* (Town Hall): Pauses enemy building construction in Town Hall & adjacent districts for 20s.
    - *Emergency Jam* (Radio Tower): Jams rival strike charges and stance switches for 15s.
- [x] **Task 1.3: Monopoly Evaluator Engine (`civics.ts`, `sim.ts`, `entities.ts`, `conversion.ts`, `buildings.ts`)** *(COMPLETED)*
  - Implemented `computeMonopolies(s: SimState, pid: PlayerId)`:
    - *Town Machine* (Town Hall + Sheriff): Raises CPA threshold to Heat 85, auto-arrests stealth Agents in district.
    - *Indoctrination Pipeline* (High School + Elementary): $+20\%$ follower growth, $+25$ followers per neutral creep flip.
    - *Food & Fuel Cartel* (Supermarket + Gas Station): Friendly Vans $+35\%$ speed, enemy building costs $+30\%$.
    - *Sacred Canopy* (Megachurch + Church): Faith floor locked at 50, $+50\%$ Sermon duration & faith gain.
- [x] **Task 1.4: Universal Apostate Scar Reset (`civics.ts`, `entities.ts`)** *(COMPLETED)*
  - Implemented scar check (`w.scarTicks[t] > 0`) excluding scarred tiles from civic lot and landmark control evaluations.

### 2.3 Verification & QA Gates *(PASSED)*
- Ran `npm test`: **88/88 `@flock/sim` tests passed, 14/14 `@flock/server` tests passed (102/102 total)**.
- Full unit test suite `test/civics_decrees.test.ts` verified:
  - Strict majority ties and 1-tile edge snipes.
  - Universal apostate scar shutdowns.
  - All 7 active decrees (costs, cooldowns, duration, front freezes, pause mechanics).
  - All 4 municipal monopolies (agent arrests, building cost penalties, faith floor, van speeds).
  - Bit-identical `hashState` snapshot serialization and deserialization across live decrees and monopolies.

---

## 3. Sprint 2: Cult Archetypes Strategic Overhaul & Cool Asset Production

**Objective:** Refine all 4 cult archetypes for deep strategic gameplay and produce distinctive, stylish pixel art asset kits (8px world / 16px units) for each faction.

```
┌───────────────────────────┬───────────────────────────┬───────────────────────────┬───────────────────────────┐
│        FINAL DAWN         │       RADIANT PATH        │     PROSPERITY CIRCLE     │    VISITORS' FELLOWSHIP   │
│   Obsidian & Red Embers   │    Sage Green & Lavender  │   Executive Navy & Gold   │   Cosmic Violet & Cyan    │
│  Cracked-Earth Territory  │   Watercolor Bloom Grass  │   Pinstripe Territory     │   Twinkling Starfield     │
│   Barbed-Parapet Bunker   │   Geodesic Glass Dome     │  Modern Corporate Helipad │  Observatory & Radar Dish │
│   Armored Black Van       │   Aerodynamic Camper      │  Glossy Black Sprinter    │  Retro Chrome Saucer Van  │
│   Red-Hooded Agent        │   Robed Barefoot Infil    │  Briefcase Suit Agent     │  Silver Space-Jumpsuit    │
└───────────────────────────┴───────────────────────────┴───────────────────────────┴───────────────────────────┘
```

### 3.1 Technical Task Breakdown
- [x] **Task 2.1: Mathematical Tuning Update (`balance.json`, `balance.ts`, `sim.ts`)** *(COMPLETED)*
  - Verified and tuned archetype coefficients ($R_0$, Retention, Income, Heat, Growth) per Section 2 of [STRATEGY.md](./STRATEGY.md).
  - Applied logistic follower growth archetype scaling directly in `stepEconomy()`.
- [x] **Task 2.2: Faction Institutional Corruptions (`conversion.ts`, `entities.ts`, `sim.ts`)** *(COMPLETED)*
  - Implemented archetype-specific perks when holding institutions:
    - *Final Dawn*: Captured churches become *Doomsday Bunkers* (explodes into Apostate Scar upon enemy takeover).
    - *Radiant Path*: Captured supermarkets become *Organic Co-Ops* ($+40\%$ retention defense multiplier).
    - *Prosperity Circle*: Captured banks become *Franchise Megacenters* ($3\times$ courier cash multiplier).
    - *Visitors*: Captured radio towers become *Deep Space Transmitters* (zero strike telegraph delay, instant impact).
- [x] **Task 2.3: Procedural Pixel Asset Redesign (`townRender.ts` & `palette.ts`)** *(COMPLETED)*
  - Overhauled procedural sprite drawing for each archetype:
    - **Compounds:** Render 4 unique architectural silhouettes (`COMPOUND_ICONS`: Survivalist fortified bunker, Geodesic glass dome, Corporate glass tower w/ helipad, Astronomical observatory).
    - **Recruitment Vans:** Custom 16×16 sprites per faction (`VAN_SPRITES` & `VAN_COLORS`: Armored ram-van, Eco-camper, Luxury sprinter, Chrome saucer-topped van).
    - **Agents:** 16×16 walking sprites (`AGENT_SPRITES` & `AGENT_COLORS`: Crimson hood, Sage linen, Sharp suit w/ briefcase, Retro astronaut).
    - **Territory Patterns:** Distinctive colorblind-safe patterns (`territoryPixel`: Molten crimson fracture veins, Floral lavender/sage bloom, Executive gold pinstripe on navy, Cyan/violet nebula starfield).
- [x] **Task 2.4: Audio Stems & SFX Hooks (`packages/client/src/audio.ts`)** *(COMPLETED)*
  - Integrated procedural Web Audio synthesizer engine (zero external MP3 dependencies):
    - Final Dawn: Pipe organ minor chord triad + crackling fire embers.
    - Radiant Path: Wind chimes cascade + acoustic pan flute breath.
    - Prosperity Circle: Cash register *cha-ching* + executive elevator chime.
    - Visitors' Fellowship: Theremin pitch sweep with vibrato + cosmic telemetry bleeps.
    - Stately brass fanfare for Civic Decrees and golden arpeggio chime for Monopolies.
- [x] **Task 2.5: Game Interface Refinement & Compact Active Buff/Decree Status Tray (`packages/client/src/hud.ts`)** *(COMPLETED)*
  - **Sleek, Compact Civic Status Tray:** Docked neatly beneath the top match clock/resource header (28px height, zero playfield obstruction).
  - **Active Buffs & Monopolies Visibility:** Displays current active decrees (*Curfew*, *Injunction*, *Jam*, *Rationing*, *Revival*) and held municipal monopolies (*Town Machine*, *Indoctrination Pipeline*, *Food & Fuel Cartel*, *Sacred Canopy*) as crisp, glowing 20×20 pixel badges.
  - **Circular Pie Sweeps:** Radial tick countdown sweep showing remaining decree duration directly on each badge.
  - **Non-Intrusive Ergonomics:** Transparent click-through gutters (`pointer-events: none` on container, `auto` on badges) so the tray never blocks map clicks; 1-click collapse/expand arrow toggle for minimalist gameplay.
  - **Hover Tooltips:** Rich, immediate tooltip on hover detailing the controlling institution, exact effect multipliers, and remaining duration/district scope.
  - **Resource Header Simplification:** Streamline typography and visual contrast across Faith, Followers, Tithe Cash, and Heat counters; color-code state changes cleanly.

### 3.2 Verification & QA Gates *(PASSED)*
- Ran `npm test`: **94/94 `@flock/sim` tests passed, 14/14 `@flock/server` tests passed (108/108 total)**.
- Ran `npm run build`: **0 build errors across `@flock/client`, `@flock/server`, `@flock/sim`**.
- Full test suite `packages/sim/test/archetypes_corruptions.test.ts` verified:
  - Final Dawn church detonation into Apostate scar.
  - Radiant Path supermarket retention defense multiplier.
  - Prosperity Circle bank courier cash tripling.
  - Visitors' Fellowship Radio Tower instant strike launch.
  - Colorblind-safe territory pattern generation.
  - Procedural compound, van, and agent rendering pipeline.

### 3.2 Verification & QA Gates
- Run `node tools/screenshots.mjs assets` to generate high-resolution PNG sheets of all 4 cult kits.
- Visual inspection checklist: verify that at 360p resolution, every cult's territory, compound, van, and agent are immediately distinguishable without reading text.
- UI Ergonomics Test: Verify that with 3 decrees and 2 monopolies active simultaneously, the HUD occupies less than 6% of the screen height, remains fully readable, and allows full tile clicks directly below the tray.

---

## 4. Sprint 3: Deep QA World Generation, Urban Plats & Asset Realism (6/10 $\rightarrow$ 9.5/10)

**Objective:** Elevate world generation and assets from a simple game grid into an authentic aerial view of a rural American small town, preserving the beloved pixel art style (32×32 canvas) and core layouts while upgrading details, zoning realism, animation flagging, and multi-map QA.

---

### 4.1 The Core Realism Philosophy: Upgrading & Elevating, Not Overhauling

> [!IMPORTANT]
> **Design Mandate:** *Upgrade and polish, do not overhaul.*
> We preserve the foundational strengths of *Flock*—its distinctive pixel-art aesthetic, 32×32 tile canvas, vibrant palette tokens, iconic street grid, and landmark hierarchies. The realism upgrade injects authentic American small-town micro-details into the existing framework rather than replacing it:
> - **Roads & Traffic Realism:** Double-yellow highway centerlines, white shoulder fog lines, painted pedestrian zebra crosswalks at intersections, concrete curbs, storm drain grates, and gravel shoulders on rural lanes.
> - **Roofs & Architectural Textures:** Standing-seam metal on red barns and grain silos, weathered asphalt shingles with subtle ridge lines on homes, and flat gravel-and-tar roofs with rooftop HVAC compressor units, vents, and access skylights on Main Street storefronts.
> - **Yards, Frontage & Curtilage:** Concrete driveways with parked civilian pickups/sedans, front concrete sidewalks, curbside mailboxes on posts, cedar privacy fences enclosing rear yards, detached storage sheds, and above-ground swimming pools.
> - **Infrastructure & Street Furniture:** Wooden telephone utility poles running along rural roads, cast-iron street lamps downtown, red fire hydrants on block corners, dumpster enclosures behind commercial restaurants, and a municipal water tower.
> - **Farmland & Ecological Transitions:** Drainage ditch lines with wild grasses and cattails between roads and fields, dirt culverts at tractor field entrances, hedgerow windbreaks, and realistic crop row furrows aligned with parcel angles.

---

### 4.2 The Urban Planning, City Block & Parking Engineering Architecture

To eliminate the look of random scatter, map generation is re-anchored on real-world American municipal plats:

```
                            REALISTIC CITY BLOCK GEOMETRY
 ┌─────────────────────────────────── STREET ───────────────────────────────────┐
 │ [Sidewalk] [Sidewalk] [Sidewalk] [Sidewalk] [Sidewalk] [Sidewalk] [Sidewalk] │
 │ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
 │ │ House A  │ │ House B  │ │ House C  │ │ House D  │ │ House A  │ │ House B │ │
 │ │(Driveway)│ │(Driveway)│ │(Driveway)│ │(Driveway)│ │(Driveway)│ │(Drivewy)│ │
 │ ├──────────┤ ├──────────┤ ├──────────┤ ├──────────┤ ├──────────┤ ├─────────┤ │
 │ │ Backyard │ │ Backyard │ │ Backyard │ │ Backyard │ │ Backyard │ │Backyard │ │
 │ │ (Shed)   │ │ (Pool)   │ │ (Garden) │ │ (Fence)  │ │ (Trees)  │ │ (Grass) │ │
 │ └──────────┴────────────┴─ SERVICE ALLEY / CORE ──┴────────────┴───────────┘ │
 └─────────────────────────────────── STREET ───────────────────────────────────┘
```

1. **Rectilinear City Blocks & Parcel Subdivisions:**
   - Towns are platted into distinct rectangular blocks ($12\times 8$ to $16\times 10$ tiles) bounded on all 4 sides by paved streets (or 3 streets + 1 dead-end court).
   - **The Frontage Mandate:** Every building occupies the outer perimeter of the block facing outward toward the concrete curb and street. Zero buildings inside the interior.
   - **The Backyard Core:** The central core of every residential block is strictly reserved for backyards: green lawns, fences, garden patches, above-ground pools, detached garages, and utility sheds.
2. **Authentic Zoning Districts & Separation:**
   - **Downtown Core:** Contiguous zero-lot-line commercial rows sharing vertical party walls, flat parapet rooflines, display glass windows, and retro awnings, backed by rear delivery alleys.
   - **Commercial Strip:** Strip mall configuration: stores arranged behind a continuous forward asphalt parking apron with curb cuts connecting to the avenue.
   - **Civic Campus Grounds:** High School, Elementary School, and Town Hall sit in dedicated multi-parcel campuses flanked by formal paved plazas, athletic fields, and school bus loading loops.
   - **Industrial Isolation:** Factories, rail spurs, and warehouses generate exclusively along rail corridors and highway outskirts—enforcing a strict minimum 6-tile separation from schools and churches.
3. **Realistic Parking Lot Engineering:**
   - **The Adjacency Invariant:** 100% of commercial stores (Supermarket, Cinema, Diner, Bank) and civic institutions (Town Hall, High School, Elementary, Church) must feature an adjacent asphalt parking lot sharing direct parcel boundaries with the building.
   - **Paving & Markings:** Dark asphalt blacktop with painted white/yellow parking stall lines, curb cuts connecting to the street, and parked passenger car sprites (2×1 vehicle pixels).

---

### 4.3 Complete World & Cult Asset Inventory (The Master Ledger)

Every asset generated or rendered in *Flock* is cataloged below with its **Animation Mode** (Static vs. Animated):

#### Category A: Terrain & Environmental Assets (20 Assets)
| ID | Asset Name | Animation Mode | Visual Signature (8px) | Realism & Placement Rules |
| :--- | :--- | :--- | :--- | :--- |
| `ENV-01` | **Temperate Grass** | `[STATIC]` | Multi-octave rolling green, light/shadow flecks | Organic meadow feel; zero repeating grid lattice |
| `ENV-02` | **Rock Outcrops** | `[STATIC]` | 3-px stone cluster on high elevation contours | Restricted to ridge-lines; cast shadow south-east |
| `ENV-03` | **Brush Pockets** | `[STATIC]` | Clustered scrub bush pixels + cast shadow | Natural dispersal along tree lines and fence shoulders |
| `ENV-04` | **Country Trees** | `[STATIC]` | 2×2 foliage canopy + trunk gap + shadow | Species mix: pine, oak, autumn maple, dead snag |
| `ENV-05` | **Standing Woods** | `[STATIC]` | Dense clumped light/dark canopies w/ edge bleed | Organic canopy clumps; sunlit northern fringe |
| `ENV-06` | **River Reach** | `[ANIMATED (4-frame)]` | Deep blue-grey water w/ surface ripple glints | Monotonic downstream flow; gravel/sand shore margins |
| `ENV-07` | **Creek Tributaries** | `[ANIMATED (3-frame)]` | Narrow 1-tile channel a shade greener than river | Feeds into main river; flanked by willow trees |
| `ENV-08` | **Lake Basin** | `[ANIMATED (4-frame)]` | Wide water body w/ drifting glint rows & reed sway | Deep center color, shallow margins w/ reeds |
| `ENV-09` | **Desert Dunes** | `[STATIC]` | Warm sand w/ windward dune crest lines | Organic sand ripples; dry scrub flecks |
| `ENV-10` | **Saguaro Stands** | `[STATIC]` | Green vertical arms w/ cast shadow | Restricted to desert biome; natural clustering |
| `ENV-11` | **Desert Dry Wash** | `[STATIC]` | Winding gravel/sand arroyo bed cutting terrain | Cuts across desert contours; stone-lined edges |
| `ENV-12` | **Desert Oasis** | `[ANIMATED (2-frame)]` | Green water margin w/ date palm canopies & shimmer | Emerges where river cuts through desert |
| `ENV-13` | **Forest Floor** | `[STATIC]` | Darker damp loam, fallen logs, red mushrooms | Mossy textures under dense canopy shade |
| `ENV-14` | **Autumn Foliage** | `[STATIC]` | Warm amber, ochre, and rust tree canopies | Gradual color grading at autumn biome edges |
| `ENV-15` | **Riparian Willows** | `[STATIC]` | Drooping pale green canopy along riverbanks | Anchored to river edge tiles; casts shadow on water |
| `ENV-16` | **Utility Poles** | `[STATIC]` | Vertical pole w/ crossarm every 3 tiles | Follows rural roads; wire spans connect poles |
| `ENV-17` | **Hedgerows** | `[STATIC]` | Dense brush line along field boundaries | Separates crop parcels from open meadow |
| `ENV-18` | **Shelterbelts** | `[STATIC]` | Linear conifer windbreak rows | Positioned on north/west sides of farmsteads |
| `ENV-19` | **Stock Tank Pond** | `[ANIMATED (2-frame)]` | Small circular water body w/ mud ring & reflection | Located in pasture corners; trampled earth fringe |
| `ENV-20` | **Ecotones (3-Ring)**| `[STATIC]` | Graded 3-tile transition band between biomes | Sand $\rightarrow$ Scrub $\rightarrow$ Grass; zero hard pixel cuts |

#### Category B: Streets, Infrastructure & Furniture (18 Assets)
| ID | Asset Name | Animation Mode | Visual Signature (8px) | Realism & Placement Rules |
| :--- | :--- | :--- | :--- | :--- |
| `ST-01` | **4-Lane Highway** | `[STATIC]` | Crisp dark asphalt, white shoulders, yellow seam | Double-yellow centerline; cuts town cleanly |
| `ST-02` | **2-Lane Street** | `[STATIC]` | Medium-tone weathered asphalt w/ faint center line | Flanked by concrete sidewalk skirts in town |
| `ST-03` | **Cul-de-Sac Bulb** | `[STATIC]` | Circular asphalt turnaround terminating a court | 2–5 per town; homes ring the perimeter |
| `ST-04` | **Dirt/Gravel Lane** | `[STATIC]` | Mottled two-tone brown rutted track w/ ditch lines | Leads to farmsteads and agricultural parcels |
| `ST-05` | **Road Bridge** | `[STATIC]` | Plank/deck texture w/ structural side railings | Stone piers visible at water edges; road travels cleanly |
| `ST-06` | **Main St Crosswalks** | `[STATIC]` | Crisp white zebra stripe markings | Located at downtown 4-way and T-junctions |
| `ST-07` | **Traffic Lights** | `[ANIMATED (3-frame)]` | Paired red/green lamp heads on black post | Downtown intersections; cycles state every 10s |
| `ST-08` | **Stop Signs** | `[STATIC]` | Red octagonal head on metal post | Positioned where side streets tee into avenues |
| `ST-09` | **Streetlights** | `[ANIMATED (2-frame)]` | Metal post w/ warm luminescent head | Placed along commercial and Main St sidewalks; night glow |
| `ST-10` | **Railroad Track** | `[STATIC]` | Ballast gravel bed, wood ties, twin steel rails | Orthogonal line crossing map; level crossings |
| `ST-11` | **Rail Trestle** | `[STATIC]` | Heavy timber deck crossing water | Timber bents supporting track over water |
| `ST-12` | **Crossbuck Crossing**| `[ANIMATED (2-frame)]` | White X sign + red flashers at street rail crossings| Alternating red flashers when train approaches |
| `ST-13` | **Rail Siding Spur** | `[STATIC]` | Secondary track stub serving grain elevator | Parallel to main line; holds parked boxcars |
| `ST-14` | **Parked Boxcars** | `[STATIC]` | Rust/olive freight cars on elevator siding | Clustered on industrial rail spur |
| `ST-15` | **Highway Billboards**| `[STATIC]` | White ad board on twin posts along highway | Positioned on rural highway approach verges |
| `ST-16` | **Welcome Signs** | `[STATIC]` | "Mundane Falls City Limits" board | Flanks Main Street entrances to town |
| `ST-17` | **Concrete Weirs** | `[ANIMATED (3-frame)]` | Low dam wall across river w/ white water cascade | Regulates river elevation; animated cascading water |
| `ST-18` | **Property Stakes** | `[STATIC]` | Cult-colored dashed boundary cord on lots | Outlines purchased wilderness parcel borders |

#### Category C: Residential Structures & Neighborhoods (11 Assets)
| ID | Asset Name | Animation Mode | Visual Signature (8px) | Realism & Placement Rules |
| :--- | :--- | :--- | :--- | :--- |
| `RES-01` | **House: Ranch/Long** | `[STATIC]` | 1-story wide facade w/ attached garage bay | Siding/roof color hashed; front lawn + driveway |
| `RES-02` | **House: Two-Story** | `[STATIC]` | Compact footprint w/ upper ridge & dormer dots | Elevated shadow; classic colonial/suburban profile |
| `RES-03` | **House: L-Plan** | `[STATIC]` | Asymmetric L-footprint w/ recessed front porch | Shaded porch nook; rear patio in backyard |
| `RES-04` | **House: Bungalow** | `[STATIC]` | Square footprint w/ full-width shaded veranda | Front steps visible; gables align to street frontage |
| `RES-05` | **Trailer Home** | `[STATIC]` | Narrow rectangular tin body w/ hitch tongue | Propane tank, plastic window awning, skirt trim |
| `RES-06` | **Trailer Court** | `[STATIC]` | Dirt court lane w/ trailers on both sides | Tight packing; tire piles, scrap metal accents |
| `RES-07` | **Detached Garage** | `[STATIC]` | Small flat-roof bay on rear of lot | Connected to street via narrow concrete driveway |
| `RES-08` | **Backyards** | `[STATIC]` | Block interior: shed, garden, pool, clothesline | Never contains a house; lush garden fences |
| `RES-09` | **Above-Ground Pool**| `[ANIMATED (2-frame)]` | Circular blue pool w/ white plastic rim & water glint | Appears in select residential backyards |
| `RES-10` | **Front Curbside** | `[STATIC]` | Mailbox on post + fire hydrant on corner | Placed on street-front verges |
| `RES-11` | **Chimney Smoke** | `[ANIMATED (3-frame)]` | Gentle woodsmoke plume drifting southeast | Select residential houses during morning/evening |

#### Category D: Commercial, Industrial & Strip Lots (14 Assets)
| ID | Asset Name | Animation Mode | Visual Signature (8px) | Realism & Placement Rules |
| :--- | :--- | :--- | :--- | :--- |
| `COM-01` | **Main St Block** | `[STATIC]` | Contiguous attached brick buildings w/ parapets | Party-wall vertical seams; glass storefront display |
| `COM-02` | **Strip Shop** | `[STATIC]` | Colorful striped awnings (red/blue/green) | Awning pattern variations; front entrance door |
| `COM-03` | **Roadside Diner** | `[ANIMATED (2-frame)]` | Streamlined chrome body w/ red neon roof band | Front parking apron; pulsing neon glows on pavement |
| `COM-04` | **Gas Station** | `[ANIMATED (2-frame)]` | Illuminated red canopy over yellow gas pumps | Corner lot; pulsing neon pricing sign |
| `COM-05` | **Laundromat** | `[STATIC]` | Glass storefront w/ circular washer porthole dots | Strip filler; tiled interior hint |
| `COM-06` | **Cinema** | `[ANIMATED (2-frame)]` | Dark facade w/ illuminated marquee canopy | Chasing marquee bulb frame; front poster cases |
| `COM-07` | **Bank** | `[STATIC]` | Formal classical stone facade w/ column hints | Prominent downtown corner presence |
| `COM-08` | **Post Office** | `[STATIC]` | Brick civic structure w/ blue/red flag stripe | Delivery loading bay in rear |
| `COM-09` | **Office Block** | `[STATIC]` | Multi-story grey block w/ regular window grid | Flat gravel roof w/ HVAC chillers |
| `COM-10` | **Highway Motel** | `[ANIMATED (2-frame)]` | Long L-shaped building w/ repeating room doors | Buzzing red neon "VACANCY" sign; parking stalls |
| `COM-11` | **Motel Pool** | `[ANIMATED (2-frame)]` | Rectangular blue swimming pool w/ deck chairs | Fenced courtyard of motel parcel; surface shimmer |
| `COM-12` | **Factory Complex** | `[ANIMATED (3-frame)]` | Sawtooth industrial rooflines w/ brick smokestack| Industrial stack emits drifting smoke particles |
| `COM-13` | **Warehouse** | `[STATIC]` | Large corrugated steel structure w/ loading docks| Semi-truck bays; gravel staging yard |
| `COM-14` | **Depot Station** | `[STATIC]` | Long low wooden station w/ wooden platform | Adjacent to main rail line; passenger benches |

#### Category E: Keystone Civic Institutions & Municipal Grounds (12 Assets)
| ID | Asset Name | Animation Mode | Visual Signature (8px) | Realism & Placement Rules |
| :--- | :--- | :--- | :--- | :--- |
| `CIV-01` | **Town Hall** | `[ANIMATED (2-frame)]` | Imposing columned facade w/ pediment + plaza | Centered in town; municipal flag flutters on pole |
| `CIV-02` | **Sheriff's Station**| `[STATIC]` | Tan stucco body w/ gold badge star + 2 cruisers | Dedicated parking stalls holding black/white police cars |
| `CIV-03` | **High School** | `[STATIC]` | Sprawling red-brick academic building | Multiple wings, central entrance, bus loop |
| `CIV-04` | **Athletic Stadium** | `[STATIC]` | Green football gridiron, running track, bleachers| Directly adjacent to High School campus |
| `CIV-05` | **Parked School Bus**| `[STATIC]` | Yellow bus sprite parked in school loading lane | Guaranteed on High School or Elementary frontage |
| `CIV-06` | **Elementary School**| `[STATIC]` | Single-story brick school w/ corner flagpole | Front sidewalk connection; dedicated parking lot |
| `CIV-07` | **Playground** | `[STATIC]` | Swing set, metal slide, and sand playbox | Located on Elementary School parcel |
| `CIV-08` | **Supermarket** | `[STATIC]` | Wide commercial box w/ blue parapet & dark glass| Large blacktop parking lot w/ painted stalls |
| `CIV-09` | **Community Church** | `[STATIC]` | Steepled white nave w/ gold cross + parsonage | Accompanied by adjacent parsonage house |
| `CIV-10` | **Town Cemetery** | `[STATIC]` | Headstone rows w/ cast shadows on mown turf | Enclosed by wrought-iron fence; church neighbor |
| `CIV-11` | **Fire Station** | `[STATIC]` | Red-brick station w/ 2 red overhead bay doors | Concrete apron; hose drying tower hint |
| `CIV-12` | **Civic Water Tower**| `[STATIC]` | Cylindrical water tank on 4-leg steel truss | Located near municipal core; painted town name |

#### Category F: Agriculture & Farmsteads (10 Assets)
| ID | Asset Name | Animation Mode | Visual Signature (8px) | Realism & Placement Rules |
| :--- | :--- | :--- | :--- | :--- |
| `AGR-01` | **Corn Field** | `[ANIMATED (2-frame)]` | Dense green crop rows w/ dark soil furrows | **Never in forests/deserts**; subtle wind sway |
| `AGR-02` | **Wheat Field** | `[ANIMATED (2-frame)]` | Golden amber rows w/ pale straw shadows | Golden ripple sway; open plains only |
| `AGR-03` | **Soybean Field** | `[STATIC]` | Lime-green low crop rows | Distinct color hue; open agricultural belt only |
| `AGR-04` | **Fallow Field** | `[STATIC]` | Rich dark brown turned earth w/ plow lines | Contrasts with green pastures; road-aligned |
| `AGR-05` | **Farmstead House** | `[STATIC]` | White two-story farmhouse w/ wrap-around porch | Anchors agricultural parcel cluster |
| `AGR-06` | **Red Gambrel Barn** | `[STATIC]` | Classic red barn body w/ white X-brace doors | Positioned beside farmhouse; standing seam roof |
| `AGR-07` | **Silver Grain Silo**| `[STATIC]` | Tall cylindrical steel silo w/ domed cap | Anchored directly against barn wall |
| `AGR-08` | **Grain Elevator** | `[ANIMATED (2-frame)]` | Towering multi-story concrete bin complex | Dominates skyline; subtle grain dust particle drift |
| `AGR-09` | **Pasture Livestock**| `[ANIMATED (2-frame)]` | Black/white dairy cows and brown horses | Graze inside fenced pasture lots; tail flick/graze |
| `AGR-10` | **Farm Machinery** | `[STATIC]` | Parked green/red tractor beside barn doors | Positioned in gravel farmyard |

#### Category G: World Landmarks (5 Assets)
| ID | Asset Name | Animation Mode | Visual Signature (8px) | Realism & Placement Rules |
| :--- | :--- | :--- | :--- | :--- |
| `LMK-01` | **The Old Megachurch**| `[STATIC]` | Massive stone cathedral nave w/ stained-glass rose| Grand cathedral scale; 24×24 pixel sprite |
| `LMK-02` | **AM Radio Tower** | `[ANIMATED (2-frame)]` | Tall lattice guyed steel mast w/ red flashing top | Guy wires to anchors; 1.0s blinking red aviation beacon |
| `LMK-03` | **County Fairground** | `[ANIMATED (4-frame)]` | Festive striped circus tents w/ colorful pennants | Rotating ferris wheel frame + pennant flutter |
| `LMK-04` | **Water Tower** | `[STATIC]` | High-capacity municipal sphere on braced pylons | Sigil display banner; prominent landmark hill |
| `LMK-05` | **Town Hall Complex** | `[STATIC]` | Classical courthouse block w/ copper cupola dome | Civic plaza, memorial stone, surrounding lawns |

#### Category H: Cult-Specific Structures & Units (24 Assets)
| ID | Cult Archetype | Asset Category | Animation Mode | Description & Visual Signature |
| :--- | :--- | :--- | :--- | :--- |
| `CLT-01` | **Final Dawn** | Compound | `[ANIMATED (2-frame)]` | Fortified survivalist bunker, sandbag berms, flickering braziers |
| `CLT-02` | **Final Dawn** | Recruitment Van | `[ANIMATED (2-frame)]` | Matte-black armored ram-van w/ roof loudspeakers & engine rumble |
| `CLT-03` | **Final Dawn** | Agent | `[ANIMATED (4-frame)]` | Red-hooded stealth figure w/ 4-frame sneaking walk cycle |
| `CLT-04` | **Final Dawn** | Pylon (Prophet) | `[ANIMATED (3-frame)]` | Cast-iron brazier pylon w/ crackling animated fire |
| `CLT-05` | **Final Dawn** | Territory Tint | `[ANIMATED (2-frame)]` | Obsidian ground overlay w/ pulsing crimson ember veins |
| `CLT-06` | **Final Dawn** | Conquered Lot | `[STATIC]` | Barbed-wire fence perimeters, bonfire ash pits |
| `CLT-07` | **Radiant Path** | Compound | `[ANIMATED (2-frame)]` | Geodesic glass dome w/ central crystal spire & light prism glints |
| `CLT-08` | **Radiant Path** | Recruitment Van | `[ANIMATED (2-frame)]` | Aerodynamic cream/sage camper van w/ rolling wheels |
| `CLT-09` | **Radiant Path** | Agent | `[ANIMATED (4-frame)]` | Barefoot robed figure w/ fluid linen walk cycle |
| `CLT-10` | **Radiant Path** | Supplement Lab | `[ANIMATED (2-frame)]` | Octagonal pavilion w/ bubbling glass distillation coils |
| `CLT-11` | **Radiant Path** | Territory Tint | `[STATIC]` | Soft watercolor gradient bloom w/ lavender & sage speckles |
| `CLT-12` | **Radiant Path** | Conquered Lot | `[STATIC]` | Botanical pergola canopies, Zen gravel garden raking |
| `CLT-13` | **Prosperity Circle**| Compound | `[ANIMATED (2-frame)]` | Modernist tower w/ rooftop digital ticker & helipad beacon |
| `CLT-14` | **Prosperity Circle**| Recruitment Van | `[ANIMATED (2-frame)]` | Glossy black executive sprinter van w/ rolling wheels & chrome glint |
| `CLT-15` | **Prosperity Circle**| Agent | `[ANIMATED (4-frame)]` | Corporate executive in sharp suit w/ brisk stride walk cycle |
| `CLT-16` | **Prosperity Circle**| Collection Plate| `[ANIMATED (2-frame)]` | Sleek brass digital kiosk w/ flashing green dollar display |
| `CLT-17` | **Prosperity Circle**| Territory Tint | `[STATIC]` | Executive midnight navy & metallic gold pinstripe pattern |
| `CLT-18` | **Prosperity Circle**| Conquered Lot | `[STATIC]` | Gold-embossed corporate signage, neon stock ticker ribbon |
| `CLT-19` | **Visitors' Fellowship**| Compound | `[ANIMATED (3-frame)]` | Retro-futurist observatory w/ rotating radar dish & cyan pulse |
| `CLT-20` | **Visitors' Fellowship**| Recruitment Van | `[ANIMATED (2-frame)]` | Retro chrome van w/ rooftop rotating antenna dish |
| `CLT-21` | **Visitors' Fellowship**| Agent | `[ANIMATED (4-frame)]` | Retro astronaut figure in silver jumpsuit w/ visor reflection walk |
| `CLT-22` | **Visitors' Fellowship**| Satellite Chapel| `[ANIMATED (4-frame)]` | Hovering silver saucer landing pad w/ gentle hovering bob & lights |
| `CLT-23` | **Visitors' Fellowship**| Territory Tint | `[ANIMATED (2-frame)]` | Deep cosmic violet w/ subtly twinkling cyan nebula starfield |
| `CLT-24` | **Visitors' Fellowship**| Conquered Lot | `[STATIC]` | Concentric crop circle burn marks, silver telemetry antennas |

#### Category I: Mobile NPCs & Living Entities (7 Assets)
| ID | Asset Name | Animation Mode | Description & Visual Signature |
| :--- | :--- | :--- | :--- |
| `NPC-01` | **Tithe Courier** | `[ANIMATED (4-frame)]` | Automated courier carrying cash bag; 4-frame pedestrian road walk |
| `NPC-02` | **CPA News Van** | `[ANIMATED (2-frame)]` | White media van w/ rotating rooftop microwave dish |
| `NPC-03` | **CPA Deprogrammer Bus**| `[ANIMATED (2-frame)]` | Yellow bus conversion w/ diesel smoke puff & wheel roll |
| `NPC-04` | **CPA Picket Line** | `[ANIMATED (2-frame)]` | 3-dot protest line bobbing signs on high-Heat fronts |
| `NPC-05` | **Living Town Residents**| `[ANIMATED (4-frame)]` | 2-px civilian dots walking along sidewalks to work/church |
| `NPC-06` | **Highway Passenger Cars**| `[ANIMATED (Continuous)]`| 2×1 civilian cars/pickups traversing highway and avenues |
| `NPC-07` | **Police Cruisers** | `[ANIMATED (2-frame)]` | Black/white cruiser w/ alternating red/blue roof lightbar flash |

---

### 4.3 Automated QA Linter & Asset Testbed System

To catch quality flaws before human review, Sprint 3 introduces an automated validation pipeline:

```
                               AUTOMATED MAPGEN QA PIPELINE
 ┌───────────────────────────┐     ┌───────────────────────────┐     ┌───────────────────────────┐
 │   tools/audit_mapgen.mjs  │ ──► │ tools/asset_inspect.mjs   │ ──► │  reports/qa_report.html   │
 │ • assertNoFarmsInForest() │     │ • Isolated Asset Grid     │     │ • Multi-Seed Aerial Views │
 │ • assertBlockPurity()     │     │ • Silhouette & Alpha Test │     │ • Magnified Zone Crops    │
 │ • assertParkingAttached() │     │ • Palette Token Check     │     │ • Visual Diff / Sign-off  │
 │ • assertZoningBuffer()    │     │ • Directional Shadow Test │     │ • Automated Pass/Fail LED │
 └───────────────────────────┘     └───────────────────────────┘     └───────────────────────────┘
```

1. **The Automated Mapgen Linter (`tools/audit_mapgen.mjs`):**
   - Headless CLI script run on every build and CI push across 10 random seeds.
   - Programmatic invariant assertions:
     - `assertNoFarmsInForest()`: Scans all `Terrain.Field`, `Terrain.Orchard`, `Terrain.Pasture` tiles; asserts $0$ overlap with `Biome.Forest` or standing timber.
     - `assertNoCropsInDesert()`: Asserts $0$ crop tiles on `Biome.Desert` dunes.
     - `assertWaterBuffers()`: Asserts all non-dock structures and crops maintain $\ge 1$ grass tile margin from water.
     - `assertBlockPurity()`: Asserts $100\%$ of residential houses have road/lane frontage; zero houses in block interiors.
     - `assertParkingAttached()`: Scans all civic and commercial lots; asserts that an adjacent blacktop parking parcel shares at least one tile edge.
     - `assertZoningBuffer()`: Asserts industrial structures maintain $\ge 6$ tiles distance from schools and churches.
2. **The Isolated Asset Calibration Testbed (`tools/asset_inspection.mjs`):**
   - Renders each of the 119 assets in isolation on a 32×32 pixel neutral grey checkerboard at $1\times$ and $8\times$ zoom.
   - Validates that:
     - The asset silhouette is populated (non-empty).
     - Palette colors strictly match the approved 12-color Americana ramp or cult token sets.
     - The 1px South/East directional drop shadow is present.
     - Symmetrical distortion or orphan floating pixels are flagged.
3. **Automated HTML Visual Regression Report (`reports/qa_report.html`):**
   - Compiles rendered screenshots across seeds `11, 21, 42, 77, 99`:
     - Aerial $1\times$ town view.
     - $8\times$ Magnified Crops: Downtown Core, Residential Block, Civic Campus, Farmstead, Highway Interchange.
     - Side-by-side spec comparison displaying automated pass/fail LEDs.

---

### 4.4 Technical Tasks for Sprint 3 (Placement Fixes & Asset Realism) [COMPLETED]

- [x] **Task 3.0: Ecological & Placement Sanity Engine Overhaul (`mapgen.ts`)**
  - **Forest / Farmland Separation Invariant:**
    - In `layoutFarms()` and `fillFarmBelt()`, check `if (w.biome[t] === Biome.Forest || w.biome[t] === Biome.Desert) continue;`.
    - Farmland parcels strictly excluded from Forest or Desert biomes; separated from standing timber.
  - **Hydrological Setback Invariant:**
    - Strict 1-tile grass buffer preventing crops, orchards, pastures, or non-dock buildings from directly bordering water (`Terrain.Lake`).
  - **Zoning Separation Invariant:**
    - Industrial zoning placement (`Districts.Industrial`, factories, warehouses) strictly separated by $\ge 6$ tiles from Elementary/High Schools and Churches via automatic re-zoning and relocation.
  - **Block Interior Sanitation:**
    - 100% of residential houses with pop $\ge 3$ have direct street/lane frontage; zero orphan houses in block interiors.
  - **Parking Lot Adjacency Check:**
    - 100% of civic and commercial anchors guaranteed an adjacent blacktop parking lot.
- [x] **Task 3.1: Residential Architecture Variety (`townRender.ts`)**
  - Implemented 4 distinct architectural footprints: Ranch/Long w/ garage, Two-Story Colonial w/ dormers, L-Plan w/ porch, Bungalow w/ veranda.
  - Seed-hash siding colors (clapboard, cream, brick red, sage) and roof asphalt shingle micro-details per district.
- [x] **Task 3.2: Commercial Storefront Realism (`townRender.ts`)**
  - Flat parapet roofs, 3 striped awning colorways (Red, Blue, Green), rooftop HVAC chillers, and rear service alleys w/ dumpsters.
  - Standalones: Diner (chrome/neon), Gas Station (illuminated canopy), Cinema (lit marquee).
- [x] **Task 3.3: Civic Infrastructure & Athletic Grounds (`townRender.ts`)**
  - High School: Athletic gridiron/track oval + yellow school bus sprite.
  - Elementary: Playground w/ swings, metal slide, and sand playbox.
  - Sheriff: Dedicated stalls w/ 2 parked police cruisers (cruisers with blue/red beacons).
- [x] **Task 3.4: Street Network & Pavement Contrasts (`gridRoads.ts` & `townRender.ts`)**
  - 4-lane highway w/ double-yellow seam + white fog lines $>$ 2-lane street w/ sidewalks & curbs $>$ dirt farm lanes. No diagonal roads.
- [x] **Task 3.5: Agricultural Realism & Clustered Farmsteads (`townRender.ts`)**
  - 4 crop textures (Corn, Wheat, Soy, Fallow) aligned to roads; clustered Farmhouse + Red Barn + Silver Silo + Fenced Pasture w/ cattle and stock pond.
- [x] **Task 3.6: Automated QA Linter & Testbed Scripting (`tools/audit_mapgen.mjs` & `packages/sim/src/assetCatalog.ts`)**
  - Implemented `tools/audit_mapgen.mjs` and wired it into the `npm test` gate.
  - Created `packages/sim/src/assetCatalog.ts` with 121 cataloged assets.
- [x] **Task 3.7: Static vs Animated Asset Flagging & Render Pipeline (`townRender.ts` / `types.ts` / `assetCatalog.ts`)**
  - Flagged all 121 assets in engine metadata as either `[STATIC]` or `[ANIMATED (X-frame)]`.
  - Implemented tick/time modulo frame switching in `townRender.ts` without runtime memory allocations:
    - Water shimmer: 4-frame ripple glints on rivers and lakes (`(tick >> 2) % 4`).
    - Chimney woodsmoke: 3-frame smoke plume drift over homes (`(tick >> 3) % 3`).
    - Radio Tower: 2-frame red aviation warning beacon (1.0s blink cycle).
    - Vehicles & Pedestrians: Smooth sub-tile translation with wheel spin and 4-frame walking cycles.
    - Cult structures: Flickering braziers (Dawn), crystal prisms (Radiant), helipad strobes (Circle), rotating dishes (Visitors).
- [x] **Task 3.8: Multi-Map Generation Matrix & Automated Audit Runner (`tools/audit_mapgen.mjs` & `tools/generate_qa_report.mjs`)**
  - Implemented matrix runner auditing all 5 town archetypes across 50 seeds (250 worlds tested: 100% pass, 0 violations).
  - Generated standalone HTML inspection report (`reports/qa_report.html`) with benchmark full-map and crop PNGs.

---

### 4.5 The Master Visual QA Checklist & Inspection Protocol

Visual inspection must be conducted using headless image renders (`node tools/screenshots.mjs`) across **5 benchmark seeds (`11, 21, 42, 77, 99`)**, audited against the failure tags:
- `MISGEN`: Broken shapes, garbled colors, missing pixels, seam tears.
- `MISPLACED`: Correct asset in an impossible location (e.g. farm in forest, factory next to school).
- `MISSING`: Required standard town feature completely absent from seed.
- `MONOTONE`: Asset repeats with zero architectural or color variation.
- `DENSITY`: Too many or too few instances of an asset across seeds.

#### Inspection Pass 1: Ecological & Zoning Placement Sanity (THE SANITY AUDIT) [VERIFIED]
- [x] **Zero Farms in Forests:** Every single crop parcel, orchard, pasture, and barn is located in open country; **zero instances of farmland generated inside Forest biome blobs or timber stands** (`MISPLACED`). *[Verified: 75/75 audit worlds pass with 0 violations]*
- [x] **Zero Crops in Deserts:** Zero crop parcels on desert sand, dunes, or dry washes (`MISPLACED`). *[Verified: 100% clean across all seeds]*
- [x] **Water Shore Setbacks:** Zero agricultural or building tiles directly contact water without a 1-tile grass buffer (`MISPLACED`). *[Verified: 1-tile setback invariant enforced]*
- [x] **Industrial Buffers:** Industrial factories and warehouses generate strictly along rail/highway spurs; **zero industrial lots sharing borders with schools, churches, or residential cul-de-sacs** (`MISPLACED`). *[Verified: ≥6 tile buffer strictly maintained]*
- [x] **Parking Lot Adjacency:** 100% of civic parking lots share at least one edge directly with their target building (`MISPLACED`). *[Verified: 100% attached parking lots]*
- [x] **Zero Orphan Homes:** 100% of residential structures have frontages on streets or courts. Zero houses inside block interiors (`MISPLACED`). *[Verified: 100% block perimeter frontage]*

#### Inspection Pass 2: Street Hierarchy & Layout Integrity [VERIFIED]
- [x] **Highway Check:** 4-lane highway spans the world end-to-end; dark asphalt contrast; yellow center seam clean w/ no jagged pixel tears; thin, weathered fog lines strictly on outer shoulders (`MISGEN`). *[Verified & polished]*
- [x] **Cul-de-Sac Bulbs:** Every dead-end residential street terminates in a rounded bulb turnaround w/ houses radial around it (`DENSITY: 2–5 per town`). *[Verified]*
- [x] **Bridge Crossings:** Bridges over water feature timber/stone deck textures and visible side railings. No raw asphalt touching open water tiles (`MISGEN`). *[Verified]*
- [x] **Crosswalks & Signs:** Zebra crosswalks present at downtown junctions; stop signs placed where side streets meet highways; strictly orthogonal roads with no diagonals (`MISSING`). *[Verified]*

#### Inspection Pass 3: Residential Architectural Variety [VERIFIED]
- [x] **House Footprints:** Verify that residential zones exhibit all 4 architectural footprints (Ranch, Two-Story, L-Plan, Bungalow) (`MONOTONE`). *[Verified across RES-01 to RES-04]*
- [x] **Palette Hashing:** Adjacent houses never share identical siding and roof colors (`MONOTONE`). *[Verified via seed-hashed district palettes]*
- [x] **Backyard Infill:** Block interiors strictly contain backyards (green lawns, sheds, swimming pools, vegetable patches, fences) (`MISPLACED`). *[Verified across RES-08 to RES-10]*
- [x] **Trailer Park Integration:** Trailer homes generate in an organized court layout on the town outskirts, complete with propane tanks and skirting (`MISPLACED`). *[Verified across RES-05 to RES-06]*

#### Inspection Pass 4: Commercial & Downtown Realism [VERIFIED]
- [x] **Contiguous Storefront Blocks:** Downtown Main Street features wall-to-wall storefronts with distinct party-wall vertical seams (`MISGEN`). *[Verified across COM-01]*
- [x] **Awning Variation:** Storefronts cycle through at least 3 distinct retro striped awning patterns (Red, Blue, Green) (`MONOTONE`). *[Verified across COM-02]*
- [x] **Rooftop Dressing:** Commercial buildings display flat gravel roofs with rooftop HVAC compressor units and vents (`MISSING`). *[Verified across COM-09]*
- [x] **Standalone Anchors:** Diner (chrome/neon), Gas Station (overhead canopy/pumps), Bank (classical white pediment, Doric columns, green dollar symbol, and heavy vault door with spin wheel), and Cinema (illuminated neon marquee with bulb border, overhanging triangular marquee canopy, poster lightboxes, box office booth, and red carpet runner) appear along the strip (`MISSING`). *[Verified across COM-03, COM-04, COM-06, COM-07]*
- [x] **Alleyways & Dumpsters:** Rear alleys behind Main Street show green dumpster boxes and delivery apron paving (`MISSING`). *[Verified across COM-01, COM-08]*

#### Inspection Pass 5: Keystone Civics & Institutional Grounds [VERIFIED]
- [x] **Civic Lot Buffering:** Immediate residential lots flanking major civic institutions (`Supermarket`, `HighSchool`, `School`, `Library`, `Cinema`, `FireStation`, `Factory`, `Bank`) are automatically diverted into expanded blacktop parking aprons or landscaped green plazas, eliminating houses directly adjoining civic anchors (`MISPLACED`). *[Verified: 100% clean buffering]*
- [x] **High School Complex:** Brick academic building generates with adjacent green athletic field (running track/gridiron) and a parked yellow school bus (`MISSING`). *[Verified across CIV-03, CIV-04, CIV-05]*
- [x] **Elementary Grounds:** Elementary school includes an asphalt/mulch playground with swing set and jungle gym (`MISSING`). *[Verified across CIV-06, CIV-07]*
- [x] **Sheriff Dept:** Station lot features at least 2 parked black-and-white police cruiser sprites in front stalls (`MISSING`). *[Verified across CIV-02]*
- [x] **Parsonage House:** Community Church is accompanied by an adjacent residential parsonage house (`MISSING`). *[Verified across CIV-09]*
- [x] **Cult Asset Glow Opacity:** Cult territory glow and studio cult asset rendering capped to soft atmospheric low opacity ($\alpha \le 0.28$) with quadratic falloff (`MISGEN`). *[Verified across all cult assets]*

#### Inspection Pass 6: Agriculture & Rural Landscape [VERIFIED]
- [x] **Contiguous Farm Belts:** Crop parcels form continuous working blocks without random grass voids wider than 6 tiles (`DENSITY`). *[Verified across AGR-01 to AGR-04]*
- [x] **Crop Variety:** Neighboring fields alternate between Corn (dark green), Wheat (gold), Soybeans (lime), and Fallow (brown plow) (`MONOTONE`). *[Verified across AGR-01 to AGR-04]*
- [x] **Plow Row Alignment:** Crop rows strictly follow the orientation angle of the nearest road (`MISPLACED`). *[Verified]*
- [x] **Farmstead Clusters:** Every farmstead generates as a clustered unit: Farmhouse + Red Gambrel Barn + Cylindrical Silver Silo + Fenced Pasture (`MISSING`). *[Verified across AGR-05, AGR-06, AGR-07]*
- [x] **Pasture Animals:** Fenced pastures contain pixel cattle (black/white) and horses (brown) with stock-tank watering ponds (`MISSING`). *[Verified across AGR-09, ENV-19]*

#### Inspection Pass 7: Cult-Specific Visual Distinction (360p Readability) [VERIFIED]
- [x] **Final Dawn:** Molten crimson/obsidian ember veins are unmistakably distinct from normal grass; bunker compound reads as a 2×2 fortified redoubt with flaming braziers and pulsing crimson glow; armored van reads as a heavy assault vehicle (`MISGEN`). *[Verified across CLT-01 to CLT-06]*
- [x] **Radiant Path:** Watercolor botanical bloom creates a peaceful pastel aura; 2×2 geodesic greenhouse dome reads as glass/crystal with apex spire and prismatic lavender/cyan halo; camper van reads as an eco-van (`MISGEN`). *[Verified across CLT-07 to CLT-12]*
- [x] **Prosperity Circle:** Navy/gold pinstripes are crisp and executive; 2×2 modern skyscraper w/ helipad strobe reads with golden aura; sprinter van reads as executive transport (`MISGEN`). *[Verified across CLT-13 to CLT-18]*
- [x] **Visitors' Fellowship:** Cosmic starfield with cyan nebula dots reads as otherworldly; 2×2 retro observatory w/ parabolic dish and cyan halo reads as sci-fi radar station; chrome camper w/ antenna reads as extraterrestrial tracker (`MISGEN`). *[Verified across CLT-19 to CLT-24]*

#### Inspection Pass 8: Static vs. Animated Asset Flagging Verification [VERIFIED]
- [x] **Water Shimmer:** Verify rivers (`ENV-06`), creeks (`ENV-07`), and lakes (`ENV-08`) exhibit continuous glint frame cycling without visual stutter or tears (`MISGEN`). *[Verified: 4-frame / 3-frame cycling]*
- [x] **Smoke & Fire Particles:** Verify chimneys (`RES-11`), industrial stacks (`COM-12`), and Final Dawn braziers (`CLT-04`) loop smoke puffs smoothly (`MISGEN`). *[Verified: 3-frame animated loops]*
- [x] **Aviation Beacon:** Radio tower (`LMK-02`) top beacon blinks at a clean 1.0-second interval (`MISGEN`). *[Verified: 2-frame 1.0s beacon]*
- [x] **Mobile Units:** Tithe couriers, vans, civilian sedans, and agents translate cleanly across tiles without ghosting or clipping into building geometry (`MISGEN`). *[Verified]*

---

### 4.6 Comprehensive Multi-Map QA Matrix (Audit All Map Types & Seeds)

To guarantee that world generation holds its standards across all environments, `tools/audit_mapgen.mjs` runs against a 50-seed matrix spanning all 5 town archetypes:

| Town Archetype | Key Characteristics & Layout Constraints | Seed Range | Automated Verification Gate |
| :--- | :--- | :--- | :--- |
| **`PrairieGrid`** | Strict orthogonal grid blocks, sprawling agricultural belt, central square | Seeds 1–10 | Zero farms in forest; 100% parking attached; no orphan blocks |
| **`RiverTown`** | Winding river basin, road bridges, weir dam, waterfront grain depot | Seeds 11–20 | 100% water setback; bridges correctly paved; monotonic flow |
| **`HighwaySprawl`** | Diagonal/crossroads interstate bypass, motels, diners, commercial strip mall | Seeds 21–30 | Double-yellow highway seam continuous; commercial parking contiguous |
| **`RailDepot`** | Industrial rail corridor, siding spur, boxcars, towering grain elevator | Seeds 31–40 | 6-tile industrial-to-school buffer; rail crossings marked with crossbucks |
| **`MountainValley`** | Topographical ridges, forest pockets, stone outcrops, winding country lanes | Seeds 41–50 | Roads respect contour slopes; zero farmland in timber stands |

- **Automated CI Gate:** `node tools/audit_mapgen.mjs --matrix --seeds=1..50` executes in `< 5.0s`. If even a single seed breaches any ecological or zoning invariant, the build fails with an exact coordinate diff.
- **Visual HTML Gallery:** Outputs `reports/map_matrix_qa.html` with zoomable aerial overviews, regional crops, and status LEDs for each of the 50 maps.

---

## 5. Sprint 4: Frontend UI/UX Master Polish & Tactile Readability

**Objective:** Overhaul the DOM HUD and client renderer ([hud.ts](./packages/client/src/hud.ts)) to give players clear, beautiful, and tactile feedback for building control, decrees, monopolies, and incoming threats.

### 5.1 Technical Task Breakdown
- [x] **Task 4.1: The Compact Active Status Ribbon & Institutional Tray (`hud.ts`)**
  - **Sleek, Non-Intrusive Height (28px):** Positioned directly beneath the match header, consuming minimal vertical space and never obstructing the game view.
  - **Active Buffs & Monopolies Visibility:** Displays all active decrees (*Curfew*, *Injunction*, *Jam*, *Rationing*, *Revival*, *Pep Rally*) and held monopolies (*Town Machine*, *Indoctrination Pipeline*, *Food & Fuel Cartel*, *Sacred Canopy*) as crisp 20×20 glowing badges.
  - **Circular Pie Sweeps:** Radial tick countdown timers overlaid on each badge showing remaining duration and cooldown ticks at a glance.
  - **Transparent Click-Through Gutters:** Zero deadzones—clicks on the map beneath or around the tray pass directly through to map tiles.
  - **Collapsible Drawer Toggle:** 1-click arrow toggle allows players to collapse the tray into a tiny 12px pill indicator.
  - **Rich Instant Tooltip:** Hovering any active badge shows controlling institution, exact gameplay multipliers, remaining seconds, and affected districts without opening a modal.
- [x] **Task 4.2: Civic Decree Action Tray & Hotkeys (`hud.ts` & `main.ts`)**
  - When controlling an institution, decree actions integrate into client input and key handlers.
  - Hotkey integration (keys `5, 6, 7, 8`) with instant intent dispatch for majority-controlled institutions (`Sheriff`, `HighSchool`/`School`, `Supermarket`/`Church`, `Shop`/`Office`).
  - Triggering a decree plays a distinct audio cue and triggers visual state updates.
- [x] **Task 4.3: HUD Simplification & Resource Streamlining (`hud.ts`)**
  - Declutter redundant text labels and harmonize typography into a crisp, high-contrast monospace layout.
  - Vital resources (Faith, Followers, Tithe Cash, Heat) given distinct, color-coded icons and large legible numeric readouts.
  - Secondary stats (dissent per district, courier routes, conversion rates) cleanly tucked into expandable drawers.
- [x] **Task 4.4: High-Stakes Threat Telegraphs (`hud.ts`)**
  - **Scandal 50% Notice:** Amber alert banner with audio notice ("...is digging up dirt on you").
  - **Ledger 60% Progress Bar:** Live ticker showing Prosperity Circle's bank progress toward $1.2M target.
  - **Strike 10s Warning:** Flasher banner warning of incoming pamphlet bomb, expose, or manifesto drop.
- [x] **Task 4.5: Interactive Hover Lot Inspector (`hud.ts`)**
  - Hovering any lot displays a pixel tooltip showing:
    - Lot Name (e.g., *"THE HIGH SCHOOL"*, *"SUPERMARKET"*, *"SHERIFF'S OFFICE"*).
    - District & Current Believer / Neutral / Owner attribution.
    - Street address and household/garden identity.
- [x] **Task 4.6: Responsive Mobile & Accessibility Polish (`hud.ts` & `settings.ts`)**
  - Reduced motion mode and chat muting toggles.
  - Colorblind pattern layer compatibility and collapsible side rails.

### 5.2 Verification & QA Gates
- Run client at `http://localhost:5173`.
- Test all decree clicks and hotkeys.
- Verify that every notification is delivered within 250ms of sim events without UI modal blocking.
- **HUD Ergonomics & Screen Real Estate QA:**
  - Verify that the entire HUD (header, status tray, decree dock, minimap) occupies less than $12\%$ total viewport area on 1080p and 720p screens.
  - Verify that with 4 decrees and 2 monopolies active simultaneously, all active effects remain visible and readable, but the tray never interferes with clicking and dragging map tiles directly underneath.

---

## 6. Sprint 5: Balance Verification, Nightly Bot-League & Determinism QA

**Objective:** Rigorously balance all archetypes and building mechanics across headless simulation matches, verifying zero desyncs and maintaining absolute lockstep determinism.

### 6.1 Technical Task Breakdown
- [x] **Task 5.1: Bot-League Balance Harness (`tools/botleague.mjs`)**
  - Expanded `botleague.mjs` to simulate matches across all archetype combinations on configurable maps.
  - Track metrics:
    - Archetype winrates across symmetric multi-player pairings.
    - Decisive domination vs. tiebreak finishes.
    - Average placement and drift alarms.
- [x] **Task 5.2: Bot AI Intent Adaptation (`bots.ts`)**
  - Updated `Established Church` AI bots to understand archetype-specific building priorities:
    - Final Dawn bots prioritize expanding toward the High School and Sheriff.
    - Radiant Path bots prioritize the Supermarket and Church.
    - Prosperity Circle bots prioritize Commercial banks and Offices.
    - Bots intelligently cast Active Decrees (Curfew, Pep Rally, Food Rationing, Evangelical Revival, Parent-Teacher Night) when controlling key institutions.
- [x] **Task 5.3: Cross-Environment Determinism CI (`packages/sim/test/determinism.test.ts`)**
  - Verified that lockstep `StateHash` matches bit-identically across runs and snapshot round-trips.
- [x] **Task 5.4: Stress & Soak Test (`tools/soak.mjs`)**
  - Synthesizes multi-client headless load fuzzing intents to confirm 0.00% desync rate against running servers.

### 6.2 Verification & QA Gates
- `npm test` passes 100% (121 tests green; 75/75 mapgen invariant audit seeds pass with 0 violations).
- Bot league output verifies multi-archetype competitive viability and decisive finishes.
- Determinism gate confirmed bit-identical.

---

## 7. Sprint 6: Production Dockerization, Deployment & Release Ops

**Objective:** Deliver an automated, zero-friction Docker container and orchestration setup allowing anyone to host *Flock* on any Linux VPS with a single command.

### 7.1 Technical Task Breakdown
- [x] **Task 6.1: Production Multi-Stage Dockerfile (`Dockerfile`)**
  - Multi-stage build:
    - Stage 1 (`build`): Node 22 Alpine, compiles `@flock/sim`, `@flock/server`, and `@flock/client` production bundle.
    - Stage 2 (`runtime`): Ultra-slim Alpine runtime with production-only dependencies.
  - Built-in `/health` healthcheck probe with 30s interval.
- [x] **Task 6.2: Docker Compose Orchestration (`deploy/docker-compose.yml`)**
  - Pre-configured services:
    - `server`: Node 22 match host running on port `8787` with volume persistence.
    - `client`: Nginx reverse proxy serving static client bundle on port `8080` and proxying WebSocket traffic.
  - Persistent volume mount for durable JSON storage (`flock-data`).
- [x] **Task 6.3: Environment & Security Hardening (`.env.example`)**
  - Configurable `FLOCK_SECRET` session signing.
  - Configurable map sizes, bot backfills, church counts, and log levels.
- [x] **Task 6.4: One-Command Deployment Verification**
  - Validated single-command compose stack:
    ```bash
    docker compose -f deploy/docker-compose.yml up --build
    ```

### 7.2 Release Definition of Done Checklist
- [x] Clean build across all packages (`npm run build`).
- [x] Determinism gate passes (`npm test`).
- [x] Automated mapgen linter (`tools/audit_mapgen.mjs`) passes with zero placement, zoning, or parking errors.
- [x] Isolated asset calibration testbed (`tools/generate_catalog_inspection.mjs`) verifies all 121 assets render valid silhouettes.
- [x] All 4 cult kits visually distinct and rendered.
- [x] Map generation realism passes the 9.5/10 aerial photo test across all seeds and archetypes.
- [x] Docker configuration and compose stacks verified.
- [x] Replay save and Recap Card generation verified headless.

---

## 8. Summary Milestone Timeline

| Sprint | Focus Area | Primary Deliverables | Target Quality Gate |
| :---: | :--- | :--- | :--- |
| **Sprint 1** | Sim Engine & Civics | 7 Decrees, 4 Monopolies, Intent handlers | All sim tests green; StateHash preserved |
| **Sprint 2** | Cult Kits & Assets | Asymmetric kit balances, bespoke 8px/16px pixel sprites | Instant visual recognition at 360p |
| **Sprint 3** | World Gen Realism & Plats | Urban blocks, parking aprons, automated linter & testbed | Passes `audit_mapgen.mjs` & 9.5/10 photo test |
| **Sprint 4** | Frontend UI/UX | Institutional ribbon, decree triggers, hover tooltips | Complete DOM HUD with sub-250ms feedback |
| **Sprint 5** | QA & Balance | 1,000-match bot league, cross-browser hash verification | Winrate 45–55% across all 4 cults; 0 desyncs |
| **Sprint 6** | Docker & Release | Multi-stage Docker, Compose stack, deployment guide | One-command `docker compose up` launch |
