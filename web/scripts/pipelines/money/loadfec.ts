// Parse cached raw .fec filings into money_x_fec_tx / money_x_fec_filings.
// Field layouts follow the FEC e-filing format 8.x (fields separated by ASCII 28). Verified against the filings
// this pipeline reads (see data/eval/money/). Street addresses, ZIPs, phones and emails are never read into rows.
//   tsx loadfec.ts
import "../../env.ts";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pool } from "../../../src/lib/db.ts";
import { FEC_DIR } from "./fecfiles.ts";
import { TRACKED } from "./tracked.ts";

const clean = (s: string | undefined) => (s ?? "").replace(/^"|"$/g, "").replace(/\s+/g, " ").trim();
const date = (s: string | undefined) => { const x = clean(s); return /^\d{8}$/.test(x) ? `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}` : null; };
const num = (s: string | undefined) => { const n = Number(clean(s)); return Number.isFinite(n) && clean(s) !== "" ? n : null; };
const person = (last: string, first: string) => [clean(last), clean(first)].filter(Boolean).join(", ");

type Row = Record<string, any>;
export function parseFec(file: string, text: string) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const sep = "\x1c";
  const hdr = lines.find((l) => /^F\d/.test(l))?.split(sep);
  if (!hdr) return null;
  const form = clean(hdr[0]); // F3XN, F3XA, F24N, F5N ...
  const committee = clean(hdr[1]);
  const base = /^F3X/.test(form) ? "F3X" : /^F3[NAT]/.test(form) ? "F3" : /^F24/.test(form) ? "F24" : form.replace(/[NAT]$/, "");
  const amendment = form.slice(-1);
  const filing = {
    file_number: file, committee_id: committee, form_type: base, amendment,
    report_code: base === "F3X" ? clean(hdr[9]) : base === "F24" ? "24" : null,
    coverage_start: base === "F3X" ? date(hdr[13]) : null, coverage_end: base === "F3X" ? date(hdr[14]) : null,
    total_receipts: base === "F3X" ? num(hdr[23]) : null, total_disbursements: base === "F3X" ? num(hdr[25]) : null,
    f3x_cols: base === "F3X" ? Object.fromEntries(hdr.slice(22, 62).map((v, i) => [String(22 + i), num(v)])) : null,
  };
  const rows: Row[] = [];
  for (const l of lines) {
    const p = l.split(sep);
    const code = clean(p[0]);
    const sched = code.startsWith("SA") ? "A" : code.startsWith("SB") ? "B" : code.startsWith("SE") ? "E" : null;
    if (!sched) continue;
    const common = { line_code: code, transaction_id: clean(p[2]), entity_type: clean(p[5]) || null,
      name: clean(p[6]) || person(p[7], p[8]), city: clean(p[14]) || null, state: clean(p[15]).replace(/\s/g, "") || null };
    if (sched === "A") {
      const comm = clean(p[25]);
      rows.push({ ...common, sched, tx_date: date(p[19]), amount: num(p[20]), purpose: clean(p[22]) || null,
        employer: clean(p[23]) || null, occupation: clean(p[24]) || null, other_committee_id: /^C\d{8}$/.test(comm) ? comm : null,
        memo: clean(p[42]) === "X", memo_text: clean(p[43]) || null });
    } else if (sched === "B") {
      const comm = clean(p[24]);
      rows.push({ ...common, sched, tx_date: date(p[19]), amount: num(p[20]), purpose: clean(p[22]) || null,
        other_committee_id: /^C\d{8}$/.test(comm) ? comm : null, memo: clean(p[41]) === "X", memo_text: clean(p[42]) || null });
    } else {
      rows.push({ ...common, sched, tx_date: date(p[19]), amount: num(p[20]), dissemination_date: date(p[21]), purpose: clean(p[23]) || null,
        support_oppose: clean(p[26]) || null, candidate_id: clean(p[27]) || null, candidate_name: person(p[28], p[29]) || null,
        candidate_office: clean(p[33]) || null, candidate_state: clean(p[35]) || null, candidate_district: clean(p[34]) || null,
        election_code: clean(p[17]) || null, memo: clean(p[42]) === "X", memo_text: clean(p[43]) || null });
    }
  }
  return { filing, rows: rows.filter((r) => r.amount != null && r.transaction_id) };
}

