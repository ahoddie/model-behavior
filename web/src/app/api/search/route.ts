// Quick name lookup for the header search. Full-text results stay on /search.
import { q } from "@/lib/db";
import { TYPE_LABEL } from "@/lib/format";

export async function GET(req: Request) {
  const term = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (term.length < 2) return Response.json([]);
  const rows = await q<{ id: string; name: string; type: string }>(
    `SELECT id, name, type FROM nodes WHERE name ILIKE $1 OR descriptor ILIKE $1
     ORDER BY (name ILIKE $2) DESC, (name ILIKE $1) DESC, length(name) LIMIT 8`, [`%${term}%`, `${term}%`]);
  return Response.json(rows.map((r) => ({ ...r, kind: TYPE_LABEL[r.type] ?? r.type })));
}
