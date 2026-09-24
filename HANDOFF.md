# FLOCK — Brownfield AI Handoff & Architecture Briefing

> **Target Agent**: Claude Opus 5.5 (Claude Code Sandbox Environment)  
> **Budget / Credit**: $250 allocated credit pool  
> **Repository**: [brennansk1/Flock](https://github.com/brennansk1/Flock)  
> **Role**: Lead Systems Architect & Game Director  
> **Verification Gate**: `npm test` (135 tests + 75-world mapgen audit passing with 0 violations)

---

## 1. Executive Mission Briefing

You are stepping into a working, highly tested TypeScript monorepo (~20k LOC) implementing **Flock**, a browser-first competitive multiplayer (.io) cult-building strategy game combining the territory tension of *OpenFront* / *Galcon* with the asymmetric faction flavor of *Cult of the Lamb*.

Your mission is to transition this brownfield codebase into a **commercially successful, highly marketable, and genuinely sellable indie game**. The game must be designed not just to function, but to sell: it needs spectator-friendly visual juice, intuitive UI/UX, deep retention loops, and an extensible architecture ready for live-ops monetization (cosmetic skins for vehicles/buildings/cultists and modular pluggable new cult archetypes).

---

## 2. Core Mandates & Creative Authority

### 2.1 Total Creative Freedom & Autonomous Decision-Making Authority
The user has granted you **complete creative freedom, extensive refactoring/redesign authority, and full decision-making responsibility**:
* **Docs are a Launchpad, Not Rigid Rails**: Treat the existing planning documents in `docs/` as an informed baseline. You possess frontier reasoning capabilities across large codebases and are expected to exercise your own architectural judgment.
* **Full Permission to Redesign Everything**: You have full license to redesign the **strategy menus, HUD layout, player input models, economic balance formulas, civics, combat systems, or underlying engine architecture** if you identify a more fun, elegant, or immersive solution. Do not feel bound by legacy UI components or current balance numbers.
* **Make All Decisions Yourself (Do NOT Save Tasks or Choices for the User)**: You are the Game Director and Lead Architect. Make all technical, balance, architectural, and design decisions yourself. Do NOT ask the user to choose between options, do NOT present multiple-choice questionnaires, and do NOT leave design tasks pending for user decisions. Evaluate the tradeoffs, decide on the best approach, and implement it. The milestone checkpoint pauses are strictly for the user to monitor token/dollar spend and approve proceeding to the next stage, not to make micro-decisions on implementation details that you should decide.

### 2.2 The Five Non-Negotiable Anchors
Whatever you refactor or redesign, you must honor five foundational pillars:
1. **RTS Gameplay on an Authentic 1980s Town Map with Multiple Map Archetypes**: The core game MUST remain a real-time strategy (RTS) game played on a living map of an American small town in that authentic 1980s aesthetic (*Stranger Things* / Hawkins, Indiana era, ~1983–1986). It must support **multiple maps** (diverse procedural town archetypes, varied regional geographies, topographies, and layouts—such as farming communities, lakeside towns, desert settlements, mountain valleys, and coastal fishing ports—all sharing that cohesive 1980s small-town visual language).
2. **The 1980s American Small-Town Aesthetic**: The game world must authentically evoke the nostalgic, slightly eerie charm of 1980s Americana with recognizable architecture, an 80s vehicle fleet, authentic natural environments, rich variants, and dynamic micro-animations.
3. **Best Game Design Principles**: Deep strategic decision trees, asymmetric faction identities, anti-snowballing/anti-stalemate mechanics, transparent telegraphing, high replayability, and strong retention.
4. **Token-Efficient Execution**: Programmatic bulk sprite authoring in code, Dual-Harness Visual QA (Studio Blank Slate vs. In-Situ Map Crops), and pausing at stage checkpoints.
5. **100% Lockstep Determinism**: All simulation math must remain bit-identical across clients (zero floating-point divergence, zero unseeded PRNG, zero network desyncs). `npm test` must always pass cleanly.

### 2.3 Subagent Concurrency & Delegation Guardrails
When delegating tasks to subagents in Claude Code:
* **Max 2 Concurrent Subagents**: You may spawn a **maximum of 2 subagents at any given time**. Never exceed 2 active subagents simultaneously to maintain token budget control and oversight.
* **Strict Domain Separation (Zero File Overlap)**: Subagents must operate on completely distinct files, packages, and architectural surfaces (e.g., Subagent 1 on `packages/sim/` and Subagent 2 on `packages/client/`). They must **never** edit or write to the same files concurrently, eliminating race conditions and merge conflicts.
* **No Recursive Delegation**: Subagents must be explicitly instructed **never to spawn subagents of their own**. All delegation is strictly single-tier (Parent Lead Agent $\to$ Worker Subagent).

### 2.4 Commercial Viability & Extensible Monetization Architecture (Marketability, Skins & New Cults)
Flock is being built not as a raw tech demo, but as a **commercially viable, highly marketable, sellable indie strategy title** that can sustain long-term player interest and commercial expansion:
* **Marketable & Streamable Gameplay**:
  * The game must have immediate visual punch and "spectator clarity" (crisp animations, recognizable 1980s town elements, dramatic front clashes, viral recap cards).
  * Onboarding and UX must be friction-free: an intuitive strategy menu and responsive HUD that makes complex asymmetric RTS mechanics instantly understandable to new players.
* **Pluggable Cosmetic Skin Architecture**:
  * The architecture must cleanly decouple cosmetic visual identifiers (vehicle liveries, van decals, commune compound architecture, cultist attire/robes, flag banners) from simulation logic.
  * Cosmetics must be cosmetic-only: they must never alter simulation math or introduce network desyncs. The client renderer should accept player skin loadouts seamlessly.
* **Modular Cult Archetype Registry (DLC & Expansion Ready)**:
  * Do NOT hardcode cult behaviors in monolithic switch-statements across the codebase.
  * Structure cult archetypes around a modular registry interface (`ArchetypeDefinition`: passives, signature rituals/abilities, doctrine affinity trees, and visual themes).
  * This ensures the codebase can easily scale post-launch by dropping in new cult archetypes (expansions, seasonal DLC, themed updates) with zero friction.

---

## 3. Strategic Priority Hierarchy

```
+-------------------------------------------------------------------------+
| PRIORITY #1: Strategy, Menus & Core Gameplay Overhaul                   |
| - Deeper strategic decision trees & asymmetric faction identities       |
| - Modernized, intuitive strategy menu & reactive HUD controls           |
| - Robust anti-snowballing, comeback mechanics & clear win conditions     |
| - Seamless player onboarding & high retention loops                     |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| PRIORITY #2: 1980s Small-Town Worldgen, Bulk Sprites & Living Town      |
| - Hawkins-era Americana (~1983-1986) morphology & recognizable landmarks |
| - Strict Urban Placement Grammar (frontage, driveways, zoning buffers)  |
| - Visual Variants per building & vehicle (no clone-stamp uniformity)    |
| - Deterministic Dynamic Micro-Animations (rivers, lights, smoke, bikes) |
+-------------------------------------------------------------------------+
```

---

## 4. Key Engineering & Design Specs

Before modifying code, familiarize yourself with the canonical documentation suite:

| Document | Path | Core Contents |
| :--- | :--- | :--- |
| **Engineering Constitution** | [`CLAUDE.md`](./CLAUDE.md) | Governing rules, creative freedom mandate, dual-QA spriting, cost checkpoint protocol. |
| **Master Asset Catalog** | [`docs/ASSETS.md`](./docs/ASSETS.md) | Complete inventory of all 121 assets, animation modes, frames, 1980s visual signatures, variants, and code links. |
| **Procedural Worldgen** | [`docs/WORLDGEN.md`](./docs/WORLDGEN.md) | 10-stage mapgen pipeline, town archetypes, seasonal palettes, §6.4 Urban Placement Grammar, §8.2 Variants, §8.3 Micro-Animations. |
| **Master Game Design** | [`docs/GAME_DESIGN.md`](./docs/GAME_DESIGN.md) | Ground-truth economic formulas, 4 cult archetypes, BITE doctrines, combat front resolution, Heat escalation. |
| **SDD & Modernization Roadmap** | [`docs/ROADMAP_SDD.md`](./docs/ROADMAP_SDD.md) | 5-stage budgeted roadmap, $250 credit allocation, REASONS canvas, §4 Bulk Sprite & Dual-QA strategy. |
| **Systems Architecture** | [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Monorepo layout, 100ms lockstep wire protocol, dual-sim prediction, Glicko-2 ratings, developer tooling harness. |
| **Curated Visual Audit** | [`docs/VISUAL_AUDIT.md`](./docs/VISUAL_AUDIT.md) | Benchmark visual gallery across archetypes, seasons, and day/night cycles. |

---

## 5. Token-Efficient Bulk Sprite Authoring & Dual-QA Pipeline

To generate and polish large asset suites with high visual quality while conserving your token budget:

1. **Declarative Programmatic Authoring (No Conversational Dumps)**:
   * Write compact character matrices and procedural rendering logic directly in [`packages/sim/src/townRender.ts`](./packages/sim/src/townRender.ts) and [`packages/sim/src/palette.ts`](./packages/sim/src/palette.ts).
   * **Never dump large raw ASCII or coordinate blocks into chat context.** Keep code edits surgical and modular.
2. **Dual-Harness Visual QA**:
   * **Harness A (Studio View / Blank Slate)**: Run `node tools/spritesheet.mjs` or `node tools/generate_catalog_inspection.mjs`. Renders new assets in an isolated grid on dark slate (`#181512`) at $8\times$ zoom with 1px grid guides. Inspect via your image viewing tool to verify silhouette readability, contrast, and 1px panel seams in isolation.
   * **Harness B (In-Situ View / Procedural Map Context)**: Run `node tools/generate_curated_suite.mjs` on benchmark seeds (11, 42, 77) across seasons. Crop focal zones (Downtown Square, High School Campus, Suburban Cul-de-Sacs, Rail Siding, Waterways) to verify that buildings sit naturally on roads, align with sidewalks/curb cuts, respect zoning buffers, and blend into seasonal foliage.
3. **Automated Fast-Fail Invariant Linting**:
   * Run `npm test` to verify pixel dimensions, palette color mappings, and physical setback rules (no non-exempt structures on water, 6-tile zoning buffer) before image generation, preventing token waste on buggy iterations.
4. **Themed Batch Execution**:
   * Execute in themed batches (Vehicles $\to$ Downtown/Commercial $\to$ Residential/School $\to$ Industrial/Rural $\to$ Hydrology/Foliage).

---

## 6. Developer Tooling Suite (CLI Scripts in `tools/`)

You have access to a rich suite of headless Node.js CLI tools in `tools/`, and **full permission to create new custom tools in `tools/` as you go**:

| Tool Script | Execution Command | Purpose |
| :--- | :--- | :--- |
| `tools/audit_mapgen.mjs` | `node tools/audit_mapgen.mjs` | 75-world automated invariant audit across all 5 archetypes. |
| `tools/generate_curated_suite.mjs` | `node tools/generate_curated_suite.mjs` | Generates 17 high-res benchmark PNG images into `docs/assets/curated/`. |
| `tools/generate_catalog_inspection.mjs` | `node tools/generate_catalog_inspection.mjs` | Dual-view studio (blank slate) and in-game map crop for catalog assets. |
| `tools/spritesheet.mjs` | `node tools/spritesheet.mjs` | Renders live building, lot, and landmark sprites on isolated dark slate. |
| `tools/vehicle_spritesheet.mjs` | `node tools/vehicle_spritesheet.mjs` | Renders vehicle silhouettes, directions, and color variants. |
| `tools/botleague.mjs` | `node tools/botleague.mjs 200` | Headless 200+ match tournament runner testing win-rate parity. |
| `tools/soak.mjs` | `node tools/soak.mjs 20 15` | Headless 20-client lockstep stress tester detecting desyncs. |
| `tools/mapmetrics.mjs` | `node tools/mapmetrics.mjs farm 96` | Computes Shannon entropy of zoning, road connectivity ratios, parcel metrics. |
| `tools/create_animated_town_gif.mjs` | `node tools/create_animated_town_gif.mjs` | Assembles multi-frame animated GIFs of living town activity. |
| `tools/recapcard.mjs` | `node tools/recapcard.mjs` | Generates 1080×1350 post-match social recap cards. |
| `tools/xbrowser_determinism.mjs` | `node tools/xbrowser_determinism.mjs` | Verifies bit-identical simulation StateHash across JS runtimes. |

---

## 7. Cost Self-Awareness & Stage Checkpoint Protocol

You do not have intrinsic real-time awareness of dollar spend in the sandbox. Therefore, **you must execute work in distinct stages and pause for user feedback**:

* **Mandatory Checkpoint**: At the conclusion of each planned milestone/stage:
  1. Halt tool execution.
  2. Verify all tests pass (`npm test`).
  3. Output a **Stage Checkpoint Card**:
     ```markdown
     --- MILESTONE CHECKPOINT: [Stage Name] ---
     - Summary of Completed Work: [Key features / refactors completed]
     - Verification: npm test passing (100% Invariants Met: 135 tests + 75 worlds)
     - Estimated Stage Token Spend: ~$XX (Remaining estimated credit: ~$YY)
     - Next Planned Stage: [Description of Stage N+1]
     > Awaiting confirmation. Please share current Claude Code balance and reply 'PROCEED' or provide priority adjustments.
     ```
  4. Wait for the user's prompt before initiating the next stage. This keeps the $250 credit pool under strict user control.

---

## 8. Five-Stage Budgeted Execution Plan

Refer to [`docs/ROADMAP_SDD.md`](./docs/ROADMAP_SDD.md) for full task breakdowns:

* **Stage 1 ($60 budget) — Strategy, Menus & Core Gameplay Overhaul (Priority #1)**:
  * Complete redesign of strategy menus, HUD layout, and input responsiveness.
  * Asymmetric cult depth, counter-play telegraphing, anti-snowballing mechanics.
  * Win condition clarity, tutorial/onboarding hooks, and competitive pacing.
* **Stage 2 ($55 budget) — 1980s Worldgen, Placement Grammar & Micro-Animations (Priority #2)**:
  * Urban Placement Grammar: strict frontage to streets, driveways with curb cuts, backyards in perimeter blocks, zoning separation buffers.
  * Deterministic dynamic micro-animations (river ripples, ocean surf foam, police lights, bus hazards, radio beacons, winter chimney smoke, grazing livestock, stepping residents and BMX bikes).
* **Stage 3 ($45 budget) — Bulk Asset Spriting & Dual-QA Pipeline**:
  * Implement full 121-asset catalog variants and 1980s Hawkins signatures.
  * Dual-QA inspection via Studio View (`tools/spritesheet.mjs`) and In-Situ View (`tools/generate_curated_suite.mjs`).
* **Stage 4 ($45 budget) — GOAP Bot AI & Meta Systems Overhaul**:
  * Goal-Oriented Action Planning (GOAP) bot brains with asymmetric playstyles.
  * Progression meta, Daily Prophecies, recap card generation, lobby polish.
* **Stage 5 ($45 budget) — Commercial Polish, Performance & Production Hardening**:
  * 60 FPS client rendering optimization, soak testing (0 desyncs over 100k ticks), tournament balance verification via `tools/botleague.mjs`.

---

## 9. First Action Upon Boot

When starting your session:
1. Run `npm test` to verify the baseline test suite (`135 / 135` tests passing + `75 / 75` world mapgen audit passing with 0 violations).
2. Review [`docs/ROADMAP_SDD.md`](./docs/ROADMAP_SDD.md) §2 (Stage 1 Specification) and [`docs/GAME_DESIGN.md`](./docs/GAME_DESIGN.md).
3. State your decided **Stage 1 Architectural & Gameplay Execution Plan** (outlining the exact decisions you have made as Game Director for the menu, HUD, and strategy overhaul—do NOT ask the user to pick between design options or save tasks for them).
4. Pause, report repository health, and await the user's initial confirmation to begin execution.
