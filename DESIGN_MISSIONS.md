# FLOCK v3 — THE MISSION REWORK (design contract)

_Locked 2026-07-05 in working session. This supersedes §4 (fronts), §5
(stances), §6 (buildings), §9 (rituals) of DESIGN.md. Everything not named
here survives unchanged. Execution is EDIT-IN-PLACE (owner's call): evolve
the existing code, no parallel mode — baseline discipline via the phased
plan in §9 below, every phase committed green._

## 0. The fantasy, one sentence

You are the shepherd of a flock you can SEE — you send them into town, they
work door to door, houses light up in your color, and you call them home
when the heat rises.

## 1. The 10-second loop

1. **FOUND** — click wilderness → compound + starting flock _(shipped, keep)_
2. **SEND** — **RIGHT-CLICK** the map (a house tile OR a specific key
   building) to open a **radial wheel** at the cursor with three arcs:
   **SPREAD / TEND / CRUSADE**. Click an arc to launch the cohort at that
   target in that mode. (The %-of-flock is a slider on the wheel; default
   40%, remembered per session.) The cohort marches there visibly
   (street-true routing) and **auto-spreads**: nearest unconverted door
   first, expanding outward. A key building in the zone becomes their focus.
   No steering after send — OpenFront rule: the order IS the strategy.
   _(Left-click stays reserved for selection/inspection + the founding
   SPAWN placement.)_
3. **REACT** — converted houses get a **glowing outline in your color**;
   key-building progress shows as **bars in the right-rail panel**. Rivals'
   cohorts are visible on the streets.
4. **RECALL** — per-cohort button; they physically walk/bus home
   (vulnerable in transit — recall friction is what makes counterplay real).

**Cohorts:** max **3 concurrent** (readability cap). A cohort =
`{targetTile, mode, mass}`. Slider 10–90%; the **inner circle (20% of
flock) can never deploy** — losing everything in one bad minute must be
impossible.

## 2. Resources — one meaning each

| Resource | Earn | Spend/Risk |
|---|---|---|
| **FOLLOWERS** (mobile cadre) | Recruits trickle in from your believers (see §4) | Deployed = converting but exposed (attrition, deprogrammers, rival crusades). Lost followers are LOST. |
| **MONEY** | Tithe from believer tiles (existing engine + anchors) | Commune stages 1–5 (flock cap, van/bus capacity — the ONLY buildable, visualized by existing growth-stage art) + ops: strikes, agents, scandal, court, buses (fast recall/deploy = money buys tempo) |
| **FAITH** | Tend missions, church/chapel control, milestones | **Doctrine nodes directly** (B.I.T.E. grid stays; tiers still gate on believer count). Rituals are DEAD; their best effects become doctrine nodes. |

## 3. The conversion engine (the sim core, rebuilt on presence)

Pressure source changes from abstract fronts to **local deployed
follower-mass**. The factor pipeline SURVIVES — it already encodes
archetype and doctrine and is the reason to edit-in-place:

```
rate(tile) = base
           × local_cohort_mass            (presence: the new term)
           × mode_mult                    (SPREAD 1.0 / TEND 0 / CRUSADE 1.6)
           × susceptibility(tile)         (exists)
           × districtCoeffs.conv          (exists)
           × archetype r0 & coeffsOf()    (exists — §11 kits)
           × doctrine mults               (exists — §10 hooks)
           × civics mults                 (exists — school creep etc.)
           × road adjacency +10%          (exists)
           − defender: retain × Tend presence × grocery/fort mults (exists)
```

Houses flip in ~3–6 s under solid presence (ITV). **Key buildings are
sieges: 25–40 s** of sustained presence (extends the existing landmark
0.5× rule to all civic/anchor lots).

**CONTESTS (owner's open question — resolved as tug-of-war):** one meter
per key building. Net fill = leading attacker's pressure − holder's
retention − rival attackers crowding it out. Meter carries the leader's
color; contested = flashing; uncontested partial progress decays ~1%/s.
Tug-of-war is the most legible capture model there is, and the right-rail
bars make the whole town's siege state readable at a glance.

## 4. Flock growth — recruits from believers

`recruits/s = believers / R × commune_stage_mult` (R ≈ 200, ITV) — capped
by commune stage. Territory feeds the army; the loop closes. Conversion
factors (doctrine growth nodes, archetype coeffs, high-school civic) plug
into R exactly as they plug into the engines today.

## 5. Victory — DOMINATION ONLY (owner's call)

72% believers or best count at timer. Revelation mode: **✂ CUT — delete
the flag and the dead branch.** The conversion bar gets a **threshold
marker** and a one-line path readout ("2nd · 41% · need 72% · 6:12").
Elimination = commune destroyed + flock at zero.

## 6. Presentation contract

- **Mission wheel (the SEND verb)**: right-click a map tile or key building →
  a radial menu opens at the cursor with three arcs (SPREAD ☘ / TEND ✚ /
  CRUSADE ✦), a center readout of the target ("Elm St" / "Sheriff"), and a
  %-of-flock slider ringing the wheel (default 40%, session-remembered).
  Click an arc → MISSION_SEND{tile, permille, mode}. Esc / click-away cancels.
  Greys out arcs when flock is at the inner-circle floor or 3 cohorts are
  live. Keyboard fallback: hover + 1/2/3. Building targets snap the wheel
  center to the building's anchor tile so sieges are one gesture.
- Converted houses: **glowing outline, player color**. Default palette =
  archetype color; collision (two players, same archetype) shifts hue —
  colorForPlayer already guarantees uniqueness, reorder its base table to
  archetype-first.
- Right rail: **Key Buildings panel v2** — existing civics panel + per-
  building tug-of-war bars + holder swatch + click-to-jump (exists).
- Cohort chips (≤3): mode icon, % of flock, target thumbnail, RECALL.
- Deployed dots: the civic-day walker system renders cohorts as columns
  marching on real streets — the army display is nearly free.

## 7. What dies (✂ ledger) / what survives repurposed

**DEAD:** rituals (all), 5-building palette (compound/plates/watchtower/
broadcast/labs — effects fold into commune stages + doctrine), global
stances, OPEN_FRONT/CLOSE_FRONT, revelationMode.
**EXPLICITLY PROTECTED (P2 — asymmetry is the moat):** the four archetype
kits' ACTIVES and SIGNATURES survive untouched, costed in money/faith as
today. Rituals were the generic shared verbs; the kit powers are the
asymmetric ones. Cutting them would gut the moat — they are 🔒 for this
rework. Where an active referenced a dead system (e.g. targets a front),
it retargets the equivalent cohort concept in M2.
**REPURPOSED:** vans→buses (deploy/recall tempo), agents+strikes→money ops
(counter-cohort tools: deprogram a deployed cohort), civics+anchors→siege
targets, dot system→army display, property engine→unchanged, CPA→auto-brake
on crusade-heavy leaders (unchanged).

## 8. Depth & anti-snowball (directive 2, designed-in)

- Deployed vs home is a refreshed-every-moment tradeoff.
- Tend + grocery/fort = the small-empire defensive identity.
- Crusade feeds Heat feeds CPA = leader auto-brake.
- Overextension is VISIBLE (your flock on the streets) → punishable
  (crusade their commune, deprogram their cohort).
- Wide play pays twice (money + recruits) but exposes twice.
- Success gate: bot-mirror median lead share **< 0.90** (vs 0.94–0.98
  today), duration stays 8–20 min, decisive% ≥ 50.

## 9. Execution plan — edit-in-place, 8 phases, each committed green

| Phase | Scope | Gate |
|---|---|---|
| M1 | Cohort state + SEND/RECALL intents beside fronts (snapshot v9, hashed) | suite green, x-browser PASS |
| M2 | Presence-based conversion engine; fronts deleted; conversion tests rewritten | conversion suite green |
| M3 | Recruits-from-believers; rituals→doctrine Faith costs; palette→commune stages | economy/doctrine tests |
| M4 | Key-building tug-of-war meters + glow state | contest A/B tests |
| M5 | Bot brain v3 (three verbs — simpler than today); botleague re-baselined | campaign: gates in §8 |
| M6 | Client: right-click **mission wheel** (Spread/Tend/Crusade arcs + %-slider, map-tile or building target), cohort chips w/ recall, right-rail building bars, glow outlines, victory readout | Playwright + vision QA (browser-verified) |
| M7 | Protocol/rooms/tutorial rewrite | lockstep smoke + e2e |
| M8 | Full audit: depth review, QA renders, docs, ✂ ledger closed | Phase-6 sweep |

Baseline law holds per phase: build + suite + determinism gate green at
every commit; playtest smoke after M2, M5, M7.

## 10. Risk register — every risk carries its falsifier

| # | Risk | Gate that catches it |
|---|---|---|
| R1 | Auto-spread feels dumb (cohort ignores the building you aimed at, converts scatter) | M2 unit gates: focus-target-first rule asserted; M8 vision QA of cohort behavior renders |
| R2 | Progress feels slow/dead between glow flips | ITVs in balance.json (hot-tunable); M5 campaign: conversion-events/minute metric |
| R3 | Cohort wiped in transit feels unfair ("my army died walking home") | Inner-circle floor + bus tempo + threats visible; M8 playtest verdict logged FEELS-RIGHT/TUNE/RETHINK |
| R4 | New dominant strategy ("always 80% spread nearest") re-creates the snowball | THE gate: bot-mirror median lead share < 0.90, else DEPTH-FIRST REDESIGN before M6 polish |
| R5 | Domination-only makes Faith vestigial (doctrine starves) | M5 campaign metric: doctrine purchases/match; if ~0, doctrine costs/effects retune before M8 |
| R6 | Edit-in-place breaks the live baseline mid-rework | Phase law: every commit green (build+suite+x-browser); bisectable history |
| R7 | Kit actives orphaned by dead systems | §7 protection clause; M2 retarget checklist, kit.test.ts must stay green every phase |

## 11. Engagement & commercial rationale (claims, not guarantees)

What this rework changes commercially, grounded in genre mechanics — no
design "maximizes sales" by decree; these are the falsifiable mechanisms:

- **Map-painting dopamine** (the #1 .io engagement driver — agar/OpenFront/
  paper-io all live on it): glowing houses filling in YOUR color is exactly
  this, and the current invisible fronts entirely lack it. Biggest single
  engagement upgrade in the design.
- **Onboarding funnel** (Tiber persona): guest-play exists; v3 cuts the
  verb count from ~30 to 3 — first-match comprehension is the .io
  conversion moment. Tutorial rewrite is M7, in scope.
- **Streamability** (Rev persona): visible armies, sieges with public
  progress bars, and betrayals read on stream; invisible pressure fields
  don't. Recap cards (§25, shipped) close the share loop (P5).
- **Retention**: the meta layer (XP/relics/daily/ranked/clans — B2,
  shipped) is untouched by this rework and fits the 8–20 min session.
- **Monetization surface** (P4-clean): glow styles, cohort march visuals,
  commune skins — new cosmetic real estate, zero pay-to-win.
- **Honest limits**: sales also depend on things outside this design —
  human playtests (B7.9), launch infra (B7.*), store/marketing execution.
  A redesign can remove the known engagement blockers; it cannot promise
  revenue. The measurable in-scope claims are R2/R4's metrics plus
  first-session completion once humans play.
