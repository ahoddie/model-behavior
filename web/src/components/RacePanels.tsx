import Link from "@/components/Link";
import Select from "@/components/Select";
import { fmtMoney, STATE_NAMES } from "@/lib/format";
import { outcomeText, fmtPct, statusText, type CandidateResult, type RaceResult } from "@/lib/election";

// The Elections tab: one panel per seat, each the same size whatever was spent there, so a quiet $1,000 check in one
// district gets the same room as a multimillion-dollar fight in another. A seat is a race on record or, for a candidate
// whose race has no page, the seat named in the candidate's description.

type Spend = { cand: string; actor: string; actor_name: string; subtype: string; stance: string | null; amount: number; n: number };
type Cand = { id: string; name: string; party: string | null; incumbent: boolean; result: CandidateResult | null };
type Line = { actor: string; actor_name: string; cand: Cand; kind: "for" | "against" | "gave"; amount: number };
export type Seat = {
  key: string; cycle: string; st: string; office: "sen" | "house"; district: string | null; href: string;
  cands: Cand[]; lines: Line[]; outside: number; given: number; result: RaceResult | null;
};

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const PARTY: Record<string, string> = { DEM: "D", REP: "R", IND: "I", LIB: "L", GRE: "G" };
const PARTY_WORD: Record<string, string> = { D: "Democrat", R: "Republican", I: "Independent", L: "Libertarian", G: "Green" };

// "2026 candidate, NY-12 House (DEM); incumbent" or "Federal candidate, WA Senate (DEM)".
const SEAT_RX = /\b([A-Z]{2})(?:-(\d+|AL))? (House|Senate)\b/;
const fromDescriptor = (d: string | null) => {
  const m = d?.match(SEAT_RX);
  return m && STATE_NAMES[m[1].toLowerCase()] ? { st: m[1].toLowerCase(), office: m[3] === "Senate" ? "sen" as const : "house" as const, district: m[3] === "Senate" ? null : (m[2] ?? "AL").toLowerCase() } : null;
};
const fromRaceId = (id: string) => {
  const m = id.match(/^race-(\d{4})-([a-z]{2})-(sen|al|\d+)$/);
  return m ? { cycle: m[1], st: m[2], office: m[3] === "sen" ? "sen" as const : "house" as const, district: m[3] === "sen" ? null : m[3] } : null;
};
const candOf = (t: any): Cand => {
  const p = t.descriptor?.match(/\((DEM|REP|IND|LIB|GRE)\)/)?.[1];
  return { id: t.id, name: t.name, party: p ? PARTY[p] : null, incumbent: /incumbent/i.test(t.descriptor ?? ""), result: t.result ?? null };
};

export function seatsOf(ts: any[], spend: Spend[]): Seat[] {
  const seats = new Map<string, Seat>();
  const make = (key: string, cycle: string, s: { st: string; office: "sen" | "house"; district: string | null }, href: string) =>
    seats.get(key) ?? seats.set(key, { key, cycle, ...s, href, cands: [], lines: [], outside: 0, given: 0, result: null }).get(key)!;
  for (const t of ts) if (t.type === "race") {
    const s = fromRaceId(t.id);
    if (s) make(t.id, s.cycle, s, `/node/${t.id}`).result = t.result ?? null;
  }
  const candById = new Map<string, { c: Cand; seat: Seat }>();
  for (const t of ts) if (t.type === "lawmaker") {
    let seat = t.race ? seats.get(t.race) : undefined;
    if (!seat) {
      const s = fromDescriptor(t.descriptor);
      const cycle = t.grp?.match(/^e-(\d{4})-/)?.[1] ?? "";
      if (!s) continue;
      seat = make(`seat-${cycle}-${s.st}-${s.office === "sen" ? "sen" : s.district}`, cycle, s, `/node/${t.id}`);
    }
    const c = candOf(t);
    seat.cands.push(c);
    candById.set(t.id, { c, seat });
  }
  for (const r of spend) {
    const hit = candById.get(r.cand);
    if (!hit || !(r.amount > 0)) continue;
    const kind = r.subtype === "contribution" ? "gave" : r.stance === "oppose" ? "against" : "for";
    hit.seat.lines.push({ actor: r.actor, actor_name: r.actor_name, cand: hit.c, kind, amount: r.amount });
    if (kind === "gave") hit.seat.given += r.amount; else hit.seat.outside += r.amount;
  }
  for (const s of seats.values()) {
    s.lines.sort((a, b) => b.amount - a.amount);
    // Candidates with money on record first, then incumbents, then by name.
    const got = (c: Cand) => s.lines.filter((l) => l.cand.id === c.id).reduce((a, l) => a + l.amount, 0);
    // Once results are in, the winner leads.
    const won = (c: Cand) => Number(c.result?.outcome === "won" || (!!s.result?.winner && s.result.winner === c.id));
    s.cands.sort((a, b) => won(b) - won(a) || got(b) - got(a) || Number(b.incumbent) - Number(a.incumbent) || a.name.localeCompare(b.name));
    // A seat with one candidate and no race page opens that candidate.
    if (!s.key.startsWith("race-") && s.cands[0]) s.href = `/node/${s.cands[0].id}`;
  }
  return [...seats.values()];
}

