/**
 * FLOCK client entry (§32):
 *  - mirrors the authoritative sim via Turn broadcasts (net.ts)
 *  - paints the territory map every frame (render.ts)
 *  - LEFT = look/pan (and place armed powers / found); RIGHT = act — the
 *    mission wheel on neutral/own ground, the scheme menu on a rival's
 *  - the DOM HUD (hud.ts + hud/*) and the end-of-match splash (hud/endgame.ts)
 *
 * Server: `npm run dev:server`, then visit this app (`npm run dev:client`).
 * Querystring: ?name=Mae&archetype=radiant&server=ws://localhost:8787
 */

import { Application, Graphics } from "pixi.js";
import { toFloat, IntentType, Terrain, MAX_COHORTS } from "@flock/sim";
import { connect, type GameSession } from "./net.js";
import { connectTutorial, startTutorial } from "./tutorial.js";
import { MapRenderer } from "./render.js";
import { Hud, targetName } from "./hud.js";
import { MissionWheel } from "./wheel.js";
import { showMenu } from "./menu.js";
import { watchEndgame } from "./hud/endgame.js";
import { applySettings, getSettings } from "./settings.js";

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    background: "#1a1410",
    resizeTo: window,
    antialias: false, // chunky 8×8 tile look (§30)
  });
  document.getElementById("app")!.appendChild(app.canvas);
  applySettings(); // reflect saved accessibility prefs onto <html> before anything mounts

  const q = new URLSearchParams(location.search);
  if (!q.get("play")) {
    showMenu();
    return;
  }
  const name = q.get("name") || `Cultist${Math.floor(Math.random() * 1000)}`;
  const archetype = q.get("archetype") ?? "dawn";
  const server = q.get("server") ?? `ws://${location.hostname}:8787`;
  const isTutorial = q.get("tutorial") === "1";

  const loading = showLoading(`Entering Mundane Falls as ${name}…`);

  // private-room routing (§32): pass through the host/join knobs verbatim
  let roomParams = "";
  for (const k of ["room", "private", "bots", "size", "founding", "town"]) {
    const v = q.get(k);
    if (v !== null) roomParams += `&${k}=${encodeURIComponent(v)}`;
  }

  (isTutorial ? connectTutorial : connect)(
    `${server}/?name=${encodeURIComponent(name)}&archetype=${archetype}${roomParams}${
      getSettings().livery ? `&livery=${encodeURIComponent(getSettings().livery)}` : ""
    }`,
    (g) => {
      loading.remove();
      const map = new MapRenderer(app, g.sim.world.width, g.sim.world.height);
      map.setViewer(g.playerId);

      // Map-frame texture (design §02): page-wide scanlines + vignette over
      // the canvas. Pure decoration — pointer-events:none, below the HUD.
      const mapFx = document.createElement("div");
      mapFx.style.cssText =
        "position:absolute;inset:0;pointer-events:none;z-index:5;" +
        "background:repeating-linear-gradient(0deg,rgba(0,0,0,.16) 0 1px,transparent 1px 3px)," +
        "radial-gradient(ellipse at 50% 45%,transparent 40%,rgba(8,5,3,.6) 100%)";
      document.getElementById("app")!.appendChild(mapFx);

      // The mission wheel (the SEND verb) — created first so the HUD's scheme
      // menu can hand off to it ("Send a mission here…").
      const wheel = new MissionWheel(document.body, (tile, permille, mode) => {
        g.sendIntent({ t: IntentType.MISSION_SEND, tile, permille, mode });
      });
      const openWheel = (tile: number, clientX: number, clientY: number): void => {
        const me = g.sim.players.find((pl) => pl.id === g.playerId);
        const cohorts = me?.cohorts.length ?? 0;
        const flock = me ? toFloat(me.followers) : 0;
        let canSend = true;
        let reason = "";
        if (cohorts >= MAX_COHORTS) {
          canSend = false;
          reason = `All ${MAX_COHORTS} cohorts are out — recall one (⟲)`;
        } else if (flock < 1) {
          canSend = false;
          reason = "No flock to send";
        }
        wheel.open({ tile, screenX: clientX, screenY: clientY, label: targetName(g.sim, tile), canSend, reason });
      };

      // The crisp DOM HUD (§27): soul share bar, top bar, rails, spend tray,
      // victory race, threat lane, minimap, feed. The map is the camera.
      const hud = new Hud(g, map, { openWheel, coach: !isTutorial });
      wireInput(app, map, g, hud, wheel, openWheel);
      mountMatchControls(g);

      // offline tutorial only: expose the session for the headless UI QA
      // harness (Playwright screenshots). Never set for networked matches.
      if (isTutorial) (window as unknown as { __flockQA?: unknown }).__flockQA = { g, map, hud };
      if (isTutorial) startTutorial(g); // guided offline first match
      else maybeShowFtue(); // first-session contextual coaching (§26)

      // FOUNDING spawn-pick overlay (§18/§26): pulsing rings on recommended
      // spawns until the player clicks one.
      const foundingHints = new Graphics();
      app.stage.addChild(foundingHints);
      const recommended = recommendedSpawns(g);

      let lastBarTick = -1;
      let lastHudTick = -1;
      const endgame = watchEndgame(g);
      app.ticker.add(() => {
        map.showDissent = hud.showDissent;
        map.setSkins(g.players);
        map.draw(g.sim);
        map.drawHighlight(performance.now()); // transient "look here" ring
        drawFoundingHints(map, foundingHints, g, recommended, app.ticker.lastTime);
        // HUD + bar update at sim rate (10 Hz), not every animation frame.
        if (g.sim.tick !== lastHudTick) {
          lastHudTick = g.sim.tick;
          hud.update();
          hud.setPrompt(statusPrompt(g));
        }
        if (g.sim.tick - lastBarTick >= 5 || g.sim.tick < lastBarTick) {
          lastBarTick = g.sim.tick;
          hud.renderShareBar();
        }
        // Victory / Defeat moment → recap card → play again (§9.5)
        endgame();
      });
    },
    {
      onError: (m) => loading.setError(m),
      onClose: () => loading.setError("disconnected from match"),
    },
  );
}

