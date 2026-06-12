# FLOCK

> Browser-first competitive territory strategy (.io) × asymmetric cult-builder.
> *OpenFront meets Cult of the Lamb — the first competitive multiplayer cult-builder.*

See **[DESIGN.md](./DESIGN.md)** — the Master Design Document v2.0 "The Complete Testament" — for the full specification. Tuning lives in **[balance.json](./balance.json)**, the single source of tuning truth (hot-patchable, §A).

## Repository layout

TypeScript monorepo (npm workspaces), per the technical spec (§32):

| Package | Role |
|---|---|
| [`packages/sim`](./packages/sim) — `@flock/sim` | Deterministic simulation core. Fixed-point Q16.16, seeded xoshiro RNG, the Intent protocol, and the lockstep StateHash. Runs **bit-identically** on client and server. |
| [`packages/server`](./packages/server) — `@flock/server` | Node 20 match host: Lobby Director + pinned Match Workers, lockstep turn loop, WSS transport. *(skeleton)* |
| [`packages/client`](./packages/client) — `@flock/client` | Vite + PixiJS web client: map renderer, client-side prediction, HUD. *(skeleton)* |

## Getting started

```bash
npm install
npm run build          # build all packages
npm test               # run the determinism CI gate (§40)
npm run dev:server     # run the server stub
npm run dev:client     # run the Vite client (http://localhost:5173)
```

## The determinism contract

The whole game rides on one invariant (§32, §40): **same seed + same Intents ⇒ same StateHash**, on every machine and browser. The sim therefore contains **zero floats, zero `Date`, zero `Math.random`** in sim scope — all math is fixed-point and all randomness flows through the seeded RNG in the turn stream. `packages/sim/test/determinism.test.ts` is the gate that protects this; if it ever fails, lockstep is broken and every downstream system is unsafe.

## Status

Scaffolding + verified `@flock/sim` foundation (fixed-point, RNG, Intent protocol, hashing, deterministic economy tick). Conversion resolution (§4), the match worker + netcode, and the PixiJS renderer are the next build-out targets — see the M0 milestone in [DESIGN.md §39](./DESIGN.md).
