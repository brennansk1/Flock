# FLOCK
## Master Design Document — v2.0 "The Complete Testament"
### Status: BUILD-READY. All systems specified, all open questions resolved, all initial tuning values set.

**Genre:** Browser-first competitive territory strategy (.io) × asymmetric cult-builder
**Platforms:** Web → Steam Early Access (Electron + Steamworks.js)
**Players/match:** 8–100 humans + AI (≤300 total entities) | **Match length:** 8–20 min public
**Model:** F2P, cosmetics + season pass + supporter tiers. **Never pay-to-win.**
**Pitch:** *OpenFront meets Cult of the Lamb — the first competitive multiplayer cult-builder.*

> **Numbers convention:** every value in this document is an **initial tuning value (ITV)** stored in a server-side config (`balance.json`), hot-patchable without client updates. Time in seconds, money in fictional $, rates per second unless noted. The simulation runs at **10 ticks/sec**; one network **Turn = 1 tick (100 ms)**. All sim math is integer/fixed-point (Q16.16).

---

# PART I — VISION (unchanged from v1.0; abridged)

**Fantasy:** charismatic mastermind founding a fringe movement in Mundane Falls, USA; last congregation standing. **Tone:** cute-creepy satire of *mechanisms* (money, manipulation, devotion) — never real faiths, never real tragedies.

**Pillars:** P1 Ten-seconds-to-play / ten-years-to-master · P2 Asymmetry is the moat · P3 Betrayal is content · P4 The money is the joke (fictional $ in-game; real $ stays cosmetic and clean) · P5 Every match ends in a story (engineered shareability).

**Personas:** Tiber (.io grinder, acquisition), Mae (dark-cozy fan, virality), Rev (streamer, amplification).

---

# PART II — SIMULATION FUNDAMENTALS

## 1. The Tile Model

The world is a grid of **tiles**. Each tile is one of:

| Tile class | States | Notes |
|---|---|---|
| **Citizen tile** | Neutral → Believer(owner) → Apostate(timer) → Neutral | The conquerable substrate. Carries: `owner`, `susceptibility (S: 0–100, hidden)`, `dissent (0–100)`, `conv_progress per attacker`, `district_id`. |
| **Terrain tile** | Woods / Lake / Road | Woods & Lake impassable except Van routes + Saucer Landing. Roads: Vans move 2×; conversion creep +10% along roads (ideas travel the highway). |
| **Landmark tile** | Neutral / Owned | 5 per map (M size). Captured like citizen tiles at 0.5× speed; grants global effect (§12). |
| **Structure slot** | Empty / Built | Buildings occupy 1 tile inside owned territory. |

**Map sizes (populated-tile counts are the balance unit):**

| Size | Grid | ~Populated tiles | Players | Victory threshold |
|---|---|---|---|---|
| S | 128×128 | 9,000 | 8–16 | 72% (timed 12 min) |
| M | 192×192 | 20,000 | 24–50 | 72% (timed 16 min) |
| L | 256×256 | 36,000 | 50–100+ | 80% (timed 22 min) |

If the timer expires with no threshold winner: **highest Believer-tile count wins; tiebreak = total $ earned; second tiebreak = Faith.**

## 2. District Templates & Map Generation

Maps are assembled from **hand-authored district templates** placed by a constrained generator (offline tool, outputs binary maps versioned and shipped to client+server).

**Generator rules (hard constraints, in order):**
1. Place **Downtown** template at map centroid ±10% (forces mid-game conflict at the income heart).
2. Place 5 landmarks: Radio Tower & Megachurch in opposite map thirds; Town Hall adjacent to Downtown; Fairground and Water Tower in remaining quadrants. Min pairwise distance: 25% of map diagonal.
3. Tile district quotas (M map): Suburbs 38%, College 8%, Downtown/Strip 12%, Old Town 12%, Trailer/Outskirts 18%, Woods/Lake 10%, Roads 2%.
4. **Spawn fairness:** every legal spawn zone must have, within a 20-tile radius: ≥600 neutral citizen tiles, ≥1 district boundary (so every opener has a texture decision), and no landmark within 12 tiles.
5. Connectivity: every district reachable from every other without crossing Woods/Lake (roads guarantee this); Woods corridors must create ≥2 Van shortcut routes per map quadrant.
6. Symmetry: ranked 1v1 maps are mirror-symmetric; FFA maps are rotationally balanced within ±5% on (neutral tiles, income-weighted tiles, landmark distance) per spawn.

**District coefficient table (authoritative):**

| District | `conv` | `retain` | `income` | Spawnable? |
|---|---|---|---|---|
| Suburbs | 1.0 | 1.2 | 1.0 | ✔ |
| College Campus | 1.6 | 0.6 | 0.7 | ✔ |
| Downtown/Strip | 0.9 | 1.0 | 1.5 | ✖ |
| Old Town | 0.5 | 1.6 | 1.3 | ✔ |
| Trailer/Outskirts | 1.3 | 0.9 | 0.6 | ✔ |

**Susceptibility (S):** per-tile hidden value rolled at mapgen: Normal(μ=50, σ=18), clamped 5–95, with district biases (College +12, Old Town −8). Revealed by scouting (§14) in bands: Low / Med / High. S multiplies neutral-tile conversion by `0.5 + S/100`.

## 3. Resources — Exact Formulas

### 3.1 Followers (manpower)
- Start: **1,000**. Cap: **5,000 + 25,000 × Compounds** (incl. the free First Compound).
- Growth (logistic): `Δfollowers/sec = 0.022 × F × (1 − F/cap) × faith_growth_mod × archetype_growth`
  - `faith_growth_mod = 0.8 + Faith/250` (range 0.8–1.2)
  - Peak absolute growth at F = cap/2; the classic "stay in the 30–50% committed band" tension emerges naturally.
- Followers committed to fronts (via Stance, §5) are exposed: they take attrition in contested resolution and don't defend home tiles.

### 3.2 $ USD (economy)
- **Tithe (passive):** `$/sec = 0.018 × F × territory_income_avg × dissent_tax`
  - `territory_income_avg` = mean district `income` over owned tiles.
  - `dissent_tax = 1 − avg_dissent/200` (100 avg dissent = half income).
  - Reference: 20k followers in average land ≈ **$360/sec** ≈ $21.6k/min.
