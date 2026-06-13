/**
 * Server services (§22/§34): persistence (Store adapters), auth (guest +
 * stateless signed sessions + provider linking), moderation (name/chat filter),
 * and the match-result persistence pipeline (real Glicko-2 + progression).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryStore, JsonFileStore } from "../dist/store.js";
import { AuthService } from "../dist/auth.js";
import { moderateName, moderateChat, containsProfanity } from "../dist/moderation.js";
import { persistMatch } from "../dist/lobby.js";
import { CongregationService } from "../dist/congregations.js";

test("InMemoryStore: account CRUD, match history, leaderboard", async () => {
  const s = new InMemoryStore();
  const a = await s.createAccount({ name: "Mae", guest: false });
  assert.equal((await s.getAccount(a.id))?.name, "Mae");
  a.rating.rating = 1800;
  await s.saveAccount(a);
  const b = await s.createAccount({ name: "Tiber", guest: false });
  b.rating.rating = 1600;
  await s.saveAccount(b);
  const guest = await s.createAccount({ name: "G", guest: true });
  guest.rating.rating = 2000;
  await s.saveAccount(guest);
  const top = await s.topRatings(10);
  assert.deepEqual(top.map((x) => x.name), ["Mae", "Tiber"], "guests excluded, sorted desc");
});

test("JsonFileStore persists accounts across reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flock-store-"));
  const s1 = new JsonFileStore(dir);
  const acc = await s1.createAccount({ name: "Persisted", guest: false });
  acc.relics = 42;
  await s1.saveAccount(acc);
  await s1.saveReplay("m1", { seed: 7, finalHash: "abc", turns: [] });

  const s2 = new JsonFileStore(dir); // reopen
  assert.equal((await s2.getAccount(acc.id))?.relics, 42, "account survived restart");
  assert.deepEqual(await s2.loadReplay("m1"), { seed: 7, finalHash: "abc", turns: [] });
});

test("AuthService: guest login, session sign/verify, tamper rejection", async () => {
  const store = new InMemoryStore();
  const auth = new AuthService(store, "a-sufficiently-long-secret");
  const { account, session } = await auth.guestLogin("Brother Cleetus");
  assert.ok(account.guest);
  assert.equal((await auth.authenticate(session))?.id, account.id, "valid session resolves");

  assert.equal(auth.verifySession("garbage"), null);
  assert.equal(auth.verifySession(session + "x"), null, "tampered signature rejected");
  const [payload] = session.split(".");
  assert.equal(auth.verifySession(`${payload}.deadbeef`), null, "forged signature rejected");
});

test("AuthService: provider login creates then links a guest", async () => {
  const store = new InMemoryStore();
  const auth = new AuthService(store, "a-sufficiently-long-secret");
  auth.registerProvider({
    name: "google",
    verify: async (t) => (t === "good-token" ? { sub: "g-123", name: "Real Name" } : null),
  });
  assert.equal(await auth.providerLogin("google", "bad"), null, "bad token rejected");

  const guest = await auth.guestLogin("Temp");
  const linked = await auth.providerLogin("google", "good-token", guest.account.id);
  assert.ok(linked && !linked.account.guest, "guest upgraded to linked account");
  assert.equal(linked!.account.id, guest.account.id, "same account id preserved");

  // logging in again with the same provider returns the same account
  const again = await auth.providerLogin("google", "good-token");
  assert.equal(again!.account.id, guest.account.id);
});

test("moderation: names and chat", () => {
  assert.equal(moderateName("Gary's Pond Truthers").ok, true);
  assert.equal(moderateName("   ").ok, false, "empty defaults");
  assert.equal(moderateName("you are a sh1t").ok, false, "leetspeak profanity caught");
  assert.ok(containsProfanity("f.u.c.k"));
  assert.equal(containsProfanity("classic assembly"), false, "no false positive on substrings");
  const chat = moderateChat("hello you shit");
  assert.ok(chat.allowed && chat.text.includes("****"), `masked: ${chat.text}`);
});

test("persistMatch: progression advances and ratings update in placement order", async () => {
  const store = new InMemoryStore();
  const winner = await store.createAccount({ name: "Winner", guest: false });
  const loser = await store.createAccount({ name: "Loser", guest: false });
  const w0 = winner.rating.rating;
  const l0 = loser.rating.rating;

  const info = {
    matchId: "m_test",
    seed: 123,
    durationTicks: 6000,
    winnerPlayerId: 1,
    recap: { winner: 1, durationTicks: 6000, players: [] },
    results: [
      { player: 1, placement: 1, xp: 200, relics: 25, provisionalRating: 1560 },
      { player: 2, placement: 2, xp: 80, relics: 12, provisionalRating: 1440 },
    ],
    accountOf: new Map([
      [1, winner.id],
      [2, loser.id],
    ]),
    replay: { seed: 123, finalHash: "h", turns: [] },
  };

  const record = await persistMatch(store, info as never);
  const w = (await store.getAccount(winner.id))!;
  const l = (await store.getAccount(loser.id))!;
  assert.ok(w.rating.rating > w0, "winner rating climbs");
  assert.ok(l.rating.rating < l0, "loser rating falls");
  assert.ok(w.relics >= 10 && w.xpIntoLevel + (w.level - 1) > 0, "winner gained progression");
  assert.equal(record.winner, winner.id);
  assert.equal(record.participants.length, 2);
  assert.deepEqual(await store.loadReplay("m_test"), info.replay, "replay archived");
});

test("guests gain progression but not persisted rating", async () => {
  const store = new InMemoryStore();
  const human = await store.createAccount({ name: "H", guest: false });
  const guest = await store.createAccount({ name: "G", guest: true });
  const g0 = guest.rating.rating;
  const info = {
    matchId: "m_g",
    seed: 1,
    durationTicks: 3000,
    winnerPlayerId: 1,
    recap: { winner: 1, durationTicks: 3000, players: [] },
    results: [
      { player: 1, placement: 1, xp: 100, relics: 20, provisionalRating: 1550 },
      { player: 2, placement: 2, xp: 50, relics: 10, provisionalRating: 1450 },
    ],
    accountOf: new Map([
      [1, human.id],
      [2, guest.id],
    ]),
    replay: { seed: 1, finalHash: "h", turns: [] },
  };
  await persistMatch(store, info as never);
  const g = (await store.getAccount(guest.id))!;
  assert.equal(g.rating.rating, g0, "guest rating untouched");
  assert.ok(g.relics > 0, "guest still earns relics/XP");
});

test("congregations: create/join/leave, tag validation, capacity, ownership", async () => {
  const store = new InMemoryStore();
  const cong = new CongregationService(store);
  const owner = await store.createAccount({ name: "Leader", guest: false });

  assert.equal((await cong.create(owner.id, "Good Name", "@@")).ok, false, "bad tag rejected");
  assert.equal((await cong.create(owner.id, "Good Name", "fuck")).ok, false, "profane tag rejected");
  const created = await cong.create(owner.id, "The Open Wallet", "WLT");
  assert.ok(created.ok && created.congregation, "valid creation");
  const id = created.congregation!.id;
  assert.equal(created.congregation!.tag, "WLT");

  const m1 = await store.createAccount({ name: "M1", guest: false });
  assert.ok((await cong.join(id, m1.id)).ok);
  assert.equal((await store.getCongregation(id))!.members.length, 2);

  // owner leaves → ownership passes
  await cong.leave(id, owner.id);
  const after = await store.getCongregation(id);
  assert.equal(after!.ownerId, m1.id, "ownership passed to remaining member");
});

test("congregation score sums members' best match results into a ladder", async () => {
  const store = new InMemoryStore();
  const cong = new CongregationService(store);
  const a = await store.createAccount({ name: "A", guest: false });
  const created = (await cong.create(a.id, "Scorers", "SCR")).congregation!;
  // give A two match results (1st and 3rd)
  await store.recordMatch({
    id: "x1", seed: 1, startedAt: 0, endedAt: 1, durationTicks: 10, winner: a.id,
    participants: [{ accountId: a.id, placement: 1, xp: 0, relics: 0, ratingBefore: 1500, ratingAfter: 1520 }],
  });
  await store.recordMatch({
    id: "x2", seed: 2, startedAt: 0, endedAt: 2, durationTicks: 10, winner: null,
    participants: [{ accountId: a.id, placement: 3, xp: 0, relics: 0, ratingBefore: 1520, ratingAfter: 1510 }],
  });
  assert.equal(await cong.score(created.id), 10 + 8, "1st(10) + 3rd(8)");
  const ladder = await cong.ladder();
  assert.equal(ladder[0]!.congregation.id, created.id);
  assert.equal(ladder[0]!.score, 18);
});
