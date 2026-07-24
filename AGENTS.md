# AGENTS.md — Build Tree Framework: orchestration, delegation & model routing

The execution contract for **DELEGATED mode**. `CLAUDE.md` defines *what* gets built (phases, tree,
Manifest, evidence gates). This file defines *who builds it, on which model, at what cost, and what
they must hand back*.

Read `CLAUDE.md` first — it is the lens. Nothing here overrides the Prime Directives.
Model facts verified 2026-07-24.

---

## 1. THE OPERATING PRINCIPLE

> **Route each unit of work to the cheapest model that can do it correctly.**
> Default DOWN the ladder; escalate UP only when leverage demands it.

The orchestrator (Claude Fable 5) owns the Goal, the contracts, the Manifest, and every verdict.
Sub-agents own contract-bounded execution and nothing else. A sub-agent that has to make a design
call has been handed a bad brief — that is an orchestrator failure, not a sub-agent failure.

**Contracts before delegation, always.** Phase 4 must be complete for a branch before any of it is
handed out. A contract is the API you're handing to someone who cannot ask questions — in DELEGATED
mode that is literally true.

---

## 2. THE LADDER

| Tier | Model | ID | Role |
|---|---|---|---|
| 1 | **Claude Fable 5** | `claude-fable-5` | Anthropic's most capable widely released model. Orchestrator. Deepest reasoning, longest-horizon autonomy, self-verification, vision-based self-checking. |
| 2 | **Claude Opus 5** | `claude-opus-5` | Complex agentic coding and enterprise work. Heavy executor. Newest knowledge cutoff in the family (May 2026). |
| 3 | **Claude Sonnet 5** | `claude-sonnet-5` | Best speed/intelligence balance. Workhorse for contract-bound leaf implementation. |
| 4 | **Claude Haiku 4.5** | `claude-haiku-4-5` | Fastest, cheapest. High-volume, judgment-light work only. |

Adjacent models: **Claude Mythos 5** (`claude-mythos-5`) matches Fable 5's specs and pricing but is
invitation-only via Project Glasswing — if you don't have it, Fable 5 is the generally-available
equivalent. **Claude Opus 4.8** (`claude-opus-4-8`) survives in this framework solely as the
safeguard-fallback executor (§7).

### Specs that change routing decisions

| | Fable 5 | Opus 5 | Sonnet 5 | Haiku 4.5 |
|---|---|---|---|---|
| Context | 1M | 1M | 1M | 200k |
| Max output | 128k | 128k | 128k | 64k |
| Latency | Slower | Moderate | Fast | Fastest |
| Reliable knowledge cutoff | Jan 2026 | **May 2026** | Jan 2026 | Feb 2025 |
| Adaptive thinking | Always on | On by default | On by default | Not supported |
| Effort levels | `low`–`max` | `low`–`max` | `low`–`max` | n/a |
| Zero data retention | **No** — 30-day retention required | Yes | Yes | Yes |
| Safety-classifier refusals | **Yes** — plan for them | Yes | Yes (cyber) | — |

Three consequences worth internalising:

- **Haiku 4.5 has a 200k context and a Feb 2025 cutoff.** Never hand it a brief that assumes 1M
  context or current library APIs. It is for volume, not currency.
- **Opus 5 has the newest cutoff.** Any node touching recent engine/library/tooling APIs routes to
  Opus 5 — this is the concrete mechanism behind the *No hallucinated APIs* guardrail.
- **Fable 5 cannot run under ZDR.** If the org has a zero-data-retention agreement, the orchestrator
  tier must be Opus 5 and every Fable-only rule in `CLAUDE.md` shifts down one.

---

## 3. COST — what delegation actually saves

USD per million tokens, Anthropic first-party API.

| | Input | Output | 5m cache write | 1h cache write | Cache read | Batch (in / out) |
|---|---|---|---|---|---|---|
| **Fable 5** | $10 | $50 | $12.50 | $20 | $1.00 | $5 / $25 |
| **Opus 5** | $5 | $25 | $6.25 | $10 | $0.50 | $2.50 / $12.50 |
| **Sonnet 5** | $3 | $15 | $3.75 | $6 | $0.30 | $1.50 / $7.50 |
| **Haiku 4.5** | $1 | $5 | $1.25 | $2 | $0.10 | $0.50 / $2.50 |

> ⏳ **Sonnet 5 introductory pricing runs through 2026-08-31: $2 in / $10 out** (cache write
> $2.50 / $4, cache read $0.20, batch $1 / $5), reverting to the table above on 2026-09-01.
> Sonnet-tier delegation is at its cheapest right now and gets ~50% more expensive on that date.
> Front-load Sonnet-tier leaf work where the schedule allows, and re-budget any standing estimate
> before September.