/** Rotating loading-screen tips (design §05), VT323 italic. */
const LOAD_TIPS = [
  "tip ▸ the saucer parks wherever it likes. losing home is an inconvenience.",
  "tip ▸ spawn near College — you blitz, they churn. never CRUSADE with an open home.",
  "tip ▸ Old Town + the Glow is near-unflippable. win the games you don't fight.",
  "tip ▸ keep Heat under 25 and nobody can Expose you.",
  "tip ▸ a rival Ascending? Right-click their ground and EXPOSE — the clock resets.",
  "tip ▸ press ? in-match for the full controls sheet.",
];

/** Full-screen loading / connection screen (§28) with retry on failure. */
function showLoading(message: string): { remove(): void; setError(m: string): void } {
  const root = document.getElementById("app")!;
  const div = document.createElement("div");
  div.style.cssText =
    "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;" +
    "gap:20px;font-family:'Pixelify Sans',ui-monospace,monospace;color:#efe3c6;z-index:60;" +
    "background:#0c0905;background-image:radial-gradient(ellipse at 50% 50%,#241a10 0%,transparent 65%)";
  const scan =
    `<div style="position:absolute;inset:0;pointer-events:none;` +
    `background:repeating-linear-gradient(0deg,rgba(0,0,0,.16) 0 1px,transparent 1px 3px)"></div>`;
  div.innerHTML = `
    ${scan}
    <div style="width:38px;height:38px;border:5px solid #36291a;border-top-color:#e0a422;animation:fkLoadSpin 1s linear infinite"></div>
    <div style="font-family:'Press Start 2P',monospace;font-size:16px;color:#efe3c6;text-shadow:3px 3px 0 #cf4b2c">CONVERTING MUNDANE FALLS…</div>
    <div style="width:340px;height:18px;background:#160f08;box-shadow:inset 0 0 0 2px #4a3a26;padding:3px;box-sizing:border-box">
      <div style="width:0%;height:100%;background:repeating-linear-gradient(90deg,#e0a422 0 8px,#c8862c 8px 12px);animation:fkLoadBar 9s ease-out forwards"></div>
    </div>
    <div style="font-size:13px;color:#a08a64">${message}</div>
    <div id="fk-load-tip" style="font-family:'VT323',monospace;font-size:17px;color:#8a7550;font-style:italic">${LOAD_TIPS[0]}</div>
    <style>
      @keyframes fkLoadSpin{to{transform:rotate(360deg)}}
      @keyframes fkLoadBar{0%{width:0%}100%{width:96%}}
      .fk-reduced-motion [style*="fkLoadSpin"]{animation:none !important}
      .fk-reduced-motion [style*="fkLoadBar"]{animation:none !important;width:96% !important}
    </style>`;
  root.appendChild(div);
  // rotate the tip line every few seconds while we connect
  let tipIdx = 0;
  const tipTimer = window.setInterval(() => {
    const el = div.querySelector<HTMLElement>("#fk-load-tip");
    if (el) el.textContent = LOAD_TIPS[(tipIdx = (tipIdx + 1) % LOAD_TIPS.length)]!;
  }, 3200);
  return {
    remove: () => {
      clearInterval(tipTimer);
      div.remove();
    },
    setError: (m: string) => {
      clearInterval(tipTimer);
      div.innerHTML = `
        ${scan}
        <div style="font-family:'Press Start 2P',monospace;font-size:22px;color:#efe3c6;text-shadow:3px 3px 0 #cf4b2c">FLOCK</div>
        <div style="font-size:15px;color:#d8c8a6">⚠ ${m}</div>
        <button onclick="location.reload()" style="padding:14px 42px;font-family:'Press Start 2P',monospace;font-size:12px;letter-spacing:2px;background:#e0a422;color:#19110a;border:0;box-shadow:0 5px 0 #060403,inset 0 0 0 3px #f3cf6a;cursor:pointer">RETRY</button>
        <a href="?" style="color:#a08a64;font-size:13px;font-family:'VT323',monospace;font-size:17px">← back to menu</a>`;
    },
  };
}

