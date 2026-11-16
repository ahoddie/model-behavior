import Link from "@/components/Link";
import { fmtMoney, fmtDate, TYPE_LABEL } from "@/lib/format";
import FollowForm from "./FollowForm";
import ProfileHead from "./ProfileHead";
import Src from "./Src";
import CoverageLine from "./CoverageLine";
import type { Coverage } from "@/lib/data";

const SIDES = [["support", "For"], ["support_if_amended", "For, if amended"], ["oppose", "Against"], ["", "Other pressure"]] as const;

export default function TargetView({ t, coverage }: { t: any; coverage: Coverage }) {
  const n = t.node;
  const sideOf = (s: string | null) => (s === "support" || s === "oppose" || s === "support_if_amended" ? s : "");
  const isRace = n.type === "race";
  return (
    <div className="page">
      <ProfileHead node={n} keyFacts={t.keyFacts} logoSource={n.logo_source_url} citePath={`/node/${n.id}`}
        kicker={<>{TYPE_LABEL[n.type]}{n.external_ids?.status ? <> · {n.external_ids.status} {n.external_ids.status_date && `(${fmtDate(n.external_ids.status_date)})`}</> : null}</>} />
      {t.facts.length > 0 && <ul className="facts">{t.facts.map((f: any, i: number) => <li key={i}>{f.text} <Src url={f.url} /></li>)}</ul>}
      <p className="mono"><Link href={`/map?focus=${n.id}`}>Trace on the map</Link> · <a href={`/api/rss/${n.id}`}>RSS</a></p>
      <CoverageLine c={coverage} />
      <FollowForm nodeId={n.id} />

      {isRace && t.candidates.length > 0 && <>
        <h2>Money in this race</h2>
        {t.candidates.map((c: any) => {
          const ps = t.candidatePushes.filter((p: any) => p.candidate === c.id);
          const forSum = ps.filter((p: any) => p.stance === "support").reduce((a: number, p: any) => a + (p.amount ?? 0), 0);
          const agSum = ps.filter((p: any) => p.stance === "oppose").reduce((a: number, p: any) => a + (p.amount ?? 0), 0);
          return (
            <section key={c.id}>
              <h3><Link href={`/node/${c.id}`}>{c.name}</Link></h3><p className="mono muted">Spending on record: {fmtMoney(forSum) || "$0"} in support, {fmtMoney(agSum) || "$0"} in opposition.</p>
              <table className="data-table"><tbody>{ps.map((p: any, i: number) => (
                <tr key={i}><td><Link href={`/node/${p.actor_id}`}>{p.actor_name}</Link></td><td>{p.stance}</td><td className="num">{fmtMoney(p.amount)}</td><td className="mono">{fmtDate(p.date_start)}</td><td>{p.note} <Src url={p.source_url} /></td></tr>
              ))}</tbody></table>
            </section>
          );
        })}
      </>}

      <h2>Who pushed</h2>
      <div className="grid2">
        {SIDES.map(([s, label]) => {
          const rows = t.pushes.filter((p: any) => sideOf(p.stance) === s);
          if (!rows.length) return null;
          const actors = new Map<string, any>(rows.map((r: any) => [r.actor_id, r]));
          const behind = [...actors.values()].reduce((a, r) => a + (r.actor_political_money ?? 0), 0);
          const direct = rows.reduce((a: number, r: any) => a + (r.type === "money" ? r.amount ?? 0 : 0), 0);
          return (
            <section key={s} className="panel" style={{ padding: "var(--s4)" }}>
              <h3>{label} <span className="mono">{actors.size}</span></h3>
              <p className="mono muted">{direct > 0 && <>Spent here {fmtMoney(direct)} · </>}{behind > 0 && <>Political money on record across these actors {fmtMoney(behind)}</>}</p>
              <ul className="conns">{rows.map((r: any) => (
                <li key={r.id}><Link href={`/node/${r.actor_id}`}>{r.actor_name}</Link> <span className={`tag ${r.type}`}>{r.subtype ?? r.type}</span>{" "}
                  {[fmtMoney(r.amount), fmtDate(r.date_start)].filter(Boolean).join(" · ")}{r.note ? <span className="muted"> {r.note}</span> : null} <Src url={r.source_url} /></li>
              ))}</ul>
            </section>
          );
        })}
      </div>

      {t.statements.length > 0 && <>
        <h2>What they said about it</h2>
        <ul className="feed">{t.statements.map((f: any) => (
          <li key={f.id}><div className="when">{fmtDate(f.date)}</div>
            <div><Link href={`/node/${f.node_id}`}>{f.actor_name}</Link>{f.stance ? <span className="tag position" style={{ marginLeft: 6 }}>{f.stance}</span> : null}
              {f.excerpt ? <blockquote>“{f.excerpt}” <Src url={f.url} archive={f.archive_url} /></blockquote> : <p style={{ margin: 0 }}>{f.summary} <Src url={f.url} archive={f.archive_url} /></p>}</div></li>
        ))}</ul>
      </>}
    </div>
  );
}
