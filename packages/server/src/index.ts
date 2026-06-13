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
import { dailyChallenge, dayNumber, freeRotation, purchase, CATALOG, type RawBalance, type Wallet } from "@flock/sim";
import { LobbyDirector } from "./lobby.js";
import { InMemoryStore, JsonFileStore, type Store, type Account } from "./store.js";
import { AuthService } from "./auth.js";
import { CongregationService } from "./congregations.js";
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
  const congregations = new CongregationService(store);

  const publicProfile = (a: Account): Record<string, unknown> => ({
    id: a.id,
    name: a.name,
    level: a.level,
    rating: Math.round(a.rating.rating),
    tier: lobby.tierOf(a),
    isProphet: a.isProphet,
    unlocks: a.unlocks,
  });

  const readBody = (req: import("node:http").IncomingMessage): Promise<unknown> =>
    new Promise((resolve) => {
      let data = "";
      req.on("data", (c) => {
        data += c;
        if (data.length > 1 << 16) req.destroy(); // 64KB cap
      });
      req.on("end", () => {
        try {
          resolve(JSON.parse(data || "{}"));
        } catch {
          resolve({});
        }
      });
    });
  const accountFromReq = (req: import("node:http").IncomingMessage, q: URLSearchParams): Promise<Account | null> => {
    const h = req.headers["authorization"];
    const token = (h?.startsWith("Bearer ") ? h.slice(7) : null) ?? q.get("token");
    return token ? auth.authenticate(token) : Promise.resolve(null);
  };

  // HTTP/REST: health + the lobby/profile/store/clan API (§20/§22/§24/§28).
  const http = createServer((req, res) => {
    void route(req, res).catch((e) => {
      log("error", "http route failed", { url: req.url, err: String(e) });
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  const send = (res: import("node:http").ServerResponse, code: number, body: unknown): void => {
    res.writeHead(code, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    });
    res.end(JSON.stringify(body));
  };

  async function route(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): Promise<void> {
    const u = new URL(req.url ?? "/", "http://localhost");
    const path = u.pathname;
    const q = u.searchParams;
    if (req.method === "OPTIONS") return send(res, 204, {});

    if (path === "/health" || path === "/healthz") return send(res, 200, lobby.health());
    if (path === "/daily") return send(res, 200, { day: dayNumber(), challenge: dailyChallenge(), freeRotation: freeRotation(dayNumber()) });
    if (path === "/catalog") return send(res, 200, { items: CATALOG });
    if (path === "/leaderboard") {
      const top = await store.topRatings(Number(q.get("limit") ?? 100));
      return send(res, 200, { players: top.map((a, i) => ({ rank: i + 1, ...publicProfile(a) })) });
    }
    if (path.startsWith("/profile/")) {
      const acc = await store.getAccount(path.slice("/profile/".length));
      if (!acc) return send(res, 404, { error: "not found" });
      const matches = await store.listMatches(acc.id, 20);
      return send(res, 200, { profile: publicProfile(acc), matches });
    }
    if (path.startsWith("/replay/")) {
      const r = await store.loadReplay(path.slice("/replay/".length));
      return r ? send(res, 200, r) : send(res, 404, { error: "not found" });
    }
    if (path === "/congregations" && req.method === "GET") {
      return send(res, 200, { ladder: await congregations.ladder() });
    }
    if (path === "/me") {
      const acc = await accountFromReq(req, q);
      return acc ? send(res, 200, { profile: publicProfile(acc), relics: acc.relics, shards: acc.shards }) : send(res, 401, { error: "unauthenticated" });
    }

    // ---- authenticated mutations ----
    if (req.method === "POST") {
      const acc = await accountFromReq(req, q);
      if (!acc) return send(res, 401, { error: "unauthenticated" });
      const body = (await readBody(req)) as Record<string, unknown>;

      if (path === "/purchase") {
        const wallet: Wallet = { relics: acc.relics, shards: acc.shards, unlocks: acc.unlocks };
        // money-priced items require a verified payment authorization (cents);
        // in this build only relic/shard items succeed without a payment gateway.
        const result = purchase(wallet, String(body.itemId ?? ""), Number(body.moneyPaid ?? 0));
        if (!result.ok) return send(res, 400, { error: result.reason });
        acc.relics = result.wallet.relics;
        acc.shards = result.wallet.shards;
        acc.unlocks = result.wallet.unlocks;
        await store.saveAccount(acc);
        return send(res, 200, { ok: true, relics: acc.relics, shards: acc.shards, unlocks: acc.unlocks });
      }
      if (path === "/congregations") {
        const r = await congregations.create(acc.id, String(body.name ?? ""), String(body.tag ?? ""));
        return send(res, r.ok ? 200 : 400, r);
      }
      if (path === "/congregations/join") {
        const r = await congregations.join(String(body.id ?? ""), acc.id);
        return send(res, r.ok ? 200 : 400, r);
      }
      if (path === "/congregations/leave") {
        const r = await congregations.leave(String(body.id ?? ""), acc.id);
        return send(res, r.ok ? 200 : 400, r);
      }
    }

    if (path === "/") {
      res.writeHead(426, { "content-type": "text/plain" });
      return void res.end("Upgrade Required — connect over WebSocket");
    }
    return send(res, 404, { error: "not found" });
  }

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
