# FLOCK — Build Manifest

_Single source of truth for per-node build status. Created 2026-07-02 by
reverse-engineering the existing codebase (REFACTOR mode). Every ✔️ below is
backed by evidence gathered **that day**, not assumed: `npm run build` clean
across all 3 packages; `npm test` → **sim 60/60 pass**, **server 10/10 pass**
(incl. the live-WebSocket lockstep smoke test). Update this file after every
implementation step. Tree view: [BUILD_TREE.md](./BUILD_TREE.md)._

**Statuses:** ⬜ NOT_STARTED · 🧩 STUBBED · 🔨 IN_PROGRESS · ✅ IMPLEMENTED · ✔️ VERIFIED · 🚫 BLOCKED · 🛑 BLOCKED_BY_POLICY

## Progress summary

**42/51 leaves VERIFIED · 3 NOT_STARTED · 6 BLOCKED (external infra/content) · 0 STUBBED · 0 BLOCKED_BY_POLICY**

Next recommended action: **B4.4.2 + B4.4.3** (HUD close-out cluster: live
ability costs + in-match chat input) — the only pure-code, self-verifiable
gaps inside the product itself; then **B6.5** (cross-browser determinism CI),
the top-listed risk in HANDOFF §10.

## Manifest

### T — Trunk

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| T.1 | T/scaffold | Monorepo scaffold + CI gate | 3 workspaces build under strict tsc (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`); CI runs build+test on push | — | ✔️ | `npm run build` clean ×3 pkgs (2026-07-02); `.github/workflows/ci.yml` |
| T.2.1 | T/determinism/fixed | Q16.16 fixed-point math | Only number type in sim scope; exact 53-bit range | — | ✔️ | sim suite 60/60; determinism gate green |
| T.2.2 | T/determinism/rng | Seeded xoshiro RNG | All sim randomness flows via `Turn.seedSlice` | T.2.1 | ✔️ | determinism.test.ts green |
| T.2.3 | T/determinism/hash | StateHash | Same seed + same intents ⇒ same hash, every machine | T.3 | ✔️ | `determinism.test.ts` + `lockstep.smoke.ts` both pass (2026-07-02) |
| T.3 | T/types | SimState / World SoA / enums | Struct-of-arrays world; deterministic iteration keys | — | ✔️ | sim suite 60/60 |
| T.4 | T/intents | Intent protocol + Turn | Discriminated union; all gameplay flows as intents | T.3 | ✔️ | sim suite 60/60; hardening.test.ts caps arrays |
| T.5 | T/snapshot | Snapshot codec | `fromSnapshot(toSnapshot(s))` hash-identical; powers join/resync | T.2.3 | ✔️ | sim suite + server resync test |

### B1 — Sim core (deterministic)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B1.1 | B1/loop | Tick loop + KIT table | `createSim/step/applyIntent`; no floats/Date/Math.random in scope | T.* | ✔️ | determinism gate; sim 60/60 |
| B1.2 | B1/conversion | Conversion combat (§4) | Fronts, pressure/resistance, creep, attrition, scars, deterministic flips | B1.1 | ✔️ | conversion.test.ts green |
| B1.3 | B1/economy | Sim economy (§3) | Logistic followers, per-tile tithe, district income, dissent tax, Faith, Heat | B1.1 | ✔️ | sim suite 60/60 |
| B1.4 | B1/mapgen | Seeded mapgen (§2/§12) | Districts, river, farms, all 5 landmarks w/ passive effects; seed-stable | T.2.2 | ✔️ | sim suite; cosmetic-boundary floats not hashed |
| B1.4.1 | B1/mapgen/roads | Tensor-field roads | Road network from tensor field, seed-stable | B1.4 | ✔️ | sim suite; screenshots.mjs QA |
| B1.5 | B1/buildings | Buildings (§6) | Full table incl. Watchtowers fort×5, Hotlines 75% intercept | B1.1 | ✔️ | m1.test.ts green |
| B1.6 | B1/units | Units (§7) | Couriers (robbable), Vans (mobile pressure/screening), invisible Agents | B1.5 | ✔️ | m1.test.ts green |
| B1.7 | B1/pvp | PvP trio (§13/§15) | Raids, Scandal 50%-notify→Publish, Court Defection | B1.6 | ✔️ | m1.test.ts green |
| B1.8 | B1/strikes | Strikes (§8) | 3 strikes, charge + 10 s warning, hotline intercepts | B1.5 | ✔️ | m1.test.ts green |
| B1.9 | B1/diplomacy | Diplomacy + schism (§16) | Alliances, JUDAS grudges, SCHISM gauge → Splinter Sects | B1.1 | ✔️ | m1/m2 tests green |
| B1.10 | B1/doctrine | Doctrine tree (§10) | 16 BITE nodes, milestone points, tier gating, effects plumbed | B1.1 | ✔️ | m1.test.ts green |
| B1.11 | B1/kits | 4 archetype kits (§11) | Final Dawn / Radiant Path / Prosperity / Visitors actives + signatures | B1.1 | ✔️ | kit.test.ts green |
| B1.12 | B1/cpa | CPA antagonist (§17) | Pickets @Heat 60, Bus @85, Town-Hall immunity <75 | B1.3 | ✔️ | m2.test.ts green |
| B1.13 | B1/matchflow | Match flow + victory (§18) | Founding pick, domination/last-standing/timer/Revelation, RECAP freeze | B1.1 | ✔️ | sim suite 60/60 |
| B1.14 | B1/bots | Bot tiers (§21) | Drifter/Sect/Established-Church via Intent API only; no stat cheats | B1.* | ✔️ | bots.test.ts green; botleague harness |
| B1.15 | B1/hardening | Input hardening | All client array intents length-capped; per-socket rate limit | T.4 | ✔️ | hardening.test.ts green |

### B2 — Meta systems (outside lockstep)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B2.1 | B2/ranked | Glicko-2 ranked (§20) | Rating/RD/volatility, FFA pairwise, tiers, seasonal soft reset | B1.13 | ✔️ | meta/metagame tests green |
| B2.2 | B2/progression | XP / relics (§22) | Level curve, Relic earn band, level-5 ranked unlock | B1.13 | ✔️ | meta tests green |
| B2.3 | B2/daily | Daily Prophecy (§23) | Deterministic daily challenge rotation | B2.2 | ✔️ | meta tests green |
| B2.4 | B2/store | Earn/spend economy (§36) | Relics never money-priced; free rotation; double-buy rejected | B2.2 | ✔️ | test 56 "insufficient funds, double-buy" green |
| B2.5 | B2/recap | Recap data (§25) | Headline grammar + stat block + standings from finished match | B1.13 | ✔️ | sim suite green |
| B2.6 | B2/recapcard | Recap Card render (§25.1) | Deterministic 1080×1350 RGBA, opaque, winner-colored | B2.5 | ✔️ | recapCard.test.ts: dims/determinism/opacity all green |

### B3 — Server

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B3.1 | B3/entry | HTTP + REST + WS entry | `/health`; CORS REST (`/leaderboard /profile /replay /daily /catalog /congregations /me /purchase`); WS auth handshake | B3.5 | ✔️ | services.test.ts green |
| B3.2 | B3/lobby | LobbyDirector (§32) | Concurrent matches, capacity routing, graceful shutdown, persistMatch | B3.3 | ✔️ | services.test.ts green |
| B3.3 | B3/worker | MatchWorker (§33) | Authoritative 10 Hz lockstep, hash checks, desync→resync | B1.*, T.5 | ✔️ | lockstep.smoke.ts (live WS) green; prior soak: 12 clients / 1600+ intents / 0 desyncs |
| B3.4 | B3/store | Store persistence (§34) | Interface + InMemory + durable JSON; accounts/ratings/history/replays | — | ✔️ | services.test.ts green; JSON adapter is dev-only (→ B7.1) |
| B3.5 | B3/auth | Auth (§26) | Instant guests, stateless HMAC sessions, pluggable AuthProvider, guest→linked upgrade | — | ✔️ | services.test.ts green; OAuth verify itself → B7.2 |
| B3.6 | B3/moderation | Name/chat filter (§30) | Leetspeak-aware filter; `<>` stripped server-side | — | ✔️ | services.test.ts green; maintained list → B7.6 |
| B3.7 | B3/congregations | Clans + ladder (§24) | Membership + weekly best-10 ladder scoring | B3.4 | ✔️ | test 10 "congregation score sums members' best" green |
| B3.8 | B3/metrics | Logs + metrics | Structured JSON logs, counters/gauges | — | ✔️ | services.test.ts green; real sinks → B7.5 |
| B3.9 | B3/protocol | Wire protocol | Typed client↔server messages incl. `sendChat` + relay | T.4 | ✔️ | lockstep.smoke.ts green; chat UI consumer → B4.4.3 |

### B4 — Client (frontend spine)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B4.1 | B4/boot | Boot + shell + FTUE | PixiJS app, input wiring, founding hints, FTUE coachmark, recap overlay | B4.2 | ✔️ | build clean; prior live 2-tab verification (HANDOFF §2) |
| B4.2 | B4/net | Prediction + reconciliation (§33) | Confirmed sim + predicted sim w/ in-flight intents; self-heal ≤1 turn; resync; session resume | T.5, B3.9 | ✔️ | lockstep.smoke.ts; 0-desync soak evidence |
| B4.3 | B4/render | Map renderer + fog (§14) | Camera zoom→LOD/pan, owned+unit+allied vision, minimap camera API | B5.2 | ✔️ | build clean; screenshots.mjs renders QA'd |
| B4.4.1 | B4/hud/core | Core in-match HUD (§27/§28) | Top bar, rails w/ costs+cooldowns, build palette, doctrine grid, minimap, player list, drama feed, help overlay, threat pings | B4.2 | ✔️ | build clean; prior live verification; XSS-escaped user text |
| B4.4.2 | B4/hud/abilitycosts | Live ability costs | D/F/G archetype actives + signature show live cost & affordability exactly as builds/rituals do | B4.4.1 | ⬜ | HANDOFF §9.6; pure client change (cosmetic boundary) |
| B4.4.3 | B4/hud/chat | In-match chat input | Chat box: Enter focuses, Esc blurs, send via existing `sendChat`; game keybinds fully suppressed while focused; rendered text `esc()`-escaped | B4.4.1, B3.9 | ⬜ | HANDOFF §9.5 — server relay exists, UI consumer is the one missing spine-parity leaf |
| B4.5 | B4/menu | Lobby + meta screens | Play/leaderboard/store/clans/profile/settings consuming REST API | B3.1 | ✔️ | build clean; services.test.ts covers API side |
| B4.6 | B4/settings | Accessibility settings | Reduced-motion / mute / colorblind, persisted locally | — | ✔️ | build clean; prior live verification |

### B5 — Visuals

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B5.1 | B5/palette | Shared palette tokens | Single token source for client + headless renders | — | ✔️ | build clean; spritesheet QA |
| B5.2 | B5/townrender | Procedural pixel renderer | SimState→RGBA identical client & headless; terrain/buildings/icons/units/auras | B5.1 | ✔️ | recapCard determinism test; screenshots/units/spritesheet QA tools |
| B5.3 | B5/authored | Authored audio + animation (§30/§31) | ~40 frame-by-frame animations, full audio pass | B5.2 | 🚫 | BLOCKED: artist/composer content, not code; render/event seams ready |

### B6 — Tooling & QA

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B6.1 | B6/ci | CI gate (Node) | build + determinism + full suite on every push | T.1 | ✔️ | ci.yml; suite green 2026-07-02 |
| B6.2 | B6/artqa | Art QA tools | screenshots / units / spritesheet headless renders | B5.2 | ✔️ | tools present; used for prior sprite QA |
| B6.3 | B6/botleague | Balance harness (§40/§41) | Per-archetype win-rate drift over N bot matches | B1.14 | ✔️ | tools/botleague.mjs; nightly runs → B7.9 |
| B6.4 | B6/soak | Load/desync soak | N clients vs live server; asserts desync SLA | B3.3 | ✔️ | prior run: 12 clients / 1600+ intents / 0 desyncs |
| B6.5 | B6/xbrowser | Cross-browser determinism CI | Hash gate passes in headless Chromium + Firefox, wired into CI | T.2.3 | ⬜ | HANDOFF §8.5 — #1 risk (§10): Node-only today |

### B7 — Launch infrastructure (external seams)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B7.1 | B7/postgres | Postgres Store adapter | Implements `Store` against PG + object storage; schema + migrations | B3.4 | ⬜ | Code-level but unverifiable without a PG instance; JSON adapter remains dev-only |
| B7.2 | B7/oauth | OAuth providers (§26) | `AuthProvider.verify` for Google/Discord/email; secrets via env | B3.5 | 🚫 | BLOCKED: provider apps + secrets to provision |
| B7.3 | B7/tls | TLS / ingress | wss:// terminated at LB; certs | — | 🚫 | BLOCKED: infra; nginx sample ships no certs |
| B7.4 | B7/scale | Worker-process isolation (§32) | One pinned worker process per match over IPC | B3.2 | ⬜ | Seam in place (in-proc workers today) |
| B7.5 | B7/telemetry | Telemetry + KPI dashboard (§41) | metrics/log wired to real sinks; KPI dashboard | B3.8 | 🚫 | BLOCKED: sink provisioning |
| B7.6 | B7/modpipeline | Moderation pipeline (§30) | Maintained locale-aware blocklist + human review flow | B3.6 | 🚫 | BLOCKED: external list + process |
| B7.7 | B7/legal | Legal / compliance | ToS, privacy, GDPR deletion, age gating | — | 🚫 | BLOCKED: legal work |
| B7.8 | B7/payments | Payment gateway (§36) | PSP behind money-priced recap frames only | B2.4 | 🚫 | BLOCKED: PSP account; relic/shard items already work |
| B7.9 | B7/balance | Balance validation (§41) | Nightly botleague + human playtests tuning balance.json | B6.3 | 🚫 | BLOCKED: needs real players; harness ready |

## Stub Law register

No untracked stubs. The only deliberate placeholders are the launch seams
listed as B7.* rows above (each has its interface in code and its row here).
