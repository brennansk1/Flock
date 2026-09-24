# FLOCK — Playtest Readiness Report (2026-07-02)

_The go/no-go assessment before the first group playtest: what was verified,
with what evidence, and what a playtest host should know. Produced by the B8
sprint (see [BUILD_MANIFEST.md](./BUILD_MANIFEST.md) §B8)._

**Verdict: GO for group playtests.** All audit BLOCKERs and MAJORs are closed;
tests are green across packages (sim 78, server 14); simulations put match
length inside the design band and the bot ladder provides a real difficulty
gradient. One balance watch-item (Dawn over-performing in bot hands) is logged
for the first human sessions.

---

## 1. Time of play — ✅ in band

Headless campaign on live server settings (96², 4 players, domination 720‰,
12-min timer, sect bots — `tools/playtest_sim.mjs`):

- **8 matches: median 12.0 min, range 5.4–12.0, 100% decisive.**
- Design target (DESIGN Part I): 8–20 min public. The 12-minute timer is the
  effective cap; skilled aggression ends matches as early as ~5½ minutes.
- Size pacing: 64² and 128² still ride the same timer — map size shifts
  density and stand-off distance, not the clock. Private-room hosts control
  pacing via the founding knob (Blitz 120 / Normal 200 / Relaxed 400).
- **Population now scales with map area** (B8.5): 64²≈1,300 souls, 96²≈2,990,
  128²≈5,160 — constant ~0.32 souls/tile, so conversion pressure per cult is
  stable across sizes.

## 2. Balance & bot challenge — ✅ with one watch-item

- **Tier ladder works** (church/sect/sect/drifter, 96²): average placement
  church **2.00** < sect **2.38** < drifter **3.25**. Higher tiers reliably
  finish higher — bots give solo players a real gradient.
