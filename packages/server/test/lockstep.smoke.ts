/**
 * End-to-end lockstep smoke test: boots a MatchWorker over a real WebSocket,
 * connects two headless clients that mirror the sim exactly the way the
 * browser client does (snapshot restore + Turn replay), drives intents, and
 * asserts the clients' local StateHash matches every server hash broadcast.
 *
 * This is the §33 contract under real transport. Run: npm test -w @flock/server
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import {
  loadBalance,
  step,
  hashState,
  fromSnapshot,
  fromInt,
  IntentType,
  type RawBalance,
  type SimState,
  type Turn,
  type Snapshot,
} from "@flock/sim";
import { MatchWorker } from "../dist/matchWorker.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance;
const balance = loadBalance(raw);

interface HeadlessClient {
  sim: SimState | null;
  playerId: number;
  ws: WebSocket;
  hashChecks: number;
  mismatches: string[];
}

function headlessClient(port: number, name: string, archetype: string): Promise<HeadlessClient> {
  return new Promise((resolveClient, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?name=${name}&archetype=${archetype}`);
    const c: HeadlessClient = { sim: null, playerId: 0, ws, hashChecks: 0, mismatches: [] };
    ws.on("error", reject);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as
        | { type: "welcome"; playerId: number; snapshot: Snapshot }
        | { type: "player_joined"; player: { id: number; archetype: SimState["players"][0]["archetype"] } }
        | { type: "turn"; turn: Turn }
        | { type: "hash"; tick: number; hash: string };
      switch (msg.type) {
        case "welcome":
          c.playerId = msg.playerId;
          c.sim = fromSnapshot(msg.snapshot);
          resolveClient(c);
          break;
        case "player_joined":
          c.sim?.players.push({
            id: msg.player.id,
            archetype: msg.player.archetype,
            alive: true,
            stance: "spread",
            followers: balance.economy.startFollowers,
            usd: balance.economy.startUsd,
            faith: fromInt(50),
            heat: 0,
            compounds: 1,
            ownedTiles: 0,
          });
          break;
        case "turn":
          if (c.sim) step(c.sim, msg.turn, balance);
          break;
        case "hash": {
          if (!c.sim) break;
          c.hashChecks++;
          const local = hashState(c.sim);
          if (local !== msg.hash)
            c.mismatches.push(`tick=${msg.tick} server=${msg.hash} local=${local}`);
          break;
        }
      }
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("two clients stay hash-identical with the server over live lockstep", async () => {
  const worker = new MatchWorker(raw, 0xfab1e);
  const wss = new WebSocketServer({ port: 0 });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://x");
    worker.addClient(
      ws,
      url.searchParams.get("name") ?? "anon",
      (url.searchParams.get("archetype") ?? "dawn") as "dawn" | "radiant" | "circle" | "visitors",
    );
  });
  const port = (wss.address() as { port: number }).port;

  try {
    const a = await headlessClient(port, "Tiber", "dawn");
    await sleep(700); // late join: exercises the snapshot path mid-match
    const b = await headlessClient(port, "Mae", "radiant");

    // Drive gameplay: stance change + a front from each client.
    a.ws.send(
      JSON.stringify({
        type: "intent",
        intent: { t: IntentType.SET_STANCE, player: a.playerId, stance: "crusade" },
      }),
    );
    const wWidth = a.sim!.world.width;
    const frontTiles = Array.from({ length: 25 }, (_, i) => 30 * wWidth + 20 + (i % 5) + ((i / 5) | 0) * wWidth);
    a.ws.send(JSON.stringify({ type: "intent", intent: { t: IntentType.OPEN_FRONT, player: a.playerId, tiles: frontTiles } }));
    b.ws.send(JSON.stringify({ type: "intent", intent: { t: IntentType.OPEN_FRONT, player: b.playerId, tiles: frontTiles } }));

    // Let the match run long enough for 100+ turns and several hash broadcasts.
    await sleep(11_000);

    assert.ok(a.hashChecks >= 2, `client A should have seen hash broadcasts (got ${a.hashChecks})`);
    assert.ok(b.hashChecks >= 2, `client B should have seen hash broadcasts (got ${b.hashChecks})`);
    assert.deepEqual(a.mismatches, [], `client A desynced: ${a.mismatches[0] ?? ""}`);
    assert.deepEqual(b.mismatches, [], `client B desynced: ${b.mismatches[0] ?? ""}`);

    a.ws.close();
    b.ws.close();
  } finally {
    worker.stop();
    wss.close();
  }
});
