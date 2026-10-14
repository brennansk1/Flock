/**
 * Asset-audit contact sheets: tiles the catalog inspector's per-asset
 * Studio (slate) + In-Situ (map) PNGs into labelled pages so all 121 assets
 * can be reviewed in a handful of images.
 * Usage: node tools/generate_catalog_inspection.mjs && node tools/contact_sheet.mjs [perPage=12] [outDir=scratch/audit]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { MASTER_ASSET_CATALOG } from "../packages/sim/dist/index.js";

const PER = Number(process.argv[2] ?? 12);
const OUT = process.argv[3] ?? "scratch/audit";
mkdirSync(OUT, { recursive: true });
const DIR = "reports/assets/catalog";
const uri = (f) => "data:image/png;base64," + readFileSync(`${DIR}/${f}`).toString("base64");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
for (let i = 0; i < MASTER_ASSET_CATALOG.length; i += PER) {
  const cells = MASTER_ASSET_CATALOG.slice(i, i + PER).map((a) =>
    `<figure><div><img src="${uri(a.id + "_studio.png")}"><img src="${uri(a.id + "_map.png")}"></div><figcaption>${a.id} ${a.name}</figcaption></figure>`).join("");
  await page.setContent(`<style>body{margin:0;background:#222;color:#eee;font:12px monospace;display:grid;grid-template-columns:repeat(4,290px);gap:6px;padding:6px}
    figure{margin:0}img{width:140px;height:140px;image-rendering:pixelated;margin-right:4px}</style>${cells}`);
  const n = String(i / PER + 1).padStart(2, "0");
  await page.screenshot({ path: `${OUT}/contact_${n}.png`, fullPage: true });
  console.log(`${OUT}/contact_${n}.png`);
}
await browser.close();
