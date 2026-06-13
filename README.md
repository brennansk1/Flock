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

## Status — M0 complete, M1 gameplay + client + meta online

Implemented, deterministic, and covered by tests:

**Core (M0)**
- **Sim core**: fixed-point Q16.16 (exact 53-bit range), seeded xoshiro RNG, full Intent protocol, StateHash, snapshot codec
- **Conversion (§4)**: fronts, pressure/resistance, ambient creep, attrition, apostate scars, deterministic flips
- **Economy (§3)**: logistic followers, per-tile tithe with district income + dissent tax, Faith drift, Heat
- **Mapgen (§2)**: seeded districts, woods/lake/roads, susceptibility rolls, all 5 landmarks (§12) with passive effects
- **Match flow (§18)**: domination / last-standing / timer-tiebreak / Revelation-economic victory, elimination (satellites count), RECAP freeze
- **Lockstep netcode (§33)**: 100 ms Turns, hash checks, snapshot join/resync, rate limits — zero desyncs verified over live WebSockets with bots

**Gameplay (M1)**
- **Buildings (§6)**: the full table — Compounds, Plates, Watchtowers (fort_mult 5 + agent vision), Broadcast Towers, Hotlines (75% intercept), Print Shops, Garages, Supplement Labs
- **Units (§7)**: Tithe Couriers (robbable plate routes), Recruitment Vans (mobile pressure, courier robbery, agent screening), invisible Agents
- **The PvP trio (§13/§15)**: Deprogramming raids, Scandal evidence → 50% notify → Publish, Court Defection
- **Strikes (§8)**: Pamphlet Bomb, Prime-Time Exposé, Manifesto Drop — charge, 10s warning, hotline intercepts
- **Diplomacy (§16)**: alliances, JUDAS betrayal with permanent grudges, SCHISM risk gauge → sim-spawned Splinter Sects
- **Doctrine (§10)**: all 16 BITE nodes, milestone points, tier gating, every effect plumbed
- **All four archetype kits (§11)**: Final Dawn (Prophecy Countdown), Radiant Path (Glow/Cleanse/Retreat/Labs), Prosperity Circle (Downline/Blitz/Acquisition/Ledger), Visitors' Fellowship (Crop Circle/Static/Saucer satellites)
- **The CPA (§17)**: picket lines at Heat 60, Deprogrammer Bus at 85, Town Hall immunity below 75
- **Bots (§21)**: all three tiers — Drifter backfill, Sect utility-AI, and **Established Church** majors (behaviour tree: stance discipline, doctrine build order, border-rival grudges, scandal publishing; difficulty knob = cadence/aggression, never stat cheats), all via the Intent API in one unit-tested `bots.ts`

**Client & meta (M1 close-out)**
- **Client-side prediction + reconciliation (§33)**: a confirmed sim (hashed authority) + a predicted sim rebuilt each Turn with the local player's in-flight intents — instant feedback, rollback-free self-heal within one turn
- **Fog of war (§14)**: owned + radius, unit vision, allied vision; spectators see all
- **FOUNDING spawn-pick UI (§18/§26)**: pulsing rings on recommended high-susceptibility spawns; click to found
- **Recap Card (§25.1)**: deterministic 1080×1350 share card (built-in pixel font, archetype sigils, headline grammar, stat block, standings), shown center-stage at END with SAVE/REQUEUE; `tools/recapcard.mjs` renders a PNG headless
- **Ranked (§20)**: Glicko-2 (rating/RD/volatility, FFA pairwise decomposition, tier ladder, seasonal soft reset)
- **Progression (§22)**: XP/level curve, Relic earn band, level-5 ranked unlock — wired into a post-match `results` ticker

Try it: `npm run dev:server` (env: `BOTS=6 CHURCHES=2 WORLD=96`), then `npm run dev:client` and open two tabs. In-match keys: 1/2/3 stances · QWER rituals · D/F archetype actives · G signature · B/T/C/Y/U/H build · A raid · X snoop · P publish · K strike · V van · O/I diplomacy.

Remaining (external infra/content, not deterministic sim logic): hosted accounts + rating persistence + moderation pipeline (§22/§34), Congregations/Daily Prophecy backends (§23/§24), Steam/Electron wrap (§35), and the audio + pixel-art asset production passes (§30/§31). See [DESIGN.md §39](./DESIGN.md).
