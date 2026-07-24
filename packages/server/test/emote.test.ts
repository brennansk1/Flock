/**
 * EMOTE relay (§30, B8.11). Emotes are relayed by the server and never
 * simulated — the wire carries an index into the shared EMOTES table, so the
 * only thing a client can get wrong is the index. These tests pin the relay
 * shape, the sender-identity rule, and the range guard.
 *
 * The stub socket must carry `OPEN` as well as `readyState`: MatchWorker guards
 * every send with `ws.readyState === ws.OPEN`, so a stub without `OPEN` silently
 * receives nothing from the worker.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { RawBalance } from "@flock/sim";
import { EMOTES } from "@flock/sim";

import { LobbyDirector } from "../dist/lobby.js";
import { InMemoryStore } from "../dist/store.js";
import { AuthService } from "../dist/auth.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance;

interface Client {
  ws: never;
  /** every frame the server pushed to this socket, parsed */
  received: () => { type: string; [k: string]: unknown }[];
  /** drive the worker's own message handler, as a real socket would */
  fire: (payload: unknown) => void;
  /** the id the server assigned this socket, from its welcome frame */
  playerId: () => number;
}

function stubWs(): Client {
  const messages: string[] = [];
  const handlers = new Map<string, (data: unknown) => void>();
  const ws = {
    send: (m: string) => messages.push(m),
    close: () => {},
    on: (event: string, cb: (data: unknown) => void) => {
      handlers.set(event, cb);
    },
    once: () => {},
    readyState: 1,
    OPEN: 1,
  };
  const received = () => messages.map((m) => JSON.parse(m) as { type: string });
  return {
    ws: ws as never,
    received,
    fire: (payload: unknown) => handlers.get("message")?.(JSON.stringify(payload)),
    playerId: () => {
      const w = received().find((m) => m.type === "welcome") as { playerId?: number } | undefined;
      assert.ok(w, "socket received a welcome frame");
      return w!.playerId!;
    },
  };
}

function director(): LobbyDirector {
  const store = new InMemoryStore();
  const auth = new AuthService(store, "test-secret-long-enough-for-hmac");
  return new LobbyDirector(raw, store, auth, {
    worldSize: 64,
    botCount: 0,
    churchCount: 0,
    foundingTicks: 200,
    capacity: 4,
  });
}

async function guest(name: string) {
  const store = new InMemoryStore();
  const auth = new AuthService(store, "test-secret-long-enough-for-hmac");
  return (await auth.guestLogin(name)).account;
}

function emotes(c: Client): { from: number; emote: number }[] {
  return c
    .received()
    .filter((m) => m.type === "emote")
    .map((m) => ({ from: m["from"] as number, emote: m["emote"] as number }));
}

test("a valid emote relays to every client, tagged with the sender's own id", async (t) => {
  const lobby = director();
  t.after(() => lobby.stopAll()); // never leak match timers, even on failure
  const a = stubWs();
  const b = stubWs();
  const m = lobby.join(a.ws, await guest("Prophet A"), "dawn", {
    createPrivate: true,
    config: { botCount: 0 },
  });
  assert.ok(m, "host got a match");
  lobby.join(b.ws, await guest("Prophet B"), "radiant", { room: m!.roomCode });

  a.fire({ type: "intent", intent: { t: "EMOTE", emote: 1 } });

  const expected = [{ from: a.playerId(), emote: 1 }];
  assert.deepEqual(emotes(a), expected, "sender sees its own emote");
  assert.deepEqual(emotes(b), expected, "the other client sees it too");
});

test("the relayed sender is the socket's identity, not the payload's claim", async (t) => {
  const lobby = director();
  t.after(() => lobby.stopAll());
  const a = stubWs();
  const b = stubWs();
  const m = lobby.join(a.ws, await guest("Prophet A"), "dawn", {
    createPrivate: true,
    config: { botCount: 0 },
  });
  lobby.join(b.ws, await guest("Prophet B"), "radiant", { room: m!.roomCode });

  // B claims to be A. The relay must ignore the claim and use B's own id.
  b.fire({ type: "intent", intent: { t: "EMOTE", player: a.playerId(), emote: 2 } });

  assert.deepEqual(emotes(a), [{ from: b.playerId(), emote: 2 }], "relayed as the real sender");
});

test("out-of-range and malformed emote indices are dropped, not relayed", async (t) => {
  const lobby = director();
  t.after(() => lobby.stopAll());
  const a = stubWs();
  lobby.join(a.ws, await guest("Prophet A"), "dawn", {
    createPrivate: true,
    config: { botCount: 0 },
  });

  for (const bad of [EMOTES.length, -1, 1.5, NaN, "1", null, undefined, {}]) {
    a.fire({ type: "intent", intent: { t: "EMOTE", emote: bad } });
  }
  assert.deepEqual(emotes(a), [], "no bad index reached the wire");

  // rejecting bad input must not wedge the relay for the next good one
  const last = EMOTES.length - 1;
  a.fire({ type: "intent", intent: { t: "EMOTE", emote: last } });
  assert.deepEqual(emotes(a), [{ from: a.playerId(), emote: last }], "still relays a good emote");
});