/**
 * Input model (STAGE1_DESIGN §2, one consistent lesson):
 *   LEFT  = look — select/inspect (hover chip), drag to pan; also places an
 *           armed power and founds your commune during FOUNDING.
 *   RIGHT = act — neutral or own ground opens the MISSION WHEEL (send);
 *           a RIVAL's ground opens the SCHEME menu (expose / strike / mission).
 *   Long-press (touch/pen) = right-click.
 */
function wireInput(app: Application, map: MapRenderer, g: GameSession, hud: Hud, wheel: MissionWheel, openWheel: (tile: number, x: number, y: number) => void): void {
  let hover = -1;

  const act = (tile: number, clientX: number, clientY: number): void => {
    const me = g.sim.players.find((pl) => pl.id === g.playerId);
    if (!me || !me.spawned) return; // still founding — left-click places your commune
    if (tile < 0) {
      wheel.close();
      hud.scheme.close();
      return;
    }
    hud.arm(null);
    const owner = g.sim.world.owner[tile]!;
    wheel.close();
    if (owner !== 0 && owner !== g.playerId && g.sim.players.some((p) => p.id === owner && p.alive)) {
      hud.scheme.open(tile, owner, clientX, clientY);
    } else {
      hud.scheme.close();
      openWheel(tile, clientX, clientY);
    }
  };

  app.canvas.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    act(map.tileAt(g.sim, ev.offsetX, ev.offsetY), ev.clientX, ev.clientY);
  });
  // click-away dismiss (the wheel swallows pointerdowns landing on itself)
  window.addEventListener("pointerdown", (ev) => {
    if (wheel.isOpen && !(ev.target as HTMLElement).closest?.(".fk-wheel")) wheel.close();
  });

  // drag-pan + wheel-zoom (zoom drives level-of-detail in the renderer)
  let dragging = false;
  let dragMoved = false;
  let lastX = 0;
  let lastY = 0;
  let pressTimer = 0;
  let longPressed = false;
  app.canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    map.zoomAt(ev.offsetX, ev.offsetY, ev.deltaY);
  }, { passive: false });
  app.canvas.addEventListener("pointermove", (ev) => {
    hover = map.tileAt(g.sim, ev.offsetX, ev.offsetY);
    hud.setHover(hover);
    if (dragging) {
      const dx = ev.offsetX - lastX;
      const dy = ev.offsetY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 6) {
        dragMoved = true;
        window.clearTimeout(pressTimer);
      }
      map.pan(dx, dy);
      lastX = ev.offsetX;
      lastY = ev.offsetY;
    }
  });
  app.canvas.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return; // only the LEFT button pans — right-click acts
    dragging = true;
    dragMoved = false;
    longPressed = false;
    lastX = ev.offsetX;
    lastY = ev.offsetY;
    if (ev.pointerType === "touch" || ev.pointerType === "pen") {
      const { offsetX, offsetY, clientX, clientY } = ev;
      window.clearTimeout(pressTimer);
      pressTimer = window.setTimeout(() => {
        if (dragMoved) return;
        longPressed = true;
        act(map.tileAt(g.sim, offsetX, offsetY), clientX, clientY);
      }, 550);
    }
  });
  window.addEventListener("pointerup", () => {
    dragging = false;
    window.clearTimeout(pressTimer);
  });

  // LEFT click (without dragging): resolve an armed placement, else SPAWN
  // during FOUNDING, else just LOOK (the hover chip says what right-click does).
  let lookPings = 0;
  app.canvas.addEventListener("click", (ev) => {
    if (dragMoved || longPressed) return;
    const center = map.tileAt(g.sim, ev.offsetX, ev.offsetY);
    if (center < 0) return;
    const w = g.sim.world;
    const meNow = g.sim.players.find((pl) => pl.id === g.playerId);

    const placement = hud.ui.placement;
    if (placement) {
      hud.arm(null);
      const claimable =
        w.terrain[center] === Terrain.Grass ||
        w.terrain[center] === Terrain.Field ||
        w.terrain[center] === Terrain.Woods;
      switch (placement.mode) {
        case "build":
          g.sendIntent({ t: IntentType.BUILD, building: placement.building as never, tile: center });
          return;
        case "strike":
          g.sendIntent({ t: IntentType.STRIKE, strike: placement.strike as never, target: center });
          return;
        case "ability":
          g.sendIntent({ t: IntentType.ABILITY, ability: placement.ability, target: center });
          return;
        case "property":
          if (!claimable || w.property[center] !== 0) {
            hud.arm(placement); // stay armed — let them try again
            pingPrompt("Buy OPEN COUNTRY — unclaimed grass, field, or woods next to your land.");
            return;
          }
          g.sendIntent({ t: IntentType.BUY_PROPERTY, tile: center } as never);
          return;
      }
    }

    if (meNow && !meNow.spawned) {
      g.sendIntent({ t: IntentType.SPAWN, tile: center });
      return;
    }
    // Left-click only looks. Teach the verb a few times, then stay quiet.
    hud.setHover(-2);
    hud.setHover(center);
    if (lookPings < 3 && g.sim.foundingTicksLeft === 0) {
      lookPings++;
      const owner = w.owner[center]!;
      pingPrompt(
        owner !== 0 && owner !== g.playerId
          ? "Left-click just looks — RIGHT-CLICK rival ground to Expose / Strike."
          : "Left-click just looks — RIGHT-CLICK to send a mission here.",
      );
    }
  });

  // Typing in any input (the chat box) must never trigger game keybinds.
  const typing = (ev: KeyboardEvent): boolean =>
    ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement;

  window.addEventListener("keydown", (ev) => {
    if (typing(ev)) return;
    if (ev.key === "Escape") {
      if (wheel.isOpen) wheel.close();
      else if (hud.scheme.isOpen) hud.scheme.close();
      else hud.arm(null);
      return;
    }
    // While the wheel is open it owns the number keys (1/2/3 pick a mode) and
    // swallows the rest — it's modal over the map keybinds.
    if (wheel.isOpen) {
      wheel.pickByKey(ev.key);
      return;
    }
    if (ev.key === "?") return hud.toggleHelp();
    const me = g.sim.players.find((pl) => pl.id === g.playerId);
    if (!me || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === "C") {
      // shift+C: recall your oldest deployed cohort (bring the flock home)
      const slot = me.cohorts.findIndex((c) => !c.recalling);
      if (slot >= 0) g.sendIntent({ t: IntentType.MISSION_RECALL, slot });
      return;
    }
    if (ev.key === "F8") {
      if (confirm("Surrender this match?")) g.sendIntent({ t: IntentType.SURRENDER });
      return;
    }
    const k = ev.key.toLowerCase();
    if ("567890".includes(k) && k.length === 1) {
      hud.fireDecreeKey(k);
      return;
    }
    switch (k) {
      case "d":
        return hud.firePowerKey("D", hover);
      case "f":
        return hud.firePowerKey("F", hover);
      case "g":
        return hud.firePowerKey("G", hover);
      case "b":
        return hud.upgradeCommune();
      case "n":
        return hud.toggleLand();
      case "r":
        return g.sendIntent({ t: IntentType.BUY_RECRUITS });
      case "h":
        return hud.toggleDissentOverlay();
    }
  });
}

