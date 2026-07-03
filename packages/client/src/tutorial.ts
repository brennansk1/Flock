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
  type Archetype,
} from "@flock/sim";
import type { GameSession, ConnectHooks } from "./net.js";
import { getSettings } from "./settings.js";
import rawBalance from "../../../balance.json";

/** One world for every player, forever: the tutorial town. */
const TUTORIAL_SEED = 42;
const WORLD = 64;
const FOUNDING_TICKS = 120; // ~12s window — gives new players time to read Step 2
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
  const q = new URLSearchParams(location.search);
  const playerArch = (q.get("archetype") ?? "dawn") as Archetype;
  const playerName = q.get("name") ?? "Novice";
  const balance = loadBalance(rawBalance as RawBalance);
  const world = generateWorld(TUTORIAL_SEED, WORLD, WORLD, { townType: "farm" });
  const settings = getSettings();
  const sim = createSim({
    seed: TUTORIAL_SEED,
    balance,
    world,
    spawns: [
      { id: 1, archetype: playerArch },
      { id: RIVAL_ID, archetype: "radiant" },
    ],
    foundingTicks: FOUNDING_TICKS,
    dominationPermille: 720,
    disableCouriers: settings.disableCouriers,
    disableCPA: settings.disableCPA,
    disableSchisms: settings.disableSchisms,
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
      { id: 1, name: playerName, archetype: playerArch },
      { id: RIVAL_ID, name: "The Sleeper Cult", archetype: "radiant", bot: true },
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
    body: "A quiet town of unconverted souls — and you, a cult leader with a folding table and a dream. Your goal: convert more of the town than the rival bot before time runs out. This is a private practice session: offline, unranked, the same for everyone. Click NEXT.",
  },
  {
    title: "FOUND YOUR COMPOUND",
    body: "Click one of the GLOWING RINGS on the open land near town. Your cult buys the parcel, the First Compound rises, and your congregation is bused in. Check the top bar once you're in: FLOCK size, TREASURY, FAITH, HEAT, and the share strip at the very top — grow your slice to win.",
    hint: "The rings pulse on OPEN LAND just outside the streets — not inside town, not on water. You have ~12 seconds.",
    done: (g) => !!me(g)?.spawned,
  },
  {
    title: "YOUR HUD AT A GLANCE",
    body: "The colored bar at the very top shows everyone's town share — grow your slice to win. Below it: FLOCK size, TREASURY ($), FAITH (✛), and HEAT (⚠). Keep Heat below 60 or the Concerned Parents Association will harass your compound. Click NEXT.",
    glow: ".fk-top",
  },
  {
    title: "OPEN A FRONT",
    body: "Conversion happens along FRONTS. Once the founding window closes, click on the MAP near the EDGE OF TOWN closest to your compound — a dotted border marks your active front.",
    hint: "Click directly on the town tiles at the edge nearest your compound. The founding window must close first (watch the top-center message).",
    done: (g) => g.sim.foundingTicksLeft === 0 && g.sim.fronts.some((f) => f.player === 1),
  },
  {
    title: "PREACH — CAST SERMON",
    body: "Rituals build or spend FAITH. Click SERMON in the RITUALS panel (or press Q) — it's free and gives a short conversion boost. Short cooldown, cast it often.",
    glow: '[data-cd="sermon"]',
    done: (g) => ((me(g)?.cooldowns ?? {})["sermon"] ?? 0) > 0,
  },
  {
    title: "SET YOUR TEMPO — CRUSADE",
    body: "Press 3 or click CRUSADE — maximum conversion pressure. Watch Heat climb. Now press 2 to switch back to SPREAD before the next step (if Heat hits 60, the town retaliates). TEND (1) heals dissent and cools things down fastest.",
    glow: '[data-stance="crusade"]',
    done: (g) => me(g)?.stance === Stance.Crusade,
  },
  {
    title: "UNLEASH YOUR POWER",
    body: "Each archetype has a signature active power. Click the FIRST button in the CULT POWERS panel — it arms your power — THEN click a house in town to unleash it (Street Prophet, Juice Cleanse, Seminar Blitz, or Crop Circle land where you click). We've granted you the cash to try it.",
    glow: ".fk-pow",
    enter: (g) => money(g, 60_000),
    hint: "Two clicks: the D power button first (it lights up), then a town tile to fire it. If nothing happens, you clicked the button but not a target yet.",
    done: (g) => {
      const p = me(g);
      if (!p) return false;
      const cds = ["street_prophet", "juice_cleanse", "seminar_blitz", "crop_circle"];
      return cds.some((c) => (p.cooldowns[c] ?? 0) > 0);
    },
  },
  {
    title: "PASS THE PLATE",
    body: "$30,000 wired to your treasury. In the BUILD tray, click PLATE, then click any tile on YOUR LAND (the area staked around your compound, shown with a faint border) — Collection Plates tithe your converted followers.",
    hint: "Place the plate on YOUR land: your staked compound area or any tile you've converted. The tool stays armed on a miss — just click again.",
    glow: '[data-build="collection_plate"]',
    enter: (g) => money(g, 30_000),
    done: (g) => g.sim.buildings.some((b) => b.player === 1 && b.type === "collection_plate"),
  },
  {
    title: "BUY LAND",
    body: "Compounds need room to grow. Click BUY LAND in the tray, then click ONE parcel of open country right beside your compound — you'll deed it and expand your reach.",
    hint: "Aim for unclaimed GRASS or FIELD directly adjacent to your stakes — not town streets or water.",
    glow: "[data-land]",
    enter: (g) => money(g, 30_000),
    done: (g) => (me(g)?.parcels ?? 0) >= 2,
  },
  {
    title: "SEND THE VAN",
    body: "Recruitment Vans roll through town and convert as they go. In the SCHEME panel, click VAN, then click any road tile in town. Longer routes convert more households — and attract more thieves.",
    hint: "Click VAN in the SCHEME panel, then click any road tile inside town. The van is bought automatically.",
    glow: '[data-scheme="van"]',
    enter: (g) => money(g, 40_000),
    done: (g) => g.sim.vans.some((v) => v.player === 1),
  },
  {
    title: "RAISE A WATCHTOWER",
    body: "The Sleeper Cult could flip your tiles while you're not watching. A Watchtower makes your land 5× harder to steal and reveals enemy agents operating in your territory. Click TOWER in BUILD and place it on your land.",
    hint: "Same placement rule as the plate: your staked parcel or any converted tile.",
    glow: '[data-build="watchtower"]',
    enter: (g) => money(g, 30_000),
    done: (g) => g.sim.buildings.some((b) => b.player === 1 && b.type === "watchtower"),
  },
  {
    title: "MANAGE DISSENT & HEAT",
    body: "Conversion along fronts exposes your followers to ATTRITION. Captured tiles build DISSENT in that district (which can trigger a SCHISM split, if enabled). High global HEAT (>60) alerts the Concerned Parents Association (CPA) to picket you with minivans (if enabled). Switch to TEND stance (1) now to cool dissent and Heat.",
    glow: '[data-stance="tend"]',
    done: (g) => me(g)?.stance === Stance.Tend,
  },
  {
    title: "DISSENT OVERLAY",
    body: "You can visualize per-district dissent directly on the map. Press H or click the DISSENT button in the bottom tray to toggle the red heatmap overlay. Try toggling it now to see where dissent is concentrated, then click NEXT.",
    glow: "#fk-dissent-overlay",
  },
  {
    title: "WRITE THE DOCTRINE",
    body: "Tutorial gift: a DOCTRINE point. Open the DOCTRINE panel and choose any node — each permanently upgrades your cult. The four tracks (Behavior, Information, Thought, Emotion) shape your long-term strategy. Picks are forever.",
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
    body: "Everything at once: keep a front open, stay in CRUSADE or SPREAD, cast SERMON when it cools down. Reach 30 owned tiles to finish your training.",
    hint: "Open fronts where the town edge touches your territory. Watch the LEADER % strip up top — cast Sermon whenever it's free.",
    done: (g) => (me(g)?.ownedTiles ?? 0) >= 30,
  },
  {
    title: "YOU ARE READY",
    body: "That's the loop! Remember the three ways to win a match: (1) DOMINATION: control 72% of the town's tiles; (2) DOCTRINAL: hold 100 Faith for 90s, then capture and channel at the Megachurch landmark; (3) ECONOMIC: reach the USD target (for Prosperity Circle). Rivals will strike back — scheme wisely. Click FINISH to return to the menu.",
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
        <button class="ghost" id="fk-tut-skip">${last ? "" : "SKIP"}</button>
        ${gated ? "" : `<button id="fk-tut-next">${last ? "FINISH" : "NEXT"}</button>`}
      </div>
      <div id="fk-tut-skip-confirm" style="display:none;padding:0 15px 12px;font-size:13px;color:#efe3c6">
        Exit tutorial? <button id="fk-tut-skip-yes" style="margin-left:8px;font-family:'Pixelify Sans',monospace;font-size:12px;font-weight:700;padding:4px 12px;border:0;cursor:pointer;background:#cf4b2c;color:#fff;box-shadow:0 2px 0 #060403">YES, EXIT</button>
        <button id="fk-tut-skip-no" style="margin-left:6px;font-family:'Pixelify Sans',monospace;font-size:12px;padding:4px 12px;border:0;cursor:pointer;background:#241c12;color:#a08a64;box-shadow:inset 0 0 0 1px #4a3a26,0 2px 0 #060403">KEEP GOING</button>
      </div>`;
    const skip = card.querySelector<HTMLButtonElement>("#fk-tut-skip")!;
    if (last) skip.style.display = "none";
    skip.onclick = () => {
      const conf = card.querySelector<HTMLElement>("#fk-tut-skip-confirm");
      if (conf) conf.style.display = conf.style.display === "block" ? "none" : "block";
    };
    const skipYes = card.querySelector<HTMLButtonElement>("#fk-tut-skip-yes");
    if (skipYes) skipYes.onclick = () => (location.search = "");
    const skipNo = card.querySelector<HTMLButtonElement>("#fk-tut-skip-no");
    if (skipNo) skipNo.onclick = () => { const conf = card.querySelector<HTMLElement>("#fk-tut-skip-confirm"); if (conf) conf.style.display = "none"; };
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
