/**
 * Lobby / main menu (§28). The landing shell: a Daily Prophecy ticker, the big
 * PLAY action (FTUE §26 — name + archetype, no account wall), and tabs that
 * consume the server REST API (leaderboard, store, congregations, profile) plus
 * the settings/accessibility panel. Pure DOM over the chunky world aesthetic.
 *
 * Visuals follow the Claude Design handoff ("Flock HUD System", §03/§04):
 * Press Start 2P / Pixelify Sans / VT323, hard drop shadows, square corners,
 * scanline + vignette background, and a per-archetype accent that re-dresses
 * the whole menu (nav, buttons, pattern overlay) on selection.
 */

import { getSettings, saveSettings } from "./settings.js";

const TOKEN_KEY = "flock.session";

// ---------------------------------------------------------------------------
// design tokens (§01 of the handoff)
// ---------------------------------------------------------------------------
const CREAM = "#efe3c6";
const MUTED = "#a08a64";
const INK = "#19110a";
const PANEL = "#1a130b";
const PANEL_IN = "#241c12";
const BORDER = "#4a3a26";
const SHADOW = "#060403";
const ROWLINE = "#2a2014";
const DIM = "#8a7550";
const GOLD = "#e0a422";

const TIER_COLORS: Record<string, string> = {
  PROPHET: "#f0b53e",
  ORACLE: "#cf4b2c",
  CARDINAL: "#84a23c",
  MINISTER: "#4fa3ad",
  DEACON: "#a08a64",
};

// ---------------------------------------------------------------------------
// pixel-art glyphs (8x8 bitmaps, ported from the design prototype)
// ---------------------------------------------------------------------------
const GLYPH: Record<string, string[]> = {
  people: ["01100110", "01100110", "00000000", "11111111", "11111111", "11111111", "10111101", "10111101"],
  coin: ["00111100", "01100110", "11011011", "11011011", "11011011", "11011011", "01100110", "00111100"],
  heart: ["01100110", "11111111", "11111111", "11111111", "01111110", "00111100", "00011000", "00000000"],
  flame: ["00010000", "00011000", "00111100", "01111110", "01111110", "11111111", "11111111", "01111110"],
  clock: ["00111100", "01000010", "10011001", "10011101", "10010001", "10000001", "01000010", "00111100"],
  crown: ["10000001", "10100101", "10100101", "11111111", "11111111", "11111111", "00000000", "11111111"],
  candle: ["00011000", "00011000", "00111100", "00011000", "00111100", "00111100", "00111100", "01111110"],
  mega: ["00000011", "00001111", "00111111", "11111111", "11111111", "00111111", "00001111", "00000011"],
  house: ["00011000", "00111100", "01111110", "11111111", "11011011", "11011011", "11000011", "11011011"],
  tower: ["01111110", "01011010", "00111100", "00111100", "00111100", "00111100", "01111110", "01111110"],
  plate: ["00011000", "00000000", "10000001", "11000011", "01111110", "00111100", "00000000", "00000000"],
  antenna: ["00011000", "00011000", "10111010", "01111100", "00111000", "00111000", "00111000", "01111100"],
  phone: ["11000011", "11000011", "01000010", "00111100", "00111100", "01000010", "11000011", "11000011"],
  press: ["11111111", "10000001", "11111111", "00111100", "11111111", "11111111", "11111111", "11111111"],
  van: ["00000000", "01111110", "11111111", "11111111", "11111111", "11111111", "01011010", "00100100"],
  flask: ["00111100", "00100100", "00100100", "00100100", "01000010", "01011010", "11111111", "01111110"],
  scroll: ["01111110", "11111111", "11011011", "11111111", "11011011", "11111111", "11111111", "01111110"],
  bolt: ["00011100", "00111000", "01110000", "11111110", "00011111", "00001110", "00011100", "00110000"],
  eye: ["00000000", "00111100", "01111110", "11011011", "11011011", "01111110", "00111100", "00000000"],
  ufo: ["00011000", "00111100", "01111110", "11111111", "00111100", "01000010", "10000001", "00000000"],
  leaf: ["00010000", "00110010", "01100110", "01001100", "11011000", "01110000", "00010000", "00010000"],
  star: ["00010000", "00010000", "11111111", "00111100", "01111110", "01100110", "11000011", "00000000"],
};

/** Render an 8x8 bitmap glyph as a crisp-edged SVG built from 1px rects. */
function icon(name: string, color: string, px: number): string {
  const rows = GLYPH[name] ?? [];
  let cells = "";
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x++) {
      if (row[x] === "1") cells += `<rect x="${x}" y="${y}" width="1.05" height="1.05" fill="${color}"/>`;
    }
  }
  return `<svg width="${px}" height="${px}" viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg" style="display:block;shape-rendering:crispEdges;flex:none">${cells}</svg>`;
}

