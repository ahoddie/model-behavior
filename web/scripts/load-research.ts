// Merge data/research/*.json into Postgres. Rejected rows are written to data/loader-rejections.json.
// Gaps from every slice are collected into data/gaps.md.
import { REPO } from "./env.ts";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pool } from "../src/lib/db.ts";
import { upsertNode, insertLink, insertFeed, insertFiling, insertFact, rejections, setActor, notifySite } from "./lib/ingest.ts";

const dir = join(REPO, "data/research");
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const gaps: Record<string, string[]> = {};
const counts: Record<string, number> = { nodes: 0, links: 0, feed_items: 0, filings: 0, facts: 0 };

await setActor("research-loader");
const slices = files.map((f) => {
  try { return { f, d: JSON.parse(readFileSync(join(dir, f), "utf8")) }; }
  catch (e) { console.error(`skip ${f}: ${(e as Error).message}`); return null; }
}).filter(Boolean) as { f: string; d: any }[];

// Nodes first, across all slices, so cross-slice links resolve.
for (const { d } of slices) for (const n of d.nodes ?? []) if (await upsertNode(n)) counts.nodes++;
for (const { f, d } of slices) {
  for (const l of d.links ?? []) if (await insertLink(l)) counts.links++;
  for (const x of d.feed_items ?? []) if (await insertFeed(x)) counts.feed_items++;
  for (const x of d.filings ?? []) if (await insertFiling(x)) counts.filings++;
  for (const x of d.facts ?? []) if (await insertFact(x)) counts.facts++;
  // Facts that failed the page check (verify-facts.ts) come out of the database if an earlier run loaded them.
  for (const h of d.held ?? []) if (h.label) {
    const r = await pool.query(`DELETE FROM facts WHERE node_id=$1 AND text=$2 AND label=$3`, [h.node ?? h.node_id, String(h.text).trim(), h.label]);
    counts.unheld = (counts.unheld ?? 0) + r.rowCount!;
  }
  if (d.gaps?.length) gaps[d.slice ?? f] = d.gaps;
}

writeFileSync(join(REPO, "data/loader-rejections.json"), JSON.stringify(rejections, null, 2));
const reasons = rejections.reduce<Record<string, number>>((a, r) => ((a[`${r.table}: ${r.reason.replace(/ \S+$/, "")}`] = (a[`${r.table}: ${r.reason.replace(/ \S+$/, "")}`] ?? 0) + 1), a), {});

let md = "# Gaps\n\nThings we looked for but could not source. Nothing here appears on the map.\n";
for (const [slice, list] of Object.entries(gaps)) md += `\n## ${slice}\n\n` + [...new Set(list)].map((g) => `- ${g}`).join("\n") + "\n";
const unknownNodes = [...new Set(rejections.filter((r) => r.reason.startsWith("unknown node")).map((r) => r.reason.slice(13)))];
if (unknownNodes.length) md += `\n## Rows dropped by the loader\n\nRows that referenced an actor or target with no sourced node record were dropped: ${unknownNodes.map((n) => `\`${n}\``).join(", ")}.\n`;
try { md += "\n" + readFileSync(join(REPO, "data/sources/importer-gaps.md"), "utf8"); } catch {}
writeFileSync(join(REPO, "data/gaps.md"), md);

console.log("inserted", counts);
console.log("rejected", rejections.length, reasons);
await notifySite();
await pool.end();
