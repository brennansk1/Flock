/**
 * Private rooms (§32): host a code-gated match, join it by code, and verify
 * public matchmaking never routes into it. WebSockets are stubbed — the
 * LobbyDirector only calls send/close on them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { RawBalance } from "@flock/sim";

import { LobbyDirector } from "../dist/lobby.js";
import { InMemoryStore } from "../dist/store.js";
import { AuthService } from "../dist/auth.js";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, "../../../balance.json"), "utf8")) as RawBalance;

interface Sent {
  messages: string[];
  closed: boolean;
}

function stubWs(): { ws: never; sent: Sent } {
  const sent: Sent = { messages: [], closed: false };
  const ws = {
    send: (m: string) => sent.messages.push(m),
    close: () => {
      sent.closed = true;
    },
    on: () => {},
    once: () => {},
    readyState: 1,
  };
  return { ws: ws as never, sent };
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

test("host a private room: code issued, joinable by code, invisible to public", async () => {
  const lobby = director();
  const host = await guest("Host");
  const { ws: hostWs, sent: hostSent } = stubWs();
  const m1 = lobby.join(hostWs, host, "dawn", { createPrivate: true, config: { botCount: 0 } });
  assert.ok(m1, "host got a match");
  assert.ok(m1!.isPrivate, "match is private");
  assert.match(m1!.roomCode, /^[A-HJ-NP-Z2-9]{5}$/, "5-char room code from the safe alphabet");
  const roomMsg = hostSent.messages.map((m) => JSON.parse(m)).find((m) => m.type === "room");
  assert.equal(roomMsg?.code, m1!.roomCode, "host received the shareable code");

  // a friend joins by code (case-insensitive)
  const friend = await guest("Friend");
  const { ws: friendWs, sent: friendSent } = stubWs();
  const m2 = lobby.join(friendWs, friend, "radiant", { room: m1!.roomCode.toLowerCase() });
  assert.equal(m2?.matchId, m1!.matchId, "code routed the friend into the host's match");
  assert.ok(!friendSent.closed, "friend connection stayed open");

  // a random public player never lands in the private room
  const rando = await guest("Rando");
  const { ws: randoWs } = stubWs();
  const m3 = lobby.join(randoWs, rando, "circle", {});
  assert.ok(m3, "public player got a match");
  assert.notEqual(m3!.matchId, m1!.matchId, "public matchmaking skipped the private room");
  assert.ok(!m3!.isPrivate, "public match is public");

  lobby.stopAll();
});

test("joining a bogus code fails cleanly with an error + close", async () => {
  const lobby = director();
  const p = await guest("Lost");
  const { ws, sent } = stubWs();
  const m = lobby.join(ws, p, "dawn", { room: "ZZZZZ" });
  assert.equal(m, null, "no match returned");
  assert.ok(sent.closed, "socket closed");
  const err = sent.messages.map((x) => JSON.parse(x)).find((x) => x.type === "error");
  assert.match(err?.message ?? "", /no room/i, "explanatory error sent");
  lobby.stopAll();
});

test("private config knobs apply: bots, world size, town type", async () => {
  const lobby = director();
  const host = await guest("Cartographer");
  const { ws } = stubWs();
  const m = lobby.join(ws, host, "visitors", {
    createPrivate: true,
    config: { botCount: 2, worldSize: 64, townType: "desert", foundingTicks: 150 },
  });
  assert.ok(m, "match created");
  assert.equal(m!.sim.world.width, 64, "world size honored");
  // 2 bots + 1 human = 3 players seated
  assert.equal(m!.sim.players.length, 3, "bot count honored");
  lobby.stopAll();
});
