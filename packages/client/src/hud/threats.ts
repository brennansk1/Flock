/**
 * THREAT LANE (STAGE1_DESIGN §9.2): stacked cards for everything aimed at you
 * or racing to end the match — incoming strikes, CPA pickets & deprogrammer
 * raids, rival Ascensions, Exposes against you, live prophecies — each with a
 * countdown and a click-to-jump camera. Cards are keyed and reused; only
 * their text changes per tick.
 */
import {
  toFloat,
  toInt,
  fromInt,
  ownsLandmark,
  computeMonopolies,
  Landmark,
  type SimState,
} from "@flock/sim";
import type { GameSession } from "../net.js";
import { fmtSecs, homeTile, icon, seatName, type Camera } from "./common.js";

interface Threat {
  key: string;
  ic: string;
  color: string;
  title: string;
  sub: string;
  /** countdown in ticks (-1 = none) */
  ticks: number;
  tile: number;
  /** lower = more urgent (sort key after countdown) */
  prio: number;
}

export const THREAT_CSS = `
.fk-threats{width:198px;display:flex;flex-direction:column;gap:5px;pointer-events:none}
.fk-thr{pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:7px;background:#1a130b;border:2px solid #4a3a26;border-left:5px solid var(--tc);box-shadow:0 3px 0 #060403;padding:5px 7px;animation:fkIn .3s ease-out}
.fk-thr:hover{border-color:#6b563a;border-left-color:var(--tc)}
.fk-thr .ic{color:var(--tc)}
.fk-thr .tx{flex:1;min-width:0}
.fk-thr .tt{font-family:'Press Start 2P',monospace;font-size:7px;letter-spacing:.5px;line-height:1.4;color:#efe3c6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fk-thr .ts{font-size:11px;color:#a08a64;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fk-thr .tc{font-family:'VT323',monospace;font-size:20px;color:var(--tc);flex:none}
.fk-thr.hot{animation:fkThrHot 1s infinite}
@keyframes fkThrHot{0%,100%{box-shadow:0 3px 0 #060403}50%{box-shadow:0 3px 0 #060403,0 0 12px var(--tc)}}
.fk-reduced-motion .fk-thr,.fk-reduced-motion .fk-thr.hot{animation:none}
`;

const STRIKE_LABEL: Record<string, string> = {
  pamphlet_bomb: "PAMPHLET BOMB",
  prime_time_expose: "PRIME-TIME EXPOSÉ",
  manifesto_drop: "MANIFESTO DROP",
};

const MAX_CARDS = 4;

export class ThreatLane {
  readonly el: HTMLDivElement;
  private cards = new Map<string, { root: HTMLElement; t: HTMLElement; s: HTMLElement; c: HTMLElement; tile: number }>();

  constructor(
    private readonly g: GameSession,
    private readonly camera: Camera | null,
    private readonly pathName: (id: string) => string,
  ) {
    this.el = document.createElement("div");
    this.el.className = "fk-threats";
  }

  /** Every tick (cheap: short entity lists + one scan of the recap tail). */
  tick(): void {
    const list = this.collect(this.g.sim).sort(
      (a, z) => (a.ticks < 0 ? 1e9 : a.ticks) - (z.ticks < 0 ? 1e9 : z.ticks) || a.prio - z.prio,
    );
    const shown = list.slice(0, MAX_CARDS);
    const keep = new Set(shown.map((x) => x.key));
    for (const [k, c] of this.cards) {
      if (!keep.has(k)) {
        c.root.remove();
        this.cards.delete(k);
      }
    }
    shown.forEach((th, i) => {
      let c = this.cards.get(th.key);
      if (!c) {
        const root = document.createElement("div");
        root.className = "fk-thr";
        root.style.setProperty("--tc", th.color);
        root.innerHTML = `<i class="ic">${icon(th.ic, "currentColor", 16)}</i><div class="tx"><div class="tt"></div><div class="ts"></div></div><span class="tc"></span>`;
        c = { root, t: root.querySelector(".tt")!, s: root.querySelector(".ts")!, c: root.querySelector(".tc")!, tile: th.tile };
        const ref = c;
        root.onclick = () => {
          if (ref.tile >= 0) this.camera?.flashTile(ref.tile, performance.now());
        };
        this.cards.set(th.key, c);
      }
      c.tile = th.tile;
      if (c.t.textContent !== th.title) c.t.textContent = th.title;
      if (c.s.textContent !== th.sub) c.s.textContent = th.sub;
      const cd = th.ticks >= 0 ? fmtSecs(th.ticks) : "";
      if (c.c.textContent !== cd) c.c.textContent = cd;
      c.root.classList.toggle("hot", th.ticks >= 0 && th.ticks <= 100);
      c.root.title = `${th.title} — ${th.sub}. Click to look.`;
      // keep DOM order == urgency order without re-creating nodes
      if (this.el.children[i] !== c.root) this.el.insertBefore(c.root, this.el.children[i] ?? null);
    });
  }

