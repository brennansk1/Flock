# FLOCK — Asset Ledger

_Every rendered asset in the game, where it's drawn, and what it looks like. All
assets are **procedural** — drawn pixel-by-pixel in [`packages/sim/src/townRender.ts`](./packages/sim/src/townRender.ts)
(shared bit-identically by the PixiJS client and every headless renderer).
Companion docs: [DESIGN.md](./DESIGN.md) §30 (art direction), [BUILD_MANIFEST.md](./BUILD_MANIFEST.md) (build status), [STANDARDS_MAPGEN.md](./STANDARDS_MAPGEN.md) (target-state standards)._

## The render model — a single level of detail

The map is a tile grid at a **fixed 8 px/tile**. There is **one level of
detail**: what the renderer draws is exactly what shows at every zoom. The
client's camera (`packages/client/src/render.ts`) magnifies those same 8px
pixels when you zoom in — it does **not** switch to a denser pass or add
sub-pixel features up close. There is no LOD ladder and no detail channel:
every asset must carry all of its meaning as a **silhouette + a few colors at
8px**. If a feature can't be read at 8px, it isn't drawn — choose a silhouette
or color that conveys it instead.

**Status legend:** ✔️ live procedural · 🧩 FUTURE — an animation or richer form
flagged for a later art pass (tracked as B5.3.1 in the Build Manifest); the
static 8px form ships now.

## Terrain tiles (`drawTile`)

| Asset | Appearance (8 px) | Future (🧩) |
|-------|-------------------|-------------|
| Grass / open country | two-octave rolling meadow (light/shadow), scrub flecks, flowers | 🧩 wind-swept grass animation |
| Rock outcrops | 3-px cluster on high ground | — |
| Brush pockets | clustered bush pixels + cast shadow | — |
| Lone country trees | 2×2 canopy + shadow, species variety (pine/shrub/autumn/dead) | — |
| Utility poles | pole + crossarm marching every 3 tiles along rural roads; suppressed on dead-end verges; wire spans between poles | — |
| Woods | clumped light/dark canopy, trunk gaps, sunlit N/W fringe, edge bleed onto neighbors (`naturalEdgeBleed`) | — |
| Lake / river | deep water, drifting ripple rows, glints, sand shore (desert) or grey gravel/stone shores (temperate/forest); Weeping Willow gallery trees along non-desert banks | 🧩 animated flow direction on the river |
| Crop fields | gold crop with row striping, fence posts or roadside drainage ditches (mud + water glints), conifer shelterbelts | 🧩 crop growth stages by match clock |
| Dirt lanes | mottled two-tone dirt | — |
| Footpath (Terrain.Path) | stone walk (legacy support; mapgen no longer emits them — homes front roads) | — |
| Orchard | mown rows with tree lines + shadows, red apples / pink blossoms on canopies | 🧩 blossom/fruit seasons |
| Pasture | fenced worn-grazed meadow (trampled dry pockets), cattle herds (white/brown), watering troughs, stock-tank farm ponds with mud rings | 🧩 cow walk cycle |
| Biome: desert | sand with dune crests, dry scrub, saguaro stands, tumbleweeds, bleached skulls, green oasis margins with date palms near riverbanks | 🧩 heat shimmer |
| Biome: forest | darker forest-floor grass, denser stands, red mushrooms, mossy fallen logs, fern clusters | — |
| Asphalt road | worn asphalt, sidewalk skirts where lots front it, gravel shoulders in country | 🧩 tire tracks / patch cracks |
| Lane markings | 4-lane highway: yellow center seam + white lane dashes; 2-lane streets: faint center dashes | — |
| Traffic | deterministic cars (hash of position × tick) — two directions, denser on the highway; parked cars in lots | 🧩 turning traffic at intersections |
| Stop signs | red head + post where a side street tees in | — |
| Traffic lights | paired red/green heads at downtown 4-ways | 🧩 cycling phases |
| Streetlights | lamp posts with warm heads, downtown/commercial sidewalks | 🧩 night mode glow |
| Welcome signs | "town line" boards flanking Main Street's ends | 🧩 painted town name |
| Railroad | ballast bed, ties, twin steel rails; trestle deck over water; level crossings with crossbucks where streets cross | 🧩 moving freight train |
| Parked boxcars | rust/olive consist on the elevator siding | — |
| Hedgerows | brush line where crops meet standing timber | — |
| Shelterbelts | windbreak tree rows on farmstead north sides | — |
| Desert ecotone | 3-ring graded sand/scrub transition into grass | — |
| **Highway center line** | dashed yellow line along the 2-lane seam | — |
| **Crosswalks** | zebra dashes at downtown intersections | — |
| **Bridge** (road over water) | plank deck (seams across travel) + railing posts | — |
| **Creek water** | narrow channels run a shade lighter/greener than open river/lake | — |
| **Ocean & beach** (§2A oceanside) | wavy-coast sea, sand beach with shells + beach grass, pier, estuary mouth | 🧩 rolling surf line |
| **Billboards** | white ad boards on posts along rural highway approaches | — |
| **Produce stand** | white-canopy stand + crates on road-fronting field corners | — |
| **Quarry scar** | a gravel pit gouged into deep country (dirt scar) | — |
| **Junk/salvage dressing** | dead cars, tire piles, scrap sheet on trailer-fringe lots | — |
| **School bus** | yellow bus parked at the school curb | — |
| **Backstop + bleachers** | dark backstop arc + two bleacher strips at the ballfield | — |
| **Parked tractor** | green/red tractor at barn doors | — |
| **Parsonage** | a full household guaranteed beside every church/chapel | — |
| **Dry wash** | winding dry-creek bed of packed sand + stones through desert blobs | — |
| **Motel pool** | blue pool rectangle on the motel's east end | — |
| **Elevator office shed** | scale-house at the grain elevator's foot | — |
| **Laundromat / barber** | shop strip-filler variants: washer portholes / red-white pole | — |
| **Signal mast** | red lamp post at the highway rail crossing | — |
| **Rail spur** | stub track branching from the main line into the industrial lobe | — |
| **Trailer court** | short dirt court lane off a street, trailers flanking both sides | — |
| **Wheel-line irrigation** | silver sprinkler pipe + wheels across a rare field | — |
| **Horse** | chestnut + black mane pasture variant beside the cattle | — |
| **Garage** | flat-roof bay on the corner of some house lots | — |
| **Autumn ecotone** | golden-rust ground fades over 3 rings at autumn biome edges | — |

