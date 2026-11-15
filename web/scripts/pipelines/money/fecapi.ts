// Throttled, cached, resumable FEC API client. DEMO_KEY allows ~30-40 calls/hour, so calls are spaced and every
// response is cached on disk (data/cache/money/api/). Re-running only fetches what is missing.
//   pnpm money:fec-api            # fetch committee totals + filing lists for tracked committees
import "../../env.ts";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO } from "../../env.ts";
import { TRACKED, CYCLES } from "./tracked.ts";

const KEY = process.env.DATA_GOV_KEY || "DEMO_KEY";
const DIR = resolve(REPO, "data/cache/money/api");
mkdirSync(DIR, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const isDemo = () => KEY === "DEMO_KEY";

export function cachePath(path: string, params: Record<string, string | number>) {
  const k = (path + "?" + Object.entries(params).sort().map(([a, b]) => `${a}=${b}`).join("&")).replace(/[^a-zA-Z0-9=&._-]+/g, "_");
  return resolve(DIR, k + ".json");
}
export function cached(path: string, params: Record<string, string | number> = {}): any | null {
  const f = cachePath(path, params);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}
export async function fec(path: string, params: Record<string, string | number> = {}): Promise<any> {
  const hit = cached(path, params);
  if (hit) return hit;
  for (let attempt = 0; ; attempt++) {
    const u = new URL("https://api.open.fec.gov/v1" + path);
    for (const [k, v] of Object.entries({ ...params, api_key: KEY })) u.searchParams.set(k, String(v));
    const res = await fetch(u, { headers: { "User-Agent": "ModelBehavior-local-research/0.1" } });
    const left = res.headers.get("x-ratelimit-remaining");
    if (res.status === 429) { console.log(`429 (remaining ${left}); waiting 15 min`); await sleep(15 * 60_000); continue; }
    if (!res.ok) throw new Error(`fec ${res.status} ${path}`);
    const j = await res.json();
    writeFileSync(cachePath(path, params), JSON.stringify(j));
    await sleep(isDemo() ? (left && +left > 15 ? 15_000 : 100_000) : 700);
    return j;
  }
}

async function main() {
  const jobs: [string, Record<string, string | number>][] = [];
  for (const c of TRACKED) for (const cy of CYCLES) jobs.push([`/committee/${c.fec}/totals/`, { cycle: cy, per_page: 5 }]);
  for (const c of TRACKED) jobs.push([`/committee/${c.fec}/filings/`, { per_page: 100, sort: "-receipt_date" }]);
  // Network committees first.
  for (const [p, a] of jobs) {
    if (cached(p, a)) continue;
    try { const j = await fec(p, a); console.log("ok", p, a.cycle ?? "", j.pagination?.count); } catch (e) { console.log("fail", p, (e as Error).message); }
  }
  console.log("done");
}
if (import.meta.url === `file://${process.argv[1]}`) main();
