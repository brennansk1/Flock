# FLOCK — Strategy Audit

_2026-07-24. Every claim below is checked against code, not against DESIGN.md or
the Manifest. Method: trace each strategy system end-to-end (intent → sim
handler → effect → player-visible feedback), then check whether its tuning
actually reaches runtime. Two independent "declared but wired to nothing" bugs
were found earlier the same day, so nothing is taken on trust._

Checked against `GOAL.md`: strategic depth target **DEEP**, systemic depth
target **SIGNATURE** (the moat).

---

## 1. The strategy surface, as built

Ten systems. Nine are genuinely built out and reachable; the defects are
concentrated in how they are *scored* and *tuned*, not in whether they exist.

| # | System | Reachable? | Tunable from balance.json? |
|---|---|---|---|
| 1 | **Missions & tempo** — Spread / Tend / Crusade, commit slider | ✅ | ✅ `missions.*`, `stances.*` |
| 2 | **Conversion combat** — fronts, pressure, creep, attrition, scars | ✅ | ✅ `conversion.*` |
| 3 | **Economy** — tithe, district income, dissent tax, recruit drives, couriers, vans | ✅ | ✅ `economy.*` |
| 4 | **Property** — parcel purchase, escalating cost, adjacency, crowding cap | ✅ | ✅ `property.*` |
| 5 | **Doctrine** — 16 BITE nodes, milestone points, tier gating, Ecumenical Pact | ✅ | ✅ |
| 6 | **Archetype kits** — 10 abilities + Prophecy signature, all handlers present | ✅ | ⚠️ coefficients yes (`archetypes.*`); ability costs/cooldowns hardcoded in `KIT` |
| 7 | **Diplomacy** — alliances, JUDAS betrayal, grudges | ✅ | ✅ |
| 8 | **Schism** — risk gauge → splinter sect | ✅ | ❌ **all 4 knobs dead** |
| 9 | **PvP pressure** — strikes, agents, raids, scandal, court defection | ✅ | ❌ **all 5 scandal knobs dead** |
| 10 | **Civics** — key-building control, economic anchors | ✅ | ✅ `civics.*` |
| — | **Heat / CPA** and **Dissent** (the pressure valves both feed) | ✅ | ✅ `heat.*` |

Ability wiring was spot-checked because PT-0017 found a dead one (Visitors'
Radio Static was a no-op). All ten `KIT` entries now have handlers, and the
Final Dawn Prophecy signature resolves. **No dead abilities remain.**

---

## 2. Defect 1 — the game scores winning two different ways

`checkVictory` (sim.ts) has five paths. They do not agree on what winning means.

| # | Path | Metric | Status |
|---|---|---|---|
| 1 | Domination | **souls** (share of total town population) | fixed 2026-07-24; was unreachable |
| 2 | Last cult standing | elimination | live |
| 3 | Doctrinal "Revelation" | Faith 100 held + channel | **DEAD** |
| 4 | Economic "The Ledger" | banked $ | **DEAD** |
| 5 | Timer expiry | **tiles**, then $, then Faith | live |

Path 1 rewards converting **dense population**. Path 5 rewards holding **raw
acreage**. Those are different games. A player who grabs cheap empty farmland
climbs the timer tiebreak while going nowhere on domination; a player who
converts the dense downtown does the reverse.

This mattered enormously until today, because **path 5 was the only one that
ever fired** — so the shipped game silently scored on tiles while the tutorial,
the HUD conversion bar, and the entire fiction told players it was about souls.

**Recommendation:** make the timer tiebreak use the same soul share as
domination. One-line change in the path-5 comparator, and the two scoring
metrics stop contradicting each other. Tiles then remain a *means* (territory
buys income and access) rather than a second, hidden win condition.

## 3. Defect 2 — two victory paths are unreachable, and one is an archetype's whole identity

Paths 3 and 4 are both gated on `s.revelationMode`. That flag:

- defaults to `false` in `createSim` (sim.ts:192),
- is **never set to `true` anywhere** in sim, server, lobby, or tools.

So both are dead code. Two consequences:

**The Prosperity Circle has no win condition.** "The Ledger" economic victory is
its signature strategic identity per §11.3 — the reason the archetype exists.
It cannot fire. This is not a theoretical complaint: the bot-league has Circle
at **20.8%** against an expected 25%, and the archetype whose defining path to
victory is unreachable is exactly the one you would expect to under-perform.

**Path 4 is also mis-wired even if enabled.** It hardcodes
`fromInt(1_200_000)` with the comment *"S-map target; M/L wire in with map
sizes"* — while `balance.json` carries a full `victory.economic_usd: {S,M,L}`
table that nothing reads. Same dead-knob pattern as `domination_pct`.

**Recommendation:** decide whether Revelation is in scope. If yes, enable it and
wire `economic_usd`/`doctrinal` through `loadBalance` the way `domination_pct`
now is. If no, cut both paths explicitly (✂️) and give the Circle a different
identity — but do not leave an archetype shipping with a phantom win condition.

## 4. Defect 3 — phantom tuning: you cannot harmonise what isn't connected

`loadBalance` silently drops twelve declared knobs. They exist in `balance.json`
and in the `RawBalance` type, and never reach runtime:

```
sim.turn_per_tick
schism.territory_share   schism.avg_dissent   schism.sustain_s   schism.secede_share
scandal.evidence_per_s   scandal.notify_at    scandal.dmg_heat_coef
scandal.dmg_min          scandal.dmg_max
victory.doctrinal.faith_hold_s   victory.doctrinal.channel_s
```

(Plus `victory.economic_usd.{S,M,L}`, which a leaf-key scan misses because its
leaves are named `S`/`M`/`L`.)

