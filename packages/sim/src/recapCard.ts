/**
 * Recap Card renderer (§25.1). Turns a MatchRecap into a deterministic
 * 1080×1350 RGBA buffer — the shareable post-match brag image. Like townRender
 * it is a pure pixel function (same recap ⇒ identical bytes), so the client, a
 * headless share-renderer, and tests all agree. Text uses a built-in 5×7 pixel
 * font scaled up to match the chunky world / crisp UI grammar (§30).
 *
 * Frame layout matches renderTown's: { width, height, data: Uint8ClampedArray }.
 */

import { PLAYER_COLORS, colorForPlayer, hexToRgb, shade, territoryPixel, type RGB, type Archetype } from "./palette.js";
import type { MatchRecap, PlayerRecap } from "./recap.js";

export interface CardFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export const CARD_W = 1080;
export const CARD_H = 1350;

// 5×7 pixel font. Each glyph is 7 rows of 5 chars ("#" = ink). Uppercase only;
// lowercase is folded to uppercase before drawing.
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "11110", "10001", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "11110", "10000", "10000", "10000", "11111"],
  F: ["11111", "10000", "11110", "10000", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10011", "10101", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00010", "00100", "00100", "00000", "00100"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "#": ["01010", "11111", "01010", "01010", "11111", "01010", "00000"],
  $: ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
  "%": ["11001", "11010", "00100", "01000", "01011", "10011", "00000"],
  "/": ["00001", "00010", "00100", "00100", "01000", "10000", "10000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
};

function px(frame: CardFrame, x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return;
  const i = (y * frame.width + x) * 4;
  frame.data[i] = c[0];
  frame.data[i + 1] = c[1];
  frame.data[i + 2] = c[2];
  frame.data[i + 3] = 255;
}

function rect(frame: CardFrame, x0: number, y0: number, w: number, h: number, c: RGB): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(frame, x, y, c);
}

/** Draw text at (x,y) with the given scale (pixel = scale×scale block). Returns end-x. */
function text(frame: CardFrame, str: string, x: number, y: number, scale: number, c: RGB): number {
  let cx = x;
  for (const raw of str.toUpperCase()) {
    const glyph = FONT[raw] ?? FONT["?"]!;
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row]!;
      for (let col = 0; col < 5; col++) {
        if (bits[col] === "1") rect(frame, cx + col * scale, y + row * scale, scale, scale, c);
      }
    }
    cx += 6 * scale; // 5px glyph + 1px gap
  }
  return cx;
}

function textWidth(str: string, scale: number): number {
  return str.length * 6 * scale;
}

/** Largest integer scale ≤ maxScale that fits `str` within `maxW` (≥1). */
function fitScale(str: string, maxScale: number, maxW: number): number {
  let s = maxScale;
  while (s > 1 && textWidth(str, s) > maxW) s--;
  return s;
}

function centered(frame: CardFrame, str: string, y: number, scale: number, c: RGB): void {
  text(frame, str, (frame.width - textWidth(str, scale)) / 2, y, scale, c);
}

const ARCHETYPE_LABEL: Record<Archetype, string> = {
  dawn: "THE FINAL DAWN",
  radiant: "THE RADIANT PATH",
  circle: "THE PROSPERITY CIRCLE",
  visitors: "THE VISITORS FELLOWSHIP",
};

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

function fmtNum(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;
}

