/**
 * The VICTORY / DEFEAT moment (STAGE1_DESIGN §9.5). When the sim's status
 * flips to Ended: a big splash that names the path ("THE LEDGER — The
 * Prosperity Circle bought Mundane Falls"), then the shareable recap card
 * (once the server's recap lands; offline tutorial matches skip it), with
 * Play again · Change cult · Menu.
 */
import {
  MatchStatus,
  renderRecapCard,
  hasArchetype,
  getArchetype,
  type Archetype,
} from "@flock/sim";
import type { GameSession } from "../net.js";
import { archAccent, esc, seatName } from "./common.js";

/** Verb phrase per path: "{who} {verb} {town}". DLC paths fall back to "won". */
const VERBS: Record<string, string> = {
  domination: "tipped",
  revelation: "took the pulpit of",
  rapture: "raptured",
  wellness: "made well",
  ledger: "bought",
  contact: "made First Contact over",
  last_standing: "outlasted every rival in",
  timer: "held the most souls in",
};

export const END_CSS = `
.fk-end{position:absolute;inset:0;z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:rgba(10,7,4,.94);font-family:'Pixelify Sans',ui-monospace,monospace;color:#efe3c6;pointer-events:auto;animation:fkEndIn .5s ease-out;overflow:auto;padding:24px 12px;box-sizing:border-box}
@keyframes fkEndIn{from{opacity:0}to{opacity:1}}
@keyframes fkEndPop{0%{transform:scale(.7);opacity:0}70%{transform:scale(1.06)}100%{transform:none;opacity:1}}
.fk-end .res{font-family:'Press Start 2P',monospace;font-size:44px;letter-spacing:4px;animation:fkEndPop .6s ease-out}
.fk-end .path{font-family:'Press Start 2P',monospace;font-size:16px;letter-spacing:2px;text-align:center;max-width:900px;line-height:1.6}
.fk-end .line{font-size:18px;color:#d8c8a6;text-align:center;max-width:760px}
.fk-end .btns{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}
.fk-end button{font-family:'Pixelify Sans',monospace;font-size:15px;font-weight:700;letter-spacing:1px;padding:12px 24px;border:0;cursor:pointer;color:#efe3c6;background:#241c12;box-shadow:inset 0 0 0 2px #4a3a26,0 4px 0 #060403}
.fk-end button.pri{color:#19110a;background:var(--end-acc);box-shadow:inset 0 0 0 3px var(--end-acc2),0 4px 0 #060403;padding:14px 38px;font-size:17px}
.fk-end button:hover{filter:brightness(1.1)}
.fk-end canvas{max-height:58vh;height:auto;image-rendering:pixelated;border:3px solid #4a3a26;box-shadow:0 8px 0 #060403}
.fk-end .tick{font-family:'VT323',monospace;font-size:20px;letter-spacing:1px;color:#e6be8a}
.fk-end .wait{font-family:'VT323',monospace;font-size:17px;color:#8a7550}
.fk-reduced-motion .fk-end,.fk-reduced-motion .fk-end .res{animation:none}
`;

function pathName(g: GameSession, id: string): string {
  if (id === "domination") return "Domination";
  if (id === "revelation") return "Revelation";
  if (id === "last_standing") return "Last Cult Standing";
  if (id === "timer") return "Time's Up";
  for (const p of g.sim.players) {
    if (hasArchetype(p.archetype)) {
      const v = getArchetype(p.archetype).victory;
      if (v && v.id === id) return v.name;
    }
  }
  return id ? id.replace(/_/g, " ") : "The End";
}

/** Returns a per-frame watcher; mounts the splash once the match ends. */
export function watchEndgame(g: GameSession): () => void {
  let shown = false;
  return () => {
    if (shown || g.sim.status !== MatchStatus.Ended) return;
    shown = true;
    showEndgame(g);
  };
}

