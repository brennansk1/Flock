/**
 * TUTORIAL (§26): a scripted, fully OFFLINE first match — the same for
 * everyone. No server, no matchmaking: the deterministic @flock/sim runs
 * locally on a fixed seed with one deliberately sleepy rival bot, while a
 * step engine walks the player through the core loop, gating each step on
 * REAL sim state (found → front → stance → ritual → build → land → van →
 * tower → doctrine → convert). Doubles as a gameplay QA harness: every step
 * exercises a live system on a reproducible world.
 */

import {
  loadBalance,
  createSim,
  generateWorld,
  step,
  seedRng,
  botTurn,
  botShouldAct,
  fromInt,
  Stance,
  MatchStatus,
  type RawBalance,
  type Intent,
  type BotState,
} from "@flock/sim";
import type { GameSession, ConnectHooks } from "./net.js";
import rawBalance from "../../../balance.json";

/** One world for every player, forever: the tutorial town. */
const TUTORIAL_SEED = 42;
const WORLD = 64;
const FOUNDING_TICKS = 60; // ~6s window, then the gate holds for the player
const TPS_MS = 100;

const RIVAL_ID = 2;
const RIVAL_SPAWN_TILE = 52 * WORLD + 52; // far corner — snaps to open land

/**
 * Build the offline session. Same signature shape as net.connect so main.ts
 * can swap connectors; `url` is ignored.
 */
export function connectTutorial(
  _url: string,
  onReady: (g: GameSession) => void,
  _hooks: ConnectHooks = {},
): void {
  const balance = loadBalance(rawBalance as RawBalance);
  const world = generateWorld(TUTORIAL_SEED, WORLD, WORLD, { townType: "farm" });
  const sim = createSim({
    seed: TUTORIAL_SEED,
    balance,
    world,
    spawns: [
      { id: 1, archetype: "dawn" },
      { id: RIVAL_ID, archetype: "radiant" },
    ],
    foundingTicks: FOUNDING_TICKS,
    dominationPermille: 720,
  });

  const pending: Intent[] = [];
  // the rival: a drifter that acts rarely — presence, not pressure
  const botRng = seedRng(TUTORIAL_SEED ^ 0xb07);
  const bot: BotState = { playerId: RIVAL_ID, tier: "drifter", cadence: 16, aggression: 0, grudge: 0 } as BotState;
  let rivalSpawned = false;

  const g: GameSession = {
    sim,
    balance,
    playerId: 1,
    players: [
      { id: 1, name: "You", archetype: "dawn" },
      { id: RIVAL_ID, name: "The Radiant Path", archetype: "radiant", bot: true },
    ],
    chat: [{ from: 0, msg: "TUTORIAL — offline practice town. Nothing here is ranked." }],
    paused: false,
    sendPause: (v: boolean) => {
      g.paused = v;
    },
    sendIntent: (intent) => {
      pending.push({ ...intent, player: 1 } as Intent);
    },
    sendChat: (msg: string) => {
      g.chat.push({ from: 1, msg });
      if (g.chat.length > 50) g.chat.shift();
    },
  };

  // the local lockstep: one deterministic Turn per 100ms
  const timer = setInterval(() => {
    if (g.paused || sim.status === MatchStatus.Ended) return;
    const intents = pending.splice(0, pending.length);
    if (!rivalSpawned) {
      intents.push({ t: "SPAWN", player: RIVAL_ID, tile: RIVAL_SPAWN_TILE } as Intent);
      rivalSpawned = true;
    }
    if (sim.foundingTicksLeft === 0 && botShouldAct(bot, sim.tick)) {
      intents.push(...botTurn(sim, bot, botRng));
    }
    step(sim, { n: sim.tick, intents, seedSlice: (sim.tick * 2654435761) >>> 0 }, balance);
  }, TPS_MS);
  window.addEventListener("beforeunload", () => clearInterval(timer));

  onReady(g);
}

// ─────────────────────────────────────────────── the step engine ──────────

interface TutStep {
  title: string;
  body: string;
  /** advance when this reads true (checked every 150ms); omit for a NEXT button */
  done?: (g: GameSession) => boolean;
  /** CSS selector to pulse while the step is active */
  glow?: string;
  /** one-shot setup when the step becomes active (grants, nudges) */
  enter?: (g: GameSession) => void;
  /** extra help shown automatically if the player is stuck ~40s */
  hint?: string;
}

const money = (g: GameSession, usd: number): void => {
  const p = g.sim.players.find((pl) => pl.id === 1);
  if (p && p.usd < fromInt(usd)) p.usd = fromInt(usd);
};
const faith = (g: GameSession, f: number): void => {
  const p = g.sim.players.find((pl) => pl.id === 1);
  if (p && p.faith < fromInt(f)) p.faith = fromInt(f);
};
const me = (g: GameSession) => g.sim.players.find((pl) => pl.id === 1);

