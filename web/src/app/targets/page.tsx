import { Suspense } from "react";
import Link from "@/components/Link";
import { listTargets, targetSides, billStages, raceSpending, listBills, type SideName, type BillRecord } from "@/lib/data";
import RacePanels, { seatsOf } from "@/components/RacePanels";
import { fmtMoney, fmtDate, clusterName, landsRank, billPlace, STATE_NAMES, STAGE_LABEL } from "@/lib/format";
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

// Public bill records not yet on the map: a smaller tile with the stage, number, title, sponsor, and latest action,
// opening the official record. A long list shows its first dozen and folds the rest.
function RecordTile({ b }: { b: BillRecord }) {
  return (
    <li className="prec">
      <p className={`pcard-stage stage-${b.stage}`}>{STAGE_LABEL[b.stage] ?? b.stage}</p>
      <h3><a className="no-ext" href={b.source_url} target="_blank" rel="noreferrer">{b.identifier}<span className="prec-ext" aria-hidden>↗</span><span className="vh"> (official record, leaves this site)</span></a></h3>
      <p className="prec-title">{b.title}</p>
      <p className="prec-meta">{[b.sponsor, b.status_date && `Last action ${fmtDate(b.status_date)}`].filter(Boolean).join(" · ")}</p>
    </li>
  );
}
function Records({ list, lead }: { list: BillRecord[]; lead: boolean }) {
  const FIRST = 12;
  return (
    <div className="precs-wrap">
      {lead && <h3 className="precs-head">More public records <span className="muted">{list.length}</span></h3>}
      <ul className="precs">{list.slice(0, FIRST).map((b) => <RecordTile key={b.id} b={b} />)}</ul>
      {list.length > FIRST && (
        <details className="precs-more">
          <summary>Show {list.length - FIRST} more</summary>
          <ul className="precs">{list.slice(FIRST).map((b) => <RecordTile key={b.id} b={b} />)}</ul>
        </details>
      )}
    </div>
  );
}

