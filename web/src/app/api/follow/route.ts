import { q } from "@/lib/db";

export async function POST(req: Request) {
  const { email, node } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof node !== "string") return Response.json({ error: "bad input" }, { status: 400 });
  const ok = await q(`SELECT 1 FROM nodes WHERE id=$1`, [node]);
  if (!ok.length) return Response.json({ error: "unknown node" }, { status: 404 });
  await q(`INSERT INTO follows (email, node_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [email.toLowerCase(), node]);
  return Response.json({ ok: true });
}
