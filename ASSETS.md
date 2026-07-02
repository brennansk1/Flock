# FLOCK — Asset & LOD Ledger

_Every rendered asset in the game, where it's drawn, what it looks like at each
level of detail, and which high-detail variants are deferred. All assets are
**procedural** — drawn pixel-by-pixel in [`packages/sim/src/townRender.ts`](./packages/sim/src/townRender.ts)
(shared bit-identically by the PixiJS client and every headless renderer).
Companion docs: [DESIGN.md](./DESIGN.md) §30 (art direction), [BUILD_MANIFEST.md](./BUILD_MANIFEST.md) (build status)._

## How LOD works

The map is a tile grid at **8 px/tile (LOD 1)**. The client's camera
(`packages/client/src/render.ts`) picks LOD from zoom: at fit-to-screen the
whole map renders at LOD 1; zooming in renders only the visible window at
LOD 2–4, where each logical pixel becomes an S×S block and a **detail
channel** (`Detail.putF`) draws sub-pixel features that only exist up close
(shingle courses, window mullions, ragged tree edges). So:

| LOD | Meaning | Detail budget |
|-----|---------|---------------|
| 1 | overview, 8 px/tile | silhouette + 2–4 colors; must read at a glance |
| 2 | 16 px/tile | + material texture (via detail channel) |
| 3–4 | 24–32 px/tile | + fine features (mullions, courses, glints) |

**Status legend:** ✔️ live procedural · 🧩 HIGH-DETAIL DEFERRED — the LOD 1–2
form ships now; a dedicated hand-detailed / generated variant at LOD 3–4 is
flagged for a later art pass (tracked as B5.3.1 in the Build Manifest).

## Terrain tiles (`drawTile`)

| Asset | LOD 1 (8 px) | LOD 2–4 detail today | High-detail deferred |
|-------|--------------|----------------------|----------------------|
| Grass / open country | two-octave rolling meadow (light/shadow), scrub flecks, flowers | noise scales with resolution | 🧩 wind-swept grass animation |
| Rock outcrops | 3-px cluster on high ground | — | 🧩 lichen texture |
| Brush pockets | clustered bush pixels + cast shadow | — | — |
| Lone country trees | 2×2 canopy + shadow | — | 🧩 species variety |
| Utility poles | pole + crossarm marching every 3 tiles along rural roads | — | 🧩 sagging wire spans between poles |
| Woods | clumped light/dark canopy, trunk gaps, sunlit N/W fringe | sub-tile edge bleed onto neighbors (`naturalEdgeBleed`) | 🧩 per-tree canopies at LOD 4 |
| Lake / river | deep water, drifting ripple rows, glints, sand shoreline ring | ragged sub-tile shore bleed | 🧩 animated flow direction on the river |
| Crop fields | gold crop with row striping, fence posts on boundaries | — | 🧩 crop growth stages by match clock |
| Dirt lanes | mottled two-tone dirt | — | — |
| Footpath (Terrain.Path) | stone walk (legacy support; mapgen no longer emits them — homes front roads) | — | — |
| Orchard | mown rows with tree lines + shadows | — | 🧩 blossom/fruit seasons |
| Pasture | fenced worn meadow, grazing cattle (white/brown) | — | 🧩 cow walk cycle |
| Biome: desert | sand with dune crests, dry scrub, saguaro stands | — | 🧩 heat shimmer |
| Biome: forest | darker forest-floor grass, denser stands | — | — |
| Asphalt road | worn asphalt, sidewalk skirts where lots front it, gravel shoulders in country | — | 🧩 tire tracks / patch cracks |
| Lane markings | 4-lane highway: yellow center seam + white lane dashes; 2-lane streets: faint center dashes | — | — |
| Traffic | deterministic cars (hash of position × tick) — two directions, denser on the highway; parked cars in lots | — | 🧩 turning traffic at intersections |
| Stop signs | red head + post where a side street tees in | — | — |
| Traffic lights | paired red/green heads at downtown 4-ways | — | 🧩 cycling phases |
| Streetlights | lamp posts with warm heads, downtown/commercial sidewalks | — | 🧩 night mode glow |
| Welcome signs | "town line" boards flanking Main Street's ends | — | 🧩 painted town name at LOD 4 |
| **Highway center line** | dashed yellow line along the 2-lane seam | — | — |
| **Crosswalks** | zebra dashes at downtown intersections | — | — |
| **Bridge** (road over water) | plank deck (seams across travel) + railing posts | — | 🧩 truss silhouette at LOD 3+ |

