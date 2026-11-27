import { Suspense } from "react";
import { sourceName } from "@/lib/format";
import Link from "@/components/Link";
import { notFound, permanentRedirect } from "next/navigation";
import { getProfile, getTarget, getNodeSummary, getCoverage, getActorIssues, getActorLobbyingIssues, getMergedInto, allNodeIds, TARGET_TYPES } from "@/lib/data";
import StanceBar from "@/components/StanceBar";
import CoverageLine from "@/components/CoverageLine";
import { fmtMoney, fmtDate, TYPE_LABEL, clusterName } from "@/lib/format";
import TargetView from "@/components/TargetView";
import ProfileHead, { ProfileSources, type SourceLine } from "@/components/ProfileHead";
import { linkCaption } from "@/components/MapIt";
import { ItemRail, ItemBar, type RailProps } from "@/components/ItemRail";
import { getProfileText } from "@/lib/profile-text";
import Src from "@/components/Src";
import KnownRecord from "@/components/KnownRecord";
import ProfileTabs, { TabLink } from "@/components/ProfileTabs";

const TABS = [["record", "Record"], ["feed", "All statements"], ["positions", "Positions table"], ["money", "Filings"], ["people", "People"], ["connections", "Connections"]] as const;

// Positions read as plain sentences in the past tense, dated, so an old stance never reads as a current one.
const STANCE_VERB: Record<string, string> = { support: "Supported", oppose: "Opposed", support_if_amended: "Supported, if amended,", neutral: "Took a neutral position on" };
const verb = (s?: string | null) => (s && STANCE_VERB[s]) || (s ? `Position (${s.replace(/_/g, " ")}) on` : "Position on");
const action = (l: any) => (l.stance ? verb(l.stance) : l.subtype ? `${cap(l.subtype)} on` : "Position on");
const dollars = (n: number | null) => (n == null ? "an amount not listed" : `$${Math.round(Number(n)).toLocaleString("en-US")}`);
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1).replace(/_/g, " ");
const byDate = (a: any, b: any) => String(b.date ?? "").localeCompare(String(a.date ?? ""));

const ANSWER_WORDS = ["disagrees strongly", "disagrees", "mentions it without taking a side", "agrees", "agrees strongly"];

// The build prebuilds only the two dozen best-connected profiles, so it takes seconds. Every other profile is built the
// first time it is asked for, by a reader or by the background refresh (lib/warm) that runs when the site starts on a new
// build, and Next keeps it on disk from then on (.next/server/route-cache), so it survives restarts.
export async function generateStaticParams() {
  return (await allNodeIds()).slice(0, 24).map((id) => ({ id }));
}

const loadActor = (id: string) => Promise.all([getProfile(id), getActorIssues(id), getActorLobbyingIssues(id)]);

