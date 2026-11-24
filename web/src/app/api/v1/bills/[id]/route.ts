import { getBillRecord } from "@/lib/data";
import { envelope } from "../../envelope";

// GET /api/v1/bills/<bill id or map node id>: the public record with its dated actions and roll-call tallies.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await getBillRecord(id);
  if (!b) return Response.json({ error: "not found" }, { status: 404 });
  return envelope("bill", [b], ["actions are verbatim from the source, oldest first; kind is a coarse label (introduced, committee, passed, governor, enacted, vetoed, failed, other).",
    "votes carry the tallies the source gives: Congress from the action record (with the clerk's roll call link), California from LegInfo (floor and committee)."]);
}