const seatTitle = (s: Seat) => (s.office === "sen" ? "Senate" : s.district === "al" ? "At-large seat" : `${ordinal(Number(s.district))} district`);
const officeName = (s: Seat) => (s.office === "sen" ? "U.S. Senate" : "U.S. House");
const lastName = (n: string) => n.split(/\s+/).pop();
const SHOW = 4;

// A candidate's outcome: from the race's own result row when there is one, else from the candidate's node.
function candOutcome(s: Seat, c: Cand): string | null {
  const row = s.result?.candidates.find((r) => r.id === c.id);
  if (row && s.result!.status === "called") return `${row.winner ? "Won" : "Lost"}${row.pct != null ? `, ${fmtPct(row.pct)}` : ""}`;
  return outcomeText(c.result);
}
// "Won by Jane Doe, 52.1%. Unofficial results as of Nov 20, 2026" or "Not yet called".
function resultLine(s: Seat): string | null {
  const r = s.result;
  if (!r) return null;
  if (r.status !== "called") return statusText(r);
  const w = r.candidates.find((c) => c.winner);
  return `${r.winner_name ?? w?.name ?? "Winner"} won${w?.pct != null ? ` with ${fmtPct(w.pct)}` : ""}. ${statusText(r)}`;
}

function Panel({ s }: { s: Seat }) {
  const quiet = !s.lines.length;
  return (
    <li className={`rpanel${quiet ? " rpanel-quiet" : ""}`}>
      <p className="rpanel-kick">{officeName(s)} · {s.cycle}</p>
      <h3><Link href={s.href}>{seatTitle(s)}</Link></h3>
      {s.cands.length > 0 && (
        <ul className="rpanel-cands" aria-label="Candidates on record">{s.cands.map((c) => (
          <li key={c.id}><Link href={`/node/${c.id}`}>{c.name}</Link>
            {c.party && <abbr className="rpanel-party" title={PARTY_WORD[c.party]}>{c.party}</abbr>}
            {c.incumbent && <span className="rpanel-inc">incumbent</span>}
            {candOutcome(s, c) && <span className="rpanel-out">{candOutcome(s, c)}</span>}</li>
        ))}</ul>
      )}
      {resultLine(s) && <p className="rpanel-result">{resultLine(s)}</p>}
      {quiet ? <p className="rpanel-none">No AI-related money on record</p> : (
        <ul className="rpanel-money" aria-label="AI-related money on record">
          {s.lines.slice(0, SHOW).map((l, i) => (
            <li key={i}>
              <span className="rpanel-who"><Link href={`/node/${l.actor}`}>{l.actor_name}</Link>{" "}
                <span className={`rpanel-kind k-${l.kind}`}>{l.kind === "gave" ? "gave to" : l.kind}</span> {lastName(l.cand.name)}</span>
              <span className="rpanel-amt">{fmtMoney(l.amount)}</span>
            </li>
          ))}
          {s.lines.length > SHOW && <li className="rpanel-more">and {s.lines.length - SHOW} more on the {s.key.startsWith("race-") ? "race" : "candidate"} page</li>}
        </ul>
      )}
      {!quiet && (
        <p className="rpanel-foot">
          {s.outside > 0 && <span>{fmtMoney(s.outside)} outside spending</span>}
          {s.given > 0 && <span>{fmtMoney(s.given)} in direct contributions</span>}
        </p>
      )}
    </li>
  );
}

