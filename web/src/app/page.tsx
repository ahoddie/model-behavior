import Link from "@/components/Link";
import { getHome, getAnalysis, getLobbyingByIssue, getTopics, getIssueActors, type IssueActor } from "@/lib/data";
import StanceBar from "@/components/StanceBar";
import { fmtMoney, fmtDate, TYPE_LABEL } from "@/lib/format";
import Src from "@/components/Src";
import Skyline from "@/components/Skyline";
import TitleCode from "@/components/TitleCode";
import SectionNav from "@/components/SectionNav";
import CiteButton from "@/components/CiteButton";
import { Named } from "@/components/ProfileHead";
import RankChart from "@/components/RankChart";
import TrendChart from "@/components/TrendChart";
import TalkChart, { type TalkIssue, type ActorTopic } from "@/components/TalkChart";
import { sourceName } from "@/lib/format";
import HomeNav from "@/components/HomeNav";

const SECTIONS: { id: string; label: string; title: string }[] = [
  { id: "money", label: "Where money goes", title: "Where is the money going?" },
  { id: "issues", label: "Policy priorities", title: "What do they care about?" },
  { id: "stances", label: "Positions", title: "Where do they stand?" },
  { id: "trend", label: "Change over time", title: "How has that changed?" },
  { id: "words", label: "Quotes", title: "What are they saying?" },
  { id: "map", label: "Network", title: "How is it all connected?" },
];

const SIDES = [["support", "Supported"], ["mixed", "Mixed or conditional"], ["oppose", "Opposed"]] as const;
const sideOf = (s: string) => (s === "support" ? "support" : s === "oppose" ? "oppose" : "mixed");

// Built ahead of time from the cached record: a visit reads no request data and runs no query.
// Old links to the map (/?focus=…, /?view=time) are redirected in next.config.ts.
// Who agrees and who disagrees with a statement, most statements first; the first few of each side, then "and N more".
const SHOW = 6;
function Side({ label, side, actors, more }: { label: string; side: string; actors: IssueActor[]; more?: string }) {
  if (!actors.length) return null;
  return (
    <div className={`who-side ${side}`}>
      <span className="who-label">{label} <span className="muted">{actors.length}</span></span>
      <ul>{actors.slice(0, SHOW).map((a) => (
        <li key={a.id}><Named node={a} size={18}><Link href={`/node/${a.id}`}>{a.name}</Link></Named></li>
      ))}{actors.length > SHOW && <li className="who-rest">{more ? <Link href={more}>and {actors.length - SHOW} more</Link> : <>and {actors.length - SHOW} more</>}</li>}</ul>
    </div>
  );
}
function Who({ sides, topicId }: { sides?: { agree: IssueActor[]; disagree: IssueActor[] }; topicId?: string }) {
  if (!sides || !(sides.agree.length + sides.disagree.length)) return null;
  return (
    <div className="who">
      <Side label="Agree" side="support" actors={sides.agree} more={topicId && `/statements#${topicId}`} />
      <Side label="Disagree" side="oppose" actors={sides.disagree} more={topicId && `/statements#${topicId}`} />
      {topicId && <Link className="who-more" href={`/statements#${topicId}`}>Read their quotes</Link>}
    </div>
  );
}

