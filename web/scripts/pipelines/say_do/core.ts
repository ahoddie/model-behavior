// Say-vs-do detection: pure logic. No database and no model calls in this file, so the eval and the live run share it.
// Positions come from the sd_positions view, money from sd_money_edges / sd_ie, versions from sd_bill_versions.
export type Stance = "support" | "oppose" | "support_if_amended" | "mixed" | "neutral";
export type Prec = "day" | "month" | "year";
export type Ev = { label: string; url: string; archive_url: string | null; date: string | null; ref_table?: string; ref_id?: string };

export type Pos = {
  actor_id: string; actor_name: string;
  target_id: string; target_label: string; target_type: string;
  stance: Stance; date: string | null; date_prec: Prec;
  channel: "said" | "did"; kind: string;           // kind: op-ed, letter, docket comment, support, oppose ...
  text: string;                                    // quote (<=25 words) or the source's own note/summary
  url: string; archive_url: string | null; ref_table: string; ref_id: string;
  scope?: string | null;
};
export type Version = { target_id: string; label: string; effective_from: string; substantive_change: boolean };
export type Edge = { from_id: string; to_id: string; amount: number; date: string | null; date_prec: Prec; subtype: string; url: string; archive_url: string | null; ref_table: string; ref_id: string };
export type IE = { spender_id: string; candidate_id: string; stance: "support" | "oppose"; amount: number | null; date: string | null; date_prec: Prec; url: string; archive_url: string | null; ref_id: string };

// ---- dates ---------------------------------------------------------------------------------------------------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDate(d: string | null, prec: Prec = "day", full = false): string {
  if (!d) return "undated";
  const [y, m, day] = d.slice(0, 10).split("-");
  if (prec === "year") return y;
  const mon = MONTHS[Number(m) - 1];
  if (prec === "month" || !full) return `${mon} ${y}`;
  return `${Number(day)} ${mon} ${y}`;
}
export const dayNum = (d: string) => Math.floor(Date.parse(d.slice(0, 10) + "T00:00:00Z") / 86400000);
export const gapDays = (a: string, b: string) => Math.abs(dayNum(a) - dayNum(b));

// ---- stance --------------------------------------------------------------------------------------------------------
export const polarity = (s: Stance | string | null) => (s === "support" ? 1 : s === "oppose" ? -1 : 0);
/** Strictly opposite: a plain support against a plain oppose. "Support if amended" and "mixed" never count as opposite,
 *  because a conditional position is compatible with a letter asking for changes. */
export const strictlyOpposite = (a: Stance, b: Stance) => polarity(a) * polarity(b) === -1;

// ---- bill versions -------------------------------------------------------------------------------------------------
/** Number of substantive versions in force on `date` (0 = before the first listed change). null = cannot tell. */
export function versionGroup(versions: Version[], date: string | null): number | null {
  if (!versions.length) return null;
  if (!date) return null;
  return versions.filter((v) => v.substantive_change && v.effective_from <= date.slice(0, 10)).length;
}
export function versionLabel(versions: Version[], date: string | null): string | null {
  if (!date) return null;
  const v = versions.filter((x) => x.effective_from <= date.slice(0, 10)).sort((a, b) => a.effective_from.localeCompare(b.effective_from)).pop();
  return v?.label ?? null;
}
/** Same version, different version, or unknown. Positions on different substantive versions are never compared. */
export function sameVersion(versions: Version[], a: string | null, b: string | null): "same" | "different" | "unknown" {
  if (!versions.length) return "unknown";
  const ga = versionGroup(versions, a), gb = versionGroup(versions, b);
  if (ga == null || gb == null) return "unknown";
  return ga === gb ? "same" : "different";
}

// ---- type 1: statement vs action -----------------------------------------------------------------------------------
export type PairGate = { ok: boolean; why: string; version: "same" | "different" | "unknown"; gap_days: number | null };
export const TYPE1_MAX_GAP_DAYS = 365;
/** Deterministic checks before any model call. `said` is a public statement, `did` a formal act with a stated position. */
export function gatePair(said: Pos, did: Pos, versions: Version[]): PairGate {
  const g = said.date && did.date ? gapDays(said.date, did.date) : null;
  const base = { version: "unknown" as const, gap_days: g };
  if (said.actor_id !== did.actor_id) return { ...base, ok: false, why: "different actor" };
  if (said.target_id !== did.target_id) return { ...base, ok: false, why: "different target" };
  if (said.channel !== "said" || did.channel !== "did") return { ...base, ok: false, why: "channels are not said and did" };
  if (!strictlyOpposite(said.stance, did.stance)) return { ...base, ok: false, why: "positions are not plainly opposite" };
  if (!said.date || !did.date) return { ...base, ok: false, why: "a date is missing" };
  const version = sameVersion(versions, said.date, did.date);
  if (version === "different") return { ok: false, why: "different bill versions", version, gap_days: g };
  if (g! > TYPE1_MAX_GAP_DAYS) return { ok: false, why: "more than 12 months apart (a change of mind is a type 4 question)", version, gap_days: g };
  return { ok: true, why: "ok", version, gap_days: g };
}

