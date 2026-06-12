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

## Status — M0 prototype playable

Implemented and covered by tests:

- **Sim core**: fixed-point Q16.16 (exact 53-bit range), seeded xoshiro RNG, full Intent protocol, StateHash, snapshot codec
- **Conversion (§4)**: fronts, pressure/resistance, ambient creep, attrition, apostate scars, deterministic flips
- **Economy (§3)**: logistic followers, per-tile tithe with district income + dissent tax, Faith drift, Heat, stance side-effects
- **Mapgen (§2)**: seeded districts (Downtown at centroid, quota Voronoi), woods/lake/roads, susceptibility rolls
- **Rituals (§9)** and the **Final Dawn kit (§11.1)**: Street Prophet, Stockpile Sermon, Prophecy Countdown
- **Match flow (§18)**: domination / last-standing / timer-tiebreak victory, elimination, frozen RECAP state
- **Lockstep netcode (§33)**: 100 ms Turn broadcast, hash checks, snapshot join/resync, rate limiting — verified end-to-end over live WebSockets with late-joins and bots
- **Drifter bots (§21)** playing through the Intent API, zero cheats by construction
- **Client**: PixiJS chunky-tile renderer with district tinting, HUD (leader %, prophecy countdowns, elimination/victory), click-to-front, stance hotkeys

Try it: `npm run dev:server` (env: `BOTS=6 WORLD=96`), then `npm run dev:client` and open two tabs.

Next (M1): remaining 3 archetype kits, doctrine tree, buildings/units/strikes, raids + Scandal, alliances/betrayal, Heat/CPA, client prediction, accounts/ranked — see [DESIGN.md §39](./DESIGN.md).
