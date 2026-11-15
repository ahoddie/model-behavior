// provenance:eval — gold-set sampling and threshold tuning for "is this a real source match".
//   --sample N   write a stratified sample of candidate pairs to data/eval/provenance/pairs.json (no model verdict shown) for labeling
//   --score      read data/eval/provenance/gold.json (id -> 1 real source match | 0 not), tune the rule for precision >= 0.9, report recall
// The gold labels were written by a model (Claude), not by a person: see data/eval/provenance/README.md.
import { q, pool, EVAL_DIR, ensureDir } from "./lib.ts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
ensureDir(EVAL_DIR);
if (args.includes("--sample")) {
  const n = Number(args[args.indexOf("--sample") + 1] ?? 100);
  const bands: [number, number, number][] = [[0.3, 0.5, 0.25], [0.5, 0.7, 0.30], [0.7, 0.9, 0.25], [0.9, 1.01, 0.20]];
  const out: any[] = [];
  for (const [lo, hi, share] of bands) {
    const rows = await q<any>(`SELECT c.id, c.score, c.containment, c.shingle_jaccard, c.cosine, c.bill_text, c.src_text, b.bill_node_id, b.version, s.title AS src_title, s.text_date::text AS src_date
      FROM prov_cands c JOIN prov_texts b ON b.id=c.bill_text_id JOIN prov_texts s ON s.id=c.src_text_id
      WHERE c.score >= $1 AND c.score < $2 ORDER BY md5(c.id::text || 'gold1') LIMIT $3`, [lo, hi, Math.round(n * share)]);
    out.push(...rows);
  }
  writeFileSync(join(EVAL_DIR, "pairs.json"), JSON.stringify(out, null, 1));
  console.log(`wrote ${out.length} pairs`);
}

if (args.includes("--score")) {
  const gold = JSON.parse(readFileSync(join(EVAL_DIR, "gold.json"), "utf8")) as Record<string, { label: 0 | 1; note?: string }>;
  const ids = Object.keys(gold).map(Number);
  const rows = await q<any>(`SELECT id, score, containment, relation FROM prov_cands WHERE id = ANY($1)`, [ids]);
  const have = rows.filter((r) => r.relation);
  const pos = have.filter((r) => gold[r.id].label === 1).length;
  console.log(`${Object.keys(gold).length} labeled, ${have.length} with a model verdict, ${pos} real source matches`);
  const relSets: [string, string[]][] = [["word_for_word", ["word_for_word"]], ["word_for_word+lightly_edited", ["word_for_word", "lightly_edited"]], ["all but not_related", ["word_for_word", "lightly_edited", "paraphrase"]]];
  const results: any[] = [];
  for (const [name, rels] of relSets) for (let t = 0.3; t <= 1.0001; t += 0.05) {
    const pred = have.filter((r) => rels.includes(r.relation) && r.score >= t);
    const tp = pred.filter((r) => gold[r.id].label === 1).length;
    results.push({ relations: name, rel_list: rels, min_score: Number(t.toFixed(2)), predicted: pred.length, tp, precision: pred.length ? tp / pred.length : null, recall: pos ? tp / pos : null });
  }
  // score-only rule (no model), for comparison
  for (let t = 0.3; t <= 1.0001; t += 0.05) {
    const pred = have.filter((r) => r.score >= t); const tp = pred.filter((r) => gold[r.id].label === 1).length;
    results.push({ relations: "score only (no model)", rel_list: [], min_score: Number(t.toFixed(2)), predicted: pred.length, tp, precision: pred.length ? tp / pred.length : null, recall: pos ? tp / pos : null });
  }
  const ok = results.filter((r) => r.rel_list.length && r.precision != null && r.precision >= 0.9 && r.predicted >= 5).sort((a, b) => b.recall - a.recall || b.precision - a.precision);
  const best = ok[0];
  writeFileSync(join(EVAL_DIR, "results.json"), JSON.stringify({ n_labeled: Object.keys(gold).length, n_positive: pos, grid: results, chosen: best ?? null, labeled_by: "Claude (a model), not a person" }, null, 1));
  if (best) {
    writeFileSync(join(EVAL_DIR, "thresholds.json"), JSON.stringify({ min_score: best.min_score, relations: best.rel_list, min_containment_verbatim: 0.8, precision: best.precision, recall: best.recall, n_labeled: Object.keys(gold).length, labeled_by: "Claude (a model)" }, null, 1));
    console.log("chosen", JSON.stringify(best));
  } else console.log("no rule reaches precision 0.9 on this gold set");
  for (const r of results.filter((x) => x.rel_list.length === 2 || x.relations.startsWith("score"))) console.log(`${r.relations.padEnd(30)} t=${r.min_score} n=${r.predicted} P=${r.precision?.toFixed(2)} R=${r.recall?.toFixed(2)}`);
}
await pool.end();