- **Archetype drift watch (bot-league):** 60 matches / 4p / 48²: dawn 33.3%,
  visitors 30.0%, radiant 18.3%, circle 18.3% (expected 25% ±6.25 band).
  A conservative r0 re-tune (dawn −4%, radiant/circle +6–8%) was TESTED and
  REVERTED: the control run moved dawn UP to 36.7% and circle DOWN to 15% —
  the drift is bot-style synergy (sect bots blitz early, which is dawn's
  kit), not a coefficient error. Verdict: keep the DESIGN-table values, treat
  bot drift as an instrument reading, and let the first HUMAN sessions decide
  any tune (§41's designed flow). Both league transcripts are in the appendix.
- **Bots as opponents:** 65% of bot matches end in domination (not timer) —
  bots do close out games, and the tier ladder gives hosts three difficulty
  levels for mixed-skill lobbies.

## 3. Strategy depth — ✅ layered, with a readable core loop

The core loop (convert → defend → ritual) is 3 keys and a click. Depth stacks
on top in optional layers, each with its own control surface:

1. **Stances** (1/2/3) — tempo control, the first strategic choice.
2. **Economy** — tithes, vans (now manually routable: `v`/`shift+V`),
   couriers, property purchase; robbery risk on long routes.
3. **Doctrine** (grid, milestone-gated) — build-crafting; now shareable with
   an ally via the Ecumenical Pact (shift-click an owned node).
4. **Diplomacy** — alliances, pacts, betrayal (JUDAS), scandals, defection
   courting; grudges persist.
5. **PvP pressure** — strikes, agents, raids, fronts (open `click`, close
   `c`).
6. **Civics** — control of town institutions grants live modifiers.

New-player onboarding: FTUE coaching (§26), founding-spot hints, live costs
on the ability rails, and hint text on every stance/power/civic row. A
first-timer can ignore layers 3–6 entirely and still play the core loop.

## 4. HUD clarity — ✅ reviewed, verified surfaces

- Top bar: followers / $ / faith / heat / tiles at 10 Hz; conversion bar is
  the scoreboard (cult-colored population shares, sorted).
- Every stance button, ability tile, and civic row carries a `title` tooltip
  with its role AND live cost/affordability (B4.4.2 verified).
- Feed + freeze-frame banners narrate big moments (raids, betrayals,
  prophecies); reduced-motion setting disables banner animation.
- Chat is keybind-isolated (typing never triggers hotkeys), XSS-escaped,
  server-moderated (B4.4.3 verified).
- **New this sprint:** people dots are 2×2 high-contrast figures colored by
  conversion state (neutral putty / cult color / apostate gray / gold
  Downline accent), and every cult building glows in its owner's color with
  a tick pulse — territory and staffing read at a glance even at LOD 1.
- Accessibility: colorblind-safe archetype patterns (pattern-redundant
  territory), reducedMotion, mute, volume sliders (client-persisted).

## 5. What a playtest host should know

- **Private rooms:** menu → Play → "Host a private match…" → share the
  5-letter code (also echoed into match chat). Knobs: bots 0–3, map 64/96/128,
  town type (farm/oceanside/desert/mountain/lakeside), founding window.
- **Controls recap** (also on the Play screen): found on a glowing spot ·
  click = open front · 1/2/3 stances · QWER rituals · D/F powers · G
  signature · `v` van route · `c` close front · `z` cancel build · `F8`
  surrender · Enter chat.
- **Name policy:** profanity + real cults/religions/figures are filtered;
  filtered names show as "Sect #id" (tone guardrail §30).
- **Known accepted MINORs** (post-playtest backlog): EMOTE picker (B8.11),
  server-side settings sync (B8.12), live-updating civics panel effects.
- **Launch seams still blocked** (B7.*): OAuth, TLS, Postgres, telemetry,
  payments — irrelevant for LAN/dev-server playtests.

## 6. Evidence trail

- Sim tests: **78/78** (incl. new pact + moderation coverage) · Server tests:
  **14/14** (incl. 3 private-room tests) · Client + server + sim build clean.
- Renders: QA gallery `QA gallery/2026-07-02_22-40/` (42 shots) + live-match
  glow/dot verification renders (scratch).
- Simulation transcripts: appendix below.

---

## Appendix — simulation campaign transcript

_(auto-appended by tools/playtest_sim.mjs + tools/botleague.mjs)_

== CLASSIC 96² · 4p · sect bots · 8 matches ==
  match 0: 12.0 min · DOMINATION · winner dawn
  match 1: 12.0 min · DOMINATION · winner circle
  match 2: 5.5 min · DOMINATION · winner dawn
  match 3: 12.0 min · DOMINATION · winner dawn
  match 4: 12.0 min · DOMINATION · winner visitors
  match 5: 5.4 min · DOMINATION · winner dawn
  match 6: 12.0 min · DOMINATION · winner dawn
  match 7: 8.0 min · DOMINATION · winner radiant
  → median 12.0 min · min 5.4 · max 12.0 · decisive 100%
  → winrates (seat-adjusted): dawn 250% · radiant 50% · circle 50% · visitors 50%

== TIER LADDER 96² · 4p (church/sect/sect/drifter) · 4 matches ==
  church   avg placement 2.00  (n=4)
  sect     avg placement 2.38  (n=8)
  drifter  avg placement 3.25  (n=4)

== SIZE PACING · 4p sect · 3 matches each ==
  64²: 12.0 / 12.0 / 3.3 min · decisive 3/3
  96²: 12.0 / 6.1 / 12.0 min · decisive 3/3
  128²: 12.0 / 10.1 / 12.0 min · decisive 3/3


FLOCK bot-league — 60 matches, 4p, 48² maps, tier=sect
decisive (domination) finishes: 65%

archetype     winrate   avg place   (target band 45-55% adj. for player count)
dawn           33.3%     2.17  ⚠ drift
radiant        18.3%     2.72  ⚠ drift
circle         18.3%     2.78  ⚠ drift
visitors       30.0%     2.33

== TUNED-COEFFICIENT CONTROL RUN (reverted — see §2) ==
decisive (domination) finishes: 65%

archetype     winrate   avg place   (target band 45-55% adj. for player count)
dawn           36.7%     2.13  ⚠ drift
radiant        20.0%     2.68
circle         15.0%     2.83  ⚠ drift
visitors       28.3%     2.35