type Sp = PageProps<"/targets">["searchParams"];
const load = () => Promise.all([listTargets(), targetSides(), billStages(), raceSpending(), listBills()]);

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
  const [ts, sides, stages, spend, records] = await load();
  const seats = seatsOf(ts.filter((t) => t.grp.startsWith("e-")), spend);
  const kind = (KINDS.find(([k]) => k === sp.kind) ?? KINDS[0]);
  // Bills are grouped by where they sit: Congress first, then each state on its own, A to Z.
  const placeOf = (t: any) => `b-${stages[t.id]?.jurisdiction ?? billPlace(t.id, t.name)}`;
  // Besides the bills on the map, every public bill record the importers found is listed, as a smaller tile that
  // opens the official record. Bills can be narrowed to one stage; "none" keeps map bills with no record matched yet.
  const unlinked = records.filter((b) => !b.node_id).map((b) => ({ id: b.id, type: "record", grp: `b-${b.jurisdiction}`, rec: b }));
  const stageOf = (t: any) => (t.rec ? t.rec.stage : stages[t.id]?.stage ?? "none");
  const showWant = kind[0] === "bills" && sp.show === "map" ? "map" : "";
  const allBills = [...ts.filter((t) => t.grp.startsWith("b-")), ...(showWant ? [] : unlinked)];
  const stageCounts = new Map<string, number>();
  for (const t of allBills) stageCounts.set(stageOf(t), (stageCounts.get(stageOf(t)) ?? 0) + 1);
  const stageWant = kind[0] === "bills" && typeof sp.stage === "string" && stageCounts.has(sp.stage) ? sp.stage : "";
  const inKind = [...ts.filter((t) => kind[2](t.grp)).map((t) => (kind[0] === "bills" ? { ...t, grp: placeOf(t) } : t)), ...(kind[0] === "bills" ? allBills.filter((t: any) => t.rec) : [])]
    .filter((t) => !stageWant || stageOf(t) === stageWant);
  const placeName = (g: string) => (g === "b-us" ? "Federal" : g === "b-other" ? "Other" : STATE_NAMES[g.slice(2)] ?? g.slice(2).toUpperCase());
  const billRank = (g: string) => (g === "b-us" ? "0" : g === "b-other" ? "2" : `1${placeName(g)}`);
  const groups = [...new Set(inKind.map((t) => t.grp as string))]
    .sort((a, b) => (kind[0] === "bills" ? billRank(a).localeCompare(billRank(b)) : landsRank(a) - landsRank(b)));
  // Cards: rows with positions first, then by money, so the busiest debates lead. Tables: by the value their bar draws,
  // so the bars step down in order. Elections draw their own panels (RacePanels).
  const rowsOf = (g: string) => inKind.filter((t) => t.grp === g).sort((a, b) =>
    a.rec || b.rec ? Number(!!a.rec) - Number(!!b.rec) || (b.rec?.status_date ?? "").localeCompare(a.rec?.status_date ?? "")
    : kind[0] === "lobbied" ? (b.lobbying ?? 0) - (a.lobbying ?? 0) || b.actors - a.actors || a.name.localeCompare(b.name)
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
            {label} <span className="muted">({k === "elections" ? seats.length : ts.filter((t) => test(t.grp)).length + (k === "bills" ? unlinked.length : 0)})</span>
          </Link>
        ))}
      </nav>

      {kind[0] === "elections" && <RacePanels seats={seats} sp={sp} />}

      {kind[0] === "bills" && (
        <form className="filters" action="/targets">
          <input type="hidden" name="kind" value="bills" />
          <Select label="Stage" name="stage" defaultValue={stageWant} submitOnChange
            options={[{ value: "", label: `Every stage (${allBills.length})` },
              ...Object.keys(STAGE_LABEL).map((k) => ({ value: k, label: `${STAGE_LABEL[k]} (${stageCounts.get(k) ?? 0})` })),
              ...(stageCounts.has("none") ? [{ value: "none", label: `Stage not on record (${stageCounts.get("none")})` }] : [])]} />
          <Select label="Show" name="show" defaultValue={showWant} submitOnChange
            options={[{ value: "", label: "Every public record" }, { value: "map", label: "Bills on the map only" }]} />
          <noscript><button type="submit">Show</button></noscript>
        </form>
      )}

      {kind[0] !== "elections" && <div className="pol-body">
        {groups.length > 1 && <SectionNav key={kind[0] + stageWant + showWant} items={groups.map((g) => ({ id: g, label: groupName(g), count: kind[0] === "bills" ? rowsOf(g).length : undefined }))} label="Groups" />}
        <div className="pol-main">
          {groups.map((g) => {
            const rows = rowsOf(g);
            return (
              <section key={g} id={g} className="pol-group">
                <h2>{groupName(g)} <span className="muted">{rows.length}</span></h2>

                {cards ? (<>
                  {rows.some((t: any) => !t.rec) && <ul className="pcards">{rows.filter((t: any) => !t.rec).map((t) => {
                    const sd = sides[t.id] as Sides | undefined;
                    const href = `/node/${t.id}`;
                    return (
                      <li key={t.id} className={`pcard${sd ? "" : " pcard-quiet"}`}>
                        <p className="pcard-top">
                          {stages[t.id] ? <span className={`pcard-stage stage-${stages[t.id].stage}`}>{STAGE_LABEL[stages[t.id].stage] ?? stages[t.id].stage}</span> : <span />}
                          {kind[0] === "bills" && <span className="pcard-onmap">On the map</span>}
                        </p>
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
                  })}</ul>}
                  {rows.some((t: any) => t.rec) && <Records list={rows.filter((t: any) => t.rec).map((t: any) => t.rec)} lead={rows.some((t: any) => !t.rec)} />}
                </>) : (
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