## Town lots (`drawLotBuilding` + `LOT_STYLE`) — conversion targets with jobs

| Asset | Appearance (8 px) | Future (🧩) |
|-------|-------------------|-------------|
| House (per district) | classic/two-story/L-plan shapes, district roof palette, wall, door, chimney, porch; gables fronting E/W streets turn their ridge parallel to the street (§8A); adobe walls + clay roofs in desert biome (§2A) | 🧩 per-district facade sets |
| **Trailer home** (trailer fringe) | long tin mobile home, hitch tongue, skirting, propane tank, plastic awning + tire/junk pile | — |
| Downtown block | contiguous rows segmented into individual attached buildings (1–3 tiles): per-building wall tone, cornice/parapet accent, window rhythm, party-wall seams, storefront glass strip + door, rooftop vents (§8A) | 🧩 storefront signage |
| Shop | awning patterns (red/blue/green), flat-parapet variants, corner entrance doors | 🧩 painted sign glyphs |
| **Low dam/weir** | concrete weir wall crossing the river, textured spillway cascades | — |
| **Water Tower (in-town)** | metal tank on steel truss legs | — |
| Supermarket | wide box, blue accent, dark glass | — |
| Diner | chrome body + red neon strip | 🧩 blinking neon |
| School | brick body, flagpole on corner | — |
| Library | stone body | — |
| Chapel | white body + steeple | — |
| Church | steepled nave (2-tile), gold cross | — |
| Gas station | red canopy + yellow pumps | — |
| Sheriff | tan body + gold star | — |
| Office | gray block, window grid | — |
| Bank | columned facade | — |
| Post office | flag stripe | — |
| Fire station | red body, garage bays | — |
| Factory | sawtooth roof + smokestack | 🧩 drifting smoke plume |
| Motel | unit doors under a long eave, "vacancy" neon | — |
| Barn | red body, white X door | — |
| Silo | cylinder + dome cap | — |
| **Greenhouse** | glass panes with frame ribs + glint | — |
| Park | trees + dirt path | — |
| **Playground** | swing frame, slide, sandbox on mown grass | — |
| Parking lot | painted bays + parked cars | — |
| Cemetery | headstone rows + shadows on mown grass | — |
| Ballfield | dirt infield diamond + home plate | — |
| **Cinema** | dark facade, lit marquee strip, poster bill | 🧩 marquee letter crawl |
| **Dock** | plank walkway reaching into the water + moored rowboat | — |
| **Grain elevator** | tall bin bank + headhouse over the siding (the town's skyline) | 🧩 spout + dust |
| **Depot** | long low station with platform strip | — |
| **Lighthouse** (§2A oceanside) | white tower, red lamp room, lit top, gallery band | — |
| **Cannery** (§2A oceanside) | long gray fish house, skylights, crate stack | — |
| **Sawmill** (§2A mountain) | timber shed, log deck, sawdust burner, log yard | — |

## Landmarks (`LANDMARK_ICON`, gold)

| Asset | Icon (8 px) | Future (🧩) |
|-------|-------------|-------------|
| Town Hall | columned civic block | — |
| Megachurch | broad nave, cross spire, rose window | 🧩 parking-crowd dressing |
| Radio Tower | tall guyed mast, blinking top | 🧩 signal-pulse animation |
| Fairground | tent + pennants | 🧩 ferris-wheel silhouette |
| Water Tower | tank on legs | — |

## Cult buildings (`ICONS`, tinted by owner color)

| Asset | Icon (8 px) | Growth / states | Future (🧩) |
|-------|-------------|-----------------|-------------|
| Compound | cross-topped hall | **expansion stages**: fence posts at ≥7% town share, banners at ≥15%; gray while building, red-tinted when disabled | 🧩 stage-3 annex wing footprint |
| Collection Plate | plate + coins | disabled tint | — |
| Watchtower | legged tower | — | — |
| Broadcast Tower | mast + radiating accents | — | 🧩 broadcast ripple |
| Hotline Center | headset motif | — | — |
| Print Shop | press + paper accents | — | — |
| Garage | bay doors | — | — |
| Supplement Lab | flask | — | — |
| Satellite (Visitors) | dish on legs | — | — |
| Wilderness claim | archetype set-dressing where a cult colonizes woods/fields/grass: Dawn bonfires · Radiant domes+flags · Circle billboards · Visitors crop-circles (stage-scaled) | density scales with territory share | 🧩 unique per-archetype props |

## Units & people (`UNIT_SPRITES`, `drawResidents`)

| Asset | Form | Future (🧩) |
|-------|------|-------------|
| Residents | 2-px living dots, cult-colored; walk Manhattan day-cycles to work/worship | 🧩 walk-cycle sprite (per §30 animation pass, B5.3) |
| Property stakes | dotted boundary cord in owner color along bought-parcel edges | — |
| Backyards | sheds, above-ground pools, vegetable rows, back fences, flowers (block interiors) | 🧩 laundry lines |
| Street furniture | regular street trees, fire hydrants, mailboxes on frontages | — |
| Chimney smoke | animated wisp on a third of homes (pure tick hash) | — |
| Crop variety | per-parcel corn/soy/wheat/fallow palettes + hay bales | — |
| Lake dressing | shore reeds, rocks breaking water | — |
| Tithe Courier | 6×6 walker with money satchel, glides along route | 🧩 frame animation |
| Recruitment Van | 6×6 minibus with glass + wheels | 🧩 wheel spin frames |
| Agent (own-side only) | hooded figure | — |
| Street Prophet pylon | speaker post, radiating | — |
| CPA picket | protester with sign | — |
| Auras (Festival/Retreat) | dotted glow ring + interior twinkle (gold/green) | 🧩 shimmer shader |

## Naming (not pixels, but part of the map's identity)

Corpora generated by **Python faker** (`tools/gen_names.py` →
`packages/sim/src/nameData.ts`, checked in; regenerate any time). Per seed:
fresh **town name**, **named street segments** (Main Street, avenues, streets,
highways, section roads — `World.streets`, in the snapshot and StateHash), and
pure-hash **household/member names** (`names.ts`) surfaced by the client's
hover chip and available for recap/drama flavor.