## Town lots (`drawLotBuilding` + `LOT_STYLE`) — conversion targets with jobs

| Asset | LOD 1 silhouette | Dressing | High-detail deferred |
|-------|------------------|----------|----------------------|
| House (per district) | gabled roof (district palette: terracotta/brick/slate/shake/tin), wall, door, chimney, porch (some) | LOD 2+: shingle courses, window mullions + glint, door knob | 🧩 per-district facade sets |
| **Trailer home** (trailer fringe) | long tin mobile home, hitch tongue, skirting, propane tank | — | 🧩 awning + junk-yard dressing |
| Downtown block | tall footprint, lit/dark window grid | — | 🧩 storefront signage |
| Shop | awning stripe + door | — | 🧩 painted sign glyphs |
| Supermarket | wide box, blue accent, dark glass | — | — |
| Diner | chrome body + red neon strip | — | 🧩 blinking neon at LOD 3 |
| School | brick body, flagpole on corner | — | — |
| Library | stone body | — | — |
| Chapel | white body + steeple | — | — |
| Church | steepled nave (2-tile), gold cross | — | — |
| Gas station | red canopy + yellow pumps | — | — |
| Sheriff | tan body + gold star | — | — |
| Office | gray block, window grid | — | — |
| Bank | columned facade | — | — |
| Post office | flag stripe | — | — |
| Fire station | red body, garage bays | — | — |
| Factory | sawtooth roof + smokestack | — | 🧩 drifting smoke plume |
| Motel | unit doors under a long eave, "vacancy" neon | — | — |
| Barn | red body, white X door | — | — |
| Silo | cylinder + dome cap | — | — |
| **Greenhouse** | glass panes with frame ribs + glint | — | — |
| Park | trees + dirt path | — | — |
| **Playground** | swing frame, slide, sandbox on mown grass | — | — |
| Parking lot | painted bays + parked cars | — | — |
| Cemetery | headstone rows + shadows on mown grass | — | — |
| Ballfield | dirt infield diamond + home plate | — | — |
| **Cinema** | dark facade, lit marquee strip, poster bill | — | 🧩 marquee letter crawl |
| **Dock** | plank walkway reaching into the water + moored rowboat | — | — |

## Landmarks (`LANDMARK_ICON`, gold)

| Asset | LOD 1 icon | High-detail deferred |
|-------|-----------|----------------------|
| Town Hall | columned civic block | — |
| Megachurch | broad nave, cross spire, rose window | 🧩 parking-crowd dressing |
| Radio Tower | tall guyed mast, blinking top | 🧩 signal-pulse animation |
| Fairground | tent + pennants | 🧩 ferris-wheel silhouette |
| Water Tower | tank on legs | — |

## Cult buildings (`ICONS`, tinted by owner color)

| Asset | LOD 1 icon | Growth / states | High-detail deferred |
|-------|-----------|-----------------|----------------------|
| Compound | cross-topped hall | **expansion stages**: fence posts at ≥7% town share, banners at ≥15%; gray while building, red-tinted when disabled | 🧩 stage-3 annex wing footprint |
| Collection Plate | plate + coins | disabled tint | — |
| Watchtower | legged tower | — | — |
| Broadcast Tower | mast + radiating accents | — | 🧩 broadcast ripple |
| Hotline Center | headset motif | — | — |
| Print Shop | press + paper accents | — | — |
| Garage | bay doors | — | — |
| Supplement Lab | flask | — | — |
| Satellite (Visitors) | dish on legs | — | — |
| Wilderness claim | archetype set-dressing where a cult colonizes woods/fields/grass: Dawn bonfires · Radiant domes+flags · Circle billboards · Visitors crop-circles (stage-scaled) | density scales with territory share | 🧩 unique per-archetype LOD 3 props |

## Units & people (`UNIT_SPRITES`, `drawResidents`)

| Asset | Form | High-detail deferred |
|-------|------|----------------------|
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
| Auras (Festival/Retreat) | dotted glow ring + interior twinkle (gold/green) | 🧩 shimmer shader at LOD 3+ |

## Naming (not pixels, but part of the map's identity)

Corpora generated by **Python faker** (`tools/gen_names.py` →
`packages/sim/src/nameData.ts`, checked in; regenerate any time). Per seed:
fresh **town name**, **named street segments** (Main Street, avenues, streets,
highways, section roads — `World.streets`, in the snapshot and StateHash), and
pure-hash **household/member names** (`names.ts`) surfaced by the client's
hover chip and available for recap/drama flavor.
