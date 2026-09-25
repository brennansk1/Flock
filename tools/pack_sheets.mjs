/**
 * Contact sheets of the approval pack (tools/approval_pack.mjs) for review:
 * one PNG per ~8 items, every image of each item, labelled.
 * Usage: node tools/pack_sheets.mjs [packDir=scratch/review2] [perSheet=8]
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const DIR = process.argv[2] ?? "scratch/review2", PER = +(process.argv[3] ?? 8);
const { items } = JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8"));
const uri = (f) => "data:image/png;base64," + readFileSync(`${DIR}/${f}`).toString("base64");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1500, height: 300 } });
for (let i = 0; i < items.length; i += PER) {
  const html = `<style>body{margin:0;background:#0f0d0b;color:#eee;font:13px monospace;padding:6px}
  .it{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;border-bottom:1px solid #333;padding:4px 0}
  b{width:150px;color:#fc6}figure{margin:0}img{image-rendering:pixelated;max-height:190px;display:block}figcaption{font-size:10px;color:#999}</style>` +
    items.slice(i, i + PER).map((it, k) => `<div class="it"><b>${i + k + 1}. ${it.name}</b>${it.images.map((m) => `<figure><img src="${uri(m.file)}"><figcaption>${m.label}</figcaption></figure>`).join("")}</div>`).join("");
  await page.setContent(html);
  const out = `${DIR}/sheet_${String(i / PER + 1).padStart(2, "0")}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log(out);
}
await browser.close();
