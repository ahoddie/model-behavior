// Reconcile our parsed itemized lines against FEC committee totals, per committee and two-year cycle.
// FEC source, in order of preference: the /committee/{id}/totals/ API response (cached by fecapi.ts) when we have it, otherwise the
// F3X column-A summaries of the committee's own non-superseded reports (the same numbers the API totals are built from).
// Every difference above 1% is explained or left 'open'. Output: money_x_reconcile and data/eval/money/reconciliation.md.
//   tsx reconcile.ts
import "../../env.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { REPO } from "../../env.ts";
import { pool, q } from "../../../src/lib/db.ts";
import { cached } from "./fecapi.ts";
import { TRACKED } from "./tracked.ts";

const cycleOf = (d: string) => { const y = +d.slice(0, 4); return y % 2 ? y + 1 : y; };
const money = (n: number | null) => (n == null ? "n/a" : "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
type R = { committee: string; node: string; cycle: number; metric: string; fec: number | null; ours: number | null; src: string; why: string[] };
const out: R[] = [];

for (const t of TRACKED) {
  const fil = await q<any>(`SELECT file_number, report_code, amendment, coverage_start::text cs, coverage_end::text ce, total_receipts::float8 r, total_disbursements::float8 d, f3x_cols, superseded
    FROM money_x_fec_filings WHERE committee_id=$1 AND form_type='F3X' ORDER BY coverage_start`, [t.fec]);
  const live = fil.filter((f) => !f.superseded && f.cs);
  const cycles = [...new Set(live.map((f) => cycleOf(f.ce)))];
  for (const cy of cycles) {
    const fs = live.filter((f) => cycleOf(f.ce) === cy);
    const lo = fs[0].cs, hi = fs.at(-1).ce;
    const why: string[] = [];
    // Gaps between consecutive reports.
    for (let i = 1; i < fs.length; i++) { const gap = (Date.parse(fs[i].cs) - Date.parse(fs[i - 1].ce)) / 864e5; if (gap > 1.5) why.push(`no F3X downloaded for ${fs[i - 1].ce}→${fs[i].cs}`); }
    const f3xR = fs.reduce((a, f) => a + (f.r ?? 0), 0), f3xD = fs.reduce((a, f) => a + (f.d ?? 0), 0);
    const unitem = fs.reduce((a, f) => a + (f.f3x_cols?.["30"] ?? 0), 0);
    // Apples to apples: only lines that sit inside the non-superseded F3X reports being summed. Lines that a later 24/48-hour report
    // restated (same transaction id) are still counted here from the F3X copy; the hop totals use the later copy instead.
    const [o] = await q<any>(`SELECT
        coalesce(sum(t.amount) FILTER (WHERE t.sched='A' AND NOT t.memo),0)::float8 a,
        coalesce(sum(t.amount) FILTER (WHERE t.sched='A' AND t.memo),0)::float8 a_memo,
        coalesce(sum(t.amount) FILTER (WHERE t.sched='B' AND NOT t.memo),0)::float8 b,
        coalesce(sum(t.amount) FILTER (WHERE t.sched='E' AND NOT t.memo),0)::float8 e,
        coalesce(sum(t.amount) FILTER (WHERE t.sched='E' AND NOT t.memo AND t.superseded),0)::float8 e_restated
      FROM money_x_fec_tx t JOIN money_x_fec_filings f ON f.file_number=t.file_number AND f.form_type='F3X' AND NOT f.superseded
      WHERE t.committee_id=$1 AND f.coverage_end BETWEEN $2 AND $3`, [t.fec, lo, hi]);
    const [f24] = await q<any>(`SELECT coalesce(sum(t.amount),0)::float8 s, count(*)::int n FROM money_x_fec_tx t JOIN money_x_fec_filings f ON f.file_number=t.file_number AND f.form_type='F24'
      WHERE t.committee_id=$1 AND t.sched='E' AND NOT t.memo AND NOT t.superseded AND t.tx_date BETWEEN $2 AND $3`, [t.fec, lo, hi]);
    // Receipts: itemized + unitemized individual vs F3X total receipts.
    const ours = o.a + unitem;
    if (unitem) why.push(`includes ${money(unitem)} of unitemized individual receipts (F3X line 11(a)(ii)), which have no per-donor line`);
    if (o.a_memo) why.push(`${money(o.a_memo)} of Schedule A memo entries excluded (memo lines repeat money already reported on a parent line)`);
    out.push({ committee: t.fec, node: t.node, cycle: cy, metric: "receipts", fec: f3xR, ours, src: "f3x_summary", why: [...why] });
    // Disbursements: Schedule B plus Schedule E lines vs F3X total disbursements. F24 24/48-hour IEs that a later F3X restates are deduped by transaction id.
    const oursD = o.b + o.e;
    const why2 = [...why.filter((w) => w.startsWith("no F3X"))];
    if (o.e_restated) why2.push(`${money(o.e_restated)} of F3X independent expenditures were later restated in a 24/48-hour report (same transaction id); included here from the F3X copy`);
    if (f24.n) why2.push(`${f24.n} F24 independent expenditures (${money(f24.s)}) not yet inside an F3X are excluded here and included in hop/ad totals`);
    out.push({ committee: t.fec, node: t.node, cycle: cy, metric: "disbursements", fec: f3xD, ours: oursD, src: "f3x_summary", why: why2 });
    // API totals when cached.
    const api = cached(`/committee/${t.fec}/totals/`, { cycle: cy, per_page: 5 })?.results?.[0];
    if (api) {
      out.push({ committee: t.fec, node: t.node, cycle: cy, metric: "receipts", fec: api.receipts, ours: f3xR, src: "api_totals (vs F3X column-A sum)", why: [`api coverage ${api.coverage_start_date?.slice(0, 10)}→${api.coverage_end_date?.slice(0, 10)}; ours ${lo}→${hi}`] });
      out.push({ committee: t.fec, node: t.node, cycle: cy, metric: "independent_expenditures", fec: api.independent_expenditures, ours: o.e, src: "api_totals", why: [] });
    }
  }
}

await pool.query(`DELETE FROM money_x_reconcile`);
const lines = ["# FEC reconciliation (workstream D)", "", `Run ${new Date().toISOString().slice(0, 10)}. FEC source: F3X column-A summaries of each committee's own reports (and \`/committee/{id}/totals/\` where the API cache has it). Tolerance 1%.`, "",
  "| Committee | Cycle | Metric | FEC total | Ours | Diff | % | Source | Status / explanation |", "|---|---|---|---:|---:|---:|---:|---|---|"];
let ok = 0, explained = 0, open = 0;
for (const r of out) {
  const diff = (r.fec ?? 0) - (r.ours ?? 0), pct = r.fec ? (100 * diff) / r.fec : 0;
  const status = Math.abs(pct) <= 1 ? "ok" : r.why.length ? "explained" : "open";
  if (status === "ok") ok++; else if (status === "explained") explained++; else open++;
  const expl = status === "ok" ? "" : r.why.join("; ") || "UNEXPLAINED";
  await pool.query(`INSERT INTO money_x_reconcile (committee_id,node_id,cycle,metric,fec_total,our_total,diff,pct,fec_source,explanation,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [r.committee, r.node, r.cycle, r.metric, r.fec, r.ours, diff, pct.toFixed(3), r.src, expl, status]);
  lines.push(`| ${r.node} (${r.committee}) | ${r.cycle} | ${r.metric} | ${money(r.fec)} | ${money(r.ours)} | ${money(diff)} | ${pct.toFixed(2)} | ${r.src} | ${status}${expl ? ": " + expl : ""} |`);
}
lines.push("", `**${out.length} comparisons: ${ok} within 1%, ${explained} outside 1% and explained, ${open} open.**`);
mkdirSync(resolve(REPO, "data/eval/money"), { recursive: true });
writeFileSync(resolve(REPO, "data/eval/money/reconciliation.md"), lines.join("\n") + "\n");
console.log({ comparisons: out.length, ok, explained, open });
await pool.end();
