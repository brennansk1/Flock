# FLOCK — Build Manifest

_Single source of truth for per-node build status. Created 2026-07-02 by
reverse-engineering the existing codebase (REFACTOR mode). Every ✔️ below is
backed by evidence gathered **that day**, not assumed: `npm run build` clean
across all 3 packages; `npm test` → **sim 60/60 pass**, **server 10/10 pass**
(incl. the live-WebSocket lockstep smoke test). Update this file after every
implementation step. Tree view: [BUILD_TREE.md](./BUILD_TREE.md)._

**Statuses:** ⬜ NOT_STARTED · 🧩 STUBBED · 🔨 IN_PROGRESS · ✅ IMPLEMENTED · ✔️ VERIFIED · 🚫 BLOCKED · 🛑 BLOCKED_BY_POLICY

## Progress summary

**55/63 nodes VERIFIED · 1 NOT_STARTED · 6 BLOCKED (external infra/content) · 1 STUBBED (deferred high-detail art, tracked) · 0 BLOCKED_BY_POLICY**

Next recommended action: **B6.5** (cross-browser determinism CI) — the
top-listed risk in HANDOFF §10 and the last pure-code ⬜ node; everything
else open is external provisioning (B7.*) or the deferred art pass (B5.3).

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
| B1.4 | B1/mapgen | Seeded mapgen (§2/§12) | Districts, river, farms, all 5 landmarks w/ passive effects; seed-stable | T.2.2 | ✔️ | Reworked onto the block grid; mapgen.test.ts 6/6 + full suite 66/66 (2026-07-02) |
| B1.4.1 | B1/mapgen/gridroads | Axis-aligned street grid | ALL roads horizontal/vertical: 2-lane highway→Main St, county route, jittered avenues×streets forming irregular blocks (tight downtown, looser fringe); zero unbridged corner-only road adjacencies | B1.4 | ✔️ | tensorRoads.ts deleted; mapgen.test.ts orthogonality gate green over 5 seeds; vision-checked LOD1+LOD3 renders |
| B1.4.2 | B1/mapgen/lanes | Orthogonal country roads + lanes | Rural roads leave town along the grid with 90° jogs; dirt lanes are L-paths (axis-at-a-time); no diagonal stair-steps anywhere | B1.4.1 | ✔️ | carveDirtLane rewritten as hash-oriented L-path; rural roads launch from painted street endpoints (gap bug found+fixed by the test) |
| B1.4.3 | B1/mapgen/names | Town + street naming | `World.townName` fresh per seed from the faker corpus; every street segment named in `World.streets`; two same-seed runs identical | B1.4.1, B6.6 | ✔️ | mapgen.test.ts: determinism + Main-Street resolution + name variety across seeds all green |
| B1.4.4 | B1/mapgen/zoning | Zoning re-fit + pop floor | Districts/farms/nature/landmarks on the block grid; ≥640 populated tiles & ≥2900 residents on 96 worlds across seeds | B1.4.1 | ✔️ | floors green over seeds (infill-housing fallback); also fixed a pre-existing (seed,attempt) rng-salt collision that made adjacent seeds produce identical towns |
| B1.4.5 | B1/mapgen/contract | World naming contract | World gains {townName, streets}; SNAPSHOT_VERSION 6→7 carries + restores them; hashState covers them; round-trip invariant holds | T.5 | ✔️ | mapgen.test.ts snapshot round-trip hash-identical; lockstep smoke green |
| B1.4.6 | B1/mapgen/zoning2 | Realistic zoning v2 | 8 districts (ResLow, ResHigh, Commercial, Industrial + Downtown/OldTown/College/Trailer), each with coeffs, pop ranges, and its own building set; industrial by the highway, commercial on Main St, ResHigh ringing downtown | B1.4.4 | ⬜ | |
| B1.4.7 | B1/mapgen/keystones | Keystone civics guaranteed | Every town has elementary school, high school, sheriff, grocery, church, fire station, gas station — force-placed if stamping fails; test-asserted per seed | B1.4.6 | ⬜ | |
| B1.4.8 | B1/mapgen/blocks | Block interiors | Footpaths (Terrain.Path) connect every pop≥3 home to the street net (test: access within 1 orth tile); cul-de-sacs with bulbs, named "X Court" | B1.4.1 | ⬜ | |
| B1.4.9 | B1/mapgen/farms2 | Farming v2 | Farmsteads anchored ON rural lanes; rectangular road-aligned field parcels with baulks; orchards (tree rows) + fenced pastures (livestock) | B1.4.2 | ⬜ | |
| B1.4.10 | B1/mapgen/biomes | Configurable biomes | `World.biome` blob layer (desert/forest) from `generateWorld` opts / server env; affects nature gen + render palette; snapshot v8 + hashed | B1.4.4 | ⬜ | |
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

