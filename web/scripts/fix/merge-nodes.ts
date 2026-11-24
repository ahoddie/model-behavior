// Merge duplicate nodes found in docs/data-issues.md. Each pair goes through merge_log (method 'human') and er/apply.ts,
// so every reference moves to the kept id, the old id redirects (data.ts getMergedInto), and `pnpm er:revert --ids N` undoes it.
// Profile text links `[text](old-id)` are rewritten in profile_text and data/profiles/*.json; the merged node's own
// profile entry is dropped from the JSON (the kept node's text stays).
//   tsx scripts/fix/merge-nodes.ts [--dry-run]
import { REPO } from "../env.ts";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { applyMerge } from "../pipelines/er/apply.ts";

export const PAIRS: { kept: string; merged: string; why: string; evidence: string[] }[] = [
  // Merged once on 2026-11-15 (merge_log 7-13); the research loader re-created the old ids on 2026-11-17.
  { kept: "agency-commerce-dept-of-doc", merged: "commerce-department", why: "Same agency (U.S. Department of Commerce); re-created by the research loader after merge 7.", evidence: [] },
  { kept: "agency-federal-trade-commission-ftc", merged: "ftc", why: "Same agency (Federal Trade Commission); re-created after merge 8.", evidence: [] },
  { kept: "agency-natl-security-council-nsc", merged: "national-security-council", why: "Same body (National Security Council); re-created after merge 9.", evidence: [] },
  { kept: "agency-office-of-science-and-technology-policy-ostp", merged: "ostp", why: "Same office (OSTP); re-created after merge 10.", evidence: [] },
  { kept: "agency-executive-office-of-the-president-eop", merged: "white-house", why: "Same office (Executive Office of the President); re-created after merge 13.", evidence: [] },
  { kept: "agency-office-of-the-secretary-of-defense", merged: "osd", why: "Same office (Office of the Secretary of Defense); re-created after merge 12.", evidence: [] },
  { kept: "fli", merged: "future-of-life-institute", why: "Both are the Future of Life Institute (futureoflife.org).", evidence: ["https://futureoflife.org/about-us/"] },
  { kept: "miri", merged: "machine-intelligence-research-institute", why: "Both are the Machine Intelligence Research Institute (intelligence.org).", evidence: ["https://intelligence.org/"] },
  { kept: "smart-justice-california-action-fund", merged: "ent_pac_smart-justice-california-action-fund_8cfde2", why: "Same committee: both cite Abundant Future's FEC filing (C00922229) naming Smart Justice California Action Fund as donor.", evidence: ["https://docquery.fec.gov/cgi-bin/forms/C00922229/1962725/"] },
  { kept: "us-ndaa-fy2026-ai-preemption", merged: "us-ndaa-ai-preemption-2025", why: "Same effort: the Nov-Dec 2025 push to add state AI-law preemption to the FY2026 NDAA.", evidence: ["https://ari.us/ai-law-preemption-dropped-from-ndaa/", "https://www.citizen.org/news/house-gop-attempts-to-slip-ai-preemption-into-the-ndaa/"] },
  { kept: "sarah-may-stern", merged: "sarah-stern", why: "Hudson Institute's 2025 Form 990 lists Sarah May Stern as Chair; hudson.org lists Sarah Stern as President of the Board of Trustees: the same board leader.", evidence: ["https://projects.propublica.org/nonprofits/organizations/131945157/202611739349301606/full", "https://www.hudson.org/hudson-institute-names-joel-scanlon-president-ceo"] },
  { kept: "lawmaker-chris-gober", merged: "chris-gober", why: "Same person: the TX-10 Republican candidate is the Austin election lawyer who ran Elon Musk's America PAC.", evidence: ["https://news.bloomberglaw.com/business-and-practice/elon-musk-pacs-lawyer-files-for-congressional-seat-in-texas", "https://ballotpedia.org/Chris_Gober"] },
];

const DRY = process.argv.includes("--dry-run");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://mb:mb_local_only@127.0.0.1:5433/model_behavior", max: 1 });
const c = await pool.connect();
await c.query("SELECT set_config('mb.actor', 'data-issues', false)");
const done: typeof PAIRS = [];
for (const p of PAIRS.filter((p) => !only || only.includes(p.merged))) {
  const ex = await c.query(`SELECT id FROM nodes WHERE id = ANY($1)`, [[p.kept, p.merged]]);
  if (ex.rowCount !== 2) { console.log(`skip ${p.merged} -> ${p.kept}: ${ex.rowCount} of 2 nodes exist`); continue; }
  try {
    await c.query("BEGIN");
    const { rows: [m] } = await c.query(`INSERT INTO merge_log (action, status, kept_id, merged_id, method, evidence, rationale, confidence)
      VALUES ('merge','proposed',$1,$2,'human',$3,$4,1) RETURNING id`, [p.kept, p.merged, JSON.stringify(p.evidence), `docs/data-issues.md: ${p.why}`]);
    const r = await applyMerge(c, m.id, DRY);
    // profile text links to the old id
    const pt = await c.query(`UPDATE profile_text SET description = replace(description, $1, $2) WHERE description LIKE '%' || $1 || '%' RETURNING node_id`, [`](${p.merged})`, `](${p.kept})`]);
    if (DRY) await c.query("ROLLBACK"); else await c.query("COMMIT");
    console.log(DRY ? "dry" : "merged", JSON.stringify({ ...r, merge_log: m.id, text_links: pt.rowCount }));
    done.push(p);
  } catch (e: any) { await c.query("ROLLBACK"); console.error(`FAILED ${p.merged} -> ${p.kept}: ${e.message}`); }
}
if (!DRY && done.length) {
  const dir = join(REPO, "data/profiles");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const path = join(dir, f); const raw = readFileSync(path, "utf8"); const d = JSON.parse(raw);
    for (const p of done) {
      d.profiles = (d.profiles ?? []).filter((x: any) => x.id !== p.merged);
      for (const x of d.profiles) x.description = String(x.description).split(`](${p.merged})`).join(`](${p.kept})`);
    }
    const out = JSON.stringify(d, null, 2) + "\n";
    if (out !== raw && JSON.stringify(JSON.parse(raw), null, 2) + "\n" !== out) writeFileSync(path, out);
  }
}
c.release(); await pool.end();