const KIND_PHRASE: Record<string, string> = {
  letter: "letter", "docket comment": "docket comment", "rfi comment": "RFI comment", "lobbied on": "lobbying disclosure",
  support: "listing in a committee analysis", oppose: "listing in a committee analysis", "support if amended": "listing in a committee analysis",
};
const verb = (s: Stance) => (s === "support" ? "supports" : s === "oppose" ? "opposes" : s === "support_if_amended" ? "supports if amended" : "has a mixed view of");
export const didPhrase = (p: Pos) => KIND_PHRASE[p.kind] ?? "filing";

export function describeType1(said: Pos, did: Pos): string {
  const verbBy = (p: Pos) => (p.kind === "letter" || p.kind === "docket comment" || p.kind === "rfi comment" ? "states opposition to" : "");
  void verbBy;
  const didVerb = did.stance === "oppose" ? "opposes" : "supports";
  return `Said it ${verb(said.stance)} ${said.target_label} (${fmtDate(said.date, said.date_prec)}); its ${didPhrase(did)} of ${fmtDate(did.date, did.date_prec)} ${didVerb} ${did.target_label}.`;
}

// ---- type 2: statement vs money ------------------------------------------------------------------------------------
export type Sponsor = { target_id: string; lawmaker_id: string; lawmaker_name: string; role: string; source_url: string; archive_url: string | null };
export type MoneyPath = { hops: Edge[]; names: Record<string, string>; ie: IE; sponsor: Sponsor; receipts: Record<string, number> };

/** All simple paths from `actor` through money edges (max `maxHops`) ending at a node that spent independent expenditures. */
export function findMoneyPaths(actor: string, edges: Edge[], ies: IE[], sponsors: Sponsor[], maxHops = 3): { hops: Edge[]; ie: IE; sponsor: Sponsor }[] {
  const out: { hops: Edge[]; ie: IE; sponsor: Sponsor }[] = [];
  const bySpender = new Map<string, IE[]>();
  for (const i of ies) (bySpender.get(i.spender_id) ?? bySpender.set(i.spender_id, []).get(i.spender_id)!).push(i);
  const byFrom = new Map<string, Edge[]>();
  for (const e of edges) (byFrom.get(e.from_id) ?? byFrom.set(e.from_id, []).get(e.from_id)!).push(e);
  const walk = (node: string, hops: Edge[], seen: Set<string>) => {
    const spent = bySpender.get(node);
    if (spent && hops.length) for (const ie of spent) for (const sp of sponsors) if (sp.lawmaker_id === ie.candidate_id) out.push({ hops: [...hops], ie, sponsor: sp });
    if (hops.length >= maxHops) return;
    for (const e of byFrom.get(node) ?? []) {
      if (seen.has(e.to_id)) continue;
      walk(e.to_id, [...hops, e], new Set([...seen, e.to_id]));
    }
  };
  walk(actor, [], new Set([actor]));
  return out;
}

/** Statement-vs-money gate. A statement of support conflicts with money spent against the target's sponsor; a statement of
 *  opposition conflicts with money spent for the sponsor. The last hop must be dated on or before the expenditure. */
