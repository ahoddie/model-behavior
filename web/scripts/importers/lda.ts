// Senate LDA (now served from lda.gov). For every lab, investor, funder, think tank and advocacy node, pull every
// LD-1/LD-2 filing where it is the client (or the in-house registrant), store each as a filing with its issue codes,
// and link the client to each bill the filing names and each government body it lists as lobbied.
import "../env.ts";
import { pool, q } from "../../src/lib/db.ts";
import { insertFiling, insertLink, upsertNode, startRun, endRun, politeFetch, sleep } from "../lib/ingest.ts";

const BASE = "https://lda.gov/api/v1";
const years = process.argv.includes("--all-years") ? [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026] : [2024, 2025, 2026];
const quarterLabel: Record<string, string> = { first_quarter: "Q1", second_quarter: "Q2", third_quarter: "Q3", fourth_quarter: "Q4", mid_year: "H1", year_end: "H2" };
const slug = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const tokens = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !["INC", "LLC", "CORP", "CORPORATION", "THE", "CO", "OPCO", "LP", "PBC"].includes(t));

export async function run() {
  const runId = await startRun("lda");
  let added = 0;
  try {
    const actors = await q<{ id: string; name: string; external_ids: any }>(
      `SELECT id, name, external_ids FROM nodes WHERE type IN ('lab','investor','funder','think_tank','nonprofit','pac')`);
    const bills = await q<{ id: string; external_ids: any }>(`SELECT id, external_ids FROM nodes WHERE type='bill' AND external_ids ? 'congress'`);
    const billIndex = new Map<string, string>(); // "S2938" -> node id
    for (const b of bills) billIndex.set(String(b.external_ids.congress).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^\d+/, ""), b.id);

    for (const a of actors) {
      const names: string[] = [a.external_ids?.lda_client ?? []].flat().map(String);
      if (!names.length) names.push(a.name);
      const want = tokens(names[0]);
      for (const name of names) for (const year of years) {
        let url: string | null = `${BASE}/filings/?client_name=${encodeURIComponent(name)}&filing_year=${year}`;
        while (url) {
          const res = await politeFetch(url, { headers: { Accept: "application/json" } });
          if (!res.ok) { console.warn(`lda ${res.status} ${url}`); break; }
          const page: any = await res.json();
          for (const f of page.results ?? []) {
            const client = tokens(f.client?.name ?? "");
            if (!want.every((t) => client.includes(t))) continue; // skip namesakes
            const amount = f.income != null ? Number(f.income) : f.expenses != null ? Number(f.expenses) : null;
            const issues = (f.lobbying_activities ?? []).map((x: any) => x.general_issue_code).filter(Boolean);
            const desc = (f.lobbying_activities ?? []).map((x: any) => x.description).filter(Boolean).join(" | ");
            const docUrl = f.filing_document_url || `https://lda.gov/filings/public/filing/${f.filing_uuid}/print/`;
            const period = `${f.filing_year} ${quarterLabel[f.filing_period] ?? f.filing_period}`;
            const via = f.registrant?.name && tokens(f.registrant.name).join() !== client.join() ? `Via ${f.registrant.name}. ` : "In-house. ";
            if (await insertFiling({ node: a.id, filing_type: "LDA", period, filed_date: f.dt_posted?.slice(0, 10), amount, issues,
              description: `${f.filing_type_display}. ${via}${desc.slice(0, 1500)}`, url: docUrl, filing_id: f.filing_uuid }, "importer:lda")) added++;

            // Bills named in the activity descriptions.
            for (const m of desc.matchAll(/\b(H\.?\s?R\.?|S\.)\s?(\d{1,5})\b/g)) {
              const key = (m[1].startsWith("H") ? "HR" : "S") + m[2];
              const bill = billIndex.get(key);
              if (bill) await insertLink({ from: a.id, to: bill, type: "money", subtype: "lobbying", amount: null, date_start: f.dt_posted?.slice(0, 10),
                note: `Named in ${period} LDA report${f.registrant?.name ? ` filed by ${f.registrant.name}` : ""}.`, source_url: docUrl }, "importer:lda");
            }
            // Government bodies lobbied.
            const bodies = new Set<string>((f.lobbying_activities ?? []).flatMap((x: any) => (x.government_entities ?? []).map((g: any) => g.name)));
            for (const body of bodies) {
              const id = `agency-${slug(body)}`;
              await upsertNode({ id, type: "agency", name: body.replace(/\b\w/g, (c: string) => c.toUpperCase()).replace(/\bOf\b/g, "of"),
                descriptor: "Federal body listed as lobbied in LDA reports", cluster: "government", source_url: docUrl });
              await insertLink({ from: a.id, to: id, type: "money", subtype: "lobbying", amount: null, date_start: f.dt_posted?.slice(0, 10),
                note: `Listed as lobbied in ${period} report${amount ? ` ($${amount.toLocaleString()} reported for the filing)` : ""}.`, source_url: docUrl }, "importer:lda");
            }
          }
          url = page.next;
          await sleep(1500);
        }
      }
    }
    await endRun(runId, true, added);
  } catch (e) { await endRun(runId, false, added, String(e)); throw e; }
  return added;
}
// Backfill the short "specific issues" text and issue codes for LDA filings stored without them (older research-loaded
// rows keep only the filing link and uuid). Lists each client's filings by year (25 per page) and matches on filing uuid,
// then fetches any leftovers one by one. Stores only the activity descriptions and codes, never whole documents.
// Usage: tsx scripts/importers/lda.ts --backfill-text
export function activityText(f: any) {
  const acts = f.lobbying_activities ?? [];
  const codes = [...new Set<string>(acts.map((x: any) => x.general_issue_code).filter(Boolean))];
  const desc = [...new Set<string>(acts.map((x: any) => String(x.description ?? "").trim()).filter(Boolean))].join(" | ");
  const client = tokens(f.client?.name ?? "");
  const via = f.registrant?.name && tokens(f.registrant.name).join() !== client.join() ? `Via ${f.registrant.name}. ` : "In-house. ";
  return { codes, text: `${f.filing_type_display ?? "LDA filing"}. ${via}${desc.slice(0, 1500)}`.trim() };
}
export async function backfillText() {
  const todo = await q<{ id: number; node_id: string; filing_id: string; year: string; name: string; lda: any }>(`
    SELECT f.id, f.node_id, f.filing_id, left(f.period, 4) AS year, n.name, n.external_ids->'lda_client' AS lda
    FROM filings f JOIN nodes n ON n.id = f.node_id
    WHERE f.filing_type = 'LDA' AND f.filing_id IS NOT NULL AND (f.description IS NULL OR f.description NOT LIKE '%. Via %' AND f.description NOT LIKE '%. In-house.%')`);
  const byUuid = new Map(todo.map((r) => [r.filing_id, r]));
  let updated = 0, pages = 0;
  const save = async (r: (typeof todo)[number], f: any) => {
    const { codes, text } = activityText(f);
    await pool.query(`UPDATE filings SET description = CASE WHEN description IS NULL THEN $2 ELSE description || '. ' || $2 END,
      issues = CASE WHEN cardinality(issues) = 0 THEN $3 ELSE issues END WHERE id = $1`, [r.id, text, codes]);
    byUuid.delete(r.filing_id); updated++;
  };
  const groups = new Map<string, { names: string[]; year: string }>();
  for (const r of todo) groups.set(`${r.node_id}|${r.year}`, { names: [r.lda ?? []].flat().map(String).concat([r.name]).slice(0, 1), year: r.year });
  console.log(`${todo.length} filings to backfill in ${groups.size} client-years`);
  for (const { names, year } of groups.values()) for (const name of names) {
    let url: string | null = `${BASE}/filings/?client_name=${encodeURIComponent(name)}&filing_year=${year}`;
    while (url) {
      const res = await politeFetch(url, { headers: { Accept: "application/json" } });
      pages++;
      if (!res.ok) { console.warn(`lda ${res.status} ${url}`); break; }
      const page: any = await res.json();
      for (const f of page.results ?? []) { const r = byUuid.get(f.filing_uuid); if (r) await save(r, f); }
      url = page.next;
      await sleep(2000);
    }
    console.log(`${name} ${year}: ${updated} updated, ${byUuid.size} left, ${pages} pages`);
  }
  for (const r of [...byUuid.values()]) {
    const res = await politeFetch(`${BASE}/filings/${r.filing_id}/`, { headers: { Accept: "application/json" } });
    if (res.ok) await save(r, await res.json()); else console.warn(`lda ${res.status} ${r.filing_id}`);
    await sleep(2000);
  }
  console.log({ updated, left: byUuid.size, pages });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--backfill-text")) { await backfillText(); process.exit(0); }
  console.log("lda added", await run()); process.exit(0);
}
