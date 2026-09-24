/**
 * Play-loop telemetry: run headless church-tier bot matches on the real sim
 * (server-like settings) and measure HOW the game plays — pacing, snowball,
 * system usage, archetype economics — to feed design reviews.
 *
 * Bots (botTurn) never cast archetype ABILITY intents, so a small scripted
 * layer casts each archetype's abilities whenever affordable at a sensible
 * target. Splinter sects (schisms) are promoted to sect-tier bots, like the
 * server does.
 *
 * Usage: node tools/playloop_telemetry.mjs [matches=24] [players=6] [world=96]
 * Env:   SIMDIST (path to sim dist index.js; default ../packages/sim/dist/index.js)
 *        SEED (base seed), TIMER (ticks, default 12000), OUT (json path)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const simPath = process.env.SIMDIST
  ? pathToFileURL(resolve(process.env.SIMDIST)).href
  : new URL("../packages/sim/dist/index.js", import.meta.url).href;
const sim$ = await import(simPath);
const {
  loadBalance, createSim, generateWorld, step, seedRng, nextRange, botTurn, botShouldAct,
  IntentType, getArchetype, Terrain, TileState, MatchStatus,
} = sim$;

const MATCHES = Number(process.argv[2] ?? 24);
const PLAYERS = Number(process.argv[3] ?? 6);
const WORLD = Number(process.argv[4] ?? 96);
const BASE_SEED = Number(process.env.SEED ?? 7);
const TIMER = Number(process.env.TIMER ?? 12000);
const OUT = process.env.OUT ?? "telemetry.json";
const ARCHES = ["dawn", "radiant", "circle", "visitors"];
const TPS = 10;
const SAMPLE = 10 * TPS;
const ABILITY_EVERY = 30; // scripted caster thinks every 3s
const CHECKPOINTS_MIN = [2, 5, 10, 15, 20];
const F = 65536;
const toF = (x) => x / F;

const balance = loadBalance(JSON.parse(readFileSync(new URL("../balance.json", import.meta.url))));
const TYPES = [
  "farm", "oceanside", "desert", "mountain", "lakeside",
];

// ---------- aggregate accumulators ----------
const agg = {
  matches: [],
  intentsSent: {},
  byArch: Object.fromEntries(
    ARCHES.map((a) => [a, {
      seats: 0, wins: 0, placeSum: 0, eliminated: 0,
      samples: 0, followers: 0, flock: 0, usd: 0, faith: 0, heat: 0, dissent: 0, heat60: 0, heat85: 0,
      usdMax: 0, tilesAt: Object.fromEntries(CHECKPOINTS_MIN.map((m) => [m, 0])),
      soulShareAt: Object.fromEntries(CHECKPOINTS_MIN.map((m) => [m, 0])),
      tilesAtN: Object.fromEntries(CHECKPOINTS_MIN.map((m) => [m, 0])),
      abilityAttempts: {}, abilityFired: {}, firstAffordTick: {}, signatures: 0,
      doctrines: 0, usdEarned: 0,
    }]),
  ),
};

function tileFrontier(w, pid, rng, wantEnemy) {
  // sample own tiles; return a neighbouring citizen tile not ours (enemy first if wanted)
  let fallback = -1;
  for (let k = 0; k < 120; k++) {
    const t = nextRange(rng, w.owner.length);
    if (w.owner[t] !== pid) continue;
    const x = t % w.width, y = (t / w.width) | 0;
    for (let r = 1; r <= 3; r++) {
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w.width || ny >= w.height) continue;
        const n = ny * w.width + nx;
        if (w.terrain[n] !== Terrain.Citizen || w.owner[n] === pid) continue;
        if (wantEnemy && w.owner[n] !== 0 && w.state[n] === TileState.Believer) return n;
        if (!wantEnemy && w.owner[n] === 0) return n;
        if (fallback < 0) fallback = n;
      }
    }
  }
  return fallback;
}
function anyNeutralCitizen(w, rng, near, pid) {
  // for saucer landing / hostile acquisition: nearest neutral citizen to a random own tile
  for (let k = 0; k < 200; k++) {
    const t = near >= 0 ? near : nextRange(rng, w.owner.length);
    const x0 = t % w.width, y0 = (t / w.width) | 0;
    for (let r = 1; r <= 12; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = x0 + dx, y = y0 + dy;
          if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
          const n = y * w.width + x;
          if (w.terrain[n] === Terrain.Citizen && w.owner[n] === 0 && w.state[n] === TileState.Neutral) return n;
        }
    near = -1;
  }
  return -1;
}
function ownHighDissentTile(w, pid) {
  let best = -1, bv = -1;
  for (let t = 0; t < w.owner.length; t += 3) if (w.owner[t] === pid && w.dissent[t] > bv) { bv = w.dissent[t]; best = t; }
  return best;
}
function someOwned(w, pid, rng) {
  for (let k = 0; k < 200; k++) { const t = nextRange(rng, w.owner.length); if (w.owner[t] === pid) return t; }
  return -1;
}

function abilityTarget(s, p, a, rng) {
  const w = s.world;
  switch (a.id) {
    case "juice_cleanse": return ownHighDissentTile(w, p.id);
    case "radio_static": return tileFrontier(w, p.id, rng, true);
    case "hostile_acquisition": return anyNeutralCitizen(w, rng, tileFrontier(w, p.id, rng, false), p.id);
    case "saucer_landing": return anyNeutralCitizen(w, rng, -1, p.id); // anywhere
    default:
      if (a.targeting === "none") return -1;
      return tileFrontier(w, p.id, rng, false);
  }
}

function soulsByOwner(w) {
  const m = new Map();
  for (let t = 0; t < w.owner.length; t++) {
    const o = w.owner[t];
    if (o === 0 || w.state[t] !== TileState.Believer) continue;
    m.set(o, (m.get(o) ?? 0) + w.pop[t]);
  }
  return m;
}
function dissentAvg(w, pid) {
  let sum = 0, n = 0;
  for (let t = 0; t < w.owner.length; t++) if (w.owner[t] === pid) { sum += w.dissent[t]; n++; }
  return n ? toF(sum / n) : 0;
}
function hasContact(w, pid) {
  for (let t = 0; t < w.owner.length; t++) {
    if (w.owner[t] !== pid) continue;
    const x = t % w.width;
    const r = t + 1, d = t + w.width;
    if (x < w.width - 1 && w.owner[r] !== 0 && w.owner[r] !== pid) return true;
    if (d < w.owner.length && w.owner[d] !== 0 && w.owner[d] !== pid) return true;
    if (x > 0 && w.owner[t - 1] !== 0 && w.owner[t - 1] !== pid) return true;
    if (t >= w.width && w.owner[t - w.width] !== 0 && w.owner[t - w.width] !== pid) return true;
  }
  return false;
}
function spawnTileFor(w, index, n) {
  // mirrors server matchWorker.spawnTileFor (ring on open grass with town in reach)
  const angle = (index % n) * ((2 * Math.PI) / n);
  const r = Math.floor(Math.min(w.width, w.height) * 0.33);
  const cx = w.width >> 1, cy = w.height >> 1;
  const x0 = Math.min(w.width - 1, Math.max(0, cx + Math.round(Math.cos(angle) * r)));
  const y0 = Math.min(w.height - 1, Math.max(0, cy + Math.round(Math.sin(angle) * r)));
  const citizenNear = (t, reach) => {
    const tx = t % w.width, ty = (t / w.width) | 0;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const x = tx + dx, y = ty + dy;
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
      if (w.terrain[y * w.width + x] === Terrain.Citizen) return true;
    }
    return false;
  };
  for (let rad = 0; rad < Math.max(w.width, w.height); rad++)
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
      const x = x0 + dx, y = y0 + dy;
      if (x < 2 || y < 2 || x >= w.width - 2 || y >= w.height - 2) continue;
      const t = y * w.width + x;
      if (w.terrain[t] === Terrain.Grass && w.property[t] === 0 && citizenNear(t, 9)) return t;
    }
  return y0 * w.width + x0;
}

const t0 = Date.now();
for (let m = 0; m < MATCHES; m++) {
  const seed = (BASE_SEED + m * 2654435761) >>> 0;
  const townType = TYPES[m % TYPES.length];
  const world = generateWorld(seed, WORLD, WORLD, { biomes: ["desert", "forest"], townType });
  const spawns = Array.from({ length: PLAYERS }, (_, i) => ({ id: i + 1, archetype: ARCHES[(i + m) % ARCHES.length] }));
  const s = createSim({ seed, balance, world, spawns, timerTicks: TIMER, foundingTicks: 1 });
  const rng = seedRng(seed ^ 0xb07);
  const arng = seedRng(seed ^ 0xab1);
  const bots = spawns.map((sp, i) => ({ playerId: sp.id, tier: "church", cadence: 10 + (i % 8), aggression: 2, grudge: 0 }));
  const archOf = new Map(spawns.map((sp) => [sp.id, sp.archetype]));
  step(s, { n: 0, seedSlice: 1, intents: spawns.map((sp, i) => ({ t: IntentType.SPAWN, player: sp.id, tile: spawnTileFor(s.world, i, PLAYERS) })) }, balance);

  const M = {
    seed, townType, arches: spawns.map((sp) => sp.archetype), endTick: 0, winner: null, reason: "",
    leaderTimeline: [], leadChanges: 0, leaderAt5: null, leaderAt5Won: null,
    firstFlipTick: -1, firstContactTick: -1, eliminations: [], splinters: 0,
    flipsPerSample: [], counts: {
      decrees: 0, doctrines: 0, scandalsPublished: 0, schisms: 0, picketsSpawned: 0, busRaids: 0,
      strikes: 0, couriers: 0, agents: 0, vans: 0, alliances: 0, betrayals: 0, prophecies: 0,
      prophecyFulfilled: 0, buildings: {}, abilityFired: {}, signatureCalls: 0,
    },
    final: [],
  };
  const seen = { dec: new Set(), strike: new Set(), cour: new Set(), agent: new Set(), van: new Set(), bld: new Set(), pick: new WeakSet(), ally: new Set() };
  let lastBus = s.cpaNextBusTick;
  let prevOwner = Uint32Array.from(s.world.owner);
  const initOwned = new Map(s.players.map((p) => [p.id, p.ownedTiles]));
  let curLeader = 0;
  const knownPlayers = new Set(s.players.map((p) => p.id));
  const aliveSet = new Set(s.players.map((p) => p.id));

  for (let n = 1; n < TIMER + 5 && s.status === MatchStatus.Live; n++) {
    const intents = [];
    for (const b of bots) if (botShouldAct(b, s.tick)) intents.push(...botTurn(s, b, rng));
    // scripted ability layer (only for original seats)
    if (n % ABILITY_EVERY === 0) {
      for (const p of s.players) {
        if (!p.alive || !p.spawned || !archOf.has(p.id)) continue;
        const def = getArchetype(p.archetype);
        const A = agg.byArch[p.archetype];
        for (const a of def.abilities) {
          if ((p.cooldowns[a.cooldownKey] ?? 0) > 0) continue;
          const c = a.cost(p);
          if ((c.usd !== undefined && p.usd < c.usd) || (c.faith !== undefined && p.faith < c.faith)) continue;
          if (A.firstAffordTick[a.id] === undefined) A.firstAffordTick[a.id] = [];
          if (!M["aff_" + p.id + a.id]) { M["aff_" + p.id + a.id] = 1; A.firstAffordTick[a.id].push(s.tick); }
          const target = abilityTarget(s, p, a, arng);
          if (a.targeting !== "none" && target < 0) continue;
          intents.push({ t: IntentType.ABILITY, player: p.id, ability: a.id, target });
          A.abilityAttempts[a.id] = (A.abilityAttempts[a.id] ?? 0) + 1;
          break; // one cast per think
        }
      }
    }
    for (const it of intents) agg.intentsSent[it.t] = (agg.intentsSent[it.t] ?? 0) + 1;
    M.counts.signatureCalls += intents.filter((i) => i.t === IntentType.SIGNATURE).length;

    const cdBefore = new Map(s.players.map((p) => [p.id, { ...p.cooldowns }]));
    const docBefore = new Map(s.players.map((p) => [p.id, p.doctrine.length]));
    step(s, { n, intents, seedSlice: (n * 2654435761) >>> 0 }, balance);

    // ---- event detection ----
    for (const p of s.players) {
      const before = cdBefore.get(p.id);
      if (before) for (const a of getArchetype(p.archetype).abilities) {
        if ((p.cooldowns[a.cooldownKey] ?? 0) > (before[a.cooldownKey] ?? 0)) {
          M.counts.abilityFired[a.id] = (M.counts.abilityFired[a.id] ?? 0) + 1;
          if (archOf.has(p.id)) agg.byArch[p.archetype].abilityFired[a.id] = (agg.byArch[p.archetype].abilityFired[a.id] ?? 0) + 1;
        }
      }
      const db = docBefore.get(p.id);
      if (db !== undefined && p.doctrine.length > db) M.counts.doctrines += p.doctrine.length - db;
      if (!knownPlayers.has(p.id)) {
        knownPlayers.add(p.id); aliveSet.add(p.id); M.splinters++;
        bots.push({ playerId: p.id, tier: "sect", cadence: 18 + (p.id % 16), aggression: 1, grudge: 0 });
      }
      if (aliveSet.has(p.id) && !p.alive) {
        aliveSet.delete(p.id);
        M.eliminations.push({ id: p.id, arch: p.archetype, splinter: !archOf.has(p.id), tick: s.tick });
      }
    }
    for (const d of s.activeDecrees) if (!seen.dec.has(d.id)) { seen.dec.add(d.id); M.counts.decrees++; }
    for (const x of s.strikes) if (!seen.strike.has(x.id)) { seen.strike.add(x.id); M.counts.strikes++; }
    for (const x of s.couriers) if (!seen.cour.has(x.id)) { seen.cour.add(x.id); M.counts.couriers++; }
    for (const x of s.agents) if (!seen.agent.has(x.id)) { seen.agent.add(x.id); M.counts.agents++; }
    for (const x of s.vans) if (!seen.van.has(x.id)) { seen.van.add(x.id); M.counts.vans++; }
    for (const x of s.buildings) if (!seen.bld.has(x.id)) { seen.bld.add(x.id); M.counts.buildings[x.type] = (M.counts.buildings[x.type] ?? 0) + 1; }
    for (const x of s.pickets) if (!seen.pick.has(x)) { seen.pick.add(x); M.counts.picketsSpawned++; }
    for (const x of s.alliances) { const k = x.a + ":" + x.b + ":" + x.expiresTick; if (!seen.ally.has(k)) { seen.ally.add(k); M.counts.alliances++; } }
    if (s.cpaNextBusTick !== lastBus) { if (s.cpaNextBusTick > lastBus) M.counts.busRaids++; lastBus = s.cpaNextBusTick; }

    // ---- sampling ----
    if (s.tick % SAMPLE === 0) {
      const w = s.world;
      let flips = 0;
      for (let t = 0; t < w.owner.length; t++) if (w.owner[t] !== prevOwner[t]) flips++;
      prevOwner = Uint32Array.from(w.owner);
      M.flipsPerSample.push(flips);
      if (M.firstFlipTick < 0 && s.players.some((p) => p.ownedTiles > (initOwned.get(p.id) ?? 0))) M.firstFlipTick = s.tick;
      if (M.firstContactTick < 0 && s.players.some((p) => p.alive && hasContact(w, p.id))) M.firstContactTick = s.tick;
      const souls = soulsByOwner(w);
      let leader = 0, lv = -1;
      for (const p of s.players) { const v = souls.get(p.id) ?? 0; if (p.alive && v > lv) { lv = v; leader = p.id; } }
      const second = Math.max(0, ...s.players.filter((p) => p.alive && p.id !== leader).map((p) => souls.get(p.id) ?? 0));
      if (curLeader && leader !== curLeader) M.leadChanges++;
      curLeader = leader;
      M.leaderTimeline.push([s.tick, leader, +(lv / s.totalPop).toFixed(3), +(second / s.totalPop).toFixed(3)]);
      if (s.tick === 5 * 60 * TPS) M.leaderAt5 = leader;
      const minute = s.tick / (60 * TPS);
      for (const p of s.players) {
        if (!archOf.has(p.id) || !p.spawned) continue;
        const A = agg.byArch[p.archetype];
        if (CHECKPOINTS_MIN.includes(minute)) {
          A.tilesAt[minute] += p.ownedTiles; A.tilesAtN[minute]++;
          A.soulShareAt[minute] += (souls.get(p.id) ?? 0) / s.totalPop;
        }
        if (!p.alive) continue;
        A.samples++;
        A.followers += toF(p.followers); A.flock += toF(p.followers) + p.cohorts.reduce((a, c) => a + toF(c.mass), 0); A.usd += toF(p.usd); A.faith += toF(p.faith);
        const h = toF(p.heat); A.heat += h; if (h >= 60) A.heat60++; if (h >= 85) A.heat85++;
        A.dissent += dissentAvg(w, p.id);
        A.usdMax = Math.max(A.usdMax, toF(p.usd));
      }
    }
  }

  // ---- end of match ----
  M.endTick = s.tick;
  M.counts.scandalsPublished = s.recap.scandals.length;
  M.counts.schisms = s.recap.schisms.length;
  M.counts.betrayals = s.recap.betrayals.length;
  M.counts.prophecies = s.recap.prophecies.length;
  M.counts.prophecyFulfilled = s.recap.prophecies.filter((x) => x.fulfilled).length;
  const souls = soulsByOwner(s.world);
  const winnerP = s.players.find((p) => p.id === s.winner);
  M.winner = winnerP ? { id: winnerP.id, arch: winnerP.archetype, splinter: !archOf.has(winnerP.id) } : null;
  if (winnerP) {
    const share = (souls.get(winnerP.id) ?? 0) * 1000 / s.totalPop;
    const contenders = s.players.filter((p) => p.alive && p.spawned).length;
    M.reason = share >= s.dominationPermille ? "domination"
      : contenders === 1 ? "last_standing"
      : getArchetype(winnerP.archetype).victory?.achieved(s, winnerP, balance) ? "victory_path"
      : s.tick >= TIMER ? "timer" : "other";
  }
  M.leaderAt5Won = M.leaderAt5 != null && winnerP ? M.leaderAt5 === winnerP.id : null;
  const standings = s.players.filter((p) => archOf.has(p.id)).sort((a, b) => (souls.get(b.id) ?? 0) - (souls.get(a.id) ?? 0));
  standings.forEach((p, i) => {
    const A = agg.byArch[p.archetype];
    A.seats++; A.placeSum += i + 1; A.doctrines += p.doctrine.length; A.usdEarned += toF(p.usdEarned);
    if (!p.alive) A.eliminated++;
    if (winnerP && winnerP.id === p.id) A.wins++;
  });
  M.final = s.players.map((p) => ({ id: p.id, arch: p.archetype, alive: p.alive, tiles: p.ownedTiles,
    souls: souls.get(p.id) ?? 0, usd: Math.round(toF(p.usd)), followers: Math.round(toF(p.followers)), heat: +toF(p.heat).toFixed(1), doctrine: p.doctrine.length }));
  for (const k of Object.keys(M)) if (k.startsWith("aff_")) delete M[k];
  agg.matches.push(M);
  process.stderr.write(`match ${m + 1}/${MATCHES} ${townType} end=${(M.endTick / 600).toFixed(1)}m winner=${M.winner?.arch} ${M.reason} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
}

// ---------- report ----------
const ms = agg.matches;
const N = ms.length;
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x) => (x * 100).toFixed(0) + "%";
const L = [];
L.push(`FLOCK play-loop telemetry — ${N} matches, ${PLAYERS}p church bots, ${WORLD}², timer ${TIMER / 600}min (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
const reasons = {};
for (const x of ms) reasons[x.reason] = (reasons[x.reason] ?? 0) + 1;
L.push(`end reasons: ${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(", ")} | avg length ${(avg(ms.map((x) => x.endTick)) / 600).toFixed(1)}min`);
const l5 = ms.filter((x) => x.leaderAt5Won !== null);
L.push(`snowball: 5:00 soul-leader wins ${l5.filter((x) => x.leaderAt5Won).length}/${l5.length} | lead changes avg ${avg(ms.map((x) => x.leadChanges)).toFixed(1)} (max ${Math.max(...ms.map((x) => x.leadChanges))})`);
const shareAt = (min) => avg(ms.map((x) => x.leaderTimeline.find((r) => r[0] === min * 600)).filter(Boolean).map((r) => r[2]));
const gapAt = (min) => avg(ms.map((x) => x.leaderTimeline.find((r) => r[0] === min * 600)).filter(Boolean).map((r) => r[2] - r[3]));
L.push(`leader soul share (of town pop) @2/5/10/15/20m: ${CHECKPOINTS_MIN.map((m) => pct(shareAt(m))).join(" / ")}  | lead over 2nd: ${CHECKPOINTS_MIN.map((m) => pct(gapAt(m))).join(" / ")}`);
L.push(`pacing: first flip ${(avg(ms.map((x) => x.firstFlipTick)) / 10).toFixed(0)}s, first rival contact ${(avg(ms.filter((x) => x.firstContactTick >= 0).map((x) => x.firstContactTick)) / 10).toFixed(0)}s (${ms.filter((x) => x.firstContactTick >= 0).length}/${N} matches)`);
// flips per 10s by minute bucket
const buckets = [0, 2, 5, 10, 15, 20];
const flipB = [];
for (let i = 0; i < buckets.length - 1; i++) {
  const a = buckets[i] * 6, b = buckets[i + 1] * 6;
  flipB.push(avg(ms.flatMap((x) => x.flipsPerSample.slice(a, b))).toFixed(0));
}
L.push(`tile flips per 10s, by phase 0-2/2-5/5-10/10-15/15-20m: ${flipB.join(" / ")}`);
const quiet = avg(ms.map((x) => x.flipsPerSample.filter((f) => f < 3).length / Math.max(1, x.flipsPerSample.length)));
L.push(`dead-air: ${pct(quiet)} of 10s windows had <3 tile flips town-wide`);
L.push(`eliminations: ${ms.reduce((a, x) => a + x.eliminations.filter((e) => !e.splinter).length, 0)} seats (+${ms.reduce((a, x) => a + x.eliminations.filter((e) => e.splinter).length, 0)} splinters) | first-elim avg ${(avg(ms.flatMap((x) => x.eliminations.filter((e) => !e.splinter).slice(0, 1).map((e) => e.tick))) / 600).toFixed(1)}m`);
L.push("");
L.push("arch      win  place elim | idle/flock  earned$   usd(avg/max)  faith heat h>=60 h>=85 dissent | tiles@2/5/10/15/20m        doc");
for (const a of ARCHES) {
  const A = agg.byArch[a];
  const sN = Math.max(1, A.samples);
  const tiles = CHECKPOINTS_MIN.map((m) => (A.tilesAtN[m] ? (A.tilesAt[m] / A.tilesAtN[m]).toFixed(0) : "-").padStart(4)).join("");
  L.push(`${a.padEnd(9)} ${String(A.wins).padStart(3)} ${(A.placeSum / Math.max(1, A.seats)).toFixed(2).padStart(5)} ${String(A.eliminated).padStart(4)} | ${(A.followers / sN).toFixed(0).padStart(4)}/${(A.flock / sN).toFixed(0).padEnd(5)} ${(A.usdEarned / Math.max(1, A.seats)).toFixed(0).padStart(7)} ${(A.usd / sN).toFixed(0).padStart(7)}/${A.usdMax.toFixed(0).padEnd(7)} ${(A.faith / sN).toFixed(0).padStart(5)} ${(A.heat / sN).toFixed(0).padStart(4)} ${pct(A.heat60 / sN).padStart(5)} ${pct(A.heat85 / sN).padStart(5)} ${(A.dissent / sN).toFixed(1).padStart(7)} | ${tiles}   ${(A.doctrines / Math.max(1, A.seats)).toFixed(1)}`);
}
L.push("");
L.push("abilities (scripted caster; attempts→fired; first affordable avg):");
for (const a of ARCHES) {
  const A = agg.byArch[a];
  const parts = getArchetype(a).abilities.map((ab) => {
    const f = A.firstAffordTick[ab.id];
    return `${ab.id} ${A.abilityAttempts[ab.id] ?? 0}→${A.abilityFired[ab.id] ?? 0} (afford@${f ? (avg(f) / 10).toFixed(0) + "s" : "never"})`;
  });
  L.push(`  ${a.padEnd(9)} ${parts.join(" | ")}`);
}
const sumC = (k) => ms.reduce((a, x) => a + x.counts[k], 0);
L.push("");
L.push(`systems per match (avg): decrees ${(sumC("decrees") / N).toFixed(1)}, doctrines ${(sumC("doctrines") / N).toFixed(1)}, scandals ${(sumC("scandalsPublished") / N).toFixed(2)}, schisms ${(sumC("schisms") / N).toFixed(2)}, pickets ${(sumC("picketsSpawned") / N).toFixed(1)}, bus raids ${(sumC("busRaids") / N).toFixed(1)}`);
L.push(`  strikes ${(sumC("strikes") / N).toFixed(1)}, couriers ${(sumC("couriers") / N).toFixed(1)}, agents ${(sumC("agents") / N).toFixed(1)}, vans ${(sumC("vans") / N).toFixed(1)}, alliances ${(sumC("alliances") / N).toFixed(1)}, betrayals ${(sumC("betrayals") / N).toFixed(1)}, prophecies ${(sumC("prophecies") / N).toFixed(2)} (fulfilled ${sumC("prophecyFulfilled")})`);
const bl = {};
for (const x of ms) for (const [k, v] of Object.entries(x.counts.buildings)) bl[k] = (bl[k] ?? 0) + v;
L.push(`  buildings: ${Object.entries(bl).map(([k, v]) => `${k} ${(v / N).toFixed(1)}`).join(", ") || "none"}`);
L.push(`intents sent (total): ${Object.entries(agg.intentsSent).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
const never = Object.values(IntentType).filter((t) => !agg.intentsSent[t]);
L.push(`intent types never sent by bots: ${never.join(", ")}`);
L.push(`by town type: ${TYPES.map((t) => { const xs = ms.filter((x) => x.townType === t); return `${t} ${xs.length}m ${(avg(xs.map((x) => x.endTick)) / 600).toFixed(1)}min`; }).join(", ")}`);
console.log(L.join("\n"));
writeFileSync(OUT, JSON.stringify({ config: { MATCHES, PLAYERS, WORLD, TIMER, BASE_SEED }, byArch: agg.byArch, intentsSent: agg.intentsSent, matches: ms.map((x) => ({ ...x, leaderTimeline: x.leaderTimeline })) }, null, 1));
