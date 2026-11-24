import { fmtDate } from "./format";

// General-election results, stored additively in nodes.external_ids.result (written by scripts/fix/load-election-results.ts).
//  - On a race node: the whole race, one row per candidate above 1% (pct is the share of all votes cast).
//  - On a candidate (lawmaker) node: that candidate's own outcome, including seats that were not up that year.
export type RaceResultCandidate = { id: string | null; name: string; party: string | null; votes: number | null; pct: number | null; winner: boolean };
export type RaceResult = {
  election: string;                       // "2026-11-03"
  status: "called" | "uncalled" | "runoff" | "not_up";
  official: boolean;                      // certified, or unofficial results as of `as_of`
  as_of: string | null;
  runoff_date?: string | null;
  winner: string | null;                  // node id of the winner when tracked
  winner_name: string | null;
  candidates: RaceResultCandidate[];
  source_url: string;
  source_name: string;
  note?: string | null;
};
export type Outcome = "won" | "lost" | "lost_primary" | "withdrew" | "died" | "not_on_ballot" | "runoff" | "uncalled" | "not_up";
export type CandidateResult = {
  election: string; race: string | null; outcome: Outcome; pct: number | null; official: boolean; as_of: string | null;
  note?: string | null; source_url: string; source_name?: string;
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  won: "Won", lost: "Lost", lost_primary: "Lost primary", withdrew: "Withdrew", died: "Died before the election",
  not_on_ballot: "Not on the ballot", runoff: "Runoff", uncalled: "Too close to call", not_up: "Seat not up",
};

export const fmtPct = (p: number | null | undefined) => (p == null ? "" : `${p.toFixed(1)}%`);

// One short phrase for a candidate's outcome, such as "Won, 52.1%" or "Lost primary".
export function outcomeText(r: CandidateResult | null | undefined): string | null {
  if (!r) return null;
  const label = OUTCOME_LABEL[r.outcome] ?? r.outcome;
  return r.pct != null && (r.outcome === "won" || r.outcome === "lost" || r.outcome === "runoff" || r.outcome === "uncalled") ? `${label}, ${fmtPct(r.pct)}` : label;
}

// "Certified results", "Unofficial results as of Nov 20, 2026", "Too close to call", or a runoff line.
export function statusText(r: RaceResult): string {
  if (r.status === "not_up") return "Seat not up in this election";
  if (r.status === "runoff") return r.runoff_date ? `Runoff on ${fmtDate(r.runoff_date)}` : "Goes to a runoff";
  if (r.status === "uncalled") return "Too close to call";
  return r.official ? "Certified results" : r.as_of ? `Unofficial results as of ${fmtDate(r.as_of)}` : "Unofficial results";
}
