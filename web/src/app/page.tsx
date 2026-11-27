import Link from "@/components/Link";
import { getHome, getAnalysis, getIssueActors, type IssueActor } from "@/lib/data";
import { fmtMoney, fmtDate } from "@/lib/format";
import Src from "@/components/Src";
import Skyline from "@/components/Skyline";
import TitleCode from "@/components/TitleCode";
import SectionNav from "@/components/SectionNav";
import CiteButton from "@/components/CiteButton";
import { Named } from "@/components/ProfileHead";
import RankChart from "@/components/RankChart";
import TrendChart from "@/components/TrendChart";
import { sourceName } from "@/lib/format";
import HomeNav, { PageCard } from "@/components/HomeNav";

// Ordered for someone new to this: who has the money, then the fights it lands on and who is on each side, then what
// they say, and last the wider analysis by issue and over time. The page links (Network and the rest) sit under the title.
const SECTIONS: { id: string; label: string; title: string }[] = [
  { id: "money", label: "Where money goes", title: "Where is the money going?" },
  { id: "stances", label: "Positions", title: "Where do they stand?" },
  { id: "words", label: "Quotes", title: "What are they saying?" },
  { id: "issues", label: "Policy priorities", title: "What do they care about?" },
  { id: "trend", label: "Change over time", title: "How has that changed?" },
];

// The positions section: a roll call on the two California bills and the two federal moves to override state AI laws.
// One row per person or group on record for at least two of them, sorted into the two camps.
const ROLL = [
  { id: "ca-sb1047-2024", name: "SB 1047", sub: "2024, vetoed", side: 1 },
  { id: "ca-sb53-2025", name: "SB 53", sub: "2025, signed", side: 1 },
  { id: "us-ai-moratorium-2025", name: "Moratorium", sub: "2025, struck 99–1", side: -1 },
  { id: "eo-14365", name: "EO 14365", sub: "2025, issued", side: -1 },
] as const;
const MARK = { s: "supported", o: "opposed", m: "had a mixed or conditional position on" } as const;
type Mark = { k: keyof typeof MARK; url: string };
type RollRow = { node: any; cells: (Mark | null)[] };
function rollCall(stances: any[]) {
  const rows = new Map<string, RollRow>();
  ROLL.forEach((b, i) => {
    for (const a of stances.find((t) => t.id === b.id)?.actors ?? []) {
      const row = rows.get(a.id) ?? { node: { ...a, name: a.name.replace(/\s*\([^)]*\)\s*$/, "") }, cells: ROLL.map(() => null) };
      row.cells[i] = { k: a.stance === "support" ? "s" : a.stance === "oppose" ? "o" : "m", url: a.url };
      rows.set(a.id, row);
    }
  });
  // For state AI rules: backed the California bills or fought the override, and not the reverse.
  const lean = (r: RollRow, side: number) => r.cells.reduce((n, c, i) => n + (c && ROLL[i].side === side ? ({ s: 1, o: -1, m: 0 })[c.k] : 0), 0);
  const camp = (r: RollRow) => { const ca = lean(r, 1), fed = lean(r, -1);
    return (ca >= 0 && fed < 0) || (ca > 0 && fed <= 0) ? 0 : (ca <= 0 && fed > 0) || (ca < 0 && fed >= 0) ? 1 : -1; };
  const multi = [...rows.values()].filter((r) => r.cells.filter(Boolean).length >= 2)
    .sort((x, y) => y.cells.filter(Boolean).length - x.cells.filter(Boolean).length || x.node.name.localeCompare(y.node.name));
  return [["For", multi.filter((r) => camp(r) === 0)], ["Against", multi.filter((r) => camp(r) === 1)]] as const;
}

