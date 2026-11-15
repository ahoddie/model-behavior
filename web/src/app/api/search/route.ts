// Quick name lookup for the header search. Full-text results stay on /search.
// Duplicates of the same item collapse into one result (see lib/sameness); aliases match too.
import { q } from "@/lib/db";
import { TYPE_LABEL } from "@/lib/format";
import { nodeKey, pickCanonical, MERGED_SQL } from "@/lib/sameness";

export async function GET(req: Request) {
  const term = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (term.length < 2) return Response.json([]);
  const rows = await q<{ id: string; name: string; type: string; weight: number }>(
    `SELECT id, name, type, (SELECT count(*)::int FROM links l WHERE l.from_id=n.id OR l.to_id=n.id) AS weight FROM nodes n
     WHERE name ILIKE $1 OR descriptor ILIKE $1 OR id IN (SELECT node_id FROM entity_aliases WHERE alias ILIKE $1)
     ORDER BY (name ILIKE $2) DESC, (name ILIKE $1) DESC, length(name) LIMIT 24`, [`%${term}%`, `${term}%`]);
  const merged = new Map((await q<{ merged_id: string; kept_id: string }>(MERGED_SQL)).map((r) => [r.merged_id, r.kept_id]));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) { const k = nodeKey(r, merged); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const out = [...groups.values()].slice(0, 8).map((g) => {
    const c = pickCanonical(g, merged);
    return { id: c.id, name: c.name, type: c.type, kind: TYPE_LABEL[c.type] ?? c.type, also: g.filter((x) => x.id !== c.id).map((x) => ({ id: x.id, name: x.name })) };
  });
  return Response.json(out);
}
