/**
 * Persistence layer (§34). Everything that must outlive a match — accounts,
 * ratings, progression, match history, replays — lives behind the `Store`
 * interface so the hosted deployment can swap the in-memory/JSON dev adapters
 * for Postgres + object storage without touching game code.
 *
 * The interface is async on purpose: the in-memory and file adapters resolve
 * synchronously, but a real database adapter won't, and callers already await.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { newRating, type Rating } from "@flock/sim";

export interface Account {
  id: string;
  name: string;
  createdAt: number;
  /** guest accounts have no durable identity until they link a provider. */
  guest: boolean;
  /** "guest" | "google" | "discord" | "email" */
  provider: string;
  /** external subject id for linked providers; "" for guests. */
  providerSub: string;
  level: number;
  xpIntoLevel: number;
  relics: number;
  shards: number;
  rating: Rating;
  /** top-500 leaderboard flag (§20), recomputed by the ranked service. */
  isProphet: boolean;
  banned: boolean;
  /** archetypes unlocked beyond the free rotation (§22). */
  unlocks: string[];
}

export interface MatchParticipant {
  accountId: string;
  placement: number;
  xp: number;
  relics: number;
  ratingBefore: number;
  ratingAfter: number;
}

export interface MatchRecord {
  id: string;
  seed: number;
  startedAt: number;
  endedAt: number;
  durationTicks: number;
  winner: string | null;
  participants: MatchParticipant[];
}

/** A Congregation (clan, §24): ≤50 members, moderated tag, shared banner. */
export interface Congregation {
  id: string;
  name: string;
  tag: string;
  bannerCosmetic: string;
  ownerId: string;
  members: string[];
  createdAt: number;
}

export const CONGREGATION_MAX_MEMBERS = 50; // §24

export interface Store {
  getAccount(id: string): Promise<Account | null>;
  getByProvider(provider: string, sub: string): Promise<Account | null>;
  createAccount(init: Partial<Account> & { name: string; guest: boolean }): Promise<Account>;
  saveAccount(acc: Account): Promise<void>;
  recordMatch(rec: MatchRecord): Promise<void>;
  listMatches(accountId: string, limit: number): Promise<MatchRecord[]>;
  /** leaderboard / Prophet-tier cut: highest ratings first. */
  topRatings(limit: number): Promise<Account[]>;
  saveReplay(id: string, data: unknown): Promise<void>;
  loadReplay(id: string): Promise<unknown | null>;

  createCongregation(c: Congregation): Promise<void>;
  getCongregation(id: string): Promise<Congregation | null>;
  saveCongregation(c: Congregation): Promise<void>;
  listCongregations(): Promise<Congregation[]>;
}

let counter = 0;
/** Monotonic-ish id; deterministic enough for tests, unique in a process. */
export function newId(prefix = "acc"): string {
  counter = (counter + 1) >>> 0;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

function freshAccount(init: Partial<Account> & { name: string; guest: boolean }): Account {
  return {
    id: init.id ?? newId(),
    name: init.name,
    createdAt: init.createdAt ?? Date.now(),
    guest: init.guest,
    provider: init.provider ?? (init.guest ? "guest" : "email"),
    providerSub: init.providerSub ?? "",
    level: init.level ?? 1,
    xpIntoLevel: init.xpIntoLevel ?? 0,
    relics: init.relics ?? 0,
    shards: init.shards ?? 0,
    rating: init.rating ?? newRating(),
    isProphet: init.isProphet ?? false,
    banned: init.banned ?? false,
    unlocks: init.unlocks ?? [],
  };
}

/** Volatile store — the default for tests and single-process dev. */
export class InMemoryStore implements Store {
  protected accounts = new Map<string, Account>();
  protected matches: MatchRecord[] = [];
  protected replays = new Map<string, unknown>();
  protected congregations = new Map<string, Congregation>();

  async getAccount(id: string): Promise<Account | null> {
    return this.accounts.get(id) ?? null;
  }
  async getByProvider(provider: string, sub: string): Promise<Account | null> {
    for (const a of this.accounts.values()) if (a.provider === provider && a.providerSub === sub) return a;
    return null;
  }
  async createAccount(init: Partial<Account> & { name: string; guest: boolean }): Promise<Account> {
    const acc = freshAccount(init);
    this.accounts.set(acc.id, acc);
    return acc;
  }
  async saveAccount(acc: Account): Promise<void> {
    this.accounts.set(acc.id, acc);
  }
  async recordMatch(rec: MatchRecord): Promise<void> {
    this.matches.push(rec);
  }
  async listMatches(accountId: string, limit: number): Promise<MatchRecord[]> {
    return this.matches
      .filter((m) => m.participants.some((p) => p.accountId === accountId))
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, limit);
  }
  async topRatings(limit: number): Promise<Account[]> {
    return [...this.accounts.values()]
      .filter((a) => !a.guest && !a.banned)
      .sort((a, b) => b.rating.rating - a.rating.rating)
      .slice(0, limit);
  }
  async saveReplay(id: string, data: unknown): Promise<void> {
    this.replays.set(id, data);
  }
  async loadReplay(id: string): Promise<unknown | null> {
    return this.replays.get(id) ?? null;
  }
  async createCongregation(c: Congregation): Promise<void> {
    this.congregations.set(c.id, c);
  }
  async getCongregation(id: string): Promise<Congregation | null> {
    return this.congregations.get(id) ?? null;
  }
  async saveCongregation(c: Congregation): Promise<void> {
    this.congregations.set(c.id, c);
  }
  async listCongregations(): Promise<Congregation[]> {
    return [...this.congregations.values()];
  }
}