// Built ahead of time from the cached record: a visit reads no request data and runs no query.
// Old links to the map (/?focus=…, /?view=time) are redirected in next.config.ts.
// The homepage shows only the most contested issues: both sides have someone on record, ranked by the smaller side,
// then by how many took a side. The full list is on Statements.
const CONTESTED = 4;
const PREVIEW = 3;
function TallySide({ side, actors }: { side: "agree" | "disagree"; actors: IssueActor[] }) {
  const n = actors.length, verb = side === "agree" ? (n === 1 ? "agrees" : "agree") : (n === 1 ? "disagrees" : "disagree");
  const li = (a: IssueActor) => <li key={a.id}><Link href={`/node/${a.id}`}>{a.name}</Link></li>;
  return (
    <div className={`tally-side ${side}`}>
      <div className="tally-n">{side === "agree" ? <>{n}<small>{verb}</small></> : <><small>{verb}</small>{n}</>}</div>
      <ul className="tally-who">{actors.slice(0, PREVIEW).map(li)}</ul>
      {n > PREVIEW && <details className="tally-more">
        <summary><span className="open">Show {n - PREVIEW} more ↓</span><span className="close">Show fewer ↑</span></summary>
        <ul className="tally-who">{actors.slice(PREVIEW).map(li)}</ul>
      </details>}
    </div>
  );
}

