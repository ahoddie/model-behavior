import { connection } from "next/server";
import Link from "next/link";
import { moneyFlows, moneyStarts } from "@/lib/data";
import { fmtMoney, fmtDate } from "@/lib/format";
import MoneyFlow from "@/components/MoneyFlow";
import Select from "@/components/Select";
import Src from "@/components/Src";
import ActorSummary from "@/components/ActorSummary";

export default async function Money(props: PageProps<"/money">) {
  await connection();
  const sp = await props.searchParams;
  const starts = await moneyStarts();
  const start = typeof sp.from === "string" ? sp.from : starts[0]?.id;
  const flows = start ? await moneyFlows(start) : [];
  const name = starts.find((s) => s.id === start)?.name ?? start;
  return (
    <div className="page wide">
      <h1>Follow the money</h1>
      <form className="filters" action="/money">
        <Select label="Start from" name="from" defaultValue={start} wide submitOnChange options={starts.map((s) => ({ value: s.id, label: `${s.name} (${fmtMoney(s.out)})` }))} />
        <noscript><button type="submit">Trace</button></noscript>
      </form>
      {start ? <ActorSummary id={start} /> : null}
      {flows.length === 0 ? <p className="muted">No sourced money leaves this starting point.</p> : <>
        <MoneyFlow start={start!} flows={flows} />
        <h2>Every dollar, step by step</h2>
        <table className="data-table"><thead><tr><th>Step</th><th>From</th><th>To</th><th className="num">Amount</th><th>Date</th><th>Detail</th></tr></thead><tbody>
          {flows.sort((a, b) => a.d - b.d || (b.amount ?? 0) - (a.amount ?? 0)).map((f, i) => (
            <tr key={i}><td className="mono">{f.d}</td><td><Link href={`/node/${f.from_id}`}>{f.from_name}</Link></td><td><Link href={`/node/${f.to_id}`}>{f.to_name}</Link></td>
              <td className="num">{fmtMoney(f.amount) || "not listed"} <Src url={f.source_url} /></td>
              <td className="mono">{fmtDate(f.date_start)}</td><td>{f.subtype}{f.stance ? ` (${f.stance})` : ""}{f.note ? ` · ${f.note}` : ""}</td></tr>
          ))}
        </tbody></table>
        <p className="muted">Later steps show everything the next committee spent, not only {name}&apos;s share of it. Money is fungible inside a committee; the filings don&apos;t say whose dollar paid for which ad.</p>
      </>}
    </div>
  );
}
