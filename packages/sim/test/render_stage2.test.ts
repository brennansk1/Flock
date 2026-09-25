/**
 * Stage-2 renderer invariants: presentation-only determinism, no hot-pink
 * grading, fleet sprite bounds, building orientation (frontage + curb cut).
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
  hashState,
  drawVehicle,
  vehicleSize,
  VEHICLE_KINDS,
  Terrain,
  Lot,
  Districts,
  type RawBalance,
  type World,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const balance = loadBalance(JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance);

function sim(world: World) {
  return createSim({ seed: 7, balance, world, spawns: [], timerTicks: 0, dominationPermille: 1000 });
}

test("town render is deterministic and never mutates sim state", () => {
  const s = sim(generateWorld(42, 96, 96, { townType: "farm" }));
  const h0 = hashState(s);
  const view = { x: 30, y: 34, w: 30, h: 20 };
  const a = renderTown(s, { frameTick: 450, lod: 2, view, season: "winter", timeOfDay: "dusk" });
  const b = renderTown(s, { frameTick: 450, lod: 2, view, season: "winter", timeOfDay: "dusk" });
  assert.deepEqual(a.data, b.data, "same inputs → identical pixels");
  assert.equal(hashState(s), h0, "rendering never touches the simulation");
});

test("winter dusk is graded warm, not hot pink", () => {
  const s = sim(generateWorld(11, 96, 96, { townType: "farm" }));
  const f = renderTown(s, { frameTick: 0, season: "winter", timeOfDay: "dusk" });
  let pink = 0;
  const n = f.data.length / 4;
  for (let i = 0; i < f.data.length; i += 4) {
    const r = f.data[i]!, g = f.data[i + 1]!, b = f.data[i + 2]!;
    if (b > g + 25 && r > g + 25) pink++; // magenta cast: R and B both well above G
  }
  assert.ok(pink / n < 0.01, `magenta pixels ${((pink / n) * 100).toFixed(2)}% (was the whole map)`);
});

test("every fleet vehicle stays inside its SPRITE_SCALE box in all four headings", () => {
  for (const kind of VEHICLE_KINDS) {
    for (let dir = 0; dir < 4; dir++) {
      const { w, h } = vehicleSize(kind, dir);
      let n = 0;
      drawVehicle((x, y) => {
        assert.ok(x >= 10 && x < 10 + w && y >= 20 && y < 20 + h, `${kind} dir ${dir} drew outside its box`);
        n++;
      }, kind, 10, 20, dir, [120, 120, 120], 0);
      assert.ok(n > 0, `${kind} draws pixels`);
      const long = Math.max(w, h), short = Math.min(w, h);
      if (kind === "bus") assert.deepEqual([long, short], [6, 2]);
      else if (kind === "bmx") assert.deepEqual([long, short], [2, 1]);
      else assert.deepEqual([long, short], [3, 2], `${kind} is a 3×2 car`);
    }
  }
});

/** a blank 12×12 world with one lot and a road on one side */
function oneLot(side: "N" | "S" | "E" | "W", setup: (w: World, t: number) => void): { w: World; t: number } {
  const N = 12;
  const w = generateWorld(3, N, N);
  for (let i = 0; i < w.terrain.length; i++) {
    w.terrain[i] = Terrain.Grass; w.lot[i] = 0; w.pop[i] = 0; w.landmark[i] = 0; w.district[i] = 0; w.biome[i] = 0; w.owner[i] = 0;
  }
  w.streets = [];
  const x = 6, y = 6, t = y * N + x;
  for (let k = -3; k <= 3; k++) {
    const rx = side === "E" ? x + 1 : side === "W" ? x - 1 : x + k;
    const ry = side === "N" ? y - 1 : side === "S" ? y + 1 : y + k;
    w.terrain[ry * N + rx] = Terrain.Road;
  }
  setup(w, t);
  return { w, t };
}

test("a house drives to its own street: drive + curb cut on every frontage", () => {
  const house = (w: World, t: number): void => { w.terrain[t] = Terrain.Citizen; w.district[t] = Districts.Suburbs; w.pop[t] = 5; };
  for (const side of ["N", "S", "E", "W"] as const) {
    const { w } = oneLot(side, house);
    const f = renderTown(sim(w), { frameTick: 0, lod: 1, view: { x: 5, y: 5, w: 3, h: 3 } });
    // the road skirt pixel row/col touching the lot must contain the curb
    // cut colour (#8f897e) somewhere along the shared edge
    const px = (x: number, y: number): number[] => { const o = (y * f.width + x) * 4; return [f.data[o]!, f.data[o + 1]!, f.data[o + 2]!]; };
    const edge: number[][] = [];
    for (let k = 8; k < 16; k++) {
      if (side === "S") edge.push(px(k, 16));
      if (side === "N") edge.push(px(k, 7));
      if (side === "E") edge.push(px(16, k));
      if (side === "W") edge.push(px(7, k));
    }
    assert.ok(edge.some(([r, g, b]) => r === 0x8f && g === 0x89 && b === 0x7e), `curb cut on the ${side} frontage`);
  }
});

test("a north-facing shop shows its awning on the north edge, not the south", () => {
  const shop = (w: World, t: number): void => { w.terrain[t] = Terrain.Citizen; w.lot[t] = Lot.Shop; w.district[t] = Districts.Downtown; w.pop[t] = 4; };
  const rowColours = (side: "N" | "S", row: number): Set<string> => {
    const { w } = oneLot(side, shop);
    const f = renderTown(sim(w), { frameTick: 0, lod: 1, view: { x: 6, y: 6, w: 1, h: 1 } });
    const set = new Set<string>();
    for (let x = 1; x < 7; x++) { const o = (row * f.width + x) * 4; set.add(`${f.data[o]},${f.data[o + 1]},${f.data[o + 2]}`); }
    return set;
  };
  // the striped awning row alternates two colours across the frontage
  assert.ok(rowColours("S", 5).size >= 2, "S-facing: awning stripes on row 5");
  assert.ok(rowColours("N", 1).size >= 2, "N-facing: awning stripes on row 1, the north edge");
  assert.ok(rowColours("N", 5).size <= 2, "N-facing: no awning on the south (back) side");
});
