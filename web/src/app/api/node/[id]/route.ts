import { getNodeSummary } from "@/lib/data";
import { getProfileText } from "@/lib/profile-text";

export async function GET(_req: Request, ctx: RouteContext<"/api/node/[id]">) {
  const { id } = await ctx.params;
  const [s, text] = await Promise.all([getNodeSummary(id), getProfileText(id)]);
  if (!s) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ...s, text });
}