**Output-token ratios (where the spend lands).** Fable 5 = 2× Opus 5 = 3.3× Sonnet 5 at list (5× at
intro pricing) = 10× Haiku 4.5.

Worked example — one contract-pinned leaf, ~40k in / ~12k out:

| Executor | Input | Output | Total |
|---|---|---|---|
| Fable 5 | $0.40 | $0.60 | **$1.00** |
| Opus 5 | $0.20 | $0.30 | **$0.50** |
| Sonnet 5 (intro) | $0.08 | $0.12 | **$0.20** |
| Haiku 4.5 | $0.04 | $0.06 | **$0.10** |

A 60-leaf branch is the difference between ~$60 and ~$12. That gap, multiplied across a project, is
the entire argument for the matrix below — and the reason grunt work at Fable tier is a real cost
error, not a stylistic preference.

### Additional cost lines

- **Batch API — 50% off input and output.** The single largest lever available, and it maps directly
  onto work this framework *mandates*: procgen sample-set QA (default 20 samples per system), bot-league
  runs, bulk playtest simulation, mapgen metric sweeps. If it isn't latency-sensitive, batch it.
- **Prompt caching — cache reads cost 0.1× input.** `GOAL.md` + locked contracts + Manifest header
  form a stable prefix every leaf re-sends. Cache it. Minimum cacheable prefix: **512 tokens on Fable
  5 and Opus 5**, 1024 on Sonnet 5. Keep the prefix byte-stable — no timestamps or per-run IDs ahead
  of the breakpoint, or you pay write price forever and never read.
- **Model switches invalidate the cache** (caches are model-scoped). Keep the orchestration loop on
  one model; push the cheaper tier into sub-agents rather than switching mid-conversation.
- **Fast mode** (Opus 5, research preview, Claude API only): $10 / $50 — Fable-tier price for
  Opus-tier output at up to 2.5× throughput. Justified only when wall-clock is the binding constraint.
- **Web search**: $10 per 1,000 searches on top of tokens. Relevant to Build-vs-Reuse candidate
  sweeps — delegate to Haiku 4.5 and cap `max_uses`. **Web fetch**: no surcharge.
- **Managed Agents**: tokens **plus $0.08 per session-hour** of `running` time. Idle doesn't bill, so
  a harness blocked on a human is cheap; one that spins is not.

---

## 4. THE DELEGATION MATRIX

| Work | Model | Effort | Rationale |
|---|---|---|---|
| Orchestration; Manifest ownership; Phase G goal/fantasy; Phase R recon; Phase 2 discovery; Phase 4 contracts; Phase 6 audit; Playability & Depth Reviews; system-interaction design; cutting decisions | **Fable 5** | `xhigh` | Highest-leverage. Errors propagate through every leaf and every hour of playtime. |
| Heavy reasoning below top-of-tree; complex procgen algorithm design; boss AI / behavior-tree design; economy tuning models; netcode & determinism-critical changes; anything touching recent APIs | **Opus 5** | `high`–`xhigh` | Near-top capability at half the cost, plus the newest knowledge cutoff. |
| Safeguard-routed nodes (§7) | **Opus 4.8** | `high` | Mandatory executor when Fable's classifier declines a node. |
| Standard leaf implementation against locked contracts; well-specified refactors; unit/integration tests; content-pipeline glue; standard shaders; UI components against a locked design | **Sonnet 5** | `medium` | Contract pins the answer. **Bulk of the work.** |
| Code search & inventory; running builds/tests/profilers and parsing output; boilerplate; formatting; docstrings; log/diff summarization; asset-batch metadata cleanup | **Haiku 4.5** | n/a | Volume-heavy, judgment-light. |
| Vision QA of rendered gameplay/UI/HUD/procgen output against acceptance criteria AND the Visual QA Discipline | **Fable 5** | `high` | Judgment-heavy verdict. Never down-tier. Give it crop/zoom tooling rather than more effort. |
| Build-vs-Reuse: candidate search, license text retrieval, maintenance signals | **Haiku 4.5** / **Sonnet 5** | `low` | Mechanical retrieval. |
| Build-vs-Reuse: the reuse-or-build call, license-compatibility judgment, asset-license judgment | **Fable 5** | `high` | A wrong legal call has real downstream cost. Delegate the legwork, never the verdict. |
| Playtest simulation (walk-through play, decision-tree traversal, edge-case play) | **Fable 5** / **Opus 5** | `high` | Requires holding the player fantasy and depth criteria while reasoning. Not a Sonnet-tier task. |

### The two hard rules

**NEVER DELEGATE DOWN** — Goal Statement · design contracts · Playability & Depth verdicts · cutting
decisions · procgen algorithm structure · NO_TOUCH rulings · Visual QA verdicts · license verdicts.

**ALWAYS DELEGATE DOWN** — inventory reads · test/profiler execution · boilerplate · formatting ·
summarization · candidate search.

