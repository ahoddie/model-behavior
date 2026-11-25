// FEC (api.open.fec.gov). For every PAC node with an FEC committee id:
//  - Schedule A receipts ≥ $1,000 → a filing row per transaction; a money link from the giver when the giver is a
//    known node (people matched on first + last name, organisations on name tokens). Money is credited to the
//    contributor exactly as the filing names them, never to an employer.
//  - Schedule E independent expenditures → a money link to the candidate (lawmaker node, created from the FEC
//    candidate record) with support/oppose stance, plus a race node for the contest.
//  - Schedule B transfers to other known committees.
// Also, for every person with FEC gifts on record (or external_ids.fec_donor), Schedule A contributions they made to any
// committee already on the map, by contributor name.
import { REPO } from "../env.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { q } from "../../src/lib/db.ts";
import { insertFiling, insertLink, upsertNode, startRun, endRun, politeFetch, sleep } from "../lib/ingest.ts";

const KEY = process.env.DATA_GOV_KEY || "DEMO_KEY";
const API = "https://api.open.fec.gov/v1";
const cycles = [2024, 2026];
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const docUrl = (r: any) => r.pdf_url || (r.image_number ? `https://docquery.fec.gov/cgi-bin/fecimg/?${r.image_number}` : null)
  || (r.file_number ? `https://docquery.fec.gov/cgi-bin/forms/${r.committee_id}/${r.file_number}/` : null);