| B1.16 | B1/felling | Tree auto-felling | BUILD / SPAWN parcel / BUY_PROPERTY on Woods fells trees (terrain→Grass) deterministically; hashed | B1.17 | ⬜ | |
| B1.17 | B1/property | Property engine | SPAWN = wilderness founding: 5×5 parcel + starter compound + bused-in congregation (no more town-blob start); BUY_PROPERTY intent, cost escalating per parcel, must adjoin empire; wilderness BUILD requires own parcel; crowding penalty on follower cap when parcels near-full | B1.16, T.4 | ⬜ | |
| B1.18 | B1/civics | Civics takeover engine | Owning the majority of a civic lot's tiles grants: sheriff→heat decay bonus; elementary→creep ×1.25; high school→follower growth ×1.15; grocery→defense ×1.2; church→faith drift up | B1.4.7 | ⬜ | |
| B1.19 | B1/outreach | Compound outreach | Fronts may press tiles within outreach radius of an operational compound (not just adjacency) — targeted conversion from wilderness bases | B1.17 | ⬜ | |

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

| B3.10 | B3/cap4 | 4-player cap | Human seats per match ≤ 4 regardless of CAPACITY env | B3.2 | ⬜ | |

### B4 — Client (frontend spine)

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B4.1 | B4/boot | Boot + shell + FTUE | PixiJS app, input wiring, founding hints, FTUE coachmark, recap overlay | B4.2 | ✔️ | build clean; prior live 2-tab verification (HANDOFF §2) |
| B4.2 | B4/net | Prediction + reconciliation (§33) | Confirmed sim + predicted sim w/ in-flight intents; self-heal ≤1 turn; resync; session resume | T.5, B3.9 | ✔️ | lockstep.smoke.ts; 0-desync soak evidence |
| B4.3 | B4/render | Map renderer + fog (§14) | Camera zoom→LOD/pan, owned+unit+allied vision, minimap camera API | B5.2 | ✔️ | build clean; screenshots.mjs renders QA'd |
| B4.4.1 | B4/hud/core | Core in-match HUD (§27/§28) | Top bar, rails w/ costs+cooldowns, build palette, doctrine grid, minimap, player list, drama feed, help overlay, threat pings | B4.2 | ✔️ | build clean; prior live verification; XSS-escaped user text |
| B4.4.2 | B4/hud/abilitycosts | Live ability costs | D/F/G archetype actives + signature show live cost & affordability exactly as builds/rituals do | B4.4.1 | ✔️ | Playwright vision check 2026-07-02: "$20.0k"/"$35.0k"/"passive" render on the Powers rail, unaffordable greys (`cant`), cooldown countdown wired; also fixed the pre-existing Retreat cooldown key mismatch (`retreat` vs ability id) |
| B4.4.3 | B4/hud/chat | In-match chat input | Chat box: Enter focuses, Esc blurs, send via existing `sendChat`; game keybinds fully suppressed while focused; rendered text `esc()`-escaped | B4.4.1, B3.9 | ✔️ | Playwright e2e 2026-07-02: Enter→focus, typed "1" did NOT switch stance (isolation proven), send → server-moderated relay → "💬 Prophet: …" rendered in feed, Esc clears draft; respects mute-by-default (§28) |
| B4.5 | B4/menu | Lobby + meta screens | Play/leaderboard/store/clans/profile/settings consuming REST API | B3.1 | ✔️ | build clean; services.test.ts covers API side |
| B4.6 | B4/settings | Accessibility settings | Reduced-motion / mute / colorblind, persisted locally | — | ✔️ | build clean; prior live verification |
| B4.7 | B4/place | Place identity in UI | Conversion bar shows `world.townName`; hovering a tile shows a chip with street/household/lot/landmark names (static seed data only — no fog leak); textContent-rendered (XSS-inert) | B1.4.5 | ✔️ | Playwright live: bar shows 'BRANCH FALLS', chip resolved 'Castaneda Street' + 'the woods'; screenshot evidence |

| B4.8 | B4/property | Property UI | BUY LAND build-palette mode → BUY_PROPERTY at click; founding hints point at wilderness near town; property stakes tinted on map; crowding warning on cap | B1.17 | ⬜ | |
| B4.9 | B4/civics | Civics panel | Right-rail list of key buildings with owner + effect; click centers camera on it (targeting affordance) | B1.18 | ⬜ | |

