# FLOCK: The Master Strategy Guide & Doctrine Compendium

> *"You do not win this war by converting dirt. You win by taking the institutions."*

---

## 1. Executive Strategic Overview

*Flock* is an asymmetric competitive grand-tactical RTS where the primary axis of victory is **Institutional & Building Hegemony**. While players convert tiles along organic frontlines, generic territory is merely the substrate; the real strategic battleground is **the race to capture, contest, and fortify the town's keystone buildings, commercial hubs, and world landmarks**.

Matches run between 8 and 20 minutes across maps ranging from Small (8–16 players) to Large (50–100+ players). Victory is achieved through one of five win conditions:

| Victory Path | Condition / Trigger | Building Dependencies | Counterplay |
| :--- | :--- | :--- | :--- |
| **Domination** | Control 72% (S/M) or 80% (L) of populated citizen tiles. | High School (growth) + Elementary (creep) | Watchtower walls, Broadcast strikes on frontlines. |
| **Last Standing** | Eliminate all rival compounds and satellite chapels. | Compounds + Watchtowers | Infiltrating Agents, Van courier-starvation. |
| **Doctrinal (Revelation)** | Pin Faith at 100 for 90s, then channel 20s at the Megachurch. | **The Old Megachurch** + Community Churches | Contest Megachurch, Exposé strikes, raid holy lots. |
| **Economic (Revelation)** | Bank target USD ($1.2M S / $3.0M M / $6.0M L) via The Ledger. | **Town Hall** + Downtown Banks/Commercial + Plates | Intercept couriers with Vans, raid commercial hubs. |
| **Timer Tiebreak** | Clock expires: Most Believers wins; tiebreak = Total $ then Faith. | Supermarket (defense) + Old Town Bastions | Force contested pushes on key civic buildings. |

---

## 2. The Cult Archetypes: Strategy, Asymmetry & Distinct Aesthetics

Every cult represents a radically different philosophy of power, complete with custom mathematical coefficients, unique active abilities, distinct pixel visual language (8px/16px), and bespoke institutional corruptions.

```
                          AGGRESSION / SPEED
                                  ▲
                                  │   THE FINAL DAWN
                                  │   (Apocalyptic Fervor, Blitz, College spawn)
                                  │   [Obsidian & Crimson Ember Aesthetic]
                                  │
    THE VISITORS' FELLOWSHIP      │
    (Cosmic Mystery, Satellites)  │
    [Cosmic Violet & Cyan Neon]   │
  ◄───────────────────────────────┼───────────────────────────────►
   INDIRECT / INFORMATION         │         ECONOMIC / SCALING
                                  │
                                  │   THE PROSPERITY CIRCLE
                                  │   (Corporate MLM, Downline, The Ledger)
                                  │   [Executive Navy & Brass Gold]
                                  │
                                  ▼   THE RADIANT PATH
                                  │   (Holistic Eco-Wellness, The Glow)
                                  │   [Sage Green & Lavender Bloom]
                           DEFENSE / RETENTION
```

### 2.1 The Final Dawn (Doomsday & Apocalyptic Fervor)
- **Fantasy:** Fire-and-brimstone doomsday prophets harvesting panic as the end of the world approaches.
- **Mathematical Profile:** $R_0 = 1.30$, Retention = $0.80$, Income = $0.80$, Heat Gain = $1.40$, Growth = $1.00$.
- **Passive (Fear Feeds Us):** $+2\%$ conversion speed per active front on the entire map (caps at $+25\%$). Dawn feeds off lobby chaos.
- **Key Abilities:**
  - *Street Prophet ($12k):* Places an immobile brazier pylon exerting 40-follower conversion pressure for 30s.
  - *Stockpile Sermon (30 Faith):* Triples conversion pressure in one contested district for 12s (+10 dissent).