// ---------------------------------------------------------------------------
// archetype data (kit copy + accents, ported from the design prototype)
// ---------------------------------------------------------------------------
type ArchId = "dawn" | "radiant" | "circle" | "visitors";
type Pattern = "crack" | "bloom" | "stripe" | "stars";

interface ArchDef {
  label: string;
  tag: string;
  accent: string;
  accent2: string;
  glyph: string;
  actD: string;
  actF: string;
  sig: string;
  r0: string;
  def: string;
  win: string;
  passive: string;
  dD: string;
  dF: string;
  dSig: string;
  tip: string;
  pattern: Pattern;
}

const ARCH: Record<ArchId, ArchDef> = {
  dawn: {
    label: "The Final Dawn", tag: "DOOMSDAY", accent: "#df5a2b", accent2: "#f0b53e", glyph: "candle",
    actD: "Street Prophet", actF: "Stockpile Sermon", sig: "Prophecy Countdown", r0: "1.30", def: "0.80", win: "51%",
    passive: "FEAR FEEDS US — +2% conversion per active front anywhere on the map (cap +25%).",
    dD: "Plant a 30s fear-pressure pylon.", dF: "One district: your pressure ×3 for 12s.",
    dSig: "Broadcast a 3:00 doomsday timer to the whole lobby.",
    tip: "Spawn near College — you blitz, they churn. Never CRUSADE with an open home.", pattern: "crack",
  },
  radiant: {
    label: "The Radiant Path", tag: "WELLNESS", accent: "#84a23c", accent2: "#c4dd72", glyph: "leaf",
    actD: "Juice Cleanse", actF: "Retreat Weekend", sig: "Supplement Empire", r0: "0.80", def: "1.50", win: "49%",
    passive: "THE GLOW — owned tiles gain retention the longer you hold them, up to +80%.",
    dD: "Zero one district's dissent.", dF: "Radius love-bomb: 2.5× conversion, zero Heat.",
    dSig: "Supplement Labs that quietly hook your neighbors.",
    tip: "Old Town + Glow is near-unflippable. Win the games you don't fight.", pattern: "bloom",
  },
  circle: {
    label: "The Prosperity Circle", tag: "M.L.M.", accent: "#e0a422", accent2: "#f3cf6a", glyph: "coin",
    actD: "Seminar Blitz", actF: "Hostile Takeover", sig: "The Ledger", r0: "0.60", def: "0.90", win: "50%",
    passive: "DOWNLINE — creep-flipped tiles pay 2× tithe, forever.",
    dD: "+2,500 followers, instantly.", dF: "Buy a neutral landmark or income district outright.",
    dSig: "Bank to the Ledger target for an Economic victory.",
    tip: "Spawn on Downtown's approach. Keep Heat at zero and Scandal can't touch you.", pattern: "stripe",
  },
  visitors: {
    label: "Visitors' Fellowship", tag: "U.F.O.", accent: "#4fa3ad", accent2: "#8fd6dd", glyph: "ufo",
    actD: "Crop Circle", actF: "Radio Static", sig: "Saucer Landing", r0: "1.00", def: "1.00", win: "50%",
    passive: "STARGAZERS — vision ×2; see every rival's Heat & Dissent without doctrine.",
    dD: "Gift or trap a district with +30 susceptibility for everyone.", dF: "Knock an enemy Broadcast Tower offline for 20s.",
    dSig: "Land a saucer chapel on ANY visible tile — even across water.",
    tip: "Home is wherever the saucer parks. Snipe the Radio Tower early.", pattern: "stars",
  },
};

const ARCH_IDS: ArchId[] = ["dawn", "radiant", "circle", "visitors"];

/** Selected archetype — drives the accent that re-dresses the whole menu. */
let selectedArch: ArchId = "dawn";
/** Re-dresses the shell (nav highlight + pattern overlay) after an arch pick. */
let redressShell: (() => void) | null = null;

/** Per-archetype background pattern overlay (crack/bloom/stripe/stars). */
function patternCss(a: ArchDef): string {
  const img: Record<Pattern, string> = {
    crack: `repeating-radial-gradient(circle at 50% 36%, transparent 0 13px, ${a.accent}22 13px 15px)`,
    bloom: `radial-gradient(circle at 50% 18%, ${a.accent}40 0%, transparent 58%)`,
    stripe: `repeating-linear-gradient(135deg, ${a.accent}24 0 2px, transparent 2px 13px)`,
    stars: `radial-gradient(${a.accent2}66 1px, transparent 1.7px)`,
  };
  const size = a.pattern === "stars" ? "23px 23px" : "auto";
  return `position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.55;background-image:${img[a.pattern]};background-size:${size}`;
}

