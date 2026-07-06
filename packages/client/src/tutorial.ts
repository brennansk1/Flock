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
  fromInt,
  Stance,
  MatchStatus,
  type RawBalance,
  type Intent,
  type SimState,
  type Archetype,
} from "@flock/sim";
import type { GameSession, ConnectHooks } from "./net.js";
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
    // The tutorial is a CONTROLLED, DETERMINISTIC scenario: no couriers to
    // rob, no Concerned Parents raids, no random schisms — nothing that could
    // punish a learner or vary the outcome. Follow the steps and you win;
    // do nothing and the scripted rival slowly takes the town.
    disableCouriers: true,
    disableCPA: true,
    disableSchisms: true,
  });

  const pending: Intent[] = [];
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
    // the rival plays a FIXED script (no RNG): once the town wakes up it keeps
    // one steady front creeping out of its corner toward downtown. Slow enough
    // that an active player laps it; fast enough that a player who does nothing
    // gets overtaken and loses on the clock.
    if (sim.foundingTicksLeft === 0) intents.push(...rivalScript(sim, sim.tick));
    // seedSlice is fixed-derived (no wall clock) so replays/outcome are stable.
    step(sim, { n: sim.tick, intents, seedSlice: (sim.tick * 2654435761) >>> 0 }, balance);
  }, TPS_MS);
  window.addEventListener("beforeunload", () => clearInterval(timer));

  onReady(g);
}

/**
 * The tutorial rival's fixed playbook — pure function of (sim, tick), no RNG.
 * Every ~9s it re-opens a Spread front on the neutral tiles bordering its
 * territory that sit closest to downtown, so it advances on a predictable line.
 */
function rivalScript(sim: SimState, tick: number): Intent[] {
  if (tick % 90 !== 0) return []; // act every 9s
  const w = sim.world;
  const cx = w.width >> 1;
  const cy = w.height >> 1;
  // frontier = neutral CITIZEN tiles orthogonally adjacent to a rival tile
  // (or, on the very first push, the citizen tiles nearest the rival compound)
  const ownsAny = w.owner.includes(RIVAL_ID);
  const cand: { t: number; d: number }[] = [];
  for (let t = 0; t < w.terrain.length; t++) {
    if (w.terrain[t] !== 0 /* Citizen */ || w.owner[t] !== 0 /* neutral */) continue;
    const x = t % w.width;
    const y = (t / w.width) | 0;
    let border = !ownsAny;
    if (ownsAny) {
      for (const n of [t - 1, t + 1, t - w.width, t + w.width]) {
        if (n >= 0 && n < w.owner.length && w.owner[n] === RIVAL_ID) { border = true; break; }
      }
    }
    if (!border) continue;
    // rank by closeness to downtown so the rival marches inward
    cand.push({ t, d: (x - cx) * (x - cx) + (y - cy) * (y - cy) });
  }
  if (cand.length === 0) return [];
  cand.sort((a, b) => a.d - b.d || a.t - b.t);
  const anchor = ownsAny ? cand[0]! : nearestTo(cand, RIVAL_SPAWN_TILE, w.width);
  // v3: the rival sends a cohort to work the block it just picked
  return [
    { t: "MISSION_SEND", player: RIVAL_ID, tile: anchor.t, permille: 400, mode: "spread" } as Intent,
  ];
}

function nearestTo(cand: { t: number; d: number }[], to: number, width: number): { t: number; d: number } {
  const tx = to % width;
  const ty = (to / width) | 0;
  let best = cand[0]!;
  let bestD = Infinity;
  for (const c of cand) {
    const dx = (c.t % width) - tx;
    const dy = ((c.t / width) | 0) - ty;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
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
    title: "SEND A MISSION",
    body: "Your flock converts by walking into town. Once the founding window closes, click the MAP near the EDGE OF TOWN closest to your compound — your people march out to work that block, converting house by house.",
    hint: "Click a town tile near your compound to send the flock. The founding window must close first (watch the top-center message).",
    done: (g) => g.sim.foundingTicksLeft === 0 && (me(g)?.cohorts.length ?? 0) > 0,
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
    title: "SCOUT THE RIVALS",
    body: "The CONGREGATIONS panel (top-right) is the scoreboard: every cult, its color, and how many households it holds — sorted by who's winning. In a real match you'd click 'ally' on a row to propose a truce (and shift-click a doctrine node to share it). Watch the Sleeper Cult's count creep up — it's converting its corner right now. Click NEXT.",
    glow: ".fk-players",
  },
  {
    title: "FIND THE LANDMARKS",
    body: "The KEY BUILDINGS panel lists the town's civic anchors (Police, School, Grocery, Church…). Controlling one grants a bonus — and CLICKING A ROW zooms the map straight to that building and flashes it. Try clicking any Key Building now to jump to it, then click NEXT.",
    glow: "[data-civic]",
  },
  {
    title: "THE DRAMA FEED",
    body: "The blinking ● DRAMA FEED (bottom-right) narrates the match: conversions, betrayals, scandals, schisms, incoming strikes. It's how you notice a rival scheming against you — and it's what the shareable end-of-match recap is built from. Click NEXT.",
    glow: ".fk-feed",
  },
  {
    title: "ADVANCED SCHEMES",
    body: "Folded on the left rail is SCHEME — your late-game toolkit: propaganda STRIKES (need a Broadcast Tower), AGENT raids, publishing SCANDALS. Click the ▸ SCHEME header to peek inside, then click NEXT. Top-left you'll also find EXIT (leave anytime) and, in solo games, PAUSE.",
    glow: ".fk-foldh",
  },
  {
    title: "MANAGE DISSENT & HEAT",
    body: "Pushing fronts costs followers (ATTRITION) and builds DISSENT in captured districts — too much and a chunk of your cult SPLITS AWAY (a Schism). Meanwhile CRUSADE and strikes raise global HEAT; past 60, the Concerned Parents show up to picket you. (Both are switched off in this practice town so you can learn safely.) Switch to TEND stance (1) now — it heals dissent and cools Heat fastest.",
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
    title: "NOW WIN IT",
    body: "Put it together and out-convert the Sleeper Cult: keep fronts open where your territory meets town, cast SERMON on cooldown, and lean into SPREAD or CRUSADE. Convert 30 households to seal your first victory. (The rival only holds one slow front — press it and the town is yours.)",
    hint: "Open a new front every time one stalls, right where your color meets neutral houses. Watch the LEADER % strip climb.",
    enter: (g) => money(g, 40_000),
    done: (g) => (me(g)?.ownedTiles ?? 0) >= 30,
  },
  {
    title: "🏆 VICTORY — YOU OUT-CONVERTED THE SLEEPER CULT",
    body: "That's the whole loop: found → press fronts → manage Heat & Dissent → tithe, expand, armor up → shape your Doctrine. Three ways to win a real match: DOMINATION (hold 72% of town) · DOCTRINAL (hold 100 Faith 90s, then channel at the Megachurch) · ECONOMIC (bank the cash target — Prosperity Circle). Out there the rivals fight back and nothing is disabled — but you're ready. Click FINISH to return to the menu.",
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