- **Signature (Prophecy Countdown):** Once per match, declare a public 3-minute doomsday countdown. If territory increases over the snapshot, **every high-susceptibility neutral/enemy tile within 4 steps of your border flips instantly** (up to 12% of the map). If failed: $-40$ Faith, 15% follower apostasy, $+20$ dissent.
- **Institutional Corruption:**
  - Conquering a Church turns it into a *Doomsday Bunker* (acts as an explosive redoubt that apostatizes the lot if captured by enemies).
  - Conquering the High School turns it into a *Youth Militia Training Ground* (follower replenishment converted directly into front conversion momentum).
- **Visual Asset Language:**
  - *Territory Texture:* Radiating cracked-earth fault lines with molten crimson ember veins.
  - *Palette:* Obsidian Black (`#1a1110`), Sulfur Yellow (`#f3c334`), Molten Crimson (`#b82e1f`).
  - *Structures & Units:* Fortified compound with barbed-wire parapets, sandbags, and flaming braziers. Armored matte-black Recruitment Van with roof megaphone horns and hazard stripes. Red-hooded stealth Agents.

### 2.2 The Radiant Path (Holistic Wellness & Eco-Commune)
- **Fantasy:** A serene, soothing wellness movement promising longevity, pure living, and spiritual tranquility.
- **Mathematical Profile:** $R_0 = 0.80$, Retention = $1.50$, Income = $1.10$, Heat Gain = $0.70$, Growth = $1.10$.
- **Passive (The Glow):** Held tiles gain $+0.4\%$ retention per second held (capping at $+80\%$ at 200s). Old, established Radiant territory is practically immovable.
- **Key Abilities:**
  - *Juice Cleanse ($20k):* Instantly wipes all dissent in one district, immunizing you against Schisms.
  - *Free Retreat Weekend ($35k):* Radius-8 love-bomb ($2.5\times$ neutral conversion, $1.5\times$ enemy conversion for 25s) with **zero Heat generated**.
- **Signature (Supplement Empire):** Supplement Labs drain $\$0.004/\text{tile/sec}$ from adjacent enemy tiles and halve their dissent decay.
- **Institutional Corruption:**
  - Conquering a Supermarket turns it into an *Organic Co-Op* (doubles the district defense bonus to $+40\%$).
  - Conquering the High School turns it into a *Mindfulness Academy* (district dissent decay rate quadrupled).
- **Visual Asset Language:**
  - *Territory Texture:* Organic watercolor gradient bloom with delicate lavender and sage botanical speckles.
  - *Palette:* Sage Green (`#4b724b`), Crisp Linen (`#e8ecd8`), Floral Lavender (`#9678b6`), Warm Gold trim (`#d4af37`).
  - *Structures & Units:* Geodesic glass greenhouse compound with spiraling crystal spires and solar sail arrays. Aerodynamic pastel cream camper van with herbal drying racks. Robed barefoot stealth Agents.

### 2.3 The Prosperity Circle (Corporate MLM & Boardroom Televangelism)
- **Fantasy:** High-rolling corporate executives, motivational seminars, downline recruitment, and luxury salvation.
- **Mathematical Profile:** $R_0 = 0.60$, Retention = $0.90$, Income = $1.60$, Heat Gain = $1.00$, Growth = $0.90$.
- **Passive (Downline):** Every tile flipped via passive ambient creep generates **double tithe income forever** (marked with a corporate monogram).
- **Key Abilities:**
  - *Seminar Blitz ($60k):* Instantly buys 2,500 followers directly into your pool. The only money-to-manpower conversion in the game.
  - *Hostile Acquisition ($300k):* Instantly purchases a neutral landmark or up to 120 high-income district tiles with cash.
- **Signature (The Ledger):** Qualifies for the **Economic Victory** ($3M banked on Medium maps).
- **Institutional Corruption:**
  - Conquering a Bank turns it into a *Franchise Megacenter* (triples courier cash generation).
  - Conquering Town Hall turns it into the *Chamber of Commerce* (halves property and structure placement costs across the town).
