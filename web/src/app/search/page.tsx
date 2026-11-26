import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { RECORD_TAG } from "@/lib/data";
import Link from "@/components/Link";
import { q } from "@/lib/db";
import { searchDocs, type SearchHit } from "@/lib/search";
import { fmtMoney, fmtDate } from "@/lib/format";
import Select from "@/components/Select";
import Src from "@/components/Src";
import { nodeKey, quoteKey } from "@/lib/sameness";

const KIND_LABEL: Record<string, string> = { node: "Profile", feed: "Statement", filing: "Filing" };

type Hit = SearchHit;

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

// Cached per query under the record tag, so a repeated or prefetched search is answered from memory.
async function search(term: string, kind: string): Promise<{ hits: Hit[]; engine: string }> {
  "use cache";
  cacheLife("record"); cacheTag(RECORD_TAG);
  try {
    return { hits: await searchDocs(term, kind), engine: "postgres-fts" };
  } catch {
    // Fallback when the search table is missing (db/migrations/220 not applied yet): ILIKE across the same three tables.
    const like = `%${term}%`;
    const rows = await q<Hit>(`
      SELECT * FROM (
        SELECT 'node-'||id AS key, 'node' AS kind, name AS title, coalesce(descriptor,'') AS body, '/node/'||id AS url, id AS node_id, name AS node_name, type AS node_type, NULL AS date, NULL::float8 AS amount FROM nodes WHERE name ILIKE $1 OR descriptor ILIKE $1 OR id IN (SELECT node_id FROM entity_aliases WHERE alias ILIKE $1)
        UNION ALL SELECT 'feed-'||f.id, 'feed', n.name||': '||f.kind, coalesce(f.excerpt,f.summary), f.url, n.id, n.name, n.type, pdate(f.date, f.date_prec), NULL FROM feed_items f JOIN nodes n ON n.id=f.node_id WHERE f.status='approved' AND (f.excerpt ILIKE $1 OR f.summary ILIKE $1)
        UNION ALL SELECT 'filing-'||f.id, 'filing', n.name||': '||f.filing_type||' '||coalesce(f.period,''), coalesce(f.description,''), f.url, n.id, n.name, n.type, pdate(f.filed_date, f.filed_prec), f.amount::float8 FROM filings f JOIN nodes n ON n.id=f.node_id WHERE f.description ILIKE $1
      ) x WHERE $2 = '' OR kind = $2 LIMIT 60`, [like, kind]);
    return { hits: rows, engine: "postgres-ilike" };
  }
}

export default function Search(props: PageProps<"/search">) {
  return (
    <div className="page">
      <h1>Search the record</h1>
      <Suspense fallback={<SearchForm term="" kind="" />}>
        <Results sp={props.searchParams} />
      </Suspense>
    </div>
  );
}

function SearchForm({ term, kind }: { term: string; kind: string }) {
  return (
      <form className="filters" action="/search" role="search">
        <input type="search" name="q" defaultValue={term} placeholder="Name, bill, quote or filing" aria-label="Search" style={{ minWidth: 320 }} />
        <Select label="In" name="kind" defaultValue={kind ?? ""} options={[{ value: "", label: "Everything" }, { value: "node", label: "People and orgs" }, { value: "feed", label: "Statements" }, { value: "filing", label: "Filings" }]} />
        <button type="submit">Search</button>
      </form>
  );
}

async function Results({ sp: spP }: { sp: PageProps<"/search">["searchParams"] }) {
  const sp = await spP;
  const term = typeof sp.q === "string" ? sp.q.trim() : "";
  const kind = typeof sp.kind === "string" ? sp.kind : "";
  const hits = term ? collapse((await search(term, kind)).hits) : [];
  return (
    <>
      <SearchForm term={term} kind={kind} />
      {term && <p className="mono muted">{hits.length} results</p>}
      <ul className="feed">
        {hits.map((h) => (
          <li key={h.key}>
            <div className="when"><span className="tag">{KIND_LABEL[h.kind] ?? h.kind}</span>{h.date ? <><br />{fmtDate(h.date)}</> : null}</div>
            <div>
              {h.kind === "node" ? <Link href={h.url}><strong>{h.title}</strong></Link> : <><Link href={`/node/${h.node_id}`}>{h.node_name}</Link> · {h.title.replace(`${h.node_name}: `, "")}{!h.body && <> <Src url={h.url} /></>}</>}
              {h.body && <p style={{ margin: "4px 0 0" }}>{h.kind === "feed" ? h.body : h.body.slice(0, 260)}{h.kind !== "node" && <> <Src url={h.url} /></>}</p>}
              {h.amount ? <span className="mono">{fmtMoney(h.amount)}</span> : null}
              {h.also && h.also.length > 0 && <p className="note" style={{ margin: "4px 0 0" }}>{h.kind === "node" ? "Also listed as" : "Also credited to"} {h.also.map((a, i) => <span key={a.id}>{i > 0 && ", "}<Link href={`/node/${a.id}`}>{a.name}</Link></span>)}</p>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
