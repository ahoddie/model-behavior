// A bill's page, as docs/bill-page-spec.md lays it out (the "fact sheet"): a sticky rail, then Overview (number, title,
// status stamp, headline, description, facts), Trajectory, Positions (groups by side, as cards), People, and one numbered
// list of sources. The small grey numbers in the page are its only citation marks. A block with no data is left out.
import Link from "@/components/Link";
import { Mark } from "./ProfileHead";
import Linked from "./Linked";
import SrcNum from "./SrcNum";
import { ItemRail, ItemBar, type RailProps } from "./ItemRail";
import { linkCaption } from "./MapIt";
import { actorSpending, nodeCards, billAuthor } from "@/lib/data";
import { getProfileText } from "@/lib/profile-text";
import { billStops } from "@/lib/bill-stops";
import { fmtMoney, sourceName, STAGE_LABEL } from "@/lib/format";
import type { Part } from "@/lib/linkify";

type Group = "leg" | "pos" | "ppl";
const GROUPS: [Group, string][] = [["leg", "Legislative record"], ["pos", "Group positions and statements"], ["ppl", "Individuals"]];

// Sources numbered in order of first use. The page reads top to bottom in the same order as the groups, so numbering by
// first use also keeps each group's numbers together.
class Cites {
  list: { n: number; url: string; title: string; group: Group }[] = [];
  private byUrl = new Map<string, number>();
  add(url: string | null | undefined, title: string, group: Group): number | null {
    if (!url) return null;
    const have = this.byUrl.get(url);
    if (have) return have;
    const n = this.list.length + 1;
    this.list.push({ n, url, title, group });
    this.byUrl.set(url, n);
    return n;
  }
}
const Num = ({ n }: { n: number | null }) => (n ? <SrcNum n={n} /> : null);

const MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Feb. 7, 2024" for the facts; "May 21" (with the year when it isn't the bill's year) on cards and the track.
const longDate = (d: string | null | undefined) => {
  const m = d?.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  return m ? (m[3] ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : `${MONTHS[+m[2] - 1]} ${m[1]}`) : d ?? "";
};
const shortDate = (d: string | null | undefined, year?: string) => {
  const m = d?.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return "";
  if (!m[2]) return m[1];
  const md = m[3] ? `${SHORT[+m[2] - 1]} ${+m[3]}` : SHORT[+m[2] - 1];
  return m[1] === year ? md : `${md}, ${m[1]}`;
};

