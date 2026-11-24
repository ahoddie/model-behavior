import Link from "@/components/Link";
import { fmtMoney, fmtDate, TYPE_LABEL, sourceName } from "@/lib/format";
import ProfileHead, { ProfileSources, type SourceLine } from "./ProfileHead";
import Src from "./Src";
import CoverageLine from "./CoverageLine";
import RaceView, { raceSections } from "./RaceView";
import { linkCaption } from "./MapIt";
import { ItemRail, ItemBar, type RailProps } from "./ItemRail";
import BillView from "./BillView";
import type { Coverage } from "@/lib/data";
import type { ProfileText } from "@/lib/profile-text";

const SIDES = [["support", "For"], ["support_if_amended", "For, if amended"], ["oppose", "Against"], ["", "Other engagement"]] as const;

export default function TargetView({ t, coverage, text }: { t: any; coverage: Coverage; text: ProfileText | null }) {
  const n = t.node;
  // Bills have their own page (docs/bill-page-spec.md).
  if (n.type === "bill") return <BillView t={t} />;
  const sideOf = (s: string | null) => (s === "support" || s === "oppose" || s === "support_if_amended" ? s : "");
  const isRace = n.type === "race";
  const counts: Record<string, number> = {};
  for (const r of t.pushes) counts[r.type] = (counts[r.type] ?? 0) + 1;
  // A race's money goes to its candidates, so its pattern and count include them and the groups spending on them.
  if (isRace) { counts.person = (counts.person ?? 0) + t.candidates.length; counts.money = (counts.money ?? 0) + t.candidatePushes.length; }
  const caption = linkCaption([...t.pushes.map((r: any) => ({ id: r.actor_id, type: r.actor_type })),
    ...(isRace ? [...t.candidates.map((c: any) => ({ id: c.id, type: "lawmaker" })), ...t.candidatePushes.map((p: any) => ({ id: p.actor_id, type: "pac" }))] : [])]);
  const race = isRace ? raceSections(t) : null;
  // As on people and org pages: the written headline and description (table profile_text), and until there is one the
  // descriptor and the first few sourced notes as one paragraph. A race's notes feed its own sections (RaceView), so a
  // race without text gets no description. Sources go to one list at the bottom.
  const notes = isRace || text ? [] : t.facts.slice(0, 3);
  const more = isRace || text ? [] : t.facts.slice(3);
  const headline = text ? { text: text.headline } : { text: n.descriptor ?? "", parts: t.descriptorParts };
  const description = text ? { text: text.description, parts: text.parts }
    : notes.length ? { text: notes.map((f: any) => f.text).join(" "), parts: notes.flatMap((f: any, i: number) => [...(i ? [{ t: " " }] : []), ...(f.parts ?? [{ t: f.text }])]) } : null;
  const sources: SourceLine[] = [
    ...(text ? text.sources.map((x) => ({ ...x, lead: true })) : [
      ...(n.descriptor && n.source_url ? [{ label: "Summary", name: sourceName(n.source_url), url: n.source_url }] : []),
      ...[...notes, ...more].map((f: any) => ({ label: "Background", name: sourceName(f.url), url: f.url })),
    ]),
    ...t.keyFacts.filter((f: any) => f.label !== "Website").map((f: any) => ({ label: f.label, name: sourceName(f.url), url: f.url })),
  ];
  const weighed = (!isRace || t.pushes.length > 0) && t.pushes.length > 0;
  const rail: RailProps = {
    sections: [{ id: "overview", label: "Overview" },
      ...(race?.outside ? [{ id: "race-outside", label: "Spending" }] : []), ...(race?.candidates ? [{ id: "race-cands", label: "Candidates" }] : []),
      ...(weighed ? [{ id: "positions", label: "Positions" }] : []), ...(t.statements.length ? [{ id: "statements", label: "Statements" }] : []),
      ...(sources.length ? [{ id: "sources", label: "Sources" }] : [])],
    back: isRace ? { fallback: "/targets?kind=elections", label: "Elections" } : { fallback: n.type === "rule" ? "/targets?kind=rules" : "/targets", label: "Policy" },
    map: { id: n.id, name: n.name, counts, caption },
    cite: { title: n.name, path: `/node/${n.id}` },
  };
  return (
    <div className="item-page">
      <ItemRail {...rail} />
      <article className="item-main">
      <ItemBar {...rail} />
      <div id="overview" className="item-sec" tabIndex={-1}>
      <ProfileHead node={n} keyFacts={t.keyFacts} logoSource={n.logo_source_url} headline={headline} description={description}
        kicker={<>{TYPE_LABEL[n.type]}{n.external_ids?.status ? <> · {n.external_ids.status} {n.external_ids.status_date && `(${fmtDate(n.external_ids.status_date)})`}</> : null}</>} />
      </div>
      {isRace && <RaceView t={t} />}
      {more.length > 0 && <p className="profile-desc">{more.map((f: any) => f.text).join(" ")}</p>}

      {weighed && <h2 id="positions" tabIndex={-1}>Who weighed in</h2>}
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
        <h2 id="statements" tabIndex={-1}>What they said about it</h2>
        <ul className="feed">{t.statements.map((f: any) => (
          <li key={f.id}><div className="when">{fmtDate(f.date)}</div>
            <div><Link href={`/node/${f.node_id}`}>{f.actor_name}</Link>{f.stance ? <span className="muted"> · {f.stance}</span> : null}
              {f.excerpt ? <blockquote>“{f.excerpt}” <Src url={f.url} archive={f.archive_url} /></blockquote> : <p style={{ margin: 0 }}>{f.summary} <Src url={f.url} archive={f.archive_url} /></p>}</div></li>
        ))}</ul>
      </>}
      <ProfileSources sources={sources} />
      <CoverageLine c={coverage} />
      </article>
    </div>
  );
}
