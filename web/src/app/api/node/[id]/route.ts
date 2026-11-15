import { getNodeSummary } from "@/lib/data";

export async function GET(_req: Request, ctx: RouteContext<"/api/node/[id]">) {
  const { id } = await ctx.params;
  const s = await getNodeSummary(id);
  if (!s) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(s);
}
