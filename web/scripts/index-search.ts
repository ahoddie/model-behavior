// Push every node, approved feed item and filing into Meilisearch (index "everything").
import "./env.ts";
import { Meilisearch } from "meilisearch";
import { q, pool } from "../src/lib/db.ts";

export async function indexAll() {
  const ms = new Meilisearch({ host: process.env.MEILI_HOST ?? "http://127.0.0.1:7700", apiKey: process.env.MEILI_KEY });
  const idx = ms.index("everything");
  await ms.createIndex("everything", { primaryKey: "key" }).waitTask().catch(() => {});
  await idx.updateSettings({
    searchableAttributes: ["title", "body", "node_name", "issues"],
    filterableAttributes: ["kind", "node_id", "node_type", "date_year"],
    sortableAttributes: ["date"],
  }).waitTask();
  const nodes = await q(`SELECT id, type, name, descriptor, source_url FROM nodes`);
  const feed = await q(`SELECT f.id, f.node_id, n.name AS node_name, n.type AS node_type, f.date::text, f.kind, coalesce(f.excerpt, f.summary) AS body, f.url, f.issues
                        FROM feed_items f JOIN nodes n ON n.id=f.node_id WHERE f.status='approved'`);
  const filings = await q(`SELECT f.id, f.node_id, n.name AS node_name, n.type AS node_type, coalesce(f.filed_date::text, '') AS date, f.filing_type, f.period, f.description, f.amount, f.url, f.issues
                           FROM filings f JOIN nodes n ON n.id=f.node_id`);
  const docs = [
    ...nodes.map((n: any) => ({ key: `node-${n.id}`, kind: "node", node_id: n.id, node_type: n.type, node_name: n.name, title: n.name, body: n.descriptor ?? "", url: `/node/${n.id}` })),
    ...feed.map((f: any) => ({ key: `feed-${f.id}`, kind: "feed", node_id: f.node_id, node_type: f.node_type, node_name: f.node_name, title: `${f.node_name}: ${f.kind}`, body: f.body,
      date: f.date, date_year: Number(f.date.slice(0, 4)), url: f.url, issues: f.issues })),
    ...filings.map((f: any) => ({ key: `filing-${f.id}`, kind: "filing", node_id: f.node_id, node_type: f.node_type, node_name: f.node_name, title: `${f.node_name}: ${f.filing_type} ${f.period ?? ""}`,
      body: f.description ?? "", amount: f.amount ? Number(f.amount) : null, date: f.date, date_year: f.date ? Number(f.date.slice(0, 4)) : null, url: f.url, issues: f.issues })),
  ];
  await idx.deleteAllDocuments().waitTask();
  for (let i = 0; i < docs.length; i += 5000) await idx.addDocuments(docs.slice(i, i + 5000)).waitTask();
  console.log(`indexed ${docs.length} documents`);
  return docs.length;
}
if (import.meta.url === `file://${process.argv[1]}`) { await indexAll(); await pool.end(); }
