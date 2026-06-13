# FLOCK — Engineering Handoff

_Last updated: 2026-06-13. This document is the single onboarding entry point for
anyone picking up FLOCK. Read it top to bottom once; then keep
[DESIGN.md](./DESIGN.md) (the spec), [DEPLOY.md](./DEPLOY.md) (ops), and
[README.md](./README.md) (quickstart) open as references._

---

## 1. What FLOCK is

A browser-first competitive multiplayer **cult-builder** — `.io` territory
strategy × Cult of the Lamb. You convert a realistic pixel small town
("Mundane Falls, USA") rather than conquering it: hearts, pamphlets, and
spirals, never violence. 8–20 players per match, ~10–20 minute games,
asymmetric archetypes, lockstep-deterministic simulation.

The whole thing rides on **one invariant**: *same seed + same intents ⇒ same
StateHash*, bit-identically on every client and the server. Everything else is
built on top of that contract. **If you break it, the game is broken** — see §4.

## 2. Current status (honest)

The **game logic, netcode, hosted-service layer, meta systems, and client UX are
implemented and tested**. What remains before a public launch is **external
infrastructure to provision and authored content (art/audio)** — not code. See
§8 for the precise line.

- **Tests:** sim 60, server 10 (incl. a live-WebSocket lockstep smoke test) — all green.
- **Build:** `npm run build` clean across all three packages.
- **Verified live this cycle:** 12 concurrent WS clients fuzzing 1,600+ intents → **0 desyncs**; HTTP API; persistence; bot-league.
- **~12k LOC** of TypeScript across sim/server/client.

## 3. Repository layout

TypeScript monorepo, npm workspaces. Node 22.

```
packages/sim     @flock/sim    Deterministic core — runs identically client & server
packages/server  @flock/server Node match host: lobby, workers, persistence, auth, API
packages/client  @flock/client Vite + PixiJS web client: renderer, prediction, HUD, menus
tools/                         Headless dev/QA scripts (screenshots, balance, soak, sprites)
DESIGN.md  DEPLOY.md  README.md  HANDOFF.md(this)  balance.json(tuning, hot-patchable)
```

### `@flock/sim` (the deterministic core — fixed-point only, no floats in sim scope)
| File | Role |
|---|---|
| `fixed.ts` | Q16.16 fixed-point math (the only number type in sim scope) |
| `rng.ts` | Seeded xoshiro RNG (all randomness flows through the turn stream) |
| `types.ts` | `SimState`, `World` (struct-of-arrays), enums (Terrain/Lot/Stance/…) |
| `intents.ts` | The Intent protocol (discriminated union) + `Turn` |
| `sim.ts` | `createSim`/`step`/`applyIntent`, the per-tick loop, `KIT` (ability table) |
| `conversion.ts` | The combat system (§4): fronts, pressure, flips, attrition |
| `hash.ts` | `hashState` — the lockstep StateHash (the CI gate) |
| `snapshot.ts` | `toSnapshot`/`fromSnapshot` — join/resync codec |
| `mapgen.ts` | Seeded map: districts, roads (tensor-field), river, farms, landmarks |
| `tensorRoads.ts` | Tensor-field road network generation |
| `buildings.ts` `doctrine.ts` `diplomacy.ts` `entities.ts` `player.ts` | M1 systems (§6/§10/§16/§7) |
| `bots.ts` | 3 bot tiers (Drifter/Sect/Established Church) — pure, unit-tested |
| `recap.ts` `recapCard.ts` | Match recap data + the 1080×1350 share-card renderer (§25) |
| `ranked.ts` `progression.ts` `daily.ts` `economy.ts` | META (outside lockstep): Glicko-2, XP/relics, Daily Prophecy, store |
| `palette.ts` `townRender.ts` | Shared pixel renderer (SimState → RGBA), identical on client & headless |

### `@flock/server`
| File | Role |
|---|---|
| `index.ts` | Entry: HTTP (`/health` + REST API) + WS upgrade + auth handshake |
| `lobby.ts` | **LobbyDirector**: many concurrent matches, routing, `persistMatch` |
| `matchWorker.ts` | One match's authoritative 10 Hz lockstep loop |
| `store.ts` | `Store` interface + `InMemoryStore` + durable `JsonFileStore` |
| `auth.ts` | Guest identities + HMAC sessions + pluggable `AuthProvider` |
| `moderation.ts` | Leetspeak-aware name/chat filter |
| `congregations.ts` | Clans (§24): membership + weekly best-10 ladder |
| `metrics.ts` | Structured JSON logging + counters/gauges |
| `protocol.ts` | Wire message types (client↔server) |

