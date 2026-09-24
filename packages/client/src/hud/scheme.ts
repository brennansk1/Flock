/**
 * SCHEME context menu (STAGE1_DESIGN §2 "Scheme" verb, §9.3): right-click (or
 * long-press) a RIVAL's ground and a small pixel menu opens at the cursor —
 * send a mission there, EXPOSE them (price + the sim's own blocker reason),
 * fire a propaganda STRIKE at that spot, or propose/break an alliance. No
 * hidden hotkeys: everything the verb can do is on this menu.
 */
import {
  exposeBlocker,
  exposeCost,
  EXPOSE,
  STRIKE_DEFS,
  strikeCost,
  toInt,
  toFloat,
  colorForPlayer,
  type StrikeType,
  type Fixed,
} from "@flock/sim";
import type { GameSession, ClientIntent } from "../net.js";
import { esc, fmtMoney, icon, seatName } from "./common.js";

export const SCHEME_CSS = `
.fk-scheme-menu{position:fixed;z-index:44;width:238px;background:#1a130b;border:3px solid #6b563a;box-shadow:0 5px 0 #060403,inset 0 0 0 1px #36291a;font-family:'Pixelify Sans',ui-monospace,monospace;color:#efe3c6;animation:fkIn .12s ease-out}
.fk-scheme-menu .hd{display:flex;align-items:center;gap:7px;padding:7px 9px;background:#241c12;border-bottom:2px solid #36291a}
.fk-scheme-menu .hd .sw{width:12px;height:12px;flex:none}
.fk-scheme-menu .hd .nm{flex:1;font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fk-scheme-menu .hd .ht{font-family:'VT323',monospace;font-size:15px;color:#caa07a}
.fk-scheme-menu .it{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:7px 9px;border:0;background:none;color:#efe3c6;font-family:inherit;font-size:12px;text-align:left;cursor:pointer}
.fk-scheme-menu .it:hover:not([disabled]){background:#cf4b2c;color:#fff3df}
.fk-scheme-menu .it .ic{color:#df5a2b}
.fk-scheme-menu .it:hover:not([disabled]) .ic{color:#fff3df}
.fk-scheme-menu .it .lb{flex:1}
.fk-scheme-menu .it .why{display:block;font-family:'VT323',monospace;font-size:14px;color:#8a7550;line-height:1}
.fk-scheme-menu .it .pr{font-family:'VT323',monospace;font-size:16px;color:#9bbf6a}
.fk-scheme-menu .it[disabled]{cursor:not-allowed;opacity:.55}
.fk-scheme-menu .it[disabled] .pr{color:#8a7550}
.fk-scheme-menu .sep{height:1px;background:#36291a;margin:2px 0}
.fk-scheme-menu .ft{font-family:'VT323',monospace;font-size:14px;color:#6b563a;padding:4px 9px 6px}
`;

const STRIKES: { id: StrikeType; name: string; ic: string; what: string }[] = [
  { id: "pamphlet_bomb", name: "Pamphlet Bomb", ic: "press", what: "seeds dissent in a small radius" },
  { id: "prime_time_expose", name: "Prime-Time Exposé", ic: "antenna", what: "−5% of their flock, −25 Faith, retention halved 45s" },
  { id: "manifesto_drop", name: "Manifesto Drop", ic: "scroll", what: "six scattered hits — maxes YOUR Heat" },
];

/** Live strike price for `me` (I3 Strong Signal −20%, Radio Tower −30%). */
function strikePrice(g: GameSession, id: StrikeType): Fixed {
  const me = g.sim.players.find((p) => p.id === g.playerId)!;
  return strikeCost(g.sim, me, id);
}

export class SchemeMenu {
  private el: HTMLDivElement | null = null;

  constructor(
    private readonly g: GameSession,
    private readonly send: (i: ClientIntent) => void,
    /** open the mission wheel at the same spot (the menu's first item) */
    private readonly openWheel: (tile: number, x: number, y: number) => void,
  ) {
    window.addEventListener("pointerdown", (ev) => {
      if (this.el && !(ev.target as HTMLElement).closest?.(".fk-scheme-menu")) this.close();
    });
  }

  get isOpen(): boolean {
    return this.el !== null;
  }

