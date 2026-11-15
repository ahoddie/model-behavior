// Push every node, approved feed item and filing into Meilisearch (index "everything").
import "./env.ts";
import { Meilisearch } from "meilisearch";
import { q, pool } from "../src/lib/db.ts";
import { nodeKey, quoteKey, pickCanonical, MERGED_SQL } from "../src/lib/sameness.ts";

export async function indexAll() {
  const ms = new Meilisearch({ host: process.env.MEILI_HOST ?? "http://127.0.0.1:7700", apiKey: process.env.MEILI_KEY });
  const idx = ms.index("everything");
  await ms.createIndex("everything", { primaryKey: "key" }).waitTask({ timeout: 300_000 }).catch(() => {});
  await idx.updateSettings({
    searchableAttributes: ["title", "aliases", "body", "node_name", "issues"],
    filterableAttributes: ["kind", "node_id", "node_type", "date_year"],
    sortableAttributes: ["date"],
  }).waitTask({ timeout: 300_000 });
  // Same item, one result: duplicates of a node (or the same quote under several speakers) collapse into one document.
  const merged = new Map((await q<{ merged_id: string; kept_id: string }>(MERGED_SQL)).map((r) => [r.merged_id, r.kept_id]));
  const rawNodes = await q<any>(`SELECT n.id, n.type, n.name, n.descriptor, n.source_url,
      (SELECT count(*)::int FROM links l WHERE l.from_id=n.id OR l.to_id=n.id) AS weight,
      coalesce((SELECT array_agg(DISTINCT alias) FROM entity_aliases a WHERE a.node_id=n.id), '{}') AS alias_names FROM nodes n`);
  const groups = new Map<string, any[]>();
  for (const n of rawNodes) { const k = nodeKey(n, merged); groups.set(k, [...(groups.get(k) ?? []), n]); }
  const nodes = [...groups.values()].map((g) => {
    const c = pickCanonical(g, merged);
    const others = g.filter((x) => x.id !== c.id);
    return { ...c, also: others.map((x) => ({ id: x.id, name: x.name })), aliases: [...new Set([...g.flatMap((x) => x.alias_names), ...others.map((x) => x.name)])] };
  });
  const feed = await q(`SELECT f.id, f.node_id, n.name AS node_name, n.type AS node_type, f.date::text, f.kind, coalesce(f.excerpt, f.summary) AS body, f.url, f.issues
                        FROM feed_items f JOIN nodes n ON n.id=f.node_id WHERE f.status='approved'`);
  const fg = new Map<string, any[]>();
  for (const f of feed as any[]) { const k = quoteKey(f.body ?? ""); fg.set(k, [...(fg.get(k) ?? []), f]); }
  const feedGroups = [...fg.values()].map((g) => {
    const first = [...g].sort((a, b) => a.date.localeCompare(b.date))[0];
    return { ...first, also: g.filter((x) => x.node_id !== first.node_id).map((x) => ({ id: x.node_id, name: x.node_name })) };
  });
  const filings = await q(`SELECT f.id, f.node_id, n.name AS node_name, n.type AS node_type, coalesce(f.filed_date::text, '') AS date, f.filing_type, f.period, f.description, f.amount, f.url, f.issues
                           FROM filings f JOIN nodes n ON n.id=f.node_id`);
  const docs = [
    ...nodes.map((n: any) => ({ key: `node-${n.id}`, kind: "node", node_id: n.id, node_type: n.type, node_name: n.name, title: n.name, body: n.descriptor ?? "", url: `/node/${n.id}`, also: n.also, aliases: n.aliases })),
    ...feedGroups.map((f: any) => ({ also: f.also, key: `feed-${f.id}`, kind: "feed", node_id: f.node_id, node_type: f.node_type, node_name: f.node_name, title: `${f.node_name}: ${f.kind}`, body: f.body,
      date: f.date, date_year: Number(f.date.slice(0, 4)), url: f.url, issues: f.issues })),
    ...filings.map((f: any) => ({ key: `filing-${f.id}`, kind: "filing", node_id: f.node_id, node_type: f.node_type, node_name: f.node_name, title: `${f.node_name}: ${f.filing_type} ${f.period ?? ""}`,
      body: f.description ?? "", amount: f.amount ? Number(f.amount) : null, date: f.date, date_year: f.date ? Number(f.date.slice(0, 4)) : null, url: f.url, issues: f.issues })),
  ];
  await idx.deleteAllDocuments().waitTask({ timeout: 300_000 });
  for (let i = 0; i < docs.length; i += 5000) await idx.addDocuments(docs.slice(i, i + 5000)).waitTask({ timeout: 300_000 });
  console.log(`indexed ${docs.length} documents`);
  return docs.length;
}
if (import.meta.url === `file://${process.argv[1]}`) { await indexAll(); await pool.end(); }
