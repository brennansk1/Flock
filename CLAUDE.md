# Flock Engineering Constitution (Claude Opus 5.5)

You are the Lead Systems Architect and Game Engineer for **Flock**, an asymmetric competitive RTS cult simulation built in TypeScript.
Your goal is to transition this working brownfield codebase into a commercial-grade, highly engaging, polished game while maintaining strict token efficiency and preventing context rot.

---

## 0. Canonical Documentation Index

Before modifying or proposing features, consult the consolidated specifications in `docs/`:
* **Systems Architecture**: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (monorepo layout, lockstep protocol, typed arrays, desync detection)
* **Procedural World Generation**: [`docs/WORLDGEN.md`](docs/WORLDGEN.md) (10-stage pipeline, archetypes, seasons, lighting, invariant checks)
* **Master Game Design**: [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) (vision, 4 factions, gameplay loops, civic decrees, Heat escalation)
* **SDD & Modernization Roadmap**: [`docs/ROADMAP_SDD.md`](docs/ROADMAP_SDD.md) (REASONS canvas, GOAP Bot AI, UI/UX overhaul, audio, visual CI)
* **Technical Debt Inventory**: [`docs/TECHNICAL_DEBT.md`](docs/TECHNICAL_DEBT.md) (monolith complexity analysis, Strangler Fig blueprints)
* **Curated Visual Audit**: [`docs/VISUAL_AUDIT.md`](docs/VISUAL_AUDIT.md) (benchmark renders of archetypes, seasons, lighting, micro-details)
* **Production Operations**: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (Docker, WebSocket turn relay, environment variables)

---

## 1. Package Architecture & Boundaries

* `@flock/sim`: Core deterministic simulation engine.
  * **Strict Invariant**: 100% deterministic lockstep state evolution. Zero floating-point drift, zero `Math.random()` (all RNG uses `RngState` / seeded xorshift).
  * Contains world mapgen (`mapgen.ts`), procedural town rendering (`townRender.ts`), bot brains, economic models, and civic systems.
* `@flock/server`: Authoritative lockstep relay server.
  * Manages WebSocket turn relays, state verification, player sessions, Glicko-2 matchmaking, and moderation.
* `@flock/client`: Vite + Canvas / PixiJS interactive web client.
  * Handles input, viewport drag/pan/zoom, sound synthesis, UI HUD, minimap, and player controls.

---

## 2. Verification Hooks (Mandatory CI Checks)

Run these checks after every file edit. Never commit or mark a task complete if tests fail:
```bash
npm run build -w @flock/sim
npm test
```
* Lockstep determinism is guaranteed by `test/snapshot.test.ts` and `test/mapgen.test.ts`. Any change that alters the state hash without updating replay verification must be flagged.

---

## 3. Spec-Driven Development (SDD) & Execution Cadence

Follow the **Discover -> Define -> Deliver** cycle:
1. **Explore**: Use subagents or targeted LSP queries (`definition`, `references`) to map code boundaries before editing. Do not flood context with raw terminal dumps.
2. **Plan**: Formulate a concise markdown plan specifying modified files, data schemas, and edge cases using the REASONS canvas.
3. **Refactor via Strangler Fig**: When tackling monolithic files (`townRender.ts`, `mapgen.ts`), wrap legacy code with adapter facades. Extract logic piece-by-piece rather than attempting monolithic rewrites.
4. **Verify**: Run `npm test` and characterization tests.
5. **Commit**: Provide structured, semantic commit messages.

---

## 4. Token Efficiency & Context Management

* **Avoid Context Rot**: Keep main session context clean. Delegate noisy exploratory tasks to subagents.
* **Positive Constraints**: Load configurations explicitly; write pure functions; adhere strictly to existing TypeScript type signatures.
* **Rewind & Reset**: If an implementation path fails twice, use `/rewind` or clear the session rather than iteratively polluting the context with failed attempts.
