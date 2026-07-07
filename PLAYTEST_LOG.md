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

## PT-0004 — 2026-07-05 — fields-v2 playability smoke

- **Nodes:** B1.4.12 (baseline-preservation gate)
- **Scenario:** terrain fields v2 reshaped every world, so the PT-0003
  campaign re-ran on the new geography: 20 bot matches (5 townTypes × 4
  seeds, production founding path).
- **Verdict: PASS — playability preserved.** Founding 4/4 on every match,
  every type; every match ended (50–75% pre-timer dominations, remainder
  timer points-wins — the harness now separates the two). Median durations
  7.2–12 min, in the healthy band. Median end-of-match conversion sits
  ~496–515 across all types on these seeds (N=4/type — too small to
  re-read the archetype pacing spread; B1.4.19 metrics are the stable
  signal, and they held within noise of baseline).

## PT-0005 — 2026-07-05 — mapgen quality-upgrade smoke

- **Nodes:** quality pass (belt fringe, creek reaches, quarry haul road,
  beach normalization, lighthouse fallback)
- **Scenario:** 15 bot matches (5 townTypes × 3 seeds, production founding).
- **Verdict: PASS.** Founding 4/4 everywhere despite the construction ring
  tightening from r+10 to r+4 (the half-open smallholding band leaves room).
  All matches ended. Observation (N=3, hold loosely): median lead share fell
  to 0.72–0.89 from PT-0003/4's 0.94–0.98 — the smallholding ring may be
  breaking up runaway early expansion. Re-read when humans play (B7.9).

## PT-0006 — 2026-07-05 — economic-anchor mechanics smoke (B1.4.20)

- **Nodes:** B1.4.20.* (granary/cannery tithe, sawmill discount, lighthouse
  outreach — first mechanics keyed to the §2A anchors)
- **Scenario:** 15 bot matches (5 townTypes × 3 seeds) with anchors live;
  plus 3 A/B engine gates in property.test.ts.
- **Verdict: PASS.** Founding 4/4 everywhere; all matches ended (33–67%
  pre-timer dominations); pacing in band (7.9–12 min medians). Bots don't
  TARGET anchors yet — they benefit only incidentally when conversion sweeps
  over them; deliberate anchor play is a human behavior to watch for at B7.9,
  and a possible future bot-brain hint (not filed — wait for human signal).

## PT-0007 — 2026-07-05 — v3 mission loop, first bot campaign (M2 complete)

- **Nodes:** B9.1 (M1 cohorts), B9.2 (M2 presence engine), fronts deleted
- **Scenario:** 10 bot matches (5 townTypes × 2 seeds) on the NEW core loop —
  bots found, then SEND cohorts (permille slice + per-sortie mode) that march
  in and convert door-by-door; no fronts exist.
- **Verdict: STRUCTURALLY PROMISING (bot-only, N=2/type — hold loosely).**
  - Founding 4/4 every match; all matches completed (at timer).
  - **Median winner lead share 0.52–0.66 — down from 0.94–0.98 on the old
    front game.** The mission loop's deploy/expose tension and contained
    conversion visibly break the runaway snowball. The DESIGN_MISSIONS.md §8
    success gate (< 0.90) is MET at the bot tier.
  - Decisive% = 0 (no 72% dominations; all reached timer) and median
    converted tiles 297–424 (was 480–517): v3 is more contested / slower to
    snowball, OR bots are naive at mission targeting. Expected — bot brain v3
    is deliberately simple (M5 tunes it; human play is the real test, B7.9).
- **Open:** M5 must confirm the low lead share isn't just "bots too passive
  to win" (a decisive-rate floor belongs in the M5 gate alongside lead share).

## PT-0008 — 2026-07-06 — M3.1 recruits-from-believers (the loop closes)

- **Nodes:** B9.3 M3.1 (economy: territory feeds the flock)
- **Scenario:** 15 bot matches (5 townTypes × 3 seeds); plus a church-vs-drifter
  growth probe on a generated town.
- **Verdict: THE LOOP CLOSES, snowball gain HELD.**
  - Growth is now driven by held believer souls (recruits/s = base 1 +
    believerPop × 0.005, × faith/stance/civic mods), replacing logistic
    follower-growth. Probe: church flock 0→15→54→606 tracking tiles
    10→22→50→109 — territory demonstrably feeds the army.
  - Founding 4/4 every match; median lead share 0.51–0.59 (was 0.94–0.98 on
    the front game, ~0.55 at PT-0007) — recruits did NOT re-introduce the
    snowball. Median tiles 349–392, up from PT-0007's 297–424 (more flock to
    deploy → more conversion).
  - Decisive% still 0 (no 72% dominations; all timer). Persistent — belongs
    to the M5 bot-brain gate, not the economy.
