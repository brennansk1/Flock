/**
 * Map renderer (§30): 4 pixels per tile painted into an offscreen canvas,
 * uploaded as a nearest-neighbor PixiJS texture and scaled up — chunky world,
 * crisp UI. Visual grammar lives in @flock/sim's palette module so headless
 * renderers (screenshots, recap cards) produce identical pixels.
 *
 * Layers per frame: terrain/territory (with per-archetype patterns) → scars →
 * landmarks → buildings → units → fog of war (§14: owned + radius 6).
 */

import { Application, Sprite, Texture } from "pixi.js";
import {
  NEUTRAL,
  TileState,
  Terrain,
  hexToRgb,
  shade,
  territoryPixel,
  colorForPlayer,
  NEUTRAL_BY_DISTRICT,
  TERRAIN_COLORS,
  COLOR_APOSTATE,
  COLOR_APOSTATE_ALT,
  ENTITY_COLORS,
  type RGB,
  type SimState,
} from "@flock/sim";

/** rendered pixels per tile in the offscreen buffer (§30: 8×8 art @ 2× min) */
const PX = 4;

export class MapRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: Texture;
  readonly sprite: Sprite;
  private readonly img: ImageData;
  private fog: Uint8Array | null = null;
  private fogTick = -1;
  private viewerId = 0;

  constructor(app: Application, width: number, height: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width * PX;
    this.canvas.height = height * PX;
    this.ctx = this.canvas.getContext("2d")!;
    this.img = this.ctx.createImageData(width * PX, height * PX);
    this.texture = Texture.from(this.canvas);
    this.texture.source.scaleMode = "nearest";
    this.sprite = new Sprite(this.texture);

    const scale = Math.min(app.renderer.width / (width * PX), app.renderer.height / (height * PX));
    this.sprite.scale.set(Math.max(1, Math.floor(scale * 2) / 2));
    app.stage.addChild(this.sprite);
  }

  setViewer(playerId: number): void {
    this.viewerId = playerId;
  }

  /** Map a client pixel position to a tile id, or −1 outside the map. */
  tileAt(sim: SimState, clientX: number, clientY: number): number {
    const s = this.sprite;
    const x = Math.floor((clientX - s.x) / (s.scale.x * PX));
    const y = Math.floor((clientY - s.y) / (s.scale.y * PX));
    const w = sim.world;
    if (x < 0 || y < 0 || x >= w.width || y >= w.height) return -1;
    return y * w.width + x;
  }

  /** Fog of war (§14): owned tiles + radius 6, vans/agents radius 4. 2 Hz refresh. */
  private updateFog(sim: SimState): void {
    if (sim.tick - this.fogTick < 5 && this.fog) return;
    this.fogTick = sim.tick;
    const w = sim.world;
    const me = this.viewerId;
    const alive = sim.players.find((p) => p.id === me)?.alive ?? false;
    if (!me || !alive) {
      this.fog = null; // spectators see everything (Spectator+, §18)
      return;
    }
    const fog = new Uint8Array(w.owner.length); // 0 = hidden
    const reveal = (t: number, r: number): void => {
      const cx = t % w.width;
      const cy = (t / w.width) | 0;
      for (let dy = -r; dy <= r; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= w.height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          if (x < 0 || x >= w.width) continue;
          if (dx * dx + dy * dy <= r * r) fog[y * w.width + x] = 1;
        }
      }
    };
    for (let t = 0; t < w.owner.length; t++) {
      if (w.owner[t] === me) reveal(t, 6);
    }
    for (const v of sim.vans) if (v.player === me) reveal(v.tile, 4);
    for (const a of sim.agents) if (a.player === me && a.phase !== "travel") reveal(a.tile, 4);
    for (const al of sim.alliances) {
      // allies share vision (§16)
      const other = al.a === me ? al.b : al.b === me ? al.a : 0;
      if (!other) continue;
      for (let t = 0; t < w.owner.length; t++) if (w.owner[t] === other) reveal(t, 6);
    }
    this.fog = fog;
  }

  draw(sim: SimState): void {
    const w = sim.world;
    this.updateFog(sim);
    const data = this.img.data;
    const rowPx = w.width * PX;

    const archetypeOf = new Map<number, "dawn" | "radiant" | "circle" | "visitors">();
    for (const p of sim.players) archetypeOf.set(p.id, p.archetype);

    for (let ty = 0; ty < w.height; ty++) {
      for (let tx = 0; tx < w.width; tx++) {
        const t = ty * w.width + tx;
        const visible = !this.fog || this.fog[t] === 1;

        for (let py = 0; py < PX; py++) {
          for (let px = 0; px < PX; px++) {
            const gx = tx * PX + px;
            const gy = ty * PX + py;
            let rgb = this.pixel(sim, t, gx, gy, archetypeOf);
            if (!visible) rgb = shade(rgb, 0.42); // fogged: terrain ghosts through
            const o = (gy * rowPx + gx) * 4;
            data[o] = rgb[0];
            data[o + 1] = rgb[1];
            data[o + 2] = rgb[2];
            data[o + 3] = 255;
          }
        }
      }
    }

    this.drawEntities(sim, data, rowPx);
    this.ctx.putImageData(this.img, 0, 0);
    this.texture.source.update();
  }

  private pixel(
    sim: SimState,
    t: number,
    gx: number,
    gy: number,
    archetypeOf: Map<number, "dawn" | "radiant" | "circle" | "visitors">,
  ): RGB {
    const w = sim.world;
    switch (w.terrain[t]) {
      case Terrain.Woods:
        return hexToRgb((gx + gy) % 5 === 0 ? TERRAIN_COLORS.woodsAlt : TERRAIN_COLORS.woods);
      case Terrain.Lake:
        return hexToRgb(gy % 6 === 0 ? TERRAIN_COLORS.lakeAlt : TERRAIN_COLORS.lake);
      case Terrain.Road: {
        const mid = gy % PX === PX / 2 || gx % PX === PX / 2;
        return hexToRgb(mid ? TERRAIN_COLORS.roadLine : TERRAIN_COLORS.road);
      }
    }
    if (w.state[t] === TileState.Apostate) {
      return hexToRgb((gx + gy) % 3 === 0 ? COLOR_APOSTATE_ALT : COLOR_APOSTATE);
    }
    const owner = w.owner[t]!;
    if (owner === NEUTRAL) {
      const base = hexToRgb(NEUTRAL_BY_DISTRICT[w.district[t]! % NEUTRAL_BY_DISTRICT.length]!);
      // gentle town texture
      return (gx * 7 + gy * 13) % 11 === 0 ? shade(base, 0.95) : base;
    }
    const base = hexToRgb(colorForPlayer(owner));
    const arch = archetypeOf.get(owner) ?? "dawn";
    return owner >= 900 ? shade(base, 0.95) : territoryPixel(base, arch, gx, gy);
  }

  private drawEntities(sim: SimState, data: Uint8ClampedArray, rowPx: number): void {
    const w = sim.world;
    const put = (gx: number, gy: number, rgb: RGB): void => {
      if (gx < 0 || gy < 0 || gx >= rowPx || gy >= this.canvas.height) return;
      const o = (gy * rowPx + gx) * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    };
    const sprite = (t: number, body: RGB, trim: RGB): void => {
      const x = (t % w.width) * PX;
      const y = ((t / w.width) | 0) * PX;
      // 4×4 building: trim border, body fill
      for (let py = 0; py < PX; py++) {
        for (let px = 0; px < PX; px++) {
          const edge = px === 0 || py === 0 || px === PX - 1 || py === PX - 1;
          put(x + px, y + py, edge ? trim : body);
        }
      }
    };
    const dot2 = (t: number, rgb: RGB): void => {
      const x = (t % w.width) * PX + 1;
      const y = ((t / w.width) | 0) * PX + 1;
      put(x, y, rgb);
      put(x + 1, y, rgb);
      put(x, y + 1, rgb);
      put(x + 1, y + 1, rgb);
    };
    const visible = (t: number): boolean => !this.fog || this.fog[t] === 1;

    for (let t = 0; t < w.landmark.length; t++) {
      if (w.landmark[t] !== 0) sprite(t, hexToRgb(ENTITY_COLORS.landmark), hexToRgb(ENTITY_COLORS.landmarkTrim));
    }
    for (const bd of sim.buildings) {
      if (!visible(bd.tile)) continue;
      const body =
        bd.type === "satellite"
          ? hexToRgb(ENTITY_COLORS.satellite)
          : bd.disabledTicks > 0
            ? hexToRgb(ENTITY_COLORS.buildingDown)
            : bd.buildTicksLeft > 0
              ? hexToRgb(ENTITY_COLORS.buildingSite)
              : hexToRgb(ENTITY_COLORS.buildingBody);
      sprite(bd.tile, body, hexToRgb(ENTITY_COLORS.buildingTrim));
    }
    for (const c of sim.couriers) {
      const t = c.path[c.idx]!;
      if (visible(t)) dot2(t, hexToRgb(ENTITY_COLORS.courier));
    }
    for (const v of sim.vans) if (visible(v.tile)) dot2(v.tile, hexToRgb(ENTITY_COLORS.van));
    for (const py of sim.pylons) if (visible(py.tile)) dot2(py.tile, hexToRgb(ENTITY_COLORS.pylon));
    for (const pk of sim.pickets) if (visible(pk.tile)) dot2(pk.tile, hexToRgb(ENTITY_COLORS.picket));
    // own agents only (they're invisible to everyone else by design, §7)
    for (const a of sim.agents) {
      if (a.player === this.viewerId && a.phase !== "travel") dot2(a.tile, hexToRgb(ENTITY_COLORS.agent));
    }
  }
}
