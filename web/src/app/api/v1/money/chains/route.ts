import { moneyChainFlows } from "@/lib/data";
import { envelope } from "../../envelope";
export async function GET(req: Request) {
  const from = new URL(req.url).searchParams.get("from");
  if (!from) return Response.json({ error: "from is required (a node id or undisclosed:<id>)" }, { status: 400 });
  const rows = (await moneyChainFlows(from)).map((r: any) => ({ step: r.d, from_id: r.from_id, from_name: r.from_name, to_id: r.to_id, to_name: r.to_name,
    amount: r.amount, date: r.date, stance: r.stance, basis: r.hop_basis, n_lines: r.n_lines, source_url: r.source_url, archive_url: r.archive_url }));
  return envelope("money_chain", rows, ["Amounts are totals of filed lines between two parties; filings don't say which dollar paid for which spend.",
    "Undisclosed donors are a placeholder for money a committee received without naming the donor."]);
}
