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

import { Application, Graphics, Text } from "pixi.js";
import {
  toFloat,
  toInt,
  IntentType,
  Stance,
  MatchStatus,
  NEUTRAL,
  TileState,
  Terrain,
  colorForPlayer,
  renderRecapCard,
  type Archetype,
} from "@flock/sim";
import { connect, type GameSession } from "./net.js";
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

  const loading = showLoading(`Entering Mundane Falls as ${name}…`);

  connect(
    `${server}/?name=${encodeURIComponent(name)}&archetype=${archetype}`,
    (g) => {
      loading.remove();
      const map = new MapRenderer(app, g.sim.world.width, g.sim.world.height);
      map.setViewer(g.playerId);

      // Town-conversion bar (top of screen): every cult's share of the
      // population vs the unconverted remainder — the real scoreboard.
      const bar = new Graphics();
      const barLabel = new Text({
        text: "",
        style: { fill: "#1a1410", fontSize: 12, fontFamily: "monospace", fontWeight: "bold" },
      });
      barLabel.position.set(8, 4);
      app.stage.addChild(bar);
      app.stage.addChild(barLabel);

      // The crisp DOM HUD (§27): top bar, rails, build palette, minimap, feed.
      // The map is handed in as the camera so the minimap can jump + show the view.
      const hud = new Hud(g, map);
      wireInput(app, map, g, hud);

      // Center status prompt (founding / prophecy / CPA / elimination).
      const prompt = document.createElement("div");
      prompt.style.cssText =
        "position:absolute;top:120px;left:50%;transform:translateX(-50%);z-index:21;pointer-events:none;" +
        "font-family:'Segoe UI',sans-serif;font-size:16px;font-weight:700;letter-spacing:1px;color:#ffe6b0;" +
        "text-shadow:0 1px 4px #000;background:rgba(20,16,12,.6);padding:6px 18px;border-radius:6px;display:none";
      document.getElementById("app")!.appendChild(prompt);

      maybeShowFtue(); // first-session contextual coaching (§26)

      // FOUNDING spawn-pick overlay (§18/§26): pulsing rings on recommended
      // spawns until the player clicks one.
      const foundingHints = new Graphics();
      app.stage.addChild(foundingHints);
      const recommended = recommendedSpawns(g);

      let lastBarTick = -1;
      let lastHudTick = -1;
      let cardShown = false;
      app.ticker.add(() => {
        map.draw(g.sim);
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
          drawConversionBar(app, bar, barLabel, g);
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

/** Full-screen loading / connection screen (§28) with retry on failure. */
function showLoading(message: string): { remove(): void; setError(m: string): void } {
  const root = document.getElementById("app")!;
  const div = document.createElement("div");
  div.style.cssText =
    "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;" +
    "gap:20px;font-family:Georgia,serif;color:#f0e6d0;z-index:60;" +
    "background:radial-gradient(ellipse at center,#2a2018 0%,#14100c 100%)";
  div.innerHTML = `
    <div style="font-size:48px;letter-spacing:12px;text-shadow:0 0 24px #c89858">FLOCK</div>
    <div class="fk-spin" style="width:42px;height:42px;border:4px solid #4a3c28;border-top-color:#c89858;border-radius:50%;animation:fkspin 0.9s linear infinite"></div>
    <div id="fk-load-msg" style="font-size:14px;opacity:.75;font-style:italic">${message}</div>
    <style>@keyframes fkspin{to{transform:rotate(360deg)}}</style>`;
  root.appendChild(div);
  return {
    remove: () => div.remove(),
    setError: (m: string) => {
      div.innerHTML = `
        <div style="font-size:48px;letter-spacing:12px;color:#e08a6a">FLOCK</div>
        <div style="font-size:15px;opacity:.85">⚠ ${m}</div>
        <button onclick="location.reload()" style="padding:12px 40px;font-size:18px;background:#c89858;color:#1a1410;border:none;border-radius:6px;cursor:pointer;font-family:Georgia,serif;letter-spacing:3px">RETRY</button>
        <a href="?" style="color:#9a8a6a;font-size:13px">← back to menu</a>`;
    },
  };
}

/**
 * The proportion bar: cult-colored segments by population share, gray for the
 * unconverted town. Sorted big→small so the leader reads at a glance.
 */
function drawConversionBar(app: Application, bar: Graphics, label: Text, g: GameSession): void {
  const w = g.sim.world;
  const popByOwner = new Map<number, number>();
  let converted = 0;
  for (let t = 0; t < w.owner.length; t++) {
    const o = w.owner[t]!;
    if (o === NEUTRAL || w.state[t] !== TileState.Believer) continue;
    const pop = w.pop[t]!;
    popByOwner.set(o, (popByOwner.get(o) ?? 0) + pop);
    converted += pop;
  }
  const total = Math.max(1, g.sim.totalPop);
  const width = app.renderer.width;
  const H = 22;

  bar.clear();
  bar.rect(0, 0, width, H).fill(0x3a3530); // the unconverted town
  let x = 0;
  const shares = [...popByOwner.entries()].sort((a, z) => z[1] - a[1]);
  for (const [owner, pop] of shares) {
    const seg = (pop / total) * width;
    const colorHex = parseInt(colorForPlayer(owner).slice(1), 16);
    bar.rect(x, 0, seg, H).fill(colorHex);
    x += seg;
  }
  bar.rect(0, H, width, 2).fill(0x1a1410);

  const pct = ((converted / total) * 100).toFixed(1);
  const mine = ((popByOwner.get(g.playerId) ?? 0) / total) * 100;
  // every match is a fresh fake town (names.ts / faker corpus)
  const townName = (g.sim.world.townName || "Mundane Falls").toUpperCase();
  label.text = `${townName} — ${pct}% converted   (you: ${mine.toFixed(1)}% of ${total} souls)`;
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
      switch (placement.mode) {
        case "build":
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
        if (hover >= 0) g.sendIntent({ t: IntentType.BUILD, building: "garage", tile: hover });
        return;
      case "u":
        if (hover >= 0) g.sendIntent({ t: IntentType.BUILD, building: "broadcast_tower", tile: hover });
        return;
      case "h":
        if (hover >= 0) g.sendIntent({ t: IntentType.BUILD, building: "hotline_center", tile: hover });
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
        if (hover >= 0) g.sendIntent({ t: IntentType.VAN_MOVE, van: -1, path: [hover] });
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
    const secs = (g.sim.foundingTicksLeft / 10).toFixed(0);
    return me.spawned
      ? `FOUNDING — your flock gathers · ${secs}s`
      : `CLICK A GLOWING SPOT TO FOUND YOUR COMPOUND · ${secs}s`;
  }
  if (!me.alive) return "☠ ELIMINATED — spectating";
  const prophecy = g.sim.prophecies[0];
  if (prophecy) return `⏳ PROPHECY: ${nameOf(g, prophecy.player)} — ${(prophecy.ticksLeft / 10).toFixed(0)}s`;
  if (toFloat(me.heat) >= 60) return "🚐 THE CONCERNED PARENTS ARE HERE";
  return "";
}

/**
 * Pick a handful of recommended spawn tiles (§26 FTUE guidance): unowned
 * Citizen tiles with the highest susceptibility, spread out so they don't
 * cluster. Computed once — the world is static for the match.
 */
function recommendedSpawns(g: GameSession): number[] {
  const w = g.sim.world;
  const candidates: { tile: number; s: number }[] = [];
  const stride = Math.max(1, Math.floor(w.width / 48));
  for (let y = 2; y < w.height - 2; y += stride) {
    for (let x = 2; x < w.width - 2; x += stride) {
      const t = y * w.width + x;
      if (w.terrain[t] !== Terrain.Citizen || w.owner[t] !== NEUTRAL) continue;
      candidates.push({ tile: t, s: w.susceptibility[t]! });
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
    "position:absolute;bottom:120px;left:50%;transform:translateX(-50%);z-index:55;max-width:460px;" +
    "background:rgba(20,16,12,.95);border:1px solid #c89858;border-radius:8px;padding:14px 20px;" +
    "font-family:'Segoe UI',sans-serif;color:#f0e6d0;font-size:15px;text-align:center;cursor:pointer;box-shadow:0 6px 24px #000";
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
