/**
 * Plan-kit registry: which lots are composed by an author on the plan kit
 * (render/plan.ts) instead of the legacy per-tile / facade paths. Adding a
 * lot here (e.g. a DLC building) is the only hook the tile renderer needs.
 */
import { Lot } from "../types.js";
import type { Author } from "./plan.js";
import { bank, sheriff, postOffice, office, library, cinema, diner, supermarket, gasStation } from "./lots.js";
import { church, chapel } from "./faith.js";
import { powerhouse } from "./waterworks.js";
import { highSchool, school, playground, cemetery } from "./campus.js";
import { substation, waterTower, silo, barn, greenhouse, lighthouse, grainElevator, sawmill, cannery } from "./works.js";
import { megachurch, fairground, radioTower } from "./landmarks.js";

export const PLANNED: Partial<Record<number, Author>> = {
  [Lot.Bank]: bank,
  [Lot.Sheriff]: sheriff,
  [Lot.PostOffice]: postOffice,
  [Lot.Office]: office,
  [Lot.Library]: library,
  [Lot.Chapel]: chapel,
  [Lot.Church]: church,
  [Lot.Cinema]: cinema,
  [Lot.Diner]: diner,
  [Lot.Supermarket]: supermarket,
  [Lot.GasStation]: gasStation,
  [Lot.HighSchool]: highSchool,
  [Lot.School]: school,
  [Lot.Playground]: playground,
  [Lot.Cemetery]: cemetery,
  [Lot.Substation]: substation,
  [Lot.WaterTower]: waterTower,
  [Lot.Silo]: silo,
  [Lot.Barn]: barn,
  [Lot.Greenhouse]: greenhouse,
  [Lot.Lighthouse]: lighthouse,
  [Lot.Powerhouse]: powerhouse,
  [Lot.GrainElevator]: grainElevator,
  [Lot.Sawmill]: sawmill,
  [Lot.Cannery]: cannery,
  [Lot.Megachurch]: megachurch,
  [Lot.Fairground]: fairground,
  [Lot.RadioTower]: radioTower,
};
