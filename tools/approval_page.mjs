/**
 * Builds the approval docket page from scratch/review2/manifest.json
 * (tools/approval_pack.mjs). Images are published alongside as img/*.png.
 *
 * Stage 2b (revision round): pass the Stage 2 pack and the saved Stage 2
 * verdicts, and every card shows its previous verdict + note, what changed,
 * and the Stage 2 images beside the new ones.
 * Usage: node tools/approval_page.mjs <outDir> [prevPack=scratch/review2_s2] [verdictDir]
 *   verdictDir holds one <itemId>.json per Stage 2 verdict ({status, note}).
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync } from "node:fs";
const [OUT, PREV = "scratch/review2_s2", VERDICTS] = process.argv.slice(2);
const PACK = "scratch/review2";
const { items } = JSON.parse(readFileSync(`${PACK}/manifest.json`, "utf8"));
mkdirSync(`${OUT}/img`, { recursive: true });
for (const it of items) for (const im of it.images) cpSync(`${PACK}/${im.file}`, `${OUT}/${im.file}`);

// What changed in Stage 2b, per item the user flagged (docs/STAGE2B_FEEDBACK.md)
const WHEELS = "Two black wheels on the near side when driving E/W, none when driving N/S; still inside the vehicle's box.";
const CHANGES = {
  "ba-overview": "The farm belt was rebuilt around the town: a gravel section-road grid, farmsteads fronting it with fields behind, center-pivot circles on farm and lakeside maps, and a fringe ring spacing farms from town on some maps.",
  "ba-school": "A 2×2 student lot beside the high school, as well as the bus lot.",
  "house-1-1": "Every desert home is now Southwestern, in three styles (adobe with vigas, stepped pueblo, stucco mission with a clay-tile roof) and six stucco tones.",
  "house-5-0": "Trailers now live in one planned trailer park: a single gate off a road, a gravel loop lane, trailers on both sides. The park places on every benchmark map. Other fringe lots are modest ranch or Cape cottages.",
  "lot-BallField": "Linted: every ball field adjoins a school or the stadium, and every full-size town has one.",
  "lot-Bank": "3×2, drawn as an old-time neoclassical bank: granite columns, pediment, bronze doors, clock.",
  "lot-Cannery": "Stands at the shore on the root of its own 5-tile working pier. The inland rail cannery is gone (now a cold-storage warehouse).",
  "lot-Cemetery": "4×3 at the edge of town on a road, gated, with rows of clear white headstones, gravel drives and cedars.",
  "lot-Chapel": "2×2 white clapboard chapel with a steep gable, steeple and round-headed windows; every town now has one.",
  "lot-Church": "Drawn correctly from every side: steeple, nave and entry turn with the street.",
  "lot-Cinema": "At night the marquee, chaser bulbs, blade sign and poster cases light up, light spills onto the pavement, and a queue forms at the booth.",
  "lot-Dam": "A concrete dam across the river: crest road bank to bank, spillway, brick powerhouse on the bank with an access road.",
  "lot-Dock": "Two sizes: a small single pier, and a big 2-wide marina with slips and boats, on lake and ocean shores.",
  "lot-Fairground": "Faces its street on the N or S side only (never side-on).",
  "lot-Lighthouse": "Cape Cod lighthouse at the end of a stone jetty 3+ tiles out into the sea; the beam sweeps at night.",
  "lot-Megachurch": "6×4 1980s Missouri-style megachurch (dome auditorium, glass atrium, tall spire) with a huge striped lot that fills on Sunday morning and Wednesday night.",
  "lot-Park": "Neighbourhood parks sit on street corners, one per quarter, never on interior scraps or in front of an institution.",
  "lot-Parking": "Parked cars come and go by time of day (deterministic, per stall).",
  "lot-Playground": "Linted: the elementary school always has its playground right beside it.",
  "lot-PostOffice": "USPS blue trim and sign, flag.",
  "lot-RadioTower": "3×4 with a tall red/white mast and guy wires; the access lane runs around the compound instead of through it.",
  "lot-Sheriff": "3×2 station with a fenced lot of 2–3 black-and-white cruisers, bubble lights flashing.",
  "lot-Silo": "Tall stave silo with a dome, rising over the back of its 1×2 lot.",
  "lot-Substation": "Transformers, bus bars, a steel gantry, fence and sign, with the pole line running into it. Moved to the town edge by a road so the line crosses fields, not rooftops.",
  "lot-Supermarket": "Green 1980s grocery sign band and a cart corral.",
  "lot-Warehouse": "Every warehouse has its own truck lot (linted).",
  "lot-WaterTower": "Classic bowl-and-legs tower rising over its 2×3 lot: X-braced legs, ladder, catwalk, beacon; it stands in a fenced gravel yard.",
  "mg-agriculture": "Rebuilt from scratch: section roads every 22 tiles, 12–16 farmsteads fronting them (house, barns, silo, windbreak, pasture by the barn), 6×5 fields and orchards behind with lanes to every block, 2–3 center pivots on farm maps. Zero farmland in woods (linted).",
  "mg-farms": "On some maps a fringe ring of acreages, pasture and woodlots spaces farmland 8–9 tiles from town.",
  "mg-residential": "Deep residential blocks get a mid-block alley; the lots behind the houses become yards and garages off it, so no block has an empty hole.",
  "mg-seasons": "Night now works in every season, and a seasonBlend option cross-fades between seasons.",
  "mg-type-desert": "4–6 mesas plus a buttes range along the far edge; zoned sand tones (dunes, caliche, red soil).",
  "mg-type-farm": "New farm belt (see Agriculture placement): section roads, farmsteads on them, fields behind, lanes, pivots.",
  "mg-type-lakeside": "Sand beaches on the town shore, bridges where the lake cut a road, farmland set back ≥3 tiles from the water, a marina and a small dock.",
  "mg-type-mountain": "A graded forest skirt and ragged scree edge with slope-shaded relief; farming thinned to the valley floor; 2–3 sawmills.",
  "mg-type-oceanside": "A fishing town: continuous boardwalk and Shore Drive, a marina and fishing piers, the cannery on its pier, a lighthouse jetty; only a few truck farms.",
  "terr-1": "A new seasonal canopy: summer greens, autumn reds and golds, bare snowy winter branches, spring blossom.",
  "terr-10": "A scheduled freight train runs the line and flashes the crossing lights.",
  "terr-11": "Ragged, spreading rock edges with a scree fringe, and slope-shaded relief so no area reads flat.",
  "terr-6": "Farm lanes reach every field block; section roads grid the county.",
  "terr-8": "Orchards are whole parcels with a margin, never overlapping, with a lane to a road (linted).",
  "terr-9": "Every pasture adjoins its farmstead's barn and never overlaps another parcel (linted).",
  "veh-pickup": "Reads as a truck: tailgate, open bed, raised cab, hood. " + WHEELS,
};
for (const k of ["beetle", "blazer", "bus", "camaro", "cruiser", "kcar", "sedan", "van", "wagon"]) CHANGES[`veh-${k}`] = WHEELS;

// Round 1 verdicts + previous images
const R1 = {};
if (VERDICTS && existsSync(VERDICTS))
  for (const f of readdirSync(VERDICTS).filter((f) => f.endsWith(".json"))) {
    const v = JSON.parse(readFileSync(`${VERDICTS}/${f}`, "utf8"));
    R1[f.slice(0, -5)] = { status: v.status || "open", note: v.note || "" };
  }
for (const [id, text] of Object.entries(CHANGES)) R1[id] = { ...(R1[id] || { status: "open", note: "" }), changed: text };
const prev = existsSync(`${PREV}/manifest.json`) ? JSON.parse(readFileSync(`${PREV}/manifest.json`, "utf8")).items : [];
const prevById = Object.fromEntries(prev.map((i) => [i.id, i]));
for (const it of items) {
  const r = R1[it.id];
  if (!r || (r.status === "approved" && !r.note && !r.changed)) continue;
  const p = prevById[it.id];
  if (!p?.images?.length) continue;
  // embedded as data URIs: keeps the published file count under the limit
  it.before = p.images.map((im) => ({ label: im.label, file: "data:image/png;base64," + readFileSync(`${PREV}/${im.file}`).toString("base64") }));
}

// Before → after overview pairs (Stage 2 vs Stage 2b)
const PAIRS = [
  ["ba-overview", "Every town type · seeds 11 / 42 / 77", "docs/assets/stage2_after/overview.png", "docs/assets/stage2b_after/overview.png", "Stage 2 → 2b across all five town types: the county farm belt, waterfronts, ridges and mesas."],
  ["ba-school", "High school", "docs/assets/stage2_after/crop_highschool.png", `${PACK}/${items.find((i) => i.id === "mg-campus")?.images[0]?.file ?? ""}`, "Stage 2 → 2b: the campus now has a student lot beside the school."],
];
const pairs = [];
for (const [id, name, before, after, text] of PAIRS) {
  if (!existsSync(before) || !existsSync(after)) continue;
  const b = `img/${id}_before.png`, a = `img/${id}_after.png`;
  cpSync(before, `${OUT}/${b}`); cpSync(after, `${OUT}/${a}`);
  pairs.push({ group: "Before → After", id, name, footprint: "", scale: "", placement: text, images: [{ label: "Before (Stage 2)", file: b }, { label: "After (Stage 2b)", file: a }] });
}
items.unshift(...pairs);
const tpl = readFileSync(new URL("./approval_template.html", import.meta.url), "utf8");
writeFileSync(`${OUT}/index.html`, tpl.replace("/*__ITEMS__*/[]", JSON.stringify(items)).replace("/*__ROUND1__*/{}", JSON.stringify(R1)));
const nRev = items.filter((i) => R1[i.id] && (R1[i.id].status !== "approved" || R1[i.id].note || R1[i.id].changed)).length;
console.log(`${OUT}/index.html · ${items.length} items · ${nRev} revised`);
