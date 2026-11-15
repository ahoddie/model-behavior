// Regulations.gov comments. Searches for comments that name each lab, think tank, advocacy group and funder,
// keeps those whose submitter/organisation field matches, stores a docket-comment filing and a pending feed item.
import "../env.ts";
import { q } from "../../src/lib/db.ts";
import { insertFiling, insertFeed, startRun, endRun, politeFetch, sleep } from "../lib/ingest.ts";

const KEY = process.env.DATA_GOV_KEY || "DEMO_KEY";
const since = process.argv.find((a) => a.startsWith("--since="))?.slice(8) ?? "2023-01-01";
const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
const pause = () => sleep(KEY === "DEMO_KEY" ? 90000 : 1200);

export async function run() {
  const runId = await startRun("regulations");
  let added = 0;
  try {
    const orgs = await q<{ id: string; name: string }>(`SELECT id, name FROM nodes WHERE type IN ('lab','think_tank','nonprofit','funder','investor')`);
    for (const o of orgs) {
      const u = `https://api.regulations.gov/v4/comments?filter[searchTerm]=${encodeURIComponent(`"${o.name}"`)}&filter[postedDate][ge]=${since}&page[size]=50&sort=-postedDate&api_key=${KEY}`;
      const res = await politeFetch(u);
      if (!res.ok) { console.warn(`regulations ${res.status} ${o.name}`); await pause(); continue; }
      const j: any = await res.json();
      for (const c of j.data ?? []) {
        const dres = await politeFetch(`https://api.regulations.gov/v4/comments/${c.id}?api_key=${KEY}`);
        await pause();
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
      await pause();
    }
    await endRun(runId, true, added);
  } catch (e) { await endRun(runId, false, added, String(e)); throw e; }
  return added;
}
if (import.meta.url === `file://${process.argv[1]}`) { console.log("regulations added", await run()); process.exit(0); }
