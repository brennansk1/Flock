# FLOCK — Production Operations & Deployment Guide

This guide outlines deployment architecture, environment configurations, Docker orchestration, and hosting operations for running **FLOCK** as a multiplayer web service.

---

## 1. Hosting Architecture

```
                       ┌────────────────────────────────────────┐
  Browser  ──wss──▶    │  @flock/server (Node.js 22 LTS)        │
  (Client)             │                                        │
                       │  HTTP  /health ───────────────┐        │
                       │  WS upgrade → auth handshake  │        │
                       │       │                       ▼        │
                       │       ▼                  Structured    │
                       │  LobbyDirector ──┬── MatchWorker A     │
                       │       │          ├── MatchWorker B     │
                       │       ▼          └── MatchWorker …     │
                       │     Store ◀── persistMatch (Glicko-2)  │
                       │  (accounts, ratings, history, replays) │
                       └────────────────────────────────────────┘
```

* **Authoritative Relay**: `@flock/server` runs the 100ms lockstep tick, collecting player intents, stepping the simulation, and broadcasting state turn packets.
* **MatchWorker**: Manages an individual match instance (bot backfill, turn execution, snapshot resyncs on packet loss).
* **LobbyDirector**: Dynamic match routing, match creation, and post-game Glicko-2 FFA rating calculations.
* **Persistence**: Pluggable storage seam (`InMemoryStore` for zero-dependency local testing, `JsonFileStore` for persistent disk volume mounts).

---

## 2. Configuration & Environment Variables

Create `.env` from `.env.example`:

| Variable | Default | Description |
|---|---|---|
| `FLOCK_SECRET` | — | **Required in production** ($\ge 16$ characters). Cryptographic key used to sign HMAC session tokens. |
| `FLOCK_DATA` | *unset* | Path to persistent storage directory. When unset, defaults to memory store. |
| `PORT` | `8787` | HTTP and WebSocket port. |
| `WORLD` | `96` | Map dimensions ($96\times 96$ standard). |
| `BOTS` | `6` | Number of AI bot players to backfill per match. |
| `CAPACITY` | `20` | Max human players per room before spawning a new match instance. |
| `LOG_LEVEL` | `info` | Structured logging verbosity (`debug`, `info`, `warn`, `error`). |

---

## 3. Deployment Commands

### Development Setup
```bash
npm install
npm run build -w @flock/sim
npm run dev
```

### Production Build & Launch
```bash
npm run build
npm run start -w @flock/server
```

### Docker Containerization
```bash
docker build -t flock-server .
docker run -p 8787:8787 -e FLOCK_SECRET="production-super-secret-key" -v flock-data:/data -e FLOCK_DATA="/data" flock-server
```