Anything in between is a judgment call: ask *"does the contract pin the answer?"* If yes → Sonnet 5.
If the node still requires design reasoning → Opus 5. If it requires holding the fantasy → Fable 5 or
Opus 5.

---

## 5. WHEN TO DELEGATE — and when not to

Delegation is not free. Every sub-agent re-establishes context, re-explores, reports back, and then
the orchestrator re-reads the report. Delegate when the payoff clearly exceeds that overhead.

**Delegate when:**
- The contract is **locked** (Phase 4 complete for that branch) and the work is bounded by it.
- The work is **genuinely parallel** — independent tracks that don't touch the same files: a B1
  GAMEPLAY leaf and an unrelated B3 PRESENTATION leaf.
- The work is **wide and mechanical** — inventory across many files, a test-suite run, a
  20-sample procgen sweep, a Build-vs-Reuse candidate search.
- The work would otherwise **flood the orchestrator's context** with material it needs the conclusion
  of, not the content of (reading `DESIGN.md` end-to-end to answer one question).

**Do not delegate when:**
- The work is finishable in a handful of tool calls — a few reads, a targeted edit, one search.
  Delegation overhead exceeds the work.
- It is **verification or double-checking**. Verification belongs in the orchestrator's own loop.
  Spawning a verifier sub-agent for a leaf you just implemented is the most common waste in this
  framework.
- The contract is not locked. You'd be delegating a design decision by accident.
- It would split one modest job into pieces purely to parallelize it.

**Cap the fan-out.** Opus 5 in particular reaches for sub-agents *readily* — if the orchestration loop
is running on Opus 5, cap spawn counts explicitly rather than encouraging delegation. Prefer one
well-briefed sub-agent over three thinly-briefed ones. Never exceed ~20 parallel agents without an
explicit instruction to.

**Commit to the delegation.** Once a sub-agent reports, do not redo its work or re-derive its
findings. If the output fails the contract, that is a re-brief or an escalation — not a silent
takeover.

**Async beats spawn-and-block.** Long-lived sub-agents that keep their context and report
asynchronously outperform spawn-wait-collect: they avoid re-establishing context per subtask (a real
cache-read saving), and the orchestrator isn't bottlenecked on the slowest one.

**Don't tell sub-agents to double-check.** Fable 5 and Opus 5 self-verify by default; explicit
verification instructions cause over-verification and burn tokens without improving correctness. The
evidence gates in §6 are the verification mechanism — they are structural, not exhortative.

---

## 6. THE SUB-AGENT BRIEF

Every `DELEGATE <ID>` produces exactly this. A brief missing any field is not ready to send.

```
NODE:        <Manifest ID> — <feature name>
MODEL:       <claude-sonnet-5 | claude-opus-5 | claude-haiku-4-5>
EFFORT:      <low | medium | high | xhigh>
TAGS:        <🎮 and/or 🖼️ if applicable — these set the evidence bar>

FANTASY:     <the one-line player-fantasy statement this node serves>
PILLARS:     <the design pillars this node must not violate>

CONTRACT:    <exact signatures / schemas / event payloads / seed contract — verbatim from Phase 4>
ACCEPTANCE:  <the single clear criterion, plus how a playtester would recognise it working>

IN SCOPE:    <explicit file/path list>
NO_TOUCH:    <🔒 surfaces — determinism gate, save format, network protocol, mod API>
DEPENDS ON:  <upstream node IDs, already VERIFIED>

BUILD-VS-REUSE: <decision already made by the orchestrator, with license — or "custom, no candidates">

DELIVERABLES:
  - Smallest correct diff satisfying the contract
  - The leaf's tests, written and run, with the command and result
  - [🎮] Playtest observations against the scenario below — honest, err critical
  - [🖼️] Rendered capture saved to visuals/<ID>_<name>_v<n>.png (never overwrite)
  - [procgen] N samples (default 20) + invariants checked + quality-metric value
  - [optimize] before/after measurement and delta — revert if no improvement
  - One logical commit, real message, no refactor+feature mixing

RETURN:      <the exact structured shape you want back — see below>

STOP:        If the same check fails ~3 times, the change expands beyond IN SCOPE, or a 🔒 surface
             appears required — STOP, report what you tried, do not improvise.
```

**Structured returns.** Assistant-turn prefills are removed on the 5-series (400 error), so constrain
sub-agent output with `output_config.format` (structured outputs) instead. Manifest rows, procgen
sample metadata, and playtest verdicts are all better returned as validated JSON than as prose the
orchestrator has to re-parse.

### What comes back is Evidence, not assertion

The orchestrator does not mark ✔️ VERIFIED on a sub-agent's say-so. A returned node is ✅ IMPLEMENTED
until the orchestrator has the artifact in hand:

