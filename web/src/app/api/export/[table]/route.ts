import { q } from "@/lib/db";

// Open data: /api/export/<table>.csv or .json. Feed items are approved only.
const TABLES: Record<string, string> = {
  nodes: `SELECT id, type, name, descriptor, cluster, external_ids::text AS external_ids, source_url, archive_url FROM nodes ORDER BY id`,
  links: `SELECT id, from_id, to_id, type, subtype, amount, date_start, date_start_prec, date_end, date_end_prec, stance, note, source_url, archive_url FROM links ORDER BY id`,
  feed_items: `SELECT id, node_id, date, date_prec, kind, excerpt, summary, url, archive_url, platform, array_to_string(issues,'; ') AS issues, stance, target_id FROM feed_items WHERE status='approved' ORDER BY id`,
  filings: `SELECT id, node_id, filing_type, period, filed_date, filed_prec, amount, array_to_string(issues,'; ') AS issues, description, url, archive_url, filing_id FROM filings ORDER BY id`,
  facts: `SELECT id, node_id, text, url, archive_url FROM facts ORDER BY id`,
  changelog: `SELECT id, at, action, table_name, row_ref, actor FROM changelog ORDER BY id DESC LIMIT 50000`,
  corrections: `SELECT id, at, table_name, row_ref, what_changed, url FROM corrections ORDER BY id DESC`,
};
const csvCell = (v: unknown) => {
  if (v == null) return "";
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(_req: Request, ctx: RouteContext<"/api/export/[table]">) {
  const { table } = await ctx.params;
  const [name, ext] = table.split(".");
  const sql = TABLES[name];
  if (!sql || !["csv", "json"].includes(ext)) return new Response("not found", { status: 404 });
  const rows = await q(sql);
  if (ext === "json") return new Response(JSON.stringify(rows, null, 1), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${table}"` } });
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const body = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell((r as any)[c])).join(","))].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${table}"` } });
}
