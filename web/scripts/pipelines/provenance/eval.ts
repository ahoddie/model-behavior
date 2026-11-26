// provenance:eval — gold-set sampling and threshold tuning for "is this a real source match".
//   --sample N   write a stratified sample of candidate pairs to data/eval/provenance/pairs.json (no model verdict shown) for labeling
//   --score      read data/eval/provenance/gold.json (id -> 1 real source match | 0 not), tune the rule for precision >= 0.9, report recall
// The gold labels were written by a model (Claude), not by a person: see data/eval/provenance/README.md.
import { isBoilerplate, sourceMentionsBill } from "./filters.ts";
import { q, pool, EVAL_DIR, ensureDir } from "./lib.ts";
import { readFileSync, writeFileSync } from "node:fs";
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
  const all = await q<any>(`SELECT c.id, c.score, c.containment, c.relation, c.bill_text, c.src_text, b.bill_node_id, s.id AS sid, s.source_kind, s.text_path
    FROM prov_cands c JOIN prov_texts b ON b.id=c.bill_text_id JOIN prov_texts s ON s.id=c.src_text_id WHERE c.id = ANY($1)`, [ids]);
  // The deterministic filters run in the pipeline too, so a pair they remove counts as "not predicted".
  const kept = all.filter((r) => !isBoilerplate(r.bill_text, r.src_text) && !sourceMentionsBill({ id: r.sid, source_kind: r.source_kind, text_path: r.text_path }, r.bill_node_id));
  const pos = all.filter((r) => gold[r.id].label === 1).length;    // recall counts every real match, including ones the filters dropped
  console.log(`${all.length} labeled, ${pos} real source matches; filters keep ${kept.length} (dropped ${all.length - kept.length}, of which ${all.filter((r) => !kept.includes(r) && gold[r.id].label === 1).length} real)`);
  const mk = (name: string, rows: any[], t: number, rels: string[] | null) => {
    const pred = rows.filter((r) => r.score >= t && (!rels || rels.includes(r.relation)));
    const tp = pred.filter((r) => gold[r.id].label === 1).length;
    return { rule: name, min_score: Number(t.toFixed(2)), predicted: pred.length, tp, precision: pred.length ? tp / pred.length : null, recall: pos ? tp / pos : null };
  };
  const grid: any[] = [];
  for (let t = 0.3; t <= 1.0001; t += 0.05) grid.push(mk("score only", all, t, null), mk("score + filters", kept, t, null));
  const withModel = kept.filter((r) => r.relation);
  const confirmed = (rels: string[], name: string) => { for (let t = 0.3; t <= 1.0001; t += 0.05) grid.push({ ...mk(name, withModel, t, rels), n_with_verdict: withModel.length }); };
  confirmed(["word_for_word", "lightly_edited"], "score + filters + model says copied/edited");
  confirmed(["word_for_word", "lightly_edited", "paraphrase"], "score + filters + model says anything but not_related");
  const ok = grid.filter((r) => r.rule === "score + filters" && r.precision != null && r.precision >= 0.9 && r.predicted >= 8).sort((a, b) => b.recall - a.recall);
  const best = ok[0];
  writeFileSync(join(EVAL_DIR, "results.json"), JSON.stringify({ n_labeled: all.length, n_positive: pos, n_with_model_verdict: withModel.length, labeled_by: "Claude (a model), not a person", grid, chosen: best ?? null }, null, 1));
  for (const r of grid.filter((x) => [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].some((t) => Math.abs(t - x.min_score) < 0.001))) console.log(`${r.rule.padEnd(55)} t=${r.min_score.toFixed(2)} n=${String(r.predicted).padStart(3)} P=${r.precision?.toFixed(2) ?? "-"} R=${r.recall?.toFixed(2) ?? "-"}`);
  if (best) {
    writeFileSync(join(EVAL_DIR, "thresholds.json"), JSON.stringify({ min_score: best.min_score, relations: ["word_for_word", "lightly_edited", "paraphrase"], min_containment_verbatim: 0.8, precision: best.precision, recall: best.recall, n_labeled: all.length, rule: "score >= min_score after boilerplate and commentary filters; the local model then confirms (anything but not_related) and names the kind", labeled_by: "Claude (a model)" }, null, 1));
    console.log("chosen", JSON.stringify(best));
  } else console.log("no deterministic rule reaches precision 0.9 on this gold set");
}
await pool.end();
