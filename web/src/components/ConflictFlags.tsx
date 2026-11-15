// "Said and did" tab: reviewed flags where a statement and an action point different ways. Each flag shows both sides with
// their sources. Wording is the stored neutral sentence; the model's rationale is never shown here.
import Link from "next/link";
import Src from "@/components/Src";
import { fmtDate } from "@/lib/format";
import type { ApprovedFlag, FlagEvidence } from "@/lib/data";

const TYPE_LABEL: Record<ApprovedFlag["type"], string> = {
  statement_vs_action: "Statement and filing",
  statement_vs_money: "Statement and money",
  commitment_weakened: "Commitment changed",
  reversal_near_event: "Stance change near an event",
};
const NOTE: Partial<Record<ApprovedFlag["type"], string>> = {
  statement_vs_money: "The record shows where money moved and how it was spent. It does not show who directed the spending.",
  reversal_near_event: "The dates are shown side by side. The record does not show that one led to the other.",
};

function Side({ title, items }: { title: string; items: FlagEvidence[] }) {
  return (
    <div>
      <h4 style={{ margin: "0 0 4px" }}>{title}</h4>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((e, i) => (
          <li key={i}>{e.label} <span className="mono muted">{e.date ? fmtDate(e.date) : ""}</span> <Src url={e.url} archive={e.archive_url} /></li>
        ))}
      </ul>
    </div>
  );
}

export default function ConflictFlags({ flags }: { flags: ApprovedFlag[] }) {
  if (!flags.length) return <p className="muted">No reviewed case on record where a statement and an action point different ways. Cases are found by software and shown only after a person has checked both sources.</p>;
  return (
    <ul className="feed">
      {flags.map((f) => (
        <li key={f.id}>
          <div className="when">{TYPE_LABEL[f.type]}</div>
          <div>
            <p style={{ marginTop: 0 }}>{f.description}{f.target_id && f.target_name ? <> <Link href={`/node/${f.target_id}`} className="mono">{f.target_name}</Link></> : null}</p>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
              <Side title="Said" items={f.said} />
              <Side title="Did" items={f.did} />
            </div>
            {NOTE[f.type] && <p className="muted">{NOTE[f.type]}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
