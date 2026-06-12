/**
 * Map renderer (§30 skeleton): one pixel per tile painted into an offscreen
 * canvas, uploaded as a nearest-neighbor PixiJS texture and scaled up — the
 * chunky-tile look for free, and O(tiles) per repaint with zero per-tile
 * display objects. Patterns/sprites layer on top later.
 */

import { Application, Sprite, Texture } from "pixi.js";
import { NEUTRAL, TileState, Terrain, type SimState } from "@flock/sim";

/** 24 high-contrast territory colors (§30); index = playerId − 1, wrapping. */
const PLAYER_COLORS = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#46f0f0",
  "#f032e6", "#bcf60c", "#fabebe", "#008080", "#e6beff", "#9a6324",
  "#fffac8", "#800000", "#aaffc3", "#808000", "#ffd8b1", "#000075",
  "#808080", "#ffe119", "#a9a9a9", "#ffffff", "#fa8072", "#7fffd4",
] as const;

/** Neutral town base, tinted per district so the texture reads (§2/§30). */
const NEUTRAL_BY_DISTRICT = [
  "#d8c8a8", // unzoned
  "#d8cfae", // Suburbs
  "#cfd8a8", // College
  "#d8bfa0", // Downtown/Strip
  "#c9b8a8", // Old Town
  "#d8c8b8", // Trailer/Outskirts
] as const;
const COLOR_APOSTATE = "#5a4a4a"; // scar tissue
const COLOR_WOODS = "#3a5a30";
const COLOR_LAKE = "#33506e";
const COLOR_ROAD = "#a89880";

export class MapRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: Texture;
  readonly sprite: Sprite;

  constructor(app: Application, width: number, height: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = Texture.from(this.canvas);
    this.texture.source.scaleMode = "nearest";
    this.sprite = new Sprite(this.texture);

    const scale = Math.floor(
      Math.min(app.renderer.width / width, app.renderer.height / height),
    );
    this.sprite.scale.set(Math.max(2, scale)); // rendered 2× minimum (§30)
    app.stage.addChild(this.sprite);
  }

  /** Map a client pixel position to a tile id, or −1 outside the map. */
  tileAt(sim: SimState, clientX: number, clientY: number): number {
    const s = this.sprite;
    const x = Math.floor((clientX - s.x) / s.scale.x);
    const y = Math.floor((clientY - s.y) / s.scale.y);
    const w = sim.world;
    if (x < 0 || y < 0 || x >= w.width || y >= w.height) return -1;
    return y * w.width + x;
  }

  draw(sim: SimState): void {
    const w = sim.world;
    const ctx = this.ctx;
    for (let y = 0; y < w.height; y++) {
      for (let x = 0; x < w.width; x++) {
        const t = y * w.width + x;
        ctx.fillStyle = this.tileColor(sim, t);
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // entity overlay: chunky single-pixel markers (§30 placeholder sprites)
    const dot = (t: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.fillRect(t % w.width, (t / w.width) | 0, 1, 1);
    };
    for (const bd of sim.buildings) {
      dot(bd.tile, bd.disabledTicks > 0 ? "#553333" : bd.buildTicksLeft > 0 ? "#777777" : "#1a1a1a");
    }
    for (let t = 0; t < w.landmark.length; t++) {
      if (w.landmark[t] !== 0) dot(t, "#ffe119");
    }
    for (const c of sim.couriers) dot(c.path[c.idx]!, "#ffd700");
    for (const v of sim.vans) dot(v.tile, "#f8f8ff");
    for (const py of sim.pylons) dot(py.tile, "#ff5555");
    for (const pk of sim.pickets) dot(pk.tile, "#ff00ff");

    this.texture.source.update();
  }

  private tileColor(sim: SimState, t: number): string {
    const w = sim.world;
    switch (w.terrain[t]) {
      case Terrain.Woods:
        return COLOR_WOODS;
      case Terrain.Lake:
        return COLOR_LAKE;
      case Terrain.Road:
        return COLOR_ROAD;
    }
    if (w.state[t] === TileState.Apostate) return COLOR_APOSTATE;
    const owner = w.owner[t]!;
    if (owner === NEUTRAL)
      return NEUTRAL_BY_DISTRICT[w.district[t]! % NEUTRAL_BY_DISTRICT.length]!;
    return PLAYER_COLORS[(owner - 1) % PLAYER_COLORS.length]!;
  }
}
