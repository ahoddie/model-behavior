// Rebuild the search table (search_docs, db/migrations/220) from every node, approved feed item and filing.
// Postgres full-text search does the matching; this script only decides what one result is. Runs in one transaction,
// so the site keeps serving the old rows until the new ones are in.
import "./env.ts";
import { q, pool } from "../src/lib/db.ts";
import { nodeKey, quoteKey, pickCanonical, MERGED_SQL } from "../src/lib/sameness.ts";

export async function indexAll() {
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
    ...nodes.map((n: any) => ({ key: `node-${n.id}`, kind: "node", node_id: n.id, node_type: n.type, node_name: n.name, title: n.name, body: n.descriptor ?? "", url: `/node/${n.id}`, also: n.also, aliases: n.aliases, weight: n.weight })),
    ...feedGroups.map((f: any) => ({ also: f.also, key: `feed-${f.id}`, kind: "feed", node_id: f.node_id, node_type: f.node_type, node_name: f.node_name, title: `${f.node_name}: ${f.kind}`, body: f.body,
      date: f.date, date_year: Number(f.date.slice(0, 4)), url: f.url, issues: f.issues })),
    ...filings.map((f: any) => ({ key: `filing-${f.id}`, kind: "filing", node_id: f.node_id, node_type: f.node_type, node_name: f.node_name, title: `${f.node_name}: ${f.filing_type} ${f.period ?? ""}`,
      body: f.description ?? "", amount: f.amount ? Number(f.amount) : null, date: f.date, date_year: f.date ? Number(f.date.slice(0, 4)) : null, url: f.url, issues: f.issues })),
  ];
  const rows = docs.map((d: any) => ({
    key: d.key, kind: d.kind, node_id: d.node_id, node_type: d.node_type ?? null, node_name: d.node_name ?? "", title: d.title.trim(), body: d.body ?? "",
    aliases: (d.aliases ?? []).filter((a: string) => a && a !== d.title).join(" "), issues: (d.issues ?? []).join(" "), url: d.url ?? null,
    date: d.date || null, amount: d.amount ?? null, weight: d.weight ?? 0, also: d.also ?? [] }));
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("DELETE FROM search_docs");
    for (let i = 0; i < rows.length; i += 1000) await c.query(`
      INSERT INTO search_docs (key, kind, node_id, node_type, node_name, title, body, aliases, issues, url, date, amount, weight, also)
      SELECT key, kind, node_id, node_type, node_name, title, body, aliases, issues, url, date, amount, weight, also
      FROM jsonb_to_recordset($1::jsonb) AS x(key text, kind text, node_id text, node_type text, node_name text, title text, body text,
        aliases text, issues text, url text, date text, amount float8, weight int, also jsonb)
      ON CONFLICT (key) DO NOTHING`, [JSON.stringify(rows.slice(i, i + 1000))]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  console.log(`indexed ${docs.length} documents`);
  return docs.length;
}
if (import.meta.url === `file://${process.argv[1]}`) { await indexAll(); await pool.end(); }