const STEPS: TutStep[] = [
  {
    title: "WELCOME TO MUNDANE FALLS",
    body: "A quiet town of unconverted souls — and you, a cult leader with a folding table and a dream. This is a private practice town: no other players, no rankings, one sleepy rival. Click NEXT.",
  },
  {
    title: "FOUND YOUR COMPOUND",
    body: "Click one of the GLOWING RINGS on the open land near town. Your cult buys the parcel, the First Compound rises, and your congregation is bused in.",
    hint: "The rings pulse on OPEN LAND just outside the streets — not inside town, not on water.",
    done: (g) => !!me(g)?.spawned,
  },
  {
    title: "READ THE ROOM",
    body: "Top bar: your FLOCK, TREASURY, FAITH, HEAT, the match clock, and the LEADER share. The colored strip at the very top is the whole town's soul-count — grow your slice. Click NEXT.",
    glow: ".fk-top",
  },
  {
    title: "OPEN A FRONT",
    body: "Conversion happens along FRONTS. Click a spot at the EDGE OF TOWN near your compound to commit your followers there.",
    hint: "Click ON the houses at the town edge closest to your compound — a dotted region marks the front.",
    done: (g) => g.sim.fronts.some((f) => f.player === 1),
  },
  {
    title: "PREACH — CAST SERMON",
    body: "Rituals build or spend FAITH. Click SERMON in the RITUALS panel (or press Q) — a free faith boost with a short cooldown. Preaching needs calm: it only works in TEND or SPREAD.",
    glow: '[data-cd="sermon"]',
    done: (g) => ((me(g)?.cooldowns ?? {})["sermon"] ?? 0) > 0,
  },
  {
    title: "SET YOUR TEMPO — CRUSADE",
    body: "Stances trade growth for pressure. Click CRUSADE (or press 3): maximum conversion, but HEAT climbs, the town notices — and you can't Sermon mid-Crusade. Ease back to SPREAD when it runs hot.",
    glow: '[data-stance="crusade"]',
    done: (g) => me(g)?.stance === Stance.Crusade,
  },
  {
    title: "PASS THE PLATE",
    body: "We wired $30,000 to your treasury (tutorial magic). In the BUILD tray, click PLATE, then click a tile INSIDE YOUR STAKED PARCEL (the ground around your compound) — Collection Plates tithe the converted.",
    hint: "The plate must sit on YOUR land: the staked parcel around your compound, or any tile you\u2019ve converted. If you miss, the tool stays armed — just click again.",
    glow: '[data-build="collection_plate"]',
    enter: (g) => money(g, 30_000),
    done: (g) => g.sim.buildings.some((b) => b.player === 1 && b.type === "collection_plate"),
  },
  {
    title: "BUY LAND",
    body: "Compounds need room. Click BUY LAND in the tray, then click open country beside your parcel — your empire grows one deed at a time.",
    hint: "Aim for unclaimed GRASS or FIELD right next to your stakes — not town streets, not water.",
    glow: "[data-land]",
    enter: (g) => money(g, 30_000),
    done: (g) => (me(g)?.parcels ?? 0) >= 2,
  },
  {
    title: "SEND THE VAN",
    body: "Recruitment Vans convert as they roll. In SCHEME, click VAN, then click a street in town. Long routes earn more — and get robbed more.",
    hint: "Any road tile in town works — the van buys itself and starts rolling.",
    glow: '[data-scheme="van"]',
    enter: (g) => money(g, 40_000),
    done: (g) => g.sim.vans.some((v) => v.player === 1),
  },
  {
    title: "RAISE A WATCHTOWER",
    body: "Rivals raid. Click TOWER in the BUILD tray and place it on your land — 5× fort defense, and it unmasks enemy agents.",
    hint: "Same rule as the plate: YOUR parcel or converted tiles only.",
    glow: '[data-build="watchtower"]',
    enter: (g) => money(g, 30_000),
    done: (g) => g.sim.buildings.some((b) => b.player === 1 && b.type === "watchtower"),
  },
  {
    title: "WRITE THE DOCTRINE",
    body: "Your flock hit a milestone (another tutorial gift) — you have a DOCTRINE point. Click DOCTRINE and pick any node in the B.I.T.E. grid. Picks are permanent.",
    glow: ".fk-doc",
    enter: (g) => {
      const p = me(g);
      if (p) p.maxFollowers = fromInt(2_000); // milestone: 1 point earned
      faith(g, 50);
    },
    done: (g) => (me(g)?.doctrine.length ?? 0) >= 1,
  },
  {
    title: "CONVERT THE TOWN",
    body: "Everything at once now: keep a front open, stay in CRUSADE or SPREAD, cast SERMON when it's free. Convert 30 HOUSEHOLDS to finish your training.",
    hint: "Open fronts where the town touches your territory. Watch the LEADER % climb — Sermon whenever it\u2019s free.",
    done: (g) => (me(g)?.ownedTiles ?? 0) >= 30,
  },
  {
    title: "YOU ARE READY",
    body: "That's the loop: found → press fronts → manage heat → tithe → expand → armor up → doctrine. The real town has real rivals — scheme accordingly. Click NEXT to return to the menu.",
  },
];

