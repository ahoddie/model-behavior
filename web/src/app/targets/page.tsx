import { Suspense } from "react";
import Link from "@/components/Link";
import { listTargets, targetSides, type SideName } from "@/lib/data";
import { fmtMoney, clusterName, landsRank } from "@/lib/format";
import Select from "@/components/Select";
import SectionNav from "@/components/SectionNav";
import { Named } from "@/components/ProfileHead";

// Four kinds of place the record lands. One shows at a time, so the page reads as a short list rather than one long scroll.
const KINDS = [
  ["bills", "Bills", (g: string) => g.startsWith("b-")],
  ["rules", "Executive orders and rules", (g: string) => g.startsWith("r-")],
  ["elections", "Elections", (g: string) => g.startsWith("e-")],
  ["lobbied", "Who was lobbied", (g: string) => g.startsWith("g-") || g === "administration"],
] as const;
const cycleOf = (g: string) => g.match(/^e-(\d{4})-/)?.[1];
type Side = { names: SideName[]; n: number };
type Sides = Partial<Record<"support" | "mixed" | "oppose", Side>>;
const total = (sd?: Sides) => Object.values(sd ?? {}).reduce((x, s) => x + (s?.n ?? 0), 0);

// One side of a debate: the first few names with their marks, then a count of the rest that leads to the full profile.
function SideList({ label, side, href, tone }: { label: string; side: Side; href: string; tone: string }) {
  const shown = side.names.slice(0, 5);
  return (
    <div className="pside">
      <h4><i className={`sw sw-${tone}`} aria-hidden />{label} <span className="muted">{side.n}</span></h4>
      <ul>{shown.map((a) => <li key={a.id}><Named node={a}><Link href={`/node/${a.id}`}>{a.name}</Link></Named></li>)}</ul>
      {side.n > shown.length && <Link className="pside-more" href={href}>and {side.n - shown.length} more</Link>}
    </div>
  );
}

// The split of positions on one item, drawn to scale. The counts are written out beside it.
function Balance({ sd }: { sd: Sides }) {
  const parts = ([["support", "support"], ["mixed", "mixed"], ["oppose", "oppose"]] as const).filter(([k]) => sd[k]);
  const words = parts.map(([k, w]) => `${sd[k]!.n} ${w}`).join(" · ");
  return (
    <div className="pbal">
      <div className="pbal-bar" role="img" aria-label={`Positions on record: ${words}`}>
        {parts.map(([k]) => <i key={k} className={`sw-${k}`} style={{ flexGrow: sd[k]!.n }} />)}
      </div>
      <span className="pbal-words mono">{words}</span>
    </div>
  );
}

type Sp = PageProps<"/targets">["searchParams"];
const load = () => Promise.all([listTargets(), targetSides()]);

// Only the choice of tab and cycle waits for the URL. Awaited here, outside the boundary, the cached list is stored with the
// prebuilt page; the same call inside the boundary is answered from that copy, so no tab runs a query.
export default async function Targets({ searchParams }: PageProps<"/targets">) {
  await load();
  return (
    <div className="page pol-page">
      <h1>Policy</h1>
      <p className="lede">The bills, rules, elections, and agencies that the money, lobbying, and positions reach.</p>
      <Suspense fallback={<p className="mono muted" role="status">Loading the record…</p>}>
        <Listing sp={searchParams} />
      </Suspense>
    </div>
  );
}

