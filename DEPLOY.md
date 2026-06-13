# FLOCK — Production & Operations Guide

How to run FLOCK as a hosted multiplayer service, how the pieces fit, and the
honest list of what still needs real infrastructure or content before a public
launch. For the game design see [DESIGN.md](./DESIGN.md); for the repo overview
see [README.md](./README.md).

---

## Architecture (§32–34)

```
                       ┌────────────────────────────────────────┐
  browser  ──wss──▶    │  @flock/server (Node 22)               │
  (client)            │                                          │
                       │  HTTP  /health  ──────────────┐         │
                       │  WS upgrade → auth handshake   │         │
                       │       │                        ▼         │
                       │       ▼                   Metrics/logs   │
                       │  LobbyDirector ──┬── MatchWorker (match A)│
                       │     │            ├── MatchWorker (match B)│
                       │     │            └── MatchWorker (match …)│
                       │     ▼                                     │
                       │   Store  ◀── persistMatch (ratings/XP/    │
                       │  (accounts, ratings, history, replays)    │
                       └────────────────────────────────────────┘
```

- **Deterministic sim** (`@flock/sim`) runs bit-identically on client and
  server. Same seed + same intents ⇒ same `StateHash`. This invariant is the
  CI gate; if it breaks, lockstep is unsafe.
- **MatchWorker** owns one match's authoritative 10 Hz lockstep loop: drain
  intents → `Turn` → `step` → broadcast. It bots-backfills, moderates chat,
  serves snapshot **resyncs** on desync, and reports results at END.
- **LobbyDirector** owns many workers: routes each authenticated connection
  into a joinable match (capacity-based) or opens a new one, and on END runs
  `persistMatch` — real Glicko-2 FFA rating updates + XP/Relic progression +
  match record + replay archive, then recomputes the Prophet-tier cut.
- **Store** is the persistence seam: `InMemoryStore` (default) and
  `JsonFileStore` (durable dev) ship today; a Postgres + object-store adapter
  drops in without touching game code.
- **AuthService** mints instant guest identities (no account wall, §26) and
  verifies stateless HMAC-signed sessions; OAuth providers plug in via
  `AuthProvider`.

## Configuration (env)

Copy `.env.example` → `.env`. Key vars:

| Var | Default | Notes |
|---|---|---|
| `FLOCK_SECRET` | — | **Required in prod**, ≥16 chars. Signs sessions; rotating it logs everyone out. A weak value throws on boot. |
| `FLOCK_DATA` | unset | Directory for durable JSON store. Unset = in-memory (data lost on restart). Mount a volume here. |
| `PORT` | 8787 | HTTP/WS port. |
| `WORLD` | 96 | Map tiles per side. |
| `BOTS` / `CHURCHES` | 6 / 1 | Bot backfill per match (§21). |
| `FOUNDING` | 200 | Founding spawn-pick window (ticks). |
| `CAPACITY` | 20 | Human seats before a new match opens. |
| `LOG_LEVEL` | info | `debug\|info\|warn\|error`; logs are one JSON object per line. |

## Run it

```bash
# local dev (in-memory store, hot reload)
npm install && npm run build
FLOCK_SECRET=dev-secret-please-change npm run dev:server
npm run dev:client            # http://localhost:5173

# production-shaped stack (server + nginx-served client + WS proxy)
FLOCK_SECRET=$(openssl rand -hex 24) docker compose -f deploy/docker-compose.yml up --build
# client on http://localhost:8080, server health on :8787/health
```

`/health` returns uptime + counters/gauges (matches live/created/ended,
players joined) for load-balancer probes and dashboards.

## Quality gates

```bash
npm test                       # determinism + sim + server services (CI gate)
node tools/botleague.mjs       # nightly balance: per-archetype win-rate drift (§40/§41)
node tools/soak.mjs 50 30      # load/desync soak: N clients fuzz intents, assert desync SLA
node tools/screenshots.mjs     # headless map renders
node tools/recapcard.mjs       # headless Recap Card PNG
```

CI (`.github/workflows/ci.yml`) runs build + the determinism/lockstep gate on
every push.

## Security posture

- Server is the sole authority; clients send only intents, identity is the
  socket's (never the payload's).
- Intents are **defensive by construction** (illegal = no-op) and array intents
  are length-capped (`OPEN_FRONT`, `VAN_MOVE`) so a hostile client can't force
  unbounded work at the 20/s rate limit.
- Sessions are HMAC-signed and verified in constant time.
- Names and chat pass a moderation filter (leetspeak-aware); failed names fall
  back to `Sect #id` (§30).

---

## Before a public launch — still required

These are **infrastructure/content**, not game logic. The code seams exist; the
production side needs provisioning or assets:

1. **Datastore adapter** — implement `Store` against Postgres + object storage
   for replays (the JSON adapter is dev-only; no concurrency control).
2. **OAuth providers** — implement `AuthProvider.verify` for Google/Discord/
   email against their APIs; secrets via env. Guest + sessions already work.
3. **TLS / ingress** — terminate `wss://` at the load balancer; the nginx
   sample proxies but ships no certs.
4. **Horizontal scale** — the single-process Director hosts many matches in
   threads today; the production split is one pinned worker *process* per match
   behind the Director over IPC (the seam is in place).
5. **Cross-browser determinism CI** — current CI runs Node only; add headless
   Chromium + Firefox runs of the determinism gate (§40).
6. **Telemetry & dashboards** — wire `Metrics`/`log` to your metrics/log sinks;
   build the KPI dashboard (§41: K-factor, D1/D7, queue time, win-rate bands).
7. **Moderation pipeline** — replace the seed blocklist with a maintained,
   locale-aware list + human-review queue for flagged names/chat.
8. **Legal/compliance** — ToS, privacy policy, GDPR/account-deletion, age
   gating (required once accounts exist).
9. **Content** — audio (§31) and the ~40 sprite animations (§30) are
   asset-production work; the renderer is procedural pixel art today (QA'd for a
   professional read). M/L maps need playtest validation. The store, Daily
   Prophecy, and Congregations systems are implemented (§22/§23/§24/§36) — what
   remains is cosmetic *content* (recolors, frames, banners) and the payment
   gateway behind money-priced items.
10. **Steam/Electron wrap** (§35) if targeting Steam EA.
