// The key stops on a bill's path, for the Trajectory track on its page: introduced, each chamber's floor passage, a final
// vote when one chamber voted again (concurrence), and how it ended. At most five. Committee steps and amendments are left
// off. A bill still moving gets its likely next stops as pending.
import type { BillActionRow, BillVoteRow } from "./data";

export type Stop = { label: string; date: string | null; tally?: string; state: "done" | "end" | "pending"; ended?: "veto" | "failed" };

// States whose lower chamber is the Assembly; elsewhere it is the House.
const ASSEMBLY = new Set(["ca", "ny", "nv", "nj", "wi"]);
const chamberName = (c: string | null, jurisdiction: string) =>
  c === "upper" ? "Senate" : c === "lower" ? (ASSEMBLY.has(jurisdiction.toLowerCase()) ? "Assembly" : "House") : null;
const FEDERAL = /^(us|federal)$/i;
const FLOOR = /floor|third reading|3rd reading|passage|final passage|on passage|concur/i;

export function billStops(b: {
  jurisdiction: string; stage: string; introduced_date: string | null; stage_date: string | null; chamber: string | null;
  actions: BillActionRow[]; votes: BillVoteRow[];
}): Stop[] {
  const stops: Stop[] = [];
  const introduced = b.actions.find((a) => a.kind === "introduced")?.date ?? b.introduced_date;
  stops.push({ label: "Introduced", date: introduced, state: "done" });

  // Floor votes that passed, in order. The first in each chamber is that chamber's passage; a later one is the final vote.
  const floor = b.votes.filter((v) => FLOOR.test(v.motion) && !/committee/i.test(v.motion) && v.result !== "failed");
  const passed = new Set<string>();
  for (const v of floor) {
    const name = chamberName(v.chamber, b.jurisdiction);
    const tally = v.yes != null && v.no != null ? `${v.yes}–${v.no}` : undefined;
    if (name && !passed.has(name)) { passed.add(name); stops.push({ label: `Passed ${name}`, date: v.date, tally, state: "done" }); }
    else if (passed.size >= 2) stops.push({ label: "Final vote", date: v.date, tally, state: "done" });
  }
  // Without roll calls, the actions still say when a chamber passed the bill.
  if (!floor.length) for (const a of b.actions.filter((x) => x.kind === "passed")) {
    const name = chamberName(a.chamber, b.jurisdiction) ?? (passed.size ? "second chamber" : "first chamber");
    if (!passed.has(name)) { passed.add(name); stops.push({ label: `Passed ${name}`, date: a.date, state: "done" }); }
  }

  const endDate = (kinds: string[]) => [...b.actions].reverse().find((a) => a.kind && kinds.includes(a.kind))?.date ?? b.stage_date;
  if (b.stage === "vetoed") stops.push({ label: "Vetoed", date: endDate(["vetoed"]), state: "end", ended: "veto" });
  else if (b.stage === "failed") stops.push({ label: "Failed", date: endDate(["failed"]), state: "end", ended: "failed" });
  else if (b.stage === "enacted") stops.push({ label: "Signed into law", date: endDate(["enacted", "signed"]), state: "end" });
  else {
    // Still moving: the stops it has yet to reach, hollow.
    const lower = chamberName("lower", b.jurisdiction)!;
    if (b.stage === "passed_one_chamber" && !passed.size) {
      stops.push({ label: "Passed one chamber", date: b.stage_date, state: "done" }, { label: "Passes the other chamber", date: null, state: "pending" });
    } else if (b.stage === "passed_legislature" && passed.size < 2) {
      stops.push({ label: "Passed the legislature", date: b.stage_date, state: "done" });
    } else {
      for (const c of ["Senate", lower]) if (!passed.has(c)) stops.push({ label: `Passes ${c}`, date: null, state: "pending" });
    }
    stops.push({ label: FEDERAL.test(b.jurisdiction) ? "Signed by the President" : "Signed by the Governor", date: null, state: "pending" });
  }

  // Five at most: keep the first, the last, and the latest floor stops.
  while (stops.length > 5) stops.splice(1, 1);
  return stops;
}
