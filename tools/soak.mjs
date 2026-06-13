/**
 * Load / desync soak test (§40): spin up N headless WebSocket clients against a
 * running FLOCK server, fuzz intents at the rate limit, and verify every
 * client's StateHash tracks the server's (desync SLA < 0.1% of matches). Also
 * a transport stress test for the rate limiter and the auth handshake.
 *
 * Usage: node tools/soak.mjs [clients=20] [seconds=15] [url=ws://localhost:8787]
 */

import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
import { loadBalance, step, hashState, fromSnapshot, newPlayer, IntentType } from "../packages/sim/dist/index.js";

const CLIENTS = Number(process.argv[2] ?? 20);
const SECONDS = Number(process.argv[3] ?? 15);
const SERVER_URL = process.argv[4] ?? "ws://localhost:8787";
const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));
const ARCHES = ["dawn", "radiant", "circle", "visitors"];

let desyncs = 0;
let hashChecks = 0;
let connected = 0;
let intentsSent = 0;

function spawnClient(i) {
  return new Promise((resolve) => {
    const arche = ARCHES[i % ARCHES.length];
    const ws = new WebSocket(`${SERVER_URL}/?name=Soak${i}&archetype=${arche}`);
    let sim = null;
    let playerId = 0;
    ws.on("open", () => connected++);
    ws.on("error", () => resolve());
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      switch (msg.type) {
        case "welcome":
          playerId = msg.playerId;
          sim = fromSnapshot(msg.snapshot);
          break;
        case "player_joined":
          sim?.players.push(newPlayer(msg.player.id, msg.player.archetype, balance));
          break;
        case "snapshot":
          sim = fromSnapshot(msg.snapshot);
          break;
        case "turn":
          if (sim) step(sim, msg.turn, balance);
          break;
        case "hash":
          if (!sim) break;
          hashChecks++;
          if (hashState(sim) !== msg.hash) {
            desyncs++;
            ws.send(JSON.stringify({ type: "resync" }));
          }
          break;
      }
    });

    // fuzz: spam intents (including garbage) up to ~the rate limit
    const fuzz = setInterval(() => {
      if (ws.readyState !== ws.OPEN || !playerId) return;
      const w = sim?.world?.width ?? 96;
      const center = ((Math.random() * w) | 0) + ((Math.random() * w) | 0) * w;
      const roll = Math.random();
      let intent;
      if (roll < 0.5) {
        const tiles = Array.from({ length: 25 }, (_, k) => center + (k % 5) + ((k / 5) | 0) * w);
        intent = { t: IntentType.OPEN_FRONT, player: playerId, tiles };
      } else if (roll < 0.7) {
        intent = { t: IntentType.SET_STANCE, player: playerId, stance: ["tend", "spread", "crusade"][(Math.random() * 3) | 0] };
      } else if (roll < 0.85) {
        // oversized garbage — the hardening must absorb it
        intent = { t: IntentType.OPEN_FRONT, player: playerId, tiles: Array.from({ length: 5000 }, () => (Math.random() * 1e9) | 0) };
      } else {
        intent = { t: IntentType.BUILD, player: playerId, building: "compound", tile: center };
      }
      ws.send(JSON.stringify({ type: "intent", intent }));
      intentsSent++;
    }, 55); // ~18/s, just under the 20/s limit

    setTimeout(() => {
      clearInterval(fuzz);
      ws.close();
      resolve();
    }, SECONDS * 1000);
  });
}

console.log(`soaking ${CLIENTS} clients × ${SECONDS}s against ${SERVER_URL} …`);
await Promise.all(Array.from({ length: CLIENTS }, (_, i) => spawnClient(i)));
const rate = hashChecks ? (desyncs / hashChecks) * 100 : 0;
console.log(`\nconnected=${connected}/${CLIENTS}  intents=${intentsSent}  hashChecks=${hashChecks}  desyncs=${desyncs} (${rate.toFixed(3)}%)`);
process.exit(desyncs === 0 ? 0 : 1);
