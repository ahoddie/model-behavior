"use client";
// "Who says the most about …": pick a policy statement, see the actors with the most statements that take a side on it.
// Bar color says which side the actor's statements fall on, on average.
import { useState } from "react";
import Link from "@/components/Link";
import Select from "@/components/Select";
import RankChart from "@/components/RankChart";

export type TalkIssue = { id: string; label: string; positive: string; topicId?: string;
  actors: { id: string; name: string; kind: string; n: number; agree: boolean }[] };

type Actor = { id: string; name: string; kind: string; n: number; agree?: boolean };
const ALL = "all";

export default function TalkChart({ issues, all }: { issues: TalkIssue[]; all: Actor[] }) {
  const [cur, setCur] = useState(ALL);
  const issue = issues.find((i) => i.id === cur);
  const actors: Actor[] = issue ? issue.actors : all;
  const name = (a: Actor) => <><Link href={`/node/${a.id}`}>{a.name}</Link> <span className="rc-kind">({a.kind})</span></>;
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
          rows={actors.map((a) => ({ id: a.id, name: `${a.name}, ${a.agree ? "agrees" : "disagrees"}`, value: a.n, tone: a.agree ? "support" : "oppose", label: name(a) }))} />
        {issue.topicId && <p className="more"><Link href={`/topics#${issue.topicId}`}>See everyone, with their quotes</Link></p>}
      </> : <>
        <p className="chart-sub">Quoted statements on record, on any issue. Pick an issue to see who agrees and who disagrees.</p>
        <RankChart label="Actors with the most quoted statements on record" unit="statements"
          rows={actors.map((a) => ({ id: a.id, name: a.name, value: a.n, label: name(a) }))} />
      </>}
    </figure>
  );
}
