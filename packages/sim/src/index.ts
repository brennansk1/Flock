/**
 * @flock/sim — the deterministic FLOCK simulation core.
 *
 * Runs bit-identically on client and server (§32). The public surface is the
 * sim lifecycle (createSim/step), the Intent protocol, the balance loader, and
 * the StateHash used by the lockstep desync check.
 */

export * from "./fixed.js";
export * from "./rng.js";
export * from "./types.js";
export * from "./intents.js";
export * from "./balance.js";
export * from "./hash.js";
export * from "./sim.js";
