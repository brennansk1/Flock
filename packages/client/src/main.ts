/**
 * FLOCK client entry (§32). Skeleton: boots a PixiJS application onto #app. The
 * full client owns the map renderer, client-side prediction, turn reconciliation
 * against the server's broadcast, and the HUD (§27) — all delegated build-out.
 *
 * The shared @flock/sim runs here identically to the server, so prediction is
 * just "run the sim locally and reconcile on Turn arrival."
 */

import { Application } from "pixi.js";

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    background: "#1a1410",
    resizeTo: window,
    antialias: false, // chunky 8×8 tile look (§30)
  });
  document.getElementById("app")!.appendChild(app.canvas);

  // Map renderer, prediction loop, and HUD are wired in by the client build task.
  // eslint-disable-next-line no-console
  console.log("[flock-client] PixiJS up. Renderer + netcode pending.");
}

void boot();