// ---------------------------------------------------------------------------
// networking (unchanged)
// ---------------------------------------------------------------------------

/** Derive the REST base (http) from the ws server URL. */
function httpBase(): string {
  const q = new URLSearchParams(location.search);
  const ws = q.get("server") ?? `ws://${location.hostname}:8787`;
  return ws.replace(/^ws/, "http");
}

function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function api(path: string, opts: RequestInit = {}): Promise<unknown> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers as Record<string, string>) };
  const tok = token();
  if (tok) headers["authorization"] = `Bearer ${tok}`;
  const res = await fetch(httpBase() + path, { ...opts, headers });
  return res.json();
}

/** Escape API-sourced user content before innerHTML (XSS guard). */
const esc = (s: string): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ---------------------------------------------------------------------------
// shared style helpers (§04 panel idiom)
// ---------------------------------------------------------------------------
const card = (inner: string): string =>
  `<div style="background:${PANEL};border:3px solid ${BORDER};box-shadow:0 4px 0 ${SHADOW};padding:14px;margin:8px 0">${inner}</div>`;

const head = (t: string): string =>
  `<div style="font-family:'Press Start 2P',monospace;font-size:9px;letter-spacing:1px;color:${GOLD};margin-bottom:12px">${t}</div>`;

const vt = (v: string | number, color = "#d8c8a6", size = 18): string =>
  `<span style="font-family:'VT323',monospace;font-size:${size}px;color:${color}">${v}</span>`;

const tierBadge = (tier: string): string =>
  `<span style="font-family:'Press Start 2P',monospace;font-size:7px;letter-spacing:.5px;color:${TIER_COLORS[tier] ?? MUTED}">${esc(tier)}</span>`;

const KEYS_LINE =
  "KEYS — 1/2/3 stance · QWER ritual · D/F power · G signature · B/T/C/Y/U/H build · V van · ⇧C close front · Z cancel build · F8 surrender · ⏸ pause (solo) · Esc cancel";

// per-accent button styles (ported from the prototype's renderVals)
const soloCss = (a: ArchDef): string =>
  `position:relative;z-index:1;display:block;width:100%;text-align:left;padding:15px 17px;border:0;cursor:pointer;` +
  `font-family:'Pixelify Sans',monospace;color:${INK};background:${a.accent};box-shadow:0 5px 0 ${SHADOW},inset 0 0 0 3px ${a.accent2}`;

const lobbyCss =
  `position:relative;z-index:1;display:block;text-align:left;padding:14px 15px;` +
  `font-family:'Pixelify Sans',monospace;color:${CREAM};background:${PANEL};box-shadow:0 5px 0 ${SHADOW},inset 0 0 0 1px ${BORDER}`;

const goCss = (a: ArchDef): string =>
  `font-family:'Pixelify Sans',monospace;font-size:13px;font-weight:700;padding:5px 12px;color:${INK};background:${a.accent};border:0;cursor:pointer;box-shadow:0 2px 0 ${SHADOW}`;