// DEMO_KEY has an hourly and a small daily cap (about 10 calls a day in Nov 2026), so calls are spaced 95 seconds apart.
const GAP = KEY === "DEMO_KEY" ? 95000 : 800;
let lastCall = 0;
class RateLimitStop extends Error { constructor(public retryAfter: number) { super(`FEC daily limit reached; resets in ${Math.ceil(retryAfter / 60)} min`); } }
async function pace() {
  const wait = lastCall + GAP - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

async function get(path: string, params: Record<string, string | number | (string | number)[]>) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries({ ...params, api_key: KEY, per_page: 100 }))
    for (const x of [v].flat()) u.searchParams.append(k, String(x));
  const out: any[] = [];
  let last: Record<string, string> = {};
  for (let page = 0; page < 20; page++) {
    for (const [k, v] of Object.entries(last)) u.searchParams.set(k, v);
    await pace();
    let res = await politeFetch(u.toString());
    // Over the limit. DEMO_KEY allows only about 10 calls a day per IP (resetting at midnight UTC), so on DEMO_KEY, or when
    // Retry-After is more than two hours, stop cleanly: donor progress is saved, and the next run resumes. With a real
    // key, wait out a short window once and try again.
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after") ?? 3600);
      if (KEY === "DEMO_KEY" || ra > 7200) throw new RateLimitStop(ra);
      console.warn(`fec rate limit; waiting ${Math.ceil(ra / 60)} min`); await sleep((ra + 60) * 1000); lastCall = Date.now(); res = await politeFetch(u.toString());
    }
    if (!res.ok) { console.warn(`fec ${res.status} ${path}`); throw new Error(`fec ${res.status} ${path}`); }
    const j: any = await res.json();
    out.push(...(j.results ?? []));
    const li = j.pagination?.last_indexes;
    if (!li || !j.results?.length || out.length >= (j.pagination?.count ?? 0)) break;
    last = Object.fromEntries(Object.entries(li).map(([k, v]) => [k, String(v)]));
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

    // Memo lines that are not money to this committee: a gift earmarked through it for a candidate or party (a conduit
    // such as DigiDems), and a party's share of a joint fundraising gift ("* HARRIS VICTORY FUND"), which is already
    // counted as the gift to the joint fundraising committee. Partnership attributions and gifts to a committee's
    // building, legal or non-contribution accounts are real gifts and are kept.
    const passThrough = (r: any) => {
      const m = String(r.memo_text ?? "").trim();
      return /^EARMARK/i.test(m) || /^\*\s/.test(m) || /\bJFC\b|JOINT FUNDRAIS/i.test(m) || ["15J", "18J"].includes(String(r.receipt_type ?? "").toUpperCase());
    };
    // FEC_DONORS_ONLY=id1,id2 runs only the donor search below, for those people (a quick check or backfill).
    const only = process.env.FEC_DONORS_ONLY?.split(",").map((x) => x.trim()).filter(Boolean);
    // On DEMO_KEY the committee scans (80 committees, three schedules, two cycles) can't finish in a day, so they run only
    // when asked (FEC_COMMITTEES=1). The donor search below is what keeps gifts complete.
    const scanCommittees = !only && (KEY !== "DEMO_KEY" || process.env.FEC_COMMITTEES === "1");
    if (!scanCommittees && !only) console.log("fec: skipping committee scans on DEMO_KEY (set FEC_COMMITTEES=1 to run them)");
    for (const [committee, nodeId] of scanCommittees ? byCommittee : []) {
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
    // Every gift a tracked donor made to a committee on the map, found by contributor name across both cycles. The
    // committee scans above stop at 2,000 receipts each, so they miss older lines at large committees (party committees
    // above all), and hand-collected rows often hold only the larger gifts. Memo lines count too: a partnership's gift
    // attributed to a partner is itemized under the partner's name (the partnership's own line names the partnership).
    // The database may already hold some of these gifts from research rows with other source URLs, so for each
    // giver, committee, date, and amount, only the lines beyond those already stored are added.
    const donors = await q<{ id: string; name: string }>(`
      SELECT DISTINCT n.id, n.name FROM nodes n JOIN links l ON l.from_id=n.id
       WHERE n.type='person' AND l.type='money' AND l.source_url ILIKE '%fec.gov%'
      UNION SELECT id, name FROM nodes WHERE type='person' AND external_ids ? 'fec_donor'`);
    // Progress is saved after each donor, so a stopped run picks up where it left off. With a real key a donor searched
    // in the last 7 days is skipped; on DEMO_KEY (a few calls a day) each donor is searched once, so the nightly run
    // does nothing after the backfill is done. FEC_DONORS_ONLY always searches.
    const stateFile = join(REPO, "data/cache/fec-donors.json");
    const state: Record<string, string> = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
    const fresh = (id: string) => !!state[id] && (KEY === "DEMO_KEY" || Date.now() - Date.parse(state[id]) < 7 * 86400000);
    const todo = only ? donors.filter((x) => only.includes(x.id)) : donors.filter((x) => !fresh(x.id));
    console.log(`fec: ${todo.length} of ${donors.length} donors to search`);
    for (const d of todo) {
      const parts = d.name.replace(/[.,]/g, "").split(/\s+/).filter((w) => !/^(jr|sr|ii|iii|iv)$/i.test(w));
      if (parts.length < 2) continue;
      let lines: any[];
      // A failed search (an outage, a refused name) leaves the donor unmarked, so the next run tries again.
      try { lines = (await get("/schedules/schedule_a/", { contributor_name: `${parts.at(-1)!.toUpperCase()}, ${parts[0].toUpperCase()}`,
        two_year_transaction_period: cycles, min_amount: 1000, sort: "-contribution_receipt_date" }))
        .filter((r) => r.entity_type === "IND" && matchPerson(r) === d.id && byCommittee.has(r.committee_id) && docUrl(r) && !passThrough(r)); }
      catch (e) { if (e instanceof RateLimitStop) throw e; console.warn(`fec: ${d.id}: ${(e as Error).message}; will retry next run`); continue; }
      const want = new Map<string, any[]>();
      for (const r of lines) {
        const k = `${byCommittee.get(r.committee_id)}|${r.contribution_receipt_date?.slice(0, 10)}|${Number(r.contribution_receipt_amount).toFixed(2)}`;
        want.set(k, [...(want.get(k) ?? []), r]);
      }
      for (const [k, rs] of want) {
        const [to, date, amount] = k.split("|");
        if (to === d.id) continue;
        const have = (await q<{ n: number }>(`SELECT count(*)::int n FROM links WHERE from_id=$1 AND to_id=$2 AND type='money' AND date_start=$3 AND amount=$4
          AND source_url ILIKE '%fec.gov%'`, [d.id, to, date, amount]))[0].n;
        for (const r of rs.slice(have)) {
          const tx = r.transaction_id ?? r.sub_id;
          if (await insertLink({ from: d.id, to, type: "money", subtype: "contribution", amount: r.contribution_receipt_amount, date_start: r.contribution_receipt_date,
            note: `FEC Schedule A: ${r.contributor_name} to ${r.committee?.name ?? r.committee_id}${r.memo_text ? `. Memo: ${r.memo_text}` : ""}.`,
            // One page can carry several lines of the same amount and date, so the transaction id keeps each one distinct.
            source_url: `${docUrl(r)}${tx ? `#tx-${tx}` : ""}` }, "importer:fec")) added++;
        }
      }
      state[d.id] = new Date().toISOString();
      mkdirSync(join(REPO, "data/cache"), { recursive: true });
      writeFileSync(stateFile, JSON.stringify(state, null, 1));
      console.log(`fec: ${d.id}: ${lines.length} lines on the map, ${added} added so far`);
    }
    await endRun(runId, true, added);
  } catch (e) {
    // The daily cap is the expected end of a DEMO_KEY run, not a failure.
    if (e instanceof RateLimitStop) { console.log(`fec: ${e.message}; ${added} added; the next run resumes`); await endRun(runId, true, added, e.message); return added; }
    await endRun(runId, false, added, String(e)); throw e;
  }
  return added;
}
if (import.meta.url === `file://${process.argv[1]}`) { console.log("fec added", await run()); process.exit(0); }