- **Visual Asset Language:**
  - *Territory Texture:* Sharp executive pinstripes in gold and midnight navy.
  - *Palette:* Deep Navy Blue (`#0e1a2f`), Corporate Cyan (`#2980b9`), Polished Brass Gold (`#c5a059`).
  - *Structures & Units:* Brutalist corporate skyscraper-parody compound with rooftop helipad, tinted glass, and digital neon stock ticker. Glossy black executive sprinter van with tinted glass and gold trim. Suit-and-tie briefcase Agents.

### 2.4 The Visitors' Fellowship (Cosmic Mystery & UFO Star Cult)
- **Fantasy:** Retro-futuristic stargazers awaiting communion with celestial beings from the stars.
- **Mathematical Profile:** $R_0 = 1.00$, Retention = $1.00$, Income = $0.90$, Heat Gain = $1.10$, Growth = $1.00$.
- **Passive (Stargazers):** Double vision radius. Automatically sees all rivals' Heat, per-district Dissent, and active stance postures without requiring doctrine investment.
- **Key Abilities:**
  - *Crop Circle ($15k):* Spikes susceptibility ($+30 S$) on any visible neutral district for 60s for all players (masterful bait for proxy wars).
  - *Radio Static (20 Faith):* Jams an enemy Broadcast Tower for 20s, resetting charged strikes.
- **Signature (Saucer Landing - $25k):** Establishes satellite chapels across lakes, woods, or behind enemy lines. Acts as an independent Compound ($+2,000$ cap).
- **Institutional Corruption:**
  - Conquering the AM Radio Tower turns it into a *Deep Space Transmitter* (strikes land with zero telegraph delay).
  - Conquering the High School turns it into an *Astrophysics Laboratory* (reveals all hidden susceptibility bands in town).
- **Visual Asset Language:**
  - *Territory Texture:* Cosmic starfield with twinkling cyan nebula speckles on dark violet.
  - *Palette:* Electric Cyan (`#00f0ff`), Deep Cosmic Violet (`#2c0d48`), Chrome Silver (`#dcdcdc`).
  - *Structures & Units:* Retro-futurist observatory compound with a giant rotating parabolic radar dish and blinking telemetry beacons. Retro chrome camper van with rotating rooftop radar antenna. Silver space-jumpsuit Agents. Floating saucer satellite chapels.

---

## 3. The Building Takeover Hierarchy

Every map generates with a structured municipal layout. Holding the majority of tiles on a building's lot grants massive asymmetric empire bonuses.

```
                            TIER S: GAME-ALTERING KEYSTONES
        ┌──────────────────────────────┬──────────────────────────────┐
        │ Town Hall (Civic Seat / CPA) │ The Old Megachurch (Victory) │
        │ AM Radio Tower (Map Strikes) │ High School (Manpower Surge) │
        └──────────────────────────────┴──────────────────────────────┘
                                       ▲
                                       │
                         TIER A: HIGH-IMPACT CIVIC ENGINES
        ┌──────────────────────────────┬──────────────────────────────┐
        │ Sheriff Station (Heat Decay) │ Supermarket (Flock Defense)  │
        │ Elementary School (Creep)    │ Community Church (Faith)     │
        │ Bank / Commercial Hub (Cash) │ Gas Station (Highway Speed)  │
        └──────────────────────────────┴──────────────────────────────┘
                                       ▲
                                       │
                       TIER B & C: TACTICAL & ECONOMIC ENABLERS
        ┌──────────────────────────────┬──────────────────────────────┐
        │ Water Tower (Vision / Sigil) │ County Fairground (Festivals)│
        │ Grain Elevator & Silo (Cap)  │ Factory / Warehouse (Cover)  │
        │ Cinema & Diner (S-Boost)     │ Depot & Rail Crossing (Roads)│
        └──────────────────────────────┴──────────────────────────────┘
```

---