// Only the statements filter waits for the URL; tabs switch in the browser (components/ProfileTabs). Awaited here, outside the boundary, the profile's cached reads are stored
// with the prebuilt page; the same calls inside the boundary are answered from that copy, so no tab or filter runs a query.
export default async function NodePage(props: PageProps<"/node/[id]">) {
  const { id } = await props.params;
  const summary = await getNodeSummary(id);
  if (!summary) { const to = await getMergedInto(id); if (to) permanentRedirect(`/node/${encodeURIComponent(to)}`); notFound(); }
  if (TARGET_TYPES.includes(summary.node.type)) {
    const [t, coverage, text] = await Promise.all([getTarget(id), getCoverage(id), getProfileText(id)]);
    const head = t!;
    const empty = !head.keyFacts.length && !head.facts.length && !head.pushes.length && !head.statements.length && !head.candidates.length;
    return <>
      <TargetView t={head} coverage={coverage} text={text} />
      {empty && <div className="page"><KnownRecord node={head.node} /></div>}
    </>;
  }

  const [[pr, , lobbyIssues], coverage, text] = await Promise.all([loadActor(id), getCoverage(id), getProfileText(id)]);
  const p = pr!;
  const noRecords = !p.keyFacts.length && !p.facts.length && !p.feed.length && !p.filings.length && !p.links.length && !lobbyIssues.length;

  // The written headline and description when there is one (table profile_text); until then the descriptor and the first
  // few sourced notes stand in, as one paragraph with the same links.
  const notes = p.facts.slice(0, 3);
  const headline = text ? { text: text.headline } : { text: p.node.descriptor ?? "", parts: p.descriptorParts };
  const description = text ? { text: text.description, parts: text.parts }
    : notes.length ? { text: notes.map((f) => f.text).join(" "), parts: notes.flatMap((f, i) => [...(i ? [{ t: " " }] : []), ...f.parts]) } : null;
  const sources: SourceLine[] = [
    ...(text ? text.sources.map((x) => ({ ...x, lead: true })) : [
      ...(p.node.descriptor ? [{ label: "Summary", name: sourceName(p.node.source_url), url: p.node.source_url }] : []),
      ...notes.map((f) => ({ label: "Background", name: sourceName(f.url), url: f.url })),
    ]),
    ...p.keyFacts.filter((f) => f.label !== "Website").map((f) => ({ label: f.label, name: sourceName(f.url), url: f.url })),
  ];
  const counts = { money: 0, position: 0, person: 0, idea: 0 } as Record<string, number>;
  for (const l of p.links) counts[l.type] = (counts[l.type] ?? 0) + 1;
  const caption = linkCaption(p.links.map((l: any) => ({ id: l.other_id, type: l.other_type })));

  const rail: RailProps = {
    sections: [{ id: "overview", label: "Overview" }, { id: "record", label: "Record" }, ...(sources.length ? [{ id: "sources", label: "Sources" }] : [])],
    back: { fallback: "/map", label: "Network" },
    map: { id, name: p.node.name, counts, caption },
    cite: { title: p.node.name, path: `/node/${id}` },
  };

  return (
    <div className="item-page actor-page">
      <ItemRail {...rail} />
      <article className="item-main">
        <ItemBar {...rail} />
        <div id="overview" className="item-sec" tabIndex={-1}>
          <ProfileHead node={p.node} keyFacts={p.keyFacts} logoSource={p.node.logo_source_url}
            kicker={<>{TYPE_LABEL[p.node.type]} · <Link href={`/map?focus=${id}`}>{clusterName(p.node.cluster)}</Link></>}
            headline={headline} description={description} />
        </div>
        {noRecords && <KnownRecord node={p.node} />}
        <div id="record" className="item-sec" tabIndex={-1}>
          <Suspense fallback={<p className="mono muted" role="status">Loading the record…</p>}>
            <Tabs sp={props.searchParams} id={id} />
          </Suspense>
        </div>
        <ProfileSources sources={sources} />
        <CoverageLine c={coverage} />
      </article>
    </div>
  );
}

