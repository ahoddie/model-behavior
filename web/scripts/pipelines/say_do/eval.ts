// Eval for the say-vs-do detector. Reads data/eval/say_do/cases.json (merged from research/*.json) and runs each case through
// the same gates and model judgments the live run uses. The gold labels were made by an AI session, not a person.
// Usage: pnpm say-do:eval [--merge] [--no-llm] [--only t1,t2,t3,t4] [--verbose]
import "../../env.ts";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gatePair, gateMoney, gateReversal, strictlyOpposite, quoteOk, type Pos, type Edge, type IE, type Sponsor, type Event, type Stance } from "./core.ts";
import { judgePair, judgeCommitment } from "./judge.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "../../../../data/eval/say_do");
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const VERBOSE = process.argv.includes("--verbose");
const ONLY = arg("--only")?.split(",");

type Case = any;
const slug = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const TYPE_KEY: Record<string, string> = { statement_vs_action: "t1", statement_vs_money: "t2", commitment_weakened: "t3", reversal_near_event: "t4" };

if (process.argv.includes("--merge")) {
  const dir = join(DIR, "research");
  const all: Case[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) all.push(...JSON.parse(readFileSync(join(dir, f), "utf8")));
  const seen = new Set<string>();
  const out = all.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  writeFileSync(join(DIR, "cases.json"), JSON.stringify(out, null, 1));
  console.log(`merged ${out.length} cases (${out.filter((c) => c.kind === "positive").length} positive, ${out.filter((c) => c.kind === "negative").length} negative)`);
}

const stanceOf = (s: string | null | undefined): Stance => (s === "support" || s === "oppose" || s === "support_if_amended" || s === "mixed" ? s : "neutral") as Stance;
function pos(c: Case, side: "said" | "did", actorId: string): Pos {
  const x = c[side] ?? {};
  const scope = [x.scope, x.version ? `version: ${x.version}` : null].filter(Boolean).join("; ") || null;
  return { actor_id: actorId, actor_name: c.actor, target_id: slug(c.target?.label), target_label: c.target?.label ?? "", target_type: "bill",
    stance: stanceOf(x.stance), date: x.date ?? null, date_prec: String(x.date ?? "").length === 4 ? "year" : String(x.date ?? "").length === 7 ? "month" : "day",
    channel: side === "said" ? "said" : "did", kind: x.channel ?? x.kind ?? "other", text: x.quote ?? x.summary ?? "", url: x.url ?? "", archive_url: x.archive_url ?? null,
    ref_table: "eval", ref_id: c.id, scope };
}

