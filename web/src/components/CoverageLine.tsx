// One line at the foot of each profile saying how far the source checks have got.
// Empty sections mean "not found in what has been checked", never "none exists".
import Link from "@/components/Link";
import { fmtDate } from "@/lib/format";
import type { Coverage } from "@/lib/data";

export default function CoverageLine({ c }: { c: Coverage }) {
  const unchecked = c.cited - c.checked - c.broken;
  return (
    <p className="coverage mono muted">
      {c.cited} {c.cited === 1 ? "source" : "sources"} cited
      {" · "}{c.audit_run ? <>{c.checked} link-checked{c.broken ? `, ${c.broken} failing` : ""}{unchecked > 0 ? `, ${unchecked} not checked yet` : ""}</> : "link check not run yet"}
      {" · "}{c.archived} archived
      {c.last_checked ? <> · last checked {fmtDate(c.last_checked)}</> : null}
      {" · "}<Link href="/data?tab=methodology#coverage">What empty sections mean</Link>
    </p>
  );
}
