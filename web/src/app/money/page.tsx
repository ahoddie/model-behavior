import { connection } from "next/server";
import Link from "next/link";
import { moneyFlows, moneyStarts, moneyChainFlows, moneyChainStarts } from "@/lib/data";
import { fmtMoney, fmtDate } from "@/lib/format";
import MoneyFlow from "@/components/MoneyFlow";
import Select from "@/components/Select";
import Src from "@/components/Src";
import ActorSummary from "@/components/ActorSummary";

// Two sources of money steps: curated links (research, grants, filings already loaded) and the filed FEC chains built by the
// money pipeline. When both describe the same gift (same two parties, same amount), the filed hop is kept: it carries the
// filing line and its archived copy. "Undisclosed donors" is a placeholder for money a committee received without naming the
// donor; it is never a person and has no profile.
const isUndisclosed = (id: string) => id.startsWith("undisclosed:");
const BASIS: Record<string, string> = { disclosed: "filed with the FEC", self_reported: "reported by the giver", undisclosed: "donors not disclosed" };
function mergeStarts(a: any[], b: any[]) {
  const m = new Map<string, any>();
  for (const s of [...a, ...b]) { const o = m.get(s.id); if (!o || (s.out ?? 0) > (o.out ?? 0)) m.set(s.id, s); }
  return [...m.values()].sort((x, y) => Number(isUndisclosed(x.id)) - Number(isUndisclosed(y.id)) || (y.out ?? 0) - (x.out ?? 0));
}
function mergeFlows(links: any[], chain: any[]) {
  const filed = chain.map((c) => ({ ...c, date_start: c.date, subtype: BASIS[c.hop_basis] ?? c.hop_basis, note: c.n_lines > 1 ? `${c.n_lines} filed lines` : null }));
  // A filed hop is the total of every FEC line between its two parties, so FEC-sourced links for that pair are already in it.
  // Other links for the pair (a grant report, a press release) stay unless they repeat the hop's amount.
  const fec = (u: string) => /\bfec\.gov\b/.test(u ?? "");
  const same = (l: any, c: any) => l.from_id === c.from_id && l.to_id === c.to_id &&
    (fec(l.source_url) || l.amount == null || c.amount == null || Math.abs(l.amount - c.amount) <= Math.max(1, 0.01 * c.amount));
  return [...filed, ...links.filter((l) => !filed.some((c) => same(l, c)))];
}

export default async function Money(props: PageProps<"/money">) {
  await connection();
  const sp = await props.searchParams;
  const starts = mergeStarts(await moneyStarts(), await moneyChainStarts());
  const start = typeof sp.from === "string" ? sp.from : starts[0]?.id;
  const flows = start ? mergeFlows(await moneyFlows(start), await moneyChainFlows(start)) : [];
  const name = starts.find((s) => s.id === start)?.name ?? start;
  return (
    <div className="page wide">
      <h1>Follow the money</h1>
      <form className="filters" action="/money">
        <Select label="Start from" name="from" defaultValue={start} wide submitOnChange options={starts.map((s) => ({ value: s.id, label: `${s.name} (${fmtMoney(s.out)})` }))} />
        <noscript><button type="submit">Trace</button></noscript>
      </form>
      {start && !isUndisclosed(start) ? <ActorSummary id={start} /> : null}
      {flows.length === 0 ? <p className="muted">No sourced money leaves this starting point.</p> : <>
        <MoneyFlow start={start!} flows={flows} />
        <h2>Every dollar, step by step</h2>
        <table className="data-table"><thead><tr><th>Step</th><th>From</th><th>To</th><th className="num">Amount</th><th>Date</th><th>Detail</th></tr></thead><tbody>
          {flows.sort((a, b) => a.d - b.d || (b.amount ?? 0) - (a.amount ?? 0)).map((f, i) => (
            <tr key={i}><td className="mono">{f.d}</td><td>{isUndisclosed(f.from_id) ? f.from_name : <Link href={`/node/${f.from_id}`}>{f.from_name}</Link>}</td><td><Link href={`/node/${f.to_id}`}>{f.to_name}</Link></td>
              <td className="num">{fmtMoney(f.amount) || "not listed"} <Src url={f.source_url} archive={f.archive_url} /></td>
              <td className="mono">{fmtDate(f.date_start)}</td><td>{f.subtype}{f.stance ? ` (${f.stance})` : ""}{f.note ? ` · ${f.note}` : ""}</td></tr>
          ))}
        </tbody></table>
        <p className="muted">A step marked “filed with the FEC” adds up every filed line between the two parties.</p>
        <p className="muted">Later steps show everything the next committee spent, not only {name}&apos;s share of it. Money is fungible inside a committee; the filings don&apos;t say whose dollar paid for which ad.</p>
      </>}
    </div>
  );
}
