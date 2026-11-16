"use client";
// "Who says the most about …": pick a policy statement, see the actors with the most statements that take a side on it.
// Bar color says which side the actor's statements fall on, on average.
import { useState } from "react";
import Link from "@/components/Link";
import Select from "@/components/Select";
import RankChart from "@/components/RankChart";

export type TalkIssue = { id: string; label: string; positive: string; topicId?: string;
  actors: { id: string; name: string; kind: string; n: number; agree: boolean }[] };

// One actor's sided statements on one issue, for the breakdown that opens under a bar.
export type ActorTopic = { id: string; label: string; n: number; agree: boolean };
type Actor = { id: string; name: string; kind: string; n: number; agree?: boolean };
const ALL = "all";

export default function TalkChart({ issues, all, byActor }: { issues: TalkIssue[]; all: Actor[]; byActor: Record<string, ActorTopic[]> }) {
  const [cur, setCurRaw] = useState(ALL);
  const [open, setOpen] = useState<string | null>(null);
  const setCur = (v: string) => { setCurRaw(v); setOpen(null); };
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));
  const issue = issues.find((i) => i.id === cur);
  const actors: Actor[] = issue ? issue.actors : all;
  const name = (a: Actor) => <><Link href={`/node/${a.id}`}>{a.name}</Link> <span className="rc-kind">({a.kind})</span></>;
  const who = actors.find((a) => a.id === open);
  const topics = who ? byActor[who.id] ?? [] : [];
  const tmax = Math.max(1, ...topics.map((t) => t.n));
  const detail = who && (
    <div className="rc-topics">
      <p className="rc-topics-head">{topics.length
        ? <>Where {who.name} takes a side, by issue</>
        : <>None of {who.name}&apos;s statements has been sorted to an issue yet.</>}
        {" "}<Link href={`/node/${who.id}`}>Open profile</Link></p>
      {topics.length > 0 && <ul>{topics.map((t) => (
        <li key={t.id}>
          <span className="rc-topic-name">{t.label}</span>
          <span className="rc-topic-bar"><i className={t.agree ? "sw-support" : "sw-oppose"} style={{ width: `${(t.n / tmax) * 100}%` }} aria-hidden /></span>
          <span className="rc-topic-n">{t.n} · {t.agree ? "agrees" : "disagrees"}</span>
        </li>
      ))}</ul>}
    </div>
  );
  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <h3>Who says the most about</h3>
        <Select label="Issue" options={[{ value: ALL, label: "AI policy, all issues" }, ...issues.map((i) => ({ value: i.id, label: i.label }))]} value={cur} onChange={setCur} wide />
      </figcaption>
      {issue ? <>
        <p className="chart-sub">“{issue.positive}”</p>
        <div className="legend-row">
          <span><i className="sw sw-support" aria-hidden /> Agrees, on average</span>
          <span><i className="sw sw-oppose" aria-hidden /> Disagrees, on average</span>
        </div>
        <RankChart label={`Actors with the most statements on ${issue.label}`} unit="statements that take a side"
          rows={actors.map((a) => ({ id: a.id, name: `${a.name}, ${a.agree ? "agrees" : "disagrees"}`, value: a.n, tone: a.agree ? "support" : "oppose", label: name(a) }))}
          selected={open} onSelect={toggle} detail={detail} />
        {issue.topicId && <p className="more"><Link href={`/topics#${issue.topicId}`}>See everyone, with their quotes</Link></p>}
      </> : <>
        <p className="chart-sub">Quoted statements on record, on any issue. Click a bar to see which issues that actor speaks on, or pick an issue to see who agrees and who disagrees.</p>
        <RankChart label="Actors with the most quoted statements on record" unit="statements"
          rows={actors.map((a) => ({ id: a.id, name: a.name, value: a.n, label: name(a) }))}
          selected={open} onSelect={toggle} detail={detail} />
      </>}
    </figure>
  );
}
