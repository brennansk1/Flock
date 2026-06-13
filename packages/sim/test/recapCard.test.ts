/**
 * Recap Card renderer (§25.1). A pure pixel function: same recap ⇒ identical
 * bytes, correct dimensions, and a non-empty image with the winner's color.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  renderRecapCard,
  CARD_W,
  CARD_H,
  colorForPlayer,
  hexToRgb,
  type MatchRecap,
} from "../dist/index.js";

const recap: MatchRecap = {
  winner: 2,
  durationTicks: 6000,
  players: [
    { player: 1, headline: "The date came and went. The dawn did not.", tilesHeld: 40, peakFollowers: 1200, usdEarned: 90_000, faith: 55, traitor: false, won: false },
    { player: 2, headline: "Betrayed cult #1 at 4:10. Felt nothing.", tilesHeld: 310, peakFollowers: 8400, usdEarned: 1_250_000, faith: 88, traitor: true, won: true },
    { player: 3, headline: "120 souls. One town. No regrets.", tilesHeld: 12, peakFollowers: 300, usdEarned: 4000, faith: 20, traitor: false, won: false },
  ],
};

const names = { 1: "Gary's Pond Truthers", 2: "Tabernacle of the Reasonable Price", 3: "Discount Witnesses" };
const arch = { 1: "dawn", 2: "circle", 3: "visitors" } as const;

test("recap card has the spec'd 1080×1350 RGBA dimensions", () => {
  const f = renderRecapCard(recap, names, arch);
  assert.equal(f.width, CARD_W);
  assert.equal(f.height, CARD_H);
  assert.equal(f.data.length, CARD_W * CARD_H * 4);
});

test("recap card render is deterministic", () => {
  const a = renderRecapCard(recap, names, arch);
  const b = renderRecapCard(recap, names, arch);
  assert.deepEqual(a.data, b.data);
});

test("recap card is fully opaque and carries the winner's territory color", () => {
  const f = renderRecapCard(recap, names, arch);
  // every pixel painted (alpha 255 everywhere — background fills the frame)
  let opaque = true;
  for (let i = 3; i < f.data.length && opaque; i += 4) if (f.data[i] !== 255) opaque = false;
  assert.ok(opaque, "card has no transparent gaps");

  // the winner's color channel should be present somewhere (border band + sigil)
  const [r, g, b] = hexToRgb(colorForPlayer(2));
  let hit = false;
  for (let i = 0; i < f.data.length; i += 4) {
    if (f.data[i] === r && f.data[i + 1] === g && f.data[i + 2] === b) {
      hit = true;
      break;
    }
  }
  assert.ok(hit, "winner color appears (border/sigil)");
});

test("unknown players fall back to SECT #id without throwing", () => {
  const sparse: MatchRecap = { winner: 7, durationTicks: 100, players: [
    { player: 7, headline: "Last congregation standing.", tilesHeld: 99, peakFollowers: 500, usdEarned: 10_000, faith: 60, traitor: false, won: true },
  ] };
  const f = renderRecapCard(sparse);
  assert.equal(f.data.length, CARD_W * CARD_H * 4);
});
