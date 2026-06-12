/**
 * FLOCK server entry (§32–34). Skeleton: a master process that will own the
 * Lobby Director (matchmaking, AI backfill, region routing) and spawn one
 * pinned Match Worker per match. The lockstep loop (validate Intents → bundle
 * Turn at 100ms → broadcast, with StateHash every 50 turns) lives in the worker.
 *
 * This stub proves the @flock/sim dependency wires up and the package builds.
 * The full match worker + WSS transport is the delegated M0 server task.
 */

import { loadBalance, type RawBalance } from "@flock/sim";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

function main(): void {
  const raw = JSON.parse(
    readFileSync(resolve(here, "../../../balance.json"), "utf8"),
  ) as RawBalance;
  const balance = loadBalance(raw);
  // eslint-disable-next-line no-console
  console.log(
    `[flock-server] up. tick=${balance.tickMs}ms hashEvery=${balance.hashEveryTurns} turns. ` +
      `Lobby Director + Match Workers not yet implemented.`,
  );
}

main();
