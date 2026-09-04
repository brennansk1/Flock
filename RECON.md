# RECON — session 2026-07-05 (mapgen deep-decomposition)

## Baseline (re-verified this session)

- `npm run build` clean; `npm test` → **sim 78/78 pass** (mapgen gates included:
  orthogonality, naming determinism, pop floor, keystones, frontage, biomes,
  rail/elevator/depot, farm-belt, snapshot round-trip, name purity).
- Playability baseline: the 2026-07-02 playtest-readiness sprint (B8.*) with
  live browser verification; no gameplay code is modified this session
  (documentation/discovery only), so the baseline carries forward.

## Blast radius (this session)

Discovery-only: BUILD_TREE.md, BUILD_MANIFEST.md, GOAL.md, PLAYTEST_LOG.md.
No `.ts` files touched. In-scope code inventoried (read, not modified):

- `packages/sim/src/mapgen.ts` (2,391 lines) — `generateWorld` runs a
  24-stage ordered pipeline inside a ≤5-attempt pop-floor retry loop
  (mapgen.ts:142–303). Stage order is load-bearing (e.g. nature before farms,
  QA S1-B) and is itself a contract.
- `packages/sim/src/gridRoads.ts` (306 lines) — street grid: highway/Main St,
  county route, avenues, streets, cul-de-sacs, rural section-line roads,
  elbow fill, street-segment registry.
- `packages/sim/test/mapgen.test.ts` — 11 named invariant gates (all green).
- Render side (`townRender.ts`) is B5.2's domain; mapgen leaves cross-reference
  it rather than duplicate it.

## Findings

1. **Town archetypes (§2A: oceanside / mountain / lakeside / desert) are
   implemented in code (`applyTownArchetype`, mapgen.ts:826) but appear
   nowhere in the Build Tree, have zero dedicated tests, and zero QA-gallery
   render evidence.** Silent, undocumented feature — exactly what the
   framework forbids. Entered as B1.4.14.* (✅ at best, with ⬜ QA leaves).
2. Several inline pipeline blocks (industrial rail spur, trailer court, Main St
   alleys, quarry scar — all inline in `generateWorld`) were invisible in the
   old 13-child tree. Now leaves.
3. No explicit **quality metrics** exist for mapgen beyond pass/fail invariants
   (farm-share % is the only measured quality property). PROCGEN rule §4
   violation → new ⬜ node B1.4.19.
4. MAPGEN.md (the prose doc) is partly speculative/stale: it describes
   LCG/Perlin/cellular-automata and "seasonal variations" that do not match
   the actual xoshiro + blob/blockgrid code. The tree below is derived from
   code, not from MAPGEN.md.

## NO_TOUCH (standing)

- 🔒 Determinism substrate (T.2.*), snapshot codec (T.5), wire protocol (B3.9)
  — mapgen changes must never alter these except via an explicit
  contract-locked node (as B1.4.5/v7 and B1.4.10/v8 did).
- 🔒 The 8px single-LOD style contract (STANDARDS_MAPGEN.md §0) — QA judges
  generation/placement, never the pixel idiom.
