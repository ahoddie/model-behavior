// Congress.gov API (needs CONGRESS_API_KEY). Refreshes the status of every federal bill node, and scans recent
// AI-related committee meetings for witnesses whose organisation is on the map (→ pending testimony feed items).
import "../env.ts";
import { pool, q } from "../../src/lib/db.ts";
import { insertFeed, startRun, endRun, politeFetch, sleep } from "../lib/ingest.ts";

const KEY = process.env.CONGRESS_API_KEY;
const API = "https://api.congress.gov/v3";
const withKey = (u: string) => `${u}${u.includes("?") ? "&" : "?"}format=json&api_key=${KEY}`;

export async function run() {
  if (!KEY) { console.log("congress: CONGRESS_API_KEY not set, skipping"); return 0; }
  const runId = await startRun("congress");
  let added = 0;
  try {
    for (const b of await q<{ id: string; external_ids: any }>(`SELECT id, external_ids FROM nodes WHERE type='bill' AND external_ids ? 'congress'`)) {
      const [congress, type, num] = String(b.external_ids.congress).toLowerCase().split("/"); // "119/s/2938"
      if (!num) continue;
      const res = await politeFetch(withKey(`${API}/bill/${congress}/${type}/${num}`));
      if (!res.ok) continue;
      const bill = (await res.json()).bill;
      await pool.query(`UPDATE nodes SET external_ids = external_ids || $2::jsonb, updated_at=now() WHERE id=$1`, [b.id,
        JSON.stringify({ status: bill.latestAction?.text, status_date: bill.latestAction?.actionDate })]);
      await sleep(400);
    }
    const orgs = await q<{ id: string; name: string }>(`SELECT id, name FROM nodes WHERE type IN ('lab','think_tank','nonprofit','funder','investor','person')`);
    const res = await politeFetch(withKey(`${API}/committee-meeting?limit=250`));
    for (const m of res.ok ? (await res.json()).committeeMeetings ?? [] : []) {
      const dres = await politeFetch(withKey(m.url));
      if (!dres.ok) continue;
      const meet = (await dres.json()).committeeMeeting;
      if (!/artificial intelligence|\bAI\b|frontier model|semiconductor|chip/i.test(meet.title ?? "")) continue;
      const witnesses = JSON.stringify(meet.witnesses ?? []);
      for (const o of orgs) if (witnesses.includes(o.name)) {
        const url = `https://www.congress.gov/event/${meet.congress}th-congress/${String(meet.chamber).toLowerCase()}-event/${meet.eventId}`;
        if (await insertFeed({ node: o.id, date: (meet.date ?? "").slice(0, 10), kind: "testimony", summary: `Witness at the hearing "${meet.title}".`,
          url, platform: "congress.gov", issues: [] }, "importer:congress", "pending")) added++;
      }
      await sleep(300);
    }
    await endRun(runId, true, added);
  } catch (e) { await endRun(runId, false, added, String(e)); throw e; }
  return added;
}
if (import.meta.url === `file://${process.argv[1]}`) { console.log("congress added", await run()); process.exit(0); }