/**
 * The transient center prompt (§29: banner/ping, never modal): founding
 * instructions, prophecy countdowns, CPA warning, elimination — everything that
 * isn't a steady HUD readout. Returns "" when there's nothing to say.
 */
function statusPrompt(g: GameSession): string {
  const me = g.sim.players.find((p) => p.id === g.playerId);
  if (!me) return "";
  if (g.sim.foundingTicksLeft > 0) {
    // the gate holds at the window edge until EVERY founder has placed
    const unplaced = g.sim.players.filter((p) => !p.spawned).length;
    if (g.sim.foundingTicksLeft === 1) {
      return me.spawned
        ? `WAITING FOR FOUNDERS — ${unplaced} still choosing…`
        : "THE TOWN IS WAITING ON YOU — CLICK OPEN LAND TO FOUND";
    }
    const secs = (g.sim.foundingTicksLeft / 10).toFixed(0);
    return me.spawned
      ? `FOUNDING — your congregation is bused in · ${secs}s`
      : `BUY YOUR FIRST PROPERTY — CLICK OPEN LAND NEAR TOWN · ${secs}s`;
  }
  if (g.paused) return "⏸ PAUSED — the town holds still";
  if (!me.alive) return "☠ ELIMINATED — spectating";
  return "";
}

/** Flash a transient guidance line for a mis-aimed armed action. */
function pingPrompt(msg: string): void {
  const el = document.getElementById("fk-ping");
  if (el) {
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout((el as HTMLElement & { _t?: number })._t);
    (el as HTMLElement & { _t?: number })._t = window.setTimeout(() => (el.style.display = "none"), 2200);
    return;
  }
  const d = document.createElement("div");
  d.id = "fk-ping";
  d.style.cssText =
    "position:absolute;top:150px;left:50%;transform:translateX(-50%);z-index:30;pointer-events:none;" +
    "font-family:'Pixelify Sans',ui-monospace,monospace;font-size:13px;color:#fff3df;background:#cf4b2c;" +
    "border:3px solid #f0b53e;box-shadow:0 4px 0 #060403;padding:8px 16px;letter-spacing:.5px";
  d.textContent = msg;
  document.getElementById("app")!.appendChild(d);
  (d as HTMLElement & { _t?: number })._t = window.setTimeout(() => (d.style.display = "none"), 2200);
}

