/**
 * Realistic Town Life & Census Simulation (Jobs, Families, Commutes, Routines).
 *
 * Provides deterministic household structures, job assignments, workplace
 * capacities, family member identities, and town-wide economic census metrics.
 */

import { Lot, Terrain, TileState, type World, type TileId } from "./types.js";
import { householdName, memberName } from "./names.js";

/** Job category for employment classification. */
export type JobSector = "civic" | "services" | "industry" | "agriculture";

/** Job role details. */
export interface JobRole {
  title: string;
  sector: JobSector;
  wage: number; // daily wage in $
}

/** Workplace lot capacity definition. */
export interface WorkplaceInfo {
  tile: TileId;
  x: number;
  y: number;
  lot: number;
  name: string;
  sector: JobSector;
  capacity: number;
  roles: JobRole[];
}

/** Individual family member in a household. */
export interface FamilyMember {
  index: number;
  name: string;
  role: "head" | "spouse" | "child" | "elder";
  age: number;
  job: JobRole | null;
  workplaceTile: TileId | null;
}

/** Full family household details for a residential lot. */
export interface HouseholdInfo {
  tile: TileId;
  x: number;
  y: number;
  surname: string;
  size: number;
  members: FamilyMember[];
  employmentStatus: "employed" | "partial" | "unemployed";
  dailyIncome: number;
  dissent: number;
  beliefState: "neutral" | "believer" | "apostate";
}

/** Town-wide employment & demographic census summary. */
export interface TownCensus {
  townName: string;
  totalHouseholds: number;
  totalPopulation: number;
  employedCount: number;
  unemployedCount: number;
  employmentRate: number; // 0..100 %
  sectorCounts: Record<JobSector, number>;
  believerCount: number;
  neutralCount: number;
  apostateCount: number;
}

