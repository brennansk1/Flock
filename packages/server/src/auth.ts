/**
 * Auth (§22/§26). FTUE promises "no account wall before fun": guests get a
 * playable identity instantly, and can later link a provider to make it
 * durable. Sessions are stateless HMAC-signed tokens so any worker can verify
 * them without a shared session store.
 *
 * Real OAuth (Google/Discord/email) plugs in via the AuthProvider interface —
 * the verify() call is where you'd validate the provider's token against their
 * API. The guest path and session signing are fully implemented and tested;
 * provider adapters are the deployment's responsibility (secrets live in env).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { moderateName } from "./moderation.js";
import type { Store, Account } from "./store.js";

/** A provider validates an external credential and returns a stable subject. */
export interface AuthProvider {
  readonly name: string;
  verify(token: string): Promise<{ sub: string; name?: string } | null>;
}

export interface Session {
  accountId: string;
  /** issued-at, ms */
  iat: number;
}

const b64u = (s: string): string => Buffer.from(s).toString("base64url");
const unb64u = (s: string): string => Buffer.from(s, "base64url").toString("utf8");

export class AuthService {
  private readonly providers = new Map<string, AuthProvider>();

  constructor(
    private readonly store: Store,
    private readonly secret: string,
    /** session lifetime in ms (default 30 days). */
    private readonly ttlMs = 30 * 24 * 3600 * 1000,
  ) {
    if (!secret || secret.length < 16) {
      throw new Error("AuthService requires a secret of at least 16 chars (set FLOCK_SECRET)");
    }
  }

  registerProvider(p: AuthProvider): void {
    this.providers.set(p.name, p);
  }

  /** Sign a stateless session token: base64url(payload).hmac. */
  issueSession(accountId: string): string {
    const payload = b64u(JSON.stringify({ accountId, iat: Date.now() } satisfies Session));
    return `${payload}.${this.sign(payload)}`;
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  verifySession(token: string): Session | null {
    const dot = token.lastIndexOf(".");
    if (dot <= 0) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = this.sign(payload);
    // constant-time compare to avoid signature-timing leaks
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    let parsed: Session;
    try {
      parsed = JSON.parse(unb64u(payload)) as Session;
    } catch {
      return null;
    }
    if (Date.now() - parsed.iat > this.ttlMs) return null;
    return parsed;
  }

  /** Instant guest identity (§26). Name is moderated to a safe display form. */
  async guestLogin(rawName: string): Promise<{ account: Account; session: string }> {
    const { display } = moderateName(rawName);
    const account = await this.store.createAccount({ name: display, guest: true, provider: "guest" });
    return { account, session: this.issueSession(account.id) };
  }

  /**
   * Link/login via a registered provider. Creates the account on first sight,
   * otherwise returns the existing one. Upgrades a guest if `linkGuestId` given.
   */
  async providerLogin(
    provider: string,
    externalToken: string,
    linkGuestId?: string,
  ): Promise<{ account: Account; session: string } | null> {
    const p = this.providers.get(provider);
    if (!p) return null;
    const verified = await p.verify(externalToken);
    if (!verified) return null;

    const existing = await this.store.getByProvider(provider, verified.sub);
    if (existing) return { account: existing, session: this.issueSession(existing.id) };

    if (linkGuestId) {
      const guest = await this.store.getAccount(linkGuestId);
      if (guest && guest.guest) {
        guest.guest = false;
        guest.provider = provider;
        guest.providerSub = verified.sub;
        if (verified.name) guest.name = moderateName(verified.name).display;
        await this.store.saveAccount(guest);
        return { account: guest, session: this.issueSession(guest.id) };
      }
    }

    const account = await this.store.createAccount({
      name: moderateName(verified.name ?? "Pilgrim").display,
      guest: false,
      provider,
      providerSub: verified.sub,
    });
    return { account, session: this.issueSession(account.id) };
  }

  /** Resolve a session token to its (non-banned) account, or null. */
  async authenticate(token: string): Promise<Account | null> {
    const s = this.verifySession(token);
    if (!s) return null;
    const acc = await this.store.getAccount(s.accountId);
    if (!acc || acc.banned) return null;
    return acc;
  }
}