| Tag | Required artifact before ✔️ |
|---|---|
| *(all)* | Test command + pass result; baseline at least as green as Phase R |
| 🎮 | `PLAYTEST_LOG.md` entry with scenario, honest observations, and a FEELS RIGHT / TUNE / RETHINK / CUT verdict |
| 🖼️ | On-disk file under `visuals/`, passing Visual QA (PASS / TUNE / FAIL) — **verdict rendered by Fable 5, never by the sub-agent** |
| procgen | N-sample check, invariants held, quality-metric value, seeds logged |
| optimize | Before/after numbers and the delta |

Every delegated Manifest row records **the executing model and effort level** so cost and capability
remain auditable after the fact.

---

## 7. SAFEGUARDS & FAILURE HANDLING

**Refusals are HTTP 200, not errors.** Fable 5 (and Sonnet 5, for cyber-category topics) can decline a
request: `stop_reason: "refusal"` with a `stop_details` category, on a successful response. Code that
indexes `content[0]` unconditionally **breaks** on a refusal. Always branch on `stop_reason` first.

**Opt into server-side fallback by default** rather than hand-rolling retries:

```
betas: ["server-side-fallback-2026-07-01"]
fallbacks: "default"
```

This re-runs a declined request on the recommended model server-side, routed by refusal category
(cyber-category refusals go to Opus 4.8). A refusal before any output is **not billed**; the fallback
attempt bills at the fallback model's rates.

**Fable Fallback Rule.** Verify fallback output against the contract. If it is degraded, mark the node
🛑 **BLOCKED_BY_POLICY** and raise — do not quietly accept a weaker result as VERIFIED.

**Anti-spiral.** A sub-agent that hits its STOP condition returns 🚫 BLOCKED with what it tried. The
orchestrator then re-briefs, escalates a tier, routes around it — or asks whether the honest answer is
✂️ **CUT**. Sometimes the mechanic is wrong for the game, not badly tuned.

---

## 8. API CONSTRAINTS EVERY BRIEF MUST RESPECT

These return **400** on Fable 5, Opus 5, and Sonnet 5 alike:

- `temperature`, `top_p`, `top_k` — removed. Steer with prompting. **Procgen and design variety must
  come from asking for N distinct directions, not from raising temperature.**
- `thinking: {type: "enabled", budget_tokens: N}` — removed. Use adaptive thinking + `effort`.
- Assistant-turn prefills — removed. Use `output_config.format`.
- Fable 5: `thinking: {type: "disabled"}` — rejected outright (thinking is always on).
- Opus 5: `thinking: {type: "disabled"}` is accepted **only** at effort `high` or below; pairing it
  with `xhigh`/`max` is a 400.

**Tokenizer.** Fable 5 and Sonnet 5 produce **~30% more tokens** for the same text than Sonnet 4.6.
Re-measure with `count_tokens` rather than reusing older counts — `max_tokens` budgets inherited from
a previous model can truncate mid-output. Most likely to bite on 128k-output procgen dumps and
full-tree renders.

**Set `max_tokens` ≥ 64k at `xhigh`/`max` effort** so the model has room to think and act across tool
calls.

---

## 9. FLOCK-SPECIFIC ROUTING

| Area | Route to | Why |
|---|---|---|
| `packages/sim` — anything in determinism scope | **Opus 5** minimum | The determinism gate is build-stopping; a float or unseeded random slipping in breaks lockstep, resync, ranked, and replays at once. Never a Haiku node. |
| Lockstep netcode, desync debugging, resync | **Opus 5** / **Fable 5** | Wide, architectural, failure-mode-heavy. |
| Mapgen (§2) phase leaves | **Opus 5** design, **Sonnet 5** implementation | Algorithm structure is a never-delegate-down call; each phase's implementation is contract-pinned. |
| Bot brains (§21) — behaviour trees, utility AI | **Opus 5** | Boss/agent AI design sits in the Opus tier by the matrix. |
| Client HUD / renderer leaves (`packages/client`) | **Sonnet 5** implement, **Fable 5** Visual QA verdict | Nearly all 🖼️ nodes live here. |
| `tools/` scripts, screenshot/QA harness runs, log parsing | **Haiku 4.5** | Volume-heavy, judgment-light — and the existing harness for 🎮/🖼️ evidence. |
| Playtest simulation via `tools/playtest_sim.mjs`, `botleague.mjs` | **Batch API** where possible | Archetypal 50%-off workload. |

**🔒 NO_TOUCH for every FLOCK brief:** `packages/sim/test/determinism.test.ts` and the fixed-point /
seeded-RNG invariants it protects. Same seed + same Intents ⇒ same StateHash. Zero floats, zero
`Date`, zero `Math.random` in sim scope. No sub-agent weakens, skips, or `.only`-arounds that gate to
land a change — that is an automatic STOP and escalate.
