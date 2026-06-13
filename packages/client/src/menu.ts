/**
 * Lobby / main menu (§28). The landing shell: a Daily Prophecy ticker, the big
 * PLAY action (FTUE §26 — name + archetype, no account wall), and tabs that
 * consume the server REST API (leaderboard, store, congregations, profile) plus
 * the settings/accessibility panel. Pure DOM over the chunky world aesthetic.
 */

import { getSettings, saveSettings } from "./settings.js";

const TOKEN_KEY = "flock.session";
const ARCHES = [
  { id: "dawn", label: "⏳ The Final Dawn — blitz conversion" },
  { id: "radiant", label: "🌿 The Radiant Path — unshakeable retention" },
  { id: "circle", label: "💼 The Prosperity Circle — the money machine" },
  { id: "visitors", label: "🛸 The Visitors' Fellowship — eyes everywhere" },
];

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

const card = (inner: string): string =>
  `<div style="background:rgba(20,16,12,.78);border:1px solid #5a4a30;border-radius:10px;padding:18px;margin:8px 0">${inner}</div>`;

export function showMenu(): void {
  const root = document.getElementById("app")!;
  const div = document.createElement("div");
  div.id = "fk-menu";
  div.style.cssText =
    "position:absolute;inset:0;overflow:auto;font-family:'Segoe UI',system-ui,sans-serif;color:#f0e6d0;" +
    "background:radial-gradient(ellipse at center,#2a2018 0%,#14100c 100%)";
  div.innerHTML = `
    <style>
      #fk-menu .nav button{background:none;border:none;color:#cdbfa0;font:inherit;font-size:15px;cursor:pointer;padding:8px 14px;border-radius:6px}
      #fk-menu .nav button.on{background:#c89858;color:#1a1410;font-weight:700}
      #fk-menu input,#fk-menu select{background:#241c14;color:#f0e6d0;border:1px solid #6a5a40;border-radius:5px;padding:9px 12px;font:inherit}
      #fk-menu .big{padding:16px 56px;font-size:22px;background:#c89858;color:#1a1410;border:none;border-radius:6px;cursor:pointer;letter-spacing:3px;font-family:Georgia,serif}
      #fk-menu .row{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #3a3020}
      #fk-menu .buy{background:#3a2c18;color:#f0e6d0;border:1px solid #6a5a40;border-radius:5px;padding:5px 12px;cursor:pointer}
    </style>
    <div style="max-width:760px;margin:0 auto;padding:28px 18px">
      <div style="text-align:center">
        <div style="font-size:60px;letter-spacing:14px;text-shadow:0 0 24px #c89858;font-family:Georgia,serif">FLOCK</div>
        <div id="fk-daily" style="font-size:13px;opacity:.8;font-style:italic;min-height:18px">…</div>
      </div>
      <div class="nav" style="display:flex;gap:6px;justify-content:center;margin:16px 0;flex-wrap:wrap">
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
  const select = (tab: string): void => {
    nav.forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    void render(tab, panel);
  };
  nav.forEach((b) => (b.onclick = () => select(b.dataset.tab!)));

  // daily prophecy ticker
  void api("/daily")
    .then((d) => {
      const data = d as { challenge?: { title: string; description: string }; freeRotation?: string[] };
      const el = div.querySelector("#fk-daily")!;
      if (data.challenge) {
        el.textContent = `📜 Today's Prophecy — ${data.challenge.title}: ${data.challenge.description}  ·  free: ${(data.freeRotation ?? []).join(", ")}`;
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

function renderPlay(panel: HTMLDivElement): void {
  panel.innerHTML = card(`
    <div style="display:flex;flex-direction:column;gap:14px;align-items:center">
      <input id="nm" placeholder="cult leader name" maxlength="24" style="width:260px;text-align:center"/>
      <select id="ar" style="width:320px">${ARCHES.map((a) => `<option value="${a.id}">${a.label}</option>`).join("")}</select>
      <button id="go" class="big">PLAY</button>
      <div style="font-size:11px;opacity:.55;max-width:420px;text-align:center">
        click a glowing spot to found · click to convert · 1/2/3 stances · QWER rituals · D/F powers · G signature
      </div>
    </div>`);
  const go = (): void => {
    const name = (panel.querySelector("#nm") as HTMLInputElement).value || "Shepherd";
    const ar = (panel.querySelector("#ar") as HTMLSelectElement).value;
    const q = new URLSearchParams(location.search);
    const sv = q.get("server");
    location.search = `?play=1&name=${encodeURIComponent(name)}&archetype=${ar}${sv ? `&server=${encodeURIComponent(sv)}` : ""}`;
  };
  (panel.querySelector("#go") as HTMLButtonElement).onclick = go;
  (panel.querySelector("#nm") as HTMLInputElement).addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") go();
  });
}