const cardCss = (sel: boolean, a: ArchDef): string =>
  `position:relative;display:block;padding:16px 14px;border:0;cursor:pointer;font-family:'Pixelify Sans',monospace;color:${CREAM};` +
  (sel
    ? `background:${PANEL_IN};box-shadow:0 5px 0 ${SHADOW},inset 0 0 0 3px ${a.accent}`
    : `background:${PANEL};box-shadow:0 5px 0 ${SHADOW},inset 0 0 0 1px #36291a`);

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------
export function showMenu(): void {
  const root = document.getElementById("app")!;
  const div = document.createElement("div");
  div.id = "fk-menu";
  div.style.cssText =
    "position:absolute;inset:0;overflow:auto;font-family:'Pixelify Sans',ui-monospace,monospace;color:" + CREAM + ";" +
    "background:#120d07;background-image:repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0 1px,transparent 1px 3px)," +
    "radial-gradient(ellipse at 50% 0%,#241a10 0%,#120d07 60%)";
  div.innerHTML = `
    <style>
      #fk-menu ::-webkit-scrollbar{width:8px;height:8px}
      #fk-menu ::-webkit-scrollbar-thumb{background:${BORDER};border:1px solid #6b563a}
      #fk-menu ::-webkit-scrollbar-track{background:${PANEL}}
      @keyframes fkBlink{50%{opacity:.3}}
      #fk-menu .nav button{font-family:'Pixelify Sans',monospace;font-size:13px;letter-spacing:.5px;padding:8px 14px;color:#cdbf9c;background:transparent;border:0;box-shadow:none;cursor:pointer}
      #fk-menu .nav button.on{color:${INK};font-weight:600;box-shadow:0 3px 0 ${SHADOW}}
      #fk-menu input,#fk-menu select{background:#0e0a05;color:${CREAM};border:0;box-shadow:inset 0 0 0 1px ${BORDER};padding:5px 9px;font-family:'VT323',monospace;font-size:18px}
      #fk-menu input:focus,#fk-menu select:focus{outline:none;box-shadow:inset 0 0 0 1px #6b563a}
      #fk-menu select option{background:${PANEL_IN};color:${CREAM}}
      #fk-menu .row{display:flex;gap:9px;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid ${ROWLINE};font-size:13px}
      #fk-menu .buy{font-family:'Pixelify Sans',monospace;font-size:12px;padding:4px 10px;color:${CREAM};background:${PANEL_IN};box-shadow:inset 0 0 0 1px #6b563a,0 2px 0 ${SHADOW};border:0;cursor:pointer}
    </style>
    <div id="fk-pattern" style="${patternCss(ARCH[selectedArch])}"></div>
    <div style="position:relative;z-index:1;max-width:960px;margin:0 auto;padding:34px 18px 70px">
      <div style="text-align:center;margin-bottom:8px">
        <div style="font-family:'Press Start 2P',monospace;font-size:38px;color:${CREAM};text-shadow:4px 4px 0 #cf4b2c,8px 8px 0 #2a1d10">FLOCK</div>
        <div id="fk-daily" style="margin-top:18px;display:inline-flex;align-items:center;gap:10px;background:${PANEL};border:2px solid ${BORDER};box-shadow:0 3px 0 ${SHADOW};padding:8px 16px;font-size:14px;color:#d8c8a6;min-height:18px">…</div>
      </div>
      <div class="nav" style="display:flex;gap:6px;justify-content:center;margin:24px 0;flex-wrap:wrap">
        <button data-tab="play" class="on">PLAY</button>
        <button data-tab="leaderboard">LEADERBOARD</button>
        <button data-tab="store">STORE</button>
        <button data-tab="congregations">CONGREGATIONS</button>
        <button data-tab="profile">PROFILE</button>
        <button data-tab="settings">SETTINGS</button>
      </div>
      <div id="fk-panel"></div>
    </div>`;
  root.appendChild(div);

  const panel = div.querySelector<HTMLDivElement>("#fk-panel")!;
  const nav = div.querySelectorAll<HTMLButtonElement>(".nav button");
  let currentTab = "play";
  const dressNav = (): void => {
    const accent = ARCH[selectedArch].accent;
    nav.forEach((b) => {
      const on = b.dataset.tab === currentTab;
      b.classList.toggle("on", on);
      b.style.background = on ? accent : "transparent";
    });
  };
  const select = (tab: string): void => {
    currentTab = tab;
    dressNav();
    void render(tab, panel);
  };
  nav.forEach((b) => (b.onclick = () => select(b.dataset.tab!)));

  redressShell = () => {
    dressNav();
    const pat = div.querySelector<HTMLDivElement>("#fk-pattern");
    if (pat) pat.style.cssText = patternCss(ARCH[selectedArch]);
  };

  // daily prophecy chip
  void api("/daily")
    .then((d) => {
      const data = d as { challenge?: { title: string; description: string }; freeRotation?: string[] };
      const el = div.querySelector("#fk-daily")!;
      if (data.challenge) {
        el.innerHTML =
          `<span style="color:${GOLD};font-family:'Press Start 2P',monospace;font-size:9px">PROPHECY</span>` +
          `<span>${esc(data.challenge.description)}</span>` +
          `<span style="color:#9bbf6a">+30 ◈</span>`;
      }
    })
    .catch(() => {});

  select("play");
}

async function render(tab: string, panel: HTMLDivElement): Promise<void> {
  switch (tab) {
    case "play":
      return renderPlay(panel);
    case "leaderboard":
      return renderLeaderboard(panel);
    case "store":
      return renderStore(panel);
    case "congregations":
      return renderCongregations(panel);
    case "profile":
      return renderProfile(panel);
    case "settings":
      return renderSettings(panel);
  }
}

// ---------------------------------------------------------------------------
// PLAY tab — archetype cards, loadout reveal, cult name, play options
// ---------------------------------------------------------------------------

