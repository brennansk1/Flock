# PLAN — Town generation, assets, cars & pathing upgrade

_Planned 2026-07-24. Grounded in the code as it stands, not in DESIGN.md.
Sequencing, contracts and evidence gates follow the Build Tree Framework._

---

## 0. The one fact that shapes everything

**Two of these four workstreams sit on opposite sides of the determinism
contract**, and that — not size — is what should drive the order.

| Workstream | Lives in | Inside the hash? | Risk |
|---|---|---|---|
| **A. Town generation** | `mapgen.ts`, `gridRoads.ts` | **YES** — world fields are hashed and snapshotted | **High** — a bad change desyncs lockstep |
| **B. Assets / fidelity** | `townRender.ts` | No — cosmetic boundary, floats allowed | Low |
| **C. Cars & traffic** | `townRender.ts` | No | Low |
| **D. Pathing (render-side)** | `townRender.ts` `roadPath()` | No | Low |

`HANDOFF.md §4` states the boundary explicitly: mapgen and `townRender`/
`recapCard` may use floats and are **not** hashed — but mapgen's *output* is.
So B/C/D can iterate freely and fast; A needs the full gate every time.

**Therefore: do B → D → C → A.** Ship the safe visual wins first, get the
pathing right underneath the cars, and take the hashed mapgen work last with the
most budget for verification. Doing A first would mean re-running the expensive
gate after every cosmetic tweak.

---

## 1. Baselines that must not regress

Every step below is measured against these. They already exist — no new
instrumentation needed except where noted.

**Performance** (B5.2.10, `node --cpu-prof`, 96² map):

| view | current | budget |
|---|---|---|
| full-map LOD1 | **160 ms/frame** (was 231) | must not exceed 160 |
| LOD3 | 10.0 ms | ≤ 12 ms (10 Hz) |
| LOD5 | 6.3 ms | ≤ 12 ms |

The client renders full zoom-out at ~3 Hz and zoomed views at 10 Hz. Cars and
denser assets are exactly the kind of change that quietly eats this, so **every
node in B and C carries a before/after frame-time number.** No number, no merge.

**Mapgen quality** (B1.4.19, `tools/mapmetrics.mjs`, farm 96², seeds 1/2/3/42/99):

```
roadConnectivity 0.991 · blocks 52 @ median 13 · 25 lot kinds @ 4.24 bits
nameCollisions 0 · farmShare 0.206 · waterShare 0.056
```

**Determinism**: `npm test` (sim 111 / server 17) + the cross-browser gate.
Only workstream A can break these, but the gate runs on all four anyway.

---

## 2. Workstream B — Asset upgrade (`townRender.ts`)

`ASSETS.md` is already the ledger, and every deferred item is a 🧩 row there
(B5.3.1 is the Stub-Law tracker). The plan is to **convert 🧩 rows to live**,
not to invent new assets.

**The trap to avoid:** the Visual QA Discipline's RESTRAINT clause. This
codebase has already been through a variety pass (B5.2.7) and a facade pass
(B5.2.6). Adding detail to a scene that already reads well makes it read
*worse*. So each node states what it *subtracts or replaces*, not just adds.

Proposed nodes, cheapest-and-most-visible first:

| ID | Node | Contract | Gate |
|---|---|---|---|
| B5.4.1 | **Seasonal crop stages** | `🧩 crop growth stages by match clock` — fields advance green→gold→stubble over the match. Reads match tick only; no new palette entries | 🖼️ + frame time |
| B5.4.2 | **Animated water** | `🧩 animated flow direction on the river` — ripple rows drift downstream; lake stays still. Direction from existing `cxs[]` | 🖼️ |
| B5.4.3 | **Night mode glow** | `🧩 night lamp glow` — streetlights and windows bloom at night. B5.2.8 already fixed `windowDark`; this extends to lamps | 🖼️ at 4 day phases |
| B5.4.4 | **Storefront signage** | `🧩 painted sign glyphs` on shops/diner. Uses the existing name corpus so signs read as the town's own businesses | 🖼️ RESTRAINT check — signage is the highest-risk-of-noise item here |
| B5.4.5 | **Level-crossing + trestle detail** | crossbucks already exist; add gates. `🧩 moving freight train` explicitly **CUT** for now — a moving train is a whole agent system, not an asset | ✂️ logged |

**Why B5.4.5 is partly a cut:** a moving freight train is workstream C in
disguise (an agent with a route and a schedule). Log it ✂️ rather than let it
smuggle scope into an asset pass.

---

## 3. Workstream D — Pathing upgrade (`roadPath()`)

Do this **before** cars, because cars ride on it. Reading the current
implementation (`townRender.ts:3704`), there are four concrete defects:

**D1 — the graph is unweighted.** BFS over `Road|Dirt` with a fixed 4-neighbour
order treats a dirt back-alley as equal to Main Street, so cars and walkers
route through alleys whenever the hop count ties. Real traffic prefers
arterials. *Fix:* Dijkstra with small integer weights (highway 1, street 2,
dirt/alley 4). Integer weights keep it deterministic; a binary heap or a
bucket queue keeps it near-BFS cost.

**D2 — the cache is unbounded.** `ROUTE_CACHE` is a `WeakMap<World, Map>` keyed
`from * n + to`, and nothing ever evicts. Every endpoint pair ever routed is
retained with its full path array for the life of the world. On a 96² map with
hundreds of residents doing lunch errands, that grows without limit.
*Fix:* an LRU bound (a few thousand entries) or — better — cache **per
destination** rather than per pair: one BFS from a destination yields the tree
for *every* origin, which is how the residents actually use it (many homes → a
few workplaces). That turns N searches into one.

