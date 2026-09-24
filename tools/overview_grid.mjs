/**
 * Worldgen QA grid: every town type × benchmark seeds as one labelled image.
 * Usage: node tools/overview_grid.mjs [seeds=11,42,77] [season=summer] [time=day] [out=scratch/audit/overview.png]
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { loadBalance, createSim, generateWorld, renderTown } from "../packages/sim/dist/index.js";
import { encodePNG } from "./lib/png.mjs";

const seeds = (process.argv[2] ?? "11,42,77").split(",").map(Number);
const [season = "summer", time = "day", out = "scratch/audit/overview.png"] = process.argv.slice(3);
const TOWNS = ["farm", "lakeside", "desert", "mountain", "oceanside"];
const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));
const cells = [];
for (const seed of seeds) for (const town of TOWNS) {
  const world = generateWorld(seed, 96, 96, { townType: town });
  const sim = createSim({ seed, balance, world, spawns: [], timerTicks: 0, dominationPermille: 1000 });
  const f = renderTown(sim, { frameTick: 0, lod: 1, season, timeOfDay: time });
  const png = encodePNG(f.width, f.height, Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength));
  cells.push(`<figure><img src="data:image/png;base64,${png.toString("base64")}"><figcaption>${town} · seed ${seed}</figcaption></figure>`);
}
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1940, height: 400 } });
await page.setContent(`<style>body{margin:0;background:#181512;color:#eee;font:14px monospace;display:grid;grid-template-columns:repeat(5,384px);gap:4px;padding:4px}figure{margin:0}img{width:384px;height:384px}</style>${cells.join("")}`);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