const loadoutHtml = (a: ArchDef): string => `
  <div style="margin:0 auto 22px;background:${PANEL};border:3px solid ${BORDER};box-shadow:0 4px 0 ${SHADOW};border-left:6px solid ${a.accent};padding:16px 18px;display:flex;gap:16px;align-items:flex-start">
    <div style="flex:none;width:62px;height:62px;display:flex;align-items:center;justify-content:center;background:${PANEL_IN};box-shadow:inset 0 0 0 2px ${a.accent}">${icon(a.glyph, a.accent, 34)}</div>
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;line-height:1.2">
        <span style="font-size:18px;font-weight:700;color:${a.accent};white-space:nowrap">${a.label}</span>
        <span style="font-family:'Press Start 2P',monospace;font-size:7px;letter-spacing:1px;color:${DIM}">${a.tag}</span>
      </div>
      <div style="font-size:13px;color:#d8c8a6;margin-top:11px;line-height:1.4">${a.passive}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin-top:12px;font-size:12px">
        <div><span style="color:${a.accent};font-weight:700">◆ ${a.actD}</span> <span style="color:${MUTED}">— ${a.dD}</span></div>
        <div><span style="color:${a.accent};font-weight:700">◆ ${a.actF}</span> <span style="color:${MUTED}">— ${a.dF}</span></div>
        <div style="grid-column:span 2"><span style="color:${a.accent2};font-weight:700">★ ${a.sig}</span> <span style="color:${MUTED}">— ${a.dSig}</span></div>
      </div>
      <div style="margin-top:12px;font-family:'VT323',monospace;font-size:16px;color:${DIM};font-style:italic;border-top:1px dashed ${BORDER};padding-top:8px">▸ ${a.tip}</div>
    </div>
  </div>`;

