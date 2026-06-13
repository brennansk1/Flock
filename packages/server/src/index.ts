/**
 * FLOCK server entry (§32–34). Wires the production-shaped topology in one
 * process: an HTTP server (health/readiness for the load balancer), a Lobby
 * Director hosting many concurrent matches, a Store for persistence, and an
 * Auth service that mints guest identities and verifies session tokens.
 *
 * Connect: ws://host:8787/?name=Mae&archetype=radiant            (new guest)
 *          ws://host:8787/?token=<session>&archetype=radiant     (returning)
 *
 * Env: PORT, WORLD, BOTS, CHURCHES, CAPACITY, FOUNDING, FLOCK_SECRET,
 *      FLOCK_DATA (dir → durable JSON store; unset → in-memory), LOG_LEVEL.
 */

import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { RawBalance } from "@flock/sim";
import { LobbyDirector } from "./lobby.js";
import { InMemoryStore, JsonFileStore, type Store } from "./store.js";
import { AuthService } from "./auth.js";
import { log } from "./metrics.js";
import type { WireAccount } from "./protocol.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const ARCHETYPES = new Set(["dawn", "radiant", "circle", "visitors"]);

async function main(): Promise<void> {
  const raw = JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance;

  const store: Store = process.env.FLOCK_DATA ? new JsonFileStore(process.env.FLOCK_DATA) : new InMemoryStore();
  const secret = process.env.FLOCK_SECRET ?? "dev-secret-change-me-in-prod";
  const auth = new AuthService(store, secret);

  const lobby = new LobbyDirector(raw, store, auth, {
    worldSize: Number(process.env.WORLD ?? 96),
    botCount: Number(process.env.BOTS ?? 6),
    churchCount: Number(process.env.CHURCHES ?? 1),
    foundingTicks: Number(process.env.FOUNDING ?? 200),
    capacity: Number(process.env.CAPACITY ?? 20),
  });

  // HTTP: health/readiness for the load balancer + ops dashboards.
  const http = createServer((req, res) => {
    if (req.url === "/health" || req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(lobby.health()));
      return;
    }
    res.writeHead(426, { "content-type": "text/plain" });
    res.end("Upgrade Required — connect over WebSocket");
  });

  const wss = new WebSocketServer({ noServer: true });
  http.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => void onConnection(ws, req.url ?? "/"));
  });

  async function onConnection(ws: WebSocket, url: string): Promise<void> {
    const q = new URL(url, "http://localhost").searchParams;
    const arche = q.get("archetype") ?? "dawn";
    const archetype = (ARCHETYPES.has(arche) ? arche : "dawn") as "dawn" | "radiant" | "circle" | "visitors";

    // Auth: an existing session token, else an instant guest (§26 no-wall FTUE).
    const token = q.get("token");
    let account = token ? await auth.authenticate(token) : null;
    let session = token ?? "";
    if (!account) {
      const guest = await auth.guestLogin(q.get("name") ?? "Pilgrim");
      account = guest.account;
      session = guest.session;
    }

    const summary: WireAccount = {
      id: account.id,
      name: account.name,
      guest: account.guest,
      level: account.level,
      relics: account.relics,
      rating: Math.round(account.rating.rating),
      tier: lobby.tierOf(account),
    };
    ws.send(JSON.stringify({ type: "auth", token: session, account: summary }));

    lobby.join(ws, account, archetype);
  }

  http.listen(PORT, () => {
    log("info", "flock server listening", { port: PORT, store: process.env.FLOCK_DATA ? "json-file" : "in-memory" });
  });

  const shutdown = (): void => {
    log("info", "shutting down");
    lobby.stopAll();
    http.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
