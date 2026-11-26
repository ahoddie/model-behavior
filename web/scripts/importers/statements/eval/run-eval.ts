// Evaluation against the gold set (data/eval/statements/gold.jsonl). THE GOLD LABELS WERE WRITTEN BY CLAUDE (a model), not by a person;
// they are kept in data/eval/statements/ so the user can check and overrule them. Rerun after any prompt change:
//   pnpm statements:eval [--limit N]       resumable: per-item results are appended to data/eval/statements/results-<promptset>.jsonl
// Reports (written to data/eval/statements/REPORT.md):
//   relevance   precision/recall of the whole stage (prefilter + model) against gold `relevant`; prefilter recall on its own
//   stance      precision/recall per class for each prompt, given the GOLD proposition (isolates the stance step), and for the pipeline's own proposition
//   target      precision/recall of deterministic target detection against gold `target`
//   quote       share of model-proposed quotes that are verbatim substrings (strict, then after folding quotes/whitespace)
//   confidence  precision and coverage of the "high-confidence" subset (prompts agree + checks in code)
import "../../../env.ts";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../../env.ts";
import { analyzeUnit, PRIMARY_STANCE, type Unit } from "../pipeline.ts";
import * as J from "../judge.ts";
import { detectTargets } from "../taxonomy.ts";
import { passesPrefilter, words } from "../textutil.ts";

type Gold = { id: string; source: string; person: string; person_id: string | null; url: string; date: string; text: string; attribution: "direct" | "quoted" | "paraphrased"; quote_span?: string | null;
  relevant: boolean; issue: string | null; target: string | null; stance: "support" | "oppose" | "mixed" | "none"; reg_attitude?: number | null; names?: string[]; speaker?: string | null; note?: string };
