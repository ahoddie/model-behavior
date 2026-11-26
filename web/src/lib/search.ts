// Site search: Postgres full-text search over search_docs (db/migrations/220, filled by scripts/index-search.ts).
// Ranking, best first:
//   tier 3  every word matches (websearch syntax: "quoted phrases", -exclude, or)
//   tier 2  every word matches, the last one as a prefix ("export contr" finds "export controls")
//   tier 1  only when tiers 2-3 find fewer than 20: names close in spelling ("altmann"), then any of the words
// Within a tier: an exact name match, then a match in the name or title, then text rank (names weigh most, then the
// speaker or filer, then the text, then issue tags), then how connected a profile is. Statements sit a little ahead of
// filings, which repeat the same issue list every quarter.
// Bill numbers match written either way: "SB 53" also finds "SB53", and the reverse.
import { q } from "./db";

export type SearchHit = { key: string; kind: string; title: string; body: string; url: string; node_id: string; node_name: string; node_type?: string;
  date?: string; amount?: number | null; also?: { id: string; name: string }[] };

const words = (s: string) => s.match(/[\p{L}\p{N}]+/gu) ?? [];

// "SB53" -> "SB 53" and "SB 53" -> "SB53", so either spelling of a bill number finds the other.
function variants(term: string): string[] {
  const split = term.replace(/(\p{L})(\p{N})/gu, "$1 $2");
  const joined = term.replace(/\b(\p{L}{1,4})\s+(\p{N}{1,5})\b/gu, "$1$2");
  return [...new Set([term, split, joined])];
}

export async function searchDocs(term: string, kind = "", limit = 60): Promise<SearchHit[]> {
  const w = words(term);
  if (!w.length) return [];
  const plain = !/["]|(^|\s)-|\bor\b/i.test(term); // no websearch operators: prefix and any-word fallbacks are safe
  const prefix = plain ? w.map((x, i) => (i === w.length - 1 ? `${x}:*` : x)).join(" & ") : "";
  const anyWord = plain && w.length > 1 ? w.join(" | ") : "";
  return q<SearchHit>(`
    WITH qs AS (
      SELECT (SELECT string_agg('(' || t::text || ')', ' | ') FILTER (WHERE numnode(t) > 0)
              FROM unnest($1::text[]) v, websearch_to_tsquery('english', v) t)::tsquery AS qa,
             CASE WHEN $2 = '' THEN NULL ELSE to_tsquery('english', $2) END AS qp,
             CASE WHEN $3 = '' THEN NULL ELSE to_tsquery('english', $3) END AS qo
    ), hits AS (
      SELECT d.*, CASE WHEN d.tsv @@ qs.qa THEN 3 WHEN d.tsv @@ qs.qp THEN 2 ELSE 1 END AS tier,
        (lower(d.title) = lower($4) OR (' ' || lower(d.aliases) || ' ') LIKE '% ' || lower($4) || ' %')::int * 3
          + (to_tsvector('english', d.title || ' ' || d.aliases) @@ coalesce(qs.qp, qs.qa))::int * (CASE WHEN d.kind = 'node' THEN 1.5 ELSE 1 END)
          + ts_rank_cd('{0.1, 0.25, 0.5, 1.0}', d.tsv, coalesce(qs.qp, qs.qa), 1)
          + 0.05 * ln(1 + d.weight)
          + CASE d.kind WHEN 'feed' THEN 0.3 ELSE 0 END
          + CASE WHEN d.kind = 'node' AND $4 <% d.title THEN word_similarity($4, d.title) ELSE 0 END AS score
      FROM search_docs d, qs
      WHERE ($5 = '' OR d.kind = $5)
        AND (d.tsv @@ qs.qa OR d.tsv @@ qs.qp OR d.tsv @@ qs.qo OR (d.kind = 'node' AND $4 <% d.title))
    ), ranked AS (
      SELECT *, count(*) FILTER (WHERE tier >= 2) OVER () AS strong FROM hits
    )
    SELECT key, kind, title, body, url, node_id, node_name, node_type, date, amount, also FROM ranked
    WHERE tier >= 2 OR strong < 20
    ORDER BY tier DESC, score DESC, date DESC NULLS LAST, key
    LIMIT $6`, [variants(term), prefix, anyWord, term.trim(), kind, limit]);
}
