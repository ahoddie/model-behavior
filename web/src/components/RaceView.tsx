import Link from "@/components/Link";
import { fmtMoney, fmtDate } from "@/lib/format";
import Src from "./Src";

const STATES: Record<string, string> = {
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California", co: "Colorado", ct: "Connecticut", de: "Delaware",
  dc: "District of Columbia", fl: "Florida", ga: "Georgia", hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa",
  ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland", ma: "Massachusetts", mi: "Michigan", mn: "Minnesota",
  ms: "Mississippi", mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire", nj: "New Jersey",
  nm: "New Mexico", ny: "New York", nc: "North Carolina", nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon",
  pa: "Pennsylvania", ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota", tn: "Tennessee", tx: "Texas", ut: "Utah",
  vt: "Vermont", va: "Virginia", wa: "Washington", wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming",
};
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const PARTY: Record<string, string> = { DEM: "Democrat", REP: "Republican", IND: "Independent", LIB: "Libertarian", GRE: "Green" };

// The seat, in words, from the race id (race-2026-ny-12, race-2026-oh-sen, race-2026-wy-al).
function seat(id: string) {
  const m = id.match(/^race-(\d{4})-([a-z]{2})-(sen|al|\d+)$/);
  if (!m) return null;
  const state = STATES[m[2]] ?? m[2].toUpperCase();
  const place = m[3] === "sen" ? `U.S. Senate, ${state}` : m[3] === "al" ? `U.S. House, ${state} at-large` : `U.S. House, ${state}'s ${ordinal(Number(m[3]))} district`;
  return { place, year: m[1] };
}