The systems themselves work — but on hardcoded constants. `stepSchism` takes
`b: Balance` and never reads it: territory 35%, dissent 40, sustain 30s are all
literals. `entities.ts` does the same with `AGENT_SPEED_TILES_PER_S`,
`RAID_CHANNEL_TICKS`, `EXPOSURE_KILL_TICKS`, `STRIKE_DEFS`.

This is the harmony problem in its purest form. Schism is the counter-pressure
on over-expansion; scandal is the counter-pressure on a runaway leader. Those
are precisely the dials you would reach for to fix the snowball behaviour found
in PT-0018 — **and turning them does nothing.** `balance.json` advertises itself
as "the single source of tuning truth" and is, for these systems, decorative.

**Recommendation:** wire the twelve knobs through `loadBalance` and replace the
literals. Mechanical, low-risk, no behaviour change if the JSON values match
today's constants — and it converts three unbalanceable systems into balanceable
ones before the human playtest balance pass (B7.9).

## 5. Where the strategy genuinely is harmonious

Worth stating plainly, because the defects above are all in scoring and tuning
rather than design:

- **The pressure triangle works.** Convert → raises Heat and Dissent → Heat
  summons the CPA, Dissent risks Schism → both push you to Tend → Tend banks
  Faith → Faith buys Doctrine → Doctrine improves conversion. That loop closes
  properly, and every edge is implemented.
- **Territory is multi-purpose**, not a single currency: it feeds tithe income,
  gates building placement, provides front adjacency, and (via civics) grants
  modifiers. Systems read each other rather than running in parallel.
- **Civics are a genuine contested objective** — B1.4.20 gave map anchors real
  economic effects, so the generated town is strategic terrain rather than
  scenery, which is what `GOAL.md` demands of mapgen.
- **Diplomacy has real teeth**: pacts share doctrine, betrayal leaves permanent
  grudges, schism spawns an actual splinter player.

The systemic **SIGNATURE** depth target is defensible on design. It is
undermined by scoring incoherence (§2) and unreachable paths (§3), not by
missing mechanics.

---

## 6. Priority

1. **Unify the timer tiebreak onto souls** (§2) — smallest change, removes a
   direct contradiction between two live win conditions.
2. **Decide Revelation: enable or cut** (§3) — the Circle cannot keep shipping
   with a phantom identity.
3. **Wire the twelve dead knobs** (§4) — prerequisite for any real balance pass,
   including the snowball work still open as B1.21.
4. Then re-run `tools/depth_probe.mjs` and the bot-league; the archetype drift
   (dawn 41.7% / visitors 16.7%) should be re-read only after 1–3, since two of
   the four archetypes are currently being measured with broken win conditions.

---

## 7. Follow-through — 2026-07-24, same day

Acting on §6 in order. Measured after every step; the numbers moved a lot.

### Knobs wired (§4 closed)

All twelve now reach runtime and are pinned by tests that *move* them rather
than merely read them. JSON values already matched the literals, so this was a
pure refactor with no behaviour change: schism reads `b.schism.*` (stepSchism
took a `Balance` and ignored it), scandal reads `b.scandal.*`, the doctrinal and
economic targets read `b.victory.*`, and the economic target is finally
size-bucketed instead of hardcoded to the S value.

### Revelation enabled (§3 closed, with one part still open)

`revelationMode` now defaults ON. The two alternate paths were implemented and
unit-tested — m2.test.ts passed `revelationMode: true` explicitly — while
production shipped them off. That is why there was no "which path" decision.

**Mapgen puts exactly one Megachurch on every seed** (verified across 11/21/42/
77/99), so the doctrinal path is a single contested objective: one building on
the board is a win condition and only one cult can hold it. That is the
"which buildings do I take over" decision, at the sharpest level the game has.

### Path distribution, measured (10 matches, 96², 4p, shipped config)

| step | domination | doctrinal | economic | timer |
|---|---|---|---|---|
| before today | 0 | 0 | 0 | **10** |
| Revelation ON, doctrinal at 90s+20s | 0 | **8** | 0 | 2 |
| doctrinal retuned to 180s+45s | **5** | 1 | 0 | 4 |

The middle row is the important one. Enabling Revelation as-designed did not
create a choice — it replaced "the timer always decides" with "doctrinal always
decides", which by the Depth Review's own ranking is the worse defect (an
obvious dominant strategy trivialising the system). The doctrinal commitment was
simply too cheap: ~110s total, with Faith trivially pinned at 100.

At 180s hold + 45s channel it becomes a real commitment — ~3.75 minutes of
uninterrupted Megachurch control in a 12-minute match, contestable because there
is only one. Three paths now win matches and none dominates.

### Still open: the economic path is unreachable by ~780×

`victory.economic_usd` is 1.2M/3M/6M. **Measured Circle peak bank across six
matches: $2,002–$3,847.** The design document's economic scale and the
implemented economy differ by nearly three orders of magnitude, so The Ledger
cannot fire and the Prosperity Circle still has no path of its own — it sits at
16.7% in the bot-league against an expected 25%.

This is deliberately **not** fixed here. Picking a number means choosing between
two very different corrections — re-scale the economy up to the design's
intent, or re-scale the target down to the economy as built — and that decision
changes what the Circle *is*. It needs a human call, not a guess.

### Where that leaves the strategy surface

- **Path choice: real but incomplete.** 3 of 4 paths live, none dominant.
- **Building choice: real.** The single Megachurch is a win condition; civic
  anchors carry differentiated economic effects (B1.18/B1.4.20).
- **Tunability: fixed.** Every counter-pressure dial — schism, scandal — is
  connected, which is the prerequisite for the snowball work still open as B1.21.
