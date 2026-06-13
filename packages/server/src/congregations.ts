/**
 * Congregations (clans, §24). ≤50 members, a moderated 2–4 char tag, a shared
 * banner cosmetic, and a weekly Congregation Score = sum of members' best-10
 * ranked results → a public ladder. Holy Wars tooling (§24) layers on top of
 * this membership model in EA.
 */

import { moderateName, containsProfanity } from "./moderation.js";
import { newId, CONGREGATION_MAX_MEMBERS, type Store, type Congregation, type MatchRecord } from "./store.js";

const TAG_RE = /^[A-Za-z0-9]{2,4}$/;

export interface CongregationResult {
  ok: boolean;
  reason?: string;
  congregation?: Congregation;
}

/** Placement → points for the Congregation Score (1st best, fades out). */
function matchPoints(rec: MatchRecord, accountId: string): number {
  const p = rec.participants.find((x) => x.accountId === accountId);
  if (!p) return 0;
  return Math.max(0, 11 - p.placement); // 1st=10, 2nd=9, … 11th+=0
}

export class CongregationService {
  constructor(private readonly store: Store) {}

  async create(ownerId: string, rawName: string, rawTag: string): Promise<CongregationResult> {
    const name = moderateName(rawName);
    if (!name.ok) return { ok: false, reason: "name not allowed" };
    const tag = rawTag.trim();
    if (!TAG_RE.test(tag) || containsProfanity(tag)) return { ok: false, reason: "tag must be 2–4 clean alphanumerics" };
    const c: Congregation = {
      id: newId("cong"),
      name: name.display,
      tag: tag.toUpperCase(),
      bannerCosmetic: "default",
      ownerId,
      members: [ownerId],
      createdAt: Date.now(),
    };
    await this.store.createCongregation(c);
    return { ok: true, congregation: c };
  }

  async join(congId: string, accountId: string): Promise<CongregationResult> {
    const c = await this.store.getCongregation(congId);
    if (!c) return { ok: false, reason: "no such congregation" };
    if (c.members.includes(accountId)) return { ok: true, congregation: c };
    if (c.members.length >= CONGREGATION_MAX_MEMBERS) return { ok: false, reason: "congregation full" };
    c.members.push(accountId);
    await this.store.saveCongregation(c);
    return { ok: true, congregation: c };
  }

  async leave(congId: string, accountId: string): Promise<CongregationResult> {
    const c = await this.store.getCongregation(congId);
    if (!c) return { ok: false, reason: "no such congregation" };
    c.members = c.members.filter((m) => m !== accountId);
    // ownership passes to the next member; an empty congregation is left as-is
    if (c.ownerId === accountId && c.members.length > 0) c.ownerId = c.members[0]!;
    await this.store.saveCongregation(c);
    return { ok: true, congregation: c };
  }

  /** Weekly score: sum over members of their best-10 match point totals. */
  async score(congId: string): Promise<number> {
    const c = await this.store.getCongregation(congId);
    if (!c) return 0;
    let total = 0;
    for (const m of c.members) {
      const matches = await this.store.listMatches(m, 100);
      const pts = matches.map((rec) => matchPoints(rec, m)).sort((a, b) => b - a).slice(0, 10);
      total += pts.reduce((s, x) => s + x, 0);
    }
    return total;
  }

  /** Public ladder: congregations sorted by score, descending. */
  async ladder(limit = 50): Promise<{ congregation: Congregation; score: number }[]> {
    const all = await this.store.listCongregations();
    const scored = await Promise.all(all.map(async (c) => ({ congregation: c, score: await this.score(c.id) })));
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