### `@flock/client`
| File | Role |
|---|---|
| `main.ts` | Boot, PixiJS app, input wiring, founding hints, FTUE, recap overlay |
| `net.ts` | Connect, **client-side prediction + reconciliation**, resync, auth/token |
| `render.ts` | `MapRenderer`: camera (zoom→LOD, pan), fog, screen↔tile, minimap camera API |
| `hud.ts` | The full in-match HUD (§27): rails, costs, minimap, drama feed, help |
| `menu.ts` | Lobby menu consuming the REST API (play/leaderboard/store/clans/profile/settings) |
| `settings.ts` | Accessibility prefs (reduced-motion/mute/colorblind), persisted |

## 4. THE DETERMINISM CONTRACT — read before touching `@flock/sim`

The sim must produce an identical `StateHash` from the same seed + intents on
every machine and browser. Therefore, inside **sim scope** (anything that runs
in `step()`/`applyIntent()` and feeds `hashState`):

- **No floats.** All math is Q16.16 via `fixed.ts`. (Mapgen and `townRender`/
  `recapCard` are the *cosmetic boundary* — they use floats and are **not**
  hashed. Don't import them into the tick loop.)
- **No `Math.random` / `Date` / wall-clock.** Randomness only via the seeded
  RNG, fed through `Turn.seedSlice`.
- **Iterate deterministically.** Sorted keys where order affects results
  (hashing, flips). `ProgressMap` is keyed `tile*1024 + attackerId`.
- **META modules are exempt** (`ranked/progression/daily/economy`): they score
  *finished* matches, never run in the loop, so plain float arithmetic is fine.

The gate is `packages/sim/test/determinism.test.ts` + the server
`lockstep.smoke.ts`. CI runs them on every push. **If they fail, stop and fix
before anything else.** The fastest way to introduce a desync is a stray float
or unsorted iteration in the tick path.

## 5. How to run, test, build

```bash
npm install
npm run build                 # all three packages
npm test                      # determinism gate + sim(60) + server(10)

# dev
FLOCK_SECRET=dev-secret-please-change npm run dev:server
npm run dev:client            # http://localhost:5173  (open two tabs for multiplayer)

# production-shaped stack
FLOCK_SECRET=$(openssl rand -hex 24) docker compose -f deploy/docker-compose.yml up --build
```

Per-package: `npm run build -w @flock/sim` / `-w @flock/server` / `-w @flock/client`.

### Tooling (`tools/`, all headless — no browser needed)
| Script | Purpose |
|---|---|
| `screenshots.mjs` | Render map frames of a simulated bot match → `shots/` |
| `recapcard.mjs` | Render a sample Recap Card PNG |
| `botleague.mjs [matches] [players] [world]` | Balance: per-archetype win-rate drift (§40/§41). `MAXTICKS` env caps match length |
| `soak.mjs [clients] [seconds] [url]` | Load/desync soak vs a running server (asserts desync SLA) |
| `units.mjs` | Preview the procedural unit sprites + auras |
| `spritesheet.mjs` | Render every building/landmark/lot icon in a grid for art QA |

## 6. Conventions & gotchas

- **Branch discipline:** development happens on `claude/cool-cerf-5ktjrd`;
  `main` mirrors it. Don't push to other branches without explicit instruction.
- **Commits:** imperative subject + a body explaining *why*; reference design
  sections (§N). Keep model/agent identifiers out of commit messages.
- **`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` are ON.** Array/
  record index access is `T | undefined` — assert (`x!`) or guard. For DOM
  element caches, declare named properties + an index signature (see `hud.ts`
  `ElCache`) so reads are definite.
- **XSS:** all user-sourced text (names, chat, clan names) is `esc()`-escaped
  before `innerHTML` on the client, and names have `<>` stripped server-side.
  Keep both when adding UI that shows user content.
- **Rendering is not the sim.** `townRender.ts`/`recapCard.ts` changes never
  affect determinism — safe to iterate on visuals freely.
- **Input hardening:** array intents are length-capped (`MAX_FRONT_TILES`,
  `MAX_PATH_TILES` in `sim.ts`). Any new client-array intent must be capped too.

## 7. What's implemented (by design section)

- **M0 core:** fixed-point, RNG, Intent protocol, StateHash, snapshot; conversion
  (§4), economy (§3), mapgen (§2), match flow + victory (§18), lockstep (§33).
- **M1 gameplay:** all buildings (§6), units (§7), PvP trio raids/scandal/court
  (§13/§15), strikes (§8), diplomacy + schism (§16), full doctrine tree (§10),
  all 4 archetype kits (§11), CPA (§17), 3 bot tiers (§21).
- **Client & UX:** prediction+reconciliation (§33), fog (§14), full HUD with live
  costs/affordability/cooldowns/minimap/drama-feed/help (§27/§28), loading &
  lobby screens, FTUE coachmark (§26), settings & accessibility (§28),
  founding spawn-pick (§18), Recap Card (§25).
- **Hosted service:** LobbyDirector + many concurrent matches (§32), persistence
  (§34), auth/guests/sessions (§26), moderation (§30), desync→resync (§33),
  REST API + `/health`, structured logs/metrics.
- **Meta loop:** ranked Glicko-2 (§20), XP/relic progression (§22), Daily Prophecy
  (§23), Congregations + ladder (§24), earn/spend economy + free rotation (§36).
- **Visuals:** procedural pixel art for terrain, houses, ~20 lot buildings,
  building + landmark icons, unit sprites, conversion auras, Recap Card.

## 8. What remains before public launch — external, not game logic

Each has its seam already in code; the production side needs provisioning or
authored assets. (Fuller version with "how each plugs in" is in DEPLOY.md §"Before a public launch".)

1. **Datastore** — implement `Store` against Postgres + object storage (JSON adapter is dev-only).
2. **OAuth providers** — implement `AuthProvider.verify` for Google/Discord/email; secrets via env. (Guest + sessions already work.)
3. **TLS / ingress** — terminate `wss://` at the LB; nginx sample ships no certs.
4. **Horizontal scale** — production split is one pinned worker *process* per match over IPC (seam in place).
5. **Cross-browser determinism CI** — CI runs Node only; add headless Chromium + Firefox runs of the gate.
6. **Telemetry & dashboards** — wire `metrics.ts`/`log` to real sinks; build the §41 KPI dashboard.
7. **Moderation pipeline** — replace the seed blocklist with a maintained, locale-aware list + human review.
8. **Legal/compliance** — ToS, privacy policy, GDPR/account deletion, age gating.
9. **Payment gateway** — behind the money-priced recap-frame items (relic/shard items already work).
10. **Content (artist/composer work):** audio (§31) and the ~40 frame-by-frame sprite animations (§30 — walk cycles, tile-flip sparkle, victory rapture). The renderer is procedural and QA'd for a professional read, but authored animation/audio can't be generated in code.
11. **Playtest validation** of balance (run `botleague.mjs` nightly; tune `balance.json`) and M/L maps.

## 9. Suggested next steps (highest leverage first)

1. **Playtest** the current build (`npm run dev:*`, two tabs) — the UX loop is
   complete; humans are the missing verifier the sandbox couldn't be.
2. **Postgres `Store` adapter** + schema — unlocks real persistence/ranked.
3. **Cross-browser determinism CI** — protects the core invariant on real browsers.
4. **Balance pass** via the bot-league once playtests flag outliers.
5. **In-match chat input** (server `sendChat` + relay already exist; only the
   input box is unbuilt — left out to avoid keybind-focus conflicts).
6. **Live ability (D/F/G) costs** on the HUD (builds/rituals already show them).
7. Commission **audio + sprite animation**; the render/event seams are ready.

## 10. Key risks to watch

- **Determinism drift** (a float/`Date` sneaking into sim scope) — the #1 risk;
  cross-browser CI is the missing guard.
- **Snapshot size on join** for large maps — measure/compress before L-maps.
- **Balance** — untuned by real play; the bot-league exists but hasn't been run at scale.
- **Recap renderer cost at scale** — render on share-tap, not match-end, beyond the PNG.