const MONEY = [["", "Any or none"], ["outside", "Outside spending"], ["given", "Direct contributions"], ["none", "No money on record"]] as const;

export default function RacePanels({ seats, sp }: { seats: Seat[]; sp: Record<string, string | string[] | undefined> }) {
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const cycles = [...new Set(seats.map((s) => s.cycle).filter(Boolean))].sort().reverse();
  const states = [...new Set(seats.map((s) => s.st))].sort((a, b) => STATE_NAMES[a].localeCompare(STATE_NAMES[b]));
  const cycle = cycles.includes(str("cycle")) ? str("cycle") : "";
  const st = states.includes(str("state")) ? str("state") : "";
  const office = ["sen", "house"].includes(str("office")) ? str("office") : "";
  const money = MONEY.some(([k]) => k && k === str("money")) ? str("money") : "";
  const shown = seats.filter((s) => (!cycle || s.cycle === cycle) && (!st || s.st === st) && (!office || s.office === office)
    && (!money || (money === "outside" ? s.outside > 0 : money === "given" ? s.given > 0 : !s.lines.length)))
    .sort((a, b) => STATE_NAMES[a.st].localeCompare(STATE_NAMES[b.st]) || (a.office === b.office ? 0 : a.office === "sen" ? -1 : 1)
      || (Number(a.district) || 0) - (Number(b.district) || 0) || b.cycle.localeCompare(a.cycle));
  const byState = new Map<string, Seat[]>();
  for (const s of shown) byState.set(s.st, [...(byState.get(s.st) ?? []), s]);
  const nStates = byState.size;
  const outside = shown.filter((s) => s.outside > 0).length, given = shown.filter((s) => s.given > 0).length;

  return (
    <>
      <form className="filters rfilters" action="/targets">
        <input type="hidden" name="kind" value="elections" />
        {cycles.length > 1 && <Select label="Election" name="cycle" defaultValue={cycle} submitOnChange
          options={[{ value: "", label: "Every cycle" }, ...cycles.map((c) => ({ value: c, label: `${c} election` }))]} />}
        <Select label="State" name="state" defaultValue={st} submitOnChange
          options={[{ value: "", label: "Every state" }, ...states.map((k) => ({ value: k, label: `${STATE_NAMES[k]} (${seats.filter((s) => s.st === k).length})` }))]} />
        <Select label="Office" name="office" defaultValue={office} submitOnChange
          options={[{ value: "", label: "Senate and House" }, { value: "sen", label: "U.S. Senate" }, { value: "house", label: "U.S. House" }]} />
        <Select label="Money" name="money" defaultValue={money} submitOnChange options={MONEY.map(([value, label]) => ({ value, label }))} />
        <noscript><button type="submit">Show</button></noscript>
        {(cycle || st || office || money) && <Link className="rfilters-clear" href="/targets?kind=elections" scroll={false}>Clear</Link>}
      </form>

      <p className="rlede">
        {shown.length} {shown.length === 1 ? "seat" : "seats"} in {nStates} {nStates === 1 ? "state" : "states"}: {outside} with outside spending by AI-focused groups,
        {" "}{given} with direct contributions. Each seat gets the same space, whatever was spent there.
      </p>

      {shown.length === 0 && <p className="muted">No seats match. <Link href="/targets?kind=elections">Show every seat</Link></p>}
      {[...byState].map(([k, list]) => (
        <section key={k} className="rstate" aria-labelledby={`rs-${k}`}>
          <h2 id={`rs-${k}`}>{STATE_NAMES[k]} <span className="muted">{list.length}</span></h2>
          <ul className="rpanels">{list.map((s) => <Panel key={s.key} s={s} />)}</ul>
        </section>
      ))}
    </>
  );
}
