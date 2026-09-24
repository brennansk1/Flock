# FLOCK — Stage 1 Design Revision: "Consolidate & Clarify"

**Status:** Adopted (Game Director decision). Supersedes conflicting parts of `GAME_DESIGN.md` §2, §4.5, §9.
**Evidence base:** player-journey audit of `packages/client` + 24-match telemetry (`tools/playloop_telemetry.mjs`, 6 bots, 96² maps).

---

## 0. Diagnosis (what the data said)

| Finding | Evidence | Consequence |
|---|---|---|
| The cash economy is 10–50× too poor for its price list | Lifetime earnings/seat $1k–9k; every $-ability costs $12k–$300k; Ledger $1.2M | Radiant & Circle have **no usable kit**; decrees & commune upgrades ~never happen |
| Heat is inert | Crusade +0.056/s max vs decay −0.08/s → avg Heat 0–2, 0% of time ≥ 60 | CPA pickets/raids (the anti-snowball brake) never fire |
| Scandals are unreachable | 11,531 publish attempts, 0 successes (needs agent evidence) | The only rival-vs-leader tool is dead |
| Early lead decides the match | 5:00 soul leader wins 67%; lead gap 1% → 26% by 10:00 | Snowball; nothing to do if behind |
| Late game is dead | Flips/10s: 31 at 2–5 min → 6 after 10 min; 58% of games time out | Last third of the match is waiting |
| Winning is invisible | HUD "LEADER" uses tiles, win check uses souls; no win line; no Victory/Defeat screen | Players can't form a plan |
| UI lies / hides the game | "1/2/3 stance" does nothing; N/B keycaps unbound; decrees & schemes hidden behind hotkeys | Friction, distrust |
| Asymmetry is lopsided | Wins/36 seats: Dawn 11, Circle 7, Visitors 5, Radiant 1 | One cult is the game |

The problem is **not missing mechanics** — it is overlapping, inert and invisible ones. Stage 1 fixes the loop before adding anything.

---

## 1. Design pillars for every Stage 1 decision

1. **Readable in 10 seconds** — every rule has one on-screen representation.
2. **Every minute has a decision** — money, Faith and cohorts must always have somewhere good to go.
3. **Leaders are loud, not safe** — size makes you visible and exposable; the brake is in *rivals'* hands.
4. **Every match ends in a climax** — wins are telegraphed countdowns the whole lobby can fight.
5. **Four cults, four games** — each cult has a distinct win route, not just different multipliers.

---

## 2. The core loop (what you do)

```
 CONVERT ──► FLOCK grows ──► TITHE ($) ──► spend: Commune · Recruit · Powers · Decrees · Expose
    ▲                          │
    └──── FAITH (Tend) ◄───────┘──► spend: Doctrine · Faith powers
                 HEAT rises with every conversion you make — big + aggressive = exposable
```