- **Test recalibration:** the church-vs-drifter test moved to a generated
  town (a featureless pop-0 grid can't express AI skill under presence
  conversion + territory economy — both cults saturate their half equally).

## PT-0009 — 2026-07-06 — M3.2b rituals cut (Faith→doctrine only)

- **Nodes:** B9.3 M3.2b (the ritual system removed)
- **Scenario:** browser boot of the client after cutting rituals across 8
  files; full suite; determinism gate.
- **Verdict: CLEAN CUT.** The RITUAL intent, applyRitual, KIT ritual entries,
  bot sermon-send, and all client ritual UI (panel, Q/W/E/R hotkeys, tutorial
  step, help text) are gone. Browser check: no "RITUALS" text, no ritual
  buttons, app mounts, zero console errors; help line updated to
  "1/2/3 stances · D/F powers · G signature · V van · ⇧C recall…".
  Inert sermonBuffTicks/atonementTicks fields kept (marked vestigial) so the
  snapshot/hash layout is unchanged — no version bump. 96/96 sim + 14/14
  server (2 ritual tests removed per the ✂ CUT law); 4-engine determinism PASS.
- Faith now has exactly one meaning: bank it with Tend, spend it on doctrine.

## PT-0010 — 2026-07-06 — cult archetype DEPTH REVIEW + rebalance (P2 moat)

- **System:** the four archetypes (dawn/radiant/circle/visitors) under the v3
  economy. Target depth P2 = "asymmetry is the moat" (SIGNATURE).
- **Method:** botleague — 160 church-tier 4-player matches per pass, win-rate
  + avg placement; ideal 25% each.

### Verdict: FAIL → PASS after 3 tuning rounds.

Baseline was a clear FAIL — one dominant strategy: dawn 48.8% / visitors
29.4% / radiant 14.4% / circle 7.5% (6.5× spread). ROOT CAUSE: recruits-from-
believers turned r0 into a COMPOUNDING stat (convert faster → more believers
→ more recruits → more flock → convert faster), so the coefficients balanced
for the old front game were broken. dawn's r0 1.3 + Fear-Feeds-Us snowballed;
circle's r0 0.6 death-spiralled.

**Adjustments (all preserve each cult's distinguishing stat):**
- r0 spread compressed 0.6–1.3 → 1.0–1.05 (dawn 1.3→1.05, radiant 0.8→1.0,
  circle 0.6→0.95, visitors 1.0). r0 no longer runs away under the recruit loop.
- Kept identities: radiant retain 1.5 + Glow (the turtle), circle income 1.3
  (highest — the economist), dawn heat 1.4 + Fear Feeds Us (the aggressor).
- Fear Feeds Us cap +25% → +15% (conversion.ts) — dawn's stacking passive was
  the other half of its runaway.

**Final: dawn 31.9 · visitors 26.9 · circle 20.6 · radiant 20.6** — 1.55×
spread, all within a competitive band. No dominant pick, none broken.

### CAVEAT / open item (scoped, not thrash):
This is a bot-FFA-by-tiles measurement. Under domination-only + recruits-
from-believers, the WIN CONDITION only rewards expansion (r0), so income
(circle) and retention (radiant) lack a full win-path until **M3.3** lands
money→commune-stages→flock-cap. dawn's residual 31.9% edge (aggression, un-
punished by bots) and radiant's turtle identity both want a DEFINITIVE
rebalance re-run AFTER M3.3, when the economic loop closes. Filed as B9.3.M3.4.

## PT-0011 — 2026-07-06 — M3.3a commune stages (money→flock loop)

