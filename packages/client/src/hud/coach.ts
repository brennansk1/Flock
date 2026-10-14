/**
 * COACH NUDGES (STAGE1_DESIGN §9.7): for a player's first 3 matches, one
 * small, dismissable, never-blocking hint at a time — sitting just above the
 * bottom tray, next to the buttons it talks about. Each nudge fires at most
 * once per match (twice for the idle-cohort one) with a cooldown between them.
 */
import {
  MAX_COHORTS,
  exposeBlocker,
  followerCap,
  buildingCost,
  computeCivicControl,
  toInt,
  toFloat,
  COMMUNE_MAX_STAGE,
  type PlayerState,
} from "@flock/sim";
import type { GameSession } from "../net.js";
import { seatName } from "./common.js";
import type { PowersPanel } from "./powers.js";

const COUNT_KEY = "flock.coach.matches";
const COACHED_MATCHES = 3;

export const COACH_CSS = `
.fk-coach{pointer-events:auto;display:flex;align-items:center;gap:10px;max-width:560px;background:#1a130b;border:3px solid var(--fk-acc);box-shadow:0 4px 0 #060403;padding:7px 8px 7px 12px;font-size:13px;line-height:1.35;color:#efe3c6;animation:fkIn .3s ease-out}
.fk-coach .cl{font-family:'Press Start 2P',monospace;font-size:7px;letter-spacing:1px;color:var(--fk-acc2);flex:none}
.fk-coach .ct{flex:1}
.fk-coach button{flex:none;font-family:'Press Start 2P',monospace;font-size:8px;color:#a08a64;background:#0e0a05;box-shadow:inset 0 0 0 1px #4a3a26;width:22px;height:22px}
.fk-coach button:hover{color:#efe3c6}
.fk-reduced-motion .fk-coach{animation:none}
`;

/** Count this match toward the coached-matches budget; true = coach this one. */
export function coachEnabled(): boolean {
  try {
    const n = Number(localStorage.getItem(COUNT_KEY) ?? "0") || 0;
    if (n >= COACHED_MATCHES) return false;
    localStorage.setItem(COUNT_KEY, String(n + 1));
    return true;
  } catch {
    return false;
  }
}

interface Nudge {
  id: string;
  text: string;
}

export class Coach {
  readonly el: HTMLDivElement;
  private shown = new Map<string, number>();
  private current: string | null = null;
  private currentSince = 0;
  private quietUntil = 0;
  private idleSince = -1;

  constructor(
    private readonly g: GameSession,
    private readonly powers: PowersPanel,
  ) {
    this.el = document.createElement("div");
    this.el.className = "fk-coach";
    this.el.style.display = "none";
    this.el.innerHTML = `<span class="cl">COACH</span><span class="ct"></span><button title="dismiss">✕</button>`;
    this.el.querySelector("button")!.onclick = () => this.dismiss();
  }

  private dismiss(): void {
    this.el.style.display = "none";
    this.current = null;
    this.quietUntil = this.g.sim.tick + 250; // 25s of quiet after a dismiss
  }

  /** ~1 Hz. Picks the most important applicable nudge, shows one at a time. */
  update(): void {
    const s = this.g.sim;
    const me = s.players.find((p) => p.id === this.g.playerId);
    if (!me || !me.spawned || !me.alive || s.foundingTicksLeft > 0 || s.status !== 0) {
      this.el.style.display = "none";
      return;
    }
    // idle-cohort tracking (a slot sitting open for 12s+ with flock to send)
    const idle = me.cohorts.length < MAX_COHORTS && toFloat(me.followers) >= 40;
    if (!idle) this.idleSince = -1;
    else if (this.idleSince < 0) this.idleSince = s.tick;

    const n = this.pick(me);
    if (this.current) {
      // auto-retire a nudge once it no longer applies, or after 14s
      if (!n || n.id !== this.current) {
        if (s.tick - this.currentSince > 40 || !n) {
          this.el.style.display = "none";
          this.current = null;
          this.quietUntil = s.tick + 150;
        }
      } else if (s.tick - this.currentSince > 140) {
        this.el.style.display = "none";
        this.current = null;
        this.quietUntil = s.tick + 200;
      }
      return;
    }
    if (!n || s.tick < this.quietUntil) return;
    const times = this.shown.get(n.id) ?? 0;
    if (times >= (n.id === "idle" ? 2 : 1)) return;
    this.shown.set(n.id, times + 1);
    this.current = n.id;
    this.currentSince = s.tick;
    this.el.querySelector(".ct")!.textContent = n.text;
    this.el.style.display = "flex";
  }

  private pick(me: PlayerState): Nudge | null {
    const s = this.g.sim;
    const b = this.g.balance;
    const rivals = s.players.filter((p) => p.id !== me.id && p.alive && p.spawned);

    const asc = rivals.find((p) => p.ascendPath !== "");
    if (asc) {
      const can = exposeBlocker(s, me, asc) === "";
      return {
        id: `asc:${asc.id}`,
        text: `${seatName(this.g.players, asc.id)} is ASCENDING — ${can ? "Expose them (right-click their ground) or take their ground back" : "take their ground back to break the condition"} before the clock hits zero.`,
      };
    }
    const target = rivals
      .filter((p) => exposeBlocker(s, me, p) === "")
      .sort((a, z) => z.soulsPermille - a.soulsPermille)[0];
    if (target && target.soulsPermille >= me.soulsPermille) {
      return {
        id: `expose:${target.id}`,
        text: `You can EXPOSE ${seatName(this.g.players, target.id)} (Heat ${Math.round(toFloat(target.heat))}) — right-click their ground. Loud cults bleed flock.`,
      };
    }
    if (this.idleSince >= 0 && s.tick - this.idleSince > 120) {
      const free = MAX_COHORTS - me.cohorts.length;
      return {
        id: "idle",
        text: `${free} cohort slot${free === 1 ? "" : "s"} idle (${me.cohorts.length}/${MAX_COHORTS} out). RIGHT-CLICK the town where your color meets neutral houses to send more flock.`,
      };
    }
    const usd = me.usd;
    const cap = toInt(followerCap(me, b, s));
    if (me.compounds < COMMUNE_MAX_STAGE && toInt(me.followers) >= cap * 0.85) {
      const cost = buildingCost(s, me.id, "compound", computeCivicControl(s), b);
      if (usd >= cost) return { id: "commune", text: "Your flock is near its cap — upgrade the COMMUNE (B) to keep growing." };
    }
    const ready = this.powers.list.find((e) => {
      if (!e.def) return false;
      if ((me.cooldowns[e.def.cooldownKey] ?? 0) > 0) return false;
      const c = e.def.cost(me);
      return (c.usd ?? 0) > 0 && usd >= (c.usd ?? 0) && me.faith >= (c.faith ?? 0);
    });
    if (ready && s.tick > 900) {
      return { id: `power:${ready.id}`, text: `${ready.name} is ready${ready.key ? ` [${ready.key}]` : ""} — ${ready.blurb}` };
    }
    const econ = b.economy;
    const room = cap - toInt(me.followers);
    const gained = Math.min(room, Math.floor((toInt(me.followers) * econ.recruitDrivePermille) / 1000));
    if (gained > 20 && toInt(usd) >= gained * toInt(econ.recruitCostPer) * 2) {
      return { id: "recruit", text: `Cash is piling up — a Recruitment Drive (R) turns it into +${gained} flock to send out.` };
    }
    return null;
  }
}