## 4. Active Civic Decrees: Balanced Mechanics & Cooldowns

Controlling the majority of a civic lot unlocks its **Active Municipal Decree**. In an average 12-minute match, these high-impact abilities are tuned to be cast **3 to 6 times maximum**, governed by strict opportunity costs and counters.

| Civic Institution | Active Decree | Resource Cost | Cooldown | Duration | Balance Mechanics & Hard Caps |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Sheriff's Station** | **Town Curfew** | $10,000 + 10 Heat | **90s** | **15s** | Freezes *enemy* conversion fronts inside this district only. Defender fronts continue converting. High 90s cooldown prevents perma-stalls. $+10$ Heat prevents abuse near CPA thresholds. |
| **High School** | **Pep Rally** | $12,000 | **100s** | Instant | Spawns $+1,200$ followers directly at the school parcel. **Capacity capped:** followers exceeding cap are converted into $\$0.50$ tithe cash instead of overflowing manpower. |
| **Elementary School** | **Parent-Teacher Night** | $6,000 | **60s** | **30s** | Doubles ambient creep conversion speed in this district for 30s. Purely an expansion tempo tool; no direct combat buff. |
| **Supermarket** | **Food Drive / Rationing** | $15,000 + 15 Faith | **120s** | **25s** | Grants $+35\%$ retention to this district. Long 2-minute cooldown leaves an 85-second vulnerability window where the lot can be dislodged. |
| **Community Church** | **Evangelical Revival** | 20 Faith | **75s** | Instant | Pulses $+15$ instant Faith and applies $+20$ pressure to all adjacent neutral tiles. Consumes $20\%$ of base cult Faith pool. |
| **Town Hall** | **Municipal Injunction** | $30,000 + 20 Heat | **150s** | **20s** | Freezes construction on any enemy player structures in adjacent districts. High price gates this to mid/late game. |
| **AM Radio Tower** | **Emergency Jam** | $40,000 | **120s** | **15s** | Jams rival broadcast strike charging and locks enemy stance changes for 15s. Telegraphed with map-wide radio static. |

---

## 5. Municipal Monopoly Combos: Synergies & Built-in Counters

Holding pairs of complementary institutions unlocks powerful systemic synergies. To prevent runaway snowballs, **monopolies immediately dissolve if either building loses majority control**, making single-tile perimeter snipes the ultimate counterplay.

```
                       MONOPOLY BALANCE MATRIX
 ┌───────────────────────────┬───────────────────────────┬───────────────────────────┐
 │ Monopoly Combo            │ The Power Spike           │ The Built-in Counter-Lever│
 ├───────────────────────────┼───────────────────────────┼───────────────────────────┤
 │ 1. The Town Machine       │ CPA threshold raised to   │ Town Hall & Sheriff are   │
 │    (Town Hall + Sheriff)  │ Heat 85; auto-arrests     │ separated by Downtown;    │
 │                           │ stealth agents in district│ holding both stretches    │
 │                           │                           │ perimeter thin.           │
 ├───────────────────────────┼───────────────────────────┼───────────────────────────┤
 │ 2. Indoctrination Pipe    │ +20% follower growth;     │ Schools are low-retention │
 │    (High School + Elem.)  │ creep flips grant +25     │ (0.6x); vulnerable to     │
 │                           │ instant followers         │ single-tile snipes.       │
 ├───────────────────────────┼───────────────────────────┼───────────────────────────┤
 │ 3. The Food & Fuel Cartel │ Friendly Vans +35% speed; │ Highway routes are easily │
 │    (Supermarket + Gas)    │ enemy building costs +30% │ ambushed by enemy Vans    │
 │                           │ in adjacent districts     │ with road-spikes.         │
 ├───────────────────────────┼───────────────────────────┼───────────────────────────┤
 │ 4. The Sacred Canopy      │ Faith floor locked at 50; │ Holy lots have 0.5x flip  │
 │    (Megachurch + Church)  │ Sermons grant +50% combat │ speed; massive target     │
 │                           │ conversion duration       │ for lobby-wide strikes.   │
 └───────────────────────────┴───────────────────────────┴───────────────────────────┘
```