/** Word-wrap a string to a max pixel width at the given scale. */
function wrap(str: string, scale: number, maxW: number): string[] {
  const words = str.toUpperCase().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (textWidth(trial, scale) > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** A small archetype sigil drawn from primitives, centered at (cx,cy), radius r. */
function sigil(frame: CardFrame, cx: number, cy: number, r: number, arch: Archetype, c: RGB): void {
  switch (arch) {
    case "dawn": // rising sun with rays
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        for (let t = r * 0.6; t < r; t++) px(frame, cx + Math.round(Math.cos(ang) * t), cy + Math.round(Math.sin(ang) * t), c);
      }
      for (let y = -r * 0.5; y <= 0; y++)
        for (let x = -r * 0.5; x <= r * 0.5; x++) if (x * x + y * y <= (r * 0.5) ** 2) px(frame, cx + x, cy + y, c);
      break;
    case "radiant": // concentric bloom
      for (let ring = r; ring > 0; ring -= 6)
        for (let a = 0; a < 360; a += 3) px(frame, cx + Math.round(Math.cos((a * Math.PI) / 180) * ring), cy + Math.round(Math.sin((a * Math.PI) / 180) * ring), c);
      break;
    case "circle": // dollar ring (3px thick so it reads as a solid coin edge)
      for (let a = 0; a < 360; a += 1)
        for (let dr = -1; dr <= 1; dr++)
          px(frame, cx + Math.round(Math.cos((a * Math.PI) / 180) * (r + dr)), cy + Math.round(Math.sin((a * Math.PI) / 180) * (r + dr)), c);
      text(frame, "$", cx - 9, cy - 21, 6, c);
      break;
    case "visitors": // saucer
      for (let x = -r; x <= r; x++) {
        const h = Math.round(Math.sqrt(Math.max(0, 1 - (x * x) / (r * r))) * r * 0.35);
        for (let y = -h; y <= h; y++) px(frame, cx + x, cy + y, c);
      }
      for (let x = -r * 0.45; x <= r * 0.45; x++)
        for (let y = -r * 0.5; y < -r * 0.2; y++) if (x * x + (y + r * 0.35) ** 2 * 2 <= (r * 0.45) ** 2) px(frame, cx + x, cy + y, c);
      break;
  }
}

/**
 * Render the full Recap Card for `recap`. `names` maps playerId → cult name
 * (the roster); missing names fall back to "SECT #id" per the §30 name-filter
 * default. The winner anchors the card's color and sigil.
 */
export function renderRecapCard(recap: MatchRecap, names: Record<number, string> = {}, archetypes: Record<number, Archetype> = {}): CardFrame {
  const frame: CardFrame = { width: CARD_W, height: CARD_H, data: new Uint8ClampedArray(CARD_W * CARD_H * 4) };

  const winner = recap.players.find((p) => p.won) ?? recap.players[0];
  const winId = winner?.player ?? 1;
  const winArch = archetypes[winId] ?? "dawn";
  const base = hexToRgb(colorForPlayer(winId));
  const ink: RGB = [245, 240, 230];
  const dim: RGB = [200, 195, 185];

  // background: the winner's territory pattern, darkened, with a vignette band
  for (let y = 0; y < CARD_H; y++) {
    for (let x = 0; x < CARD_W; x++) {
      const tone = shade(territoryPixel(base, winArch, x, y), 0.32);
      px(frame, x, y, tone);
    }
  }
  rect(frame, 0, 0, CARD_W, 8, base);
  rect(frame, 0, CARD_H - 8, CARD_W, 8, base);

  // header
  centered(frame, "FLOCK", 60, 7, dim);
  centered(frame, "MATCH RECAP", 150, 5, dim);

  // sigil + winner name + archetype
  sigil(frame, CARD_W / 2, 320, 90, winArch, base);
  const name = names[winId] ?? `SECT #${winId}`;
  // auto-fit the title so long cult names never truncate mid-word
  centered(frame, name, 450, fitScale(name, 7, CARD_W - 90), ink);
  centered(frame, ARCHETYPE_LABEL[winArch], 540, 4, dim);

  // auto-headline (priority grammar already baked into recap.players[].headline)
  const headline = winner?.headline ?? "ONE TOWN. NO REGRETS.";
  const hlLines = wrap(headline, 4, CARD_W - 120);
  let hy = 620;
  for (const line of hlLines) {
    centered(frame, line, hy, 4, ink);
    hy += 44;
  }

  // stat block
  const statY = 820;
  const stats: [string, string][] = winner
    ? [
        ["PEAK FOLLOWERS", fmtNum(winner.peakFollowers)],
        ["$ EARNED", fmtMoney(winner.usdEarned)],
        ["TILES HELD", `${winner.tilesHeld}`],
        ["FAITH", `${winner.faith}`],
      ]
    : [];
  let sy = statY;
  for (const [label, value] of stats) {
    text(frame, label, 120, sy, 4, dim);
    const vx = CARD_W - 120 - textWidth(value, 5);
    text(frame, value, vx, sy - 6, 5, ink);
    rect(frame, 120, sy + 44, CARD_W - 240, 2, shade(base, 0.7));
    sy += 78;
  }

  // standings footer: the finishing order, winner first
  centered(frame, "FINAL STANDINGS", sy + 30, 4, dim);
  let ry = sy + 90;
  const ranked = [...recap.players].sort((a, b) => (b.won ? 1 : 0) - (a.won ? 1 : 0) || b.tilesHeld - a.tilesHeld);
  ranked.slice(0, 6).forEach((pr: PlayerRecap, i) => {
    const swatch = hexToRgb(PLAYER_COLORS[(pr.player - 1) % PLAYER_COLORS.length]!);
    rect(frame, 130, ry, 28, 28, swatch);
    const label = `${i + 1}  ${names[pr.player] ?? `SECT #${pr.player}`}`;
    // fit each row to the available width so names never clip the card edge
    text(frame, label, 175, ry, fitScale(label, 3, CARD_W - 205), pr.won ? ink : dim);
    ry += 48;
  });

  return frame;
}
