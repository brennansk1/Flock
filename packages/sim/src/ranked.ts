/**
 * Ranked rating (§20) — Glicko-2. This is a META system, deliberately OUTSIDE
 * the lockstep sim scope: it never runs inside step()/hashState(), so it is the
 * one place in @flock/sim that is allowed to use floats (Glicko-2 is defined in
 * real arithmetic). It consumes only match *outcomes*, never live sim state.
 *
 * 1v1 uses the standard single-opponent update. Ranked FFA decomposes a final
 * placement into pairwise results (each match = up-to-15 implicit pairings,
 * down-weighted to 0.4) before feeding the same update — exactly per §20.
 */

const SCALE = 173.7178; // Glicko-2 ↔ Glicko conversion constant
export const DEFAULT_RATING = 1500;
export const DEFAULT_RD = 350;
export const DEFAULT_VOL = 0.06;
const TAU = 0.5; // system volatility constraint
const EPSILON = 0.000001;
const FFA_WEIGHT = 0.4; // §20: pairwise FFA results weighted 0.4

export interface Rating {
  rating: number; // public Glicko rating (μ=1500 baseline)
  rd: number; // rating deviation (φ on the public scale)
  vol: number; // σ volatility
}

/** A single scored result against one opponent: 1 win, 0.5 draw, 0 loss. */
export interface GameResult {
  opponent: Rating;
  score: number;
  /** match-type weight (1 for 1v1, FFA_WEIGHT for decomposed FFA pairings). */
  weight?: number;
}

export function newRating(): Rating {
  return { rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL };
}

const g = (phi: number): number => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expectation = (mu: number, muj: number, phij: number): number =>
  1 / (1 + Math.exp(-g(phij) * (mu - muj)));

/**
 * Update one player's rating from a batch of results in the same period.
 * Implements Glashan/Glickman's Glicko-2 with the Illusion(Illinois) volatility
 * solver. An empty result set still decays certainty (RD grows) per the spec.
 */
export function updateRating(player: Rating, results: GameResult[]): Rating {
  const mu = (player.rating - DEFAULT_RATING) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.vol;

  if (results.length === 0) {
    // no games: rating unchanged, RD inflates toward the prior (decay)
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: Math.min(DEFAULT_RD, phiStar * SCALE), vol: sigma };
  }

  let vInv = 0;
  let deltaSum = 0;
  for (const r of results) {
    const muj = (r.opponent.rating - DEFAULT_RATING) / SCALE;
    const phij = r.opponent.rd / SCALE;
    const gj = g(phij);
    const e = expectation(mu, muj, phij);
    const w = r.weight ?? 1;
    vInv += w * gj * gj * e * (1 - e);
    deltaSum += w * gj * (r.score - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // volatility update (Illinois root-find on f(x))
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * (phi * phi + v + ex) * (phi * phi + v + ex);
    return num / den - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  const sigmaPrime = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * deltaSum;

  return {
    rating: muPrime * SCALE + DEFAULT_RATING,
    rd: phiPrime * SCALE,
    vol: sigmaPrime,
  };
}

/**
 * Ranked FFA (§20): turn a finishing order into per-player pairwise results.
 * `placements` is the ratings in finishing order (index 0 = winner). Each
 * player scores 1 vs everyone they outplaced, 0 vs everyone above them, all at
 * FFA_WEIGHT. Returns a new Rating per input slot, index-aligned to `placements`.
 */
export function updateFFA(placements: Rating[]): Rating[] {
  return placements.map((me, i) => {
    const results: GameResult[] = [];
    for (let j = 0; j < placements.length; j++) {
      if (j === i) continue;
      results.push({
        opponent: placements[j]!,
        score: i < j ? 1 : 0, // earlier index = better placement
        weight: FFA_WEIGHT,
      });
    }
    return updateRating(me, results);
  });
}

export type Tier =
  | "Acolyte"
  | "Deacon"
  | "Minister"
  | "Cardinal"
  | "Oracle"
  | "Prophet";

/**
 * Tier from rating (§20). PROPHET is a top-500 leaderboard cut, not a rating
 * threshold, so it is signalled separately via `isProphet`.
 */
export function tierFor(rating: number, isProphet = false): Tier {
  if (isProphet) return "Prophet";
  if (rating >= 2200) return "Oracle";
  if (rating >= 2000) return "Cardinal";
  if (rating >= 1800) return "Minister";
  if (rating >= 1600) return "Deacon";
  return "Acolyte"; // entry band — new accounts start here at 1500
}

/** Seasonal soft reset (§20): pull halfway back toward the 1500 baseline. */
export function seasonalReset(r: Rating): Rating {
  return {
    rating: DEFAULT_RATING + (r.rating - DEFAULT_RATING) * 0.5,
    rd: Math.max(r.rd, DEFAULT_RD * 0.5),
    vol: r.vol,
  };
}