async function Tabs({ sp: spP, id }: { sp: PageProps<"/node/[id]">["searchParams"]; id: string }) {
  const sp = await spP;
  const [pr, actorIssues, lobbyIssues] = await loadActor(id);
  const p = pr!;
  const kind = typeof sp.kind === "string" ? sp.kind : "";
  const issue = typeof sp.issue === "string" ? sp.issue : "";
  const feed = p.feed.filter((f: any) => (!kind || f.kind === kind) && (!issue || f.issues.includes(issue)));
  const kinds = [...new Set(p.feed.map((f: any) => f.kind))] as string[];
  const issues = [...new Set(p.feed.flatMap((f: any) => f.issues))] as string[];
  const personLinks = p.links.filter((l: any) => l.type === "person");
  const positionLinks = p.links.filter((l: any) => l.type === "position");
  const stanceFeed = p.feed.filter((f: any) => f.stance);
  const href = (t: string, extra = "") => `/node/${id}?tab=${t}${extra}`;

  const panels = {
    record: (() => {
        // Quotes are the actor's own words; reporting about a donation or a policy page is left to the full list.
        const quotes = p.feed.filter((f: any) => f.excerpt && !["donation", "policy change", "filing"].includes(f.kind)).sort(byDate);
        const positions = positionLinks.map((l: any) => ({ ...l, date: l.date_start })).sort(byDate);
        // Lobbying contacts are listed under Filings, not as political money.
        const money = p.links.filter((l: any) => l.type === "money" && l.subtype !== "lobbying").map((l: any) => ({ ...l, date: l.date_start })).sort(byDate);
        return <>
          {!quotes.length && !positions.length && !money.length && !lobbyIssues.length && <p className="muted">No quotes, positions or political money on record yet. See <TabLink href={href("connections")}>connections</TabLink>.</p>}
          {quotes.length > 0 && <section>
            <h2>In {p.node.name}&apos;s words</h2>
            <ul className="record">{quotes.slice(0, 8).map((f: any) => (
              <li key={f.id}><div className="when">{fmtDate(f.date) || "Undated"}</div>
                <div><p className="q">“{f.excerpt}”<Src url={f.url} archive={f.archive_url} /></p>
                  {f.target_name && <p className="note">On {f.target_id ? <Link href={`/node/${f.target_id}`}>{f.target_name}</Link> : f.target_name}</p>}</div></li>
            ))}</ul>
            {quotes.length > 8 && <p className="more"><TabLink href={href("feed")}>All {p.feed.length} statements</TabLink></p>}
          </section>}
          {actorIssues.length > 0 && <section>
            <h2>Issues they speak on</h2>
            <p className="note"><Link href="/data?view=methodology#analysis">How this works</Link></p>
            <ul className="issues">{actorIssues.map((i: any) => (
              <li key={i.id}>
                <details>
                  <summary className="iss-head"><h3>{i.positive} <span className="muted">({i.n})</span></h3><StanceBar value={i.avg} /></summary>
                  <ul className="record">{i.items.map((it: any) => (
                    <li key={it.feed_id}><div className="when">{fmtDate(it.date)}</div>
                      <div><p>“{it.excerpt}”<Src url={it.url} /></p><p className="note">Model&apos;s reading: {ANSWER_WORDS[it.v + 2]}. {it.reason}</p></div></li>
                  ))}</ul>
                </details>
              </li>
            ))}</ul>
          </section>}
          {lobbyIssues.length > 0 && <section>
            <h2>Lobbying by issue</h2>
            <p className="note">Read the issues named in {p.node.name}&apos;s federal lobbying reports and grants in the filed words as topics rather than positions with amounts given per filing, or see <TabLink href={href("money")}>all filings</TabLink>.</p>
            <ul className="lobby-issues">{lobbyIssues.map((i) => (
              <li key={i.id}>
                <details>
                  <summary><h3>{i.label}</h3> <span className="muted">{[i.n > 0 && `${i.n} ${i.n === 1 ? "filing" : "filings"}`, i.grants.length > 0 && `${i.grants.length} ${i.grants.length === 1 ? "grant" : "grants"}`].filter(Boolean).join(", ")}</span></summary>
                  {i.filings.length > 0 && <ul className="record lobby-filings">{i.filings.map((f) => (
                    <li key={f.id}><div className="when">{f.period ?? (fmtDate(f.filed) || "Undated")}</div>
                      <div>{f.items.length ? <ul className="lobby-items">{f.items.map((t, k) => <li key={k}>{t}</li>)}</ul> : <p className="muted">No issue text on the filing.</p>}
                        <p className="note">{[f.firm && `Via ${f.firm}`, f.amount != null && fmtMoney(f.amount)].filter(Boolean).join(" · ")} <Src url={f.url} archive={f.archive_url} /></p></div></li>
                  ))}</ul>}
                  {i.grants.length > 0 && <ul className="record">{i.grants.map((g) => (
                    <li key={g.id}><div className="when">{fmtDate(g.date) || "Undated"}</div>
                      <div><p>{g.dir === "out" ? "Grant to" : "Grant from"} <Link href={`/node/${g.other_id}`}>{g.other_name}</Link>.<Src url={g.url} /></p></div></li>
                  ))}</ul>}
                </details>
              </li>
            ))}</ul>
          </section>}
          {positions.length > 0 && <section>
            <h2>Positions on bills and rules</h2>
            <ul className="record">{positions.map((l: any) => (
              <li key={l.id}><div className="when">{fmtDate(l.date) || "Undated"}</div>
                <div><p>{action(l)} <Link href={`/node/${l.other_id}`}>{l.other_name}</Link>.<Src url={l.source_url} /></p>
                  {l.note && <p className="note">{l.note}</p>}</div></li>
            ))}</ul>
          </section>}
          {money.length > 0 && <section>
            <h2>Political money</h2>
            <ul className="record">{money.map((l: any) => (
              <li key={l.id}><div className="when">{fmtDate(l.date) || "Undated"}</div>
                <div><p>{l.dir === "out"
                  ? <>{l.subtype ? cap(l.subtype) : "Payment"} of {dollars(l.amount)} to <Link href={`/node/${l.other_id}`}>{l.other_name}</Link>.</>
                  : <>Received {dollars(l.amount)} from <Link href={`/node/${l.other_id}`}>{l.other_name}</Link>.</>}<Src url={l.source_url} /></p>
                  {l.recommended_by && <p className="note">Recommended by <Link href={`/node/${l.recommended_by.id}`}>{l.recommended_by.name}</Link>.<Src url={l.recommended_by.source_url} /></p>}
                  {l.note && <p className="note">{l.note}</p>}</div></li>
            ))}</ul>
          </section>}
          {p.recommended.length > 0 && <section>
            <h2>Grants it recommended</h2>
            <p className="note">See the grants {p.node.name} recommended and another funder paid, each counted once under the funder that paid and kept out of {p.node.name}&apos;s totals.</p>
            <ul className="record">{p.recommended.map((r: any) => (
              <li key={r.id}><div className="when">{fmtDate(r.date_start) || "Undated"}</div>
                <div><p>Recommended {dollars(r.amount)} to <Link href={`/node/${r.other_id}`}>{r.other_name}</Link>, paid by <Link href={`/node/${r.payer_id}`}>{r.payer_name}</Link>.<Src url={r.source_url} /></p>
                  {r.note && <p className="note">{r.note}</p>}</div></li>
            ))}</ul>
          </section>}
        </>;
    })(),

    feed: <>
        <div className="filters">
          <span>Type:</span> <Link href={href("feed", issue ? `&issue=${encodeURIComponent(issue)}` : "")} scroll={false} aria-current={!kind ? "page" : undefined}>all</Link>
          {kinds.map((k) => <Link key={k} href={href("feed", `&kind=${encodeURIComponent(k)}${issue ? `&issue=${encodeURIComponent(issue)}` : ""}`)} scroll={false} aria-current={kind === k ? "page" : undefined}>{k}</Link>)}
          {issues.length > 0 && <><span>Issue:</span>{issues.map((i) => <Link key={i} href={href("feed", `&issue=${encodeURIComponent(i)}${kind ? `&kind=${encodeURIComponent(kind)}` : ""}`)} scroll={false} aria-current={issue === i ? "page" : undefined}>{i}</Link>)}</>}
        </div>
        {feed.length === 0 ? <p className="muted">Nothing on record here yet.</p> : (
          <ul className="feed">{feed.map((f: any) => (
            <li key={f.id}>
              <div className="when">{fmtDate(f.date)}<br /><span className="tag">{f.kind}</span></div>
              <div>
                {f.excerpt ? <blockquote>“{f.excerpt}” <Src url={f.url} archive={f.archive_url} /></blockquote> : <p style={{ margin: 0 }}>{f.summary} <Src url={f.url} archive={f.archive_url} /></p>}
                <p className="mono muted" style={{ margin: "4px 0 0" }}>
                  {[f.platform, f.stance && `${f.stance}${f.target_name ? ` · ${f.target_name}` : ""}`, ...f.issues].filter(Boolean).join(" · ")}
                </p>
              </div>
            </li>
          ))}</ul>
        )}
      </>,

    positions: <>
        {positionLinks.length === 0 && stanceFeed.length === 0 ? <p className="muted">No sourced positions on bills or rules yet.</p> : (
          <table className="data-table"><thead><tr><th>Date</th><th>On</th><th>Stance</th><th>Evidence</th></tr></thead><tbody>
            {[...positionLinks.map((l: any) => ({ date: l.date_start, target: l.other_name, tid: l.other_id, stance: l.stance ?? l.subtype, text: l.note ?? l.subtype, url: l.source_url })),
              ...stanceFeed.map((f: any) => ({ date: f.date, target: f.target_name ?? f.issues.join(", "), tid: f.target_id, stance: f.stance, text: f.excerpt ? `“${f.excerpt}”` : f.summary, url: f.url }))]
              .sort((a, b) => String(a.target).localeCompare(String(b.target)) || String(b.date).localeCompare(String(a.date)))
              .map((r, i) => (
                <tr key={i}><td className="mono">{fmtDate(r.date) || "undated"}</td>
                  <td>{r.tid ? <Link href={`/node/${r.tid}`}>{r.target}</Link> : r.target}</td>
                  <td>{String(r.stance ?? "").replace(/_/g, " ")}</td><td>{r.text} <Src url={r.url} /></td></tr>
              ))}
          </tbody></table>
        )}
        <p className="muted">Grouped by subject, newest first, so a change in stance sits above the old one.</p>
      </>,

    money: (p.filings.length === 0 ? <p className="muted">No filings on record yet.</p> : (
        <table className="data-table"><thead><tr><th>Filed</th><th>Type</th><th>Period</th><th className="num">Amount</th><th>Issues</th><th>Detail</th><th>Source</th></tr></thead><tbody>
          {p.filings.map((f: any) => (
            <tr key={f.id}><td className="mono">{fmtDate(f.filed_date) || "–"}</td><td>{f.filing_type}</td><td className="mono">{f.period}</td>
              <td className="num">{fmtMoney(f.amount)}</td><td className="mono">{f.issues.join(" ")}</td><td>{f.description?.slice(0, 220)}</td><td><Src url={f.url} archive={f.archive_url} /></td></tr>
          ))}
        </tbody></table>
      )),

    people: (personLinks.length === 0 ? <p className="muted">No sourced roles yet.</p> : (
        <table className="data-table"><thead><tr><th>Person / org</th><th>Role</th><th>When</th><th>Detail</th></tr></thead><tbody>
          {personLinks.map((l: any) => (
            <tr key={l.id}><td><Link href={`/node/${l.other_id}`}>{l.other_name}</Link></td><td>{l.subtype}</td>
              <td className="mono">{[fmtDate(l.date_start), l.date_end ? fmtDate(l.date_end) : l.date_start && !["revolving door", "former staff"].includes(l.subtype) ? "now" : ""].filter(Boolean).join(" – ") || "–"}</td>
              <td>{l.note} <Src url={l.source_url} /></td></tr>
          ))}
        </tbody></table>
      )),

    connections: ["money", "person", "idea", "position"].map((t) => {
        const ls = p.links.filter((l: any) => l.type === t);
        if (!ls.length) return null;
        return (
          <section key={t}>
            <h3>{({ money: "Money", person: "People and roles", idea: "Ideas", position: "Positions" } as Record<string, string>)[t]} ({ls.length})</h3>
            <table className="data-table"><tbody>
              {ls.map((l: any) => (
                <tr key={l.id}><td className="mono">{l.dir === "out" ? "→" : "←"}</td><td><Link href={`/node/${l.other_id}`}>{l.other_name}</Link> <Link href={`/map?focus=${l.other_id}`} className="mono">map</Link></td>
                  <td>{l.subtype}{l.stance ? ` · ${l.stance}` : ""}</td><td className="num">{fmtMoney(l.amount)}</td><td className="mono">{fmtDate(l.date_start)}</td><td>{l.recommended_by ? <>Recommended by <Link href={`/node/${l.recommended_by.id}`}>{l.recommended_by.name}</Link>. </> : null}{l.note} <Src url={l.source_url} /></td></tr>
              ))}
            </tbody></table>
          </section>
        );
      }),
  };
  const tabs = TABS.map(([t, label]) => [t, label] as [string, string]);
  const search = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string")).toString();
  return <ProfileTabs base={`/node/${id}`} search={search ? `?${search}` : ""} tabs={tabs} panels={panels} />;
}