export function gateMoney(said: Pos, path: { hops: Edge[]; ie: IE; sponsor: Sponsor }): { ok: boolean; why: string } {
  if (said.channel !== "said") return { ok: false, why: "statement is not a public statement" };
  if (said.stance !== "support" && said.stance !== "oppose") return { ok: false, why: "statement has no plain stance" };
  if (path.sponsor.target_id !== said.target_id) return { ok: false, why: "sponsor is not tied to the statement's target" };
  const against = said.stance === "support" ? "oppose" : "support";
  if (path.ie.stance !== against) return { ok: false, why: "spending points the same way as the statement" };
  if (path.hops[0].from_id !== said.actor_id) return { ok: false, why: "money did not come from the speaker" };
  for (let i = 1; i < path.hops.length; i++) if (path.hops[i].from_id !== path.hops[i - 1].to_id) return { ok: false, why: "chain is not connected" };
  const last = path.hops[path.hops.length - 1];
  if (!last.date || !path.ie.date) return { ok: false, why: "a date is missing" };
  if (last.date > path.ie.date) return { ok: false, why: "last transfer is dated after the spending" };
  for (let i = 1; i < path.hops.length; i++) if (path.hops[i - 1].date && path.hops[i].date && path.hops[i - 1].date! > path.hops[i].date!) return { ok: false, why: "hops are out of order" };
  return { ok: true, why: "ok" };
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export function describeType2(said: Pos, p: MoneyPath): string {
  const nm = (id: string) => p.names[id] ?? id;
  const hopTxt = p.hops.map((h, i) => {
    const share = p.receipts[h.to_id] ? `, ${(Math.min(100, (h.amount / p.receipts[h.to_id]) * 100)).toFixed(h.amount / p.receipts[h.to_id] < 0.1 ? 1 : 0)}% of ${nm(h.to_id)}'s recorded receipts` : "";
    return `${i === 0 ? nm(h.from_id) + " gave" : nm(h.from_id) + " gave"} ${usd(h.amount)} to ${nm(h.to_id)} (${fmtDate(h.date, h.date_prec)}${share})`;
  }).join(", which then ");
  const ieAmt = p.ie.amount ? `${usd(p.ie.amount)} in independent expenditures ` : "independent expenditures ";
  const dir = p.ie.stance === "oppose" ? "opposing" : "supporting";
  return `Said it ${verb(said.stance)} ${said.target_label} (${fmtDate(said.date, said.date_prec)}); ${hopTxt}; ${nm(p.ie.spender_id)} reported ${ieAmt}${dir} ${p.sponsor.lawmaker_name}, ${p.sponsor.role} of ${said.target_label} (${fmtDate(p.ie.date, p.ie.date_prec)}).`;
}

// ---- type 4: reversal near a funding or lobbying event -------------------------------------------------------------
export type Event = { kind: "funding" | "lobbying" | "filing"; date: string; date_prec: Prec; summary: string; url: string; archive_url: string | null; ref_table?: string; ref_id?: string };
export const TYPE4_WINDOW_DAYS = 120;
export function gateReversal(earlier: Pos, later: Pos, ev: Event, versions: Version[]): { ok: boolean; why: string; days: number | null } {
  if (earlier.actor_id !== later.actor_id) return { ok: false, why: "different actor", days: null };
  if (earlier.target_id !== later.target_id) return { ok: false, why: "different target", days: null };
  if (!earlier.date || !later.date) return { ok: false, why: "a stance date is missing", days: null };
  if (earlier.date_prec === "year" || later.date_prec === "year" || ev.date_prec === "year") return { ok: false, why: "dates are not precise enough", days: null };
  if (!strictlyOpposite(earlier.stance, later.stance)) return { ok: false, why: "no plain reversal", days: null };
  if (earlier.date >= later.date) return { ok: false, why: "stances are not in order", days: null };
  if (gapDays(earlier.date, later.date) < 14) return { ok: false, why: "stances are within two weeks (a type 1 question)", days: null };
  if (sameVersion(versions, earlier.date, later.date) === "different") return { ok: false, why: "different bill versions", days: null };
  const d = gapDays(later.date, ev.date);
  if (d > TYPE4_WINDOW_DAYS) return { ok: false, why: `event is ${d} days from the new stance`, days: d };
  return { ok: true, why: "ok", days: d };
}
export function describeType4(earlier: Pos, later: Pos, ev: Event): string {
  const rel = later.date! >= ev.date ? "after" : "before";
  void rel;
  return `Said it ${verb(earlier.stance)} ${earlier.target_label} (${fmtDate(earlier.date, earlier.date_prec, true)}) and ${verb(later.stance)} it (${fmtDate(later.date, later.date_prec, true)}); ${ev.summary} (${fmtDate(ev.date, ev.date_prec, true)}).`;
}

// ---- type 3 helpers ------------------------------------------------------------------------------------------------
export const quoteOk = (quote: string, source: string) => quote.trim().split(/\s+/).length <= 25 && norm(source).includes(norm(quote));
export const norm = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
export function describeType3(topic: string, before: { date: string; quote: string }, after: { date: string; quote: string | null }): string {
  const b = fmtDate(before.date, "day", true), a = fmtDate(after.date, "day", true);
  return after.quote
    ? `The page on ${topic} read "${before.quote}" (${b}); the version of ${a} reads "${after.quote}".`
    : `The page on ${topic} included "${before.quote}" (${b}); the version of ${a} does not include it.`;
}

// ---- wording rule --------------------------------------------------------------------------------------------------
const BANNED = /hypocri|contradict|despite|flip-?flop|betray|inconsisten|u-?turn|back-?track|duplicit|double standard|caught|exposed|admit/i;
export function neutral(text: string): boolean { return !BANNED.test(text); }
export function assertNeutral(text: string) { if (!neutral(text)) throw new Error(`description is not neutral: ${text}`); return text; }

// ---- scoring -------------------------------------------------------------------------------------------------------
export const SEVERITY = { statement_vs_action: 3, statement_vs_money: 2, commitment_weakened: 2, reversal_near_event: 1 } as const;
export function severityFor(type: keyof typeof SEVERITY, didKind?: string): 1 | 2 | 3 {
  if (type === "statement_vs_action") return didKind === "letter" || didKind === "docket comment" || didKind === "rfi comment" ? 3 : 2;
  return SEVERITY[type] as 1 | 2 | 3;
}
