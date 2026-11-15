// IRS 990s via ProPublica Nonprofit Explorer. Every node with an EIN gets one filing row per 990 on file.
import "../env.ts";
import { q } from "../../src/lib/db.ts";
import { insertFiling, startRun, endRun, politeFetch, sleep } from "../lib/ingest.ts";

export async function run() {
  const runId = await startRun("propublica");
  let added = 0;
  try {
    const orgs = await q<{ id: string; external_ids: any }>(`SELECT id, external_ids FROM nodes WHERE external_ids ? 'ein'`);
    for (const o of orgs) for (const ein of [o.external_ids.ein].flat().map((e: string) => String(e).replace(/\D/g, ""))) {
      const res = await politeFetch(`https://projects.propublica.org/nonprofits/api/v2/organizations/${ein}.json`);
      if (!res.ok) { console.warn(`propublica ${res.status} ${ein}`); continue; }
      const d: any = await res.json();
      const page = `https://projects.propublica.org/nonprofits/organizations/${ein}`;
      for (const f of [...(d.filings_with_data ?? []), ...(d.filings_without_data ?? [])]) {
        const form = f.formtype_str ?? ({ 0: "990", 1: "990-EZ", 2: "990-PF" } as Record<number, string>)[f.formtype] ?? "990";
        const desc = f.totrevenue != null
          ? `Form ${form}, tax year ${f.tax_prd_yr}. Revenue $${Number(f.totrevenue).toLocaleString()}; expenses $${Number(f.totfuncexpns ?? 0).toLocaleString()}.`
          : `Form ${form}, tax year ${f.tax_prd_yr}.`;
        if (await insertFiling({ node: o.id, filing_type: "990", period: String(f.tax_prd_yr), amount: f.totrevenue ?? null, description: desc,
          url: f.pdf_url || page, filing_id: `${ein}-${f.tax_prd}` }, "importer:propublica")) added++;
      }
      await sleep(500);
    }
    await endRun(runId, true, added);
  } catch (e) { await endRun(runId, false, added, String(e)); throw e; }
  return added;
}
if (import.meta.url === `file://${process.argv[1]}`) { console.log("propublica added", await run()); process.exit(0); }
