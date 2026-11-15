import { connection } from "next/server";
import Link from "next/link";
import { Meilisearch } from "meilisearch";
import { q } from "@/lib/db";
import { fmtMoney, fmtDate } from "@/lib/format";
import Select from "@/components/Select";
import Src from "@/components/Src";
import { nodeKey, quoteKey } from "@/lib/sameness";

type Hit = { key: string; kind: string; title: string; body: string; url: string; node_id: string; node_name: string; node_type?: string; date?: string; amount?: number | null; also?: { id: string; name: string }[] };

// Collapse results that are the same item (also guards against a stale index). Keeps the first, best-ranked hit.
function collapse(hits: Hit[]): Hit[] {
  const seen = new Map<string, Hit>();
  const out: Hit[] = [];
  for (const h of hits) {
    const k = h.kind === "node" ? nodeKey({ id: h.node_id, type: h.node_type ?? "", name: h.title }) : h.kind === "feed" ? quoteKey(h.body ?? "") : h.key;
    const prev = seen.get(k);
    if (!prev) { const c = { ...h, also: [...(h.also ?? [])] }; seen.set(k, c); out.push(c); continue; }
    if (h.node_id !== prev.node_id && !prev.also!.some((a) => a.id === h.node_id)) prev.also!.push({ id: h.node_id, name: h.kind === "node" ? h.title : h.node_name });
  }
  return out;
}

async function search(term: string, kind: string): Promise<{ hits: Hit[]; engine: string }> {
  try {
    const ms = new Meilisearch({ host: process.env.MEILI_HOST ?? "http://127.0.0.1:7700", apiKey: process.env.MEILI_KEY });
    const r = await ms.index("everything").search<Hit>(term, { limit: 60, filter: kind ? [`kind = "${kind}"`] : undefined });
    return { hits: r.hits, engine: "meilisearch" };
  } catch {
    // Fallback when Meilisearch is down: Postgres trigram/ILIKE across the same three tables.
    const like = `%${term}%`;
    const rows = await q<Hit>(`
      SELECT * FROM (
        SELECT 'node-'||id AS key, 'node' AS kind, name AS title, coalesce(descriptor,'') AS body, '/node/'||id AS url, id AS node_id, name AS node_name, type AS node_type, NULL AS date, NULL::float8 AS amount FROM nodes WHERE name ILIKE $1 OR descriptor ILIKE $1 OR id IN (SELECT node_id FROM entity_aliases WHERE alias ILIKE $1)
        UNION ALL SELECT 'feed-'||f.id, 'feed', n.name||': '||f.kind, coalesce(f.excerpt,f.summary), f.url, n.id, n.name, n.type, pdate(f.date, f.date_prec), NULL FROM feed_items f JOIN nodes n ON n.id=f.node_id WHERE f.status='approved' AND (f.excerpt ILIKE $1 OR f.summary ILIKE $1)
        UNION ALL SELECT 'filing-'||f.id, 'filing', n.name||': '||f.filing_type||' '||coalesce(f.period,''), coalesce(f.description,''), f.url, n.id, n.name, n.type, pdate(f.filed_date, f.filed_prec), f.amount::float8 FROM filings f JOIN nodes n ON n.id=f.node_id WHERE f.description ILIKE $1
      ) x WHERE $2 = '' OR kind = $2 LIMIT 60`, [like, kind]);
    return { hits: rows, engine: "postgres" };
  }
}

export default async function Search(props: PageProps<"/search">) {
  await connection();
  const sp = await props.searchParams;
  const term = typeof sp.q === "string" ? sp.q.trim() : "";
  const kind = typeof sp.kind === "string" ? sp.kind : "";
  const hits = term ? collapse((await search(term, kind)).hits) : [];
  return (
    <div className="page">
      <h1>Search the record</h1>
      <form className="filters" action="/search" role="search">
        <input type="search" name="q" defaultValue={term} placeholder="Name, bill, quote or filing" aria-label="Search" style={{ minWidth: 320 }} />
        <Select label="In" name="kind" defaultValue={kind ?? ""} options={[{ value: "", label: "Everything" }, { value: "node", label: "People and orgs" }, { value: "feed", label: "Statements" }, { value: "filing", label: "Filings" }]} />
        <button type="submit">Search</button>
      </form>
      {term && <p className="mono muted">{hits.length} results</p>}
      <ul className="feed">
        {hits.map((h) => (
          <li key={h.key}>
            <div className="when"><span className="tag">{h.kind}</span>{h.date ? <><br />{fmtDate(h.date)}</> : null}</div>
            <div>
              {h.kind === "node" ? <Link href={h.url}><strong>{h.title}</strong></Link> : <><Link href={`/node/${h.node_id}`}>{h.node_name}</Link> · {h.title.replace(`${h.node_name}: `, "")}{!h.body && <> <Src url={h.url} /></>}</>}
              {h.body && <p style={{ margin: "4px 0 0" }}>{h.kind === "feed" ? h.body : h.body.slice(0, 260)}{h.kind !== "node" && <> <Src url={h.url} /></>}</p>}
              {h.amount ? <span className="mono">{fmtMoney(h.amount)}</span> : null}
              {h.also && h.also.length > 0 && <p className="note" style={{ margin: "4px 0 0" }}>{h.kind === "node" ? "Also listed as" : "Also credited to"} {h.also.map((a, i) => <span key={a.id}>{i > 0 && ", "}<Link href={`/node/${a.id}`}>{a.name}</Link></span>)}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
