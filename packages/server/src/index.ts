/**
 * FLOCK server entry (§32–34). Skeleton topology: this process plays both
 * Lobby Director and a single Match Worker. The production split (master
 * process + one pinned worker per match) keeps this file's seams: a match is
 * already a self-contained MatchWorker object.
 *
 * Connect: ws://localhost:8787/?name=Mae&archetype=radiant
 */

import { WebSocketServer } from "ws";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { RawBalance } from "@flock/sim";
import { MatchWorker } from "./matchWorker.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);

const ARCHETYPES = new Set(["dawn", "radiant", "circle", "visitors"]);

function main(): void {
  const raw = JSON.parse(
    readFileSync(resolve(here, "../../../balance.json"), "utf8"),
  ) as RawBalance;

  const seed = (Date.now() ^ (process.pid << 16)) >>> 0; // lobby-level, not sim-level
  const match = new MatchWorker(raw, seed);

  const wss = new WebSocketServer({ port: PORT });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const name = (url.searchParams.get("name") ?? "Drifter").slice(0, 24);
    const arche = url.searchParams.get("archetype") ?? "dawn";
    const archetype = (ARCHETYPES.has(arche) ? arche : "dawn") as
      | "dawn"
      | "radiant"
      | "circle"
      | "visitors";
    match.addClient(ws, name, archetype);
  });

  // eslint-disable-next-line no-console
  console.log(`[flock-server] lockstep match worker listening on ws://localhost:${PORT} (seed=${seed})`);
}

main();
