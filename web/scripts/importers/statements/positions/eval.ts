// Scores the positions classifier against the statements gold set (data/eval/statements/gold.jsonl; labels written by Claude,
// not a person). Each gold item with an issue or target is read against that proposition, the same one the earlier eval used,
// so the numbers compare directly with REPORT.md. Writes data/eval/statements/REPORT-positions.md.
// Usage: node --experimental-strip-types scripts/importers/statements/positions/eval.ts [--limit N]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../../env.ts";
import { issueById, targetById } from "../taxonomy.ts";
import { classify, readingKey, PROMPT_VERSION, type Reading } from "./classify.ts";
import { queueReading, flushQueue } from "./queue.ts";
import { MODEL, usage, cost } from "./claude.ts";
import { AUTO_CONFIDENCE } from "./gate.ts";

const dir = join(REPO, "data/eval/statements");
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
type Gold = { id: string; person: string | null; text: string; issue: string | null; target: string | null; stance: "support" | "oppose" | "mixed" | "none" };
const gold: Gold[] = readFileSync(join(dir, "gold.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const items = gold.filter((g) => g.issue || g.target).slice(0, Number(arg("--limit") ?? 1e9));
const TO: Record<string, string> = { support: "agree", oppose: "disagree", mixed: "mixed", none: "none" };
const statementFor = (g: Gold) => g.target ? `The policy "${targetById(g.target)!.label}" should be adopted or kept.` : issueById(g.issue!)!.statement;

const results: { g: Gold; r: Reading }[] = [];
let i = 0;
async function worker() { while (i < items.length) {
  const g = items[i++], sp = g.person ?? "the speaker", st = statementFor(g);
  const r = await classify(sp, g.text, st);
  if (r) results.push({ g, r }); else queueReading({ key: readingKey(sp, g.text, st), speaker: sp, statement: st, quote: g.text });
} }
await Promise.all(Array.from({ length: 6 }, worker));
const files = flushQueue();
if (files.length) { console.log(`${items.length - results.length} readings are not stored yet and no API key is set. Queued for subagents:`); files.forEach((f) => console.log(" ", f)); process.exit(0); }
const pred = (r: Reading) => r.side ?? "none";

const f = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "–");
const out: string[] = [`# Positions classifier evaluation`, ``,
  `Prompt \`${PROMPT_VERSION}\` on \`${MODEL}\`. Gold items scored: ${results.length} (every gold item with an issue or target). **The gold labels were written by Claude (a model), not by a person**, so these numbers measure agreement with that labeling.`, ``,
  `Gold sides in this set: ${["agree", "disagree", "mixed", "none"].map((s) => `${s} ${results.filter(({ g }) => TO[g.stance] === s).length}`).join(", ")}. Disagree and mixed are thin, so their numbers move a lot with one item.`, ``];
function table(title: string, rows: { g: Gold; r: Reading }[]) {
  out.push(`## ${title} (n=${rows.length})`, `| class | precision | recall | tp | fp | fn |`, `|---|---|---|---|---|---|`);
  for (const c of ["agree", "disagree", "mixed", "none"]) {
    const tp = rows.filter(({ g, r }) => TO[g.stance] === c && pred(r) === c).length;
    const fp = rows.filter(({ g, r }) => TO[g.stance] !== c && pred(r) === c).length;
    const fn = rows.filter(({ g, r }) => TO[g.stance] === c && pred(r) !== c).length;
    out.push(`| ${c} | ${f(tp / (tp + fp))} | ${f(tp / (tp + fn))} | ${tp} | ${fp} | ${fn} |`);
  }
  const sided = rows.filter(({ r }) => r.side);
  const goldSided = rows.filter(({ g }) => g.stance !== "none");
  const ok = sided.filter(({ g, r }) => TO[g.stance] === r.side).length;
  out.push(``, `Any side (agree, disagree, or mixed): precision **${f(ok / sided.length)}** (${ok} of ${sided.length} readings that took a side match gold), recall **${f(ok / goldSided.length)}** (${ok} of ${goldSided.length} gold positions found with the right side). Direction errors (agree read as disagree, or the reverse): ${sided.filter(({ g, r }) => (TO[g.stance] === "agree" && r.side === "disagree") || (TO[g.stance] === "disagree" && r.side === "agree")).length}.`, ``);
}
table("All readings", results);
const auto = results.filter(({ r }) => r.side && r.confidence >= AUTO_CONFIDENCE);
out.push(`## The gate`, `A reading shows on the page without review when its confidence is at least ${AUTO_CONFIDENCE} and its quote was found word for word at its link (gold items are the source text, so the second check passes here). Everything else goes to /review.`, ``);
const autoOk = auto.filter(({ g, r }) => TO[g.stance] === r.side).length;
const gs = results.filter(({ g }) => g.stance !== "none").length;
out.push(`- Shown without review: ${auto.length} readings, precision **${f(autoOk / auto.length)}**, recall **${f(autoOk / gs)}** of gold positions.`);
const low = results.filter(({ r }) => r.side && r.confidence < AUTO_CONFIDENCE);
out.push(`- Sent to review: ${low.length} readings, of which ${low.filter(({ g, r }) => TO[g.stance] === r.side).length} match gold.`, ``);
out.push(`### Precision by confidence`, `| confidence | readings | precision |`, `|---|---|---|`);
for (const [lo, hi] of [[0.9, 1.01], [0.75, 0.9], [0.5, 0.75], [0, 0.5]]) {
  const b = results.filter(({ r }) => r.side && r.confidence >= lo && r.confidence < hi);
  out.push(`| ${lo}–${Math.min(hi, 1)} | ${b.length} | ${f(b.filter(({ g, r }) => TO[g.stance] === r.side).length / b.length)} |`);
}
out.push(``, `### Disagreements with gold, for a person to check`, ``);
for (const { g, r } of results.filter(({ g, r }) => TO[g.stance] !== pred(r)).slice(0, 40))
  out.push(`- \`${g.id}\` ${g.person}: gold **${TO[g.stance]}**, read **${pred(r)}** (${r.confidence}). ${r.reason.replace(/\n/g, " ")}`);
out.push(``, `Cost of this run: about $${cost().toFixed(2)} (${usage.calls} calls, ${usage.cached} from cache).`);
writeFileSync(join(dir, "REPORT-positions.md"), out.join("\n") + "\n");
writeFileSync(join(dir, `results-${PROMPT_VERSION}.jsonl`), results.map(({ g, r }) => JSON.stringify({ id: g.id, gold: TO[g.stance], ...r })).join("\n") + "\n");
console.log(out.slice(0, 40).join("\n"));
