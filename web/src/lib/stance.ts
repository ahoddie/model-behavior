// How the Statements page places one actor on one topic, and how it keeps one quote from counting twice. Pure functions: no database.
export type Side = "agree" | "disagree" | "mixed" | "neutral";
type Dated = { v: number; date: string | null; mixed?: boolean };

// Dates come as "2024", "2024-07" or "2024-07-05". Two dates can be ordered only when neither is a prefix of the other:
// "2024" against "2024-07" could fall either side.
const after = (a: string | null, b: string | null) => !!a && !!b && !a.startsWith(b) && !b.startsWith(a) && a > b;
export const newestFirst = <T extends Dated>(items: T[]) => [...items].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));

// The newest statement that takes a side decides. If an older statement took the other side, the actor still goes with the
// newest and `changed` says so. If the two sides cannot be put in order (same date, or one undated), the actor is "mixed".
// An actor whose statements all take no side is "neutral".
// A reading marked `mixed` (the speaker backs part and rejects part) counts as taking a side: if it is the newest, the actor is mixed.
export function placeActor(items: Dated[]): { side: Side; changed: boolean } {
  const sided = newestFirst(items.filter((i) => i.v !== 0 || i.mixed));
  if (!sided.length) return { side: "neutral", changed: false };
  const latest = sided[0];
  if (latest.mixed) return { side: "mixed", changed: false };
  const side: Side = latest.v > 0 ? "agree" : "disagree";
  const other = sided.find((i) => !i.mixed && Math.sign(i.v) !== Math.sign(latest.v));
  if (!other) return { side, changed: false };
  return after(latest.date, other.date) ? { side, changed: true } : { side: "mixed", changed: false };
}

// The same quote is often filed under a person and under the organization they spoke for. On one topic it counts once:
// the organization keeps it, with the speaker named, and the person's copy is dropped. Co-authors (two people) each keep theirs.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export function countSharedQuotesOnce<T extends { kind: string; text: string; node_id: string; speaker?: string }>(rows: T[], who: Map<string, { name: string; type: string }>): T[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) if (r.kind === "quote") { const k = norm(r.text); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const drop = new Set<T>();
  for (const g of groups.values()) {
    const people = g.filter((r) => who.get(r.node_id)?.type === "person");
    const orgs = g.filter((r) => who.has(r.node_id) && who.get(r.node_id)!.type !== "person");
    if (!people.length || !orgs.length) continue;
    const names = [...new Set(people.map((r) => who.get(r.node_id)!.name))];
    const speaker = names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
    for (const p of people) drop.add(p);
    for (const o of orgs) o.speaker = speaker;
  }
  return rows.filter((r) => !drop.has(r));
}
