/**
 * FLOCK client entry (§32). M0 ugly-but-honest UI (§39):
 *  - mirrors the authoritative sim via Turn broadcasts (net.ts)
 *  - paints the territory map every frame (render.ts)
 *  - click = open a 5×5 Front around the tile (§4.1)
 *  - keys 1/2/3 = Tend / Spread / CRUSADE (§5, hotkeys per §27)
 *  - top-left text HUD: followers, $, faith, heat, tiles
 *
 * Server: `npm run dev:server`, then visit this app (`npm run dev:client`).
 * Querystring: ?name=Mae&archetype=radiant&server=ws://localhost:8787
 */

import { Application, Text } from "pixi.js";
import { toFloat, toInt, IntentType, Stance } from "@flock/sim";
import { connect, type GameSession } from "./net.js";
import { MapRenderer } from "./render.js";

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    background: "#1a1410",
    resizeTo: window,
    antialias: false, // chunky 8×8 tile look (§30)
  });
  document.getElementById("app")!.appendChild(app.canvas);

  const q = new URLSearchParams(location.search);
  const name = q.get("name") ?? `Cultist${Math.floor(Math.random() * 1000)}`;
  const archetype = q.get("archetype") ?? "dawn";
  const server = q.get("server") ?? `ws://${location.hostname}:8787`;

  const hud = new Text({
    text: "connecting…",
    style: { fill: "#f0e6d0", fontSize: 14, fontFamily: "monospace" },
  });
  hud.position.set(8, 8);

  connect(`${server}/?name=${encodeURIComponent(name)}&archetype=${archetype}`, (g) => {
    const map = new MapRenderer(app, g.sim.world.width, g.sim.world.height);
    app.stage.addChild(hud); // HUD above map

    wireInput(app, map, g);

    app.ticker.add(() => {
      map.draw(g.sim);
      hud.text = hudText(g);
    });
  });
}

function wireInput(app: Application, map: MapRenderer, g: GameSession): void {
  // Click → OPEN_FRONT on a 5×5 region around the tile. Drag-select later.
  app.canvas.addEventListener("pointerdown", (ev) => {
    const center = map.tileAt(g.sim, ev.offsetX, ev.offsetY);
    if (center < 0) return;
    const w = g.sim.world;
    const cx = center % w.width;
    const cy = (center / w.width) | 0;
    const tiles: number[] = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
        tiles.push(y * w.width + x);
      }
    }
    g.sendIntent({ t: IntentType.OPEN_FRONT, tiles });
  });

  window.addEventListener("keydown", (ev) => {
    const stance =
      ev.key === "1" ? Stance.Tend : ev.key === "2" ? Stance.Spread : ev.key === "3" ? Stance.Crusade : null;
    if (stance) g.sendIntent({ t: IntentType.SET_STANCE, stance });
  });
}

function hudText(g: GameSession): string {
  const me = g.sim.players.find((p) => p.id === g.playerId);
  if (!me) return "spectating";
  return [
    `${g.players.find((p) => p.id === g.playerId)?.name ?? "?"} [${me.archetype}] — ${me.stance.toUpperCase()}`,
    `followers ${toInt(me.followers)}   $${toInt(me.usd)}`,
    `faith ${toFloat(me.faith).toFixed(0)}   heat ${toFloat(me.heat).toFixed(0)}   tiles ${me.ownedTiles}`,
    `tick ${g.sim.tick}   [click=front  1/2/3=stance]`,
  ].join("\n");
}

void boot();
