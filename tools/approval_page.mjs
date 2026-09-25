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
const tpl = readFileSync(new URL("./approval_template.html", import.meta.url), "utf8");
writeFileSync(`${OUT}/index.html`, tpl.replace("/*__ITEMS__*/[]", JSON.stringify(items)));
console.log(`${OUT}/index.html · ${items.length} items`);