- **Courier routes (active economy):** each pair of Collection Plates auto-spawns a courier every 20s carrying `$4 × route_length_tiles` (cap $1,200/courier). Couriers are visible, follow roads when possible, and can be robbed by enemy Vans (robber receives 100%). Long snaky empires earn more and expose more — risk/reward by geometry.
- Starting bank: **$8,000.**

### 3.3 Faith (0–100, cult-wide)
- Base drift: toward 50 at ±0.05/s.
- Gains: Sermon ritual +meter (§13); winning a contested district +2; fulfilled Prophecy +30; Megachurch owned +0.15/s.
- Losses: losing a district −2; scandal published on you −25; failed Prophecy −40; each Schism −20.
- Effects: `faith_combat_mod = 0.85 + Faith/333` (0.85–1.15 on conversion attack & defense); growth mod (3.1); Doctrinal victory requires Faith pinned at 100 for 90s + final sermon channel (§18).

### 3.4 Dissent (0–100, per-district, aggregated per-cult for triggers)
- Gains: CRUSADE stance conversion +12 per tile taken in that district; successful enemy Deprogramming raid +15 (radius 3); follower starvation (income ≤ 0) +0.2/s everywhere; each Offering ritual +4 in host district.
- Decay: −0.15/s base; −0.5/s under Day of Atonement; Juice Cleanse zeroes one district.
- Effects: income tax (3.2); at district dissent >70, rivals may **Court Defection** (§15.3); cult-average dissent feeds Schism (§16).

### 3.5 Heat (0–100, global, public to players with Information doctrine T2+ or Visitors passive)
- Gains: CRUSADE stance +0.04/s while active; Offering +5; Midnight Festival +8; Pamphlet Bomb +10; Prime-Time Exposé +20 (the *attacker* gains it); Manifesto Drop → set to 100; declaring Prophecy +15; robbing couriers +2/robbery.
- Decay: −0.08/s base; Town Hall owned: extra −0.25/s; PR doctrine effects (§11).
- Thresholds: **60 = CPA harassment** (§17); **85 = CPA siege**; Heat also scales incoming Scandal damage (§15.2).

## 4. Conversion Resolution (the combat system)

Conversion is front-based, like the reference genre, with SIR flavor:
1. Player selects target region (click/drag on adjacent enemy/neutral tiles) → an **Intent** commits the current Stance's follower share to that **Front**.
2. Each tick, committed followers are distributed evenly across the Front's border tiles (max 60 effective per border tile — wide fronts beat deathballs).
3. Per contested tile: `pressure/sec = 8.0 × R0 × stance_mult × district_conv × S_mod(neutral only) × faith_mod × charisma_items / resistance`
   `resistance = (1 + defenders_per_tile/40) × district_retain × fort_mult × defender_faith_mod`