/**
 * Durable dev adapter: writes JSON under a directory so accounts/ratings
 * survive a server restart. Not for production scale (no concurrency control),
 * but it makes local multiplayer feel real and documents the persistence shape.
 */
export class JsonFileStore extends InMemoryStore {
  constructor(private readonly dir: string) {
    super();
    mkdirSync(join(dir, "replays"), { recursive: true });
    this.load();
  }
  private accountsPath(): string {
    return join(this.dir, "accounts.json");
  }
  private matchesPath(): string {
    return join(this.dir, "matches.json");
  }
  private congsPath(): string {
    return join(this.dir, "congregations.json");
  }
  private flushCongs(): void {
    writeFileSync(this.congsPath(), JSON.stringify([...this.congregations.values()]));
  }
  private load(): void {
    if (existsSync(this.accountsPath())) {
      const arr = JSON.parse(readFileSync(this.accountsPath(), "utf8")) as Account[];
      for (const a of arr) this.accounts.set(a.id, a);
    }
    if (existsSync(this.matchesPath())) {
      this.matches = JSON.parse(readFileSync(this.matchesPath(), "utf8")) as MatchRecord[];
    }
    if (existsSync(this.congsPath())) {
      for (const c of JSON.parse(readFileSync(this.congsPath(), "utf8")) as Congregation[]) {
        this.congregations.set(c.id, c);
      }
    }
    for (const f of existsSync(join(this.dir, "replays")) ? readdirSync(join(this.dir, "replays")) : []) {
      if (f.endsWith(".json")) {
        this.replays.set(f.slice(0, -5), JSON.parse(readFileSync(join(this.dir, "replays", f), "utf8")));
      }
    }
  }
  private flushAccounts(): void {
    writeFileSync(this.accountsPath(), JSON.stringify([...this.accounts.values()]));
  }
  override async createAccount(init: Partial<Account> & { name: string; guest: boolean }): Promise<Account> {
    const acc = await super.createAccount(init);
    this.flushAccounts();
    return acc;
  }
  override async saveAccount(acc: Account): Promise<void> {
    await super.saveAccount(acc);
    this.flushAccounts();
  }
  override async recordMatch(rec: MatchRecord): Promise<void> {
    await super.recordMatch(rec);
    writeFileSync(this.matchesPath(), JSON.stringify(this.matches));
  }
  override async saveReplay(id: string, data: unknown): Promise<void> {
    await super.saveReplay(id, data);
    writeFileSync(join(this.dir, "replays", `${id}.json`), JSON.stringify(data));
  }
  override async createCongregation(c: Congregation): Promise<void> {
    await super.createCongregation(c);
    this.flushCongs();
  }
  override async saveCongregation(c: Congregation): Promise<void> {
    await super.saveCongregation(c);
    this.flushCongs();
  }
}
