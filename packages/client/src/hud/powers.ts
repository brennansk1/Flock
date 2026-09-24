/**
 * POWERS rail (STAGE1_DESIGN §9 / deliverable 5) — built from the archetype
 * registry, never hardcoded: every ability by slot (primary D · secondary F ·
 * signature G) plus the cult's SIGNATURE intent if it has one. Costs come
 * from `ability.cost(me)` every refresh, so price changes in the sim (or a
 * DLC cult) show up with zero client edits.
 */
import {
  getArchetype,
  hasArchetype,
  toInt,
  type AbilityDefinition,
  type PlayerState,
  type SimState,
} from "@flock/sim";
import { fmtMoney, icon } from "./common.js";

export interface PowerEntry {
  key: "D" | "F" | "G" | "";
  kind: "ability" | "signature";
  id: string;
  name: string;
  blurb: string;
  targeting: "none" | "tile" | "district";
  def?: AbilityDefinition;
  el: HTMLButtonElement;
}

/** What firing a power asks of the caller. */
export type PowerAction =
  | { t: "send-ability"; ability: string; target?: number }
  | { t: "arm-ability"; ability: string }
  | { t: "send-signature" };

const SLOT_ORDER: Record<string, number> = { primary: 0, secondary: 1, signature: 2 };
const SLOT_IC: Record<string, string> = { primary: "eye", secondary: "flask", signature: "bolt" };

export class PowersPanel {
  readonly el: HTMLDivElement;
  private entries: PowerEntry[] = [];
  private builtFor = "";

  constructor(private readonly onFire: (p: PowerEntry) => void) {
    this.el = document.createElement("div");
    this.el.className = "fk-grp";
    this.el.innerHTML = `<h4>Powers</h4>`;
  }

  get list(): readonly PowerEntry[] {
    return this.entries;
  }

  private build(arch: string): void {
    this.builtFor = arch;
    for (const e of this.entries) e.el.remove();
    this.entries = [];
    if (!hasArchetype(arch)) return;
    const def = getArchetype(arch);
    const keys: ("D" | "F" | "G")[] = ["D", "F", "G"];
    let k = 0;
    const abilities = [...def.abilities].sort((a, z) => (SLOT_ORDER[a.slot] ?? 3) - (SLOT_ORDER[z.slot] ?? 3));
    const mk = (label: string, key: string, ic: string, sig: boolean): HTMLButtonElement => {
      const b = document.createElement("button");
      b.className = `fk-btn ${sig ? "fk-sig" : "fk-pow"}`;
      b.innerHTML =
        `<i class="ic">${icon(ic, "currentColor", 17)}</i><span class="lb"></span><span class="cost"></span>` +
        (key ? `<span class="k">${key}</span>` : "");
      b.querySelector(".lb")!.textContent = label;
      return b;
    };
    for (const a of abilities) {
      const key = keys[k++] ?? "";
      const el = mk(a.name, key, SLOT_IC[a.slot] ?? "bolt", a.slot === "signature");
      const entry: PowerEntry = { key, kind: "ability", id: a.id, name: a.name, blurb: a.blurb, targeting: a.targeting, def: a, el };
      el.onclick = () => this.onFire(entry);
      this.entries.push(entry);
      this.el.appendChild(el);
    }
    if (def.signature) {
      const key = keys[k++] ?? "";
      const el = mk(def.signature.name, key, "bolt", true);
      const entry: PowerEntry = { key, kind: "signature", id: "__signature", name: def.signature.name, blurb: def.signature.blurb, targeting: "none", el };
      el.onclick = () => this.onFire(entry);
      this.entries.push(entry);
      this.el.appendChild(el);
    }
  }

  byKey(key: string): PowerEntry | undefined {
    return this.entries.find((e) => e.key === key);
  }

  /** Resolve a power into an intent/arming action (hover tile for hotkeys). */
  static action(e: PowerEntry, hover: number): PowerAction {
    if (e.kind === "signature") return { t: "send-signature" };
    if (e.targeting === "none") return { t: "send-ability", ability: e.id };
    if (hover >= 0) return { t: "send-ability", ability: e.id, target: hover };
    return { t: "arm-ability", ability: e.id };
  }

  /** Live labels: cost, cooldown, affordability, armed highlight. */
  update(me: PlayerState, s: SimState, armedAbility: string | null): void {
    if (this.builtFor !== me.archetype) this.build(me.archetype);
    const usd = me.usd;
    const faith = me.faith;
    for (const e of this.entries) {
      let costText = "";
      let hint = "";
      let cant = false;
      let cd = 0;
      if (e.def) {
        cd = me.cooldowns[e.def.cooldownKey] ?? 0;
        const c = e.def.cost(me);
        const parts: string[] = [];
        const hints: string[] = [];
        if (c.usd && c.usd > 0) {
          parts.push(fmtMoney(toInt(c.usd)));
          hints.push(fmtMoney(toInt(c.usd)));
          if (usd < c.usd) cant = true;
        }
        if (c.faith && c.faith > 0) {
          parts.push(`${toInt(c.faith)}✛`);
          hints.push(`${toInt(c.faith)} Faith`);
          if (faith < c.faith) cant = true;
        }
        costText = parts.join(" ") || "free";
        hint = hints.length ? `Costs ${hints.join(" + ")}` : "Free";
        const tgt = e.targeting === "tile" ? "click the button, then a tile (or hover + hotkey)" : e.targeting === "district" ? "click the button, then anywhere in the district" : "fires instantly";
        hint += ` · ${tgt} · cooldown ${Math.round(e.def.cooldownTicks / 10)}s`;
      } else {
        // the SIGNATURE intent: once-per-match / gated by the cult's own rule
        // The cult's own gate, straight from the registry (DLC-safe).
        const why = getArchetype(me.archetype).signature?.blocker?.(s, me) ?? "";
        cant = why !== "";
        costText = me.prophecyUsed ? "used" : cant ? `${Math.floor(me.soulsPermille / 10)}%` : "ready";
        hint = cant ? `${why[0]!.toUpperCase()}${why.slice(1)} · once per match` : "Once per match";
      }
      e.el.classList.toggle("cd", cd > 0);
      e.el.classList.toggle("cant", cd <= 0 && cant);
      e.el.classList.toggle("arm", armedAbility !== null && armedAbility === e.id);
      const costEl = e.el.querySelector<HTMLElement>(".cost")!;
      const txt = cd > 0 ? `${Math.ceil(cd / 10)}s` : costText;
      if (costEl.textContent !== txt) costEl.textContent = txt;
      e.el.title = `${e.name}${e.key ? ` [${e.key}]` : ""} — ${e.blurb}\n${hint}`;
    }
  }
}
