import { approvedConflictFlags } from "@/lib/data";
import { envelope } from "../../../envelope";
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return envelope("actor_say_do", await approvedConflictFlags(id), ["Only flags a reviewer approved. A flag shows two sourced records side by side; it does not say why they differ."]);
}
