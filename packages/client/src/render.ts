/**
 * Client map view: thin wrapper over @flock/sim's shared town renderer
 * (townRender.ts draws streets, houses, people-dots, icons — identically
 * here and in headless screenshot/recap renderers). This file owns only the
 * client-specific parts: the PixiJS texture, the camera (zoom + pan with
 * level-of-detail), fog computation, and screen↔tile math.
 *
 * Zoom drives level-of-detail: at fit-to-screen the whole map renders at LOD 1
 * (8px/tile); as you zoom in, only the visible window is rendered at a higher
 * LOD so finer detail (window mullions, shingles, ragged tree edges) resolves.
 */

import { Application, Sprite, Texture, Graphics } from "pixi.js";
import { renderTown, TILE_PX, type SimState } from "@flock/sim";

const MAX_LOD = 4;

export class MapRenderer {
  private readonly app: Application;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: Texture;
  readonly sprite: Sprite;
  private fog: Uint8Array | null = null;
  private fogTick = -1;
  private lastDrawnTick = -1;
  private viewerId = 0;
  showDissent = false;
  private readonly mapW: number;
  private readonly mapH: number;

  // camera: zoom (1 = fit whole map) and the tile-space center of the view
  private zoom = 1;
  private centerX: number;
  private centerY: number;
  // last view used (tile coords) so tileAt can invert screen→tile
  private view = { x: 0, y: 0, w: 0, h: 0, lod: 1, screenScale: 1 };
  // transient "look here" highlight (clicking a Key Building)
  private highlight: Graphics | null = null;
  private focusTile = -1;
  private focusUntil = 0;

  constructor(app: Application, width: number, height: number) {
    this.app = app;
    this.mapW = width;
    this.mapH = height;
    this.centerX = width / 2;
    this.centerY = height / 2;
    this.canvas = document.createElement("canvas");
    this.canvas.width = width * TILE_PX;
    this.canvas.height = height * TILE_PX;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = Texture.from(this.canvas);
    this.texture.source.scaleMode = "nearest";
    this.sprite = new Sprite(this.texture);
    this.sprite.y = 24; // leave room for the conversion bar
    app.stage.addChild(this.sprite);
    this.lastDrawnTick = -1;
  }

  setViewer(playerId: number): void {
    this.viewerId = playerId;
  }

  /** Screen viewport in CSS pixels (below the 24px conversion bar). */
  private screen(): { w: number; h: number } {
    return { w: this.app.renderer.width, h: Math.max(1, this.app.renderer.height - 24) };
  }

  /** Mouse-wheel zoom, keeping the tile under the cursor fixed. */
  zoomAt(clientX: number, clientY: number, deltaY: number): void {
    const focus = this.tileAtF(clientX, clientY);
    const prev = this.zoom;
    const factor = deltaY < 0 ? 1.2 : 1 / 1.2;
    this.zoom = Math.max(1, Math.min(MAX_LOD, this.zoom * factor));
    if (focus && this.zoom !== prev) {
      // pull the focused tile back under the cursor after the zoom
      const { w, h } = this.screen();
      const fx = (clientX - this.sprite.x) / w - 0.5;
      const fy = (clientY - this.sprite.y) / h - 0.5;
      const tilesAcross = this.mapW / this.zoom;
      const tilesDown = this.mapH / this.zoom;
      this.centerX = focus.x - fx * tilesAcross;
      this.centerY = focus.y - fy * tilesDown;
    }
    this.clampCenter();
    this.lastDrawnTick = -1; // force redraw
  }

  /** Jump the camera to centre on a tile (minimap click). */
  centerOn(tile: number): void {
    this.centerX = (tile % this.mapW) + 0.5;
    this.centerY = ((tile / this.mapW) | 0) + 0.5;
    this.clampCenter();
    this.lastDrawnTick = -1;
  }

  /** The current visible tile window (for the minimap viewport rectangle). */
  getView(): { x: number; y: number; w: number; h: number } {
    return { x: this.view.x, y: this.view.y, w: this.view.w, h: this.view.h };
  }

  /**
   * "Look here": zoom the camera in on a tile and flash a pulsing ring on it
   * for a few seconds (clicking a Key Building row). Deterministic-safe — pure
   * camera/overlay, never touches sim state.
   */
  flashTile(tile: number, nowMs: number): void {
    this.centerX = (tile % this.mapW) + 0.5;
    this.centerY = ((tile / this.mapW) | 0) + 0.5;
    this.zoom = Math.min(MAX_LOD, 3.5); // pull in close enough to read the lot
    this.clampCenter();
    this.focusTile = tile;
    this.focusUntil = nowMs + 2800;
    this.lastDrawnTick = -1; // force a redraw at the new camera
  }

