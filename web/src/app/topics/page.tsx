import Link from "@/components/Link";
import { getTopics, type TopicActor, type TopicRow } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import Src from "@/components/Src";
import SectionNav from "@/components/SectionNav";

export const metadata = { title: "Stances · Model Behavior" };

const ANSWER = ["disagrees strongly", "disagrees", "no clear side", "agrees", "agrees strongly"];

function Actor({ a }: { a: TopicActor }) {
  const quotes = a.items.filter((i) => i.kind === "quote").length;
  const letters = a.items.filter((i) => i.kind === "letter");
  const summary = [letters.length > 0 && `signed ${letters.map((l) => l.doc).join(", ")}`, quotes > 0 && `${quotes} ${quotes === 1 ? "quote" : "quotes"}`,
    a.changed && "took the other side earlier"].filter(Boolean).join(" · ");
  return (
    <li>
      <details>
        <summary><span className="topic-name">{a.name}</span> <span className="muted">{summary}</span></summary>
        <ul className="topic-evidence">{a.items.map((i, k) => (
          <li key={k}>
            <span className="mono muted">{fmtDate(i.date) || "Undated"}</span>{" "}
            {i.kind === "letter" ? <>Signed {i.doc}: “{i.text}”</> : <>“{i.text}” <span className="muted">{i.speaker ? `Said by ${i.speaker}. ` : ""}Read as: {ANSWER[i.v + 2]}.</span></>}
            {" "}<Src url={i.url} archive={i.archive_url} />
          </li>
        ))}</ul>
        <Link className="topic-profile" href={`/node/${a.id}`}>Open full profile</Link>
      </details>
    </li>
  );
}

// What was looked at for this topic, so an empty column reads as "not found in what we checked", not "nobody holds this view".
function coverage(t: TopicRow) {
  const parts = [
    t.checked > 0 && `${t.checked} ${t.checked === 1 ? "quote" : "quotes"} checked, ${t.confirmed} shown`,
    t.letters.length > 0 && `${t.letters.length} public ${t.letters.length === 1 ? "letter" : "letters"} (${t.letters.join(", ")})`,
  ].filter(Boolean);
  const onlyLetters = t.confirmed === 0 && t.letters.length > 0;
  return `Based on ${parts.join(" and ")}.${onlyLetters ? " A letter records only the people who signed it, so it cannot show who disagrees." : ""}`;
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
      <SectionNav items={topics.map((t) => ({ id: t.id, label: t.label }))} label="Stances" />
      <div className="home-main page">
        <h1>Stances</h1>
        <p className="lede">Where people and organizations stand on notable topics, from their own quotes and the public letters they signed. Every quote was checked by a person against the statement.</p>
        {topics.map((t) => (
          <section key={t.id} id={t.id} className="topic">
            <h2>{t.positive}</h2>
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