function showEndgame(g: GameSession): void {
  const s = g.sim;
  const winner = s.winner;
  const me = g.playerId;
  const won = winner !== 0 && winner === me;
  const winSeat = s.players.find((p) => p.id === winner);
  const acc = winSeat ? archAccent(winSeat.archetype) : { a: "#e0a422", b: "#f3cf6a" };
  const cultName = winSeat && hasArchetype(winSeat.archetype) ? getArchetype(winSeat.archetype).theme.name : "";
  // your win reads as the cult's deed ("The Prosperity Circle bought …");
  // a rival's names the seat too so the lobby knows who did it
  const who = winner === 0 ? "" : winner === me ? "" : seatName(g.players, winner);
  const whoLine = winner === me ? cultName || "You" : who && cultName ? `${who} (${cultName})` : who;
  const path = s.winPath || (winner === 0 ? "" : "timer");
  const town = s.world.townName || "Mundane Falls";
  const headline = winner === 0 ? "NO ONE CLAIMED THE TOWN" : `${pathName(g, path).toUpperCase()} — ${whoLine} ${VERBS[path] ?? "won"} ${town}`;

  const root = document.createElement("div");
  root.className = "fk-end";
  root.style.setProperty("--end-acc", acc.a);
  root.style.setProperty("--end-acc2", acc.b);
  const resTxt = winner === 0 ? "DRAW" : won ? "VICTORY" : "DEFEAT";
  const resCol = winner === 0 ? "#efe3c6" : won ? acc.b : "#cf4b2c";
  root.innerHTML = `
    <div class="res" style="color:${resCol};text-shadow:4px 4px 0 #060403,0 0 24px ${resCol}66">${resTxt}</div>
    <div class="path" style="color:${acc.b}">${esc(headline)}</div>
    <div class="line">${won ? "The town is yours. Every porch light on Main Street burns for you now." : winner === 0 ? "The town slept through it all." : "The town has a new shepherd — and it isn't you."}</div>
    <div class="slot"></div>
    <div class="btns">
      <button class="pri" data-a="again">▶ PLAY AGAIN</button>
      <button data-a="cult">CHANGE CULT</button>
      <button data-a="menu">MENU</button>
    </div>`;
  const nameParam = (): string => {
    const nm = g.players.find((p) => p.id === me)?.name ?? "";
    return nm ? `name=${encodeURIComponent(nm)}` : "";
  };
  root.querySelector<HTMLButtonElement>('[data-a="again"]')!.onclick = () => location.reload();
  root.querySelector<HTMLButtonElement>('[data-a="cult"]')!.onclick = () => {
    location.search = `?pick=1${nameParam() ? `&${nameParam()}` : ""}`;
  };
  root.querySelector<HTMLButtonElement>('[data-a="menu"]')!.onclick = () => {
    location.search = "";
  };
  document.getElementById("app")!.appendChild(root);

  // the recap card arrives from the server a moment after END; offline
  // (tutorial) sessions never get one, so stop waiting after a few seconds.
  const slot = root.querySelector<HTMLElement>(".slot")!;
  const started = performance.now();
  const wait = document.createElement("div");
  wait.className = "wait";
  wait.textContent = "printing the town paper…";
  slot.appendChild(wait);
  const poll = window.setInterval(() => {
    if (g.recap) {
      window.clearInterval(poll);
      wait.remove();
      mountRecap(g, slot);
    } else if (performance.now() - started > 6000) {
      window.clearInterval(poll);
      wait.remove();
    }
  }, 250);
}

function mountRecap(g: GameSession, slot: HTMLElement): void {
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
  slot.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:10px";
  slot.appendChild(canvas);

  const mine = g.results?.find((r) => r.player === g.playerId);
  if (mine) {
    const t = document.createElement("div");
    t.className = "tick";
    t.textContent = `PLACED #${mine.placement}   +${mine.xp} XP   +${mine.relics} ◈ RELICS   RATING ${mine.provisionalRating}`;
    slot.appendChild(t);
  }
  const save = document.createElement("button");
  save.textContent = "⬇ SAVE CARD";
  save.onclick = () => {
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "flock-recap.png";
    a.click();
  };
  slot.appendChild(save);
}