**D3 — no turn cost.** Routes zig-zag across the grid where a human would take
one road then turn once. Straight-leg compression papers over this after the
fact. *Fix:* a small penalty for changing axis makes routes pick a road and
commit, which also makes the compression step cheaper and the result more
legible.

**D4 — pedestrians and vehicles share one graph.** Cars should not use footpaths
and pedestrians should prefer sidewalks. *Fix:* a `mode` parameter selecting the
walkable predicate and weights, with separate cache namespaces.

**Gate:** D is render-side, so no determinism risk — but it is on the hot path.
Node `B6.9` first: extend the existing profiling harness to report routing time
and cache size, so D1–D4 each land with a measured delta. The manifest records
a ~21 ms one-time warm-up today; that is the number to beat.

---

## 4. Workstream C — Car & traffic upgrade

B5.2.8 already did the hard part: cars are **agents**, not hash dressing —
driveway → in-lane driving with directional sprites → nose-in parking → owner
walks the last leg. The upgrade is the deferred layer on top.

| ID | Node | Contract |
|---|---|---|
| B5.5.1 | **Turning traffic at intersections** (`🧩` in ASSETS.md) | cars visibly slow and swing through the turn rather than pivoting on a pixel; requires D3's turn-aware routes to look intentional |
| B5.5.2 | **Signal-timed crossings** (explicitly DEFERRED by B5.2.8) | traffic lights cycle (`🧩 cycling phases`); cars queue at red, pedestrians wait for the walk phase. This is the single biggest "the town is alive" win available |
| B5.5.3 | **Vehicle variety by district** | delivery vans downtown, pickups on the farm fringe, school bus on a school route — reusing existing palette entries only |
| B5.5.4 | **Congestion read** | cars bunch behind a turning vehicle instead of passing through each other |

**Ordering note:** B5.5.2 depends on B5.5.1 which depends on D3. Signals before
turning looks broken; turning before weighted routes looks arbitrary. This chain
is the reason D precedes C.

**Restraint gate:** the Visual QA RESTRAINT clause applies hard here. More cars
is not better — cars must never obscure gameplay-critical information
(territory colour, front lines, unit dots). The acceptance criterion is
*legibility at LOD1 with a full match running*, not car count.

---

## 5. Workstream A — Town generation (the hashed one)

Three tranches, in increasing risk. All must hold the §1 metric baseline and
pass the cross-browser gate.

**A1 — `B1.4.21` transcendental-free mapgen** *(already an open manifest node)*
Replace the last three `Math.sin/cos/atan2` clusters — oceanside coastline
wobble (`mapgen.ts:916`), town footprint rim (`:1116–1169`), `organicBlob` rim
(`:2081–2087`) — with field-noise or LUT math. Risk is contained: B6.5 gates all
shipping engines on every push, and fields v2 already retired two of five
clusters. **Do this first in A** — it is the only tranche that reduces risk
rather than adding it, and it makes every later world-shape change safer.

**A2 — the deferred B1.4.12 reviewer items**
- `#1 river-anchored founding` — towns grow from the river crossing outward, which
  is how real towns sited themselves. Changes the town footprint ⇒ expect metric
  movement; judge by delta, not by pass/fail.
- `#15 curvilinear suburbs` — outer residential streets curve instead of
  gridding. **This one conflicts with the orthogonality invariant
  (`B1.4.17.5`: no corner-only contact, any seed).** Either the invariant gets an
  explicit carve-out for curved segments or the feature is ✂️ cut. *Decide before
  implementing* — this is a contract question, not a coding one.
- `#16 diagonal legacy road` — same conflict, same decision.

**A3 — asset-driven generation** (new)
Only after A1/A2 settle: place the assets B enabled where generation can reason
about them (e.g. signage needs business names on the right lots; signals need
intersections classified as major/minor). This is where A and B meet, and it is
last because it depends on both.

**Gate for every A node:** `npm test` + cross-browser determinism + 20-sample
QA render set with seeds logged (PROCGEN rule) + `tools/mapmetrics.mjs` delta
against the §1 baseline + a playability smoke (does the town still play?).

---

## 6. Order of work, and why

```
B5.4.x  assets          ← safe, visible, no dependencies
   ↓
B6.9    routing profiler ← so D can be measured
   ↓
D1–D4   pathing          ← cars ride on this
   ↓
B5.5.x  cars & signals   ← needs D3 turn costs to look intentional
   ↓
A1      transcendentals  ← reduces risk before touching world shape
   ↓
A2      river founding / curvilinear (contract decision first)
   ↓
A3      asset-driven generation
```

Two decisions are needed from the user before the tranches that need them, and
neither blocks starting:

1. **Curvilinear suburbs & diagonal roads vs. the orthogonality invariant** (A2)
   — carve-out or cut? A2 cannot start until this is settled.
2. **Moving freight train** (B5.4.5) — accept as ✂️ cut, or promote to a
   workstream-C agent node?

## 7. What I will not do

- **No new palette entries without a cut.** B5.2.7 already passed a RESTRAINT
  gate; every added hue must justify itself or replace one.
- **No mapgen change without a metrics delta.** The B1.4.19 baseline exists
  precisely so world-shape changes are judged by number.
- **No car count increase as a "win".** Legibility at LOD1 is the criterion.
- **No touching `packages/sim` tick-path math** for any of this. Cars, routing
  and assets are render-side; if a node seems to need sim state, that is a
  design smell to raise, not to route around.