async function main() {
  const nodeOf = new Map(TRACKED.map((t) => [t.fec, t.node]));
  const files = readdirSync(FEC_DIR).filter((f) => f.endsWith(".fec"));
  let nrows = 0;
  for (const f of files) {
    const fn = f.replace(".fec", "");
    const parsed = parseFec(fn, readFileSync(resolve(FEC_DIR, f), "latin1"));
    if (!parsed) { console.log("skip", f); continue; }
    const { filing, rows } = parsed;
    await pool.query(`INSERT INTO money_x_fec_filings (file_number,committee_id,form_type,report_code,amendment,coverage_start,coverage_end,total_receipts,total_disbursements,f3x_cols)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (file_number) DO UPDATE SET form_type=$3,report_code=$4,amendment=$5,coverage_start=$6,coverage_end=$7,total_receipts=$8,total_disbursements=$9,f3x_cols=$10`,
      [fn, filing.committee_id, filing.form_type, filing.report_code, filing.amendment, filing.coverage_start, filing.coverage_end, filing.total_receipts, filing.total_disbursements, filing.f3x_cols]);
    for (const r of rows) {
      const url = `https://docquery.fec.gov/cgi-bin/forms/${filing.committee_id}/${fn}/s${r.sched.toLowerCase()}`;
      await pool.query(`INSERT INTO money_x_fec_tx (committee_id,node_id,file_number,form_type,report_code,amendment,coverage_start,coverage_end,sched,line_code,transaction_id,entity_type,name,employer,occupation,city,state,tx_date,amount,purpose,other_committee_id,candidate_id,candidate_name,candidate_office,candidate_state,candidate_district,support_oppose,election_code,dissemination_date,memo,memo_text,source_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
        ON CONFLICT (file_number, transaction_id) DO NOTHING`,
        [filing.committee_id, nodeOf.get(filing.committee_id) ?? null, fn, filing.form_type, filing.report_code, filing.amendment, filing.coverage_start, filing.coverage_end, r.sched, r.line_code, r.transaction_id,
          r.entity_type, r.name, r.employer ?? null, r.occupation ?? null, r.city, r.state, r.tx_date, r.amount, r.purpose, r.other_committee_id ?? null, r.candidate_id ?? null, r.candidate_name ?? null,
          r.candidate_office ?? null, r.candidate_state ?? null, r.candidate_district ?? null, r.support_oppose ?? null, r.election_code ?? null, r.dissemination_date ?? null, r.memo, r.memo_text, url]);
      nrows++;
    }
  }
  // Supersession. (1) a later F3X/F3 for the same committee and coverage window replaces earlier ones;
  // (2) the same transaction id in a later filing replaces the earlier copy (amended F24s, F24 → F3X repeats).
  await pool.query(`UPDATE money_x_fec_filings f SET superseded = EXISTS (SELECT 1 FROM money_x_fec_filings g WHERE g.committee_id=f.committee_id AND g.form_type=f.form_type
      AND g.form_type IN ('F3X','F3') AND g.coverage_start=f.coverage_start AND g.coverage_end=f.coverage_end AND g.file_number::int > f.file_number::int)`);
  await pool.query(`UPDATE money_x_fec_tx t SET superseded = false`);
  await pool.query(`UPDATE money_x_fec_tx t SET superseded = true WHERE EXISTS (SELECT 1 FROM money_x_fec_filings f WHERE f.file_number=t.file_number AND f.superseded)`);
  await pool.query(`UPDATE money_x_fec_tx t SET superseded = true WHERE NOT t.superseded AND EXISTS (SELECT 1 FROM money_x_fec_tx u WHERE u.committee_id=t.committee_id AND u.transaction_id=t.transaction_id
      AND u.sched=t.sched AND u.file_number::int > t.file_number::int AND NOT u.superseded)`);
  const c = await pool.query(`SELECT count(*) FILTER (WHERE NOT superseded) live, count(*) total FROM money_x_fec_tx`);
  console.log(`parsed ${files.length} files, ${nrows} rows seen;`, c.rows[0]);
  await pool.end();
}
if (import.meta.url === `file://${process.argv[1]}`) main();