export default async function Home() {
  const [{ counts, givers, recipients, stances, byYear, quotes, today }, analysis, who] = await Promise.all([getHome(), getAnalysis(), getIssueActors()]);
  const asOf = fmtDate(today);
  const contested = (analysis?.issues ?? []).map((i) => ({ ...i, agree: who[i.id]?.agree ?? [], disagree: who[i.id]?.disagree ?? [] }))
    .filter((i) => i.agree.length && i.disagree.length)
    .sort((x, y) => Math.min(y.agree.length, y.disagree.length) - Math.min(x.agree.length, x.disagree.length)
      || (y.agree.length + y.disagree.length) - (x.agree.length + x.disagree.length))
    .slice(0, CONTESTED);
  const roll = rollCall(stances);
  const most = Math.max(1, ...contested.flatMap((i) => [i.agree.length, i.disagree.length]));

  return (
    <div className="home">
      <SectionNav items={SECTIONS} />
      <div className="home-main">

      <header className="home-intro">
        <h1 className="home-title">How Silicon Valley shapes AI <span className="title-last">policy<Skyline className="skyline" /></span><TitleCode /></h1>
        <HomeNav />
      </header>

      <section id="money" className="home-sec">
        <div className="sec-head"><h2>Where is the money going?</h2><CiteButton kind="page" title="Where is the money going?" path="/#money" asOf={asOf} /></div>
        <p className="sec-lede">
          Follow {fmtMoney(counts.direct)} in direct giving to candidates, PACs, parties, and advocacy groups and track {counts.filings.toLocaleString()} lobbying filings separately.
        </p>
        <PageCard href="/money" />
        <figure className="chart">
          <figcaption className="chart-head"><h3>Top givers</h3></figcaption>
          <RankChart label="The ten largest givers, by dollars given directly" unit="given" fmt={fmtMoney}
            rows={givers.map((g: any) => ({ id: g.id, name: g.name, value: g.total,
              label: <><Link href={`/node/${g.id}`}>{g.name}</Link></>,
              note: `${g.recipients} ${g.recipients === 1 ? "recipient" : "recipients"}` }))} />
        </figure>
        <figure className="chart">
          <figcaption className="chart-head"><h3>Top recipients</h3></figcaption>
          <RankChart label="The ten largest recipients, by dollars received from the givers tracked here" unit="received" fmt={fmtMoney}
            rows={recipients.map((r: any) => ({ id: r.id, name: r.name, value: r.total,
              label: <><Link href={`/node/${r.id}`}>{r.name}</Link></>,
              note: `From ${r.top_givers}${r.givers > 3 ? ` and ${r.givers - 3} more` : ""}` }))} />
        </figure>
      </section>

      <section id="stances" className="home-sec">
        <div className="sec-head"><h2>Where do they stand?</h2><CiteButton kind="page" title="Where do they stand?" path="/#stances" asOf={asOf} /></div>
        <p className="sec-lede">See who lines up with whom on state AI rules.</p>
        <PageCard href="/targets" />
        <div className="roll" role="table" aria-label="Positions on four AI bills and orders">
          <div className="roll-row roll-head" role="row">
            <div className="roll-key" role="columnheader"><span><i className="mark s" />Supported</span><span><i className="mark o" />Opposed</span><span><i className="mark m" />Mixed</span></div>
            {ROLL.map((b) => <div key={b.id} className="roll-col" role="columnheader"><Link href={`/node/${b.id}`} title={b.sub}>{b.name === "Moratorium" ? "Mora\u00ADtorium" : b.name}</Link></div>)}
          </div>
          {roll.map(([label, rows], g) => rows.length > 0 && (
            <div key={label} role="rowgroup">
              <div className={`roll-group g${g}`} role="row"><span role="rowheader">{label} state AI rules</span></div>
              {rows.map((r) => (
                <div key={r.node.id} className="roll-row" role="row">
                  <div className="roll-name" role="rowheader"><Named node={r.node}><Link href={`/node/${r.node.id}`}>{r.node.name}</Link></Named></div>
                  {r.cells.map((c, i) => <div key={ROLL[i].id} className="roll-cell" role="cell">{c
                    ? <a className={`mark ${c.k}`} href={c.url} target="_blank" rel="noreferrer" title={`${r.node.name} ${MARK[c.k]} ${ROLL[i].name}. Source: ${sourceName(c.url)}`} aria-label={`${r.node.name} ${MARK[c.k]} ${ROLL[i].name}. Open the source.`} />
                    : <span className="mark none" aria-label="No position" />}</div>)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section id="words" className="home-sec">
        <div className="sec-head"><h2>What are they saying?</h2><CiteButton kind="page" title="What are they saying?" path="/#words" asOf={asOf} /></div>
        <p className="sec-lede">Read the latest public statements word for word.</p>
        <PageCard href="/statements" />
        <ul className="record">{quotes.slice(0, 6).map((f: any) => (
          <li key={f.id}><div className="when">{fmtDate(f.date)}</div>
            <div><p className="q">“{f.excerpt}”<Src url={f.url} archive={f.archive_url} /></p>
              <p className="note"><Link href={`/node/${f.node_id}`}>{f.name}</Link>{f.target_name && <> · on {f.target_id ? <Link href={`/node/${f.target_id}`}>{f.target_name}</Link> : f.target_name}</>}</p></div></li>
        ))}</ul>
      </section>

      {analysis && <section id="issues" className="home-sec">
        <div className="sec-head"><h2>What do they care about?</h2><CiteButton kind="page" title="What do they care about?" path="/#issues" asOf={asOf} /></div>
        <p className="sec-lede">See the fights where people and groups on record actually split.</p>
        <PageCard href="/statements" />
        <div className="tally-key" aria-hidden><span className="disagree">← Disagree</span><span className="agree">Agree →</span></div>
        <ol className="tallies">{contested.map((i) => (
          <li key={i.id}>
            <h3>{i.label}</h3>
            <p className="tally-q">{i.positive}</p>
            <div className="tally-bar" role="img" aria-label={`${i.disagree.length} disagree, ${i.agree.length} agree`}>
              <span className="half disagree"><span style={{ width: `${(i.disagree.length / most) * 100}%` }} /></span>
              <span className="axis" />
              <span className="half agree"><span style={{ width: `${(i.agree.length / most) * 100}%` }} /></span>
            </div>
            <div className="tally-sides"><TallySide side="disagree" actors={i.disagree} /><TallySide side="agree" actors={i.agree} /></div>
          </li>
        ))}</ol>
      </section>}

      <section id="trend" className="home-sec">
        <div className="sec-head"><h2>How has that changed?</h2><CiteButton kind="page" title="How has that changed?" path="/#trend" asOf={asOf} /></div>
        <p className="sec-lede">
          Watch public positions on bills and rules change year by year with fuller coverage in later years.
        </p>
        <div className="legend-row">
          <span><i className="sw sw-support" aria-hidden /> Supported</span>
          <span><i className="sw sw-mixed" aria-hidden /> Mixed or conditional</span>
          <span><i className="sw sw-oppose" aria-hidden /> Opposed</span>
        </div>
        <TrendChart label="Public positions on bills and rules, by year" years={byYear} current={Number(today.slice(0, 4))} />
      </section>
      </div>
    </div>
  );
}
