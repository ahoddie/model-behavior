// FEC (api.open.fec.gov). For every PAC node with an FEC committee id:
//  - Schedule A receipts ≥ $1,000 → a filing row per transaction; a money link from the giver when the giver is a
//    known node (people matched on first + last name, organisations on name tokens). Money is credited to the
//    contributor exactly as the filing names them, never to an employer.
//  - Schedule E independent expenditures → a money link to the candidate (lawmaker node, created from the FEC
//    candidate record) with support/oppose stance, plus a race node for the contest.
//  - Schedule B transfers to other known committees.
// Also, for every person node, Schedule A contributions they made to any committee already on the map.
import "../env.ts";
import { q } from "../../src/lib/db.ts";
import { insertFiling, insertLink, upsertNode, startRun, endRun, politeFetch, sleep } from "../lib/ingest.ts";

const KEY = process.env.DATA_GOV_KEY || "DEMO_KEY";
const API = "https://api.open.fec.gov/v1";
const cycles = [2024, 2026];
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const docUrl = (r: any) => r.pdf_url || (r.image_number ? `https://docquery.fec.gov/cgi-bin/fecimg/?${r.image_number}` : null)
  || (r.file_number ? `https://docquery.fec.gov/cgi-bin/forms/${r.committee_id}/${r.file_number}/` : null);

async function get(path: string, params: Record<string, string | number>) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries({ ...params, api_key: KEY, per_page: 100 })) u.searchParams.set(k, String(v));
  const out: any[] = [];
  let last: Record<string, string> = {};
  for (let page = 0; page < 20; page++) {
    for (const [k, v] of Object.entries(last)) u.searchParams.set(k, v);
    const res = await politeFetch(u.toString());
    if (!res.ok) { console.warn(`fec ${res.status} ${path}`); break; }
    const j: any = await res.json();
    out.push(...(j.results ?? []));
    const li = j.pagination?.last_indexes;
    if (!li || !j.results?.length || out.length >= (j.pagination?.count ?? 0)) break;
    last = Object.fromEntries(Object.entries(li).map(([k, v]) => [k, String(v)]));
    await sleep(KEY === "DEMO_KEY" ? 90000 : 800); // DEMO_KEY: 40 calls/hour
  }
  return out;
}

