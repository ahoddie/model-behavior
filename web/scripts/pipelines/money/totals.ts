// Totals by chain, by source actor and by target race, with disclosed / self-reported / undisclosed-upstream shares, written to
// data/eval/money/totals.json and totals.md. It also runs the exact SQL that web/src/lib/data.ts uses (moneyChainSummary) so the page
// query is tested against the real database.
//   tsx totals.ts
import "../../env.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO } from "../../env.ts";
import { q, pool } from "../../../src/lib/db.ts";
import { CHAIN_EDGES } from "./export.ts";

const m = (n: number | null | undefined) => (n == null ? "unknown" : "$" + Math.round(n).toLocaleString("en-US"));

// 1. Run the data.ts summary SQL as written there.
const src = readFileSync(resolve(REPO, "web/src/lib/data.ts"), "utf8");
const body = src.slice(src.indexOf("export async function moneyChainSummary"), src.indexOf("export async function moneyAds"));
const sqls = [...body.matchAll(/q<any>\(`([\s\S]*?)`\)/g)].map((x) => x[1].replaceAll("${CHAIN_EDGES}", CHAIN_EDGES));
const [bySource, byRace, byCommittee] = await Promise.all(sqls.slice(0, 3).map((s) => q<any>(s)));

// 2. Share of each tracked PAC's itemized receipts by origin, straight from the filing lines.
const shares = await q<any>(`
  WITH rc AS (
    SELECT t.node_id, t.amount::float8 amt,
      CASE WHEN t.entity_type='IND' THEN 'individual'
           WHEN t.line_code IN ('SA11C','SA12') OR t.other_committee_id IS NOT NULL THEN 'committee_transfer'
           WHEN EXISTS (SELECT 1 FROM money_hops h WHERE h.hop_basis='undisclosed' AND lower(t.name) LIKE '%' || lower(split_part((SELECT name FROM nodes WHERE id=h.to_id),' ',1)) || '%' AND t.entity_type='ORG') THEN 'via_undisclosed_intermediary'
           ELSE 'organization' END AS kind
    FROM money_x_fec_tx t JOIN money_x_fec_filings f ON f.file_number=t.file_number AND NOT f.superseded
    WHERE t.sched='A' AND NOT t.memo AND NOT t.superseded AND t.line_code NOT IN ('SA17','SA15') OR (t.sched='A' AND t.line_code IN ('SA17','SA15') AND t.entity_type='ORG' AND NOT t.memo AND NOT t.superseded AND t.purpose !~* 'interest|refund|rebate|reimburs|offset|dividend|void|return|in-kind|credit' ))
  SELECT n.name, rc.node_id AS id, sum(amt)::float8 total, sum(amt) FILTER (WHERE kind='individual')::float8 individual, sum(amt) FILTER (WHERE kind='organization')::float8 organization,
         sum(amt) FILTER (WHERE kind='committee_transfer')::float8 committee_transfer, sum(amt) FILTER (WHERE kind='via_undisclosed_intermediary')::float8 via_undisclosed_intermediary
  FROM rc JOIN nodes n ON n.id=rc.node_id GROUP BY 1, 2 ORDER BY total DESC NULLS LAST`);

const chains = await q<any>(`SELECT c.id, c.label, m.network, m.origin_kind, m.disclosed_amount::float8 disclosed, m.self_reported_amount::float8 self_reported, m.has_undisclosed
  FROM money_chains c JOIN money_x_chain_meta m ON m.chain_id=c.id ORDER BY greatest(m.disclosed_amount, m.self_reported_amount) DESC LIMIT 50`);
const counts = await q<any>(`SELECT (SELECT count(*)::int FROM money_chains) chains, (SELECT count(*)::int FROM money_hops) hops,
  (SELECT count(*)::int FROM money_hops WHERE hop_basis='disclosed') disclosed, (SELECT count(*)::int FROM money_hops WHERE hop_basis='self_reported') self_reported,
  (SELECT count(*)::int FROM money_hops WHERE hop_basis='undisclosed') undisclosed, (SELECT count(*)::int FROM money_x_hop_txns) lines,
  (SELECT count(*)::int FROM money_hops WHERE archive_url IS NULL) hops_without_archive, (SELECT count(*)::int FROM money_x_fec_tx WHERE NOT superseded) live_fec_lines,
  (SELECT count(*)::int FROM money_x_ads) ads`);
writeFileSync(resolve(REPO, "data/eval/money/totals.json"), JSON.stringify({ counts: counts[0], bySource, byRace, byCommittee, shares, topChains: chains }, null, 1));
const md = ["# Money chain totals (workstream D)", "", "Pool-level amounts: a hop is the total of filed lines between two parties, not a trace of one donor's dollars.", "",
  `Counts: ${JSON.stringify(counts[0])}`, "", "## Itemized receipts by origin (per committee)", "", "| Committee | Total | Individuals | Organizations | Committee transfers | Via undisclosed-donor intermediary |", "|---|---:|---:|---:|---:|---:|",
  ...shares.map((s: any) => `| ${s.name} | ${m(s.total)} | ${m(s.individual)} | ${m(s.organization)} | ${m(s.committee_transfer)} | ${m(s.via_undisclosed_intermediary)} |`), "",
  "## Top sources (disclosed / self-reported)", "", ...bySource.slice(0, 15).map((s: any) => `- ${s.name}: disclosed ${m(s.disclosed)}, self-reported ${m(s.self_reported)} → ${(s.to_names ?? []).join(", ")}`), "",
  "## Top races by independent expenditure", "", ...byRace.slice(0, 15).map((r: any) => `- ${r.race}: support ${m(r.support)}, oppose ${m(r.oppose)} (${(r.spenders ?? []).join(", ")})`), ""].join("\n");
writeFileSync(resolve(REPO, "data/eval/money/totals.md"), md);
console.log(counts[0], { bySource: bySource.length, byRace: byRace.length, byCommittee: byCommittee.length, shares: shares.length });
await pool.end();
