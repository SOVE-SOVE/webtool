/**
 * Short-TTL cache for the Cmd+K command menu's search data — mirrors
 * navCounts.ts's {at, data} + in-flight-dedupe shape, kept separate
 * since the cached shape differs (four full entity arrays, not
 * derived counts). Fans out to the same list endpoints every other
 * list page in the app already fetches in full and filters
 * client-side — no new backend search endpoint needed.
 */
import { api, type Business, type Lead, type PlanningListItem, type Project } from "./api";

export type CommandMenuData = {
  leads: Lead[];
  planning: PlanningListItem[];
  projects: Project[];
  businesses: Business[];
};

const FRESH_MS = 30_000;

let cache: { at: number; data: CommandMenuData } | null = null;
let inflight: Promise<CommandMenuData> | null = null;

async function fetchCommandMenuData(): Promise<CommandMenuData> {
  const [leads, planning, projects, businesses] = await Promise.all([
    api.listLeads(),
    api.listPlanning(),
    api.listProjects(),
    api.listBusinesses(),
  ]);
  return { leads, planning, projects, businesses };
}

export function loadCommandMenuData(opts?: { force?: boolean }): Promise<CommandMenuData> {
  if (!opts?.force && cache && Date.now() - cache.at < FRESH_MS) {
    return Promise.resolve(cache.data);
  }
  if (inflight) return inflight;
  inflight = fetchCommandMenuData()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
