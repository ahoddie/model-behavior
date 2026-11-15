import { q } from "@/lib/db";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

// Alerts feed for a profile or target: approved feed items, filings and links, newest first.
export async function GET(req: Request, ctx: RouteContext<"/api/rss/[id]">) {
  const { id } = await ctx.params;
  const [n] = await q<{ name: string }>(`SELECT name FROM nodes WHERE id=$1`, [id]);
  if (!n) return new Response("not found", { status: 404 });
  const rows = await q<{ title: string; url: string; at: string; body: string }>(`
    SELECT * FROM (
      SELECT kind || ': ' || coalesce(left(excerpt, 80), left(summary, 80)) AS title, url, created_at::text AS at, coalesce(excerpt, summary) AS body FROM feed_items WHERE (node_id=$1 OR target_id=$1) AND status='approved'
      UNION ALL SELECT filing_type || ' ' || coalesce(period, ''), url, created_at::text, coalesce(description, '') FROM filings WHERE node_id=$1
      UNION ALL SELECT l.type || ': ' || f.name || ' → ' || t.name, l.source_url, l.created_at::text, coalesce(l.note, '') FROM links l JOIN nodes f ON f.id=l.from_id JOIN nodes t ON t.id=l.to_id WHERE l.from_id=$1 OR l.to_id=$1
    ) x ORDER BY at DESC LIMIT 100`, [id]);
  const site = new URL(req.url).origin;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(`Model Behavior: ${n.name}`)}</title><link>${site}/node/${id}</link><description>New sourced items for ${esc(n.name)}</description>
${rows.map((r) => `<item><title>${esc(r.title)}</title><link>${esc(r.url)}</link><guid isPermaLink="false">${esc(r.url + r.at)}</guid><pubDate>${new Date(r.at).toUTCString()}</pubDate><description>${esc(r.body)}</description></item>`).join("\n")}
</channel></rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
