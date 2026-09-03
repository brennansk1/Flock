import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadBalance, createSim, generateWorld, renderTown, Terrain, Lot,
} from "../packages/sim/dist/index.js";

function encodeLZW(indexStream, minCodeSize = 8) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let maxCode = (1 << codeSize) - 1;

  const dict = new Map();

  let bitBuf = 0;
  let bitCnt = 0;
  const outBytes = [];

  function writeCode(c) {
    bitBuf |= (c << bitCnt);
    bitCnt += codeSize;
    while (bitCnt >= 8) {
      outBytes.push(bitBuf & 0xff);
      bitBuf >>= 8;
      bitCnt -= 8;
    }
  }

  writeCode(clearCode);

  let prefix = indexStream[0];
  for (let i = 1; i < indexStream.length; i++) {
    const k = indexStream[i];
    const key = (prefix << 8) | k;
    if (dict.has(key)) {
      prefix = dict.get(key);
    } else {
      writeCode(prefix);
      if (nextCode < 4095) {
        dict.set(key, nextCode++);
        if (nextCode > maxCode && codeSize < 12) {
          codeSize++;
          maxCode = (1 << codeSize) - 1;
        }
      } else {
        writeCode(clearCode);
        dict.clear();
        codeSize = minCodeSize + 1;
        maxCode = (1 << codeSize) - 1;
        nextCode = eoiCode + 1;
      }
      prefix = k;
    }
  }
  writeCode(prefix);
  writeCode(eoiCode);

  if (bitCnt > 0) {
    outBytes.push(bitBuf & 0xff);
  }

  const blocks = [minCodeSize];
  for (let i = 0; i < outBytes.length; i += 255) {
    const chunk = outBytes.slice(i, i + 255);
    blocks.push(chunk.length, ...chunk);
  }
  blocks.push(0);
  return Buffer.from(blocks);
}

function quantizePalette(rgbaFrames, width, height) {
  // Collect color frequencies across all frames
  const colorCounts = new Map();
  for (const frame of rgbaFrames) {
    for (let i = 0; i < frame.length; i += 4) {
      // 5-bit color reduction for palette table
      const r = frame[i] & 0xf8;
      const g = frame[i + 1] & 0xf8;
      const b = frame[i + 2] & 0xf8;
      const key = (r << 16) | (g << 8) | b;
      colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
    }
  }

  // Sort top 256 colors
  const sortedColors = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 256)
    .map(([key]) => [
      (key >> 16) & 0xff,
      (key >> 8) & 0xff,
      key & 0xff,
    ]);

  // Fill up palette to 256 if needed
  while (sortedColors.length < 256) {
    sortedColors.push([0, 0, 0]);
  }

  // Map each RGB to nearest palette index
  function findNearest(r, g, b) {
    let bestDist = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < sortedColors.length; i++) {
      const c = sortedColors[i];
      const dr = r - c[0];
      const dg = g - c[1];
      const db = b - c[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
        if (dist === 0) break;
      }
    }
    return bestIdx;
  }

  // Fast lookup cache
  const cache = new Map();
  function getIndex(r, g, b) {
    const key = ((r & 0xf8) << 16) | ((g & 0xf8) << 8) | (b & 0xf8);
    let idx = cache.get(key);
    if (idx === undefined) {
      idx = findNearest(r, g, b);
      cache.set(key, idx);
    }
    return idx;
  }

  const indexFrames = [];
  for (const frame of rgbaFrames) {
    const indices = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const r = frame[i * 4];
      const g = frame[i * 4 + 1];
      const b = frame[i * 4 + 2];
      indices[i] = getIndex(r, g, b);
    }
    indexFrames.push(indices);
  }

  return { palette: sortedColors, indexFrames };
}

function writeGIF(path, width, height, paletteRGB, indexFrames, delayCentisecs = 15) {
  const header = Buffer.from("GIF89a", "ascii");
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0);
  lsd.writeUInt16LE(height, 2);
  lsd[4] = 0xf7; // GCT 256 colors
  lsd[5] = 0;
  lsd[6] = 0;

  const gct = Buffer.alloc(768);
  for (let i = 0; i < 256; i++) {
    const color = paletteRGB[i] || [0, 0, 0];
    gct[i * 3] = color[0];
    gct[i * 3 + 1] = color[1];
    gct[i * 3 + 2] = color[2];
  }

  const loopExt = Buffer.from([
    0x21, 0xff, 0x0b,
    0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
    0x03, 0x01, 0x00, 0x00, 0x00
  ]);

  const frameBuffers = [];
  for (const frameIndices of indexFrames) {
    const gce = Buffer.from([
      0x21, 0xf9, 0x04,
      0x04,
      delayCentisecs & 0xff, (delayCentisecs >> 8) & 0xff,
      0x00, 0x00
    ]);

    const id = Buffer.alloc(10);
    id[0] = 0x2c;
    id.writeUInt16LE(0, 1);
    id.writeUInt16LE(0, 3);
    id.writeUInt16LE(width, 5);
    id.writeUInt16LE(height, 7);
    id[9] = 0x00;

    const imgData = encodeLZW(frameIndices, 8);
    frameBuffers.push(gce, id, imgData);
  }

  const trailer = Buffer.from([0x3b]);
  const gifBuf = Buffer.concat([header, lsd, gct, loopExt, ...frameBuffers, trailer]);
  writeFileSync(path, gifBuf);
  console.log(`Saved Animated GIF: ${path} (${width}x${height}, ${indexFrames.length} frames)`);
}

const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));
const seed = 42;
const world = generateWorld(seed, 96, 96);
const sim = createSim({ seed, balance, world, spawns: [{ id: 1, archetype: "dawn" }, { id: 2, archetype: "radiant" }] });

// Focus viewport on river/bridge/town center:
// Tile coords (x: 0..40, y: 15..55), size 40x40 tiles = 320x320 pixels
const vx = 0;
const vy = 15;
const vw = 40;
const vh = 40;
const scale = 1;
const renderW = vw * 8 * scale;
const renderH = vh * 8 * scale;

const NUM_FRAMES = 24;
const rgbaFrames = [];

for (let f = 0; f < NUM_FRAMES; f++) {
  sim.tick = f * 2;
  const res = renderTown(sim, {
    scale,
    view: { x: vx, y: vy, w: vw, h: vh },
    frameTick: f * 2,
    season: "summer",
    timeOfDay: "day",
  });
  const buf = Buffer.from(res.data.buffer, res.data.byteOffset, res.data.byteLength);
  rgbaFrames.push(buf);
}

console.log("Quantizing palette across 24 animation frames...");
const { palette, indexFrames } = quantizePalette(rgbaFrames, renderW, renderH);

const artifactDir = "C:\\Users\\Brennan Kelley\\.gemini\\antigravity-cli\\brain\\5896231d-966e-47bf-8a08-6f888bf1f049";
const gifPath = join(artifactDir, "animated_water_and_town.gif");

writeGIF(gifPath, renderW, renderH, palette, indexFrames, 12);