export default async function Home() {
  const [{ counts, givers, recipients, stances, byYear, quotes, talkers, today }, analysis, lobbying, topics, who] = await Promise.all([getHome(), getAnalysis(), getLobbyingByIssue(), getTopics(), getIssueActors()]);
  const asOf = fmtDate(today);
  // The chart of who talks most about each statement: the 15 actors with the most sided statements, most-discussed issue first.
  const talk: TalkIssue[] = (analysis?.issues ?? []).map((i) => ({
    id: i.id, label: i.label, positive: i.positive, topicId: topics.find((t) => t.issue_id === i.id && t.confirmed > 0)?.id,
    actors: [...(who[i.id]?.agree ?? []).map((a) => ({ ...a, agree: true })), ...(who[i.id]?.disagree ?? []).map((a) => ({ ...a, agree: false }))]
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 15)
      .map((a) => ({ id: a.id, name: a.name, kind: TYPE_LABEL[a.type] ?? a.type, n: a.n, agree: a.agree })),
  })).filter((i) => i.actors.length >= 3);
  // For the breakdown under a bar: each charted actor's sided statements per issue, most first.
  const charted = new Set([...talkers.map((a: any) => a.id), ...talk.flatMap((i) => i.actors.map((a) => a.id))]);
  const byActor: Record<string, ActorTopic[]> = {};
  for (const i of analysis?.issues ?? []) for (const [side, agree] of [["agree", true], ["disagree", false]] as const)
    for (const a of who[i.id]?.[side] ?? []) if (charted.has(a.id)) (byActor[a.id] ??= []).push({ id: i.id, label: i.label, n: a.n, agree });
  for (const k in byActor) byActor[k].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));

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
          {fmtMoney(counts.direct)} given directly to candidates, PACs, parties, and advocacy groups. Lobbying is separate: {counts.filings.toLocaleString()} filings.
        </p>
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
        <p className="more"><Link href="/money">Trace the money</Link></p>
      </section>

      {analysis && <section id="issues" className="home-sec">
        <div className="sec-head"><h2>What do they care about?</h2><CiteButton kind="page" title="What do they care about?" path="/#issues" asOf={asOf} /></div>
        <p className="sec-lede">
          {analysis.meta.used.toLocaleString()} quotes, sorted by issue and by whether the speaker agrees.
          {" "}<Link href="/data?view=methodology#analysis">How this works</Link>.
        </p>
        <div className="grid2 chart-pair">
          <figure className="chart">
            <figcaption className="chart-head"><h3>Statements by issue</h3></figcaption>
            <RankChart label="Policy issues, by number of public statements" unit="statements"
              rows={analysis.issues.filter((i) => i.statements > 0).map((i) => ({ id: i.id, name: i.label, value: i.statements, label: i.label }))} />
          </figure>
          <figure className="chart">
            <figcaption className="chart-head"><h3>Lobbying filings by issue</h3></figcaption>
            <RankChart label="Policy issues, by number of lobbying filings that name them" unit="filings"
              rows={analysis.issues.filter((i) => lobbying[i.id]).map((i) => ({ id: i.id, name: i.label, value: lobbying[i.id].filings, label: i.label }))
                .sort((a, b) => b.value - a.value)} />
          </figure>
        </div>
        <TalkChart issues={talk} byActor={byActor} all={talkers.map((a: any) => ({ id: a.id, name: a.name, kind: TYPE_LABEL[a.type] ?? a.type, n: a.n,
          rest: { neutral: a.neutral, off: a.off_issue, unsure: a.unsure, unsorted: a.unsorted } }))} />
        <ul className="issues">{analysis.issues.filter((i) => i.statements > 0).map((i) => (
          <li key={i.id}>
            <div className="iss-head">
              <h3>{i.positive}</h3>
              <StanceBar value={i.avg} />
            </div>
            <Who sides={who[i.id]} topicId={topics.find((t) => t.issue_id === i.id && t.confirmed > 0)?.id} />
            <details className="iss-rests">
              <summary>What this rests on</summary>
              <p className="iss-facts">
                {i.statements} {i.statements === 1 ? "statement" : "statements"} from {i.actors} {i.actors === 1 ? "actor" : "actors"}: {i.plus} agree, {i.minus} disagree, {i.neutral} neutral.
                {i.money > 0 && <> {fmtMoney(i.money)} to groups that speak on it, mostly from {i.money_givers.map((g, k) => <span key={g.id}>{k > 0 && (k === i.money_givers.length - 1 ? " and " : ", ")}<Link href={`/node/${g.id}`}>{g.name}</Link></span>)}.</>}
                {lobbying[i.id] && <> {lobbying[i.id].filings.toLocaleString()} lobbying {lobbying[i.id].filings === 1 ? "filing" : "filings"} from {lobbying[i.id].actors} {lobbying[i.id].actors === 1 ? "actor" : "actors"}.</>}
              </p>
            </details>
          </li>
        ))}</ul>
        <p className="note">
          {fmtMoney(analysis.cover.assigned)} of {fmtMoney(analysis.cover.total)} in direct giving went to groups with enough statements to place by issue. Most of the rest went to candidates and parties.
        </p>
      </section>}

      <section id="stances" className="home-sec">
        <div className="sec-head"><h2>Where do they stand?</h2><CiteButton kind="page" title="Where do they stand?" path="/#stances" asOf={asOf} /></div>
        <p className="sec-lede">
          The bills, orders, and rules with the most public positions. Each name links to its source.
        </p>
        {stances.map((t: any) => (
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
                      <ul>{who.map((a: any) => (
                        <li key={a.id}><Named node={a}><Link href={`/node/${a.id}`}>{a.name}</Link></Named>
                          <a className="stance-src" href={a.url} target="_blank" rel="noreferrer" title={sourceName(a.url)} aria-label={`Source: ${sourceName(a.url)}`}>
                            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M3 1.5h5.5V7M8.5 1.5 1.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
                          </a></li>
                      ))}</ul>
                    </div>
                  ))}
                </div>
              );
            })()}
          </article>
        ))}
        <p className="more"><Link href="/targets">Every bill, rule, and race</Link></p>
      </section>

      <section id="trend" className="home-sec">
        <div className="sec-head"><h2>How has that changed?</h2><CiteButton kind="page" title="How has that changed?" path="/#trend" asOf={asOf} /></div>
        <p className="sec-lede">
          Public positions on bills and rules, by year. Later years have more coverage.
        </p>
        <div className="legend-row">
          <span><i className="sw sw-support" aria-hidden /> Supported</span>
          <span><i className="sw sw-mixed" aria-hidden /> Mixed or conditional</span>
          <span><i className="sw sw-oppose" aria-hidden /> Opposed</span>
        </div>
        <TrendChart label="Public positions on bills and rules, by year" years={byYear} current={Number(today.slice(0, 4))} />
      </section>

      <section id="words" className="home-sec">
        <div className="sec-head"><h2>What are they saying?</h2><CiteButton kind="page" title="What are they saying?" path="/#words" asOf={asOf} /></div>
        <p className="sec-lede">The latest public statements, word for word.</p>
        <ul className="record">{quotes.map((f: any) => (
          <li key={f.id}><div className="when">{fmtDate(f.date)}</div>
            <div><p className="q">“{f.excerpt}”<Src url={f.url} archive={f.archive_url} /> <CiteButton small kind="quote" speaker={f.name} quote={f.excerpt} date={fmtDate(f.date)} url={f.url} archive={f.archive_url} outlet={sourceName(f.url)} /></p>
              <p className="note"><Link href={`/node/${f.node_id}`}>{f.name}</Link>{f.target_name && <> · on {f.target_id ? <Link href={`/node/${f.target_id}`}>{f.target_name}</Link> : f.target_name}</>}</p></div></li>
        ))}</ul>
        <p className="more"><Link href="/search">Search every statement</Link></p>
      </section>

      <section id="map" className="home-sec">
        <div className="sec-head"><h2>How is it all connected?</h2><CiteButton kind="page" title="How is it all connected?" path="/#map" asOf={asOf} /></div>
        <p className="sec-lede">
          Who funds whom, and the elections, bills, and rules it reaches.
        </p>
        <p className="more"><Link href="/map">Open the network</Link></p>
      </section>
      </div>
    </div>
  );
}
