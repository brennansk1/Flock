/**
 * Trust & safety (§22/§30). Two jobs: keep cult names inside the tone
 * guardrails (fictional, non-offensive — names that fail render as the default
 * "Sect #id" until human review, per §30) and mask profanity in chat. This is a
 * lightweight launch filter; production routes flagged content to human review
 * and supports per-locale lists, but the call sites here are the right seams.
 */

// A deliberately small seed list — real deployments load a maintained,
// locale-aware blocklist. Matching is substring + leetspeak-normalized.
const BLOCKLIST = [
  "fuck", "shit", "cunt", "bitch", "nigger", "faggot", "rape", "nazi", "hitler",
  "kike", "spic", "chink", "retard", "slut", "whore",
];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };

/** Normalize for matching: lowercase, de-leet, strip non-letters, collapse runs. */
function normalize(s: string): string {
  const deleet = s
    .toLowerCase()
    .split("")
    .map((c) => LEET[c] ?? c)
    .join("");
  return deleet.replace(/[^a-z]/g, "").replace(/(.)\1+/g, "$1");
}

export function containsProfanity(s: string): boolean {
  const n = normalize(s);
  return BLOCKLIST.some((w) => n.includes(normalize(w)));
}

export interface NameVerdict {
  ok: boolean;
  /** safe display string — the cleaned name, or a placeholder when it defaults. */
  display: string;
}

const CONTROL = /[\x00-\x1f\x7f]/g;

/**
 * Moderate a cult/player name. Trims, length-clamps, strips control chars. If
 * it trips the filter or is empty after cleaning, `ok` is false and the caller
 * should fall back to "Sect #id" (§30); we still return a cleaned `display` for
 * callers that prefer a placeholder string.
 */
export function moderateName(raw: string): NameVerdict {
  const cleaned = (raw ?? "")
    .replace(CONTROL, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  if (cleaned.length === 0 || containsProfanity(cleaned)) {
    return { ok: false, display: cleaned.length === 0 ? "Pilgrim" : "Sect" };
  }
  return { ok: true, display: cleaned };
}

/** Mask profanity in a chat line; clamp length. Returns the safe-to-relay text. */
export function moderateChat(raw: string): { allowed: boolean; text: string } {
  const text = (raw ?? "").replace(CONTROL, "").slice(0, 200).trim();
  if (text.length === 0) return { allowed: false, text: "" };
  const masked = text
    .split(/(\s+)/)
    .map((tok) => (containsProfanity(tok) ? "*".repeat(Math.max(1, tok.length)) : tok))
    .join("");
  return { allowed: true, text: masked };
}
