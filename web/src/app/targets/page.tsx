import { Suspense } from "react";
import Link from "@/components/Link";
import { listTargets, targetSides, billStages, raceSpending, type SideName } from "@/lib/data";
import RacePanels, { seatsOf } from "@/components/RacePanels";
import { fmtMoney, clusterName, landsRank, billPlace, STATE_NAMES, STAGE_LABEL } from "@/lib/format";
import Select from "@/components/Select";
import SectionNav from "@/components/SectionNav";
import { Named } from "@/components/ProfileHead";

// Four kinds of place the record lands. One shows at a time, so the page reads as a short list rather than one long scroll.
const KINDS = [
  ["bills", "Bills", (g: string) => g.startsWith("b-")],
  ["rules", "Executive orders and rules", (g: string) => g.startsWith("r-")],
  ["elections", "Elections", (g: string) => g.startsWith("e-")],
  ["lobbied", "Agencies and offices engaged", (g: string) => g.startsWith("g-") || g === "administration"],
] as const;
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
const load = () => Promise.all([listTargets(), targetSides(), billStages(), raceSpending()]);

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
  const [ts, sides, stages, spend] = await load();
  const seats = seatsOf(ts.filter((t) => t.grp.startsWith("e-")), spend);
  const kind = (KINDS.find(([k]) => k === sp.kind) ?? KINDS[0]);
  // Bills are grouped by where they sit: Congress first, then each state on its own, A to Z.
  const placeOf = (t: any) => `b-${stages[t.id]?.jurisdiction ?? billPlace(t.id, t.name)}`;
  // Bills can be narrowed to one stage; "none" keeps the bills with no public record matched yet.
  const stageOf = (t: any) => stages[t.id]?.stage ?? "none";
  const allBills = ts.filter((t) => t.grp.startsWith("b-"));
  const stageCounts = new Map<string, number>();
  for (const t of allBills) stageCounts.set(stageOf(t), (stageCounts.get(stageOf(t)) ?? 0) + 1);
  const stageWant = kind[0] === "bills" && typeof sp.stage === "string" && stageCounts.has(sp.stage) ? sp.stage : "";
  const inKind = ts.filter((t) => kind[2](t.grp)).map((t) => (kind[0] === "bills" ? { ...t, grp: placeOf(t) } : t))
    .filter((t) => !stageWant || stageOf(t) === stageWant);
  const placeName = (g: string) => (g === "b-us" ? "Federal" : g === "b-other" ? "Other" : STATE_NAMES[g.slice(2)] ?? g.slice(2).toUpperCase());
  const billRank = (g: string) => (g === "b-us" ? "0" : g === "b-other" ? "2" : `1${placeName(g)}`);
  const groups = [...new Set(inKind.map((t) => t.grp as string))]
    .sort((a, b) => (kind[0] === "bills" ? billRank(a).localeCompare(billRank(b)) : landsRank(a) - landsRank(b)));
  // Cards: rows with positions first, then by money, so the busiest debates lead. Tables: by the value their bar draws,
  // so the bars step down in order. Elections draw their own panels (RacePanels).
  const rowsOf = (g: string) => inKind.filter((t) => t.grp === g).sort((a, b) =>
    kind[0] === "lobbied" ? (b.lobbying ?? 0) - (a.lobbying ?? 0) || b.actors - a.actors || a.name.localeCompare(b.name)
    : total(sides[b.id] as Sides) - total(sides[a.id] as Sides) || b.money - a.money);
  const groupName = (g: string) => (kind[0] === "bills" ? placeName(g) : clusterName(g));
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
            {label} <span className="muted">({k === "elections" ? seats.length : ts.filter((t) => test(t.grp)).length})</span>
          </Link>
        ))}
      </nav>

      {kind[0] === "elections" && <RacePanels seats={seats} sp={sp} />}

      {kind[0] === "bills" && stageCounts.size > 1 && (
        <form className="filters" action="/targets">
          <input type="hidden" name="kind" value="bills" />
          <Select label="Stage" name="stage" defaultValue={stageWant} submitOnChange
            options={[{ value: "", label: `Every stage (${allBills.length})` },
              ...[...Object.keys(STAGE_LABEL), "none"].filter((k) => stageCounts.has(k))
                .map((k) => ({ value: k, label: `${STAGE_LABEL[k] ?? "Stage not on record"} (${stageCounts.get(k)})` }))]} />
          <noscript><button type="submit">Show</button></noscript>
        </form>
      )}

      {kind[0] !== "elections" && <div className="pol-body">
        {groups.length > 1 && <SectionNav key={kind[0] + stageWant} items={groups.map((g) => ({ id: g, label: groupName(g), count: kind[0] === "bills" ? rowsOf(g).length : undefined }))} label="Groups" />}
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
                        {stages[t.id] && <p className={`pcard-stage stage-${stages[t.id].stage}`}>{STAGE_LABEL[stages[t.id].stage] ?? stages[t.id].stage}</p>}
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
                ) : (
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
      </div>}
    </>
  );
}
