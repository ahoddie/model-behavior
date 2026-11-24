import { listBills, billCounts, billJurisdictionCounts } from "@/lib/data";
import { BILL_STAGES } from "@/lib/format";
import { envelope } from "../envelope";

// GET /api/v1/bills?jurisdiction=us|ca|federal|state&stage=enacted,vetoed&q=chatbot&on_map=1&session=119
// Counts: ?counts=jurisdiction (one row per jurisdiction: total, on_map, every stage) or ?counts=1 (jurisdiction x stage pairs).
// Rows are sorted federal first, then states by name, then most recent action first.
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const notes = [
    `stage is one of ${BILL_STAGES.join(", ")}. It is derived from the official status and action record; status_text is the latest action verbatim.`,
    "Federal records come from GovInfo BILLSTATUS, California from LegInfo's public database, other states from Open States. Records with source 'research' are drafts or provisions no feed covers.",
    "A bill is included when its title or the source's subject terms name AI, or when it is on the map (node_id).",
  ];
  if (p.get("counts") === "jurisdiction") return envelope("bill_jurisdiction_counts", await billJurisdictionCounts(), notes);
  if (p.get("counts")) return envelope("bill_counts", await billCounts(), notes);
  const onMap = p.get("on_map");
  const rows = await listBills({ jurisdiction: p.get("jurisdiction") ?? undefined, stage: p.get("stage") ?? undefined, q: p.get("q") ?? undefined,
    session: p.get("session") ?? undefined, onMap: onMap === null ? undefined : onMap === "1" || onMap === "true" });
  return envelope("bills", rows, notes);
}
