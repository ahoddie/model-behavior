import Link from "@/components/Link";
import { fmtMoney, fmtDate, TYPE_LABEL } from "@/lib/format";
import ProfileHead from "./ProfileHead";
import Src from "./Src";
import CoverageLine from "./CoverageLine";
import RaceView from "./RaceView";
import BackLink from "./BackLink";
import MapIt, { linkCaption } from "./MapIt";
import type { Coverage } from "@/lib/data";

const SIDES = [["support", "For"], ["support_if_amended", "For, if amended"], ["oppose", "Against"], ["", "Other engagement"]] as const;

export default function TargetView({ t, coverage }: { t: any; coverage: Coverage }) {
  const n = t.node;
  const sideOf = (s: string | null) => (s === "support" || s === "oppose" || s === "support_if_amended" ? s : "");
  const isRace = n.type === "race";
  const counts: Record<string, number> = {};
  for (const r of t.pushes) counts[r.type] = (counts[r.type] ?? 0) + 1;
  const caption = linkCaption(t.pushes.map((r: any) => ({ id: r.actor_id, type: r.actor_type })));
  return (
    <div className="page has-back">
      <BackLink fallback="/targets" />
      <ProfileHead node={n} keyFacts={t.keyFacts} logoSource={n.logo_source_url} citePath={`/node/${n.id}`}
        mapIt={<MapIt id={n.id} name={n.name} counts={counts} caption={caption} />}
        mapChip={<MapIt id={n.id} name={n.name} counts={counts} size="chip" />}
        kicker={<>{TYPE_LABEL[n.type]}{n.external_ids?.status ? <> · {n.external_ids.status} {n.external_ids.status_date && `(${fmtDate(n.external_ids.status_date)})`}</> : null}</>} />
      {isRace && <RaceView t={t} />}
      {!isRace && t.facts.length > 0 && <ul className="facts">{t.facts.map((f: any, i: number) => <li key={i}>{f.text} <Src url={f.url} /></li>)}</ul>}

      {(!isRace || t.pushes.length > 0) && <h2>Who weighed in</h2>}
      <div className="grid2">
        {SIDES.map(([s, label]) => {
          const rows = t.pushes.filter((p: any) => sideOf(p.stance) === s);
          if (!rows.length) return null;
          const actors = new Map<string, any>(rows.map((r: any) => [r.actor_id, r]));
          const behind = [...actors.values()].reduce((a, r) => a + (r.actor_political_money ?? 0), 0);
          const direct = rows.reduce((a: number, r: any) => a + (r.type === "money" ? r.amount ?? 0 : 0), 0);
          return (
            <section key={s} className="push-side">
              <h3>{label} <span className="muted">{actors.size}</span></h3>
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
            <div><Link href={`/node/${f.node_id}`}>{f.actor_name}</Link>{f.stance ? <span className="muted"> · {f.stance}</span> : null}
              {f.excerpt ? <blockquote>“{f.excerpt}” <Src url={f.url} archive={f.archive_url} /></blockquote> : <p style={{ margin: 0 }}>{f.summary} <Src url={f.url} archive={f.archive_url} /></p>}</div></li>
        ))}</ul>
      </>}
      <CoverageLine c={coverage} />
    </div>
  );
}
