import { Suspense } from "react";
import { moneyFlows, moneyStarts, moneyChainFlows, moneyChainStarts, getNodeSummary } from "@/lib/data";
import { fmtMoney } from "@/lib/format";
import MoneyFlow from "@/components/MoneyFlow";
import Select from "@/components/Select";
import ActorSummary from "@/components/ActorSummary";
import RandomStart from "@/components/RandomStart";

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
  return [...filed, ...links.filter((l) => !filed.some((c) => same(l, c)))].filter((f) => f.amount > 0);
}

const loadStarts = async () => mergeStarts(await moneyStarts(), await moneyChainStarts()).filter((s) => s.out > 0);
const flowsFrom = async (start: string) => mergeFlows(await moneyFlows(start), await moneyChainFlows(start));

// Only the choice of starting point waits for the URL. Awaited here, outside the boundary, the cached list of starting points
// and the trace from the largest giver (what /money opens on) are stored with the prebuilt page; the same calls inside the
// boundary are answered from that copy. Other starting points are cached on first use and after each site start (lib/warm).
export default async function Money(props: PageProps<"/money">) {
  const first = (await loadStarts())[0]?.id as string | undefined;
  if (first) await Promise.all([flowsFrom(first), isUndisclosed(first) ? null : getNodeSummary(first)]);
  return (
    <div className="page wide">
      <h1>Node by node</h1>
      <p className="lede">Pick a giver to see the spending and contributions on record, step by step.</p>
      <Suspense fallback={<p className="mono muted" role="status">Loading the record…</p>}>
        <Trace sp={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function Trace({ sp: spP }: { sp: PageProps<"/money">["searchParams"] }) {
  const sp = await spP;
  const starts = await loadStarts();
  const start: string | undefined = typeof sp.from === "string" ? sp.from : starts[0]?.id;
  const flows = start ? await flowsFrom(start) : [];
  const name = starts.find((s) => s.id === start)?.name ?? start;
  return (
    <>
      <form className="filters" action="/money">
        <Select key={start} label="Start from" name="from" defaultValue={start} wide submitOnChange options={starts.map((s) => ({ value: s.id, label: s.out ? `${s.name} (${fmtMoney(s.out)})` : `${s.name} (amount not stated)` }))} />
        <RandomStart ids={starts.filter((s) => !isUndisclosed(s.id)).map((s) => s.id)} current={start} />
        <noscript><button type="submit">Trace</button></noscript>
      </form>
      {start && !isUndisclosed(start) ? <ActorSummary id={start} /> : null}
      {flows.length === 0 ? <p className="muted">No sourced money leaves this starting point.</p> : <>
        <MoneyFlow start={start!} flows={flows} />
        <p className="muted">Later steps show everything the next committee spent, not only {name}&apos;s share of it. Money is fungible inside a committee; the filings don&apos;t say whose dollar paid for which ad.</p>
      </>}
    </>
  );
}
