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

import { Application, Text } from "pixi.js";
import { toFloat, toInt, IntentType, Stance, MatchStatus } from "@flock/sim";
import { connect, type GameSession } from "./net.js";
import { MapRenderer } from "./render.js";

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    background: "#1a1410",
    resizeTo: window,
    antialias: false, // chunky 8×8 tile look (§30)
  });
  document.getElementById("app")!.appendChild(app.canvas);

  const q = new URLSearchParams(location.search);
  if (!q.get("play")) {
    showLanding();
    return;
  }
  const name = q.get("name") || `Cultist${Math.floor(Math.random() * 1000)}`;
  const archetype = q.get("archetype") ?? "dawn";
  const server = q.get("server") ?? `ws://${location.hostname}:8787`;

  const hud = new Text({
    text: "connecting…",
    style: { fill: "#f0e6d0", fontSize: 14, fontFamily: "monospace" },
  });
  hud.position.set(8, 8);

  connect(`${server}/?name=${encodeURIComponent(name)}&archetype=${archetype}`, (g) => {
    const map = new MapRenderer(app, g.sim.world.width, g.sim.world.height);
    map.setViewer(g.playerId);
    app.stage.addChild(hud); // HUD above map

    wireInput(app, map, g);

    app.ticker.add(() => {
      map.draw(g.sim);
      hud.text = hudText(g);
    });
  });
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

