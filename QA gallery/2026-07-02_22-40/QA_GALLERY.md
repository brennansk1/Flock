# Standards Pass Showcase (2026-07-02 22:40)

The full STANDARDS_MAPGEN.md sprint pass (Sprints 1–6): drainage-connector
rewrite, §8A downtown building segmentation, street-facing house orientation,
worked countryside, the new missing-asset batch, the **§2A town archetypes**,
and the **single-LOD switch** (zoom now magnifies the same 8px pixels — no
detail channel). Tests 77/77 green. Full report: [QA_MAPGEN.md](../../QA_MAPGEN.md).

---

## 1. Farm towns — full-map sweep (seeds 11/21/42/77/99)

````carousel
### Seed 11 — meandering outlet channel, fuller farm belt
![Seed 11](map-seed-11.png)
<!-- slide -->
### Seed 21 — clean east river system
![Seed 21](map-seed-21.png)
<!-- slide -->
### Seed 42 — desert dry washes, graded autumn edge
![Seed 42](map-seed-42.png)
<!-- slide -->
### Seed 77 — worked quilt on every quadrant
![Seed 77](map-seed-77.png)
<!-- slide -->
### Seed 99 — lake-fed river, autumn patch
![Seed 99](map-seed-99.png)
````

## 2. Biome variants (seed 11)

````carousel
### Pure temperate (`biomes: []`)
![No biomes](map-seed-11-no-biomes.png)
<!-- slide -->
### Desert only (`biomes: ["desert"]`)
![Desert only](map-seed-11-desert-only.png)
````

## 3. Town archetypes (§2A — `MapOpts.townType`)

````carousel
### Oceanside, seed 11 — sea, beach, estuary, pier, lighthouse, cannery
![Oceanside 11](oceanside-11.png)
<!-- slide -->
### Oceanside, seed 42
![Oceanside 42](oceanside-42.png)
<!-- slide -->
### Desert, seed 11 — oasis town in a dominant desert, adobe homes
![Desert 11](desert-11.png)
<!-- slide -->
### Desert, seed 42
![Desert 42](desert-42.png)
<!-- slide -->
### Mountain, seed 11 — conifer-walled valley, sawmill on the rail
![Mountain 11](mountain-11.png)
<!-- slide -->
### Mountain, seed 42
![Mountain 42](mountain-42.png)
<!-- slide -->
### Lakeside, seed 11 — the lake at the town's edge, shore cabins + docks
![Lakeside 11](lakeside-11.png)
<!-- slide -->
### Lakeside, seed 42
![Lakeside 42](lakeside-42.png)
````

## 4. Crops — §8A block refinement & countryside (seed 11)

````carousel
### Downtown core — segmented attached buildings, storefront strips
![Downtown](crop-seed-11-downtown-core.png)
<!-- slide -->
### Residential block — street-facing gables, garages, backyards
![Residential](crop-seed-11-residential-block.png)
<!-- slide -->
### Rail siding — boxcars, spur, industrial edge
![Rail siding](crop-seed-11-rail-siding.png)
<!-- slide -->
### Farmstead — worn pastures, tractors, shelterbelts
![Farmstead](crop-seed-11-farmstead.png)
<!-- slide -->
### River reach + bridge
![River](crop-seed-11-river-reach-bridge.png)
<!-- slide -->
### Lake shore
![Lake shore](crop-seed-11-lake-shore.png)
<!-- slide -->
### Desert ecotone — dry wash, oasis margins
![Desert ecotone](crop-seed-11-desert-ecotone.png)
<!-- slide -->
### Forest edge — graded ecotone
![Forest edge](crop-seed-11-forest-edge.png)
<!-- slide -->
### Main St strip
![Main St](crop-seed-11-main-st-strip.png)
<!-- slide -->
### Industrial lobe
![Industrial](crop-seed-11-industrial-lobe.png)
````

## 5. Town edges — fringe gradient (seed 11)

````carousel
### North edge
![North](crop-seed-11-town-edge-n.png)
<!-- slide -->
### South edge — trailer court + junk fringe
![South](crop-seed-11-town-edge-s.png)
<!-- slide -->
### East edge
![East](crop-seed-11-town-edge-e.png)
<!-- slide -->
### West edge
![West](crop-seed-11-town-edge-w.png)
````

## 6. Seasons & time of day (seed 11, unchanged systems re-verified)

````carousel
### Spring day
![Spring](map-seed-11-spring-day.png)
<!-- slide -->
### Summer day
![Summer](map-seed-11-summer-day.png)
<!-- slide -->
### Fall day
![Fall](map-seed-11-fall-day.png)
<!-- slide -->
### Winter day
![Winter](map-seed-11-winter-day.png)
<!-- slide -->
### Summer dawn
![Dawn](map-seed-11-summer-dawn.png)
<!-- slide -->
### Summer dusk
![Dusk](map-seed-11-summer-dusk.png)
<!-- slide -->
### Summer night
![Night](map-seed-11-summer-night.png)
````

## 7. Downtown seasonal crops

````carousel
### Spring
![Spring DT](crop-seed-11-downtown-spring-day.png)
<!-- slide -->
### Summer
![Summer DT](crop-seed-11-downtown-summer-day.png)
<!-- slide -->
### Fall
![Fall DT](crop-seed-11-downtown-fall-day.png)
<!-- slide -->
### Winter
![Winter DT](crop-seed-11-downtown-winter-day.png)
<!-- slide -->
### Summer night
![Summer night DT](crop-seed-11-downtown-summer-night.png)
<!-- slide -->
### Winter night
![Winter night DT](crop-seed-11-downtown-winter-night.png)
````
