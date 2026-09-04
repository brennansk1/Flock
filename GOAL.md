# FLOCK — Goal Statement & Player Fantasy

_Phase G artifact, written 2026-07-05 by inferring from DESIGN.md v2.0 Part I
(the game's own vision section) — no tension found between the codebase's
signals and the stated design. This is the lens every node, contract, cut, and
audit is checked against._

## Player fantasy

You are a **charismatic mastermind founding a fringe movement in Mundane
Falls, USA** — out-recruiting, out-scheming, and out-lasting rival prophets
until yours is the last congregation standing. The town is the board: a
believable small American town whose streets, households, and civic
institutions you convert block by block.

## Genre & depth expectations

Browser-first competitive territory strategy (.io) × asymmetric cult-builder
(*OpenFront meets Cult of the Lamb*). Target depth by axis:

| Axis | Target |
|---|---|
| Strategic (territory, timing, target selection) | **DEEP** |
| Systemic (economy × heat × doctrine × diplomacy interplay) | **SIGNATURE** — the moat |
| Spatial (the generated town as strategic terrain) | **DEEP** — mapgen is a gameplay system, not scenery |
| Mechanical/execution | Light-moderate (10 seconds to play) |
| Narrative | Moderate, emergent ("every match ends in a story") |

## Design pillars (filters, not slogans)

- **P1** Ten-seconds-to-play / ten-years-to-master — the board must be readable without a manual.
- **P2** Asymmetry is the moat — archetype kits stay meaningfully different.
- **P3** Betrayal is content — diplomacy systems exist to generate drama.
- **P4** The money is the joke — fictional $ in-game; real $ stays cosmetic. Never pay-to-win.
- **P5** Every match ends in a story — engineered shareability (recap, headlines).

## Anti-goals

- Never real faiths, real cults, or real tragedies — satire of *mechanisms* only (tone guardrail B8.6 enforces this in code).
- Never pay-to-win (enforced: relics never money-priced, B2.4).
- Not a grinder; matches are 8–20 minutes.

## Mapgen's contract with the fantasy (why B1.4 gets atom-level decomposition)

The generated town **is** the strategic terrain and the fiction at once. It must
(a) pass for an aerial photo of a real American town within the 8px idiom
(STANDARDS_MAPGEN.md bar), (b) be readable in 10 seconds — downtown core,
residential rings, farm fringe, wilderness edge (P1), and (c) be bit-identical
across every client and the server per seed — mapgen sits inside the lockstep
determinism contract (T.2). A map that is pretty but desyncs, or deep but
unreadable, fails the goal.
