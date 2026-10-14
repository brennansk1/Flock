# FLOCK

> Browser-first competitive territory strategy (.io) × asymmetric cult-builder.  
> *OpenFront meets Cult of the Lamb — the first competitive multiplayer cult-builder.*

Tuning lives in **[`balance.json`](./balance.json)**, the single source of tuning truth (hot-patchable).

---

## Documentation Index

Comprehensive engineering and design specifications live in **[`docs/`](./docs/)**:

* **[Brownfield AI Handoff](HANDOFF.md)**: Master briefing document, creative freedom mandate, stage milestones, and onboarding protocol for Claude Opus 5.5.
* **[Systems Architecture](docs/ARCHITECTURE.md)**: Monorepo layout, deterministic lockstep simulation protocol, typed arrays, and desync detection.
* **[Procedural World Generation](docs/WORLDGEN.md)**: 10-stage procedural generation pipeline, town archetypes, seasonal systems, diurnal lighting, and invariant assertion suites.
* **[Master Game Design](docs/GAME_DESIGN.md)**: Master design vision, 4 asymmetric cult archetypes, core gameplay loops, civic decrees, and Heat escalation.
* **[SDD & Modernization Roadmap](docs/ROADMAP_SDD.md)**: Spec-Driven Development handbook, REASONS canvas, GOAP Bot AI, UI/UX overhaul, and commercial feature backlog.
* **[Technical Debt Inventory](docs/TECHNICAL_DEBT.md)**: Monolithic complexity analysis, cognitive complexity hotspots, and Strangler Fig refactoring blueprints.
* **[Master Asset Catalog](docs/ASSETS.md)**: 121 catalog assets across 9 categories, animation modes, frames, 1980s visual signatures, and variants.
* **[Curated Visual Audit](docs/VISUAL_AUDIT.md)**: Curated benchmark gallery showcasing town archetypes, seasonal shifts, lighting passes, and micro-details.
* **[Operations & Deployment](docs/DEPLOYMENT.md)**: Production hosting, Docker orchestration, and environment configuration.
* **[Engineering Constitution](CLAUDE.md)**: Governing operational mandates for AI-assisted development.

---

## Monorepo Layout

FLOCK is organized as an npm workspace monorepo:

| Package | Role |
|---|---|
| [`packages/sim`](./packages/sim) (`@flock/sim`) | Pure deterministic simulation core. Fixed-point Q16.16 arithmetic, seeded RNG, Intent protocol, StateHash calculation, bot brains, and procedural town renderer. Runs bit-identically on client and server. |
| [`packages/server`](./packages/server) (`@flock/server`) | Authoritative Node.js 22 match host: WebSocket turn relay, lockstep coordinator, lobby director, account persistence, and Glicko-2 matchmaking. |
| [`packages/client`](./packages/client) (`@flock/client`) | Vite + Canvas / PixiJS web client: procedural town rendering, client-side input prediction, Web Audio synthesizer, and reactive HUD. |

---

## Quickstart

```bash
npm install
npm run build          # Build all workspaces
npm test               # Run unit, integration, and 75-world mapgen audit
FLOCK_SECRET=dev-secret-please-change npm run dev:server
npm run dev:client     # Access client at http://localhost:5173
```

---

## The Determinism Contract

The entire game relies on one invariant: **same seed + same Intents $\Rightarrow$ same StateHash** across all machines and browsers. The simulation contains zero floats, zero `Date`, and zero `Math.random()` in sim scope. All random events flow through the seeded `RngState`. `test/snapshot.test.ts` and `test/mapgen.test.ts` enforce this gate continuously.