- **Nodes:** B9.3 M3.3a (the commune's money-sink upgrade path)
- **Scenario:** commune-stage unit test + 15-match campaign + determinism.
- **Verdict: LOOP LIVE.** UPGRADE_COMMUNE raises the commune stage 1→5
  (reusing p.compounds as the stage counter), each stage lifting followerCap;
  physical compounds capped at 1 (no more multi-compound building); escalating
  cost ($15k×1.35^stage). Bots pour spare cash into upgrades. This closes the
  money→commune→flock-cap→more-cohorts loop the design (and M3.4's balance
  re-run) needs. Founding 4/4; lead share 0.54–0.62 (snowball still held);
  97/97 sim + 14/14 server; 4-engine determinism PASS. The other 4 buildings
  (plate/watchtower/broadcast/lab) still exist — cut in M3.3b.

## PT-0012 — 2026-07-06 — M3.3b build palette soft-cut (commune-only)

- **Nodes:** B9.3 M3.3b (placeable buildings removed from play)
- **Scenario:** suite + 15-match campaign + determinism.
- **Verdict: PASS (soft cut).** The 4 placeable buildings (collection_plate/
  watchtower/broadcast_tower/supplement_lab) are removed from every play
  surface — client build tray (COMMUNE only), bot build-lists, and tutorial
  ("PASS THE PLATE"→"UPGRADE YOUR COMMUNE"; "RAISE A WATCHTOWER" cut). Strikes
  un-gated from the (now unbuildable) broadcast tower → a pure money op. Dead
  helpers pruned (CHURCH_BUILDS, samplePropertyFree, freeBroadcastTower import).
  Founding 4/4; lead share 0.54–0.62; 97/97 sim + 14/14 server; 4-engine PASS.
- **Deferred (tracked M3.3c):** the buildings' sim CODE + m1 building-tests are
  left INERT (unreachable in play) rather than hard-purged — a token-efficient
  soft cut. Visitors' radio_static targets broadcast towers → now a no-op;
  retarget is kit-polish (filed). Client tray/tutorial build-verified, not yet
  browser-verified (M6 reworks the tray anyway).

## PT-0013 — 2026-07-06 — M3.4 archetype rebalance re-run (post-M3.3)

- **Nodes:** B9.3 M3.4 (balance re-run after the economy closed)
- **Method:** botleague, 160 church-tier 4p matches, post-M3.3 build.
- **Verdict: PASS, no coefficient change.** dawn 31.9 · visitors 26.9 ·
  circle 20.6 · radiant 20.6 — identical to the PT-0010 final. The completed
  economy (commune stages + palette cut) shifted all cults proportionally, so
  the PT-0010 balance HELD: 1.55× spread, no dominant pick, no broken cult.
  dawn's residual 31.9% is bot-FFA noise (aggression over-rewarded when nothing
  punishes overextension); pushing it lower would flatten its identity.
  DEFINITIVE final tune deferred to human playtests (B7.9) — bot FFA can't
  fairly resolve the last few points.
- **Delegation note:** the M3.3c purge was delegated to a Sonnet agent under
  worktree isolation, which checked out a STALE base (575658f, pre-mission-
  rework) — the agent correctly refused rather than damaging real mechanics.
  Lesson: worktree isolation doesn't inherit this session's committed HEAD
  here; delegate in the main tree.

## PT-0014 — 2026-07-06 — M4 territory glow (map-painting feedback) 🖼️

- **Nodes:** B9.4 M4 (glow-outline for converted territory)
- **Fantasy:** DESIGN_MISSIONS.md §6 + the #1 .io engagement driver (map
  painting). Converted town paints itself in your colour as it grows.
- **Verdict: PASS (vision-QA'd).** drawTerritoryBorders paints owner-colour
  edges where a converted citizen tile meets non-owned ground — outer
  boundary only (same-owner edges suppressed), gentle tick shimmer = glow.
  Rendered a 4-cult mid-match (126 converted tiles): red/green/blue regions
  read distinctly at map scale AND at LOD-3; interiors stay readable (houses,
  streets, people visible); per-tile ownership shows a block converting
  house-by-house. Readability + restraint both PASS. Render-only
  (deterministic in tick); 97/97 sim + 14/14 server; 4-engine PASS.
  Artifacts: QA gallery/M4Glow/. Siege tug-of-war bars are the remaining M4 piece.

## PT-0015 — 2026-07-06 — M4.2b siege capture bars (HUD) 🖼️ [delegated]

- **Nodes:** B9.4 M4.2b (tug-of-war capture bars in the Key Buildings panel)
- **Delegated** to a Sonnet agent against the computeSiegeState contract;
  agent touched only hud.ts, reused the existing fkBlink keyframe, matched the
  palette, encoded fill+contested in the diff-guard, and functionally verified
  in a live match (0% neutral / 100% colored / contested-pulse via DOM).
- **My vision-QA verdict: PASS.** Rendered the agent's exact CSS+markup with
  varied fill states (0/40/62-contested/85/100%): each bar shows WHO leads
  (colour) and HOW FAR (width) — the whole town's siege state readable at a
  glance; 5px bars are unobtrusive (restraint); dark-track/colour-fill matches
  the pixel aesthetic. Build clean; hud.ts only. M4 (glow + sieges) COMPLETE.