4. A tile flips when accumulated pressure ≥ 100. Typical mid-game tile: **1.5–4s**. Watchtower `fort_mult = 5` in radius.
5. **Attrition:** both sides lose followers in contested resolution at `0.6/sec per contested tile` (attacker) and `0.35/sec` (defender) — pushing costs manpower; turtling is cheaper.
6. **Ambient creep (the SIR signature):** every owned border tile passively applies `0.35 × R0 × district_conv` pressure to adjacent **neutral** tiles for free. Healthy cults ooze. (Prosperity Circle's Downline doubles tithe from creep-flipped tiles.)
7. **Apostate scar tissue:** a tile lost to Deprogramming or Scandal becomes Apostate for **90s** (immune to ALL conversion, generates nothing), then reverts to Neutral with S reduced −15. Fronts flow around scars; scorched-earth is a real defensive choice.

## 5. Stances (the Fervor system — DECISION: 3 stances, not a slider)

Global posture, switchable any time (2s changeover lockout):

| Stance | Committed to fronts | Conversion mult | Side effects |
|---|---|---|---|
| 🕯 **Tend the Flock** | 15% | 0.6× | Dissent decay 2×; home defense +20%; growth +10% |
| 📣 **Spread the Word** | 40% | 1.0× | Baseline |
| 🔥 **CRUSADE** | 75% | 1.5× | +Dissent per capture; +Heat/sec; home defense −25%; growth −20% |

Three stances read instantly on mobile, on stream, and in the kill-feed ("THE FINAL DAWN has entered CRUSADE"). Stance changes are public after 3s delay — telegraphed aggression creates the diplomacy meta.

---

# PART III — BUILD DATA (buildings, units, strikes, rituals, doctrine)

## 6. Buildings — Authoritative Table

All buildings: placed on owned tiles, 1 per tile, instant placement + build timer, refund 50% if cancelled, **destroyed (not captured)** when their tile flips. Max counts prevent spam.

| Building | Cost | Build time | HP* | Radius | Effect | Max |
|---|---|---|---|---|---|---|
| **Compound** | $15,000 (×1.35 each) | 20s | — | 8 | +25,000 follower cap; conversion anchor: +10% defense in radius; respawn point for agents | 8 |
| **Collection Plate** | $10,000 | 15s | — | — | Courier economy node (§3.2); +5% tithe from its district | 6 |
| **Watchtower** | $12,000 (×1.25) | 18s | — | 6 | fort_mult 5; reveals enemy agents/Vans in radius 10; pings raid warnings | 10 |
| **Broadcast Tower** | $250,000 | 45s | — | — | Enables Propaganda Strikes; one strike "charged" at a time; charge visible to anyone with vision of it | 2 |
| **Hotline Center** | $60,000 | 25s | — | 12 | 75% intercept of Pamphlet/Exposé payloads in radius; cannot stop Manifesto | 4 |
| **Print Shop** | $40,000 | 25s | — | 10 | Rituals −25% Faith cost & strike cooldowns −20% region-wide | 3 |
| **Garage** | $8,000 | 12s | — | — | Builds/repairs Recruitment Vans (max 3 Vans per Garage) | 3 |
| **Supplement Lab** *(Radiant only)* | $25,000 | 20s | — | 5 | Adjacent non-owned citizen tiles pay you $0.004/tile/sec ("they already buy the tea") | 4 |

*Buildings have no HP bar; they die with their tile, are disabled 45s by Sabotage, and Pamphlet Bombs disable buildings in radius for 30s.*

## 7. Units

Units are few, visible, and dramatic (this is a territory game, not a unit game):

| Unit | Source | Cost | Speed (tiles/s) | Job | Counter |
|---|---|---|---|---|---|
| **Tithe Courier** | auto, Plates | — | 1.5 (2× roads) | Carries route $; robbable | Enemy Vans |
| **Recruitment Van** | Garage | $30,000 | 2.0 (4× roads) | Mobile converter (acts as 40 followers of pressure at range 2); robs couriers; only unit allowed on Woods routes; screens/kills agents on contact | Watchtower vision + intercept Vans |
| **Agent** | Compound | $6,000 | 1.8, **invisible** outside Watchtower radius | Executes Deprogramming raids & Scandal evidence-gathering; dies on completion or detection-contact | Watchtowers |
| **Street Prophet** *(Dawn only)* | ability | — | 0 (placed) | 30s fear-pressure pylon | Kill the tile under it |
| **CPA units** | NPC | — | 1.2 | §17 | Lower your Heat |

## 8. Propaganda Strikes (Broadcast Tower required)

| Strike | Cost | Charge time | Radius | Effect | Counter |
|---|---|---|---|---|---|
| **Pamphlet Bomb** | $400,000 | 30s | 8 | Instant +35 dissent in radius; buildings disabled 30s; +25 conversion pressure applied to all tiles in radius for your adjacent fronts | Hotline (75%) |
| **Prime-Time Exposé** | $900,000 | 60s | 18 | Target cult: −25 Faith; tiles in radius: retention halved 45s; 5% of followers in radius apostatize | Hotline (75%); attacker +20 Heat |
| **Manifesto Drop** | $1,600,000 + Heat→100 | 90s | 6× scattered zones across one cult | Each zone = Pamphlet-level hit; un-interceptable | None. But you are now at Heat 100 with the CPA at your door, and every player was shown the launch warning 10s prior. |

All strikes have a 10s incoming-warning banner for the target (and 5s map-wide flash for Manifesto) — counterplay and clip-ability in one mechanic.

## 9. Rituals (Faith-powered, all archetypes)

| Ritual | Faith cost | Cooldown | Effect |
|---|---|---|---|
| **Sermon** | — (channel 8s, must be in Tend/Spread stance) | 30s | +12 Faith; +5% conversion for 20s |
| **Midnight Festival** | 25 | 120s | Radius-10 recruiting aura: 2× neutral conversion 30s; +8 Heat |
| **The Offering** | 10 + 200 followers | 90s | Instant +20 Faith; +4 dissent in host district; +5 Heat. (Cartoon poof + halo. Always.) |
| **Day of Atonement** | 20 | 180s | All districts: dissent decay 4× for 30s; your fronts frozen during it |

## 10. Doctrine Tree (BITE) — All 16 Nodes, Final

**Earning:** 1 point at each follower milestone: 2,500 / 5,000 / 10,000 / 18,000 / 30,000 / 50,000 / 80,000 → **7 points max**, 16 nodes, tiers gate (need 2 in a branch to take its T3, 3 to take T4). Irreversible (exception: Inner Light archetype). Picks are public to allies, hidden from rivals without Information T2.

### Behavior — "Discipline" (output & defense)
- **B1 Tithing Drill:** +10% tithe.
- **B2 Uniforms:** +15% home-tile defense; followers visually uniformed (free cosmetic flex).
- **B3 Curfews:** district dissent gains from your own actions −40%.
- **B4 TOTAL DEVOTION:** your followers never rout: defense attrition you suffer −50%; immune to Court Defection.

### Information — "The Truth" (vision & propaganda)
- **I1 Newsletter:** scout/vision radius +40%; see S-bands 2 tiles deeper.
- **I2 Counter-Intel:** your Heat/Dissent hidden from rivals; you see all rivals' Heat.
- **I3 Strong Signal:** Broadcast strikes radius +30%, cost −20%.
- **I4 MINISTRY OF TRUTH:** your strikes also drain −10 Faith; you see enemy stance changes instantly (no 3s delay).

### Thought — "The Word" (conversion power)
- **T1 Better Pamphlets:** R₀ +10%.
- **T2 Whisper Network:** ambient creep +60%.
- **T3 Forgiveness:** Apostate scar duration vs you 90s → 45s.
- **T4 THE IRRESISTIBLE WORD:** ignore 50% of district `retain` modifiers when attacking.

### Emotional — "The Embrace" (retention & anti-PvP)
- **E1 Welcome Basket:** love-bomb-type abilities −30% cost.
- **E2 Family Now:** Deprogramming raids against you −50% effect.
- **E3 Clean Image:** Heat gains −30%.
- **E4 UNSHAKEABLE:** the first mass-apostasy event against you each match (Scandal, Exposé, failed-Prophecy) is negated. One charge.

**Intended build identities:** B-heavy = fortress economies; I-heavy = info-warfare/strike platforms; T-heavy = blitz converters; E-heavy = scandal-proof late-gamers. 7 points across 4 branches forces 2-branch identities with a splash — build diversity by arithmetic.

---

# PART IV — ARCHETYPES: FULL KITS

Common frame: each archetype = coefficient row + passive + 2 actives + signature + scripted strategy guide (shipped in-game as 3 "Founding Tips"). **Charisma items** referenced in §4 are cosmetic-only; `charisma_items = 1.0` always (the variable exists so the community can never claim hidden P2W — it's literally hardcoded and shown in the public balance.json).

| Coefficient | Final Dawn | Radiant Path | Prosperity Circle | Visitors' Fellowship |
|---|---|---|---|---|
| R₀ (conversion) | 1.30 | 0.80 | 0.60 | 1.00 |
| Retention (defense) | 0.80 | 1.50 | 0.90 | 1.00 |
| Income | 0.80 | 1.10 | 1.60 | 0.90 |
| Heat gain | 1.40 | 0.70 | 1.00 | 1.10 |
| Growth | 1.00 | 1.10 | 0.90 | 1.00 |

### 11.1 ⏳ THE FINAL DAWN (Doomsday)
- **Passive — Fear Feeds Us:** +2% conversion per active Front anywhere on the map (yours or not), cap +25%. UI: a little fear-o-meter candle.
- **Active 1 — Street Prophet:** $12,000, CD 45s. Place pylon: 40-follower-equivalent pressure, radius 2, 30s.
- **Active 2 — Stockpile Sermon:** 30 Faith, CD 90s. One contested district: your pressure ×3 for 12s; +10 dissent there after.
- **SIGNATURE — Prophecy Countdown:** once/match, free, must own ≥1,500 tiles. Declares publicly; 3:00 timer broadcast to ALL players with your territory % snapshot. Resolve: territory% > snapshot → all High-S neutral/enemy tiles within 4 of your borders flip instantly (cap: 12% of map) +30 Faith. Territory% ≤ snapshot → −40 Faith, 15% follower apostasy, your tiles' dissent +20. (+15 Heat on declaration either way.)
- **Founding Tips:** (1) Spawn near College; you blitz, they churn — keep moving. (2) Declare Prophecy while a war you're not in distracts the lobby. (3) Your retention is paper: never CRUSADE with an exposed home.
- **Beaten by:** stalling out the Countdown, dogpiles during the timer, Scandal (Dawn runs hot: 1.4× Heat).

### 11.2 🌿 THE RADIANT PATH (Wellness)
- **Passive — The Glow:** owned tiles gain +0.4% retention/sec held, cap +80% at 200s. Resets on flip.
- **Active 1 — Juice Cleanse:** $20,000, CD 60s. Zero one district's dissent.
- **Active 2 — Free Retreat Weekend:** $35,000 (E1 discounts), CD 90s. Radius-8 love-bomb: 2.5× conversion vs neutral, 1.5× vs enemy, 25s, **zero Heat**.
- **SIGNATURE — Supplement Empire:** Supplement Lab building (§6) + Labs make adjacent enemy tiles' dissent decay 50% slower (the tea is mildly habit-forming).
- **Founding Tips:** (1) Old Town is your fortress — Glow + 1.6 retain is near-unflippable. (2) You win games you don't fight: expand into neutrals, let aggressors bleed each other. (3) Your counter is early aggression — buy the Watchtower before the second Plate.
- **Beaten by:** pre-Glow tempo pushes, Scandal vs Labs, Economic race.

### 11.3 💼 THE PROSPERITY CIRCLE (MLM)
- **Passive — Downline:** ambient-creep-flipped tiles pay 2× tithe forever (tagged with a tiny 💼).
- **Active 1 — Seminar Blitz:** $60,000, CD 75s. +2,500 followers instantly (cap-respecting). The only money→manpower conversion in the game.
- **Active 2 — Hostile Acquisition:** $300,000, CD 240s. Instantly buy one neutral landmark OR one neutral high-income district sub-region (≤120 tiles).
- **SIGNATURE — The Ledger:** Economic Victory eligibility (§18): bank target $3M (M map), but banked-total is a public leaderboard line. Incoming Scandal vs the Circle: +50% apostasy.
- **Founding Tips:** (1) Spawn touching Downtown's approach; deny it to everyone or own it. (2) Creep is your conversion: pick borders, not fights. (3) Keep Heat at zero — a clean Circle laughs at Scandal; a dirty one dies to it.
- **Beaten by:** Scandal, raids on its thin defense, denying Downtown, simply killing it before minute 8.

### 11.4 🛸 THE VISITORS' FELLOWSHIP (UFO)
- **Passive — Stargazers:** vision ×2; sees all rivals' Heat and per-district Dissent bands without doctrine.
- **Active 1 — Crop Circle:** $15,000, CD 60s. Any visible neutral district: +30 S for 60s, **for everyone** (bait/gift/trap).
- **Active 2 — Radio Static:** 20 Faith, CD 90s. One enemy Broadcast Tower + Hotlines in radius 12: offline 20s.
- **SIGNATURE — Saucer Landing:** CD 150s, $25,000. Found a satellite chapel (acts as 1-tile owned territory + mini-Compound, +2,000 cap) on ANY visible tile incl. across Woods/Lake. Satellites have 0.6× retention until connected to your main body.
- **Founding Tips:** (1) Your home is wherever the saucer parks — losing the homeland is an inconvenience. (2) Snipe the Radio Tower; your kit loves landmarks. (3) Drop Crop Circles on districts two rivals both want. Watch.
- **Beaten by:** killing satellites in their fragile window, Watchtower webs, disciplined boring map control.

### 11.5 Season drops (specced at season-minus-one; design intents locked)
**S1 🗳 THE MOVEMENT (Political):** lobbying truces, border coercion, allied-tithe skim; Teams-mode terror. **S2 🔮 THE INNER LIGHT (New Age):** mid-match doctrine respec (1×/match), all coefficients 1.0. **S3 📈 ASCEND! (LGAT):** seminar burst income, permanent 0.3%/s follower churn, leavers pay "exit fees."

---

# PART V — CONFLICT, DIPLOMACY & DRAMA SYSTEMS (full spec)

## 12. Landmarks (final effects)

| Landmark | Effect while owned | Capture notes |
|---|---|---|
| AM Radio Tower | Strikes −30% cost; Pamphlet radius map-wide targeting (still local radius effect) | 0.5× capture speed; flips drop owner's charged strike |
| The Old Megachurch | +0.15 Faith/s; **required channel site for Doctrinal victory** | Holding it paints a target; intended |
| Town Hall | −0.25 Heat/s; CPA ignores you below Heat 75 | Adjacent to Downtown by mapgen |
| County Fairground | Festivals 50% Faith cost; Festival radius +50% | |
| Water Tower | +50% vision radius for your whole cult; sigil cosmetic slot | The flex landmark |

## 13. Deprogramming Raids
- Commission an **Agent** ($6,000) at any Compound; right-click an enemy district → Agent pathfinds invisibly (visible inside enemy Watchtower radius-10; on detection, 3s to kill via any owned-tile adjacency or Van contact).
- On arrival: 6s channel → **converts a radius-3 blob of enemy Believer tiles to Apostate** (avg ~28 tiles), +15 dissent in district, Agent expires.
- Limits: max 2 Agents alive per player; raids on the same district have a 60s diminishing-returns lockout (−50% effect).
- Intent: cheap, constant, skill-expressive harassment; the answer to turtles; countered by Watchtower webs and E2.

## 14. Scouting & Vision
- Base vision: owned tiles + radius 6. Fog beyond shows terrain + district colors, not ownership changes.
- **Rumor Heat** (pre-game + fog): a soft heatmap of where large cults are (updated every 30s, 20-tile blur) — you always roughly know where the monsters live; you never exactly know their lines.
- Agents and Vans extend vision radius 4 around themselves. Water Tower/I1 modify per table.

## 15. The PvP Trio

### 15.1 (raids — §13)

### 15.2 Scandal Exposure — final ruleset *(open question #1 RESOLVED: visible at 50%)*
- An Agent idling adjacent to (or inside) a rival's **First Compound** district gathers Evidence at 1.2%/s (0.6%/s if any Watchtower sees the district borders — surveillance slows snooping even without a catch).
- At **50% Evidence the target is notified**: *"Someone is asking questions about you."* (No attacker identity.) Counterplay window: hunt agents, lower Heat, buy E4 insurance, or preemptively strike suspects. This converts an assassination into an arc — better drama, better fairness, same threat.
- At 100%: attacker holds a **Publish** button (no expiry). On publish, map-wide headline banner + horn: target loses `clamp(Heat × 0.6, 5, 35)%` of followers as instant apostasy distributed over highest-dissent districts; target −25 Faith; vs Prosperity Circle ×1.5. One publish per attacker per victim per match. Attacker gains +10 Heat (mud sticks to the thrower).

### 15.3 Court Defection
- Any enemy district at dissent >70: pay `$15 × tiles` to flip it to **Neutral** instantly (not to you — you're funding their walkout, not buying members; the distinction keeps it from being a strictly-better attack). 120s cooldown per district.

## 16. Alliances, Betrayal, Schism — final ruleset
- **Alliance:** propose/accept; 10:00 duration, renewable in last 2:00; allies cannot convert each other, share vision (toggleable), see each other's stances/Heat, may transit Vans/Agents through each other.
- **Ecumenical Pact (upgrade, both consent):** both pick 1 shared owned doctrine node. Dissolves with the alliance.
- **Betrayal:** attacking an ally instantly: map-wide **JUDAS** banner; permanent match-long traitor icon; 30s −50% retention everywhere; permanent −15% conversion vs the victim; victim gets 60s of free vision of you. Betrayal is expensive, famous, and absolutely worth it at the right moment — by design.
- **SCHISM trigger:** `territory ≥ 35% of populated tiles` AND `cult-avg dissent ≥ 40`, both sustained 30s (a visible "Schism Risk" gauge fills during this — no surprises). On trigger: the contiguous highest-dissent region equal to 25% of your tiles secedes as the **Splinter Sect**: new cult, your palette desaturated + inverted sigil, seeded with proportional followers, dissent zeroed (the righteous always feel great at first).
- **Schism rebirth — open question #3 RESOLVED:** the Splinter is offered to the **most-recently-eliminated human** in the lobby (10s accept window, then next-most-recent, then AI). Recency beats "strongest" — it's fairer-feeling, spreads the experience, and the freshest ghost is the most likely to still be watching.
- Splinter Sects cannot ally their parent for 3:00 (no schism-laundering).

## 17. The Concerned Parents Association (NPC faction)
- Permanent neutral presence: a minivan depot at Town Hall's district (uncapturable tile).
- **Heat ≥ 60 (Harassment):** spawns 2 Picket Lines (static anti-conversion auras placed on your busiest Front, −30% your pressure radius 4, 45s lifespan, killable like a tile) + 1 News Van that shadows your largest Front giving all players vision of it. Respawns every 60s while Heat ≥ 60.
- **Heat ≥ 85 (Siege):** adds a **Deprogrammer Bus**: performs a §13-equivalent raid on your highest-dissent district every 45s until Heat < 85.
- CPA targets only the single highest-Heat player at any time (ties: larger cult). It is a lightning rod, not a war: total CPA pressure is tuned to slow, never to kill — the kill is what the other players do while you're swatting minivans.

---

# PART VI — MATCH STRUCTURE, MODES, RANKED

## 18. Match State Machine
`QUEUE → LOBBY(15s fill, AI backfill at T-0) → FOUNDING(60–90s spawn pick; pick = click any legal spawn tile; unspawned at 0:00 are auto-placed) → LIVE(phases are emergent, not scripted) → END(victory check each tick) → RECAP(card gen ≤3s) → REQUEUE`

**Victory checks (per tick, in priority order):** (1) Domination % reached → win. (2) One cult remaining → win. (3) [Revelation mode] Doctrinal: Faith=100 held 90s, then 20s uninterrupted channel at owned Megachurch → win. (4) [Revelation] Economic: Ledger ≥ target ($1.2M S / $3M M / $6M L) → win. (5) Timer expiry → §1 tiebreaks.

**Elimination:** 0 owned tiles AND 0 satellites = eliminated → **Spectator+**: free-cam, drama-feed, **Faith Betting** (wager cosmetic-shard pittances on the winner; pays 2× shards; pure engagement loop, zero real money anywhere near it), schism-rebirth eligibility (§16).

## 19. Modes

| Mode | Map | Win conds | Notes |
|---|---|---|---|
| Casual FFA (default) | S/M | Domination, last-standing | AI backfill; ≤20s queue guarantee |
| Teams 2–7 / Duos / Trios / Squads | M/L | Team domination (summed) | Clan-tag auto-team |
| Ranked 1v1 | S-mirror | 80% domination | Glicko-2 |
| Ranked FFA (16) | M | Placement points | Glicko-2 on placement |
| Revelation (weekend rotation) | M | ALL FOUR paths | Balance sandbox for alt victories |
| Custom | any | host-set | Up to 100; spectate links; the streamer product |

## 20. Ranked System
- **Rating:** Glicko-2 (μ=1500, φ=350, σ=0.06). 1v1: standard. Ranked FFA: pairwise decomposition by final placement (each match = 15 implicit pairwise results, weighted 0.4).
- **Tiers:** Acolyte → Deacon → Minister → Cardinal → Oracle → **PROPHET (top 500, public profiles + unique territory shimmer)**. Seasonal soft reset: `new = 1500 + (old − 1500) × 0.5`.
- **Integrity:** ranked requires account level 5; archetype is locked at queue-pop (no counterpick lobbies); map-mirror in 1v1; 1 archetype ban per player in Prophet-tier 1v1 *(open question #5 RESOLVED: bans only at the top tier, where the meta is sharpest and the audience is watching)*.

## 21. Bots & AI
Three tiers, all running the same sim via the Intent API (zero cheating by construction; bots get no fog exemptions):
- **Drifters** (backfill): random-walk expansion, never ally, fold under pressure. Named from a 500-name silly generator ("Gary's Pond Truthers").
- **Sects** (standard): utility-AI — expand toward high-S neutrals, buy Compound→Plate→Watchtower script with noise, accept alliances at <40% relative strength, betray never. One archetype each, plays its gimmick naively.
- **Established Churches** (the "Nations" analog): map-fixture majors with pre-seeded territory and proper nouns ("The First Church of the Open Wallet," "Tabernacle of the Reasonable Price"). Full behavior tree: doctrine builds, stance discipline, grudges (attack their last attacker), Prophecy usage, even Scandal publishing. Difficulty knob = action latency + aggression priors, never stat cheats.
- Splinter Sects unclaimed by humans run Sect-tier AI with a +grudge against the parent.

---

# PART VII — META, PROGRESSION & SOCIAL

## 22. Account Progression
- **XP per match:** `40 + 2×minutes_survived + placement_bonus(1st:120, top25%:60, top50%:30) + first_win_of_day:100`.
- **Levels:** XP to next = `200 × level^1.25` (level 5 ≈ 6 matches → ranked unlock; level 20 ≈ 80 matches).
- **Relics (earned soft currency):** 10–30/match by participation + Daily Prophecy + level-ups. Spends: archetype unlocks (1,200 Relics — about a week of casual play; the *free rotation* of 2 archetypes means nobody is ever locked out of asymmetry), basic cosmetic tier. **Relics are never sold for money** — the earn-economy and the spend-economy never touch, by policy and by code.
- **Shards (cosmetic dust):** from duplicates-prevention (we sell direct, so shards come from Spectator+ betting, events). Buys recolor variants only.

## 23. Daily Prophecy
One global modifier-challenge per day ("Win holding zero Watchtowers," "Fulfill a Prophecy Countdown," "Earn $500k as any archetype without entering CRUSADE"). Reward: 30 Relics + streak cosmetic at 7/30/100 days. Same prophecy for the whole world → daily shared discourse, the Wordle effect.

## 24. Congregations (clans)
- ≤50 members, tag (2–4 chars, moderated), shared banner cosmetic, clan chat, auto-team in Teams modes.
- **Congregation Score:** weekly sum of members' best-10 ranked results → public ladder.
- **HOLY WARS (weekly, Sat/Sun):** registered 5v5 clan battles on M maps, best-of-1 brackets, seasonal trophy + exclusive banner pattern. Zero cash from us at launch; the community cash-tournament rail (per the OpenFront Masters precedent) gets official tooling (brackets, spectate, replays) in EA — esports as community-led live-ops.

## 25. Social & Virality Systems (build spec)
1. **Recap Card (P5, T1):** server renders (from the deterministic replay) a 1080×1350 PNG + 10s territory-timelapse MP4/GIF: cult name+sigil, archetype, peak followers, $ earned, doctrine build icons, auto-headline from a 200-template grammar keyed to match events (betrayals > prophecies > scandals > schisms > comebacks > economy in priority). One-tap share/download; URL + lobby-invite QR baked into the frame. **Frames are sellable cosmetics** — purchases that advertise.
2. **Invite links:** `flock.io/j/{lobbyId}` — joins friend's next match, spawns ally-flagged (adjacent legal spawns highlighted). K-factor instrumented from day 0.
3. **Lobby broadcast moments:** Prophecy countdown (map-wide timer+heartbeat), Scandal headline (freeze-frame banner 2.5s), JUDAS reveal, Manifesto warning, Schism eruption. Target: ≥2 shared-screen moments per match by telemetry.
4. **Clip button:** client ring-buffers last 30s of replay turns → renders shareable MP4 client-side. Cheap because lockstep replays are just intent logs.
5. **Embeddable live-map iframe** (read-only, 30s delay vs sniping) — Discord/stream overlay (T3, post-EA).

---

# PART VIII — UX / UI (screen-by-screen)

## 26. FTUE (first session, target <60s to gameplay)
`flock.io → [PLAY] (one button, huge) → name + color picker (archetype: first-timers are auto-dealt Final Dawn — the most legible kit) → drop into a Casual S-map with 70% Drifter bots → 4-step contextual overlay (click to expand · stance buttons · build a Compound · your first $) → play → RECAP → "Save your legend?" account prompt (email/Google/Discord/guest-continue).` No account wall before fun. Ever.

## 27. In-Match HUD (desktop)
- **Top bar:** Followers (with cap + growth arrow) · $ (with /sec) · Faith dial · Heat gauge (flame icon, pulses ≥50) · match timer + leader %.
- **Left rail:** Stance trio (hotkeys 1/2/3) · Rituals (Q/W/E/R) · Archetype actives (D/F) · Signature (G, dramatic button treatment).
- **Bottom:** build palette (B + radial) · doctrine button (badge when point available) · minimap (territory colors + rumor heat + drama pings).
- **Right rail:** Diplomacy panel (player list sorted by border-adjacency: ally/chat/mark) · drama feed (the kill-feed: captures, betrayals, scandals, prophecies).
- **Mobile-web:** same layout, rails collapse to edge-swipes; stances are persistent bottom-center thumb buttons; pinch-zoom map. Touch target min 44px.

## 28. Other screens
**Lobby/queue:** archetype select carousel (kit summary + 3 Founding Tips + winrate-this-patch displayed openly — transparency as trust), mode tabs, party bar, Daily Prophecy ticker. **Doctrine UI:** 4-column BITE grid, picked nodes glow, hover = exact numbers (we show real numbers everywhere; this game's audience respects math). **Recap:** card center-stage, share row, XP/Relic ticker, REQUEUE button largest element. **Profile:** ranked tier, archetype winrates, headline museum (your best recap cards — a self-curated brag shelf). **Settings:** colorblind patterns (always-on by default), reduced motion, mute-all-chat default ON in public FFA, keybinds, region.

## 29. Notification & readability rules
Max 1 modal ever (game-end). Everything else is feed/banner/ping. Enemy action readability SLA: any aggressive act against you produces a ping within 250ms (raid spotted, front opened, strike warning, evidence-50% notice). If a player ever loses to something they *couldn't have seen*, that's a design bug, filed as such.

---

# PART IX — ART & AUDIO (production spec)

## 30. Art
- **Resolution grammar:** map tiles 8×8 px (rendered 2× minimum); units 16×16; prophets/landmarks 24×24; UI vector (the contrast between chunky world and crisp UI is the look).
- **Palette:** town base = 12-color warm pastel ramp; each player slot = 1 of 24 high-contrast territory colors × 4 archetype patterns (Dawn radiating-crack, Radiant gradient-bloom, Circle pinstripe, Visitors starfield) = colorblind-safe by pattern redundancy, stream-readable at 360p (test gate: a 360p screenshot must be parseable).
- **Animation list (MVP, exhaustive):** tile-flip sparkle (per archetype flavor), courier walk, Van drive, Agent skulk + poof, prophet idle ×4 archetypes, strike launch/land, Festival fireworks, Offering poof+halo, Schism crack, JUDAS stamp, CPA minivan + picket bob, victory rapture sequence (everyone's followers do a little dance; even your enemies'). ≈40 sprite animations total — one contract pixel artist, ~3 months.
- **Hard tone guardrails (binding for all content incl. cosmetics & events):** fictional deities/doctrines only; no real religions, texts, or living movements; no real-tragedy references; violence never depicted — conversion is hearts/sparkles/pamphlets/spirals; The Offering is always cartoon-poof. Player cult names pass filter → render as default ("Sect #4412") in ranked until human-review clears custom names.

## 31. Audio
- Music: lobby = folksy banjo/choir; in-match adaptive layer system — base town theme + 1 instrument stem per archetype present (Dawn=organ, Radiant=pan flute, Circle=cash-register percussion, Visitors=theremin). Mix sidechains to drama feed.
- SFX comedy channel: tithe *cha-ching* (the most-heard sound in the game — 5 purchasable packs), prophecy heartbeat (map-wide), scandal news-sting, minivan door slam, schism crack+gasp.
- All audio events ≤ −14 LUFS, drama stingers ducked under voice for streamers (OBS-friendly mix toggle in settings).

---

# PART X — TECHNICAL SPECIFICATION

## 32. Architecture
TypeScript end-to-end. Client: Vite + PixiJS (WebGL2, fallback canvas). Server: Node 20, master–worker (1 match = 1 worker, pinned). Shared sim package `@flock/sim` runs identically both sides (fixed-point Q16.16, seeded xoshiro RNG in the turn stream, zero floats, zero Date/Math.random in sim scope — lint-enforced).

## 33. Netcode & protocol
- **Lockstep:** clients send `Intent` over WSS; server validates, bundles into `Turn{n, intents[], seedSlice}` broadcast at 100ms cadence; client prediction renders immediately, reconciles on turn arrival; `StateHash` every 50 turns (xxhash64 of sim state) — mismatch → client resyncs from server snapshot (snapshot every 600 turns).
- **Intent enum (complete):** `SPAWN, SET_STANCE, OPEN_FRONT{tiles[]}, CLOSE_FRONT, BUILD{type,tile}, CANCEL_BUILD, RITUAL{id}, ABILITY{id,target?}, SIGNATURE{payload}, STRIKE{type,target}, AGENT_DISPATCH{district,mission}, VAN_MOVE{path}, DOCTRINE_PICK{node}, ALLY_PROPOSE/ACCEPT/BREAK{player}, PACT_PICK{node}, COURT_DEFECTION{district}, PUBLISH_SCANDAL{player}, CHAT{channel,msg}, EMOTE{id}, SURRENDER`.
- **Rate limits (server-enforced):** 20 intents/sec/client, 1 chat/2s; anomalies flagged to telemetry.
- Bandwidth: intents-only ≈ 2–6 KB/s/client even at 100 players. A $20 VPS hosts dozens of matches; unit economics work pre-revenue.

## 34. Services & data
- **Lobby Director** (matchmaking, AI backfill, region routing) · **Match Workers** · **Persistence** (Postgres: accounts, ranked, congregations, cosmetics entitlements; Redis: queues, sessions) · **Replay Store** (S3: gzipped intent logs — a 20-min 100-player match ≈ 1–3 MB) · **Recap Renderer** (headless worker replays the log → PNG/MP4) · **Telemetry** (event firehose → ClickHouse).
- **Telemetry event taxonomy (launch set):** `match_start/end, player_spawn/eliminate, tile_delta(sampled 10s), stance_change, alliance/betrayal, prophecy_declared/resolved, scandal_evidence_50/published, schism, strike_fired/intercepted, purchase, recap_shared, invite_created/converted, queue_time, fps_sample, desync`. Every balance-lever in this doc maps to ≥1 event.
- **Anti-cheat:** server authority (map-hacks impossible by construction — fog is server-side filtered per client), intent-rate anomaly detection, replay-audited reports, ranked shadow-pool for flagged accounts.

## 35. Steam wrap & licensing
Electron + Steamworks.js (achievements: 30 at EA — "JUDAS" for first betrayal is mandatory; cloud settings; rich presence "Converting Mundane Falls, 34%"). One backend, one matchmaking pool, web+Steam crossplay. Proton tested from first wrapped build. **AGPL firewall:** OpenFront repo is architecture reference only — zero code reuse, contributor attestation, legal review pre-EA.

---

# PART XI — BUSINESS SYSTEMS (final)

## 36. Store & Pricing (launch catalog)
**Iron law (P4): nothing purchasable affects match outcome.** No loot boxes, ever; direct purchase only. Store tagline: *"Real cults take your money and give you nothing. We take your money and give you hats."*

| SKU class | Examples (launch count) | Price |
|---|---|---|
| Territory patterns/palettes | 12 patterns, 8 premium palettes | $2.99–4.99 |
| Compound/prophet skins | 8 sets (e.g., "Roadside Chapel," "Geodesic Dome," "Suspiciously Nice Yurt") | $4.99–7.99 |
| Tithe-sound packs | 5 (chant, slot machine, kazoo, ASMR whisper "thank you", cathedral bell) | $1.99 |
| Recap Card frames | 10 (these appear in shared marketing assets — purchases that advertise) | $2.99 |
| Water-Tower sigils, JUDAS banner styles, victory-rapture effects | 6 / 4 / 4 | $2.99–5.99 |
| **Season Pass "The Testament"** | 10 weeks, 50 tiers, free+premium tracks; seasonal archetype always on the FREE track | $9.99 |
| **Patron Saint supporter** | name color, halo, Discord role, balance-poll vote, early custom-lobby features | $2.99/6.99/14.99 mo |
| **Steam Founders' bundle** | game (free) + "Founders' Vestments" set + OST | $9.99 |

**Revenue sanity check (directional):** 300k MAU (⅓ of comp), 2.5% payer, $11 ARPPU/mo → ~$80k/mo + Steam spikes. Server cost at that scale (lockstep economics, §33): <$3k/mo. The model clears at one-third of the proven comparable's audience.

## 37. Season 1 — "Season of the Serpent" (content plan, EA launch)
Theme: a traveling snake-oil revival arrives in Mundane Falls. Pass cosmetics: serpent territory pattern, revival-tent Compound, snake-oil tithe sound. Free track: The Movement archetype (week 3), 2 patterns, frames. Events: wk1 launch Holy War, wk5 "The Great Schism" (double-schism weekend modifier), wk9 community cash tournament (official bracket tooling debut). Mid-season balance patch locked to wk5, in-voice patch notes ("The town council has asked The Final Dawn to please stop").

---

# PART XII — PRODUCTION PLAN

## 38. Team
3 FTE core: **Eng A** (sim/netcode — owns `@flock/sim`, protocol, workers), **Eng B** (client/PixiJS, Electron, backend services, tools), **Design/Product** (this document's owner; balance, telemetry, live-ops, marketing). +Contract pixel artist (mo. 2–5, the §30 animation list), +contract composer/SFX (mo. 5–6), +legal review (pre-EA, fixed fee).

## 39. Milestone backlog (build order, gates carried from v1)
**M0 — Prototype (mo. 0–3).** `@flock/sim` core (tiles, fronts, stances, followers/$, conversion math §4), lockstep pipeline + prediction + hashing, PixiJS map renderer, S-map mapgen, Final Dawn complete kit, Drifter bots, 8–20 player matches, ugly-but-honest UI. **Gate:** >50% "one more game" in playtests; 10–20-min matches; conversion *feels* distinct from war.

**M1 — Browser MVP (mo. 3–8).** Remaining 3 archetypes; doctrine tree; buildings/units/strikes/rituals complete per Part III; alliances/betrayal; raids + Scandal + Court Defection; Heat + CPA harassment tier; Recap Card + invite links; accounts, Relics, Daily Prophecy; Congregations v1; ranked-lite (1v1); moderation pipeline; Sect bots; M-maps. **Gate:** 5k+ organic MAU, D1>15%, recap share >2%.

**M2 — Wishlist engine (mo. 6–10, parallel).** Steam page, trailer (built from recap-timelapse tech), creator program (20 keys: cult-game YT, .io strategy, betrayal streamers), weekly Congregation Night 100-player dev lobbies. **Gate:** 5–7k wishlists before booking Next Fest.

**M3 — Steam EA (mo. 9–14).** Electron wrap + Steamworks; Schism + rebirth; Revelation mode (all 4 victory paths); Established Church bots; L-maps; Spectator+ & caster tools & clip button; Season 1 + store; CPA siege tier; Glicko-2 full ranked. **Gate:** Next Fest >1.8k wishlists added (aim 13k+); demo sentiment ≥ Very Positive.

**M4 — Live-ops (mo. 14+).** Seasonal archetypes (S1–S3 per §11.5), Holy Wars, tournament tooling, embeddable live map, mobile-web polish pass, localization (EN→ES/PT-BR/DE/FR first; .io traffic is global).

## 40. Test plan
- **Sim:** property-based tests on `@flock/sim` (determinism: same seed+intents = same hash across Node/Chrome/Firefox — the CI gate that protects everything); golden-replay regression suite (every bug that ships becomes a replay test).
- **Balance:** nightly bot-league — 1,000 headless AI matches across archetype matchups/maps; win-rate drift >±5% from target pages the designer before players ever feel it.
- **Load:** synthetic 100-client worker soak (intent fuzzing at rate limits); desync rate SLA <0.1% of matches.
- **Playtest cadence:** weekly internal from M0 wk4; closed Discord alpha from M1 wk8; public from MVP.

## 41. KPI dashboard (weekly review, unchanged targets)
Acquisition: new/day by source, K-factor (≥0.25 MVP / 0.4 EA), recap share ≥4%. Engagement: D1 ≥25%, D7 ≥10%, matches/session ≥3, queue ≤20s. Health: every archetype 45–55% per MMR band; betrayal in 8–15% of matches (P3 is healthy); schism in 3–8%; desync <0.1%. Revenue: payer ≥2%, ARPPU ~$11, pass attach ≥30% of payers.

## 42. Risk register (deltas from v1)
All v1 risks carry. New: **Scandal-at-50%-notify under-tuned** (if evidence never completes vs good players, the system is dead content → lever: gather rate & notify threshold are both ITVs); **3-stance system too coarse for Prophet-tier** (watch top-MMR stance-change frequency; sub-stance fervor % is a reserved ranked-only feature flag); **Recap renderer cost at scale** (mitigate: render on share-tap, not on match-end, beyond PNG).

## 43. Decisions log (every v1 open question, closed)
1. **Scandal visibility → visible to target at 50% evidence** (assassination → arc). 2. **Doctrinal victory → Revelation-mode only until two full seasons of telemetry; ranked candidacy reviewed S3.** 3. **Schism rebirth → most-recently-eliminated human, 10s window, cascade to AI.** 4. **Fervor → three named stances** (sub-stance % reserved as top-tier flag). 5. **Archetype bans → Prophet-tier 1v1 only.**

---

## Appendix A — balance.json (excerpt; the single source of tuning truth)
See [`balance.json`](./balance.json) at the repo root — kept as a standalone file so it is hot-patchable without client updates.

## Appendix B — Recap headline grammar (sample of 200-template set)
Priority: betrayal > prophecy > scandal > schism > comeback > economy > default. Examples: *"Betrayed {victim} at {time}. Felt nothing."* · *"Prophecy fulfilled with {seconds} seconds to spare."* · *"Published {victim}'s scandal. {n} followers walked."* · *"Survived a schism AND the Concerned Parents."* · *"Earned ${n} and converted nobody's respect."* · default: *"{n} souls. One town. No regrets."*

---

*FLOCK Master Design Document v2.0 — "The Complete Testament." Every system specified, every number set, every question closed. Status: READY TO BUILD. First commit: `@flock/sim`. May your tithes compound and your schisms be somebody else's.*
