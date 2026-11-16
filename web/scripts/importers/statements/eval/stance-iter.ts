// Stance experiments on the gold set, reusing cached prompt A/B answers from the main eval results.
//   pnpm tsx scripts/importers/statements/eval/stance-iter.ts gate     gate (v1) in front of A: predicted none when the gate says no view
import "../../../env.ts";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../../env.ts";
import * as J from "../judge.ts";
const dir = join(REPO, "data/eval/statements");
const gold = readFileSync(join(dir, "gold.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const base = new Map(readFileSync(join(dir, readdirSync(dir).filter((f) => f.startsWith("results-stmt-relevance-v1"))[0]), "utf8").split("\n").filter(Boolean).map((l) => [JSON.parse(l).id, JSON.parse(l)]));
const out = join(dir, "iter-gate-v2.jsonl");
const done = new Map<string, any>(existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => [JSON.parse(l).id, JSON.parse(l)]) : []);
const items = gold.filter((g) => g.relevant && (g.target || g.issue) && base.get(g.id)?.oA);
for (const g of items) {
  if (done.has(g.id)) continue;
  const prop = g.target ? { kind: "target" as const, id: g.target } : { kind: "issue" as const, id: g.issue };
  let row: any;
  try { const r = await J.stanceGate(g.person ?? g.speaker ?? "the speaker", g.text, prop as any); row = { id: g.id, opinion: r.opinion, evidence: r.evidence }; }
  catch { row = { id: g.id, opinion: true, evidence: "gate failed" }; }
  appendFileSync(out, JSON.stringify(row) + "\n"); done.set(g.id, row);
}
const acc = (f: (g: any, b: any, d: any) => string) => items.filter((g) => f(g, base.get(g.id), done.get(g.id)) === g.stance).length / items.length;
const prec = (f: (g: any, b: any, d: any) => string, c: string) => { const sel = items.filter((g) => f(g, base.get(g.id), done.get(g.id)) === c); return `${c}: n=${sel.length} precision ${(sel.filter((g) => g.stance === c).length / Math.max(1, sel.length)).toFixed(2)}`; };
const A = (_g: any, b: any) => b.oA, G = (_g: any, b: any, d: any) => (d.opinion ? b.oA : "none");
const AGREE = (_g: any, b: any, d: any) => (!d.opinion ? "none" : b.oA === b.oB ? b.oA : "disagree");
for (const [n, f] of [["A alone", A], ["gate + A", G], ["gate + A/B agree", AGREE]] as const) console.log(n, "accuracy", acc(f).toFixed(2), ["support", "oppose", "mixed", "none"].map((c) => prec(f, c)).join(" | "));

// ---- prompt C and combinations -------------------------------------------------------------------------------------------------
const outC = join(dir, "iter-c-v1.jsonl");
const doneC = new Map<string, any>(existsSync(outC) ? readFileSync(outC, "utf8").split("\n").filter(Boolean).map((l) => [JSON.parse(l).id, JSON.parse(l)]) : []);
for (const g of items) {
  if (doneC.has(g.id)) continue;
  const prop = g.target ? { kind: "target" as const, id: g.target } : { kind: "issue" as const, id: g.issue };
  let row: any;
  try { const r = await J.stanceC(g.person ?? g.speaker ?? "the speaker", g.text, prop as any); row = { id: g.id, c: r.stance }; } catch { row = { id: g.id, c: "none" }; }
  appendFileSync(outC, JSON.stringify(row) + "\n"); doneC.set(g.id, row);
}
const lab = (g: any) => g.stance;
const combos: [string, (b: any, d: any, c: any) => string][] = [
  ["C alone", (_b, _d, c) => c.c],
  ["gate + C", (_b, d, c) => (d.opinion ? c.c : "none")],
  ["A=B=C", (b, _d, c) => (b.oA === b.oB && b.oB === c.c ? c.c : "disagree")],
  ["gate + A=B=C", (b, d, c) => (!d.opinion ? "none" : b.oA === b.oB && b.oB === c.c ? c.c : "disagree")],
  ["A=C", (b, _d, c) => (b.oA === c.c ? c.c : "disagree")],
  ["gate + A=C", (b, d, c) => (!d.opinion ? "none" : b.oA === c.c ? c.c : "disagree")],
];
for (const [n, f] of combos) {
  const pred = items.map((g) => ({ g, p: f(base.get(g.id), done.get(g.id), doneC.get(g.id)) }));
  const kept = pred.filter((x) => x.p !== "disagree");
  const sk = pred.filter((x: any) => ["support", "oppose"].includes(x.p));
  console.log(n.padEnd(14), "answered", kept.length, "accuracy on answered", (kept.filter((x: any) => x.p === lab(x.g)).length / Math.max(1, kept.length)).toFixed(2), "| support/oppose calls", sk.length, "precision", (sk.filter((x: any) => x.p === lab(x.g)).length / Math.max(1, sk.length)).toFixed(2));
}