---

## 6. Tactical Mechanics: Majority Control, Fortification & Stripping

```
       CONTESTED LOT                              FORTIFIED CIVIC ANCHOR
 ┌───────────┬───────────┐                     ┌───────────┬───────────┐
 │ Believer  │  Neutral  │                     │ Believer  │ Believer  │
 │  (You)    │   Tile    │                     │  (You)    │  (You)    │
 ├───────────┼───────────┤        ──►          ├───────────┼───────────┤
 │ Believer  │ Believer  │                     │ Believer  │Watchtower │
 │  (Rival)  │  (Rival)  │                     │  (You)    │ (Radius 6)│
 └───────────┴───────────┘                     └───────────┴───────────┘
 Control: RIVAL (2 vs 1)                       Control: YOU (Fortified 5x)
```

### 6.1 The Majority Rule & The Edge Snipe
- A player controls a civic building if and only if they **own strictly more Believer tiles of that lot than any single rival**, and hold at least one tile.
- *The Edge Snipe:* You do not need to convert all 6 tiles of a High School parcel to strip an enemy's bonus; converting **just one peripheral tile** ties the score and **instantly disables their passive and active decree**.

### 6.2 The Watchtower Anchor
Placing a player-built **Watchtower** ($12k) within 6 tiles of an owned building grants:
- A **$5\times$ defense multiplier** (`fort_mult = 5`) to all adjacent lot tiles.
- **Radius-10 stealth detection**, preventing invisible Agents from deprogramming or sabotaging the building.

### 6.3 The Universal Reset: Apostate Scars
When an institution is hit by a **Deprogramming Raid** ($6k) or a **Pamphlet Bomb** ($400k):
- All tiles of that lot convert into **Apostate Scar Tissue** for **90 seconds**.
- **All passive buffs, decrees, and monopolies tied to that building are completely shut off for 90 seconds.**
- The lot is immune to conversion and generates zero benefits for anyone until the timer expires, acting as the ultimate equalizer against heavily fortified positions.

---

## 7. Player Structures: Infrastructure Deployment

| Structure | Cost | Build Time | Placement Rule & Strategic Role |
| :--- | :---: | :---: | :--- |
| **Compound** | $15k ($\times 1.35$) | 20s | **The Anchor:** $+25k$ follower cap, raises Van cap by $+3$, respawn point for Agents. Place in central, well-defended hubs. Max 8. |
| **Watchtower** | $12k ($\times 1.25$) | 18s | **The Bastion:** $5\times$ defense in radius 6; reveals invisible Agents in radius 10. Place at district bottlenecks and adjacent to keystones. Max 10. |
| **Collection Plate** | $10k | 15s | **The Economy:** Spawns Couriers every 20s carrying up to $\$1,200$ across roads. Must be placed in pairs along paved highways. Max 6. |
| **Broadcast Tower** | $250k | 45s | **The Artillery:** Platforms for Pamphlet Bombs, Exposés, and Manifestos. Place deep in your rear homeland, guarded by Watchtowers. Max 2. |
| **Supplement Lab** | $25k | 20s | *(Radiant Only)* **The Siphon:** Adjacent enemy tiles pay you $\$0.004/\text{tile/s}$ and have their dissent decay halved. Place along borders with rich rivals. Max 4. |

---

## 8. Phase-by-Phase Building Takeover Roadmap