async function Listing({ sp: spP }: { sp: Sp }) {
  const sp = await spP;
  const [ts, sides] = await load();
  const kind = (KINDS.find(([k]) => k === sp.kind) ?? KINDS[0]);
  const want = typeof sp.cycle === "string" ? sp.cycle : "";
  const inKind = ts.filter((t) => kind[2](t.grp));
  const cycles = [...new Set(ts.map((t) => cycleOf(t.grp)).filter(Boolean) as string[])].sort().reverse();
  const groups = [...new Set(inKind.map((t) => t.grp as string))]
    .filter((g) => kind[0] !== "elections" || !want || cycleOf(g) === want)
    .sort((a, b) => landsRank(a) - landsRank(b));
  const rowsOf = (g: string) => inKind.filter((t) => t.grp === g)
    // Rows with positions come first, then by money, so the busiest debates lead.
    .sort((a, b) => total(sides[b.id] as Sides) - total(sides[a.id] as Sides) || b.money - a.money);
  // Bars in the tables are scaled to the largest value in the tab.
  const maxRace = Math.max(1, ...inKind.map((t) => t.race_money ?? 0));
  const maxFilings = Math.max(1, ...inKind.map((t) => t.lobbying ?? 0));
  const cards = kind[0] === "bills" || kind[0] === "rules";

  return (
    <>
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

      <div className="pol-body">
        {groups.length > 1 && <SectionNav key={kind[0] + want} items={groups.map((g) => ({ id: g, label: clusterName(g) }))} label="Groups" />}
        <div className="pol-main">
          {groups.map((g) => {
            const rows = rowsOf(g);
            return (
              <section key={g} id={g} className="pol-group">
                <h2>{clusterName(g)} <span className="muted">{rows.length}</span></h2>

                {cards ? (
                  <ul className="pcards">{rows.map((t) => {
                    const sd = sides[t.id] as Sides | undefined;
                    const href = `/node/${t.id}`;
                    return (
                      <li key={t.id} className={`pcard${sd ? "" : " pcard-quiet"}`}>
                        <h3><Link href={href}>{t.name}</Link></h3>
                        {t.descriptor && <p className="pcard-note">{t.descriptor}</p>}
                        {sd ? <>
                          <Balance sd={sd} />
                          <div className="pcard-sides">
                            {sd.support && <SideList label="Supported by" side={sd.support} href={href} tone="support" />}
                            {sd.oppose && <SideList label="Opposed by" side={sd.oppose} href={href} tone="oppose" />}
                            {sd.mixed && <SideList label="Mixed or conditional" side={sd.mixed} href={href} tone="mixed" />}
                          </div>
                        </> : <p className="pcard-none">No positions on record yet</p>}
                        {t.money > 0 && <p className="pcard-foot mono">Money on record {fmtMoney(t.money)}</p>}
                      </li>
                    );
                  })}</ul>
                ) : kind[0] === "elections" ? (
                  <table className="data-table ptable">
                    <thead><tr><th>Race</th><th className="num">Candidates on record</th><th>Outside money on record</th></tr></thead>
                    <tbody>{rows.map((t) => (
                      <tr key={t.id}>
                        <td><Link href={`/node/${t.id}`}>{t.name}</Link></td>
                        <td className="num">{t.candidates}</td>
                        <td><span className="pmeter"><i style={{ width: `${(100 * (t.race_money ?? 0)) / maxRace}%` }} /></span>
                          <span className="mono">{t.race_money > 0 ? fmtMoney(t.race_money) : "None"}</span></td>
                      </tr>
                    ))}</tbody>
                  </table>
                ) : (
                  // One lobbying report covers many agencies, so no dollar figure is split out per agency.
                  <table className="data-table ptable">
                    <thead><tr><th>Body</th><th className="num">Organizations</th><th>Lobbying filings</th></tr></thead>
                    <tbody>{rows.map((t) => (
                      <tr key={t.id}>
                        <td><Link href={`/node/${t.id}`}>{t.name}</Link>{t.descriptor && <span className="ptable-note">{t.descriptor}</span>}</td>
                        <td className="num">{t.actors}</td>
                        <td><span className="pmeter"><i style={{ width: `${(100 * (t.lobbying ?? 0)) / maxFilings}%` }} /></span>
                          <span className="mono">{(t.lobbying ?? 0).toLocaleString()}</span></td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
