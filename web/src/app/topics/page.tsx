import { connection } from "next/server";
import Link from "next/link";
import { getTopics, type TopicActor } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import Src from "@/components/Src";
import SectionNav from "@/components/SectionNav";

export const metadata = { title: "Topics · Model Behavior" };

const ANSWER = ["disagrees strongly", "disagrees", "no clear side", "agrees", "agrees strongly"];

function Actor({ a }: { a: TopicActor }) {
  const quotes = a.items.filter((i) => i.kind === "quote").length;
  const letters = a.items.filter((i) => i.kind === "letter");
  const summary = [letters.length > 0 && `signed ${letters.map((l) => l.doc).join(", ")}`, quotes > 0 && `${quotes} ${quotes === 1 ? "quote" : "quotes"}`].filter(Boolean).join(" · ");
  return (
    <li>
      <details>
        <summary><Link href={`/node/${a.id}`}>{a.name}</Link> <span className="muted">{summary}</span></summary>
        <ul className="topic-evidence">{a.items.map((i, k) => (
          <li key={k}>
            <span className="mono muted">{fmtDate(i.date) || "Undated"}</span>{" "}
            {i.kind === "letter" ? <>Signed {i.doc}: “{i.text}”</> : <>“{i.text}” <span className="muted">Model&apos;s reading: {ANSWER[i.v + 2]}.</span></>}
            {" "}<Src url={i.url} archive={i.archive_url} />
          </li>
        ))}</ul>
      </details>
    </li>
  );
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
  await connection();
  const topics = await getTopics();
  return (
    <div className="home">
      <SectionNav items={topics.map((t) => ({ id: t.id, label: t.label }))} label="Topics" />
      <div className="home-main page">
        <h1>Topics</h1>
        <p className="lede">Where people and organizations stand on notable topics, from their own quotes and the public letters they signed.</p>
        <p className="note">Quote readings come from an open-source model and can be wrong; each shows its quote. A signature is shown with the letter&apos;s own words. Few quotes on record address these topics yet, so most columns are short.</p>
        {topics.map((t) => (
          <section key={t.id} id={t.id} className="topic">
            <h2>{t.label}</h2>
            <p className="note">Statement: “{t.positive}”</p>
            <div className="topic-cols">
              <Column title="Agree" actors={t.agree} />
              <Column title="No clear side" actors={t.neutral} />
              <Column title="Disagree" actors={t.disagree} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