/** Mount the guided overlay and run the steps against the live session. */
export function startTutorial(g: GameSession): void {
  const root = document.getElementById("app")!;
  const style = document.createElement("style");
  style.textContent = `
@keyframes fkTutPulse{0%,100%{box-shadow:0 0 0 2px #f0b53e,0 4px 0 #060403}50%{box-shadow:0 0 0 5px #f0b53e,0 4px 0 #060403}}
.fk-tut-glow{animation:fkTutPulse 1.1s infinite;position:relative;z-index:9}
.fk-reduced-motion .fk-tut-glow{animation:none;box-shadow:0 0 0 4px #f0b53e,0 4px 0 #060403}
#fk-tut{position:absolute;top:96px;left:50%;transform:translateX(-50%);z-index:28;width:470px;max-width:92vw;
  background:#1a130b;border:3px solid #f0b53e;box-shadow:0 6px 0 #060403,inset 0 0 0 2px #36291a;
  font-family:'Pixelify Sans',ui-monospace,monospace;color:#efe3c6}
#fk-tut .hd{display:flex;justify-content:space-between;align-items:center;background:#f0b53e;color:#19110a;
  padding:7px 12px;font-family:'Press Start 2P',monospace;font-size:9px;letter-spacing:1px}
#fk-tut .bd{padding:13px 15px;font-size:14px;line-height:1.45;color:#d8c8a6}
#fk-tut .ft{display:flex;justify-content:flex-end;gap:8px;padding:0 15px 13px}
#fk-tut button{font-family:'Pixelify Sans',monospace;font-size:13px;font-weight:700;letter-spacing:.5px;
  padding:7px 18px;border:0;cursor:pointer;background:#f0b53e;color:#19110a;box-shadow:0 3px 0 #060403}
#fk-tut button.ghost{background:#241c12;color:#a08a64;box-shadow:inset 0 0 0 1px #4a3a26,0 3px 0 #060403}
#fk-tut .done{color:#9bbf6a;font-family:'VT323',monospace;font-size:18px;padding:0 15px 10px;display:none}`;
  document.head.appendChild(style);

  const card = document.createElement("div");
  card.id = "fk-tut";
  root.appendChild(card);

  let idx = 0;
  let glowEl: Element | null = null;
  let advanceTimer = 0;
  let stepStartedAt = Date.now();
  let hintShown = false;

  const setGlow = (sel?: string): void => {
    glowEl?.classList.remove("fk-tut-glow");
    glowEl = sel ? document.querySelector(sel) : null;
    glowEl?.classList.add("fk-tut-glow");
  };

  const render = (): void => {
    const s = STEPS[idx]!;
    const last = idx === STEPS.length - 1;
    const gated = !!s.done;
    card.innerHTML = `
      <div class="hd"><span>TUTORIAL · STEP ${idx + 1}/${STEPS.length}</span><span>${gated ? "DO IT ▸" : ""}</span></div>
      <div class="bd">${s.title ? `<div style="font-weight:700;font-size:16px;color:#efe3c6;margin-bottom:6px;letter-spacing:.8px">${s.title}</div>` : ""}${s.body}</div>
      <div class="done" id="fk-tut-done">✓ nicely done</div>
      <div id="fk-tut-hint" style="display:none;padding:0 15px 12px;font-family:'VT323',monospace;font-size:17px;line-height:1.3;color:#e0a422"></div>
      <div class="ft">
        <button class="ghost" id="fk-tut-skip">${last ? "" : "SKIP TUTORIAL"}</button>
        ${gated ? "" : `<button id="fk-tut-next">${last ? "FINISH" : "NEXT"}</button>`}
      </div>`;
    const skip = card.querySelector<HTMLButtonElement>("#fk-tut-skip")!;
    if (last) skip.style.display = "none";
    skip.onclick = () => {
      if (confirm("Skip the tutorial and return to the menu?")) location.search = "";
    };
    const next = card.querySelector<HTMLButtonElement>("#fk-tut-next");
    if (next) next.onclick = () => (last ? (location.search = "") : advance());
    setGlow(s.glow);
    s.enter?.(g);
    stepStartedAt = Date.now();
    hintShown = false;
  };

  const advance = (): void => {
    idx++;
    if (idx >= STEPS.length) {
      location.search = "";
      return;
    }
    render();
  };

  // auto-advance loop for gated steps: brief ✓ flash, then the next card
  const loop = window.setInterval(() => {
    const s = STEPS[idx];
    if (!s?.done || advanceTimer) return;
    // stuck? surface the step's hint after 40 seconds
    if (!hintShown && s.hint && Date.now() - stepStartedAt > 40_000) {
      hintShown = true;
      const h = card.querySelector<HTMLElement>("#fk-tut-hint");
      if (h) {
        h.textContent = "▸ " + s.hint;
        h.style.display = "block";
      }
    }
    if (s.done(g)) {
      const flash = card.querySelector<HTMLElement>("#fk-tut-done");
      if (flash) flash.style.display = "block";
      advanceTimer = window.setTimeout(() => {
        advanceTimer = 0;
        advance();
      }, 900);
    }
  }, 150);
  window.addEventListener("beforeunload", () => clearInterval(loop));

  render();
}