async function renderLeaderboard(panel: HTMLDivElement): Promise<void> {
  panel.innerHTML = card("<div style='opacity:.6'>loading leaderboard…</div>");
  const data = (await api("/leaderboard").catch(() => ({ players: [] }))) as {
    players: { rank: number; name: string; rating: number; tier: string; isProphet: boolean }[];
  };
  if (!data.players.length) {
    panel.innerHTML = card("<b>Leaderboard</b><div style='opacity:.6;margin-top:8px'>No ranked players yet — finish a match to appear.</div>");
    return;
  }
  panel.innerHTML = card(
    `<b>Leaderboard</b>${data.players
      .map(
        (p) =>
          `<div class="row"><span>${p.isProphet ? "✦ " : ""}#${p.rank} ${esc(p.name)}</span><span style="opacity:.8">${p.tier} · ${p.rating}</span></div>`,
      )
      .join("")}`,
  );
}

async function renderStore(panel: HTMLDivElement): Promise<void> {
  panel.innerHTML = card("<div style='opacity:.6'>loading store…</div>");
  const cat = (await api("/catalog").catch(() => ({ items: [] }))) as {
    items: { id: string; name: string; cost: number; currency: string; kind: string }[];
  };
  const me = (await api("/me").catch(() => null)) as { relics: number; shards: number; profile?: { unlocks: string[] } } | null;
  const owned = new Set(me?.profile?.unlocks ?? []);
  const wallet = me ? `<div style="opacity:.8;margin:6px 0">◈ ${me.relics} Relics · ✦ ${me.shards} Shards</div>` : `<div style="opacity:.6;margin:6px 0">Play a match to earn Relics.</div>`;
  panel.innerHTML = card(
    `<b>Store</b> <span style="font-size:11px;opacity:.6">Relics are earned, never sold for money.</span>${wallet}${cat.items
      .map((it) => {
        const cur = it.currency === "relics" ? "◈" : it.currency === "shards" ? "✦" : "$";
        const own = owned.has(it.id.replace(/^unlock_/, "")) || owned.has(it.id);
        const btn = own ? `<span style="opacity:.6">owned</span>` : `<button class="buy" data-item="${it.id}">${cur}${it.cost}</button>`;
        return `<div class="row"><span>${it.name} <span style="opacity:.5;font-size:11px">${it.kind}</span></span>${btn}</div>`;
      })
      .join("")}`,
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
  panel.innerHTML = card("<div style='opacity:.6'>loading congregations…</div>");
  const data = (await api("/congregations").catch(() => ({ ladder: [] }))) as {
    ladder: { congregation: { id: string; name: string; tag: string; members: string[] }; score: number }[];
  };
  const list = data.ladder.length
    ? data.ladder
        .map(
          (e) =>
            `<div class="row"><span>[${esc(e.congregation.tag)}] ${esc(e.congregation.name)} <span style="opacity:.5">${e.congregation.members.length}/50</span></span><span style="display:flex;gap:8px;align-items:center"><span style="opacity:.8">${e.score} pts</span><button class="buy" data-join="${e.congregation.id}">join</button></span></div>`,
        )
        .join("")
    : "<div style='opacity:.6;margin:8px 0'>No congregations yet. Found one below.</div>";
  panel.innerHTML = card(
    `<b>Congregations</b> <span style="font-size:11px;opacity:.6">weekly best-10 ladder (§24)</span>${list}
     <div class="row" style="border:none;margin-top:10px">
       <input id="cn" placeholder="congregation name" maxlength="24" style="flex:1"/>
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
    panel.innerHTML = card("<b>Profile</b><div style='opacity:.6;margin-top:8px'>Play a match to create your account — your legend is saved automatically.</div>");
    return;
  }
  panel.innerHTML = card("<div style='opacity:.6'>loading profile…</div>");
  const me = (await api("/me").catch(() => null)) as { profile?: { name: string; level: number; rating: number; tier: string }; relics: number; shards: number } | null;
  if (!me?.profile) {
    panel.innerHTML = card("<b>Profile</b><div style='opacity:.6;margin-top:8px'>Play a match first.</div>");
    return;
  }
  const p = me.profile;
  panel.innerHTML = card(
    `<b>${esc(p.name)}</b>
     <div class="row"><span>Tier</span><span>${p.tier}</span></div>
     <div class="row"><span>Rating</span><span>${p.rating}</span></div>
     <div class="row"><span>Level</span><span>${p.level}</span></div>
     <div class="row"><span>Relics</span><span>◈ ${me.relics}</span></div>
     <div class="row"><span>Shards</span><span>✦ ${me.shards}</span></div>`,
  );
}

function renderSettings(panel: HTMLDivElement): void {
  const s = getSettings();
  const toggle = (key: string, label: string, on: boolean): string =>
    `<div class="row"><span>${label}</span><button class="buy" data-set="${key}">${on ? "ON" : "OFF"}</button></div>`;
  const slider = (key: string, label: string, val: number): string =>
    `<div class="row"><span>${label}</span><input type="range" min="0" max="100" value="${val}" data-slider="${key}"/></div>`;
  panel.innerHTML = card(
    `<b>Settings</b>
     ${toggle("reducedMotion", "Reduced motion", s.reducedMotion)}
     ${toggle("muteChat", "Mute chat (public default)", s.muteChat)}
     ${toggle("colorblind", "Colorblind patterns", s.colorblind)}
     ${slider("sfxVolume", "SFX volume", s.sfxVolume)}
     ${slider("musicVolume", "Music volume", s.musicVolume)}
     <div style="font-size:11px;opacity:.55;margin-top:10px">Keys — 1/2/3 stance · QWER ritual · D/F power · G signature · B/T/C/Y/U/H build · Esc cancel</div>`,
  );
  panel.querySelectorAll<HTMLButtonElement>("[data-set]").forEach((b) => {
    b.onclick = () => {
      const key = b.dataset.set as "reducedMotion" | "muteChat" | "colorblind";
      const next = saveSettings({ [key]: !getSettings()[key] });
      b.textContent = next[key] ? "ON" : "OFF";
    };
  });
  panel.querySelectorAll<HTMLInputElement>("[data-slider]").forEach((el) => {
    el.oninput = () => saveSettings({ [el.dataset.slider as "sfxVolume"]: Number(el.value) });
  });
}