const dir = join(REPO, "data/eval/statements");
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const gold: Gold[] = readFileSync(join(dir, "gold.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const resFile = join(dir, `results-${J.PROMPT_SET.replace(/[^\w.+-]/g, "_")}.jsonl`);
const done = new Map<string, any>(existsSync(resFile) ? readFileSync(resFile, "utf8").split("\n").filter(Boolean).map((l) => [JSON.parse(l).id, JSON.parse(l)]) : []);

async function evalItem(g: Gold) {
  const person = { id: g.person_id ?? "x", name: g.person ?? g.speaker ?? "the speaker", tier: 1 };
  const unit: Unit = { person, attribution: g.attribution, text: g.text, quoteSource: g.text, quote: g.attribution === "quoted" ? g.quote_span ?? undefined : undefined, speakerCheck: g.attribution === "quoted" };
  const pred: any = { id: g.id, prefilter: passesPrefilter(g.text), target: detectTargets(g.text)[0] ?? null };
  const a = await analyzeUnit(unit);
  Object.assign(pred, { relevant: a.relevant && a.outcome !== "irrelevant", outcome: a.outcome, stage: a.stage, issues: a.issues, p_target: a.target, p_stance: a.stance, stanceA: a.stanceA, stanceB: a.stanceB,
    agree: a.agree, high: a.high, quoteProposed: a.quoteProposed, quote: a.quote, quoteStrict: a.quoteStrict, regAttitude: a.regAttitude, primaryIssue: a.primaryIssue });
  // the stance step on its own, with the proposition a person would judge (gold target, else gold issue)
  if (g.relevant && (g.target || g.issue)) {
    const prop = g.target ? { kind: "target" as const, id: g.target } : { kind: "issue" as const, id: g.issue! };
    const sa = await J.stanceA(person.name, g.text, prop, g.attribution === "paraphrased");
    const sb = await J.stanceB(person.name, g.text, prop);
    const sg = await J.stanceGate(person.name, g.text, prop), sc = await J.stanceC(person.name, g.text, prop);
    pred.oA = sa.stance; pred.oB = sb.stance; pred.oC = sc.stance; pred.oGate = sg.opinion;
    pred.oFinal = sg.opinion ? sa.stance : "none";
    pred.oHigh = sg.opinion && sa.stance !== "none" && sa.stance === sb.stance && sb.stance === sc.stance;
  }
  return pred;
}

const todo = gold.filter((g) => !done.has(g.id)).slice(0, Number(arg("--limit") ?? 1e9));
console.log(`${gold.length} gold items, ${done.size} done, ${todo.length} to run`);
for (const g of todo) {
  const t0 = Date.now();
  try { const p = await evalItem(g); appendFileSync(resFile, JSON.stringify(p) + "\n"); done.set(g.id, p); console.log(`${g.id} ${Math.round((Date.now() - t0) / 1000)}s`); }
  catch (e) { console.warn(g.id, (e as Error).message); }
}

// ---- report ------------------------------------------------------------------------------------------------------------------------
const rows = gold.filter((g) => done.has(g.id)).map((g) => ({ g, p: done.get(g.id) }));
const pr = (tp: number, fp: number, fn: number) => ({ p: tp + fp ? tp / (tp + fp) : NaN, r: tp + fn ? tp / (tp + fn) : NaN, tp, fp, fn });
const f = (x: number) => (Number.isNaN(x) ? "n/a" : x.toFixed(2));
const line = (name: string, m: { p: number; r: number; tp: number; fp: number; fn: number }) => `| ${name} | ${f(m.p)} | ${f(m.r)} | ${m.tp} | ${m.fp} | ${m.fn} |`;
const count = (fn: (r: { g: Gold; p: any }) => boolean) => rows.filter(fn).length;
const out: string[] = [];
out.push(`# Statements evaluation`, ``, `Prompt set: \`${J.PROMPT_SET}\` (prefilter pf1; stance label stored from prompt ${PRIMARY_STANCE})`, `Gold items scored: ${rows.length} of ${gold.length}. **The gold labels were written by Claude (a model), not by a person.** They are in \`data/eval/statements/gold.jsonl\` for you to check.`, ``);
const bySource = new Map<string, number>(); for (const { g } of rows) bySource.set(g.source, (bySource.get(g.source) ?? 0) + 1);
out.push(`Items by source: ${[...bySource].map(([k, v]) => `${k} ${v}`).join(", ")}; distinct people: ${new Set(rows.map(({ g }) => g.person_id ?? g.person)).size}`, ``);
out.push(`## Relevance (about AI policy?)`, `| stage | precision | recall | tp | fp | fn |`, `|---|---|---|---|---|---|`);
out.push(line("whole stage", pr(count(({ g, p }) => g.relevant && p.relevant), count(({ g, p }) => !g.relevant && p.relevant), count(({ g, p }) => g.relevant && !p.relevant))));
out.push(line("prefilter alone", pr(count(({ g, p }) => g.relevant && p.prefilter), count(({ g, p }) => !g.relevant && p.prefilter), count(({ g, p }) => g.relevant && !p.prefilter))), ``);
out.push(`## Target (deterministic detection, taxonomy target id or none)`, `| | precision | recall | tp | fp | fn |`, `|---|---|---|---|---|---|`);
out.push(line("target", pr(count(({ g, p }) => !!g.target && p.target === g.target), count(({ g, p }) => !!p.target && p.target !== g.target), count(({ g, p }) => !!g.target && p.target !== g.target))), ``);
const classes = ["support", "oppose", "mixed", "none"] as const;
const stanceTable = (title: string, key: string, sel: ({ g, p }: { g: Gold; p: any }) => boolean) => {
  const rs = rows.filter(sel);
  out.push(`## ${title} (n=${rs.length})`, `| class | precision | recall | tp | fp | fn |`, `|---|---|---|---|---|---|`);
  for (const c of classes) out.push(line(c, pr(rs.filter(({ g, p }) => g.stance === c && p[key] === c).length, rs.filter(({ g, p }) => g.stance !== c && p[key] === c).length, rs.filter(({ g, p }) => g.stance === c && p[key] !== c).length)));
  out.push(`accuracy ${f(rs.filter(({ g, p }) => g.stance === p[key]).length / Math.max(1, rs.length))}`, ``);
};
const nn = (k: string) => ({ g, p }: { g: Gold; p: any }) => g.relevant && p[k] !== undefined && p[k] !== null;
stanceTable("Stance, prompt A, gold proposition", "oA", nn("oA"));
stanceTable("Stance, prompt B, gold proposition", "oB", nn("oB"));
stanceTable("Stance, final rule (gate, then prompt A), gold proposition", "oFinal", nn("oFinal"));
stanceTable("Stance, stored label end to end (pipeline's own proposition, gold-relevant items it kept)", "p_stance", nn("p_stance"));
const agreeRows = rows.filter(({ g, p }) => g.relevant && p.oA !== undefined && p.oA === p.oB);
out.push(`## Confidence`, `Definition: **high-confidence** = prompts A and B agree, the quote is verified verbatim, the speaker is checked (own channel, or model and code agree on who spoke) and, for support/oppose, the text has no hedge words. The model's own confidence number is not used.`, ``);
const hi = rows.filter(({ g, p }) => g.relevant && p.high && p.p_stance);
out.push(`- high-confidence items: ${hi.length} of ${rows.filter(({ g, p }) => g.relevant && p.p_stance).length}; stance precision on them: **${f(hi.filter(({ g, p }) => g.stance === p.p_stance).length / Math.max(1, hi.length))}** (target 0.90)`);
out.push(`- oracle-proposition stance where A and B agree: ${agreeRows.length} items, precision ${f(agreeRows.filter(({ g, p }) => g.stance === p.oA).length / Math.max(1, agreeRows.length))}`, ``);
const oh = rows.filter(({ g, p }) => g.relevant && p.oHigh);
out.push(`- final rule on the gold proposition (gate, A = B = C, support or oppose): ${oh.length} items, stance precision **${f(oh.filter(({ g, p }) => g.stance === p.oFinal).length / Math.max(1, oh.length))}**; with a direction on the gold side only: ${f(oh.filter(({ g, p }) => g.stance === p.oFinal && g.stance !== "none").length / Math.max(1, oh.filter(({ g }) => g.stance !== "none").length))}`, ``);
const qs = rows.filter(({ p }) => p.quoteProposed);
out.push(`## Quote match`, `Model-proposed quotes: ${qs.length}. Verbatim exact substring: ${qs.filter(({ p }) => p.quoteStrict === true).length}; verbatim after folding quotes/whitespace: ${qs.filter(({ p }) => p.quote).length} (${f(qs.filter(({ p }) => p.quote).length / Math.max(1, qs.length))}). Items longer than 25 words needing a model-picked quote: ${qs.filter(({ g }) => words(g.text) > 25).length}.`, ``);
const sp = rows.filter(({ g }) => g.attribution === "quoted" && g.speaker !== undefined);
out.push(`Attribution of news quotes (who spoke) is evaluated separately in the speaker table of REPORT-speaker.md when quoted gold items exist (n=${sp.length}).`);
writeFileSync(join(dir, "REPORT.md"), out.join("\n") + "\n");
console.log(out.join("\n"));