export async function run() {
  const runId = await startRun("fec");
  let added = 0;
  try {
    const pacs = await q<{ id: string; name: string; external_ids: any }>(`SELECT id,name,external_ids FROM nodes WHERE external_ids ? 'fec' AND type IN ('pac','lab','nonprofit','investor')`);
    const people = await q<{ id: string; name: string; external_ids: any }>(`SELECT id,name,external_ids FROM nodes WHERE type='person'`);
    const orgs = await q<{ id: string; name: string; external_ids: any }>(`SELECT id,name,external_ids FROM nodes WHERE type IN ('lab','investor','funder','pac','nonprofit')`);
    const byCommittee = new Map<string, string>();
    for (const p of pacs) for (const c of [p.external_ids.fec].flat()) byCommittee.set(String(c), p.id);

    const matchPerson = (r: any) => {
      const first = (r.contributor_first_name ?? "").toUpperCase(), last = (r.contributor_last_name ?? "").toUpperCase();
      if (!last) return null;
      return people.find((p) => {
        const parts = p.name.toUpperCase().split(/\s+/);
        const pl = parts.at(-1)!, pf = parts[0];
        return pl === last && (first.startsWith(pf) || pf.startsWith(first.split(" ")[0])) && first.length > 0;
      })?.id ?? null;
    };
    const matchOrg = (name: string) => {
      const n = name.toUpperCase();
      return orgs.find((o) => [o.name, ...[o.external_ids?.fec_names ?? []].flat()].some((alias: string) => {
        const a = alias.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").trim();
        return a.length > 3 && (n === a || n.startsWith(a + " ") || n.replace(/[^A-Z0-9 ]/g, " ").includes(` ${a} `) || n.startsWith(a));
      }))?.id ?? null;
    };

    for (const [committee, nodeId] of byCommittee) {
      for (const cycle of cycles) {
        // Receipts
        for (const r of await get("/schedules/schedule_a/", { committee_id: committee, two_year_transaction_period: cycle, min_amount: 1000, sort: "-contribution_receipt_date" })) {
          const url = docUrl(r); if (!url) continue;
          const giver = r.entity_type === "IND" ? matchPerson(r) : matchOrg(r.contributor_name ?? "");
          if (await insertFiling({ node: nodeId, filing_type: "FEC", period: `${cycle} cycle`, filed_date: r.contribution_receipt_date, amount: r.contribution_receipt_amount,
            description: `Receipt from ${r.contributor_name}${r.contributor_employer ? ` (employer listed: ${r.contributor_employer})` : ""}. ${r.receipt_type_full ?? ""}`.trim(),
            url, filing_id: r.transaction_id ?? r.sub_id }, "importer:fec")) added++;
          if (giver && giver !== nodeId) await insertLink({ from: giver, to: nodeId, type: "money", subtype: r.entity_type === "IND" ? "contribution" : "transfer",
            amount: r.contribution_receipt_amount, date_start: r.contribution_receipt_date, note: `FEC Schedule A: ${r.contributor_name}.`, source_url: url }, "importer:fec");
        }
        // Independent expenditures
        for (const r of await get("/schedules/schedule_e/", { committee_id: committee, cycle, sort: "-expenditure_date" })) {
          const url = docUrl(r); if (!url || !r.candidate_id) continue;
          const office = r.candidate_office ?? "";
          const state = (r.candidate_office_state ?? "").toLowerCase();
          const district = office === "H" ? String(r.candidate_office_district ?? "").padStart(2, "0") : office === "S" ? "sen" : "pres";
          const raceId = `race-${cycle}-${state}-${district.replace(/^0/, "")}`;
          const raceUrl = office === "H" ? `https://www.fec.gov/data/elections/house/${state.toUpperCase()}/${district}/${cycle}/`
            : office === "S" ? `https://www.fec.gov/data/elections/senate/${state.toUpperCase()}/${cycle}/` : `https://www.fec.gov/data/elections/president/${cycle}/`;
          await upsertNode({ id: raceId, type: "race", name: `${cycle} ${state.toUpperCase()}${office === "H" ? `-${district}` : office === "S" ? " Senate" : " President"}`,
            descriptor: office === "H" ? "U.S. House race" : office === "S" ? "U.S. Senate race" : "Presidential race", cluster: "races", source_url: raceUrl });
          const cname = (r.candidate_name ?? "").split(",").reverse().map((s: string) => s.trim()).join(" ");
          const lid = `lawmaker-${slug(cname)}`;
          await upsertNode({ id: lid, type: "lawmaker", name: titleCase(cname), descriptor: `Candidate, ${raceId.replace("race-", "").toUpperCase()}`, cluster: "lawmakers",
            external_ids: { fec: r.candidate_id, race: raceId }, source_url: `https://www.fec.gov/data/candidate/${r.candidate_id}/` });
          const stance = r.support_oppose_indicator === "S" ? "support" : r.support_oppose_indicator === "O" ? "oppose" : null;
          if (await insertLink({ from: nodeId, to: lid, type: "money", subtype: "independent expenditure", amount: r.expenditure_amount, date_start: r.expenditure_date ?? r.dissemination_date,
            stance, note: `${stance === "oppose" ? "Against" : "For"} ${titleCase(cname)}: ${r.expenditure_description ?? "independent expenditure"}.`, source_url: url }, "importer:fec")) added++;
          await insertFiling({ node: nodeId, filing_type: "FEC", period: `${cycle} cycle`, filed_date: r.expenditure_date, amount: r.expenditure_amount,
            description: `Independent expenditure ${stance ?? ""} ${titleCase(cname)} (${raceId.replace("race-", "").toUpperCase()}): ${r.expenditure_description ?? ""}`, url, filing_id: r.transaction_id ?? r.sub_id }, "importer:fec");
        }
        // Disbursements to other committees on the map
        for (const r of await get("/schedules/schedule_b/", { committee_id: committee, two_year_transaction_period: cycle, min_amount: 5000, sort: "-disbursement_date" })) {
          const to = r.recipient_committee_id ? byCommittee.get(r.recipient_committee_id) : null;
          const url = docUrl(r);
          if (to && url && to !== nodeId && await insertLink({ from: nodeId, to, type: "money", subtype: "transfer", amount: r.disbursement_amount, date_start: r.disbursement_date,
            note: `FEC Schedule B: ${r.disbursement_description ?? "transfer"}.`, source_url: url }, "importer:fec")) added++;
        }
      }
    }
    await endRun(runId, true, added);
  } catch (e) { await endRun(runId, false, added, String(e)); throw e; }
  return added;
}
if (import.meta.url === `file://${process.argv[1]}`) { console.log("fec added", await run()); process.exit(0); }
