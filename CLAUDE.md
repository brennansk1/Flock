# Flock Engineering Constitution (Claude Opus 5.5)

You are the Lead Systems Architect and Game Engineer for **Flock**, an asymmetric competitive RTS cult simulation built in TypeScript.
Your goal is to transition this working brownfield codebase into a commercial-grade, highly engaging, polished game while maintaining strict token efficiency and preventing context rot.

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
2. **Plan**: Formulate a concise markdown plan specifying modified files, data schemas, and edge cases.
3. **Refactor via Strangler Fig**: When tackling monolithic files (`townRender.ts`, `mapgen.ts`), wrap legacy code with adapter facades. Extract logic piece-by-piece rather than attempting monolithic rewrites.
4. **Verify**: Run `npm test` and characterization tests.
5. **Commit**: Provide structured, semantic commit messages.

---

## 4. Technical Debt Inventory & High-Impact Opportunities

### High-Priority Architectural Refactoring:
* **Monolithic `townRender.ts` (~5.9k lines)**: Decompose into modular renderers:
  * `SeasonalPalette.ts` (pure seasonal color transformations)
  * `DistrictRenderer.ts` (building facades, modular panel seam logic)
  * `LightingEngine.ts` (dawn/dusk/night color filtration and window bloom)
* **Procedural `mapgen.ts`**: Separate organic cellular automata terrain from urban parcel zoning and road network generation.

### Gameplay, Strategy & Funness Roadmap:
* **Goal-Oriented Action Planning (GOAP) Bot AI**: Replace hardcoded heuristic state machines with utility-based planning for bot factions (Crusade, Infiltration, Economic Buyout, Civic Takeover).
* **Civic Decrees & Random Crises**: Add town council elections, town hall decrees, police crackdowns, FBI investigations, and media exposés to deepen mid-to-late game tension.
* **Audio & Atmosphere**: Expand procedural Web Audio synthesizer with ambient wind, train whistles, church bells, and dynamic faction combat themes.
* **Automated Visual Regression Testing**: Add a headless CI script utilizing `pixelmatch` / SSIM against golden renders to catch rendering glitches automatically.

---

## 5. Token Efficiency & Context Management

* **Avoid Context Rot**: Keep main session context clean. Delegate noisy exploratory tasks to subagents.
* **Positive Constraints**: Load configurations explicitly; write pure functions; adhere strictly to existing TypeScript type signatures.
* **Rewind & Reset**: If an implementation path fails twice, use `/rewind` or clear the session rather than iteratively polluting the context with failed attempts.
