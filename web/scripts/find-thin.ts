// Lists nodes with nothing (empty) or almost nothing (thin) on their profile, by type.
// A record is a shown link, an approved feed item, a filing or a fact. Writes data/thin-profiles.md.
// Usage: tsx scripts/find-thin.ts [--max 2] [--stdout]
import "./env.ts";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pool, q } from "../src/lib/db.ts";
import { REPO } from "./env.ts";

const maxArg = process.argv.indexOf("--max");
const THIN_MAX = maxArg > 0 ? Number(process.argv[maxArg + 1]) : 2;

export type Row = { id: string; type: string; name: string; records: number; links: number; feed: number; filings: number; facts: number; ext: string[] };

export async function thinRows(): Promise<Row[]> {
  return q<Row>(`
    WITH ls AS MATERIALIZED (SELECT from_id, to_id FROM links_shown),
    lc AS (SELECT id, count(*)::int c FROM (SELECT from_id id FROM ls UNION ALL SELECT to_id FROM ls WHERE to_id <> from_id) x GROUP BY id),
    fc AS (SELECT node_id id, count(*)::int c FROM feed_items WHERE status='approved' GROUP BY node_id),
    fl AS (SELECT node_id id, count(*)::int c FROM filings GROUP BY node_id),
    ft AS (SELECT node_id id, count(*)::int c FROM facts GROUP BY node_id)
    SELECT n.id, n.type, n.name, coalesce(lc.c,0) AS links, coalesce(fc.c,0) AS feed, coalesce(fl.c,0) AS filings, coalesce(ft.c,0) AS facts, 0 AS records,
      ARRAY(SELECT k FROM jsonb_object_keys(n.external_ids) k) AS ext
    FROM nodes n LEFT JOIN lc ON lc.id=n.id LEFT JOIN fc ON fc.id=n.id LEFT JOIN fl ON fl.id=n.id LEFT JOIN ft ON ft.id=n.id ORDER BY n.type, n.name`).then((rs) => rs.map((r) => ({ ...r, records: r.links + r.feed + r.filings + r.facts })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = await thinRows();
  const types = [...new Set(rows.map((r) => r.type))].sort();
  const out: string[] = [`# Thin profiles`, ``, `Generated ${new Date().toISOString().slice(0, 10)} by \`web/scripts/find-thin.ts\`. A record is a shown link (\`links_shown\`), an approved feed item, a filing or a fact. Empty = 0 records; thin = 1 to ${THIN_MAX}.`, ``];
  const sum = types.map((t) => {
    const rs = rows.filter((r) => r.type === t);
    return `| ${t} | ${rs.length} | ${rs.filter((r) => r.records === 0).length} | ${rs.filter((r) => r.records > 0 && r.records <= THIN_MAX).length} |`;
  });
  out.push(`## Summary`, ``, `| Type | Nodes | Empty | Thin |`, `| --- | ---: | ---: | ---: |`, ...sum,
    `| **all** | ${rows.length} | ${rows.filter((r) => r.records === 0).length} | ${rows.filter((r) => r.records > 0 && r.records <= THIN_MAX).length} |`, ``);
  for (const t of types) {
    const rs = rows.filter((r) => r.type === t && r.records <= THIN_MAX).sort((a, b) => a.records - b.records || a.name.localeCompare(b.name));
    if (!rs.length) continue;
    out.push(`## ${t}`, ``, `| Records | Node | Links | Feed | Filings | Facts | External IDs |`, `| ---: | --- | ---: | ---: | ---: | ---: | --- |`,
      ...rs.map((r) => `| ${r.records} | [${r.name.replace(/\|/g, "/")}](/node/${r.id}) | ${r.links} | ${r.feed} | ${r.filings} | ${r.facts} | ${r.ext.join(", ")} |`), ``);
  }
  const text = out.join("\n");
  if (process.argv.includes("--stdout")) console.log(text);
  else writeFileSync(resolve(REPO, "data/thin-profiles.md"), text);
  console.log(sum.join("\n"));
  await pool.end();
}