/**
 * Pick a handful of recommended spawn tiles (§26 FTUE guidance): unowned
 * Citizen tiles with the highest susceptibility, spread out so they don't
 * cluster. Computed once — the world is static for the match.
 */
function recommendedSpawns(g: GameSession): number[] {
  const w = g.sim.world;
  // §18 rev.: you found on OPEN LAND near town — recommend grass tiles with
  // plenty of citizen lots inside compound-outreach range.
  const candidates: { tile: number; s: number }[] = [];
  const stride = Math.max(1, Math.floor(w.width / 48));
  for (let y = 2; y < w.height - 2; y += stride) {
    for (let x = 2; x < w.width - 2; x += stride) {
      const t = y * w.width + x;
      if (w.terrain[t] !== Terrain.Grass || w.property[t] !== 0) continue;
      // a founding ring must mark a spot where the parcel actually FITS —
      // mirror the sim's anchor test (≥60% claimable in the 5×5)
      let fits = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 1 || ny < 1 || nx >= w.width - 1 || ny >= w.height - 1) continue;
          const nt = ny * w.width + nx;
          const tr = w.terrain[nt];
          if (
            w.property[nt] === 0 &&
            (tr === Terrain.Grass || tr === Terrain.Field || tr === Terrain.Woods)
          )
            fits++;
        }
      }
      if (fits < 15) continue;
      let reach = 0;
      for (let dy = -8; dy <= 8; dy += 2) {
        for (let dx = -8; dx <= 8; dx += 2) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w.width || ny >= w.height) continue;
          if (w.terrain[ny * w.width + nx] === Terrain.Citizen) reach++;
        }
      }
      if (reach >= 6) candidates.push({ tile: t, s: reach });
    }
  }
  candidates.sort((a, b) => b.s - a.s);
  const picked: number[] = [];
  const minDist = Math.max(6, Math.floor(w.width / 8));
  for (const c of candidates) {
    const cx = c.tile % w.width;
    const cy = (c.tile / w.width) | 0;
    if (picked.every((p) => Math.abs((p % w.width) - cx) + Math.abs(((p / w.width) | 0) - cy) >= minDist)) {
      picked.push(c.tile);
    }
    if (picked.length >= 8) break;
  }
  return picked;
}

