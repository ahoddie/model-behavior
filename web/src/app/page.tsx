import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getHome, getAnalysis, getLobbyingByIssue } from "@/lib/data";
import StanceBar from "@/components/StanceBar";
import { fmtMoney, fmtDate, TYPE_LABEL } from "@/lib/format";
import Src from "@/components/Src";
import Skyline from "@/components/Skyline";
import SectionNav from "@/components/SectionNav";
import CiteButton from "@/components/CiteButton";
import { sourceName } from "@/lib/format";

const SECTIONS = [
  { id: "money", label: "Where the money goes", title: "Where is the money going?" },
  { id: "issues", label: "What they care about", title: "What do they care about?" },
  { id: "stances", label: "Where they stand", title: "Where do they stand?" },
  { id: "trend", label: "How it has changed", title: "How has that changed?" },
  { id: "words", label: "What they say", title: "What are they saying?" },
  { id: "map", label: "How it connects", title: "How is it all connected?" },
];

const SIDES = [["support", "Supported"], ["mixed", "Mixed or conditional"], ["oppose", "Opposed"]] as const;
const sideOf = (s: string) => (s === "support" ? "support" : s === "oppose" ? "oppose" : "mixed");

export default async function Home(props: PageProps<"/">) {
  await connection();
  const sp = await props.searchParams;
  // Old links to the map (/?focus=…, /?view=time) still work.
  if (typeof sp.focus === "string" || sp.view === "time") redirect(`/map?${new URLSearchParams(sp as Record<string, string>)}`);
  const [{ counts, givers, recipients, stances, byYear, quotes }, analysis, lobbying] = await Promise.all([getHome(), getAnalysis(), getLobbyingByIssue()]);
  const asOf = fmtDate(new Date().toISOString().slice(0, 10));
  const maxGive = Math.max(1, ...givers.map((g: any) => g.total));
  const maxGet = Math.max(1, ...recipients.map((g: any) => g.total));
  const maxYear = Math.max(1, ...byYear.map((y: any) => y.support + y.mixed + y.oppose));

  return (
    <div className="home">
      <SectionNav items={SECTIONS} />
      <div className="home-main">

      <header className="home-intro">
        <h1 className="home-title">How Silicon Valley shapes AI <span className="title-last">policy<Skyline className="skyline" /></span></h1>
        <p className="lede">
          Frontier labs, their founders and investors, and the funders and think tanks around them are spending money and taking public positions on
          AI governance in the United States. <Link href="/map">See the whole taxonomy here.</Link>
        </p>
      </header>

      <section id="money" className="home-sec">
        <div className="sec-head"><h2>Where is the money going?</h2><CiteButton kind="page" title="Where is the money going?" path="/#money" asOf={asOf} /></div>
        <p className="sec-lede">
          Political money given directly by the labs, people, investors and funders tracked here: contributions to candidates, PACs and parties, and
          grants to advocacy groups. That comes to {fmtMoney(counts.direct)} on record so far. Money that a PAC passes on is not counted again.
          Lobbying is reported separately, in {counts.filings.toLocaleString()} filings.
        </p>
        <div className="grid2">
          <div>
            <h3>Who gave</h3>
            <ol className="bars">{givers.map((g: any) => (
              <li key={g.id}>
                <div className="bar-label"><Link href={`/node/${g.id}`}>{g.name}</Link><span>{fmtMoney(g.total)}</span></div>
                <div className="bar" style={{ width: `${(g.total / maxGive) * 100}%` }} aria-hidden />
                <div className="bar-note">{TYPE_LABEL[g.type]} · {g.recipients} {g.recipients === 1 ? "recipient" : "recipients"}</div>
              </li>
            ))}</ol>
          </div>
          <div>
            <h3>Who received it</h3>
            <ol className="bars">{recipients.map((r: any) => (
              <li key={r.id}>
                <div className="bar-label"><Link href={`/node/${r.id}`}>{r.name}</Link><span>{fmtMoney(r.total)}</span></div>
                <div className="bar" style={{ width: `${(r.total / maxGet) * 100}%` }} aria-hidden />
                <div className="bar-note">From {r.top_givers}{r.givers > 3 ? ` and ${r.givers - 3} more` : ""}</div>
              </li>
            ))}</ol>
          </div>
        </div>
        <p className="more"><Link href="/money">Trace any giver&apos;s money step by step</Link></p>
      </section>

      {analysis && <section id="issues" className="home-sec">
        <div className="sec-head"><h2>What do they care about?</h2><CiteButton kind="page" title="What do they care about?" path="/#issues" asOf={asOf} /></div>
        <p className="sec-lede">
          An open-source model running on our own machine read {analysis.meta.used.toLocaleString()} quotes in which an actor states their own view, and
          noted which policy issues each one addresses. Each issue is written as a plain statement, and the model judged whether the quote agrees or
          disagrees with it. The bar runs from disagrees strongly (−2) to agrees strongly (+2). The money line splits each gift by what its recipient talks about. These are machine labels, not
          findings; open any issue to read the quotes behind it. <Link href="/data?view=methodology#analysis">How this works</Link>.
        </p>
        <ul className="issues">{analysis.issues.filter((i) => i.statements > 0).map((i) => (
          <li key={i.id}>
            <div className="iss-head">
              <h3>{i.label}</h3>
              <StanceBar value={i.avg} />
            </div>
            <p className="note">Statement: “{i.positive}”</p>
            <p className="iss-facts">
              {i.statements} {i.statements === 1 ? "statement" : "statements"} from {i.actors} {i.actors === 1 ? "actor" : "actors"}: {i.plus} agree, {i.minus} disagree, {i.neutral} mention it without taking a side.
              {i.money > 0 && <> {fmtMoney(i.money)} went to groups that speak on it, for or against, most from {i.money_givers.map((g, k) => <span key={g.id}>{k > 0 && (k === i.money_givers.length - 1 ? " and " : ", ")}<Link href={`/node/${g.id}`}>{g.name}</Link></span>)}.</>}
              {lobbying[i.id] && <> {lobbying[i.id].filings.toLocaleString()} lobbying {lobbying[i.id].filings === 1 ? "filing" : "filings"} from {lobbying[i.id].actors} {lobbying[i.id].actors === 1 ? "actor" : "actors"} touch this issue.</>}
            </p>
          </li>
        ))}</ul>
        <p className="note">
          {fmtMoney(analysis.cover.assigned)} of {fmtMoney(analysis.cover.total)} in direct giving went to recipients with enough public statements to place by issue.
          The rest went mostly to candidates and party committees, whose own positions this site doesn&apos;t track.
        </p>
      </section>}

      <section id="stances" className="home-sec">
        <div className="sec-head"><h2>Where do they stand?</h2><CiteButton kind="page" title="Where do they stand?" path="/#stances" asOf={asOf} /></div>
        <p className="sec-lede">
          The bills, executive orders and rules with the most public positions for and against from the actors tracked here. Each name shows that actor&apos;s latest stated position and links to
          where they said it. A conditional position means support only if the bill is changed, or support for parts of it.
        </p>
        {stances.map((t: any) => (
          <article key={t.id} className="stance">
            <h3><Link href={`/node/${t.id}`}>{t.name}</Link></h3>
            {t.descriptor && <p className="note">{t.descriptor}</p>}
            <div className="stance-cols">
              {SIDES.map(([side, label]) => {
                const who = t.actors.filter((a: any) => sideOf(a.stance) === side);
                return (
                  <div key={side}>
                    <h4>{label} <span className="muted">({who.length})</span></h4>
                    {who.length === 0 ? <p className="muted">None on record</p> : (
                      <ul>{who.map((a: any) => <li key={a.id}><Link href={`/node/${a.id}`}>{a.name}</Link><Src url={a.url} /></li>)}</ul>
                    )}
                  </div>
                );
              })}
            </div>
          </article>
        ))}
        <p className="more"><Link href="/targets">Every bill, rule and race</Link></p>
      </section>

      <section id="trend" className="home-sec">
        <div className="sec-head"><h2>How has that changed?</h2><CiteButton kind="page" title="How has that changed?" path="/#trend" asOf={asOf} /></div>
        <p className="sec-lede">
          Public positions on bills and rules each year, counted across every actor and bill. This is a count of statements on record, not a measure of
          opinion: years with more coverage show more statements.
        </p>
        <div className="legend-row">
          <span><i className="sw sw-support" aria-hidden /> Supported</span>
          <span><i className="sw sw-mixed" aria-hidden /> Mixed or conditional</span>
          <span><i className="sw sw-oppose" aria-hidden /> Opposed</span>
        </div>
        <ul className="years">{byYear.map((y: any) => {
          const tot = y.support + y.mixed + y.oppose;
          return (
            <li key={y.y}>
              <span className="yr">{y.y}{y.y === new Date().getFullYear() && <span className="muted" style={{ fontWeight: 400 }}>, so far</span>}</span>
              <span className="stack" style={{ width: `${(tot / maxYear) * 100}%` }} aria-hidden>
                <i className="sw-support" style={{ flex: y.support }} /><i className="sw-mixed" style={{ flex: y.mixed }} /><i className="sw-oppose" style={{ flex: y.oppose }} />
              </span>
              <span className="yr-n">{y.support} supported, {y.mixed} mixed, {y.oppose} opposed</span>
            </li>
          );
        })}</ul>
      </section>

      <section id="words" className="home-sec">
        <div className="sec-head"><h2>What are they saying?</h2><CiteButton kind="page" title="What are they saying?" path="/#words" asOf={asOf} /></div>
        <p className="sec-lede">The most recent public statements on record, quoted word for word.</p>
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
          The map puts every actor, the groups their money and positions pass through, and the elections, bills and rules it reaches side by side. Use
          Overall to see everything at once, or Timeline to watch it build month by month.
        </p>
        <p className="more"><Link href="/map">Open the map</Link></p>
      </section>
      </div>
    </div>
  );
}