/** Map of Lot enum to Workplace specifications. */
const WORKPLACE_DEFS: Record<number, { name: string; sector: JobSector; capacity: number; roles: string[]; wage: number }> = {
  [Lot.Sheriff]: { name: "Sheriff's Office", sector: "civic", capacity: 4, roles: ["Chief Deputy", "Deputy Sheriff", "Dispatch Officer", "Records Clerk"], wage: 85 },
  [Lot.FireStation]: { name: "Fire Department", sector: "civic", capacity: 4, roles: ["Fire Captain", "Firefighter", "Paramedic", "Station Engineer"], wage: 80 },
  [Lot.PostOffice]: { name: "U.S. Post Office", sector: "civic", capacity: 4, roles: ["Postmaster", "Mail Courier", "Postal Clerk", "Sorting Operator"], wage: 75 },
  [Lot.School]: { name: "Elementary School", sector: "civic", capacity: 5, roles: ["School Principal", "Grade Teacher", "Librarian", "Janitor", "Bus Driver"], wage: 70 },
  [Lot.HighSchool]: { name: "High School", sector: "civic", capacity: 6, roles: ["High School Principal", "Math Teacher", "Science Instructor", "Athletic Coach", "Guidance Counselor", "Admin Assistant"], wage: 75 },
  [Lot.Library]: { name: "Public Library", sector: "civic", capacity: 3, roles: ["Head Librarian", "Assistant Archivist", "Reading Specialist"], wage: 65 },

  [Lot.GasStation]: { name: "Gas Station & Auto Care", sector: "services", capacity: 3, roles: ["Station Manager", "Pump Attendant", "Auto Mechanic"], wage: 65 },
  [Lot.Diner]: { name: "Town Diner", sector: "services", capacity: 4, roles: ["Head Cook", "Shift Supervisor", "Short-Order Cook", "Server"], wage: 60 },
  [Lot.Supermarket]: { name: "General Supermarket", sector: "services", capacity: 6, roles: ["Store Manager", "Head Cashier", "Grocery Stocker", "Deli Clerk", "Produce Assistant", "Cashier"], wage: 60 },
  [Lot.Shop]: { name: "Main Street Shop", sector: "services", capacity: 3, roles: ["Shopkeeper", "Sales Associate", "Stock Clerk"], wage: 55 },
  [Lot.Bank]: { name: "Town Savings Bank", sector: "services", capacity: 4, roles: ["Bank Branch Manager", "Loan Officer", "Head Teller", "Bank Teller"], wage: 90 },
  [Lot.Motel]: { name: "Roadside Motel", sector: "services", capacity: 3, roles: ["Desk Clerk", "Housekeeping Lead", "Maintenance Hand"], wage: 55 },
  [Lot.Cinema]: { name: "Town Cinema", sector: "services", capacity: 3, roles: ["Theater Manager", "Projectionist", "Concession Staff"], wage: 50 },

  [Lot.Factory]: { name: "Manufacturing Plant", sector: "industry", capacity: 10, roles: ["Plant Superintendent", "Shift Foreman", "Machine Operator", "Assembly Specialist", "Quality Inspector", "Maintenance Technician", "Forklift Operator", "Packaging Tech", "Shipping Clerk", "Plant Hand"], wage: 85 },
  [Lot.Warehouse]: { name: "Freight Warehouse", sector: "industry", capacity: 5, roles: ["Warehouse Manager", "Inventory Specialist", "Dock Hand", "Logistics Tech", "Forklift Driver"], wage: 75 },
  [Lot.Depot]: { name: "Railroad Freight Depot", sector: "industry", capacity: 5, roles: ["Depot Agent", "Freight Conductor", "Switchman", "Track Inspector", "Cargo Clerk"], wage: 80 },
  [Lot.GrainElevator]: { name: "Co-Op Grain Elevator", sector: "industry", capacity: 4, roles: ["Elevator Operator", "Grain Sampler", "Scale Master", "Silo Tech"], wage: 75 },

  [Lot.Barn]: { name: "Homestead Barn", sector: "agriculture", capacity: 3, roles: ["Herdsman", "Barn Hand", "Dairy Assistant"], wage: 55 },
  [Lot.Silo]: { name: "Grain Storage Silo", sector: "agriculture", capacity: 2, roles: ["Silo Manager", "Grain Operator"], wage: 60 },
  [Lot.Greenhouse]: { name: "Agricultural Greenhouse", sector: "agriculture", capacity: 3, roles: ["Horticulturist", "Greenhouse Hand", "Nursery Assistant"], wage: 55 },
};

