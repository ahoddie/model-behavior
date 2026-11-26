// Rule 1: every stored row has a source URL and an archive URL. Run after the archive passes (scripts/archive-then-prune.sh).
// Deletes rows whose source has no Wayback copy, logs each deletion in `corrections`, and writes every deleted row to
// data/pruned/<timestamp>.jsonl so nothing is lost for good. Profiles are deleted only when nothing else points at them,
// because deleting a node cascades to its links, facts and filings.
// Safety stop: if any table would lose more than --max-share of its rows (default 0.2), nothing is deleted and a report is written.
//   tsx scripts/prune-unarchived.ts [--dry-run] [--max-share 0.2]
import "./env.ts";
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO } from "./env.ts";
import { pool, q } from "../src/lib/db.ts";

const dry = process.argv.includes("--dry-run");
const mi = process.argv.indexOf("--max-share");
const maxShare = mi > 0 ? Number(process.argv[mi + 1]) : 0.2;

// A source that is itself a Wayback capture is its own archive.
for (const [t, col] of [["nodes", "source_url"], ["links", "source_url"], ["feed_items", "url"], ["filings", "url"], ["facts", "url"], ["money_hops", "source_url"]] as const) {
  await pool.query(`UPDATE ${t} SET archive_url=${col} WHERE coalesce(archive_url,'')='' AND ${col} LIKE 'https://web.archive.org/web/%'`);
  await pool.query(`UPDATE ${t} x SET archive_url=a.archive_url FROM archives a WHERE a.url=x.${col} AND a.archive_url IS NOT NULL AND coalesce(x.archive_url,'')=''`);
}

const TABLES = [["links", "source_url"], ["feed_items", "url"], ["filings", "url"], ["facts", "url"], ["money_hops", "source_url"]] as const;
const plan: { table: string; total: number; doomed: number }[] = [];
for (const [t] of TABLES) {
  const [r] = await q<{ total: string; doomed: string }>(`SELECT count(*) total, count(*) FILTER (WHERE coalesce(archive_url,'')='') doomed FROM ${t}`);
  plan.push({ table: t, total: Number(r.total), doomed: Number(r.doomed) });
}
// Nodes: only those with no archive and no remaining references once the rows above are gone.
const NODE_UNREF = `coalesce(n.archive_url,'')='' AND n.type NOT IN ('bill','race','rule')
  AND NOT EXISTS (SELECT 1 FROM links l WHERE (l.from_id=n.id OR l.to_id=n.id) AND coalesce(l.archive_url,'')<>'')
  AND NOT EXISTS (SELECT 1 FROM feed_items f WHERE f.node_id=n.id AND coalesce(f.archive_url,'')<>'')
  AND NOT EXISTS (SELECT 1 FROM filings f WHERE f.node_id=n.id AND coalesce(f.archive_url,'')<>'')
  AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.node_id=n.id AND coalesce(f.archive_url,'')<>'')
  AND NOT EXISTS (SELECT 1 FROM money_hops h WHERE (h.from_id=n.id OR h.to_id=n.id) AND coalesce(h.archive_url,'')<>'')`;
const [nr] = await q<{ total: string; doomed: string }>(`SELECT (SELECT count(*) FROM nodes) total, count(*) doomed FROM nodes n WHERE ${NODE_UNREF}`);
const [ref] = await q<{ n: string }>(`SELECT count(*) n FROM nodes WHERE coalesce(archive_url,'')=''`);
plan.push({ table: "nodes (unreferenced only)", total: Number(nr.total), doomed: Number(nr.doomed) });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = resolve(REPO, "data/pruned"); mkdirSync(dir, { recursive: true });
const report = [`# Prune of rows without an archive copy (${stamp})`, "", "| Table | Rows | Without archive | Share |", "|---|---:|---:|---:|",
  ...plan.map((p) => `| ${p.table} | ${p.total} | ${p.doomed} | ${(p.doomed / Math.max(1, p.total) * 100).toFixed(1)}% |`),
  "", `Profiles with no archive that other archived rows still point at (kept): ${Number(ref.n) - Number(nr.doomed)}`].join("\n");
const over = plan.filter((p) => p.doomed / Math.max(1, p.total) > maxShare);
console.log(report);
if (dry || over.length) {
  writeFileSync(resolve(dir, `${stamp}-plan.md`), report + (over.length ? `\n\nStopped: ${over.map((o) => o.table).join(", ")} would lose more than ${maxShare * 100}%. Nothing deleted.\n` : "\n\nDry run. Nothing deleted.\n"));
  console.log(over.length ? `STOPPED: over ${maxShare * 100}% in ${over.map((o) => o.table).join(", ")}` : "dry run");
  await pool.end(); process.exit(over.length ? 2 : 0);
}

const out = resolve(dir, `${stamp}.jsonl`);
const c = await pool.connect();
try {
  await c.query("BEGIN");
  for (const [t, col] of TABLES) {
    const del = await c.query(`DELETE FROM ${t} WHERE coalesce(archive_url,'')='' RETURNING *`);
    for (const row of del.rows) {
      appendFileSync(out, JSON.stringify({ table: t, row }) + "\n");
      await c.query(`INSERT INTO corrections (table_name,row_ref,what_changed,url) VALUES ($1,$2,$3,$4)`,
        [t, String(row.id), "Removed: no archived copy of the source could be made.", row[col]]);
    }
  }
  const del = await c.query(`DELETE FROM nodes n WHERE ${NODE_UNREF} RETURNING *`);
  for (const row of del.rows) {
    appendFileSync(out, JSON.stringify({ table: "nodes", row }) + "\n");
    await c.query(`INSERT INTO corrections (table_name,row_ref,what_changed,url) VALUES ('nodes',$1,$2,$3)`, [row.id, "Removed: no archived copy of the source could be made.", row.source_url]);
  }
  await c.query("COMMIT");
} catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
writeFileSync(resolve(dir, `${stamp}-done.md`), report + `\n\nDeleted rows saved to ${out}.\n`);
console.log(`pruned; rows saved to ${out}`);
await pool.end();