  private collect(s: SimState): Threat[] {
    const out: Threat[] = [];
    const meId = this.g.playerId;
    const me = s.players.find((p) => p.id === meId);
    if (!me) return out;
    const name = (id: number): string => seatName(this.g.players, id);

    // incoming propaganda strikes (10s public warning after the charge)
    for (const st of s.strikes) {
      if (st.player === meId || st.chargeTicksLeft > 0 || st.warningTicksLeft <= 0) continue;
      if (st.victim !== meId && s.world.owner[st.target] !== meId) continue;
      out.push({
        key: `strike:${st.id}`,
        ic: "press",
        color: "#df5a2b",
        title: `INCOMING ${STRIKE_LABEL[st.type] ?? "STRIKE"}`,
        sub: `from ${name(st.player)}`,
        ticks: st.warningTicksLeft,
        tile: st.target,
        prio: 1,
      });
    }

    // rival Ascensions — the match-ending threat
    for (const p of s.players) {
      if (p.id === meId || !p.alive || p.ascendPath === "") continue;
      out.push({
        key: `asc:${p.id}`,
        ic: "crown",
        color: "#ff5a3a",
        title: `${name(p.id).toUpperCase()} ASCENDING`,
        sub: `${this.pathName(p.ascendPath)} — Expose or break it`,
        ticks: p.ascendTicks,
        tile: homeTile(s, p.id),
        prio: 0,
      });
    }

    // live prophecies (Dawn's doomsday timer)
    for (const pr of s.prophecies) {
      out.push({
        key: `proph:${pr.player}`,
        ic: "candle",
        color: "#e0a422",
        title: pr.player === meId ? "YOUR PROPHECY" : `PROPHECY · ${name(pr.player).toUpperCase()}`,
        sub: pr.player === meId ? "hold your ground to fulfil it" : "take their border back before it lands",
        ticks: pr.ticksLeft,
        tile: homeTile(s, pr.player),
        prio: 2,
      });
    }

    // Exposes that just landed on me (linger ~12s)
    const sc = s.recap.scandals;
    for (let i = sc.length - 1; i >= 0; i--) {
      const x = sc[i]!;
      if (s.tick - x.tick > 120) break;
      if (x.victim !== meId) continue;
      out.push({
        key: `exposed:${x.attacker}:${x.tick}`,
        ic: "flame",
        color: "#cf4b2c",
        title: "YOU WERE EXPOSED",
        sub: `by ${name(x.attacker)} — flock, Faith & calm lost`,
        ticks: -1,
        tile: homeTile(s, meId),
        prio: 3,
      });
    }

    // CPA: live pickets on me, and what's coming if I stay the loudest cult
    let picketTicks = 0;
    let picketTile = -1;
    for (const pk of s.pickets) {
      if (pk.target !== meId) continue;
      if (pk.ticksLeft > picketTicks) {
        picketTicks = pk.ticksLeft;
        picketTile = pk.tile;
      }
    }
    if (picketTicks > 0) {
      out.push({ key: "cpa:picket", ic: "people", color: "#c0744a", title: "CPA PICKET LINE", sub: "−30% pressure where it stands", ticks: picketTicks, tile: picketTile, prio: 4 });
    }
    if (!s.disableCPA && me.alive && me.spawned) {
      let top = me;
      for (const p of s.players) {
        if (!p.alive || !p.spawned) continue;
        if (p.heat > top.heat || (p.heat === top.heat && p.ownedTiles > top.ownedTiles)) top = p;
      }
      if (top.id === meId) {
        const heat = me.heat;
        const hb = this.g.balance.heat;
        if (heat >= hb.cpaHarass) {
          let floor = hb.cpaHarass;
          if (computeMonopolies(s, meId).townMachine) floor = Math.max(floor, fromInt(85));
          else if (ownsLandmark(s, meId, Landmark.TownHall)) floor = Math.max(floor, fromInt(75));
          if (heat >= floor) {
            const next = s.cpaNextPicketTick - s.tick;
            if (next > 0) {
              out.push({ key: "cpa:next", ic: "people", color: "#c0744a", title: "CPA PICKETS COMING", sub: `your Heat ${Math.round(toFloat(heat))} — cool it below ${toInt(floor)}`, ticks: next, tile: homeTile(s, meId), prio: 5 });
            }
          }
        }
        if (heat >= hb.cpaSiege) {
          const next = s.cpaNextBusTick - s.tick;
          out.push({
            key: "cpa:bus",
            ic: "van",
            color: "#b8332b",
            title: "DEPROGRAMMER BUS",
            sub: `raids your most restless district · Heat ≥ ${toInt(hb.cpaSiege)}`,
            ticks: Math.max(0, next),
            tile: homeTile(s, meId),
            prio: 4,
          });
        }
      }
    }

    // legacy agent raids channeling on me (dormant for players, kept honest)
    for (const a of s.agents) {
      if (a.victim !== meId || a.phase !== "channel") continue;
      out.push({ key: `raid:${a.id}`, ic: "eye", color: "#7a3da8", title: "RAID IN PROGRESS", sub: `by ${name(a.player)}`, ticks: a.channelTicks, tile: a.tile, prio: 3 });
    }
    return out;
  }
}

