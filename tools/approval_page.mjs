/**
 * Builds the Stage-2 approval docket page from scratch/review2/manifest.json
 * (tools/approval_pack.mjs). Images are published alongside as img/*.png.
 * Usage: node tools/approval_page.mjs <outDir>
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
const OUT = process.argv[2];
const PACK = "scratch/review2";
const { items } = JSON.parse(readFileSync(`${PACK}/manifest.json`, "utf8"));
mkdirSync(`${OUT}/img`, { recursive: true });
for (const it of items) for (const im of it.images) cpSync(`${PACK}/${im.file}`, `${OUT}/${im.file}`);
// Before → after pairs (Phase 1 audit renders vs. the finished Stage 2)
const PAIRS = [
  ["ba-overview", "Every town type · seeds 11 / 42 / 77", "docs/assets/audit/overview.png", "docs/assets/stage2_after/overview.png", "Before: one centred grid for every town type (the old tool even rendered every type as the farm town). After: farm, lakeside, desert, mountain valley and coastal towns each with their own shape."],
  ["ba-downtown", "Downtown & Courthouse Square", "docs/assets/audit/crop_downtown.png", "docs/assets/stage2_after/crop_downtown.png", "Before: a 1-tile town-hall badge in an ordinary block, gappy storefronts. After: the courthouse square, continuous Main St storefronts with rear lots and diagonal parking."],
  ["ba-school", "High school", "docs/assets/audit/crop_highschool.png", "docs/assets/stage2_after/crop_highschool.png", "Before: a 2×2 brick box inside a housing block. After: an edge-of-town campus — 4×2 school, bus lot, fenced stadium."],
  ["ba-winterdusk", "Winter dusk grading", "docs/assets/audit/ov_winter_dusk.png", "docs/assets/stage2_after/ov_winter_dusk.png", "Before: the whole map rendered hot pink. After: warm dusk light on snow."],
];
const pairs = [];
for (const [id, name, before, after, text] of PAIRS) {
  const b = `img/${id}_before.png`, a = `img/${id}_after.png`;
  cpSync(before, `${OUT}/${b}`); cpSync(after, `${OUT}/${a}`);
  pairs.push({ group: "Before → After", id, name, footprint: "", scale: "", placement: text, images: [{ label: "Before (Phase 1 audit)", file: b }, { label: "After (Stage 2)", file: a }] });
}
items.unshift(...pairs);
const tpl = readFileSync(new URL("./approval_template.html", import.meta.url), "utf8");
writeFileSync(`${OUT}/index.html`, tpl.replace("/*__ITEMS__*/[]", JSON.stringify(items)));
console.log(`${OUT}/index.html · ${items.length} items`);