function renderPlay(panel: HTMLDivElement): void {
  const a0 = ARCH[selectedArch];
  const knob = (label: string, sel: string): string =>
    `<label style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:#cdbf9c">${label} ${sel}</label>`;
  panel.innerHTML = `
    <div style="font-family:'Press Start 2P',monospace;font-size:8px;letter-spacing:1px;color:${DIM};text-align:center;margin-bottom:14px">CHOOSE YOUR CONGREGATION</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:0 auto 24px">
      ${ARCH_IDS.map((id) => {
        const a = ARCH[id];
        return `<button data-arch="${id}" style="${cardCss(id === selectedArch, a)}">
          <div style="display:flex;justify-content:center;margin-bottom:10px">${icon(a.glyph, a.accent, 30)}</div>
          <div style="font-size:15px;font-weight:600;letter-spacing:.3px;line-height:1.15">${a.label}</div>
          <div style="font-family:'Press Start 2P',monospace;font-size:7px;letter-spacing:1px;opacity:.7;margin:8px 0 10px">${a.tag}</div>
          <div style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:${MUTED};text-align:left">
            <div>R₀ <span style="float:right;color:#d8c8a6">${a.r0}</span></div>
            <div>DEF <span style="float:right;color:#d8c8a6">${a.def}</span></div>
            <div>WIN% <span style="float:right;color:#9bbf6a">${a.win}</span></div>
          </div>
        </button>`;
      }).join("")}
    </div>
    <div id="fk-loadout">${loadoutHtml(a0)}</div>
    <div style="display:flex;flex-direction:column;gap:13px;align-items:center">
      <div style="display:flex;align-items:center;gap:12px;background:${PANEL};border:3px solid ${BORDER};box-shadow:0 3px 0 ${SHADOW};padding:12px 18px;width:100%;max-width:460px">
        <span style="font-family:'Press Start 2P',monospace;font-size:8px;color:${DIM};letter-spacing:1px;flex:none">CULT NAME</span>
        <input id="nm" placeholder="Shepherd" maxlength="24" style="flex:1;min-width:0;background:transparent;box-shadow:none;border:0;outline:none;padding:0;font-family:'VT323',monospace;font-size:22px;color:${CREAM};caret-color:${a0.accent}"/>
      </div>
      <button id="tut" style="width:100%;margin-bottom:12px;display:flex;align-items:center;justify-content:center;gap:12px;padding:13px;border:0;cursor:pointer;font-family:'Pixelify Sans',monospace;color:#efe3c6;background:#241c12;box-shadow:0 4px 0 #060403,inset 0 0 0 2px #f0b53e">
        <span style="font-family:'Press Start 2P',monospace;font-size:10px;color:#f0b53e;letter-spacing:1px">🎓 TUTORIAL</span>
        <span style="font-size:13px;color:#a08a64">a guided first match — offline, 3 minutes, the same for everyone</span>
      </button>
      <div style="display:grid;grid-template-columns:1.15fr 1fr 1.2fr;gap:12px;width:100%;align-items:start">
        <button id="go" style="${soloCss(a0)}">
          <div style="font-size:18px;font-weight:700;letter-spacing:.5px">▶ SOLO</div>
          <div style="font-size:12px;opacity:.85;margin-top:4px">Drop into a bot match. Instant.</div>
        </button>
        <div style="${lobbyCss}">
          <div style="font-size:15px;font-weight:600;letter-spacing:.3px">＋ CREATE LOBBY</div>
          <div style="font-size:11px;color:${MUTED};margin-top:4px">Host friends · get a code</div>
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">
            ${knob("BOTS", `<select id="pv-bots" style="font-size:16px;padding:3px 6px"><option>0</option><option>1</option><option selected>2</option><option>3</option></select>`)}
            ${knob("MAP", `<select id="pv-size" style="font-size:16px;padding:3px 6px"><option value="64">Small (64)</option><option value="96" selected>Classic (96)</option><option value="128">Large (128)</option></select>`)}
            ${knob("TOWN", `<select id="pv-town" style="font-size:16px;padding:3px 6px"><option value="farm" selected>Farm (classic)</option><option value="oceanside">Oceanside</option><option value="desert">Desert</option><option value="mountain">Mountain</option><option value="lakeside">Lakeside</option></select>`)}
            ${knob("FOUNDING", `<select id="pv-founding" style="font-size:16px;padding:3px 6px"><option value="200" selected>Normal</option><option value="400">Relaxed</option><option value="120">Blitz</option></select>`)}
          </div>
          <button id="host" style="${goCss(a0)};width:100%;margin-top:10px">CREATE</button>
          <div style="font-size:11px;color:${DIM};margin-top:6px">You'll get a 5-letter code to share once you're in.</div>
        </div>
        <div style="${lobbyCss}">
          <div style="font-size:15px;font-weight:600;letter-spacing:.3px">⇲ JOIN LOBBY</div>
          <div style="display:flex;gap:6px;margin-top:7px">
            <input id="code" placeholder="CODE ▸ ____" maxlength="5" style="flex:1;min-width:0;font-family:'VT323',monospace;font-size:18px;letter-spacing:3px;color:${CREAM};background:#0e0a05;box-shadow:inset 0 0 0 1px ${BORDER};padding:4px 8px;border:0;text-transform:uppercase"/>
            <button id="joinp" style="${goCss(a0)}">GO</button>
          </div>
        </div>
      </div>
      <div style="font-family:'VT323',monospace;font-size:15px;color:${DIM};max-width:640px;text-align:center">
        click a glowing spot to found · click to convert · 1/2/3 stances · QWER rituals · D/F powers · G signature · V van · ⇧C close front · Z cancel build · F8 surrender · ⏸ pause (solo)
      </div>
    </div>`;

  // archetype selection re-dresses the whole menu (cards, loadout, buttons, nav, pattern)
  const applyArch = (id: ArchId): void => {
    selectedArch = id;
    const a = ARCH[id];
    panel.querySelectorAll<HTMLButtonElement>("[data-arch]").forEach((b) => {
      const aid = b.dataset.arch as ArchId;
      b.style.cssText = cardCss(aid === id, ARCH[aid]);
    });
    (panel.querySelector("#fk-loadout") as HTMLDivElement).innerHTML = loadoutHtml(a);
    (panel.querySelector("#go") as HTMLButtonElement).style.cssText = soloCss(a);
    (panel.querySelector("#host") as HTMLButtonElement).style.cssText = `${goCss(a)};width:100%;margin-top:10px`;
    (panel.querySelector("#joinp") as HTMLButtonElement).style.cssText = goCss(a);
    (panel.querySelector("#nm") as HTMLInputElement).style.caretColor = a.accent;
    redressShell?.();
  };
  panel.querySelectorAll<HTMLButtonElement>("[data-arch]").forEach((b) => {
    b.onclick = () => applyArch(b.dataset.arch as ArchId);
  });

  const base = (): string => {
    const name = (panel.querySelector("#nm") as HTMLInputElement).value || "Shepherd";
    const q = new URLSearchParams(location.search);
    const sv = q.get("server");
    return `?play=1&name=${encodeURIComponent(name)}&archetype=${selectedArch}${sv ? `&server=${encodeURIComponent(sv)}` : ""}`;
  };
  const go = (): void => {
    location.search = base();
  };
  (panel.querySelector("#go") as HTMLButtonElement).onclick = go;
  (panel.querySelector("#joinp") as HTMLButtonElement).onclick = () => {
    const code = (panel.querySelector("#code") as HTMLInputElement).value.trim().toUpperCase();
    if (code.length !== 5) return;
    location.search = `${base()}&room=${encodeURIComponent(code)}`;
  };
  (panel.querySelector("#tut") as HTMLButtonElement).onclick = () => {
    location.search = "?play=1&tutorial=1&name=Novice&archetype=dawn";
  };
  (panel.querySelector("#host") as HTMLButtonElement).onclick = () => {
    const v = (id: string): string => (panel.querySelector(`#${id}`) as HTMLSelectElement).value;
    location.search = `${base()}&private=1&bots=${v("pv-bots")}&size=${v("pv-size")}&town=${v("pv-town")}&founding=${v("pv-founding")}`;
  };
  (panel.querySelector("#nm") as HTMLInputElement).addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") go();
  });
  (panel.querySelector("#code") as HTMLInputElement).addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") (panel.querySelector("#joinp") as HTMLButtonElement).click();
  });
}

