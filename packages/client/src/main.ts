/**
 * FLOCK client entry (§32). M0 ugly-but-honest UI (§39):
 *  - mirrors the authoritative sim via Turn broadcasts (net.ts)
 *  - paints the territory map every frame (render.ts)
 *  - click = open a 5×5 Front around the tile (§4.1)
 *  - keys 1/2/3 = Tend / Spread / CRUSADE (§5, hotkeys per §27)
 *  - top-left text HUD: followers, $, faith, heat, tiles
 *
 * Server: `npm run dev:server`, then visit this app (`npm run dev:client`).
 * Querystring: ?name=Mae&archetype=radiant&server=ws://localhost:8787
 */

import { Application, Graphics } from "pixi.js";
import {
  toFloat,
  toInt,
  IntentType,
  Stance,
  MatchStatus,
  Terrain,
  renderRecapCard,
  type Archetype,
} from "@flock/sim";
import { connect, type GameSession, type ClientIntent } from "./net.js";
import { connectTutorial, startTutorial } from "./tutorial.js";
import { MapRenderer } from "./render.js";
import { Hud } from "./hud.js";
import { showMenu } from "./menu.js";
import { applySettings } from "./settings.js";

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
    `${server}/?name=${encodeURIComponent(name)}&archetype=${archetype}${roomParams}`,
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

      // The crisp DOM HUD (§27): believer share bar, top bar, rails, build
      // palette, minimap, feed.
      // The map is handed in as the camera so the minimap can jump + show the view.
      const hud = new Hud(g, map);
      wireInput(app, map, g, hud);
      mountMatchControls(g);

      // Center status prompt (founding / prophecy / CPA / elimination) —
      // pixel-panel idiom per the design tokens.
      const prompt = document.createElement("div");
      prompt.style.cssText =
        "position:absolute;top:152px;left:50%;transform:translateX(-50%);z-index:21;pointer-events:none;" +
        "font-family:'Press Start 2P',monospace;font-size:10px;letter-spacing:1px;line-height:1.7;color:#f0b53e;" +
        "text-align:center;max-width:70vw;background:#1a130b;border:3px solid #4a3a26;" +
        "box-shadow:0 4px 0 #060403,inset 0 0 0 1px #6b563a;padding:11px 20px;display:none";
      document.getElementById("app")!.appendChild(prompt);

      if (isTutorial) startTutorial(g); // guided offline first match
      else maybeShowFtue(); // first-session contextual coaching (§26)

      // FOUNDING spawn-pick overlay (§18/§26): pulsing rings on recommended
      // spawns until the player clicks one.
      const foundingHints = new Graphics();
      app.stage.addChild(foundingHints);
      const recommended = recommendedSpawns(g);

      let lastBarTick = -1;
      let lastHudTick = -1;
      let cardShown = false;
      app.ticker.add(() => {
        map.showDissent = hud.showDissent;
        map.draw(g.sim);
        map.drawHighlight(performance.now()); // transient "look here" ring
        drawFoundingHints(map, foundingHints, g, recommended, app.ticker.lastTime);
        // HUD + bar update at sim rate (10 Hz), not every animation frame.
        if (g.sim.tick !== lastHudTick) {
          lastHudTick = g.sim.tick;
          hud.update();
          const msg = statusPrompt(g);
          prompt.style.display = msg ? "block" : "none";
          prompt.textContent = msg;
        }
        if (g.sim.tick - lastBarTick >= 5) {
          lastBarTick = g.sim.tick;
          hud.renderShareBar();
        }
        // Recap Card (§25.1): once the server's recap lands, show the shareable
        // 1080×1350 card center-stage (same renderer the share-pipeline uses).
        if (!cardShown && g.recap) {
          cardShown = true;
          showRecapCard(g);
        }
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
  "tip ▸ keep Heat at zero and Scandal can't touch you.",
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

/** Per-archetype D/F actives (left rail, §27). */
const ACTIVE_D: Record<string, string> = {
  dawn: "street_prophet",
  radiant: "juice_cleanse",
  circle: "seminar_blitz",
  visitors: "crop_circle",
};
const ACTIVE_F: Record<string, string> = {
  dawn: "stockpile_sermon",
  radiant: "free_retreat_weekend",
  circle: "hostile_acquisition",
  visitors: "radio_static",
};

function wireInput(app: Application, map: MapRenderer, g: GameSession, hud: Hud): void {
  let hover = -1;
  // drag-pan + wheel-zoom (zoom drives level-of-detail in the renderer)
  let dragging = false;
  let dragMoved = false;
  let lastX = 0;
  let lastY = 0;
  app.canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    map.zoomAt(ev.offsetX, ev.offsetY, ev.deltaY);
  }, { passive: false });
  app.canvas.addEventListener("pointermove", (ev) => {
    hover = map.tileAt(g.sim, ev.offsetX, ev.offsetY);
    hud.setHover(hover); // place-identity chip: street + household names
    if (dragging) {
      const dx = ev.offsetX - lastX;
      const dy = ev.offsetY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
      map.pan(dx, dy);
      lastX = ev.offsetX;
      lastY = ev.offsetY;
    }
  });

  app.canvas.addEventListener("pointerdown", (ev) => {
    dragging = true;
    dragMoved = false;
    lastX = ev.offsetX;
    lastY = ev.offsetY;
  });
  window.addEventListener("pointerup", () => {
    dragging = false;
  });

  // Click (without dragging): resolve an armed HUD action at the tile, else
  // SPAWN during FOUNDING (§18), else OPEN_FRONT (the default world verb).
  app.canvas.addEventListener("click", (ev) => {
    if (dragMoved) return; // it was a pan, not a click
    const center = map.tileAt(g.sim, ev.offsetX, ev.offsetY);
    if (center < 0) return;
    const w = g.sim.world;
    const district = w.district[center]!;
    const meNow = g.sim.players.find((pl) => pl.id === g.playerId);

    // armed placement from the HUD (build / strike / targeted ritual or ability)
    const placement = hud.ui.placement;
    if (placement) {
      hud.arm(null);
      const owner = w.owner[center]!;
      // pre-validate ground for build/land so a miss KEEPS the tool armed and
      // says why, instead of silently eating the click (QA batch 1)
      const claimable =
        w.terrain[center] === Terrain.Grass ||
        w.terrain[center] === Terrain.Field ||
        w.terrain[center] === Terrain.Woods;
      const myGround =
        (owner === g.playerId && w.terrain[center] === Terrain.Citizen) ||
        (w.property[center] === g.playerId && claimable);
      switch (placement.mode) {
        case "build":
          if (!myGround && placement.building !== "compound") {
            hud.arm(placement); // stay armed — let them try again
            pingPrompt("Build on YOUR land — a converted tile or your staked parcel.");
            return;
          }
          g.sendIntent({ t: IntentType.BUILD, building: placement.building as never, tile: center });
          return;
        case "strike":
          g.sendIntent({ t: IntentType.STRIKE, strike: placement.strike as never, target: center });
          return;
        case "ritual":
          g.sendIntent({ t: IntentType.RITUAL, ritual: placement.ritual as never, tile: center, district });
          return;
        case "ability":
          g.sendIntent({ t: IntentType.ABILITY, ability: placement.ability, target: center });
          return;
        case "property":
          if (!claimable || w.property[center] !== 0) {
            hud.arm(placement);
            pingPrompt("Buy OPEN COUNTRY — unclaimed grass, field, or woods near your land.");
            return;
          }
          g.sendIntent({ t: IntentType.BUY_PROPERTY, tile: center } as never);
          return;
        // ── SCHEME placements (§13/§15/§16): button armed, this click targets
        case "agent":
          if (district > 0)
            g.sendIntent({ t: IntentType.AGENT_DISPATCH, district, mission: placement.mission });
          else pingPrompt("Agents target a DISTRICT — click inside town.");
          return;
        case "scandal":
          if (owner > 0 && owner !== g.playerId)
            g.sendIntent({ t: IntentType.PUBLISH_SCANDAL, target: owner });
          else pingPrompt("Click a rival cult's tile to publish a scandal.");
          return;
        case "van":
          g.sendIntent(nearestVanIntent(g, center));
          return;
        case "close_front": {
          const f = nearestFront(g, center);
          if (f >= 0) g.sendIntent({ t: IntentType.CLOSE_FRONT, front: f });
          else pingPrompt("You have no open front near there.");
          return;
        }
        case "cancel_build":
          g.sendIntent({ t: IntentType.CANCEL_BUILD, tile: center });
          return;
      }
    }

    if (meNow && !meNow.spawned) {
      g.sendIntent({ t: IntentType.SPAWN, tile: center });
      return;
    }
    const cx = center % w.width;
    const cy = (center / w.width) | 0;
    const tiles: number[] = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
        tiles.push(y * w.width + x);
      }
    }
    g.sendIntent({ t: IntentType.OPEN_FRONT, tiles });
  });

  // Typing in any input (the chat box) must never trigger game keybinds.
  const typing = (ev: KeyboardEvent): boolean =>
    ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement;

  // Escape clears an armed placement.
  window.addEventListener("keydown", (ev) => {
    if (typing(ev)) return;
    if (ev.key === "Escape") hud.arm(null);
    if (ev.key === "?") hud.toggleHelp();
  });

  window.addEventListener("keydown", (ev) => {
    if (typing(ev)) return;
    const me = g.sim.players.find((pl) => pl.id === g.playerId);
    if (!me) return;
    const hoverDistrict = hover >= 0 ? g.sim.world.district[hover]! : 0;
    const hoverOwner = hover >= 0 ? g.sim.world.owner[hover]! : 0;

    switch (ev.key) {
      // stances (§5)
      case "1": return g.sendIntent({ t: IntentType.SET_STANCE, stance: Stance.Tend });
      case "2": return g.sendIntent({ t: IntentType.SET_STANCE, stance: Stance.Spread });
      case "3": return g.sendIntent({ t: IntentType.SET_STANCE, stance: Stance.Crusade });
      // rituals Q/W/E/R (§9, §27)
      case "q": return g.sendIntent({ t: IntentType.RITUAL, ritual: "sermon" });
      case "w":
        if (hover >= 0) g.sendIntent({ t: IntentType.RITUAL, ritual: "midnight_festival", tile: hover });
        return;
      case "e":
        if (hover >= 0)
          g.sendIntent({ t: IntentType.RITUAL, ritual: "the_offering", tile: hover, district: hoverDistrict });
        return;
      case "r": return g.sendIntent({ t: IntentType.RITUAL, ritual: "day_of_atonement" });
      // archetype actives D/F + signature G (§27)
      case "d":
        return g.sendIntent({ t: IntentType.ABILITY, ability: ACTIVE_D[me.archetype]!, ...(hover >= 0 ? { target: hover } : {}) });
      case "f":
        return g.sendIntent({ t: IntentType.ABILITY, ability: ACTIVE_F[me.archetype]!, ...(hover >= 0 ? { target: hover } : {}) });
      case "g":
        if (me.archetype === "visitors" && hover >= 0)
          return g.sendIntent({ t: IntentType.ABILITY, ability: "saucer_landing", target: hover });
        return g.sendIntent({ t: IntentType.SIGNATURE });
      // build palette (§6) at the hovered tile
      case "b":
        if (hover >= 0) g.sendIntent({ t: IntentType.BUILD, building: "compound", tile: hover });
        return;
      case "t":
        if (hover >= 0) g.sendIntent({ t: IntentType.BUILD, building: "watchtower", tile: hover });
        return;
      case "c":
        if (hover >= 0) g.sendIntent({ t: IntentType.BUILD, building: "collection_plate", tile: hover });
        return;
      case "y":
        if (hover >= 0) g.sendIntent({ t: IntentType.BUILD, building: "broadcast_tower", tile: hover });
        return;
      case "h":
        hud.toggleDissentOverlay();
        return;
      // agents & PvP (§13/§15)
      case "a":
        if (hoverDistrict > 0)
          g.sendIntent({ t: IntentType.AGENT_DISPATCH, district: hoverDistrict, mission: "deprogram" });
        return;
      case "x":
        if (hoverDistrict > 0)
          g.sendIntent({ t: IntentType.AGENT_DISPATCH, district: hoverDistrict, mission: "scandal" });
        return;
      case "p":
        if (hoverOwner > 0 && hoverOwner !== g.playerId)
          g.sendIntent({ t: IntentType.PUBLISH_SCANDAL, target: hoverOwner });
        return;
      case "k":
        if (hover >= 0) g.sendIntent({ t: IntentType.STRIKE, strike: "pamphlet_bomb", target: hover });
        return;
      case "v":
        // route your nearest van to the hovered tile; with no van yet, buy one
        if (hover >= 0) g.sendIntent(nearestVanIntent(g, hover));
        return;
      case "V":
        // shift+V: buy a NEW van at the hovered tile (capacity permitting)
        if (hover >= 0) g.sendIntent({ t: IntentType.VAN_MOVE, van: -1, path: [hover] });
        return;
      case "C": {
        // shift+C: close your front nearest the hovered tile (stop the push)
        if (hover < 0) return;
        const f = nearestFront(g, hover);
        if (f >= 0) g.sendIntent({ t: IntentType.CLOSE_FRONT, front: f });
        return;
      }
      case "z":
        // cancel your under-construction building at the hovered tile (50% refund)
        if (hover >= 0) g.sendIntent({ t: IntentType.CANCEL_BUILD, tile: hover });
        return;
      case "F8":
        if (confirm("Surrender this match?")) g.sendIntent({ t: IntentType.SURRENDER });
        return;
      // diplomacy on hovered cult (§16)
      case "o":
        if (hoverOwner > 0 && hoverOwner !== g.playerId)
          g.sendIntent({ t: IntentType.ALLY_PROPOSE, target: hoverOwner });
        return;
      case "i":
        if (hoverOwner > 0 && hoverOwner !== g.playerId)
          g.sendIntent({ t: IntentType.ALLY_ACCEPT, target: hoverOwner });
        return;
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
  const prophecy = g.sim.prophecies[0];
  if (prophecy) return `⏳ PROPHECY: ${nameOf(g, prophecy.player)} — ${(prophecy.ticksLeft / 10).toFixed(0)}s`;
  if (toFloat(me.heat) >= 60) return "🚐 THE CONCERNED PARENTS ARE HERE";
  return "";
}

/**
/** Route the player's nearest van to `tile`; buys one when they have none. */
function nearestVanIntent(g: GameSession, tile: number): ClientIntent {
  const mine = g.sim.vans.filter((vn) => vn.player === g.playerId);
  if (mine.length === 0) return { t: IntentType.VAN_MOVE, van: -1, path: [tile] };
  const W = g.sim.world.width;
  const hx = tile % W;
  const hy = (tile / W) | 0;
  let best = mine[0]!;
  let bestD = Infinity;
  for (const vn of mine) {
    const dx = (vn.tile % W) - hx;
    const dy = ((vn.tile / W) | 0) - hy;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = vn;
    }
  }
  return { t: IntentType.VAN_MOVE, van: best.id, path: [tile] };
}

/** The id of the player's front nearest `tile`, or -1 if they have none. */
function nearestFront(g: GameSession, tile: number): number {
  const W = g.sim.world.width;
  const hx = tile % W;
  const hy = (tile / W) | 0;
  let bestF = -1;
  let bestD = Infinity;
  for (const f of g.sim.fronts) {
    if (f.player !== g.playerId || f.tiles.length === 0) continue;
    const t0 = f.tiles[0]!;
    const dx = (t0 % W) - hx;
    const dy = ((t0 / W) | 0) - hy;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      bestF = f.id;
    }
  }
  return bestF;
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
 * Recap Card overlay (§25/§28): render the deterministic share card to a canvas
 * centered over the map, with download + requeue actions (the requeue button is
 * the largest element per §28).
 */
function showRecapCard(g: GameSession): void {
  if (!g.recap) return;
  const names: Record<number, string> = {};
  const archetypes: Record<number, Archetype> = {};
  for (const p of g.players) {
    names[p.id] = p.name;
    archetypes[p.id] = p.archetype;
  }
  const frame = renderRecapCard(g.recap, names, archetypes);

  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(frame.width, frame.height);
  img.data.set(frame.data);
  ctx.putImageData(img, 0, 0);

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;" +
    "justify-content:center;gap:14px;background:rgba(10,8,6,0.88);z-index:50;" +
    "font-family:Georgia,serif;color:#f0e6d0";
  canvas.style.cssText =
    "max-height:72vh;height:auto;image-rendering:pixelated;border:2px solid #6a5a40;box-shadow:0 8px 40px #000";
  overlay.appendChild(canvas);

  // XP / Relic ticker + provisional rating (§28) for the local player.
  const mine = g.results?.find((r) => r.player === g.playerId);
  if (mine) {
    const ticker = document.createElement("div");
    ticker.style.cssText = "font-size:16px;letter-spacing:1px;color:#e6be8a";
    ticker.textContent =
      `PLACED #${mine.placement}   +${mine.xp} XP   +${mine.relics} ◈ RELICS   ` +
      `RATING ${mine.provisionalRating}`;
    overlay.appendChild(ticker);
  }

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:14px;align-items:center";
  const download = document.createElement("button");
  download.textContent = "⬇ SAVE CARD";
  download.style.cssText =
    "padding:10px 22px;font-size:15px;background:#241c14;color:#f0e6d0;border:1px solid #6a5a40;border-radius:5px;cursor:pointer;font-family:Georgia,serif";
  download.onclick = () => {
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "flock-recap.png";
    a.click();
  };
  const requeue = document.createElement("button");
  requeue.textContent = "REQUEUE";
  requeue.style.cssText =
    "padding:16px 56px;font-size:22px;background:#c89858;color:#1a1410;border:none;border-radius:6px;cursor:pointer;font-family:Georgia,serif;letter-spacing:4px";
  requeue.onclick = () => location.reload();
  row.appendChild(download);
  row.appendChild(requeue);
  overlay.appendChild(row);
  document.getElementById("app")!.appendChild(overlay);
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
    "① Click a glowing spot on the map to found your compound.",
    "② Use 1 / 2 / 3 to set your stance — Spread grows, Crusade pushes hard.",
    "③ Press B then click a tile to build a Compound (more followers).",
    "④ Watch the bar up top — convert the town to win. Good luck, Shepherd.",
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

function nameOf(g: GameSession, id: number): string {
  const known = g.players.find((p) => p.id === id)?.name;
  if (known) return known;
  return id >= 900 ? `Splinter Sect #${id}` : `Cult #${id}`;
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