function wireInput(app: Application, map: MapRenderer, g: GameSession): void {
  let hover = -1;
  app.canvas.addEventListener("pointermove", (ev) => {
    hover = map.tileAt(g.sim, ev.offsetX, ev.offsetY);
  });

  // Click → SPAWN during FOUNDING (§18), then OPEN_FRONT on a 5×5 region.
  app.canvas.addEventListener("pointerdown", (ev) => {
    const center = map.tileAt(g.sim, ev.offsetX, ev.offsetY);
    if (center < 0) return;
    const meNow = g.sim.players.find((pl) => pl.id === g.playerId);
    if (meNow && !meNow.spawned) {
      g.sendIntent({ t: IntentType.SPAWN, tile: center });
      return;
    }
    const w = g.sim.world;
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

  window.addEventListener("keydown", (ev) => {
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

function hudText(g: GameSession): string {
  const me = g.sim.players.find((p) => p.id === g.playerId);
  if (!me) return "spectating";

  if (g.sim.status === MatchStatus.Ended) {
    const verdict = g.sim.winner === g.playerId ? "★ VICTORY ★" : "MATCH OVER";
    const out = [verdict, `winner: ${nameOf(g, g.sim.winner)}`, ""];
    if (g.recap) {
      out.push("— RECAP —");
      for (const pr of g.recap.players) {
        const tag = pr.won ? "👑" : pr.traitor ? "🗡" : "·";
        out.push(`${tag} ${nameOf(g, pr.player)}: "${pr.headline}"`);
        out.push(`   ${pr.tilesHeld} tiles · peak ${pr.peakFollowers} souls · $${pr.usdEarned}`);
      }
    }
    out.push("", "(refresh to requeue)");
    return out.join("\n");
  }

  if (g.sim.foundingTicksLeft > 0) {
    const secs = (g.sim.foundingTicksLeft / 10).toFixed(0);
    return me.spawned
      ? `FOUNDING — flock gathers in ${secs}s`
      : `FOUNDING — CLICK to found your compound (${secs}s)\nauto-placed if you wait`;
  }

  // leaderboard line: current leader's domination progress (§27 top bar)
  const leader = [...g.sim.players].sort((a, z) => z.ownedTiles - a.ownedTiles)[0];
  const leaderPct =
    leader && g.sim.populated > 0
      ? ((leader.ownedTiles * 100) / g.sim.populated).toFixed(1)
      : "0";
  const leaderName = g.players.find((p) => p.id === leader?.id)?.name ?? "—";

  const lines = [
    `${g.players.find((p) => p.id === g.playerId)?.name ?? "?"} [${me.archetype}] — ${me.stance.toUpperCase()}`,
    `followers ${toInt(me.followers)}   $${toInt(me.usd)}`,
    `faith ${toFloat(me.faith).toFixed(0)}   heat ${toFloat(me.heat).toFixed(0)}   tiles ${me.ownedTiles}`,
    `leader: ${leaderName} ${leaderPct}% (win ${g.sim.dominationPermille / 10}%)`,
    `tick ${g.sim.tick}   [click=front  1/2/3=stance]`,
  ];

  // Prophecy Countdown is broadcast to ALL players (§11.1) — it's the show.
  for (const pr of g.sim.prophecies) {
    const who = nameOf(g, pr.player);
    lines.push(`⏳ PROPHECY: ${who} — ${(pr.ticksLeft / 10).toFixed(0)}s`);
  }
  // drama feed essentials (§27 right rail, text edition)
  for (const sc of g.sim.scandals) {
    if (sc.victim === g.playerId && sc.notified && !sc.published)
      lines.push(`⚠ Someone is asking questions about you.`);
    if (sc.attacker === g.playerId && !sc.published && toFloat(sc.evidence) >= 100)
      lines.push(`📰 Evidence ready on ${nameOf(g, sc.victim)} — [P] to publish`);
  }
  for (const al of g.sim.alliances) {
    if (al.a === g.playerId || al.b === g.playerId)
      lines.push(`🤝 allied with ${nameOf(g, al.a === g.playerId ? al.b : al.a)}`);
  }
  for (const offer of g.sim.allianceOffers) {
    if (offer.to === g.playerId)
      lines.push(`✉ alliance offer from ${nameOf(g, offer.from)} — hover them + [I]`);
  }
  for (const pl of g.sim.players) {
    if (pl.traitor) lines.push(`🗡 JUDAS: ${nameOf(g, pl.id)}`);
  }
  if (toFloat(me.heat) >= 60) lines.push(`🚐 THE CONCERNED PARENTS ARE HERE`);
  lines.push(
    "[QWER rituals  DF actives  G sig  B/T/C/Y/U/H build  A raid  X snoop  P publish  K strike  V van  O/I ally]",
  );
  if (!me.alive) lines.unshift("☠ ELIMINATED — spectating");
  return lines.join("\n");
}

/** FTUE landing (§26): one huge PLAY button, name + archetype, no account wall. */
function showLanding(): void {
  const root = document.getElementById("app")!;
  const div = document.createElement("div");
  div.style.cssText =
    "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;" +
    "justify-content:center;gap:18px;font-family:Georgia,serif;color:#f0e6d0;" +
    "background:radial-gradient(ellipse at center,#2a2018 0%,#14100c 100%)";
  div.innerHTML = `
    <div style="font-size:64px;letter-spacing:14px;text-shadow:0 0 24px #c89858">FLOCK</div>
    <div style="font-size:14px;opacity:.7;font-style:italic">Mundane Falls needs a shepherd.</div>
    <input id="nm" placeholder="cult leader name" maxlength="24"
      style="padding:10px 14px;font-size:16px;background:#241c14;color:#f0e6d0;border:1px solid #6a5a40;border-radius:4px;width:240px;text-align:center"/>
    <select id="ar" style="padding:10px 14px;font-size:15px;background:#241c14;color:#f0e6d0;border:1px solid #6a5a40;border-radius:4px;width:270px">
      <option value="dawn">⏳ The Final Dawn — blitz conversion</option>
      <option value="radiant">🌿 The Radiant Path — unshakeable retention</option>
      <option value="circle">💼 The Prosperity Circle — the money machine</option>
      <option value="visitors">🛸 The Visitors' Fellowship — eyes everywhere</option>
    </select>
    <button id="go" style="padding:16px 64px;font-size:24px;background:#c89858;color:#1a1410;border:none;border-radius:6px;cursor:pointer;font-family:Georgia,serif;letter-spacing:4px">PLAY</button>
    <div style="font-size:11px;opacity:.5;max-width:420px;text-align:center">
      click to found · click to convert · 1/2/3 stances · QWER rituals · D/F actives · G signature<br/>
      B compound · T watchtower · C plate · A raid · X snoop · O/I alliances
    </div>`;
  root.appendChild(div);
  const go = (): void => {
    const name = (document.getElementById("nm") as HTMLInputElement).value || "Shepherd";
    const ar = (document.getElementById("ar") as HTMLSelectElement).value;
    location.search = `?play=1&name=${encodeURIComponent(name)}&archetype=${ar}`;
  };
  document.getElementById("go")!.addEventListener("click", go);
  document.getElementById("nm")!.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") go();
  });
}

function nameOf(g: GameSession, id: number): string {
  const known = g.players.find((p) => p.id === id)?.name;
  if (known) return known;
  return id >= 900 ? `Splinter Sect #${id}` : `Cult #${id}`;
}

void boot();
