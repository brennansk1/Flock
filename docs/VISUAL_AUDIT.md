# FLOCK — Curated Visual Suite & Aesthetic Audit

This document is the visual review ledger for **Claude Opus 5.5**, containing a strictly curated set of benchmark renders showcasing FLOCK's top-down 8px procedural visual grammar, town archetypes, seasonal systems, diurnal lighting, and architectural details.

---

## 1. Five Town Archetypes (LOD 1 Overviews)

Every town archetype generates distinct geography, road density, and vegetation profiles:

| Archetype | Preview File | Strategic Geographic Features |
|---|---|---|
| **Farm Town** | [archetype_farm_seed11.png](assets/curated/archetype_farm_seed11.png) | Vast agricultural parcels, grain elevators, silos, and 2px dirt tractor tracks. |
| **Lakeside Town** | [archetype_lakeside_seed21.png](assets/curated/archetype_lakeside_seed21.png) | Inland lake basin, boat slips, gravel shores, and riparian willow forests. |
| **Desert Town** | [archetype_desert_seed42.png](assets/curated/archetype_desert_seed42.png) | Arid sands, sandstone cliffs, sparse saguaro stands, and dry gulches. |
| **Mountain Town** | [archetype_mountain_seed77.png](assets/curated/archetype_mountain_seed77.png) | High granite elevations, alpine pine forests, and winding hillside roads. |
| **Oceanside Town** | [archetype_oceanside_seed99.png](assets/curated/archetype_oceanside_seed99.png) | Coastline water boundary, beach dunes, lighthouse promontory, and coastal highway. |

---

## 2. The Four Seasons (Seed 11 Showcase)

FLOCK features dynamic seasonal reskinning driven by pure palette shifts and sprite geometry:

* **Spring Day** ([season_spring_day.png](assets/curated/season_spring_day.png)):
  * Fresh light-green meadows (`#6da344`).
  * Cherry blossom pink overlays on deciduous canopies (`#ffd0e8`).
  * Tilled brown fields dotted with vibrant green seedlings (`#82cf3c`).
* **Summer Day** ([season_summer_day.png](assets/curated/season_summer_day.png)):
  * Standard balanced green meadows (`#829c5e`) and deep emerald lawns.
  * Tall golden wheat and dark green corn rows.
  * Full summer foliage and sharp directional drop shadows.
* **Fall Day** ([season_fall_day.png](assets/curated/season_fall_day.png)):
  * Golden rust terrain floor (`#a49e60`).
  * Deciduous woods blaze in scarlet red, vibrant orange, and gold.
  * Harvested tan stubble fields dotted with rolled straw hay bales.
* **Winter Day** ([season_winter_day.png](assets/curated/season_winter_day.png)):
  * Clean white snow blanket (`#ffffff` / `#eef4f8`).
  * Deciduous trees shed foliage, leaving bare branch silhouettes holding snow caps.
  * Roofs carry white snow drifts; rivers and lakes freeze into ice-blue sheets (`#aed5e8`).

---

## 3. Diurnal Lighting Cycle (Summer Benchmark)

The environmental lighting filter applies smooth, cinematic diurnal shifts:

* **Dawn** ([lighting_dawn.png](assets/curated/lighting_dawn.png)): Warm rose-peach atmospheric tint with soft morning contrast.
* **Day** ([lighting_day.png](assets/curated/lighting_day.png)): Neutral daylight balance; maximum gameplay readability.
* **Dusk** ([lighting_dusk.png](assets/curated/lighting_dusk.png)): Deep golden-purple twilight cast with elongated evening shadows.
* **Night** ([lighting_night.png](assets/curated/lighting_night.png)): Cool moonlit blue shade ($0.45\times$ base brightness).
  * **Luminous Glow Bypass**: Streetlights, vehicle headlights, and interior building windows (`C.windowLit`) bypass night filtration to glow brightly against the darkness.

---

## 4. Keystone Micro-Detail Crops (LOD 3)

Detailed $28\times 20$ tile inspection views illustrating FLOCK's procedural craftsmanship:

* **Downtown Core** ([detail_downtown_core.png](assets/curated/detail_downtown_core.png)):
  * Continuous storefront facades with 1px shaded panel seams preventing merging.
  * Concrete sidewalks, crosswalks, parked vehicles, and asphalt street dashes.
* **Train Station Depot** ([detail_train_depot.png](assets/curated/detail_train_depot.png)):
  * Brick depot facade with corner stone quoins and gabled clock dormer.
  * Weathered timber passenger platform, luggage carts, baggage crates, and waiting benches.
  * Rail siding switch connecting to the industrial track spur.
* **Agricultural Fields & Tractor Paths** ([detail_agriculture_tracks.png](assets/curated/detail_agriculture_tracks.png)):
  * 2-pixel wide dark dirt agricultural tracks (`#483726`) bordering $6\times 6$ parcels.
  * Farmhouse, red barn with white $X$ doors, grain silo, and pasture fencing.
* **Winter Night Window Glow** ([detail_winter_night_glow.png](assets/curated/detail_winter_night_glow.png)):
  * Snow-covered rooftops and streetlamps casting golden illumination across snowy sidewalks.
