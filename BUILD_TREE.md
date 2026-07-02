# FLOCK — Build Tree

_Build Tree Framework state. Reverse-engineered from the existing codebase on
2026-07-02 (REFACTOR mode); statuses verified by re-running the full suite that
day (build clean; sim 60/60, server 10/10 incl. live-WS lockstep smoke).
Companion ledger: [BUILD_MANIFEST.md](./BUILD_MANIFEST.md) — the single source
of truth for per-node status. Design spec references (§N) point into
[DESIGN.md](./DESIGN.md)._

**Legend:** ⬜ NOT_STARTED · 🧩 STUBBED · 🔨 IN_PROGRESS · ✅ IMPLEMENTED · ✔️ VERIFIED · 🚫 BLOCKED · 🛑 BLOCKED_BY_POLICY

```
T   ✔️ TRUNK — TypeScript monorepo + THE DETERMINISM CONTRACT (§32/§40)
├── T.1  ✔️ Workspace scaffold (npm workspaces, strict tsconfig, CI build+test gate)
├── T.2  ✔️ Determinism substrate
│   ├── T.2.1 ✔️ fixed.ts — Q16.16 fixed-point math (only number type in sim scope)
│   ├── T.2.2 ✔️ rng.ts — seeded xoshiro RNG (all randomness via turn stream)
│   └── T.2.3 ✔️ hash.ts — StateHash (the lockstep/CI gate)
├── T.3  ✔️ types.ts — SimState, World (struct-of-arrays), core enums
├── T.4  ✔️ intents.ts — Intent protocol (discriminated union) + Turn
└── T.5  ✔️ snapshot.ts — toSnapshot/fromSnapshot join & resync codec

B1  ✔️ SIM — deterministic gameplay core (@flock/sim, runs bit-identically client & server)
├── B1.1  ✔️ sim.ts — createSim/step/applyIntent tick loop + KIT ability table
├── B1.2  ✔️ conversion.ts — fronts, pressure/resistance, creep, attrition, flips (§4)
├── B1.3  ✔️ economy.ts — followers, tithe, district income, dissent, Faith, Heat (§3)
├── B1.4  ✔️ mapgen.ts — seeded districts, river, farms, landmarks (§2/§12)
│   ├── B1.4.1 ✔️ gridRoads.ts — axis-aligned street grid: highway/Main St,
│   │            county route, jittered avenues×streets → real city blocks
│   │            (REPLACES tensor-field diagonal roads)
│   ├── B1.4.2 ✔️ Orthogonal country roads + dirt lanes (L-paths, no diagonals)
│   ├── B1.4.3 ✔️ Naming — World.townName + World.streets[] assigned from the
│   │            faker-generated corpus, deterministic per seed
│   ├── B1.4.4 ✔️ Zoning/farms/nature/landmarks re-fit onto the block grid,
│   │            population floor preserved (64/96 worlds)
│   ├── B1.4.5 ✔️ Contract: World {townName, streets}, snapshot v7, hashed
│   ├── B1.4.6 ⬜ Zoning v2 — 8 districts: ResLow/ResHigh/Commercial/
│   │            Industrial + Downtown/OldTown/College/Trailer, w/ coeffs
│   ├── B1.4.7 ⬜ Keystone civics guaranteed every town: elementary + high
│   │            school, sheriff, grocery, church, fire station, gas
│   ├── B1.4.8 ⬜ Block interiors — footpaths so every home has access;
│   │            cul-de-sacs ("X Court") in residential zones
│   ├── B1.4.9 ⬜ Farming v2 — road-aligned field parcels, orchards,
│   │            fenced pastures, farmstead clusters at lanes
│   └── B1.4.10 ⬜ Biomes — configurable blob biomes (desert/forest),
│                World.biome layer, snapshot v8, hashed
├── B1.5  ✔️ buildings.ts — full §6 table (Compounds…Supplement Labs)
├── B1.6  ✔️ entities.ts — Couriers, Vans, invisible Agents (§7)
├── B1.7  ✔️ PvP trio — raids / scandal→publish / court defection (§13/§15)
├── B1.8  ✔️ Strikes — Pamphlet Bomb, Exposé, Manifesto Drop + intercepts (§8)
├── B1.9  ✔️ diplomacy.ts — alliances, JUDAS betrayal, SCHISM → Splinter Sects (§16)
├── B1.10 ✔️ doctrine.ts — all 16 BITE nodes, milestones, tier gating (§10)
├── B1.11 ✔️ Archetype kits ×4 — Final Dawn / Radiant Path / Prosperity / Visitors (§11)
├── B1.12 ✔️ CPA — pickets @Heat60, Deprogrammer Bus @85, Town Hall immunity (§17)
├── B1.13 ✔️ Match flow — founding, victory paths, elimination, RECAP freeze (§18)
├── B1.14 ✔️ bots.ts — Drifter / Sect / Established Church tiers via Intent API (§21)
├── B1.15 ✔️ Input hardening — length-capped array intents (MAX_FRONT/PATH_TILES)
├── B1.16 ⬜ Tree felling — building/parcel placement fells Woods deterministically
├── B1.17 ⬜ Property engine — wilderness SPAWN founds a 5×5 parcel + compound
│            + bused-in congregation; BUY_PROPERTY intent (escalating cost);
│            wilderness builds require own property; crowding cap penalty
├── B1.18 ⬜ Civics engine — controlling police/elementary/high-school/
│            grocery/church grants realistic takeover effects in the engines
└── B1.19 ⬜ Compound outreach — fronts can target tiles within radius of an
             operational compound (targeted conversion from wilderness bases)

B2  ✔️ META — post-match systems (outside lockstep; float-safe by design)
├── B2.1 ✔️ ranked.ts — Glicko-2, FFA pairwise, tiers, seasonal soft reset (§20)
├── B2.2 ✔️ progression.ts — XP/levels, Relic earn band, ranked unlock (§22)
├── B2.3 ✔️ daily.ts — Daily Prophecy (§23)
├── B2.4 ✔️ economy.ts (meta) — earn/spend store, free rotation, no paid relics (§36)
├── B2.5 ✔️ recap.ts — match recap data + headline grammar (§25)
└── B2.6 ✔️ recapCard.ts — deterministic 1080×1350 share-card renderer (§25.1)

B3  ✔️ SERVER — hosted service (@flock/server, Node 22)
├── B3.1 ✔️ index.ts — HTTP entry, REST API, /health, WS upgrade + auth handshake
├── B3.2 ✔️ lobby.ts — LobbyDirector: concurrent matches, routing, persistMatch (§32)
├── B3.3 ✔️ matchWorker.ts — authoritative 10 Hz lockstep loop per match (§33)
├── B3.4 ✔️ store.ts — Store interface + InMemoryStore + durable JsonFileStore (§34)
├── B3.5 ✔️ auth.ts — guests, stateless HMAC sessions, pluggable AuthProvider (§26)
├── B3.6 ✔️ moderation.ts — leetspeak-aware name/chat filter (§30)
├── B3.7 ✔️ congregations.ts — clans + weekly best-10 ladder (§24)
├── B3.8 ✔️ metrics.ts — structured JSON logs, counters/gauges
├── B3.9 ✔️ protocol.ts — client↔server wire message types
└── B3.10 ⬜ 4-player cap — human seats per match clamped to 4

B4  ✔️ CLIENT — frontend spine (@flock/client, Vite + PixiJS)
├── B4.1 ✔️ main.ts — boot, app shell, input wiring, FTUE coachmark, recap overlay
├── B4.2 ✔️ net.ts — prediction + reconciliation, resync, session resume (§33)
├── B4.3 ✔️ render.ts — camera zoom→LOD/pan, fog of war (§14), minimap camera
├── B4.4 ✔️ hud.ts — in-match HUD (§27/§28)
│   ├── B4.4.1 ✔️ Core HUD — top bar, rails, build palette, doctrine grid,
│   │            minimap, player list, drama feed, help overlay, threat pings
│   ├── B4.4.2 ✔️ Live ability costs — D/F/G actives show cost/affordability
│   │            like builds/rituals already do (HANDOFF §9.6)
│   └── B4.4.3 ✔️ In-match chat input — UI box + keybind-focus isolation;
│                server sendChat + relay already exist (HANDOFF §9.5)
├── B4.5 ✔️ menu.ts — lobby, leaderboard/store/clans/profile via REST API (§28)
├── B4.6 ✔️ settings.ts — reduced-motion / mute / colorblind, persisted (§28)
├── B4.7 ✔️ Place identity — generated town name on the conversion bar +
│            hover chip (street / household / lot / landmark names)
├── B4.8 ⬜ Property UI — BUY LAND placement mode, wilderness founding hints,
│            property tint + crowding warning
└── B4.9 ⬜ Civics panel — key buildings, owner + takeover effect, click to target

B5  🔨 VISUALS — shared pixel renderer (SimState → RGBA, cosmetic boundary)
├── B5.1 ✔️ palette.ts — shared color tokens
├── B5.2 ✔️ townRender.ts — terrain, houses, lot buildings, landmark +
│   │        building icons, unit sprites, conversion auras (procedural)
│   ├── B5.2.1 ✔️ Road dressing — bridges over water (railings/planks),
│   │            downtown crosswalks, highway center line
│   ├── B5.2.2 ✔️ New lots — Cinema, TrailerHome, Playground, Dock, Greenhouse
│   │            (low-LOD procedural now; high-detail flagged 🧩)
│   ├── B5.2.3 ✔️ Cult building expansion — compound growth stages by cult
│   │            size; claim assets extended to grass verges
│   ├── B5.2.4 ✔️ ASSETS.md — full asset × LOD ledger; high-detail versions
│   │            tracked as 🧩 stubs per the Stub Law
│   └── B5.2.5 ⬜ Renderer v3 — biome palettes (desert/forest), footpaths,
│                bridge-crossing fix, wired powerlines, cul-de-sac bulbs,
│                orchards/pastures/warehouse/high-school, property stakes
└── B5.3 🚫 Authored content — audio (§31) + ~40 frame-by-frame sprite
    │        animations (§30). BLOCKED: artist/composer work, not code.
    └── B5.3.1 🧩 High-detail (LOD 3–4) asset variants — deferred art pass;
                 every deferred variant is itemized in ASSETS.md

B6  🔨 TOOLING & QA — headless harnesses (tools/) + CI
├── B6.1 ✔️ CI gate — build + determinism + full suite on every push (Node)
├── B6.2 ✔️ Art QA — screenshots.mjs, units.mjs, spritesheet.mjs
├── B6.3 ✔️ botleague.mjs — per-archetype win-rate balance harness (§40/§41)
├── B6.4 ✔️ soak.mjs — live load/desync soak vs running server (SLA assert)
├── B6.5 ⬜ Cross-browser determinism CI — run the hash gate in headless
│            Chromium + Firefox, not just Node (HANDOFF §8.5; top risk §10)
└── B6.6 ✔️ tools/gen_names.py — Python faker → nameData.ts corpus generator
             (town/street/first/surname banks, checked in, regenerable)

B7  🚫 LAUNCH INFRASTRUCTURE — external provisioning (seams exist in code)
├── B7.1 ⬜ Postgres Store adapter + schema (JSON adapter is dev-only) (§34)
├── B7.2 🚫 OAuth AuthProvider.verify — Google/Discord/email. BLOCKED:
│            provider apps/secrets; guest+session flow already live (§26)
├── B7.3 🚫 TLS / ingress — wss:// termination at LB. BLOCKED: certs/infra
├── B7.4 ⬜ Horizontal scale — pinned worker process per match over IPC (§32)
├── B7.5 🚫 Telemetry — wire metrics/log to real sinks + §41 KPI dashboard.
│            BLOCKED: sink provisioning
├── B7.6 🚫 Moderation pipeline — maintained locale-aware blocklist + human
│            review. BLOCKED: external list/process (§30)
├── B7.7 🚫 Legal/compliance — ToS, privacy, GDPR deletion, age gating
├── B7.8 🚫 Payment gateway — money-priced recap frames (§36). BLOCKED: PSP
└── B7.9 🚫 Balance validation — human playtests + nightly botleague tuning
             of balance.json. BLOCKED: needs real players (§41)
```

**Spine parity note (Full-Stack Coverage Rule):** every backend capability has
its frontend consumer (REST API ↔ menu.ts screens; WS protocol ↔ net.ts/hud.ts;
sim intents ↔ HUD controls) except server `sendChat` — its missing consumer is
tracked as **B4.4.3**, not hidden. No catch-all UI nodes remain.
