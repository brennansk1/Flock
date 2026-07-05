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

## PT-0003 — 2026-07-05 — archetype playtest campaign + spatial Depth Review

- **Nodes:** B1.4.14.* (playability), B1.4 spatial-depth axis (GOAL.md target: DEEP)
- **Scenario:** first matches ever run on §2A archetype worlds. 30 full bot
  matches (5 townTypes × 6 seeds, 4 sect bots, 96², 12-min timer, live
  domination threshold), founding via the PRODUCTION `spawnTileFor` spiral
  (mirrored from matchWorker.ts into tools/archetype_playtest.mjs).
- **Fantasy check:** P1 (readable board) + "mapgen is a gameplay system, not
  scenery" (GOAL.md spatial contract).

### Playability verdict: FEELS RIGHT (bot-verified floor)

- **Founding: 30/30 matches, 4/4 players spawned on every archetype.** The
  spawn-ring anchors land in the sea/forest on oceanside/mountain worlds and
  the spiral recovery finds valid ground every time. No stalls, no orphaned
  players.
- **Completion: 30/30 ended with a winner** (early dominations at 4.5–9.5 min
  plus points-wins at the timer). No degenerate non-endings on any archetype.
- Harness label fix applied: `sim.winner` is set on both the domination and
  timer paths; only pre-timer wins are now reported as DOMINATION.

### Spatial Depth Review (axes scored vs DEEP target)

1. **Decision count — DEEP (pass).** The base town generates real spatial
   decisions: founding placement (fringe safety vs town reach), front
   targeting across 8 district coefficient profiles, road-net usage
   (fronts must cross roads; couriers 2×, vans 4× on pavement; lakes block
   vans), landmark timing (Megachurch victory, Town Hall heat shield,
   Fairground discounts), civics targeting, escalating property buys.
2. **Meaningful tradeoffs — DEEP (pass).** District coeffs trade conversion
   speed vs retention vs income per tile; roads accelerate you AND your
   rivals' counterpress; near-town founding earns reach but heat/exposure.
3. **Emergence — MODERATE-DEEP (pass).** Civics × conversion, outreach ×
   property, road grid × van play compose without scripting.
4. **Archetype differentiation — LIGHT (finding, not a fail).** `Biome.*`
   appears in ZERO gameplay engines; pier/sawmill/cannery/lighthouse have no
   mechanics. Archetypes differentiate only through land geometry — which IS
   measurable: median converted tiles at match end ranged 267 (desert) → 350
   (farm) → 394 (oceanside) → 517 (lakeside). Compressed land = denser
   targets = faster spread. Real but thin.
5. **Anti-degenerate — WATCH.** Median lead share 0.94–0.98 in same-tier bot
   mirrors: the winner takes nearly everything. Snowball may be a bot-play
   artifact (no human counterplay, no diplomacy use); flagged for the human
   playtest node (B7.9), not chargeable to the map.

**Verdict: spatial axis PASSES its DEEP target on the base town.** The
archetype sub-axis is LIGHT by design today; "archetype mechanical identity"
(harbor economy, timber income, oasis water politics, landmark-grade pier/
sawmill effects) is filed as an explicit EXTEND candidate — B1.4.20 — NOT
built now. Adding mechanics before human playtests would violate restraint;
the geometry already plays.