  /**
   * Per-frame overlay for the flash-highlight (called from the app ticker so
   * the pulse animates smoothly even between sim ticks).
   */
  drawHighlight(nowMs: number): void {
    if (!this.highlight) {
      this.highlight = new Graphics();
      this.app.stage.addChild(this.highlight);
    }
    const g = this.highlight;
    g.clear();
    if (this.focusTile < 0 || nowMs >= this.focusUntil) {
      this.focusTile = -1;
      return;
    }
    const r = this.tileToScreen(this.focusTile);
    if (!r) return;
    const life = this.focusUntil - nowMs;
    const alpha = life < 800 ? life / 800 : 1;
    const pulse = 1 + 0.25 * Math.sin(nowMs / 120);
    const pad = Math.max(14, r.size * 0.9) * pulse;
    const x = r.x - pad;
    const y = r.y - pad;
    const w = r.size + pad * 2;
    // translucent gold wash (proven-visible fill) + a bright pulsing ring
    g.rect(x, y, w, w).fill({ color: 0xf0b53e, alpha: alpha * 0.22 });
    g.rect(x, y, w, w).stroke({ width: Math.max(4, r.size * 0.25), color: 0xf0b53e, alpha });
    g.rect(x - 3, y - 3, w + 6, w + 6).stroke({ width: 2, color: 0x19110a, alpha: alpha * 0.7 });
  }

  /** Drag-pan by a screen-pixel delta. */
  pan(dxPx: number, dyPx: number): void {
    const tilePxOnScreen = this.view.screenScale * TILE_PX * this.view.lod;
    if (tilePxOnScreen <= 0) return;
    this.centerX -= dxPx / tilePxOnScreen;
    this.centerY -= dyPx / tilePxOnScreen;
    this.clampCenter();
    this.lastDrawnTick = -1;
  }

  private clampCenter(): void {
    const tilesAcross = this.mapW / this.zoom;
    const tilesDown = this.mapH / this.zoom;
    this.centerX = Math.max(tilesAcross / 2, Math.min(this.mapW - tilesAcross / 2, this.centerX));
    this.centerY = Math.max(tilesDown / 2, Math.min(this.mapH - tilesDown / 2, this.centerY));
  }

  /** Map a client pixel to a fractional tile position (for zoom focus). */
  private tileAtF(clientX: number, clientY: number): { x: number; y: number } | null {
    const v = this.view;
    if (v.w === 0) return null;
    const lx = (clientX - this.sprite.x) / (v.screenScale * v.lod * TILE_PX);
    const ly = (clientY - this.sprite.y) / (v.screenScale * v.lod * TILE_PX);
    const x = v.x + lx;
    const y = v.y + ly;
    if (x < 0 || y < 0 || x >= this.mapW || y >= this.mapH) return null;
    return { x, y };
  }

  /** Map a client pixel position to a tile id, or −1 outside the map. */
  tileAt(_sim: SimState, clientX: number, clientY: number): number {
    const f = this.tileAtF(clientX, clientY);
    if (!f) return -1;
    return ((f.y | 0) * this.mapW + (f.x | 0)) | 0;
  }

  /**
   * Screen-space rect for a tile (the inverse of tileAtF), or null if the tile
   * is outside the current view window. Used to paint overlays (spawn hints,
   * pings) aligned to the rendered map.
   */
  tileToScreen(tile: number): { x: number; y: number; size: number } | null {
    const v = this.view;
    if (v.w === 0) return null;
    const tx = tile % this.mapW;
    const ty = (tile / this.mapW) | 0;
    if (tx < v.x || ty < v.y || tx >= v.x + v.w || ty >= v.y + v.h) return null;
    const size = v.screenScale * v.lod * TILE_PX;
    return {
      x: this.sprite.x + (tx - v.x) * size,
      y: this.sprite.y + (ty - v.y) * size,
      size,
    };
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

    const { w: screenW, h: screenH } = this.screen();
    const lod = Math.max(1, Math.min(MAX_LOD, Math.round(this.zoom)));

    // visible tile window, centered on the camera
    const tilesAcross = Math.min(this.mapW, Math.ceil(this.mapW / this.zoom) + 1);
    const tilesDown = Math.min(this.mapH, Math.ceil(this.mapH / this.zoom) + 1);
    const vx = Math.max(0, Math.min(this.mapW - tilesAcross, Math.round(this.centerX - tilesAcross / 2)));
    const vy = Math.max(0, Math.min(this.mapH - tilesDown, Math.round(this.centerY - tilesDown / 2)));

    const frame = renderTown(sim, {
      viewer: this.viewerId,
      fog: this.fog,
      frameTick: sim.tick,
      lod,
      view: { x: vx, y: vy, w: tilesAcross, h: tilesDown },
      showDissent: this.showDissent,
    });

    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.canvas.width = frame.width;
      this.canvas.height = frame.height;
      this.texture = Texture.from(this.canvas);
      this.texture.source.scaleMode = "nearest";
      this.sprite.texture = this.texture;
    }
    const img = this.ctx.createImageData(frame.width, frame.height);
    img.data.set(frame.data);
    this.ctx.putImageData(img, 0, 0);
    this.texture.source.update();

    // fit the rendered window to the screen and center it
    const screenScale = Math.min(screenW / frame.width, screenH / frame.height);
    this.sprite.scale.set(screenScale);
    this.sprite.x = (screenW - frame.width * screenScale) / 2;
    this.sprite.y = 24 + (screenH - frame.height * screenScale) / 2;
    this.view = { x: vx, y: vy, w: tilesAcross, h: tilesDown, lod, screenScale };
  }
}