### B5 — Visuals

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B5.1 | B5/palette | Shared palette tokens | Single token source for client + headless renders | — | ✔️ | build clean; spritesheet QA |
| B5.2 | B5/townrender | Procedural pixel renderer | SimState→RGBA identical client & headless; terrain/buildings/icons/units/auras | B5.1 | ✔️ | Expanded (B5.2.1–.4); recapCard determinism test still green |
| B5.2.1 | B5/townrender/roads | Road dressing | Bridges where road crosses water (railings + plank deck), crosswalks at downtown intersections, highway center line | B1.4.1 | ✔️ | vision-checked: bridge/crosswalks/center-line all read at LOD1 + LOD3 (zoom-bridge/zoom-downtown renders) |
| B5.2.2 | B5/townrender/lots | New lot assets | Cinema, TrailerHome, Playground, Dock, Greenhouse render at LOD1 (8px) with distinct silhouettes; placed by mapgen in fitting districts | B1.4.4 | ✔️ | vision-checked (cinema marquee downtown, trailers on farm lanes, dock w/ rowboat on shore); high-detail → B5.3.1 |
| B5.2.3 | B5/townrender/growth | Cult building expansion | Compound icon gains visible growth stages (fence at ≥7%, banners at ≥15% town share); wilderness-claim assets extend to grass verges | B5.2 | ✔️ | stages keyed to ownedTiles permille (25/70/150‰ thresholds shared with woodsClaim); mid/late match screenshots rendered |
| B5.2.4 | B5/assetsdoc | ASSETS.md ledger | Every rendered asset documented: name, source fn, LOD1 form, LOD2–4 detail, status; every deferred high-detail variant is a 🧩 row here + in this manifest | B5.2.1–.3 | ✔️ | ASSETS.md written: terrain/lots/landmarks/cult/units/effects × LOD, deferred variants itemized → B5.3.1 |
| B5.2.5 | B5/townrender/v3 | Renderer v3 | Biome palettes (desert sand/cacti, forest density), Path sidewalks, bridge-CROSSING detection (no more shore-parallel false bridges), poles every 2 tiles with connected wire, cul-de-sac bulbs, orchard/pasture/warehouse/high-school assets, property stakes | B1.4.10 | ⬜ | |
| B5.3 | B5/authored | Authored audio + animation (§30/§31) | ~40 frame-by-frame animations, full audio pass | B5.2 | 🚫 | BLOCKED: artist/composer content, not code; render/event seams ready |
| B5.3.1 | B5/authored/lod | High-detail LOD 3–4 asset variants | Each 🧩 line in ASSETS.md gets a dedicated high-detail form (animated neon, truss bridges, per-tree canopies, walk cycles…) | B5.2.4 | 🧩 | STUBBED by design: low-LOD procedural forms ship now; this row is the Stub-Law tracker for the deferred art pass |

### B6 — Tooling & QA

| ID | Tree Path | Feature | Contract / Acceptance Criteria | Depends On | Status | Evidence / Notes |
|----|-----------|---------|-------------------------------|------------|--------|------------------|
| B6.1 | B6/ci | CI gate (Node) | build + determinism + full suite on every push | T.1 | ✔️ | ci.yml; suite green 2026-07-02 |
| B6.2 | B6/artqa | Art QA tools | screenshots / units / spritesheet headless renders | B5.2 | ✔️ | tools present; used for prior sprite QA |
| B6.3 | B6/botleague | Balance harness (§40/§41) | Per-archetype win-rate drift over N bot matches | B1.14 | ✔️ | tools/botleague.mjs; nightly runs → B7.9 |
| B6.4 | B6/soak | Load/desync soak | N clients vs live server; asserts desync SLA | B3.3 | ✔️ | prior run: 12 clients / 1600+ intents / 0 desyncs |
| B6.5 | B6/xbrowser | Cross-browser determinism CI | Hash gate passes in headless Chromium + Firefox, wired into CI | T.2.3 | ⬜ | HANDOFF §8.5 — #1 risk (§10): Node-only today |
| B6.6 | B6/gennames | Name corpus generator | `tools/gen_names.py` (Python faker) emits `packages/sim/src/nameData.ts`: deduped town/street/first/surname banks; regenerable, generated file checked in and never hand-edited | — | ✔️ | ran with faker 40.28.1 (seeded): 512 towns / 384 streets / 328 firsts / 512 surnames baked in |

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
