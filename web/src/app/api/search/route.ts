// Quick name lookup for the header search. Full-text results stay on /search.
// Duplicates of the same item collapse into one result (see lib/sameness); aliases match too.
import { getNameIndex } from "@/lib/data";
import { TYPE_LABEL } from "@/lib/format";
import { nodeKey, pickCanonical } from "@/lib/sameness";

export async function GET(req: Request) {
  const term = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (term.length < 2) return Response.json([]);
  // Same matching and order as the SQL this replaced (ILIKE '%term%' on name, descriptor and aliases; names that start
  // with the term first, then names that contain it, shorter names first), run over the cached index: no query per keystroke.
  const { nodes, aliases, merged: mergedRows } = await getNameIndex();
  const t = term.toLowerCase();
  const has = (x: string | null) => !!x && x.toLowerCase().includes(t);
  const byAlias = new Set(aliases.filter((a) => has(a.alias)).map((a) => a.node_id));
  const rows = nodes.filter((n) => has(n.name) || has(n.descriptor) || byAlias.has(n.id))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(t)) - Number(a.name.toLowerCase().startsWith(t)) || Number(has(b.name)) - Number(has(a.name)) || a.name.length - b.name.length)
    .slice(0, 24);
  const merged = new Map(mergedRows.map((r) => [r.merged_id, r.kept_id]));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) { const k = nodeKey(r, merged); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const out = [...groups.values()].slice(0, 8).map((g) => {
    const c = pickCanonical(g, merged);
    return { id: c.id, name: c.name, type: c.type, kind: TYPE_LABEL[c.type] ?? c.type, also: g.filter((x) => x.id !== c.id).map((x) => ({ id: x.id, name: x.name })) };
  });
  return Response.json(out);
}
