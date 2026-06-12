/**
 * Client map view: thin wrapper over @flock/sim's shared town renderer
 * (townRender.ts draws streets, houses, people-dots, icons — identically
 * here and in headless screenshot/recap renderers). This file owns only the
 * client-specific parts: the PixiJS texture, fog computation for the viewing
 * player, and screen↔tile math.
 */

import { Application, Sprite, Texture } from "pixi.js";
import { renderTown, TILE_PX, type SimState } from "@flock/sim";

export class MapRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: Texture;
  readonly sprite: Sprite;
  private fog: Uint8Array | null = null;
  private fogTick = -1;
  private lastDrawnTick = -1;
  private viewerId = 0;

  constructor(app: Application, width: number, height: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width * TILE_PX;
    this.canvas.height = height * TILE_PX;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = Texture.from(this.canvas);
    this.texture.source.scaleMode = "nearest";
    this.sprite = new Sprite(this.texture);

    const scale = Math.min(
      app.renderer.width / this.canvas.width,
      (app.renderer.height - 24) / this.canvas.height,
    );
    this.sprite.scale.set(Math.max(0.5, Math.floor(scale * 2) / 2));
    this.sprite.y = 24; // leave room for the conversion bar
    app.stage.addChild(this.sprite);
  }

  setViewer(playerId: number): void {
    this.viewerId = playerId;
  }

  /** Map a client pixel position to a tile id, or −1 outside the map. */
  tileAt(sim: SimState, clientX: number, clientY: number): number {
    const s = this.sprite;
    const x = Math.floor((clientX - s.x) / (s.scale.x * TILE_PX));
    const y = Math.floor((clientY - s.y) / (s.scale.y * TILE_PX));
    const w = sim.world;
    if (x < 0 || y < 0 || x >= w.width || y >= w.height) return -1;
    return y * w.width + x;
  }

  /** Fog of war (§14): owned tiles + radius 6, units radius 4, allied vision. */
  private updateFog(sim: SimState): void {
    if (sim.tick - this.fogTick < 5 && this.fog !== undefined) return;
    this.fogTick = sim.tick;
    const w = sim.world;
    const me = this.viewerId;
    const alive = sim.players.find((p) => p.id === me)?.alive ?? false;
    if (!me || !alive) {
      this.fog = null; // spectators see everything (Spectator+, §18)
      return;
    }
    const fog = new Uint8Array(w.owner.length);
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
    for (let t = 0; t < w.owner.length; t++) if (w.owner[t] === me) reveal(t, 6);
    for (const v of sim.vans) if (v.player === me) reveal(v.tile, 4);
    for (const a of sim.agents) if (a.player === me && a.phase !== "travel") reveal(a.tile, 4);
    for (const al of sim.alliances) {
      const other = al.a === me ? al.b : al.b === me ? al.a : 0;
      if (!other) continue;
      for (let t = 0; t < w.owner.length; t++) if (w.owner[t] === other) reveal(t, 6);
    }
    this.fog = fog;
  }

  draw(sim: SimState): void {
    if (sim.tick === this.lastDrawnTick) return; // redraw at sim rate (10 Hz)
    this.lastDrawnTick = sim.tick;
    this.updateFog(sim);

    const frame = renderTown(sim, { viewer: this.viewerId, fog: this.fog, frameTick: sim.tick });
    const img = this.ctx.createImageData(frame.width, frame.height);
    img.data.set(frame.data);
    this.ctx.putImageData(img, 0, 0);
    this.texture.source.update();
  }
}
