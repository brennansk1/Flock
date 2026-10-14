# Stage 2b — Revision round from the approval docket

Source: the user's per-item verdicts in the Stage 2 approval docket (88 recorded: 43 approved, 43 needs work, 1 rejected). Every "needs work", "rejected" and every approved-with-note item is listed below with the decided fix. **Owner**: MG = map generation (lead), R = renderer (subagent).

## Map generation (MG)

| Item | User note | Decided fix |
|---|---|---|
| **Agriculture (rejected)** + Farm type + Farms + overview | Agriculture should be placed the way it really surrounds a 1980s town, with more circle types, farm buildings placed around fields, and roads to them | Rebuild the farm belt:<br>• mile-line **section roads** (county gravel grid) outside town;<br>• **farmsteads front those roads**: house, barn, silo, machine shed and a windbreak, with fields laid out behind them;<br>• **dirt farm lanes** out to each field block;<br>• center-pivot circles on some farm maps (Plains irrigation, common by 1984), not only desert;<br>• on some maps a **fringe ring** (acreages, pasture, woodlot) spaces farmland away from town. |
| Pasture (terr-9) | Give them a barn to go into; make sure it doesn't overlap | Every pasture adjoins a barn (it's the farmstead's pasture); pastures never overlap other parcels. |
| Orchard (terr-8) | Don't overlap or come too close; needs paths | Orchards are whole blocks with a 1-tile margin and a lane to a road. |
| Dirt lanes (terr-6) | Connect more of the agriculture | Farm lanes to every field block (see above). |
| Lakeside | More beaches, a missing bridge (or two), farmland too close | Sand beaches on the town shore; roads the lake cut are rejoined by bridges or causeways; farmland set back ≥3 tiles from the lake. |
| Mountain | Smoother woods→rock transition; some mountain looks flat; less farming, more sawmills | Wider graded forest skirt and ragged rock edge (MG); relief shading (R). Farm belt thinned; 2–3 sawmills with log decks on the rail and at woods edges. |
| Oceanside | Needs a boardwalk and piers, less farming — this is a fishing town | Continuous boardwalk along the town shore, 2–3 fishing piers and a marina. Cannery on its own pier. Farm belt thinned to a few truck farms. |
| Cannery | Should be by the ocean, on the pier | Placed at the shore at the root of a working pier. |
| Lighthouse | Out into the ocean on a man-made line, several tiles long, glowing and animated at night — like a Cape Cod lighthouse | A stone **jetty** (Lot.Jetty) 4–7 tiles out into the sea, with the lighthouse (1×2, tall) at its end. Beam animation (R). |
| Desert | A few more mountains, more sand-colour variety | More and larger mesas plus a buttes range (MG); sand tone variety (R). |
| Residential blocks | Some have a hole in the middle; fill it with a realistic block layout | Deep blocks get a mid-block **alley**. Interior lots become backyards/garages off the alley, never empty. |
| Trailers | Should be laid out as a trailer park | A proper trailer park: one entrance, a loop lane, trailers on both sides, office and a sign. |
| Park | Placement isn't where it should be | Parks go where towns put them: the square, one neighbourhood park per quarter on a whole or corner lot facing streets, and a park by the school. Never an interior scrap. |
| Cemetery | Clearer headstones, bigger, outside town | 4×3 at the edge of town on a road, gated (R: clearer headstones). |
| Dam | A proper man-made dam with roads and buildings leading to it | Concrete dam across the river with a crest road connecting both banks, a powerhouse (Lot.Powerhouse) and an access road. |
| Dock | A big dock and a small one | Two sizes: a small single pier, and a big marina (2-wide pier with slips) on lake and ocean shores. |
| High school | Needs a parking lot | A student lot (≥2×2) beside the school, plus the bus lot. |
| Ball field / playground / warehouse (approved, with notes) | Beside a school; right next to it; has parking | Linted: ball field and playground each adjoin a school lot; warehouses get a lot. |
| Radio tower | Taller and cleaner; the lane to it cuts across a lot | 3×4 (tall mast). The access lane is routed around the compound, never through it. |
| Substation | Look like a substation, connected to the power lines | Placed on a pole line; transmission line drawn into it (R). |
| Megachurch | Bigger, a huge parking lot, looks like the Missouri Church of Christ megachurch | 6×4 campus plus a huge lot beside it (MG). Architecture (R). |
| Bank / Chapel / Sheriff | Bigger | Bank 3×2 · Chapel 2×2 · Sheriff 3×2 with cruiser lot. |
| Silo / Water tower / Radio tower | Taller | Silo 1×2 · Water tower 2×3 · Radio tower 3×4, each drawn rising over the back of its lot. |
| Fairground | Only front and back, not the side | Faces a street on its N or S side only. |