// ---------------------------------------------------------------------------
// other tabs — §04 panel idiom, logic untouched
// ---------------------------------------------------------------------------

async function renderLeaderboard(panel: HTMLDivElement): Promise<void> {
  panel.innerHTML = card(head("LEADERBOARD") + `<div style="color:${DIM}">loading leaderboard…</div>`);
  const data = (await api("/leaderboard").catch(() => ({ players: [] }))) as {
    players: { rank: number; name: string; rating: number; tier: string; isProphet: boolean }[];
  };
  if (!data.players.length) {
    panel.innerHTML = card(head("LEADERBOARD") + `<div style="color:${DIM}">No ranked players yet — finish a match to appear.</div>`);
    return;
  }
  panel.innerHTML = card(
    head("LEADERBOARD") +
      data.players
        .map(
          (p) =>
            `<div class="row" style="justify-content:flex-start">
               <span style="font-family:'VT323',monospace;font-size:18px;color:${DIM};min-width:30px">#${p.rank}</span>
               <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.isProphet ? `<span style="color:#f0b53e">✦</span> ` : ""}${esc(p.name)}</span>
               ${tierBadge(p.tier)}
               ${vt(p.rating)}
             </div>`,
        )
        .join(""),
  );
}

async function renderStore(panel: HTMLDivElement): Promise<void> {
  panel.innerHTML = card(head("STORE") + `<div style="color:${DIM}">loading store…</div>`);
  const cat = (await api("/catalog").catch(() => ({ items: [] }))) as {
    items: { id: string; name: string; cost: number; currency: string; kind: string }[];
  };
  const me = (await api("/me").catch(() => null)) as { relics: number; shards: number; profile?: { unlocks: string[] } } | null;
  const owned = new Set(me?.profile?.unlocks ?? []);
  const wallet = me
    ? `<div style="font-family:'VT323',monospace;font-size:16px;color:${DIM};margin-bottom:10px">◈ ${me.relics} Relics · ✦ ${me.shards} Shards <span style="opacity:.6">— earned, never sold</span></div>`
    : `<div style="font-family:'VT323',monospace;font-size:16px;color:${DIM};margin-bottom:10px">Play a match to earn Relics <span style="opacity:.6">— earned, never sold</span></div>`;
  panel.innerHTML = card(
    head("STORE") +
      wallet +
      cat.items
        .map((it) => {
          const cur = it.currency === "relics" ? "◈" : it.currency === "shards" ? "✦" : "$";
          const own = owned.has(it.id.replace(/^unlock_/, "")) || owned.has(it.id);
          const btn = own ? `<span style="color:${DIM};font-size:12px">owned</span>` : `<button class="buy" data-item="${esc(it.id)}">${cur}${it.cost}</button>`;
          return `<div class="row"><span>${esc(it.name)} <span style="color:#6b563a;font-size:10px">${esc(it.kind)}</span></span>${btn}</div>`;
        })
        .join(""),
  );
  panel.querySelectorAll<HTMLButtonElement>("[data-item]").forEach((b) => {
    b.onclick = async () => {
      if (!token()) {
        b.textContent = "play first";
        return;
      }
      const r = (await api("/purchase", { method: "POST", body: JSON.stringify({ itemId: b.dataset.item }) }).catch(() => ({ error: "failed" }))) as { ok?: boolean; error?: string };
      if (r.ok) void renderStore(panel);
      else b.textContent = r.error ?? "no";
    };
  });
}

async function renderCongregations(panel: HTMLDivElement): Promise<void> {
  panel.innerHTML = card(head("CONGREGATIONS") + `<div style="color:${DIM}">loading congregations…</div>`);
  const data = (await api("/congregations").catch(() => ({ ladder: [] }))) as {
    ladder: { congregation: { id: string; name: string; tag: string; members: string[] }; score: number }[];
  };
  const list = data.ladder.length
    ? data.ladder
        .map(
          (e) =>
            `<div class="row"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">[${esc(e.congregation.tag)}] ${esc(e.congregation.name)} <span style="color:${DIM};font-size:11px">${e.congregation.members.length}/50</span></span><span style="display:flex;gap:8px;align-items:center;flex:none">${vt(`${e.score} pts`, "#d8c8a6", 17)}<button class="buy" data-join="${esc(e.congregation.id)}">join</button></span></div>`,
        )
        .join("")
    : `<div style="color:${DIM};margin:8px 0">No congregations yet. Found one below.</div>`;
  panel.innerHTML = card(
    head(`CONGREGATIONS <span style="color:#6b563a">— WEEKLY BEST-10 LADDER (§24)</span>`) +
      list +
      `<div class="row" style="border:none;margin-top:10px">
         <input id="cn" placeholder="congregation name" maxlength="24" style="flex:1;min-width:0"/>
         <input id="ct" placeholder="TAG" maxlength="4" style="width:70px;text-transform:uppercase"/>
         <button class="buy" id="cc">found</button>
       </div>`,
  );
  panel.querySelectorAll<HTMLButtonElement>("[data-join]").forEach((b) => {
    b.onclick = async () => {
      if (!token()) return void (b.textContent = "play first");
      await api("/congregations/join", { method: "POST", body: JSON.stringify({ id: b.dataset.join }) }).catch(() => {});
      void renderCongregations(panel);
    };
  });
  (panel.querySelector("#cc") as HTMLButtonElement).onclick = async () => {
    if (!token()) return void ((panel.querySelector("#cc") as HTMLButtonElement).textContent = "play first");
    const name = (panel.querySelector("#cn") as HTMLInputElement).value;
    const tag = (panel.querySelector("#ct") as HTMLInputElement).value;
    const r = (await api("/congregations", { method: "POST", body: JSON.stringify({ name, tag }) }).catch(() => ({ ok: false }))) as { ok?: boolean; reason?: string };
    if (r.ok) void renderCongregations(panel);
    else (panel.querySelector("#cc") as HTMLButtonElement).textContent = r.reason ?? "no";
  };
}

