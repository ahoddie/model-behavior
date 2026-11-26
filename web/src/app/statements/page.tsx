import Link from "@/components/Link";
import { getTopics, type TopicActor, type TopicEvidence, type TopicRow } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import Src from "@/components/Src";
import SectionNav from "@/components/SectionNav";

export const metadata = { title: "Statements · Model Behavior" };

const ANSWER = ["disagrees strongly", "disagrees", "no clear side", "agrees", "agrees strongly"];
const readAs = (i: TopicEvidence) => (i.mixed ? "agrees with part of it" : ANSWER[i.v + 2]);

function Actor({ a }: { a: TopicActor }) {
  const quotes = a.items.filter((i) => i.kind === "quote").length;
  const letters = a.items.filter((i) => i.kind === "letter");
  const summary = [letters.length > 0 && `signed ${letters.map((l) => l.doc).join(", ")}`, quotes > 0 && `${quotes} ${quotes === 1 ? "quote" : "quotes"}`,
    a.changed && "took the other side earlier"].filter(Boolean).join(" · ");
  return (
    <li>
      <details>
        <summary><span className="topic-name">{a.name}</span> <span className={`muted${letters.length ? "" : " topic-count"}`}>{summary}</span></summary>
        {!a.onSite && a.role && <p className="muted topic-role">{a.role}</p>}
        <ul className="topic-evidence">{a.items.map((i, k) => (
          <li key={k}>
            <span className="mono muted">{fmtDate(i.date) || "Undated"}</span>{" "}
            {i.kind === "letter" ? <>Signed {i.doc}: “{i.text}”</> : <>“{i.text}” <span className="muted">{i.speaker ? `Said by ${i.speaker}. ` : ""}{i.source_kind ? `${i.source_kind[0].toUpperCase()}${i.source_kind.slice(1)}. ` : ""}Read as: {readAs(i)}{i.implied ? ", implied rather than said outright" : ""}.{i.machine ? " Machine reading, not yet checked by a person." : ""}</span></>}
            {" "}<Src url={i.url} archive={i.archive_url} />
          </li>
        ))}</ul>
        {a.onSite && <Link className="topic-profile" href={`/node/${a.id}`}>Open full profile</Link>}
      </details>
    </li>
  );
}

// What was looked at for this topic, so an empty column reads as "not found in what we checked", not "nobody holds this view".
function coverage(t: TopicRow) {
  const parts = [
    t.found > 0 && `${t.found} sourced ${t.found === 1 ? "quote" : "quotes"} found, ${t.shown} shown`,
    t.checked > 0 && `${t.checked} feed ${t.checked === 1 ? "quote" : "quotes"} checked by a person, ${t.confirmed} shown`,
    t.letters.length > 0 && `${t.letters.length} public ${t.letters.length === 1 ? "letter" : "letters"} (${t.letters.join(", ")})`,
  ].filter(Boolean);
  const onlyLetters = t.confirmed === 0 && t.letters.length > 0;
  const machine = t.machine > 0 ? ` ${t.machine} of the shown quotes are machine readings: the quote was found word for word at its link and the reading was high confidence, but no person has checked it yet.` : "";
  return `Based on ${(parts.length < 3 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`)}.${machine}${onlyLetters ? " A letter records only the people who signed it, so it cannot show who disagrees." : ""}`;
}

function Column({ title, actors }: { title: string; actors: TopicActor[] }) {
  return (
    <div className="topic-col">
      <h3>{title} <span className="muted">{actors.length}</span></h3>
      {actors.length ? <ul>{actors.map((a) => <Actor key={a.id} a={a} />)}</ul> : <p className="muted">None on record.</p>}
    </div>
  );
}

export default async function Topics() {
  // A topic with nothing confirmed yet is left off, so empty columns never read as "nobody holds this view".
  const topics = (await getTopics()).filter((t) => t.agree.length + t.mixed.length + t.neutral.length + t.disagree.length > 0);
  return (
    <div className="home">
      <SectionNav items={topics.map((t) => ({ id: t.id, label: t.label }))} label="Statements" />
      <div className="home-main page">
        <h1>Statements</h1>
        <p className="lede">Each statement below is a live question in US AI policy. Under it are people and groups who have taken a side, each with a quote and a link to where they said it. Most never repeat the statement word for word, so many quotes are read as implying a side. Open a name to see the quote and judge for yourself.</p>
        {topics.map((t) => (
          <section key={t.id} id={t.id} className="topic">
            <h2>{t.positive}</h2>
            <p className="muted">{t.description}</p>
            <p className="topic-basis muted">{coverage(t)}</p>
            <div className={t.mixed.length ? "topic-cols topic-cols-4" : "topic-cols"}>
              <Column title="Agree" actors={t.agree} />
              {t.mixed.length > 0 && <Column title="Mixed" actors={t.mixed} />}
              <Column title="No clear side" actors={t.neutral} />
              <Column title="Disagree" actors={t.disagree} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