## Renderer (R)

| Item | Decided fix |
|---|---|
| All cars, bus, cruiser | Two black wheels visible on the near side when driving E/W; none visible N/S. Pickup reads as a truck: cab plus open bed. |
| Church | Correct drawings from every side (front, back, side: steeple, nave and entry per frontage). |
| Cinema | At night the marquee and blade sign blaze: chaser lights, lit poster cases. Clearly open for the late show. |
| Post office | USPS blue: blue trim and sign, eagle, flag. |
| Supermarket | Green sign band (1980s grocery), cart corral. |
| Bank | Old-time neoclassical: granite columns, pediment, bronze doors, clock. |
| Chapel | A real chapel: white clapboard, steep roof, steeple, arched windows. |
| Megachurch | Modelled on a 1980s Missouri megachurch: a huge fan/dome auditorium, a glass atrium entry, a tall spire and a huge striped lot. |
| Sheriff | Bigger station with 2–3 black-and-white cruisers in the lot, bubble lights flashing. |
| Silo / Water tower / Radio tower / Lighthouse | Tall 3/4-view drawings rising over the back of the lot:<br>• classic bowl-and-legs water tower with a ladder;<br>• tall stave silo with a dome;<br>• tall red/white mast;<br>• Cape Cod lighthouse with a black lantern and sweeping night beam. |
| Substation | Transformers, bus bars, a steel lattice gantry, a fence and warning sign. The pole line runs into it. |
| Cemetery | Clearer headstones (rows of 1-px white stones with shadows), gravel drives, cedars, gate. |
| Jetty / Powerhouse / Dam / docks | Stone jetty, brick powerhouse, a concrete dam with a spillway and crest road, and marina slips. |
| Woods (terr-1) | A better canopy texture per season: summer greens, autumn reds and golds, winter bare branches with snow, spring blossom. |
| Rock (terr-11) | Smoother, spreading edges (scree fringe, dither into grass). Slope-shaded relief so no area reads flat. |
| Desert | More sand-tone variety (dunes, caliche, red soil). |
| Rail (terr-10) | An animated freight train running the line on a schedule. |
| Parking | Parked cars come and go by time of day (deterministic from frameTick), not static. |
| Seasons | Night in every season. Smooth season transitions: a `seasonBlend` option cross-fades palettes. |

## Lead review round (before republishing the docket)

Every revised item was re-checked in the studio and in situ. Anything short of the notes was fixed, and a presence lint now guards it.

| Found | Fix |
|---|---|
| Chapel missing on 9/15 benchmark towns; playground or ball field missing on 4 (late trimming passes erased them) | `ensureSchoolGrounds` runs last. The audit now requires a chapel, cemetery, substation, school playground and ball field on full-size maps. |
| Substation mid-town, its pole line over rooftops | `placeSubstation`: open ground at the town edge beside a road, nearest the works. |
| No center pivots on some farm maps (placed after farmsteads had filled the land) | Pivots are laid first, from their own RNG stream, by a full site scan: 2–3 on farm maps. Drawn as an r²+r disc (round, no nubs). |
| Trailers scattered through ordinary blocks; the planned park failed on ~half the maps | The park search covers all four gate orientations. `TileFlag.TrailerPark` is a render hint: trailers draw only in the park, and other fringe lots are cottages. Districts are unchanged. |
| 30% of desert homes were Midwestern ranches | Every desert home is Southwestern: adobe, pueblo or mission, in six stucco tones. |
| A second cannery inland by the rail on oceanside maps | The oceanside grain elevator becomes a cold-storage warehouse; the only cannery is on its pier. |
| Water tower legs stood in streaky lawn | The yard under the tank is fenced gravel. |
| A hemmed-in church could lose its lot | A stand-alone neighbouring storefront becomes the lot next door. |
