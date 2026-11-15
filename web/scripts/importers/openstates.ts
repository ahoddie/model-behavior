// OpenStates API v3 (needs OPENSTATES_API_KEY). Refreshes status for state bill nodes that carry an OpenStates id
// (external_ids.openstates) or { state_bill: { jurisdiction, session, identifier } }.
import "../env.ts";
import { pool, q } from "../../src/lib/db.ts";
import { startRun, endRun, politeFetch, sleep } from "../lib/ingest.ts";

const KEY = process.env.OPENSTATES_API_KEY;
export async function run() {
  if (!KEY) { console.log("openstates: OPENSTATES_API_KEY not set, skipping"); return 0; }
  const runId = await startRun("openstates");
  let n = 0;
  try {
    for (const b of await q<{ id: string; external_ids: any }>(`SELECT id, external_ids FROM nodes WHERE type='bill' AND (external_ids ? 'openstates' OR external_ids ? 'state_bill')`)) {
      const sb = b.external_ids.state_bill;
      const url = b.external_ids.openstates
        ? `https://v3.openstates.org/bills/${encodeURIComponent(b.external_ids.openstates)}?include=actions`
        : `https://v3.openstates.org/bills?jurisdiction=${sb.jurisdiction}&session=${sb.session}&identifier=${encodeURIComponent(sb.identifier)}&include=actions`;
      const res = await politeFetch(url, { headers: { "X-API-KEY": KEY } });
      if (!res.ok) continue;
      const j: any = await res.json();
      const bill = j.results ? j.results[0] : j;
      if (!bill) continue;
      const last = (bill.actions ?? []).at(-1);
      await pool.query(`UPDATE nodes SET external_ids = external_ids || $2::jsonb, updated_at=now() WHERE id=$1`, [b.id,
        JSON.stringify({ openstates: bill.id, status: last?.description, status_date: last?.date })]);
      n++;
      await sleep(1100);
    }
    await endRun(runId, true, n);
  } catch (e) { await endRun(runId, false, n, String(e)); throw e; }
  return n;
}
if (import.meta.url === `file://${process.argv[1]}`) { console.log("openstates refreshed", await run()); process.exit(0); }
