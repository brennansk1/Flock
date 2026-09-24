/**
 * TUTORIAL (§26): a scripted, fully OFFLINE first match — the same for
 * everyone. No server, no matchmaking: the deterministic @flock/sim runs
 * locally on a fixed seed with one deliberately sleepy rival bot, while a
 * step engine walks the player through the Stage 1 loop, gating each step on
 * REAL sim state (found → send → crusade → recall/3-cap → power → commune →
 * victory race → expose → heat → decrees → tend/doctrine → win by Ascension).
 * Doubles as a gameplay QA harness: every step exercises a live system on a
 * reproducible world. Untimed, so it can't dead-end on the clock.
 */

import {
  loadBalance,
  createSim,
  generateWorld,
  step,
  fromInt,
  toInt,
  Stance,
  exposeCost,
  getArchetype,
  hasArchetype,
  DOCTRINE_FAITH_COST,
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
const FOUNDING_TICKS = 240; // ~24s window — a first-timer reads Step 2 AND finds a ring
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
    // A small practice town: the Tipping Point sits at 40% and there is no
    // clock, so the tutorial always ends on a real Ascension (never a timeout).
    dominationPermille: 400,
    timerTicks: 0,
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
  body: string | ((g: GameSession) => string);
  /** advance when this reads true (checked every 150ms); omit for a NEXT button */
  done?: (g: GameSession) => boolean;
  /** CSS selector to pulse while the step is active */
  glow?: string;
  /** one-shot setup when the step becomes active (grants, nudges) */
  enter?: (g: GameSession) => void;
  /** runs every check while the step is active (keeps a scripted setup true) */
  during?: (g: GameSession) => void;
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
const rival = (g: GameSession) => g.sim.players.find((pl) => pl.id === RIVAL_ID);
/** The player's primary registry power (the D slot). */
const primaryPower = (g: GameSession) => {
  const p = me(g);
  return p && hasArchetype(p.archetype) ? getArchetype(p.archetype).abilities.find((a) => a.slot === "primary") : undefined;
};
const cultRoute = (g: GameSession): string => {
  const p = me(g);
  const v = p && hasArchetype(p.archetype) ? getArchetype(p.archetype).victory : undefined;
  return v ? `<b>${v.name}</b> — ${v.blurb}` : "your cult's own route";
};

const STEPS: TutStep[] = [
  {
    title: "WELCOME TO MUNDANE FALLS",
    body: "A quiet town of unconverted souls — and you, a cult leader with a folding table and a dream. You win by racing a rival to a VICTORY CONDITION and holding it through a public countdown. This practice town is offline, unranked and at your own pace. Click NEXT.",
  },
  {
    title: "FOUND YOUR COMMUNE",
    body: "LEFT-CLICK one of the GLOWING RINGS on the open land near town. Your cult buys the parcel, the commune rises, and your congregation is bused in.",
    hint: "The rings pulse on OPEN LAND just outside the streets — not inside town, not on water.",
    done: (g) => !!me(g)?.spawned,
  },
  {
    title: "READ THE BOARD",
    body: "Top edge: every cult's share of the town's SOULS — yours first. The dashed marker is the TIPPING POINT: push your slice past it to start winning. Below: FLOCK, TREASURY ($), FAITH, HEAT (how loud you are) and LEADER. Click NEXT.",
    glow: ".fk-top",
  },
  {
    title: "SEND A MISSION",
    body: "Your flock converts by walking into town. Once the founding window closes, RIGHT-CLICK the town near your commune. The wheel opens — pick SPREAD (convert) and drag the slider to choose how much flock to commit. Remember: LEFT-click only looks, RIGHT-click acts.",
    hint: "Right-click a town tile near your commune, then click the SPREAD arc (or press 2 while the wheel is open). The founding window must close first.",
    done: (g) => g.sim.foundingTicksLeft === 0 && (me(g)?.cohorts.length ?? 0) > 0,
  },
  {
    title: "CRUSADE — FAST AND LOUD",
    body: "Each mission picks its own mode. Right-click the town again and choose CRUSADE: it converts hard but doubles the HEAT you make. Watch the MISSIONS panel on the left — it counts your cohorts (n/3).",
    glow: ".fk-missions-g",
    hint: "Right-click near your color, then click the red CRUSADE arc (or press 3 in the wheel).",
    done: (g) => (me(g)?.cohorts ?? []).some((c) => c.mode === Stance.Crusade),
  },
  {
    title: "THREE COHORTS, THEN RECALL",
    body: "Only 3 cohorts can be out at once — a full MISSIONS panel means the wheel greys out. RECALL one with its ⟲ button (or Shift+C for the oldest): they walk home, then the slot frees up. Recall a cohort now.",
    glow: ".fk-missions-g",
    hint: "Click the small ⟲ at the right end of a row in the MISSIONS panel.",
    done: (g) => (me(g)?.cohorts ?? []).some((c) => c.recalling),
  },
  {
    title: "UNLEASH A POWER",
    body: (g) =>
      `Your POWERS come from your cult's kit. We've wired you the cash. Click <b>${primaryPower(g)?.name ?? "your first power"}</b> in the POWERS panel — it lights up — THEN left-click a house in town to fire it there. (Hotkeys D / F / G fire at the tile under your cursor.)`,
    glow: ".fk-pow",
    enter: (g) => {
      const a = primaryPower(g);
      const p = me(g);
      if (!a || !p) return;
      const c = a.cost(p);
      money(g, toInt(c.usd ?? 0) + 2000);
      faith(g, toInt(c.faith ?? 0) + 10);
    },
    hint: "Two clicks: the power button first (it lights up), then a town tile.",
    done: (g) => {
      const a = primaryPower(g);
      const p = me(g);
      return !!a && !!p && (p.cooldowns[a.cooldownKey] ?? 0) > 0;
    },
  },
  {
    title: "GROW THE COMMUNE",
    body: "Money makes the cult bigger. In the SPEND tray, COMMUNE [B] raises your flock cap one stage (1→5); RECRUIT [R] turns cash into followers; BUY LAND [N] gives a crowded commune room. Upgrade the commune now.",
    glow: '[data-build="compound"]',
    enter: (g) => money(g, 30_000),
    hint: "Click COMMUNE in the bottom tray (or press B) — it upgrades in place.",
    done: (g) => (me(g)?.compounds ?? 0) >= 2,
  },
  {
    title: "THE VICTORY RACE",
    body: (g) =>
      `The right panel is the scoreboard that matters. Every cult shows its closest route to victory: DOMINATION (souls past the Tipping Point — 40% in this town), REVELATION (hold the Megachurch with Faith 90), or its own route. Yours: ${cultRoute(g)}. Meet ANY route and a public 45-second ASCENSION starts — hold it to zero and you win. Click NEXT.`,
    glow: ".fk-race",
  },
  {
    title: "EXPOSE A LOUD RIVAL",
    body: "The Sleeper Cult has been running hot — look at its Heat. Any cult at HEAT 25+ can be EXPOSED: it bleeds flock, Faith and calm, and an Ascension restarts from 45s. Click the Sleeper Cult's row in the Victory Race to jump to it, then RIGHT-CLICK its ground and choose EXPOSE. (We've covered the fee.)",
    glow: ".fk-rrow:not(.me)",
    enter: (g) => {
      const p = me(g);
      if (p) money(g, toInt(exposeCost(p)) + 1000);
    },
    during: (g) => {
      const r = rival(g);
      if (r && r.heat < fromInt(45)) r.heat = fromInt(45);
      const p = me(g);
      if (p) p.cooldowns["expose"] = 0;
    },
    hint: "Right-click a tile in the rival's color (not neutral houses) — the SCHEME menu opens. EXPOSE is the first red item.",
    done: (g) => (me(g)?.exposes ?? 0) >= 1,
  },
  {
    title: "THE HEAT GOES BOTH WAYS",
    body: "Exposing someone added HEAT to you too — mud sticks. Every conversion heats you up, and bigger cults heat faster. At 25 you're exposable; at 60 the Concerned Parents picket you; at 85 they send a deprogrammer bus. Threats aimed at you appear as CARDS beside the left rail — click one to look. Click NEXT.",
    glow: ".fk-heat",
  },
  {
    title: "KEY BUILDINGS & DECREES",
    body: "Convert the houses around the Police, schools, Grocery or Church and you control them: a passive bonus, plus a DECREE button (with its hotkey and price) appears on that row. Click any row to jump the camera there. Click NEXT.",
    glow: ".fk-civics",
  },
  {
    title: "TEND & DOCTRINE",
    body: `TEND missions hold ground, heal dissent and bank FAITH. Faith buys DOCTRINE — permanent upgrades, ${DOCTRINE_FAITH_COST} Faith per pick. Tutorial gift: a full bar. Open DOCTRINE in the bottom tray and pick any glowing node.`,
    glow: ".fk-doc",
    enter: (g) => faith(g, 90),
    hint: "DOCTRINE is the scroll button in the bottom tray. Tier 1 and 2 nodes are open from the start.",
    done: (g) => (me(g)?.doctrine.length ?? 0) >= 1,
  },
  {
    title: "NOW WIN IT",
    body: "Put it together: keep 3 cohorts working where your color meets neutral houses, recall and resend as blocks fall, and spend your cash. Push your soul share past the TIPPING POINT (40% here) and hold it through the 45s Ascension. If the rival's slice starts ascending — Expose it.",
    enter: (g) => money(g, 20_000),
    hint: "Aim missions at the neutral houses touching your territory. Watch your share bar reach the dashed marker.",
    done: (g) => g.sim.status === MatchStatus.Ended,
  },
  {
    title: "THAT'S THE WHOLE LOOP",
    body: "Send (right-click town) → Spend (tray, powers, decrees) → Scheme (right-click rivals). Win by meeting any route and surviving the Ascension; stop rivals by breaking their condition or exposing them. Real matches have 3–4 cults, the CPA and a 12-minute clock. Click FINISH.",
  },
];

/** Mount the guided overlay and run the steps against the live session. */
export function startTutorial(g: GameSession): void {
  const root = document.getElementById("app")!;
  const style = document.createElement("style");
  style.textContent = `
@keyframes fkTutPulse{0%,100%{box-shadow:0 0 0 2px #f0b53e,0 4px 0 #060403}50%{box-shadow:0 0 0 5px #f0b53e,0 4px 0 #060403}}
.fk-tut-glow{animation:fkTutPulse 1.1s infinite;z-index:9}
.fk-reduced-motion .fk-tut-glow{animation:none;box-shadow:0 0 0 4px #f0b53e,0 4px 0 #060403}
#fk-tut{position:absolute;top:96px;left:50%;transform:translateX(-50%);z-index:28;width:470px;max-width:92vw;
  background:#1a130b;border:3px solid #f0b53e;box-shadow:0 6px 0 #060403,inset 0 0 0 2px #36291a;
  font-family:'Pixelify Sans',ui-monospace,monospace;color:#efe3c6}
.fk-center #fk-tut{position:static;transform:none;pointer-events:auto}
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
  // live in the HUD's center column so ascension strips / prompts stack
  // above it instead of overlapping
  (document.querySelector(".fk-center") ?? root).appendChild(card);

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
      <div class="bd">${s.title ? `<div style="font-weight:700;font-size:16px;color:#efe3c6;margin-bottom:6px;letter-spacing:.8px">${s.title}</div>` : ""}${typeof s.body === "function" ? s.body(g) : s.body}</div>
      <div class="done" id="fk-tut-done">✓ nicely done</div>
      <div id="fk-tut-hint" style="display:none;padding:0 15px 12px;font-family:'VT323',monospace;font-size:17px;line-height:1.3;color:#e0a422"></div>
      <div class="ft">
        <button class="ghost" id="fk-tut-skip">${last ? "" : "EXIT"}</button>
        ${gated && !last ? `<button class="ghost" id="fk-tut-stepskip" title="Skip just this step">SKIP STEP</button>` : ""}
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
    // per-step skip (playtest fix): one dead gate must never cost the whole
    // tutorial — SKIP STEP advances past just this card
    const stepSkip = card.querySelector<HTMLButtonElement>("#fk-tut-stepskip");
    if (stepSkip) stepSkip.onclick = () => advance();
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
    s?.during?.(g);
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
