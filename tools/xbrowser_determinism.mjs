/**
 * B6.5 — cross-browser determinism gate (HANDOFF §8.5, risk #1 in §10).
 *
 * Runs tools/xbrowser/probe.mjs in Node, then bundles it (vite, iife) and
 * runs the identical code in headless Chromium and Firefox. Every engine
 * must produce byte-identical StateHash sequences for every case — worldgen
 * (incl. the oceanside Math.sin coastline) and 400 ticks of sim stepping.
 * Any divergence is a lockstep desync waiting to happen: exit 1.
 *
 * Usage: node tools/xbrowser_determinism.mjs [--browsers=chromium,firefox]
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium, firefox, webkit } from "playwright";
import { runProbe } from "./xbrowser/probe.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const balanceRaw = JSON.parse(readFileSync(new URL("../balance.json", import.meta.url), "utf8"));
const wanted = (process.argv.find((a) => a.startsWith("--browsers="))?.split("=")[1] ?? "chromium,firefox,webkit")
  .split(",")
  .filter(Boolean);

// ---- 1. Node reference ------------------------------------------------------
const reference = runProbe(balanceRaw);
console.log(`node reference: ${Object.keys(reference).length} cases × ${reference[Object.keys(reference)[0]].length} hashes`);

// ---- 2. Bundle the probe for the browser ------------------------------------
await build({
  configFile: false,
  logLevel: "error",
  build: {
    lib: {
      entry: `${here}xbrowser/probe.mjs`,
      name: "FlockProbe",
      formats: ["iife"],
      fileName: () => "probe.iife.js",
    },
    outDir: `${here}xbrowser/dist`,
    emptyOutDir: true,
    minify: false,
    target: "es2022",
  },
});

// ---- 3. Run in each browser, compare ----------------------------------------
const engines = { chromium, firefox, webkit };
let failed = false;
for (const name of wanted) {
  const engine = engines[name];
  if (!engine) {
    console.error(`unknown browser "${name}"`);
    failed = true;
    continue;
  }
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ path: `${here}xbrowser/dist/probe.iife.js` });
    const result = await page.evaluate((b) => globalThis.FlockProbe.runProbe(b), balanceRaw);
    for (const [label, hashes] of Object.entries(reference)) {
      const got = result[label] ?? [];
      const ok = got.length === hashes.length && got.every((h, i) => h === hashes[i]);
      console.log(`  ${name} · ${label}: ${ok ? "MATCH" : "*** DIVERGED ***"}`);
      if (!ok) {
        failed = true;
        const at = hashes.findIndex((h, i) => got[i] !== h);
        console.error(`    first divergence at checkpoint ${at}: node=${hashes[at]} ${name}=${got[at]}`);
      }
    }
  } finally {
    await browser.close();
  }
}

if (failed) {
  console.error("\nCROSS-BROWSER DETERMINISM GATE: FAIL");
  process.exit(1);
}
console.log("\nCROSS-BROWSER DETERMINISM GATE: PASS");
