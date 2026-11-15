// Evaluates the pairwise scorer (and optionally the LLM judge) on data/eval/er/gold.jsonl.
//   pnpm er:eval [--llm [--limit N]] [--list-errors]
// The gold labels were made by the model, not a human (see gen-gold.ts). Metrics are pairwise:
//   auto-merge precision = auto pairs that are truly the same / all auto pairs; recall = truly-same pairs that reach 'auto' (and 'auto or review').
import { readFileSync, writeFileSync } from "node:fs";
import { THRESHOLDS, profileFromInput, scorePair } from "./score.ts";

const gold = readFileSync("../data/eval/er/gold.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const rows = gold.map((g) => ({ g, r: scorePair({ ...profileFromInput(g.a), id: "A" }, { ...profileFromInput(g.b), id: "B" }) }));
const pct = (n: number, d: number) => (d ? (n / d).toFixed(4) : "n/a");
function report(name: string, sel: typeof rows) {
  const pos = sel.filter((x) => x.g.label === "same"), neg = sel.filter((x) => x.g.label === "different");
  const auto = sel.filter((x) => x.r.decision === "auto"), rev = sel.filter((x) => x.r.decision === "review");
  const tp = auto.filter((x) => x.g.label === "same").length, fp = auto.length - tp;
  const revTp = rev.filter((x) => x.g.label === "same").length;
  return { subset: name, n: sel.length, positives: pos.length, negatives: neg.length, auto: auto.length, auto_tp: tp, auto_fp: fp, auto_precision: pct(tp, auto.length), auto_recall: pct(tp, pos.length), auto_or_review_recall: pct(tp + revTp, pos.length), review_pairs: rev.length, review_precision: pct(revTp, rev.length), neg_rejected: neg.filter((x) => x.r.decision === "reject").length };
}
const kinds = [...new Set(gold.map((g) => g.kind.split(":")[0]))];
const out = [report("all", rows), report("hard cases", rows.filter((x) => x.g.hard)), ...kinds.map((k) => report(`${k}:*`, rows.filter((x) => x.g.kind.startsWith(k + ":"))))];
console.table(out);
const errs = rows.filter((x) => (x.r.decision === "auto" && x.g.label === "different") || (x.r.decision === "reject" && x.g.label === "same" && !["person:name_only", "person:changed_employer_one_attr"].includes(x.g.kind)));
console.log(`\nauto false merges + unexpected misses: ${errs.length}`);
for (const e of errs.slice(0, process.argv.includes("--list-errors") ? 200 : 15)) console.log(`  [${e.g.id}] ${e.g.kind} gold=${e.g.label} got=${e.r.decision}(${e.r.score}) ${e.r.reason} :: ${e.g.a.name} | ${e.g.b.name}`);
const byKind = new Map<string, Record<string, number>>();
for (const x of rows) { const m = byKind.get(x.g.kind) ?? {}; const key = `${x.g.label}->${x.r.decision}`; m[key] = (m[key] ?? 0) + 1; byKind.set(x.g.kind, m); }
console.log("\nconfusion by kind (gold->decision):"); for (const [k, m] of [...byKind].sort()) console.log(`  ${k.padEnd(36)} ${JSON.stringify(m)}`);
// threshold sweep for the auto cutoff
const sweep = [0.8, 0.85, 0.9, 0.93, 0.95, 0.97].map((t) => { const a = rows.filter((x) => x.r.score >= t && x.r.decision !== "reject" && (x.r.groups.length >= 2 || x.r.rule)); const tp = a.filter((x) => x.g.label === "same").length; return { cutoff: t, auto: a.length, precision: pct(tp, a.length), recall: pct(tp, rows.filter((x) => x.g.label === "same").length) }; });
console.log("\nauto-cutoff sweep (decision!=reject with >=2 attributes or a rule):"); console.table(sweep);
writeFileSync("../data/eval/er/results.json", JSON.stringify({ generated_at: new Date().toISOString(), thresholds: THRESHOLDS, labeled_by: "model (Claude); not a human", summary: out, sweep }, null, 1));

if (process.argv.includes("--llm")) {
  const { judgePair } = await import("./judge.ts");
  const limit = Number(process.argv[process.argv.indexOf("--limit") + 1] || 60);
  const band = rows.filter((x) => x.r.decision === "review").slice(0, limit);
  let right = 0, unsure = 0, wrong = 0, agree = 0; const detail: any[] = [];
  for (const x of band) {
    const j = await judgePair({ ...profileFromInput(x.g.a), id: "A", name: x.g.a.name, descriptor: null } as any, { ...profileFromInput(x.g.b), id: "B", name: x.g.b.name, descriptor: null } as any);
    const pred = j.verdict === "same" ? "same" : j.verdict === "different" ? "different" : "unsure";
    if (j.agree) agree++;
    if (pred === "unsure") unsure++; else if (pred === x.g.label) right++; else wrong++;
    detail.push({ id: x.g.id, gold: x.g.label, verdict: j.verdict, agree: j.agree, kind: x.g.kind });
  }
  const sameVerdicts = detail.filter((d) => d.verdict === "same");
  console.log(`\nLLM judge on ${band.length} middle-band pairs: right=${right} wrong=${wrong} unsure=${unsure} both-prompts-agree=${agree}`);
  console.log(`  precision of "same" verdicts: ${pct(sameVerdicts.filter((d) => d.gold === "same").length, sameVerdicts.length)} (${sameVerdicts.length} verdicts)`);
  writeFileSync("../data/eval/er/results-llm.json", JSON.stringify({ generated_at: new Date().toISOString(), band: band.length, right, wrong, unsure, agree, detail }, null, 1));
}
