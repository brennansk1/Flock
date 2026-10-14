/**
 * Renderer pass 2 invariants for the plan-kit lots (render/plan.ts): every
 * composed building / compound fills its FULL footprint (main + alt size)
 * in all four frontages, is deterministic, reacts to its frontage, and the
 * landmark compounds replace the old 1-tile icon badge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  loadBalance,
  createSim,
  generateWorld,
  renderTown,
  footprintOf,
  Terrain,
  Lot,
  Landmark,
  Districts,
  type RawBalance,
  type World,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const balance = loadBalance(JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance);

const PLANNED = [
  "Bank", "PostOffice", "Office", "Library", "Chapel", "Cinema", "Diner", "Supermarket", "GasStation",
  "HighSchool", "School", "Playground", "Cemetery", "Substation", "WaterTower", "Barn", "Greenhouse",
  "Lighthouse", "GrainElevator", "Sawmill", "Cannery", "Megachurch", "Fairground", "RadioTower",
] as const;

const N = 12;
function stage(lot: number, fw: number, fh: number, side: "S" | "N" | "E" | "W", on: boolean, landmark = 0): World {
  const w = generateWorld(3, N, N);
  for (let i = 0; i < w.terrain.length; i++) {
    w.terrain[i] = Terrain.Grass; w.lot[i] = 0; w.pop[i] = 0; w.landmark[i] = 0; w.district[i] = 0; w.biome[i] = 0; w.owner[i] = 0;
  }
  w.streets = [];
  const x0 = 3, y0 = 3;
  for (let k = 0; k < N; k++) {
    const [x, y] = side === "S" ? [k, y0 + fh] : side === "N" ? [k, y0 - 1] : side === "E" ? [x0 + fw, k] : [x0 - 1, k];
    w.terrain[y * N + x] = Terrain.Road;
  }
  if (on) {
    for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) {
      const t = (y0 + dy) * N + x0 + dx;
      w.terrain[t] = Terrain.Citizen; w.lot[t] = lot; w.district[t] = Districts.Suburbs; w.pop[t] = 3;
    }
    if (landmark) w.landmark[y0 * N + x0] = landmark;
  } else {
    for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) {
      const t = (y0 + dy) * N + x0 + dx;
      w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Suburbs; w.pop[t] = 0;
    }
  }
  return w;
}
function frame(w: World, fw: number, fh: number, tick = 0) {
  const s = createSim({ seed: 7, balance, world: w, spawns: [], timerTicks: 0, dominationPermille: 1000 });
  return renderTown(s, { frameTick: tick, lod: 1, view: { x: 3, y: 3, w: fw, h: fh }, season: "summer", timeOfDay: "day" });
}
function diffFrac(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let d = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) d++;
  return d / (a.length / 4);
}

test("every plan-kit lot fills its footprint (main + alt) in all four frontages, deterministically", () => {
  for (const name of PLANNED) {
    const lot = Lot[name];
    const fp = footprintOf(lot);
    const sizes: [number, number][] = [[fp.w, fp.h]];
    if (fp.alt) sizes.push([fp.alt.w, fp.alt.h], [fp.alt.h, fp.alt.w]);
    for (const [fw, fh] of sizes) {
      for (const side of ["S", "N", "E", "W"] as const) {
        const bg = frame(stage(lot, fw, fh, side, false), fw, fh).data;
        const a = frame(stage(lot, fw, fh, side, true), fw, fh).data;
        const b = frame(stage(lot, fw, fh, side, true), fw, fh).data;
        assert.deepEqual(a, b, `${name} ${fw}×${fh} ${side}: deterministic`);
        // the composed art covers most of the footprint (ring + open lawn may stay ground)
        const cover = diffFrac(bg, a);
        // the radio mast stands in open land (natural ground): lower floor
        assert.ok(cover > (name === "RadioTower" ? 0.2 : 0.35), `${name} ${fw}×${fh} ${side}: covers only ${(cover * 100).toFixed(0)}% of its footprint`);
      }
    }
  }
});

test("a plan-kit building turns to face its street (S vs N frontage differ)", () => {
  for (const name of ["Bank", "Cinema", "HighSchool", "Megachurch"] as const) {
    const lot = Lot[name];
    const { w: fw, h: fh } = footprintOf(lot);
    const s = frame(stage(lot, fw, fh, "S", true), fw, fh).data;
    const n = frame(stage(lot, fw, fh, "N", true), fw, fh).data;
    assert.ok(diffFrac(s, n) > 0.3, `${name}: S and N frontages should compose differently`);
  }
});

test("landmark compounds draw from their lot: no 1-tile icon badge on the anchor", () => {
  for (const [name, lm] of [["Megachurch", Landmark.Megachurch], ["Fairground", Landmark.Fairground], ["RadioTower", Landmark.RadioTower], ["WaterTower", Landmark.WaterTower]] as const) {
    const lot = Lot[name];
    const { w: fw, h: fh } = footprintOf(lot);
    const plain = frame(stage(lot, fw, fh, "S", true), fw, fh).data;
    const withLm = frame(stage(lot, fw, fh, "S", true, lm), fw, fh).data;
    assert.equal(diffFrac(plain, withLm), 0, `${name}: the landmark id must not add a badge over the compound`);
  }
});

test("animated set pieces move on the frame clock (ferris wheel, cinema chaser, radio beacon)", () => {
  for (const name of ["Fairground", "Cinema", "RadioTower"] as const) {
    const lot = Lot[name];
    const { w: fw, h: fh } = footprintOf(lot);
    const a = frame(stage(lot, fw, fh, "S", true), fw, fh, 0).data;
    const b = frame(stage(lot, fw, fh, "S", true), fw, fh, 74).data;
    assert.ok(diffFrac(a, b) > 0, `${name}: frames 0 and 74 should differ`);
  }
});

test("radio tower: natural ground outside its pad, and a blooming red beacon at night", () => {
  const lot = Lot.RadioTower;
  const { w: fw, h: fh } = footprintOf(lot);
  // ground at the lot's corner px (away from pad / anchors) matches open land
  const bg = frame(stage(lot, fw, fh, "S", false), fw, fh).data;
  const a = frame(stage(lot, fw, fh, "S", true), fw, fh).data;
  const W = fw * 8;
  for (const [x, y] of [[1, 8], [8, 1], [W - 2, 9], [W - 2, 16]] as const) {
    const i = (y * W + x) * 4;
    assert.deepEqual([a[i], a[i + 1], a[i + 2]], [bg[i], bg[i + 1], bg[i + 2]], `open ground at ${x},${y}`);
  }
  const s = createSim({ seed: 7, balance, world: stage(lot, fw, fh, "S", true), spawns: [], timerTicks: 0, dominationPermille: 1000 });
  const night = renderTown(s, { frameTick: 0, lod: 1, view: { x: 3, y: 1, w: fw, h: fh + 2 } /* the tall mast rises into the overhang */, season: "summer", timeOfDay: "night" }).data;
  let hot = 0;
  for (let i = 0; i < night.length; i += 4) if (night[i]! >= 160 && night[i + 1]! < 80 && night[i + 2]! < 80) hot++;
  assert.ok(hot >= 9, `beacon + bloom should be >= 9 red px at night, got ${hot}`);
});
