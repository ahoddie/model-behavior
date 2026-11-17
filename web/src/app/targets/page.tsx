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
  // Cards: rows with positions first, then by money, so the busiest debates lead. Tables: by the value their bar draws,
  // so the bars step down in order.
  const isCands = (g: string) => g.endsWith("-candidates");
  const drawn = (t: any) => (t.type === "lawmaker" ? t.shown_money : t.race_money) ?? 0;
  const rowsOf = (g: string) => inKind.filter((t) => t.grp === g).sort((a, b) =>
    kind[0] === "elections" ? drawn(b) - drawn(a) || b.candidates - a.candidates || a.name.localeCompare(b.name)
    : kind[0] === "lobbied" ? (b.lobbying ?? 0) - (a.lobbying ?? 0) || b.actors - a.actors || a.name.localeCompare(b.name)
    : total(sides[b.id] as Sides) - total(sides[a.id] as Sides) || b.money - a.money);
  // Under a "2026 races" heading the year and the word "race" are already said.
  const raceName = (n: string) => n.replace(/^\d{4}\s+/, "").replace(/\s+race$/i, "");
  const groupName = (g: string) => (kind[0] === "elections" && isCands(g) ? clusterName(g).replace(/election$/, "candidates") : clusterName(g));
  const byId = new Map<string, any>(ts.map((t) => [t.id, t]));
  // Each race's candidates, best funded first.
  const candsOf = new Map<string, any[]>();
  for (const t of ts) if (t.type === "lawmaker" && t.race) candsOf.set(t.race, [...(candsOf.get(t.race) ?? []), t]);
  for (const list of candsOf.values()) list.sort((a, b) => b.shown_money - a.shown_money || a.name.localeCompare(b.name));
  // Bars are scaled to the largest value of their kind in the tab, so every group shares one ruler.
  const maxRace = Math.max(1, ...inKind.filter((t) => t.type !== "lawmaker").map(drawn));
  const maxCand = Math.max(1, ...inKind.filter((t) => t.type === "lawmaker").map(drawn));
  const maxFilings = Math.max(1, ...inKind.map((t) => t.lobbying ?? 0));
  const Bar = ({ v, max, tone }: { v: number; max: number; tone?: string }) => (
    <td className="pbar" aria-hidden><span className={`pmeter${tone ? ` pmeter-${tone}` : ""}`}>{v > 0 && <i style={{ width: `${(100 * v) / max}%` }} />}</span></td>
  );
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
        {groups.length > 1 && <SectionNav key={kind[0] + want} items={groups.map((g) => ({ id: g, label: groupName(g) }))} label="Groups" />}
        <div className="pol-main">
          {groups.map((g) => {
            const rows = rowsOf(g);
            return (
              <section key={g} id={g} className="pol-group">
                <h2>{groupName(g)} <span className="muted">{rows.length}</span></h2>

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
                ) : kind[0] === "elections" ? (() => {
                  const cands = isCands(g);
                  const paid = rows.filter((t) => drawn(t) > 0), quiet = rows.filter((t) => !(drawn(t) > 0));
                  const sum = paid.reduce((x, t) => x + drawn(t), 0);
                  const max = cands ? maxCand : maxRace;
                  return (
                    <>
                      {paid.length > 0 && (
                        <p className="pstats">
                          {fmtMoney(sum)} in outside money on record, across {paid.length} {cands ? (paid.length === 1 ? "candidate" : "candidates") : (paid.length === 1 ? "race" : "races")}.
                          {" "}The largest is <Link href={`/node/${paid[0].id}`}>{cands ? paid[0].name : raceName(paid[0].name)}</Link>, at {fmtMoney(drawn(paid[0]))}.
                        </p>
                      )}
                      {paid.length > 0 && (
                        <table className="data-table ptable">
                          <thead><tr><th className="prank"><span className="vh">Rank</span></th><th>{cands ? "Candidate" : "Race"}</th>
                            <th className="pwho">{cands ? "Race" : "Candidates on record"}</th><th colSpan={2}>Outside money on record</th></tr></thead>
                          <tbody>{paid.map((t, i) => {
                            const list = candsOf.get(t.id) ?? [];
                            const race = cands && t.race ? byId.get(t.race) : undefined;
                            return (
                              <tr key={t.id}>
                                <td className="prank">{i + 1}</td>
                                <td className="pname"><Link href={`/node/${t.id}`}>{cands ? t.name : raceName(t.name)}</Link></td>
                                <td className="pwho">{cands
                                  ? (race ? <Link href={`/node/${race.id}`}>{raceName(race.name)}</Link> : <span className="muted">Not on record</span>)
                                  : list.length ? <>
                                      {list.slice(0, 3).map((c, k) => <span key={c.id}>{k > 0 && ", "}<Link href={`/node/${c.id}`}>{c.name}</Link></span>)}
                                      {list.length > 3 && <span className="muted">, and {list.length - 3} more</span>}
                                    </> : <span className="muted">{t.candidates || "None"}</span>}</td>
                                <td className="pamt">{fmtMoney(drawn(t))}</td>
                                <Bar v={drawn(t)} max={max} tone="money" />
                              </tr>
                            );
                          })}</tbody>
                        </table>
                      )}
                      {quiet.length > 0 && (
                        <div className="pquiet">
                          <h3>No outside money on record <span className="muted">{quiet.length}</span></h3>
                          <ul>{quiet.map((t) => <li key={t.id}><Link href={`/node/${t.id}`}>{cands ? t.name : raceName(t.name)}</Link></li>)}</ul>
                        </div>
                      )}
                    </>
                  );
                })() : (
                  // One lobbying report covers many agencies, so no dollar figure is split out per agency.
                  <table className="data-table ptable">
                    <thead><tr><th className="prank"><span className="vh">Rank</span></th><th>Body</th><th className="num">Organizations</th><th colSpan={2}>Lobbying filings</th></tr></thead>
                    <tbody>{rows.map((t, i) => (
                      <tr key={t.id}>
                        <td className="prank">{i + 1}</td>
                        <td className="pname"><Link href={`/node/${t.id}`}>{t.name}</Link>{t.descriptor && <span className="ptable-note">{t.descriptor}</span>}</td>
                        <td className="num">{t.actors}</td>
                        <td className="pamt">{(t.lobbying ?? 0).toLocaleString()}</td>
                        <Bar v={t.lobbying ?? 0} max={maxFilings} />
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