const session = (s: string, jurisdiction: string, level: string) => {
  const two = s.match(/^(\d{4})-?(\d{4})$/);
  if (two) return `${two[1]}–${two[2].slice(2)} ${jurisdiction} Legislature`;
  if (level === "federal" && /^\d+$/.test(s)) { const n = +s; const sfx = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"; return `${n}${sfx} Congress`; }
  return `${s} ${level === "federal" ? "Congress" : `${jurisdiction} Legislature`}`;
};

// What a position entry says, in a word or two, and which of the three groups it falls in.
const SPONSOR = /co-?source|co-?sponsor|\bsponsor/i;
function positionLabel(stance: string | null, note: string | null): string | null {
  const n = note ?? "";
  if (/unless amended/i.test(n)) return "Oppose unless amended";
  if (/concerns/i.test(n) && stance !== "support") return "Concerns";
  switch (stance) {
    case "support": return "Support";
    case "support_if_amended": return "Support if amended";
    case "oppose": return "Oppose";
    case "neutral": return "Neutral";
    case "mixed": return "Mixed";
    default: return null;
  }
}
type Side = "support" | "conditional" | "oppose";
const sideOf = (label: string): Side => (label === "Support" ? "support" : label === "Oppose" ? "oppose" : "conditional");
const SIDE_LABEL: Record<Side, string> = { support: "Support", conditional: "Conditional", oppose: "Oppose" };

type Entry = { date: string | null; label: string; note: string | null; url: string | null; sponsor: boolean; kind: string };
type Say = { text: string; quote: boolean; url: string; date: string | null; kind: string };
type Actor = { id: string; entries: Entry[]; says: Say[] };

function collect(t: any): Map<string, Actor> {
  const actors = new Map<string, Actor>();
  const get = (id: string) => { let a = actors.get(id); if (!a) actors.set(id, (a = { id, entries: [], says: [] })); return a; };
  for (const p of t.pushes) {
    if (p.type !== "position") continue;
    const label = positionLabel(p.stance, p.note);
    if (!label) continue;
    get(p.actor_id).entries.push({ date: p.date_start, label, note: p.note, url: p.source_url, sponsor: SPONSOR.test(p.note ?? "") && p.stance === "support", kind: p.subtype ?? "position" });
  }
  for (const s of t.statements) {
    const a = get(s.node_id);
    const label = positionLabel(s.stance, null);
    if (label) a.entries.push({ date: s.date, label, note: null, url: s.url, sponsor: false, kind: s.kind ?? "statement" });
    // An excerpt that names the actor itself is a document about them (a committee list), not their words.
    const own = s.excerpt && !s.excerpt.toLowerCase().includes(String(s.actor_name ?? "").split(/[\s(]/)[0].toLowerCase());
    if (s.excerpt && own) a.says.push({ text: s.excerpt, quote: true, url: s.url, date: s.date, kind: s.kind ?? "statement" });
    else if (s.summary) a.says.push({ text: s.summary, quote: false, url: s.url, date: s.date, kind: s.kind ?? "statement" });
  }
  for (const [id, a] of actors) if (!a.entries.length) actors.delete(id);
  const newest = (x: { date: string | null }, y: { date: string | null }) => String(y.date ?? "").localeCompare(String(x.date ?? ""));
  for (const a of actors.values()) { a.entries.sort(newest); a.says.sort((x, y) => Number(y.quote) - Number(x.quote) || newest(x, y)); }
  return actors;
}

export default async function BillView({ t }: { t: any }) {
  const n = t.node;
  const bill = t.bill;
  const year = (bill?.introduced_date ?? n.first_date ?? "").slice(0, 4);
  const actors = collect(t);
  const [text, cards, author] = await Promise.all([getProfileText(n.id), nodeCards([...actors.keys()]), billAuthor(bill?.sponsor ?? null)]);
  const isPerson = (id: string) => ["person", "lawmaker"].includes(cards[id]?.type ?? "");
  const orgIds = [...actors.keys()].filter((id) => cards[id] && !isPerson(id));
  const personIds = [...actors.keys()].filter((id) => cards[id] && isPerson(id) && id !== author?.id);
  const spend = await actorSpending(orgIds);
  const cites = new Cites();

  // Overview
  const number = bill?.identifier ?? n.name;
  const title = bill?.title ?? n.descriptor ?? "";
  const stage = bill?.stage ?? null;
  const notes = (t.facts ?? []).slice(0, 3) as { text: string; url: string; parts: Part[] }[];
  const headline = text ? { text: text.headline } : n.descriptor && n.descriptor !== title ? { text: n.descriptor, parts: t.descriptorParts } : null;
  const description = text ? { text: text.description, parts: text.parts }
    : notes.length ? { text: notes.map((f) => f.text).join(" "), parts: notes.flatMap((f, i) => [...(i ? [{ t: " " }] : []), ...f.parts]) } : null;
  const billNum = cites.add(bill?.source_url, `${number}: bill history, votes, and text (${bill ? sourceName(bill.source_url) : ""})`, "leg");
  const descNums = (text ? text.sources.map((s) => cites.add(s.url, `${s.label} (${s.name})`, "leg"))
    : [...(headline && !text ? [cites.add(n.source_url, `Summary (${sourceName(n.source_url)})`, "leg")] : []), ...notes.map((f) => cites.add(f.url, `${f.text.length > 70 ? `${f.text.slice(0, 70).replace(/\s+\S*$/, "")}…` : f.text} (${sourceName(f.url)})`, "leg"))]);
  const cosponsors = orgIds.filter((id) => actors.get(id)!.entries.some((e) => e.sponsor));
  // Days on which the bill was amended (in committee or on the floor); concurrence in the other house's amendments isn't one.
  const amended = bill ? new Set(bill.actions.filter((a: any) => /\bamended\b/i.test(a.text) && !/concurred/i.test(a.text)).map((a: any) => a.date)).size : 0;
  const facts: [string, React.ReactNode][] = [];
  if (bill) facts.push(["Bill", <>{bill.level === "federal" ? "U.S." : bill.jurisdiction_name} {bill.identifier}<Num n={billNum} /></>]);
  if (bill?.session) facts.push(["Session", session(bill.session, bill.jurisdiction_name, bill.level)]);
  if (bill?.sponsor) facts.push(["Author", author ? <Link href={`/node/${author.id}`}>{bill.sponsor.replace(/\s+\S+$/, "").trim() ? `${bill.sponsor.replace(/\s+\S+$/, "")} ${author.name}` : author.name}</Link> : bill.sponsor]);
  if (cosponsors.length) facts.push([cosponsors.length === 1 ? "Co-sponsor" : "Co-sponsors", cosponsors.map((id, i) => <span key={id}>{i ? ", " : ""}<Link href={`/node/${id}`}>{cards[id].name}</Link></span>)]);
  if (bill?.introduced_date) facts.push(["Introduced", longDate(bill.introduced_date)]);
  if (stage) facts.push(["Status", `${STAGE_LABEL[stage] ?? stage}${bill.stage_date ? `, ${longDate(bill.stage_date)}` : ""}`]);
  if (amended) facts.push(["Amended", amended === 1 ? "Once" : `${amended} times`]);
  if (bill?.source_url) facts.push(["Full text", <a key="text" className="ext" href={bill.source_url} target="_blank" rel="noreferrer">{(() => { try { return new URL(bill.source_url).hostname.replace(/^www\./, ""); } catch { return "Official page"; } })()}</a>]);

  // Trajectory
  const stops = bill ? billStops(bill) : [];
  const reached = stops.reduce((i, s, k) => (s.state === "pending" ? i : k), 0);

  // Positions
  const cardOf = (id: string) => {
    const a = actors.get(id)!, c = cards[id], latest = a.entries[0];
    // A co-sponsor is dated from its first listing as one.
    const sponsorFrom = latest.label === "Support" ? a.entries.filter((e) => e.sponsor).at(-1) : undefined;
    const label = sponsorFrom ? "Co-sponsor" : latest.label;
    const earlier = a.entries.find((e) => e.label !== latest.label && e.date !== latest.date);
    return { id, c, label, latest, date: sponsorFrom?.date ?? latest.date, side: sideOf(latest.label), earlier, say: a.says[0] as Say | undefined, sayNum: null as number | null, posNum: null as number | null };
  };
  // Numbers are given in reading order: support, conditional, then oppose cards, then people.
  const number_ = (o: ReturnType<typeof cardOf>, group: Group) => {
    if (o.say) o.sayNum = cites.add(o.say.url, `${o.c.name}: ${o.say.kind}${o.say.date ? `, ${longDate(o.say.date)}` : ""} (${sourceName(o.say.url)})`, group);
    else o.posNum = cites.add(o.latest.url, `${o.c.name}: ${o.latest.label.toLowerCase()}${o.latest.date ? `, ${longDate(o.latest.date)}` : ""}${o.latest.url ? ` (${sourceName(o.latest.url)})` : ""}`, group);
    return o;
  };
  const orgCards = orgIds.map(cardOf).sort((x, y) => x.c.name.localeCompare(y.c.name));
  const sides = (["support", "conditional", "oppose"] as Side[]).map((s) => [s, orgCards.filter((o) => o.side === s).map((o) => number_(o, "pos"))] as const).filter(([, l]) => l.length);
  const peopleRows = personIds.map(cardOf).sort((x, y) => x.c.name.localeCompare(y.c.name)).map((o) => number_(o, "ppl"));

  const counts: Record<string, number> = {};
  for (const r of t.pushes) counts[r.type] = (counts[r.type] ?? 0) + 1;
  const sections = [{ id: "overview", label: "Overview" }, ...(stops.length > 1 ? [{ id: "trajectory", label: "Trajectory" }] : []),
    ...(sides.length ? [{ id: "positions", label: "Positions" }] : []), ...(peopleRows.length ? [{ id: "people", label: "People" }] : []),
    ...(cites.list.length ? [{ id: "sources", label: "Sources" }] : [])];
  const rail: RailProps = {
    sections, back: { fallback: "/targets?kind=bills", label: "All bills" },
    map: { id: n.id, name: number, counts, caption: linkCaption(t.pushes.map((r: any) => ({ id: r.actor_id, type: r.actor_type }))) },
    cite: { title: `${number}${title ? `: ${title}` : ""}`, path: `/node/${n.id}` },
  };
  const ended = stops.at(-1)?.ended;

  return (
    <div className="item-page">
      <ItemRail {...rail} />
      <article className="item-main">
        <ItemBar {...rail} />
        <section id="overview" className="bill-top" tabIndex={-1}>
          <h1 className="bill-num">{number}</h1>
          {title && <p className="bill-title">{title}</p>}
          {stage && <p className="stampwrap"><span className={`stamp${stage === "vetoed" || stage === "failed" ? " veto" : ""}`}>{STAGE_LABEL[stage] ?? stage}</span></p>}
          {headline && <p className="bill-head"><Linked parts={headline.parts} text={headline.text} /></p>}
          {description && <p className="bill-desc"><Linked parts={description.parts} text={description.text} />{descNums.map((k, i) => <Num key={i} n={k} />)}</p>}
          {facts.length > 0 && <dl className="bill-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
        </section>

        {stops.length > 1 && <section id="trajectory" tabIndex={-1}>
          <h2 className="sec">Trajectory</h2>
          <ol className="track" style={{ "--n": stops.length, "--to": stops.length > 1 ? reached / (stops.length - 1) : 0 } as React.CSSProperties}>
            <li className="rail" aria-hidden /><li className="fill" aria-hidden />
            {stops.map((s, i) => (
              <li key={i} className={`st ${s.state}${s.ended ? ` ${s.ended}` : ""}`}>
                <span className="l">{s.label}</span>
                <span className="pip" style={{ animationDelay: `${(i * 0.25).toFixed(2)}s` }} aria-hidden />
                <span className="d">{s.date ? shortDate(s.date, i ? year : undefined) : ""}{s.tally ? ` · ${s.tally}` : ""}</span>
              </li>
            ))}
          </ol>
          {ended && <span className="sr-only">{ended === "veto" ? "The bill was vetoed." : "The bill failed."}</span>}
        </section>}

        {sides.length > 0 && <section id="positions" tabIndex={-1}>
          <h2 className="sec">Positions</h2>
          {sides.map(([s, list], gi) => (
            <div key={s} className="side-group">
              <h3>{SIDE_LABEL[s]}<span className="n">{list.length}</span>{gi === 0 && <span className="note">Spending covers all issues</span>}</h3>
              <div className="cards">{list.map((o) => {
                const sp = spend[o.id];
                const money = [sp?.lobbying ? <span key="l"><span className="money">{fmtMoney(sp.lobbying)}</span> lobbying</span> : null,
                  sp?.giving ? <span key="g"><span className="money">{fmtMoney(sp.giving)}</span> giving</span> : null].filter(Boolean);
                return (
                  <article key={o.id} className="card">
                    <Mark node={o.c} size={40} />
                    <div>
                      <Link className="org" href={`/node/${o.id}`}>{o.c.name}</Link>
                      <div className="meta">{[o.label, shortDate(o.date, year)].filter(Boolean).join(" · ")}<Num n={o.posNum} /></div>
                      {money.length > 0 && <div className="meta">{money.map((m, i) => <span key={i}>{i ? " · " : ""}{m}</span>)}</div>}
                    </div>
                    {o.say && <div className="say">
                      <p className={o.say.quote ? "q" : "para"}>{o.say.quote ? `“${o.say.text}”` : o.say.text}<Num n={o.sayNum} /></p>
                      {o.earlier && <p className="meta earlier">Earlier: {o.earlier.label}{o.earlier.date ? ` · ${shortDate(o.earlier.date, year)}` : ""}</p>}
                    </div>}
                    {!o.say && o.earlier && <div className="say"><p className="meta earlier">Earlier: {o.earlier.label}{o.earlier.date ? ` · ${shortDate(o.earlier.date, year)}` : ""}</p></div>}
                  </article>
                );
              })}</div>
            </div>
          ))}
        </section>}

        {peopleRows.length > 0 && <section id="people" tabIndex={-1}>
          <h2 className="sec">People</h2>
          <ul className="people">{peopleRows.map((p) => (
            <li key={p.id}>
              <Mark node={p.c} size={28} />
              <div className="nm"><Link href={`/node/${p.id}`}>{p.c.name}</Link>{p.c.descriptor && <small>{p.c.descriptor}</small>}</div>
              <div>{p.say ? <p className={p.say.quote ? "q" : "para"}>{p.say.quote ? `“${p.say.text}”` : p.say.text}<Num n={p.sayNum} /></p> : <Num n={p.posNum} />}</div>
              <span className={`lean ${p.side}`}>{p.label === "Co-sponsor" ? "Support" : SIDE_LABEL[p.side]}</span>
            </li>
          ))}</ul>
        </section>}

        {cites.list.length > 0 && <section id="sources" tabIndex={-1}>
          <h2 className="sec">Sources</h2>
          {GROUPS.map(([g, label]) => {
            const items = cites.list.filter((c) => c.group === g);
            if (!items.length) return null;
            return <div key={g}>
              <p className="srch">{label}</p>
              <ol className="srcs" start={items[0].n}>{items.map((c) => (
                <li key={c.n} id={`src-${c.n}`} value={c.n}><a className="ext" href={c.url} target="_blank" rel="noreferrer">{c.title}</a></li>
              ))}</ol>
            </div>;
          })}
        </section>}
      </article>
    </div>
  );
}