  close(): void {
    this.el?.remove();
    this.el = null;
  }

  open(tile: number, victimId: number, x: number, y: number): void {
    this.close();
    const s = this.g.sim;
    const me = s.players.find((p) => p.id === this.g.playerId);
    const victim = s.players.find((p) => p.id === victimId);
    if (!me || !victim) return;
    const allied = s.alliances.some((a) => (a.a === me.id && a.b === victimId) || (a.b === me.id && a.a === victimId));
    const menu = document.createElement("div");
    menu.className = "fk-scheme-menu";
    menu.oncontextmenu = (e) => e.preventDefault();
    const heat = Math.round(toFloat(victim.heat));
    menu.innerHTML =
      `<div class="hd"><span class="sw" style="background:${colorForPlayer(victimId)}"></span><span class="nm">${esc(seatName(this.g.players, victimId))}</span>` +
      `<span class="ht" title="their Heat · soul share">🔥${heat} · ${(victim.soulsPermille / 10).toFixed(0)}%</span></div>`;

    const item = (ic: string, label: string, price: string, why: string, onClick: (() => void) | null, title: string): void => {
      const b = document.createElement("button");
      b.className = "it";
      b.innerHTML = `<i class="ic">${icon(ic, "currentColor", 15)}</i><span class="lb"></span><span class="pr"></span>`;
      const lb = b.querySelector<HTMLElement>(".lb")!;
      lb.textContent = label;
      if (why) {
        const w = document.createElement("span");
        w.className = "why";
        w.textContent = why;
        lb.appendChild(w);
      }
      b.querySelector<HTMLElement>(".pr")!.textContent = price;
      b.title = title;
      if (onClick) {
        b.onclick = () => {
          this.close();
          onClick();
        };
      } else b.disabled = true;
      menu.appendChild(b);
    };
    const sep = (): void => {
      const d = document.createElement("div");
      d.className = "sep";
      menu.appendChild(d);
    };

    item("mega", "Send a mission here…", "", "", () => this.openWheel(tile, x, y), "Open the mission wheel on their ground — Spread or Crusade to take it.");
    sep();
    const block = exposeBlocker(s, me, victim);
    const ascending = victim.ascendPath !== "";
    item(
      "flame",
      ascending ? "EXPOSE — resets their Ascension" : "EXPOSE",
      fmtMoney(toInt(exposeCost(me))),
      block ? `✕ ${block}` : "",
      block ? null : () => this.send({ t: "PUBLISH_SCANDAL", target: victimId } as ClientIntent),
      `Publish their dirty laundry: they lose flock (more the hotter they run), ${EXPOSE.faithLoss} Faith and calm, and any Ascension restarts. Needs their Heat ≥ ${EXPOSE.minVictimHeat}. You gain +${EXPOSE.attackerHeat} Heat; each Expose costs more.`,
    );
    for (const st of STRIKES) {
      const price = strikePrice(this.g, st.id);
      const cant = me.usd < price;
      const secs = Math.round(STRIKE_DEFS[st.id].chargeTicks / 10);
      item(
        st.ic,
        st.name,
        fmtMoney(toInt(price)),
        cant ? "✕ not enough cash" : `${secs}s charge + 10s warning`,
        cant ? null : () => this.send({ t: "STRIKE", strike: st.id, target: tile } as ClientIntent),
        `${st.name} at this spot — ${st.what}. Charges ${secs}s, then everyone gets a 10s warning.`,
      );
    }
    sep();
    item(
      "heart",
      allied ? "Break alliance" : "Propose alliance",
      "",
      "",
      () => this.send({ t: allied ? "ALLY_BREAK" : "ALLY_PROPOSE", target: victimId } as ClientIntent),
      allied ? "End the pact (betrayal marks you a traitor)." : "Offer a 10-minute truce.",
    );
    const ft = document.createElement("div");
    ft.className = "ft";
    ft.textContent = "Esc or click away to close";
    menu.appendChild(ft);

    document.body.appendChild(menu);
    // keep on-screen
    const r = menu.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - r.width - 8);
    const py = Math.min(y, window.innerHeight - r.height - 8);
    menu.style.left = `${Math.max(8, px)}px`;
    menu.style.top = `${Math.max(8, py)}px`;
    this.el = menu;
  }
}