```
 0:00                2:30                               6:00                             10:00+
  │                   │                                  │                                 │
  ▼                   ▼                                  ▼                                 ▼
[ PHASE 1: DEMOGRAPHICS ] ──► [ PHASE 2: SECURITY & LOGISTICS ] ──► [ PHASE 3: MUNICIPAL SEAT ] ──► [ PHASE 4: DOCTRINE & REVELATION ]
  • High School (Growth)        • Watchtower on keystones          • Town Hall (Downtown)          • The Old Megachurch
  • Elementary (Creep)          • Collection Plate Highway         • AM Radio Tower                • Broadcast Tower Strike
  • Compound 1 Expansion        • Sheriff (Heat Control)           • Deny Rival Keystones          • Final Domination / Win
```

### Phase 1: The Demographic Landgrab (0:00 – 2:30)
- **Objective:** Secure demographic and expansion engines before borders touch.
- **Actions:**
  1. Found your first Compound near a **High School** or **Elementary School**.
  2. Direct your initial conversion front in **Spread the Word** stance directly onto the school lot.
  3. Once the High School is secured, drop Doctrine point 1 into **B1 Tithing Drill** or **T1 Better Pamphlets**.

### Phase 2: Security & Supply Chains (2:30 – 6:00)
- **Objective:** Anchor your economy and protect your captured keystones against raids.
- **Actions:**
  1. Build a **Watchtower** covering your captured school and border road.
  2. Place **Collection Plate #1** on a captured Bank or commercial lot, and **Collection Plate #2** at your Compound along a paved road.
  3. Dispatch a Recruitment Van to patrol the road corridor to screen against enemy stealth Agents.
  4. Expand toward the **Sheriff's Station** to prepare for higher-Heat postures.

### Phase 3: The Battle for Downtown & The Airwaves (6:00 – 10:00)
- **Objective:** Seize the administrative heart of the town and neutralize enemy strike platforms.
- **Actions:**
  1. Push hard into Downtown to contest **Town Hall**. If a rival holds it, prioritize taking perimeter tiles to strip their CPA immunity.
  2. Seize the **AM Radio Tower**. Construct your own **Broadcast Tower** ($250k) deep in your rear lines.
  3. Keep one eye on the leaderboard: if Prosperity Circle is banking huge sums, locate their commercial Collection Plates and prepare a raid.

### Phase 4: The Endgame Climax (10:00+)
- **Objective:** Execute your chosen win condition using institutional leverage.
- **Actions:**
  - **If going for Domination:** Pop **CRUSADE** stance with Town Hall protecting you from CPA, fire a discounted Pamphlet Bomb from your AM Radio Tower onto the largest enemy cluster, and surge across the borders.
  - **If going for Doctrinal:** Fortify **The Old Megachurch** with 2 Watchtowers, achieve 100 Faith via Community Churches, and execute the 20s winning channel.
  - **If going for Economic:** Defend your Downtown Banks and Collection Plates in **Tend the Flock** stance until The Ledger hits the target.

---

## 9. Building Counterplay & Siege Matrix

| When the Enemy Controls... | The Threat | How to Counter & Dislodge Them |
| :--- | :--- | :--- |
| **High School** | Massive demographic snowball; out-replenishes your attacks. | Dispatch an Agent to conduct a **Deprogramming Raid** on the school; the 90s Apostate Scar disables the growth buff immediately. |
| **Town Hall** | They are in CRUSADE with zero CPA punishment. | Push their Heat past 75 with strikes; capture just 2 tiles of the Town Hall lot to strip their majority and unleash the CPA onto them. |
| **Supermarket + Watchtower** | Impenetrable $4\times$ retention bunker. | Do not attack head-on. Launch a **Pamphlet Bomb** to disable the Watchtower for 30s, then push with Stockpile Sermon or high-R0 fronts. |
| **The Old Megachurch** | Impending Doctrinal Victory channel. | Cast **Prime-Time Exposé** to drain $-25$ Faith; rush a Recruitment Van onto the holy lot to interrupt the channel. |
| **AM Radio Tower** | Constant cheap Pamphlet Bombs disabling your bases. | Use Visitors' **Radio Static** to shut it down for 20s, or drop a stealth Agent to contest one tile and reset their strike charge. |