/** Integer hash for deterministic stateless matching. */
function hash2(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Get all workplace buildings and open job roles across the map. */
export function getTownWorkplaces(world: World): WorkplaceInfo[] {
  const workplaces: WorkplaceInfo[] = [];

  for (let t = 0; t < world.terrain.length; t++) {
    const lotId = world.lot[t] ?? 0;
    const def = WORKPLACE_DEFS[lotId];

    if (def) {
      const x = t % world.width;
      const y = (t / world.width) | 0;
      const roles: JobRole[] = def.roles.map((r: string, i: number) => ({
        title: r,
        sector: def.sector,
        wage: def.wage + (i === 0 ? 25 : i === 1 ? 10 : 0),
      }));

      workplaces.push({
        tile: t,
        x,
        y,
        lot: lotId,
        name: def.name,
        sector: def.sector,
        capacity: def.capacity,
        roles,
      });
    } else if (world.terrain[t] === Terrain.Field || world.terrain[t] === Terrain.Orchard) {
      // Agricultural field parcel jobs
      const x = t % world.width;
      const y = (t / world.width) | 0;
      if (t % 7 === 0) { // sparse farm workplaces
        workplaces.push({
          tile: t,
          x,
          y,
          lot: Lot.None,
          name: world.terrain[t] === Terrain.Orchard ? "Fruit Orchard" : "Crop Farmland",
          sector: "agriculture",
          capacity: 3,
          roles: [
            { title: "Farm Owner", sector: "agriculture", wage: 75 },
            { title: "Field Worker", sector: "agriculture", wage: 55 },
            { title: "Tractor Operator", sector: "agriculture", wage: 65 },
          ],
        });
      }
    }
  }

  return workplaces;
}

/** Resolve full family household info for a residential lot. */
export function getHouseholdInfo(world: World, tile: TileId): HouseholdInfo | null {
  const pop = world.pop[tile] ?? 0;
  if (pop === 0) return null;

  const x = tile % world.width;
  const y = (tile / world.width) | 0;
  const surname = householdName(tile);
  const workplaces = getTownWorkplaces(world);

  const members: FamilyMember[] = [];
  let totalIncome = 0;
  let employedCount = 0;

  for (let i = 0; i < pop; i++) {
    let role: "head" | "spouse" | "child" | "elder" = "head";
    let age = 42;

    if (i === 0) {
      role = "head";
      age = 35 + (hash2(tile, i) % 25);
    } else if (i === 1 && pop >= 2) {
      role = "spouse";
      age = 32 + (hash2(tile, i) % 25);
    } else if (i >= pop - 1 && pop >= 4 && hash2(tile, i) % 2 === 0) {
      role = "elder";
      age = 65 + (hash2(tile, i) % 20);
    } else {
      role = "child";
      age = 5 + (hash2(tile, i) % 15);
    }

    let job: JobRole | null = null;
    let workplaceTile: TileId | null = null;

    // Adult heads and spouses have jobs at nearby workplaces
    if ((role === "head" || role === "spouse") && workplaces.length > 0) {
      const wpIdx = hash2(tile, i * 17) % workplaces.length;
      const wp = workplaces[wpIdx];
      if (wp) {
        const roleIdx = hash2(tile, i * 31) % wp.roles.length;
        const assignedJob = wp.roles[roleIdx];
        if (assignedJob) {
          job = assignedJob;
          workplaceTile = wp.tile;
          totalIncome += job.wage;
          employedCount++;
        }
      }
    }

    const name = memberName(tile, i);
    members.push({ index: i, name, role, age, job, workplaceTile });
  }

  const adultCount = members.filter((m) => m.role === "head" || m.role === "spouse").length;
  const employmentStatus =
    employedCount >= adultCount && adultCount > 0
      ? "employed"
      : employedCount > 0
      ? "partial"
      : "unemployed";

  const st = world.state[tile] ?? 0;
  const beliefState =
    st === TileState.Believer ? "believer" : st === TileState.Apostate ? "apostate" : "neutral";

  const dissent = (world.dissent[tile] ?? 0) / 65536; // Q16.16 to float

  return {
    tile,
    x,
    y,
    surname,
    size: pop,
    members,
    employmentStatus,
    dailyIncome: totalIncome,
    dissent,
    beliefState,
  };
}

/** Compute a complete demographic & economic census for the entire town. */
export function getTownCensus(world: World): TownCensus {
  let totalPop = 0;
  let totalHouseholds = 0;
  let employedCount = 0;
  let unemployedCount = 0;
  let believerCount = 0;
  let neutralCount = 0;
  let apostateCount = 0;

  const sectorCounts: Record<JobSector, number> = {
    civic: 0,
    services: 0,
    industry: 0,
    agriculture: 0,
  };

  for (let t = 0; t < world.terrain.length; t++) {
    const pop = world.pop[t] ?? 0;
    if (pop === 0) continue;

    totalHouseholds++;
    totalPop += pop;

    const info = getHouseholdInfo(world, t);
    if (!info) continue;

    for (const m of info.members) {
      if (m.job) {
        employedCount++;
        sectorCounts[m.job.sector]++;
      } else if (m.role === "head" || m.role === "spouse") {
        unemployedCount++;
      }
    }

    if (info.beliefState === "believer") believerCount += pop;
    else if (info.beliefState === "apostate") apostateCount += pop;
    else neutralCount += pop;
  }

  const totalWorkers = employedCount + unemployedCount;
  const employmentRate = totalWorkers > 0 ? Math.round((employedCount / totalWorkers) * 100) : 100;

  return {
    townName: world.townName,
    totalHouseholds,
    totalPopulation: totalPop,
    employedCount,
    unemployedCount,
    employmentRate,
    sectorCounts,
    believerCount,
    neutralCount,
    apostateCount,
  };
}