// These lines are written by scripts/thin/races-fec.ts in one fixed format, so they read back exactly.
const CAND = /^(.+) \(([^()]+?)(?:, (incumbent|open seat|challenger))?\): raised \$([\d,]+), spent \$([\d,]+), cash on hand \$(-?[\d,]+)(?:, through (.+?))?\.$/;
const COUNT = /^(\d+) candidates? registered with the FEC for this seat/;
const PACS = /^AI-focused super PACs in this dataset reported .+? through filings available (.+?) —/;
const num = (s: string) => Number(s.replace(/,/g, ""));
// FEC names come title-cased from "LAST, FIRST MIDDLE DR."; drop titles and restore Mc/O' capitals for display.
const tidy = (s: string) => s.replace(/\b(Dr|Mr|Mrs|Ms|Hon)\.\s*/g, "").replace(/\b(Mc|O')([a-z])/g, (_, p, c) => p + c.toUpperCase()).replace(/\s+/g, " ").trim();

type Push = { candidate: string; stance: string; amount: number | null; date_start: string; note: string | null; source_url: string; actor_id: string; actor_name: string };

export default function RaceView({ t }: { t: any }) {
  const n = t.node;
  const facts: { text: string; url: string }[] = t.allFacts ?? t.facts;
  const cands: { name: string; party: string; status: string; raised: number; spent: number; cash: number; through: string | null; url: string }[] = [];
  let count: { n: number; url: string } | null = null, pacs: { asOf: string; url: string } | null = null;
  const other: typeof facts = [];
  for (const f of facts) {
    const c = f.text.match(CAND), k = f.text.match(COUNT), p = f.text.match(PACS);
    if (c) cands.push({ name: c[1], party: c[2], status: c[3] ?? "", raised: num(c[4]), spent: num(c[5]), cash: num(c[6]), through: c[7] ?? null, url: f.url });
    else if (k) count = { n: Number(k[1]), url: f.url };
    else if (p) pacs = { asOf: p[1], url: f.url };
    else other.push(f);
  }
  cands.sort((a, b) => b.raised - a.raised);
  const maxRaised = Math.max(1, ...cands.map((c) => c.raised));

  // Tracked candidate profiles in this race, matched to FEC names by last name (names on FEC filings carry middle names).
  const last = (s: string) => s.replace(/,.*$/, "").trim().split(/\s+/).pop()!.toLowerCase();
  const profileOf = (name: string) => t.candidates.find((c: any) => last(c.name) === last(name));

  // Outside spending: one row per candidate, opposition to the left of the axis and support to the right, one segment per group.
  const pushes: Push[] = t.candidatePushes.filter((p: Push) => p.amount && (p.stance === "support" || p.stance === "oppose"));
  const rows = t.candidates.map((c: any) => {
    const mine = pushes.filter((p) => p.candidate === c.id);
    const group = (stance: string) => {
      const by = new Map<string, { id: string; name: string; amount: number }>();
      for (const p of mine.filter((p) => p.stance === stance)) {
        const g = by.get(p.actor_id) ?? { id: p.actor_id, name: p.actor_name, amount: 0 };
        g.amount += p.amount!; by.set(p.actor_id, g);
      }
      return [...by.values()].sort((a, b) => b.amount - a.amount);
    };
    const support = group("support"), oppose = group("oppose");
    const sum = (gs: { amount: number }[]) => gs.reduce((a, g) => a + g.amount, 0);
    return { c, support, oppose, forSum: sum(support), againstSum: sum(oppose), lines: mine };
  }).filter((r: any) => r.lines.length).sort((a: any, b: any) => (b.forSum + b.againstSum) - (a.forSum + a.againstSum));
  const scale = Math.max(1, ...rows.flatMap((r: any) => [r.forSum, r.againstSum]));
  const pct = (v: number) => `${(v / scale) * 100}%`;
  const s = seat(n.id);
  const incumbent = cands.find((c) => c.status === "incumbent");

  return (
    <>
      {s && (
        <p className="race-seat">
          <span>{s.place}</span>
          <span>{incumbent ? <>Incumbent: {profileOf(incumbent.name)?.name ?? tidy(incumbent.name)}</> : cands.length ? "Open seat" : null}</span>
          {count && <span>{count.n} {count.n === 1 ? "candidate" : "candidates"} registered <Src url={count.url} /></span>}
        </p>
      )}

      {rows.length > 0 && (
        <section className="race-block" aria-labelledby="race-outside">
          <h2 id="race-outside">Outside spending by AI-focused groups</h2>
          <p className="race-note">Independent expenditures reported to the FEC by super PACs in this dataset{pacs ? <>, through filings available {pacs.asOf} <Src url={pacs.url} /></> : null}. Each segment is one group.</p>
          <div className="race-legend" aria-hidden>
            <span><i className="sw sw-oppose" />In opposition</span>
            <span><i className="sw sw-support" />In support</span>
          </div>
          <ol className="race-chart">
            {rows.map((r: any) => (
              <li key={r.c.id} aria-label={`${r.c.name}: ${fmtMoney(r.forSum) || "$0"} in support, ${fmtMoney(r.againstSum) || "$0"} in opposition`}>
                <Link href={`/node/${r.c.id}`} className="race-who">{r.c.name}</Link>
                <div className="race-bars" aria-hidden>
                  <div className="race-side against">
                    <div className="race-track" style={{ width: pct(r.againstSum) }}>{r.oppose.map((g: any) => <span key={g.id} className="seg oppose" style={{ width: `${(g.amount / r.againstSum) * 100}%` }} title={`${g.name}, in opposition: ${fmtMoney(g.amount)}`} />)}
                      {r.againstSum > 0 && <span className="race-sum">{fmtMoney(r.againstSum)}</span>}</div>
                  </div>
                  <div className="race-side for">
                    <div className="race-track" style={{ width: pct(r.forSum) }}>{r.support.map((g: any) => <span key={g.id} className="seg support" style={{ width: `${(g.amount / r.forSum) * 100}%` }} title={`${g.name}, in support: ${fmtMoney(g.amount)}`} />)}
                      {r.forSum > 0 && <span className="race-sum">{fmtMoney(r.forSum)}</span>}</div>
                  </div>
                </div>
                <p className="race-groups">
                  {[...r.oppose.map((g: any) => ({ ...g, side: "against" })), ...r.support.map((g: any) => ({ ...g, side: "for" }))].map((g: any, i: number) => (
                    <span key={g.id + g.side}>{i > 0 && " · "}<Link href={`/node/${g.id}`}>{g.name}</Link> {g.side === "for" ? "for" : "against"}, {fmtMoney(g.amount)}</span>
                  ))}
                </p>
              </li>
            ))}
          </ol>
          <details className="race-filings">
            <summary>The {rows.reduce((a: number, r: any) => a + r.lines.length, 0)} filings behind these amounts</summary>
            <table className="data-table">
              <thead><tr><th>Group</th><th>Candidate</th><th>Position</th><th className="num">Amount</th><th>Date</th><th>Source</th></tr></thead>
              <tbody>{rows.flatMap((r: any) => r.lines.map((p: Push, i: number) => (
                <tr key={`${r.c.id}-${i}`}><td><Link href={`/node/${p.actor_id}`}>{p.actor_name}</Link></td><td>{r.c.name}</td>
                  <td>{p.stance === "support" ? "In support" : p.stance === "oppose" ? "In opposition" : p.stance}</td>
                  <td className="num">{fmtMoney(p.amount)}</td><td>{fmtDate(p.date_start)}</td><td><Src url={p.source_url} /></td></tr>
              )))}</tbody>
            </table>
          </details>
        </section>
      )}

      {cands.length > 0 && (
        <section className="race-block" aria-labelledby="race-cands">
          <h2 id="race-cands">Candidates</h2>
          <p className="race-note">Campaign totals each candidate reported to the FEC, through the date shown.</p>
          <div className="race-table-wrap">
            <table className="data-table race-cands">
              <thead><tr><th>Candidate</th><th className="num">Raised</th><th className="num">Spent</th><th className="num">Cash on hand</th></tr></thead>
              <tbody>{cands.map((c) => {
                const prof = profileOf(c.name);
                return (
                  <tr key={c.name}>
                    <td>
                      <span className="race-name">{prof ? <Link href={`/node/${prof.id}`}>{prof.name}</Link> : tidy(c.name)}</span>
                      <span className="race-meta">{[PARTY[c.party] ?? c.party, c.status === "incumbent" ? "Incumbent" : null, c.through ? `through ${c.through}` : null].filter(Boolean).join(" · ")} <Src url={c.url} /></span>
                    </td>
                    <td className="num"><span>{fmtMoney(c.raised)}</span><span className="race-raised" aria-hidden><span style={{ width: `${(c.raised / maxRaised) * 100}%` }} /></span></td>
                    <td className="num">{fmtMoney(c.spent)}</td>
                    <td className="num">{fmtMoney(c.cash)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </section>
      )}

      {other.length > 0 && <ul className="facts">{other.map((f, i) => <li key={i}>{f.text} <Src url={f.url} /></li>)}</ul>}
    </>
  );
}

// Which of the race's blocks have anything in them, for the item rail's section links.
export function raceSections(t: any) {
  const facts: { text: string }[] = t.allFacts ?? t.facts;
  const ids = new Set(t.candidates.map((c: any) => c.id));
  return {
    outside: t.candidatePushes.some((p: Push) => p.amount && (p.stance === "support" || p.stance === "oppose") && ids.has(p.candidate)),
    candidates: facts.some((f) => CAND.test(f.text)),
  };
}