/** Draw the founding spawn hints (pulsing rings); no-op once spawned/live. */
function drawFoundingHints(
  map: MapRenderer,
  gfx: Graphics,
  g: GameSession,
  recommended: number[],
  timeMs: number,
): void {
  gfx.clear();
  const me = g.sim.players.find((p) => p.id === g.playerId);
  if (!me || me.spawned || g.sim.foundingTicksLeft <= 0) return;
  const pulse = 0.5 + 0.5 * Math.sin(timeMs / 250);
  for (const tile of recommended) {
    const r = map.tileToScreen(tile);
    if (!r) continue;
    const cx = r.x + r.size / 2;
    const cy = r.y + r.size / 2;
    const rad = r.size * (2.2 + pulse * 1.2);
    gfx.circle(cx, cy, rad).stroke({ width: 2, color: 0xc89858, alpha: 0.5 + 0.4 * pulse });
    gfx.circle(cx, cy, r.size * 0.7).fill({ color: 0xc89858, alpha: 0.25 });
  }
}

/**
 * FTUE contextual overlay (§26): a 4-step coachmark shown once, the first time
 * a player drops into a match. Advances on click; gated by localStorage so it
 * never nags a returning player.
 */
function maybeShowFtue(): void {
  try {
    if (localStorage.getItem("flock.ftue") === "done") return;
  } catch {
    return;
  }
  const steps = [
    "① Click a glowing ring on open land to found your commune.",
    `② RIGHT-CLICK the town to send a cohort — SPREAD, TEND or CRUSADE. Up to ${MAX_COHORTS} out at once.`,
    "③ Spend cash on the bottom tray: COMMUNE (B) raises your flock cap, RECRUIT (R) buys followers.",
    "④ Win the VICTORY RACE (right panel): meet any route, then survive a 45s Ascension. Right-click a rival to EXPOSE them.",
  ];
  let i = 0;
  const tip = document.createElement("div");
  tip.style.cssText =
    "position:absolute;bottom:150px;left:16px;z-index:55;max-width:300px;" +
    "background:#1a130b;border:3px solid #e0a422;box-shadow:0 4px 0 #060403;padding:14px 20px;" +
    "font-family:'Pixelify Sans',ui-monospace,monospace;color:#efe3c6;font-size:14px;text-align:center;cursor:pointer";
  const paint = (): void => {
    tip.innerHTML = `${steps[i]}<div style="font-size:11px;opacity:.55;margin-top:8px">click to continue (${i + 1}/${steps.length})</div>`;
  };
  tip.onclick = () => {
    if (++i >= steps.length) {
      try {
        localStorage.setItem("flock.ftue", "done");
      } catch {
        /* ignore */
      }
      tip.remove();
    } else paint();
  };
  paint();
  document.getElementById("app")!.appendChild(tip);
}

void boot();


/**
 * Top-left match controls: EXIT (every game) and PAUSE (solo vs bots only —
 * the server confirms and ignores pause in multi-human matches).
 */
function mountMatchControls(g: GameSession): void {
  const root = document.getElementById("app")!;
  const bar = document.createElement("div");
  bar.style.cssText = "position:absolute;top:40px;left:16px;z-index:22;display:flex;gap:6px";
  // pixel-frame buttons (design §02 EXIT): .fk-ctl lives in the HUD stylesheet
  const mkBtn = (glyph: string, label: string, title: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.className = "fk-ctl";
    b.innerHTML = `<span class="x">${glyph}</span>${label}`;
    b.title = title;
    bar.appendChild(b);
    return b;
  };
  const exit = mkBtn("✕", "EXIT", "leave the match and return to the menu");
  exit.onclick = () => {
    if (confirm("Leave the match? (your cult keeps running without you until the timer ends)")) {
      location.search = "";
    }
  };
  const flag = mkBtn("⚑", "", "surrender the match [F8]");
  flag.onclick = () => {
    if (confirm("Surrender this match? Your cult stops fighting.")) g.sendIntent({ t: IntentType.SURRENDER });
  };
  // solo = exactly one HUMAN seat on the wire roster (bot seats are flagged)
  if (g.players.filter((p) => !p.bot).length === 1) {
    const pause = mkBtn("⏸", "PAUSE", "pause the match (solo vs bots)");
    pause.onclick = () => {
      g.sendPause(!g.paused);
      setTimeout(() => {
        pause.innerHTML = g.paused ? `<span class="x">▶</span>RESUME` : `<span class="x">⏸</span>PAUSE`;
      }, 150);
    };
  }
  root.appendChild(bar);
}
