import { viewWordingSources } from "@/lib/data";
import { envelope } from "../../../envelope";
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return envelope("bill_wording_sources", await viewWordingSources(id), ["Only matches a reviewer approved. Similar wording shows overlap in text, not who wrote the bill."]);
}
