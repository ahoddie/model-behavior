// One person's own FEC contributions of a given size to any committee, including committees not yet on the map.
// The main FEC importer only reads receipts of committees already tracked (and stops after 20 pages), so a large gift
// to a new or busy committee can be missed. Money is credited to the person as the filing names them, never an employer.
//   tsx scripts/thin/person-fec.ts --person=elon-musk --fec-name="musk, elon" --first=ELON [--min=1000000] [--cycles=2024,2026]
// Committees the person already has money links to are skipped, so research rows are not doubled with filing rows.
// Waits and retries when the API's hourly limit is used up (DEMO_KEY allows very few calls).
import "../env.ts";
import { q } from "../../src/lib/db.ts";
import { insertFiling, insertLink, upsertNode, sleep } from "../lib/ingest.ts";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const person = arg("person"), fecName = arg("fec-name"), first = (arg("first") ?? "").toUpperCase();
const min = Number(arg("min") ?? 1_000_000), cycles = (arg("cycles") ?? "2024,2026").split(",").map(Number);
if (!person || !fecName || !first) throw new Error("Needs --person, --fec-name and --first.");
const KEY = process.env.DATA_GOV_KEY || "DEMO_KEY";

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ACRONYMS = new Set(["PAC", "RBG", "MAHA", "MAGA", "CLF", "NRCC", "NRSC", "DCCC", "DSCC", "RNC", "DNC", "USA", "II", "LLC"]);
const name = (s: string) => s.toLowerCase().replace(/\b[a-z][a-z']*\b/g, (w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));
const docUrl = (r: any) => r.pdf_url || (r.image_number ? `https://docquery.fec.gov/cgi-bin/fecimg/?${r.image_number}` : null);

async function receipts(cycle: number) {
  const u = new URL("https://api.open.fec.gov/v1/schedules/schedule_a/");
  for (const [k, v] of Object.entries({ api_key: KEY, contributor_name: fecName, two_year_transaction_period: cycle, min_amount: min, per_page: 100, sort: "-contribution_receipt_amount" }))
    u.searchParams.set(k, String(v));
  for (let tries = 0; tries < 12; tries++) {
    const res = await fetch(u);
    if (res.status === 429) { console.log(`cycle ${cycle}: hourly limit used up, waiting 10 minutes`); await sleep(600_000); continue; }
    if (!res.ok) throw new Error(`FEC ${res.status}`);
    const j: any = await res.json();
    if (j.pagination?.pages > 1) console.warn(`cycle ${cycle}: more than 100 rows; only the largest 100 were read`);
    return j.results as any[];
  }
  throw new Error("FEC limit did not reset after two hours");
}

const known = new Set((await q<{ to_id: string }>(`SELECT DISTINCT to_id FROM links WHERE from_id=$1 AND type='money'`, [person])).map((r) => r.to_id));
const byFec = new Map((await q<{ id: string; fec: string }>(`SELECT id, jsonb_array_elements_text(CASE jsonb_typeof(external_ids->'fec') WHEN 'array' THEN external_ids->'fec' ELSE jsonb_build_array(external_ids->'fec') END) AS fec FROM nodes WHERE external_ids ? 'fec'`)).map((r) => [r.fec, r.id]));

let added = 0, skipped = 0;
for (const cycle of cycles) {
  for (const r of await receipts(cycle)) {
    if (r.entity_type !== "IND" || !(r.contributor_first_name ?? "").toUpperCase().startsWith(first)) continue;
    const url = docUrl(r);
    if (!url) { console.warn(`no filing link for ${r.committee_id} ${r.contribution_receipt_date}`); continue; }
    let to = byFec.get(r.committee_id);
    if (!to) {
      to = slug(r.committee.name);
      await upsertNode({ id: to, type: "pac", name: name(r.committee.name), descriptor: `FEC committee ${r.committee_id}`,
        source_url: `https://www.fec.gov/data/committee/${r.committee_id}/`, external_ids: { fec: r.committee_id } });
      byFec.set(r.committee_id, to);
      console.log(`new committee: ${to}`);
    }
    if (known.has(to)) { skipped++; continue; }
    await insertFiling({ node: to, filing_type: "FEC", period: `${cycle} cycle`, filed_date: r.contribution_receipt_date, amount: r.contribution_receipt_amount,
      description: `Receipt from ${r.contributor_name}. ${r.receipt_type_full ?? ""}`.trim(), url, filing_id: r.transaction_id ?? r.sub_id }, "importer:fec");
    if (await insertLink({ from: person, to, type: "money", subtype: "contribution", amount: r.contribution_receipt_amount, date_start: r.contribution_receipt_date,
      note: `FEC Schedule A: ${r.contributor_name}.`, source_url: url }, "importer:fec")) { added++; console.log(`+ ${to} ${r.contribution_receipt_amount} ${r.contribution_receipt_date}`); }
  }
}
console.log(`done: ${added} gifts added, ${skipped} skipped (committee already linked)`);
process.exit(0);
