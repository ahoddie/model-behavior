import { connection } from "next/server";
import Link from "next/link";
import { listTargets, targetSides } from "@/lib/data";
import { fmtMoney, clusterName, landsRank } from "@/lib/format";
import Select from "@/components/Select";

// Four kinds of place the record lands. One shows at a time, so the page reads as a short list rather than one long scroll.
const KINDS = [
  ["bills", "Bills", (g: string) => g.startsWith("b-")],
  ["rules", "Executive orders and rules", (g: string) => g.startsWith("r-")],
  ["elections", "Elections", (g: string) => g.startsWith("e-")],
  ["lobbied", "Who was lobbied", (g: string) => g.startsWith("g-") || g === "administration"],
] as const;
const SIDES = [["support", "Supported by"], ["mixed", "Mixed or conditional"], ["oppose", "Opposed by"]] as const;
const cycleOf = (g: string) => g.match(/^e-(\d{4})-/)?.[1];
type Side = { names: { id: string; name: string }[]; n: number };

function Names({ side }: { side?: Side }) {
  if (!side) return <span className="muted">None on record</span>;
  const shown = side.names.slice(0, 4);
  return <>{shown.map((a, i) => <span key={a.id}>{i > 0 && ", "}<Link href={`/node/${a.id}`}>{a.name}</Link></span>)}{side.n > shown.length && <span className="muted"> and {side.n - shown.length} more</span>}</>;
}

export default async function Targets({ searchParams }: PageProps<"/targets">) {
  await connection();
  const sp = await searchParams;
  const kind = (KINDS.find(([k]) => k === sp.kind) ?? KINDS[0]);
  const want = typeof sp.cycle === "string" ? sp.cycle : "";
  const [ts, sides] = await Promise.all([listTargets(), targetSides()]);
  const inKind = ts.filter((t) => kind[2](t.grp));
  const cycles = [...new Set(ts.map((t) => cycleOf(t.grp)).filter(Boolean) as string[])].sort().reverse();
  const groups = [...new Set(inKind.map((t) => t.grp as string))]
    .filter((g) => kind[0] !== "elections" || !want || cycleOf(g) === want)
    .sort((a, b) => landsRank(a) - landsRank(b));

  return (
    <div className="page">
      <h1>Lands on</h1>
      <p className="lede">The bills, rules, elections and parts of government that the money, lobbying and public positions reach.</p>
      <nav className="tabs" aria-label="Kinds">
        {KINDS.map(([k, label, test]) => (
          <Link key={k} href={`/targets?kind=${k}`} scroll={false} aria-current={kind[0] === k ? "page" : undefined}>
            {label} <span className="muted">({ts.filter((t) => test(t.grp)).length})</span>
          </Link>
        ))}
      </nav>

      {kind[0] === "elections" && (
        <form className="filters" action="/targets">
          <input type="hidden" name="kind" value="elections" />
          <Select label="Election" name="cycle" defaultValue={want} submitOnChange
            options={[{ value: "", label: "Every cycle" }, ...cycles.map((c) => ({ value: c, label: `${c} election (${Number(c) - 1}–${c.slice(2)})` }))]} />
          <noscript><button type="submit">Show</button></noscript>
        </form>
      )}

      {groups.map((g) => {
        // Rows with positions come first, then by money, so the busiest debates lead.
        const rows = inKind.filter((t) => t.grp === g)
          .sort((a, b) => Object.values(sides[b.id] ?? {}).reduce((x, s) => x + s.n, 0) - Object.values(sides[a.id] ?? {}).reduce((x, s) => x + s.n, 0) || b.money - a.money);
        return (
          <section key={g} id={g}>
            <h2>{clusterName(g)} <span className="muted">({rows.length})</span></h2>
            <ul className="lands">{rows.map((t) => {
              const sd = sides[t.id];
              const race = t.type === "race", agency = t.type === "agency" || g === "administration";
              return (
                <li key={t.id}>
                  <h3><Link href={`/node/${t.id}`}>{t.name}</Link></h3>
                  {t.descriptor && <p className="note">{t.descriptor}</p>}
                  {sd && <dl className="sides">{SIDES.filter(([s]) => sd[s]).map(([s, label]) => (
                    <div key={s}><dt>{label} ({sd[s].n})</dt><dd><Names side={sd[s]} /></dd></div>
                  ))}</dl>}
                  <p className="facts-line">
                    {race ? <>{t.candidates} {t.candidates === 1 ? "candidate" : "candidates"} on record{t.race_money > 0 && <> · outside money on record {fmtMoney(t.race_money)}</>}</>
                      : agency ? <>{/* One lobbying report covers many agencies, so no dollar figure is split out per agency. */}Lobbied by {t.actors} {t.actors === 1 ? "organization" : "organizations"} in {t.lobbying.toLocaleString()} {t.lobbying === 1 ? "filing" : "filings"}</>
                      : <>{t.money > 0 ? <>Money on record {fmtMoney(t.money)}</> : !sd ? "No positions or money on record yet" : null}</>}
                  </p>
                </li>
              );
            })}</ul>
          </section>
        );
      })}
    </div>
  );
}
