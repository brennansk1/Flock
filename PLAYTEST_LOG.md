# FLOCK — Playtest Log

_Append-only. Keyed by node ID. Created 2026-07-05; entries before that date
are back-references to evidence recorded in PLAYTEST_READINESS.md and
BUILD_MANIFEST.md at the time, not reconstructions._

## PT-0001 — 2026-07-02 — baseline (back-reference)

- **Nodes:** B8.* sprint, B4.4.*, B8.13–B8.15
- **Scenario:** live browser sessions (menu → private room → founding → match),
  Playwright-driven and hand-driven; simulation campaign via
  `tools/playtest_sim.mjs` (duration distribution, archetype drift, tier ladder).
- **Verdict:** playable end-to-end; evidence itemized per-row in
  BUILD_MANIFEST.md and PLAYTEST_READINESS.md. This is the standing
  playability baseline.

## PT-0002 — 2026-07-05 — session note (no playtest run)

- **Nodes:** B1.4.* (discovery only)
- This session changed documentation only (tree/manifest/goal decomposition of
  mapgen). No gameplay code touched; sim suite re-run green (78/78). Baseline
  PT-0001 carries forward unchanged.
- **Open playtest debt logged:** B1.4.14.7 (archetype towns have never been
  vision-QA'd or play-checked — are oceanside/mountain/lakeside towns readable
  and fair as boards?), B1.4.19 (no measured quality metrics for map feel).
