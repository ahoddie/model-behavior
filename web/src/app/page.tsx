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

const SIDES = [["support", "Supported"], ["mixed", "Mixed or conditional"], ["oppose", "Opposed"]] as const;
const sideOf = (s: string) => (s === "support" ? "support" : s === "oppose" ? "oppose" : "mixed");

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
        <p className="sec-lede">
          See the bills, orders, and rules with the most public positions and open any name to reach its source.
        </p>
        <PageCard href="/targets" />
        {stances.slice(0, 4).map((t: any) => (
          <article key={t.id} className="stance">
            <h3><Link href={`/node/${t.id}`}>{t.name}</Link></h3>
            {t.descriptor && <p className="note">{t.descriptor}</p>}
            {(() => {
              const sides = SIDES.map(([side, label]) => ({ side, label, who: t.actors.filter((a: any) => sideOf(a.stance) === side) })).filter((x) => x.who.length);
              return (
                <div className="stance-cols" style={{ ["--n" as any]: sides.length }}>
                  {sides.map(({ side, label, who }) => (
                    <div key={side} className={`stance-side ${side}`}>
                      <h4>{label} <span className="muted">{who.length}</span></h4>
                      <ul>{who.slice(0, SHOW).map((a: any) => (
                        <li key={a.id}><Named node={a}><Link href={`/node/${a.id}`}>{a.name}</Link></Named>
                          <a className="stance-src" href={a.url} target="_blank" rel="noreferrer" title={sourceName(a.url)} aria-label={`Source: ${sourceName(a.url)}`}>
                            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M3 1.5h5.5V7M8.5 1.5 1.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
                          </a></li>
                      ))}{who.length > SHOW && <li className="who-rest"><Link href={`/node/${t.id}`}>and {who.length - SHOW} more</Link></li>}</ul>
                    </div>
                  ))}
                </div>
              );
            })()}
          </article>
        ))}
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