**Three verbs, one screen:**
- **Send** (right-click town → mission wheel): Spread / Tend / Crusade cohorts, max 3. *The* core verb.
- **Spend** (bottom tray + powers rail): Commune stage, Recruitment Drive, cult powers, civic decrees.
- **Scheme** (right-click a *rival's* ground → context menu): Expose, Strike. No hidden hotkeys.

**Cut from the player-facing game** (kept dormant in the sim, hidden in UI, removed later if never revived): the global stance (mission modes replaced it — `SET_STANCE` is now ignored, bots included), vans, couriers, agents/evidence gathering, alliance pacts UI beyond propose/accept/break.

---

## 3. Victory — one rule, many roads

**The Ascension rule.** Meet any victory condition → a **45-second public countdown** starts (banner + map beacon for every player). Keep the condition true until zero → you win. The countdown collapses if the condition breaks, and **restarts from 45s** if a rival **Exposes** you.

| Path | Who | Condition (held for 45s) | How rivals break it |
|---|---|---|---|
| **Domination** | Everyone | Soul share ≥ the **Tipping Point** (65% → slides to 50% between 8:00 and 12:00) | Take souls back |
| **Revelation** | Everyone | Own the Megachurch with Faith ≥ 90 | Capture the Megachurch / drain Faith |
| **The Rapture** | Dawn | ≥ 30% souls **and** a majority of the town's holy ground (churches, chapels, Megachurch) | Take a church back |
| **Total Wellness** | Radiant | ≥ 35% souls **and** average dissent on your ground ≤ 8 | Expose / Radio Static (both add dissent) |
| **The Ledger** | Circle | ≥ 20% souls **and** bank ≥ map target (S $150k · M $300k · L $500k) | Expose; take souls |
| **First Contact** | Visitors | ≥ 20% souls **and** 4 saucer chapels standing | Convert a chapel tile (destroys it) |

**Timer expiry** (server default 12:00): most souls wins; ties → cash → Faith. (Was tiles — contradicted the win bar.)

Why: one rule to learn, five flavours; every path is spatial or contestable; the Tipping Point guarantees late-game pressure without a new system; countdowns are the streamable climax.

---

## 4. Heat = Notoriety (the leader brake, fixed)

- **Every tile you convert raises Heat** (+0.25 × cult heat coef; ×2 if the capturing cohort is on Crusade).
- **Scrutiny:** Heat gain × (1 + 2 × max(0, soul share − 20%)), capped ×1.6. Big cults get loud.
- Decay −0.08/s (unchanged); Town Hall/Sheriff decay bonuses unchanged.
- Thresholds unchanged: **60** CPA pickets on your biggest cohort, **85** deprogrammer raids.
- The CPA targets the highest-Heat cult — which is now, naturally, the leader.

## 5. Expose (scandal, rebuilt)

- Scheme → **Expose** any rival whose Heat ≥ 25. Cost: $4,000 × (1 + your exposes this match). 60s cooldown per attacker.
- Effect: rival loses clamp(Heat × 0.6, 5%, 35%) of followers (Circle ×1.5), −25 Faith, +10 dissent on all their ground, **resets their Ascension countdown**. Attacker gains +10 Heat (mud sticks).
- No agents, no evidence bar — the gate is the *victim's* Heat, which they control.

## 6. Economy rescale

Income stays; **prices come down to the real economy** (target: a mid cult affords a $-power every ~60–90s by minute 5):

| Item | Old | New |
|---|---|---|
| Street Prophet | $12k | $1.5k |
| Juice Cleanse | $20k | $2k |
| Retreat Weekend | $35k | $3.5k |
| Crop Circle | $15k | $1.5k |
| Saucer Landing | $25k | $3k (cooldown 90s) |
| Seminar Blitz | $60k → +2,500 | $4k → +25% of current flock (cap-limited) |
| Hostile Takeover | $300k / 120 tiles | $12k / 40 tiles |
| Civic decrees | $6k–40k | ÷10 |
| Commune stage | $15k × 1.35ⁿ | $2k × 1.35ⁿ |

Exact numbers are tuned by the telemetry league (§9); the table is the starting point.

## 7. Cult identity fixes

- **Dawn:** Prophecy is no longer free value (was fulfilled 23/28): requires ≥ 25% souls to declare; Rapture flip halved. Dawn's route to victory is holy ground.
- **Radiant:** usable kit (price rescale) + Glow ramps 2× faster (cap reached at 100s). Their game: hold still, stay clean, win on Wellness.
- **Circle:** Seminar Blitz scales with flock instead of a fixed town-sized number; Ledger target reachable.
- **Visitors:** Saucer cooldown 90s so First Contact is a real plan by ~8:00.

## 8. Information doctrines (were stubs)

- **I1 Rumor Mill:** your Expose costs −40% and ignores the Heat 25 gate threshold down to 15.
- **I2 Counter-Narrative:** Exposes against you do half damage and don't reset your Ascension.
- **I4 Official Story:** your Heat decays 2× while below 60.

## 9. HUD / menus (client)

1. **Victory Race panel** — for every cult: its best path, progress bar, and live Ascension countdown. Tipping Point marker on the share bar. LEADER % uses souls.
2. **Threat lane** — stacked cards for incoming strikes, raids, rival Ascensions, Exposes, CPA pickets, with countdowns and "go here" jump.
3. **Scheme context menu** — right-click rival ground → Expose / Strike with price & availability. All hidden hotkeys retired or shown.
4. **Truthful controls** — remove stance copy; bind or remove every keycap; decree buttons on held Key Buildings rows; "n/3 cohorts" in Missions.
5. **Victory / Defeat moment** → recap → **Play again · Change cult · Menu**.
6. **Cult select from the registry** — tagline, playstyle, difficulty, win route, powers; default = Radiant (difficulty 1, most forgiving).
7. **Coach nudges** (first 3 matches): idle cohort slot, affordable commune/recruit/power, rival ascending, "you can Expose X".
8. **Cosmetic skins** — `SkinLoadout` (renderer-only) wiring the existing Ember/Frost recolors.

## 10. Acceptance targets (telemetry league, 4 cults, 96², 12:00 timer)

| Metric | Baseline | Target |
|---|---|---|
| Decisive (non-timer) finishes | 42% | ≥ 70% |
| Median match length | 17 min (20-min cap) | 8–12 min |
| 5:00 leader wins | 67% | ≤ 50% |
| Each cult's win share | 3%–31% | 18%–32% |
| $-powers cast / seat / match | 0 | ≥ 4 |
| Leader reaches Heat 60 | 0% | ≥ 50% of matches |
| Flips/10s after 10:00 | 6 | ≥ 12 |
