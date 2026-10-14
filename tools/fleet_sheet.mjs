/**
 * Fleet sheet (Harness A for vehicles): every 1980s vehicle kind × facing
 * (E, W, S, N) on #181512 slate at 8× with 1px tile guides, plus the
 * animated states (cruiser bubble light red/blue, bus hazards on/off).
 * Usage: node tools/fleet_sheet.mjs [zoom=8] [out=scratch/studio/fleet.png]
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";
import { drawVehicle, VEHICLE_KINDS, vehicleSize, CAR_PAINT } from "../packages/sim/dist/index.js";
import { encodePNG } from "./lib/png.mjs";

const [zA = "8", OUT = "scratch/studio/fleet.png"] = process.argv.slice(2);
const Z = +zA, CELL = 8, SLATE = process.env.SLATE ? [0x18, 0x15, 0x12] : [0x6f, 0x6b, 0x66], GUIDE = process.env.SLATE ? [0x26, 0x22, 0x1e] : [0x66, 0x62, 0x5d]; // asphalt by default so black tyres read (SLATE=1 for the studio slate)
mkdirSync(dirname(OUT), { recursive: true });

/** one 8×8 logical cell holding the vehicle centred, rendered at Z× */
function cell(kind, dir, paint, tick, hazards, bloom = false) {
  const W = CELL * Z, rgba = Buffer.alloc(W * W * 4);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const c = x % Z === 0 && y % Z === 0 ? GUIDE : SLATE;
    const o = (y * W + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
  }
  const { w, h } = vehicleSize(kind, dir);
  const ox = (CELL - w) >> 1, oy = (CELL - h) >> 1;
  drawVehicle((x, y, rgb) => {
    for (let sy = 0; sy < Z; sy++) for (let sx = 0; sx < Z; sx++) {
      const o = (((y + oy) * Z + sy) * W + (x + ox) * Z + sx) * 4;
      rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2];
    }
  }, kind, 0, 0, dir, paint, tick, hazards, bloom);
  return encodePNG(W, W, rgba).toString("base64");
}

const DIRS = ["E", "W", "S", "N"];
const rows = VEHICLE_KINDS.map((kind, i) => {
  const paint = kind === "bmx" ? [200, 60, 50] : kind === "bus" ? [232, 176, 32] : kind === "cruiser" ? [30, 29, 28] : CAR_PAINT[(i * 3) % CAR_PAINT.length];
  // cruiser: day flash frames, then the night BLOOM frames (halo round the bar)
  const frames = kind === "cruiser" ? [[0, false], [4, false], [0, false, true], [4, false, true]] : kind === "bus" ? [[0, true], [8, true]] : [[-1, false]];
  const cells = [];
  for (const [tick, hz, bl] of frames) for (let d = 0; d < 4; d++) {
    cells.push(`<figure><img src="data:image/png;base64,${cell(kind, d, paint, tick, hz, bl)}"><figcaption>${DIRS[d]}${tick >= 0 ? ` t${tick}` : ""}${bl ? " night" : ""}</figcaption></figure>`);
  }
  return `<div class="row"><b>${kind}</b>${cells.join("")}</div>`;
}).join("");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
await page.setContent(`<style>body{margin:0;background:#0d0b09;color:#ddd;font:12px monospace;padding:8px}
  .row{display:flex;gap:6px;align-items:center;margin-bottom:4px}b{width:70px}figure{margin:0;text-align:center}
  img{image-rendering:pixelated;display:block}</style>${rows}`);
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();
console.log(OUT);