async function renderProfile(panel: HTMLDivElement): Promise<void> {
  if (!token()) {
    panel.innerHTML = card(head("PROFILE") + `<div style="color:${DIM}">Play a match to create your account — your legend is saved automatically.</div>`);
    return;
  }
  panel.innerHTML = card(head("PROFILE") + `<div style="color:${DIM}">loading profile…</div>`);
  const me = (await api("/me").catch(() => null)) as { profile?: { name: string; level: number; rating: number; tier: string }; relics: number; shards: number } | null;
  if (!me?.profile) {
    panel.innerHTML = card(head("PROFILE") + `<div style="color:${DIM}">Play a match first.</div>`);
    return;
  }
  const p = me.profile;
  panel.innerHTML = card(
    head(`PROFILE — ${esc(p.name)}`) +
      `<div class="row"><span>Tier</span>${tierBadge(p.tier)}</div>
       <div class="row"><span>Rating</span>${vt(p.rating)}</div>
       <div class="row"><span>Level</span>${vt(p.level)}</div>
       <div class="row"><span>Relics</span>${vt(`◈ ${me.relics}`)}</div>
       <div class="row"><span>Shards</span>${vt(`✦ ${me.shards}`)}</div>`,
  );
}

function renderSettings(panel: HTMLDivElement): void {
  const s = getSettings();
  const accent = ARCH[selectedArch].accent;
  const toggleCss = (on: boolean): string =>
    on
      ? `font-family:'Press Start 2P',monospace;font-size:8px;padding:4px 8px;color:${INK};background:${accent};box-shadow:0 2px 0 ${SHADOW};border:0;cursor:pointer`
      : `font-family:'Press Start 2P',monospace;font-size:8px;padding:4px 8px;color:${MUTED};background:${PANEL_IN};box-shadow:inset 0 0 0 1px ${BORDER};border:0;cursor:pointer`;
  const toggle = (key: string, label: string, on: boolean): string =>
    `<div class="row"><span>${label}</span><button data-set="${key}" style="${toggleCss(on)}">${on ? "ON" : "OFF"}</button></div>`;
  const slider = (key: string, label: string, val: number): string =>
    `<div class="row"><span>${label}</span><input type="range" min="0" max="100" value="${val}" data-slider="${key}" style="accent-color:${accent};background:transparent;box-shadow:none;padding:0"/></div>`;
  panel.innerHTML = card(
    head("SETTINGS &amp; ACCESSIBILITY") +
      toggle("reducedMotion", "Reduced motion", s.reducedMotion) +
      toggle("muteChat", "Mute chat (public default)", s.muteChat) +
      toggle("colorblind", "Colorblind patterns", s.colorblind) +
      slider("sfxVolume", "SFX volume", s.sfxVolume) +
      slider("musicVolume", "Music volume", s.musicVolume) +
      `<div style="font-family:'VT323',monospace;font-size:15px;color:${DIM};margin-top:12px">${KEYS_LINE}</div>`,
  );
  panel.querySelectorAll<HTMLButtonElement>("[data-set]").forEach((b) => {
    b.onclick = () => {
      const key = b.dataset.set as "reducedMotion" | "muteChat" | "colorblind";
      const next = saveSettings({ [key]: !getSettings()[key] });
      b.textContent = next[key] ? "ON" : "OFF";
      b.style.cssText = toggleCss(next[key]);
    };
  });
  panel.querySelectorAll<HTMLInputElement>("[data-slider]").forEach((el) => {
    el.oninput = () => saveSettings({ [el.dataset.slider as "sfxVolume"]: Number(el.value) });
  });
}