async function predict(c: Case): Promise<{ flag: boolean; why: string }> {
  const actor = slug(c.actor);
  if (c.type === "statement_vs_action") {
    const said = pos(c, "said", actor), did = pos(c, "did", actor);
    const dv = c.did?.version, sv = c.said?.version;
    if (dv && sv && slug(dv) !== slug(sv)) return { flag: false, why: "different versions" };
    // Opposite-stance gate applies to the labelled stance. A said "oppose"/did "support" pair is also valid.
    const g = gatePair(said, did, []);
    if (!g.ok) return { flag: false, why: `gate: ${g.why}` };
    if (process.argv.includes("--no-llm")) return { flag: true, why: "gate only" };
    const v = await judgePair(said, did, c.target?.version ?? null);
    return { flag: v.flag, why: `same=${v.same.answer} conflict=${v.conflict.answer}` };
  }
  if (c.type === "statement_vs_money") {
    const said = pos(c, "said", actor);
    const m = c.money ?? {};
    const hops: Edge[] = (m.hops ?? []).map((h: any, i: number) => ({ from_id: slug(h.from), to_id: slug(h.to), amount: Number(h.amount) || 0, date: h.date ?? null, date_prec: "day" as const, subtype: "contribution", url: h.url ?? "", archive_url: h.archive_url ?? null, ref_table: "eval", ref_id: String(i) }));
    if (!hops.length) return { flag: false, why: "no hops" };
    const sponsorOk = m.sponsor_of_target === true;
    const sponsor: Sponsor = { target_id: sponsorOk ? said.target_id : "none", lawmaker_id: slug(m.spent_against), lawmaker_name: m.spent_against ?? "", role: "sponsor", source_url: m.sponsor_url ?? "", archive_url: null };
    const ie: IE = { spender_id: slug(m.spender), candidate_id: slug(m.spent_against), stance: m.ie_stance === "support" ? "support" : "oppose", amount: m.ie_amount ?? null, date: m.ie_date ?? null, date_prec: "day", url: m.ie_url ?? "", archive_url: null, ref_id: "ie" };
    if (hops[hops.length - 1].to_id !== ie.spender_id) return { flag: false, why: "chain does not reach the spender" };
    const g = gateMoney(said, { hops, ie, sponsor });
    return { flag: g.ok, why: g.why };
  }
  if (c.type === "reversal_near_event") {
    const e = pos(c, "said", actor), l = pos(c, "did", actor);
    l.channel = "said"; e.channel = "said";
    const ev: Event = { kind: c.event?.kind ?? "funding", date: c.event?.date ?? "", date_prec: String(c.event?.date ?? "").length === 7 ? "month" : String(c.event?.date ?? "").length === 4 ? "year" : "day", summary: c.event?.summary ?? "", url: c.event?.url ?? "", archive_url: null };
    if (!ev.date) return { flag: false, why: "no event date" };
    const g = gateReversal(e, l, ev, []);
    return { flag: g.ok, why: g.why };
  }
  if (c.type === "commitment_weakened") {
    const before = c.before?.text, after = c.after?.text;
    if (!before) return { flag: false, why: "no before text" };
    if (process.argv.includes("--no-llm")) return { flag: true, why: "gate only" };
    const r = await judgeCommitment(c.target?.label ?? "", before, after && after !== "absent" ? after : "");
    return { flag: r.flag, why: `q1=${r.q1.answer} q2=${r.q2.answer}` };
  }
  return { flag: false, why: "unknown type" };
}

const cases: Case[] = JSON.parse(readFileSync(join(DIR, "cases.json"), "utf8")).filter((c: Case) => !ONLY || ONLY.includes(TYPE_KEY[c.type]));
const rows: any[] = [];
for (const c of cases) {
  let p: { flag: boolean; why: string };
  try { p = await predict(c); } catch (e) { p = { flag: false, why: `error: ${String(e).slice(0, 80)}` }; }
  const gold = c.kind === "positive";
  rows.push({ id: c.id, type: c.type, gold, pred: p.flag, why: p.why, negative_reason: c.negative_reason });
  if (VERBOSE || gold !== p.flag) console.log(`${gold === p.flag ? "ok  " : gold ? "MISS" : "FALSE"}\t${c.id}\t${p.why}`);
}
function score(rs: any[]) {
  const tp = rs.filter((r) => r.gold && r.pred).length, fp = rs.filter((r) => !r.gold && r.pred).length, fn = rs.filter((r) => r.gold && !r.pred).length, tn = rs.filter((r) => !r.gold && !r.pred).length;
  return { n: rs.length, positives: tp + fn, negatives: fp + tn, tp, fp, fn, tn, precision: tp + fp ? +(tp / (tp + fp)).toFixed(3) : null, recall: tp + fn ? +(tp / (tp + fn)).toFixed(3) : null };
}
const byType: Record<string, any> = {};
for (const t of Object.keys(TYPE_KEY)) { const rs = rows.filter((r) => r.type === t); if (rs.length) byType[t] = score(rs); }
const out = { run_at: new Date().toISOString(), labeled_by: "AI session (Claude); not human-reviewed", overall: score(rows), by_type: byType, rows };
if (!ONLY) writeFileSync(join(DIR, "results.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ overall: out.overall, by_type: byType }, null, 1));
void strictlyOpposite; void quoteOk; void existsSync;
