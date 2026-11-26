// Regulations.gov comments. Searches for comments that name each lab, think tank, advocacy group and funder,
// keeps those whose submitter/organisation field matches, stores a docket-comment filing and a pending feed item.
import "../env.ts";
import { q } from "../../src/lib/db.ts";
import { insertFiling, insertFeed, startRun, endRun, politeFetch, sleep } from "../lib/ingest.ts";
import { REPO } from "../env.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KEY = process.env.DATA_GOV_KEY || "DEMO_KEY";
const since = process.argv.find((a) => a.startsWith("--since="))?.slice(8) ?? "2023-01-01";
const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
const pause = () => sleep(KEY === "DEMO_KEY" ? 90000 : 1200);
// The org list is walked from where the last run stopped (data/cache/regulations-cursor.json), so a run that hits the
// daily cap early (DEMO_KEY allows about 10 calls a day per IP, and GitHub Actions shares IPs) still gets further each
// night instead of retrying the same first orgs. REGULATIONS_BUDGET_MIN stops it cleanly after that many minutes.
const BUDGET_MS = Number(process.env.REGULATIONS_BUDGET_MIN ?? 0) * 60_000;
const cursorFile = join(REPO, "data/cache/regulations-cursor.json");
const saveCursor = (next: string) => { mkdirSync(join(REPO, "data/cache"), { recursive: true }); writeFileSync(cursorFile, JSON.stringify({ next, at: new Date().toISOString() })); };

export async function run() {
  const runId = await startRun("regulations");
  let added = 0;
  try {
    const all = await q<{ id: string; name: string }>(`SELECT id, name FROM nodes WHERE type IN ('lab','think_tank','nonprofit','funder','investor') ORDER BY id`);
    const from: string = existsSync(cursorFile) ? JSON.parse(readFileSync(cursorFile, "utf8")).next ?? "" : "";
    const start = Math.max(0, all.findIndex((o) => o.id >= from));
    const orgs = [...all.slice(start), ...all.slice(0, start)];
    const t0 = Date.now();
    let stopped = false;
    for (const o of orgs) {
      if (BUDGET_MS && Date.now() - t0 > BUDGET_MS) { console.log(`regulations: time budget reached; next run starts at ${o.name}`); stopped = true; break; }
      saveCursor(o.id);
      const u = `https://api.regulations.gov/v4/comments?filter[searchTerm]=${encodeURIComponent(`"${o.name}"`)}&filter[postedDate][ge]=${since}&page[size]=50&sort=-postedDate&api_key=${KEY}`;
      const res = await politeFetch(u);
      // DEMO_KEY shares a small daily cap (about 10 calls a day per IP) with the FEC importer, so on DEMO_KEY the first 429
      // ends the run instead of trying every org for hours.
      // With a real key, a 429 also ends the run; either way the next run starts again at this org.
      if (res.status === 429) { console.log(`regulations: rate limit reached at ${o.name}; ${added} added; stopping (resumes here next run)`); stopped = true; break; }
      if (!res.ok) { console.warn(`regulations ${res.status} ${o.name}`); await pause(); continue; }
      const j: any = await res.json();
      for (const c of j.data ?? []) {
        const dres = await politeFetch(`https://api.regulations.gov/v4/comments/${c.id}?api_key=${KEY}`);
        await pause();
        if (dres.status === 429) { stopped = true; break; }
        if (!dres.ok) continue;
        const a = (await dres.json()).data?.attributes ?? {};
        const who = `${a.organization ?? ""} ${a.firstName ?? ""} ${a.lastName ?? ""} ${a.title ?? ""}`;
        if (!who.toLowerCase().includes(o.name.toLowerCase())) continue; // submitter must be this org
        const url = `https://www.regulations.gov/comment/${c.id}`;
        const date = (a.postedDate ?? a.receiveDate ?? "").slice(0, 10);
        if (await insertFiling({ node: o.id, filing_type: "docket comment", period: date.slice(0, 4), filed_date: date,
          description: `${strip(a.title ?? "Comment")} (docket ${a.docketId}).`, url, filing_id: c.id }, "importer:regulations")) added++;
        await insertFeed({ node: o.id, date, kind: "docket comment", summary: `Filed a comment on docket ${a.docketId}: ${strip(a.title ?? "")}.`.slice(0, 300),
          url, platform: "regulations.gov", issues: [] }, "importer:regulations", "pending");
      }
      if (stopped) { console.log(`regulations: rate limit reached in ${o.name}'s comments; ${added} added; resumes here next run`); break; }
      await pause();
    }
    if (!stopped) saveCursor(""); // a full pass: start from the top next time
    await endRun(runId, true, added);
  } catch (e) { await endRun(runId, false, added, String(e)); throw e; }
  return added;
}
if (import.meta.url === `file://${process.argv[1]}`) { console.log("regulations added", await run()); process.exit(0); }
