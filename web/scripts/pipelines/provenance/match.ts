// provenance:match — find which earlier texts a bill's wording came from.
//   --candidates            split every text into clauses and find candidate pairs by fuzzy overlap (no model); fills prov_cands
//   --llm [--limit N]       ask the local model one question per candidate (highest score first); resumable
//   --store                 apply data/eval/provenance/thresholds.json, insert prov_matches (pending) and enqueue each for review
// Only a source dated strictly before the bill version can be a source; a bill never matches its own earlier versions.
import { q, pool, readText, EVAL_DIR } from "./lib.ts";
import { isBoilerplate, sourceMentionsBill } from "./filters.ts";
import { splitClauses, words, shingles, overlap, excerpt, STOP } from "./clauses.ts";
import { llmJson } from "../../lib/llm.ts";
import { enqueue } from "../../lib/review.ts";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string, d?: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);

type TextRow = { id: number; bill_node_id: string | null; version: string | null; source_kind: string; title: string; author_id: string | null; text_date: string; url: string; archive_url: string | null; text_path: string; n_words: number };
const texts = await q<TextRow>(`SELECT id, bill_node_id, version, source_kind, title, author_id, text_date::text, url, archive_url, text_path, n_words FROM prov_texts ORDER BY text_date, id`);
const byId = new Map(texts.map((t) => [Number(t.id), t]));

// ------------------------------------------------------------------------------------------------------------------------
if (has("--candidates")) {
  const MIN_CONT = Number(arg("--min-containment", "0.3")), MIN_COS = Number(arg("--min-cosine", "0.6")), MIN_JAC = Number(arg("--min-jaccard", "0.2"));
  type Cl = { text: number; idx: number; raw: string; tok: string[]; sh: Set<string>; terms: Map<string, number>; norm: number };
  const clauses: Cl[] = [];
  for (const t of texts) {
    const cs = splitClauses(readText(t.text_path));
    cs.forEach((raw, idx) => { const tok = words(raw); clauses.push({ text: t.id, idx, raw, tok, sh: shingles(tok), terms: new Map(), norm: 0 }); });
  }
  console.log(`${texts.length} texts, ${clauses.length} clauses`);
  // document frequency for tf-idf over unigrams
  const df = new Map<string, number>();
  for (const c of clauses) for (const w of new Set(c.tok)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = clauses.length, idf = (w: string) => Math.log((N + 1) / ((df.get(w) ?? 0) + 1));
  for (const c of clauses) {
    let n = 0;
    for (const w of c.tok) c.terms.set(w, (c.terms.get(w) ?? 0) + 1);
    for (const [w, tf] of c.terms) { const v = (1 + Math.log(tf)) * idf(w); c.terms.set(w, v); n += v * v; }
    c.norm = Math.sqrt(n) || 1;
  }
  // inverted indexes
  const shIdx = new Map<string, number[]>(), tIdx = new Map<string, number[]>();
  clauses.forEach((c, i) => {
    for (const s of c.sh) { let a = shIdx.get(s); if (!a) shIdx.set(s, (a = [])); a.push(i); }
    for (const w of c.terms.keys()) if ((df.get(w) ?? 0) <= 300 && !STOP.has(w)) { let a = tIdx.get(w); if (!a) tIdx.set(w, (a = [])); a.push(i); }
  });
  const seenBillClause = new Map<string, Set<string>>();     // per tracked bill: clauses already handled in an earlier version
  await pool.query(`DELETE FROM prov_cands WHERE relation IS NULL`);   // keep model verdicts, rebuild the rest
  let kept = 0;
  const billTexts = texts.filter((t) => t.bill_node_id).sort((a, b) => a.text_date.localeCompare(b.text_date));
  const clByText = new Map<number, number[]>();
  clauses.forEach((c, i) => { let a = clByText.get(c.text); if (!a) clByText.set(c.text, (a = [])); a.push(i); });
  for (const bt of billTexts) {
    const seen = seenBillClause.get(bt.bill_node_id!) ?? new Set<string>();
    seenBillClause.set(bt.bill_node_id!, seen);
    for (const ci of clByText.get(bt.id) ?? []) {
      const c = clauses[ci];
      if (c.tok.length < 14) continue;
      const key = c.tok.join(" ");
      if (seen.has(key)) continue;            // same clause in an earlier version of this bill: the earlier version carries it
      seen.add(key);
      const sharedSh = new Map<number, number>(), tAcc = new Map<number, number>();
      for (const s of c.sh) { const p = shIdx.get(s); if (p && p.length <= 400) for (const j of p) sharedSh.set(j, (sharedSh.get(j) ?? 0) + 1); }
      for (const [w, v] of c.terms) { const p = tIdx.get(w); if (p) for (const j of p) tAcc.set(j, (tAcc.get(j) ?? 0) + v * v / 1); }
      const pool_ = new Set<number>(sharedSh.keys());
      [...tAcc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([j]) => pool_.add(j));
      const found: { j: number; cont: number; jac: number; cos: number }[] = [];
      for (const j of pool_) {
        const o = clauses[j];
        const ot = byId.get(o.text)!;
        if (o.text === c.text || ot.text_date >= bt.text_date) continue;           // the source must be older than the bill version
        if (ot.bill_node_id && ot.bill_node_id === bt.bill_node_id) continue;      // not the bill's own earlier versions
        if (o.tok.length < 10) continue;
        const inter = overlap(c.sh, o.sh);
        const cont = c.sh.size ? inter / c.sh.size : 0, jac = inter / (c.sh.size + o.sh.size - inter || 1);
        let dot = 0; for (const [w, v] of c.terms) { const ov = o.terms.get(w); if (ov) dot += v * ov; }
        const cos = dot / (c.norm * o.norm);
        const sharedContent = [...c.terms.keys()].filter((w) => o.terms.has(w) && !STOP.has(w)).length;
        if ((cont >= MIN_CONT || jac >= MIN_JAC || cos >= MIN_COS) && sharedContent >= 5) found.push({ j, cont, jac, cos });
      }
      found.sort((a, b) => Math.max(b.cont, b.jac, b.cos) - Math.max(a.cont, a.jac, a.cos));
      for (const f of found.slice(0, 3)) {
        const o = clauses[f.j], score = Math.max(f.cont, f.jac, f.cos);
        await pool.query(
          `INSERT INTO prov_cands (bill_text_id, bill_clause, src_text_id, src_clause, shingle_jaccard, containment, cosine, score, bill_text, src_text)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (bill_text_id, bill_clause, src_text_id, src_clause) DO UPDATE SET shingle_jaccard=$5, containment=$6, cosine=$7, score=$8, bill_text=$9, src_text=$10`,
          [bt.id, c.idx, o.text, o.idx, f.jac, f.cont, f.cos, score, c.raw, o.raw]);
        kept++;
      }
    }
    console.log(`  ${bt.bill_node_id} ${bt.version}: ${kept} candidates so far`);
  }
  const dist = await q(`SELECT width_bucket(score, 0, 1, 5) b, count(*) FROM prov_cands GROUP BY 1 ORDER BY 1`);
  console.log("score buckets (0.2 wide):", JSON.stringify(dist));
}

if (has("--prune")) {
  const rows = await q<any>(`SELECT c.id, c.bill_text, c.src_text, c.bill_text_id, c.src_text_id FROM prov_cands c WHERE c.relation IS NULL`);
  let n = 0;
  for (const r of rows) {
    const b = byId.get(Number(r.bill_text_id))!, s = byId.get(Number(r.src_text_id))!;
    if (isBoilerplate(r.bill_text, r.src_text) || (b.bill_node_id && sourceMentionsBill(s, b.bill_node_id))) { await pool.query(`DELETE FROM prov_cands WHERE id=$1`, [r.id]); n++; }
  }
  console.log(`pruned ${n} of ${rows.length} unscored candidates (boilerplate or commentary on the bill itself)`);
}

// ------------------------------------------------------------------------------------------------------------------------
const SYSTEM = `You compare two passages and decide whether the later passage's wording was taken from the earlier one.
You judge wording only. Same topic or the same kind of rule is not enough: the later passage must reuse the earlier passage's specific words, phrases, definitions, numbers or sentence structure.
Answer with one of these words in "relation":
- word_for_word: the later passage repeats the earlier one's wording, apart from tiny changes such as names, numbers or a few connecting words.
- lightly_edited: the later passage keeps most of the earlier one's distinctive wording but rearranges, trims, or swaps some words.
- paraphrase: the later passage says the same specific thing in clearly different words, with only a few shared phrases.
- not_related: the overlap is only common legal boilerplate, common words, or the same general topic.
Write "reason" first: one short sentence naming the shared words or phrases (or saying there are none).`;
const SCHEMA = { type: "object", properties: { reason: { type: "string" }, relation: { type: "string", enum: ["word_for_word", "lightly_edited", "paraphrase", "not_related"] } }, required: ["reason", "relation"], additionalProperties: false };
const clip = (s: string, n = 110) => s.split(/\s+/).slice(0, n).join(" ");

if (has("--llm")) {
  const limit = Number(arg("--limit", "50"));
  const minScore = Number(arg("--min-score", "0"));
  const ids: number[] | null = has("--ids") ? (JSON.parse(readFileSync(join(EVAL_DIR, "pairs.json"), "utf8")) as { id: number }[]).map((p) => p.id) : null;
  const rows = await q<{ id: number; bill_text: string; src_text: string; score: number }>(
    `SELECT id, bill_text, src_text, score FROM (
       SELECT c.*, row_number() OVER (PARTITION BY bill_text_id, src_text_id ORDER BY score DESC) AS rk FROM prov_cands c WHERE relation IS NULL AND score >= $2 AND ($3::bigint[] IS NULL OR id = ANY($3))) x
     WHERE rk <= $4 ORDER BY ${has("--spread") ? "md5(id::text)" : "score DESC"} LIMIT $1`, [limit, minScore, ids, Number(arg("--cap-per-pair", "1000000"))]);
  console.log(`${rows.length} candidates to ask about`);
  let n = 0;
  for (const r of rows) {
    const t0 = Date.now();
    try {
      const { data, meta } = await llmJson<{ reason: string; relation: string }>({
        promptVersion: "wording-v1", system: SYSTEM, schema: SCHEMA, maxTokens: 160,
        user: `EARLIER PASSAGE:\n${clip(r.src_text)}\n\nLATER PASSAGE:\n${clip(r.bill_text)}\n\nWas the later passage's wording taken from the earlier passage?` });
      await pool.query(`UPDATE prov_cands SET relation=$2, reason=$3, llm_meta=$4 WHERE id=$1`, [r.id, data.relation, data.reason.slice(0, 400), JSON.stringify(meta)]);
    } catch (e) { console.log(`  cand ${r.id} failed: ${(e as Error).message}`); }
    n++;
    if (n % 5 === 0) console.log(`  ${n}/${rows.length} (${Math.round((Date.now() - t0) / 1000)}s last)`);
  }
}

// ------------------------------------------------------------------------------------------------------------------------
if (has("--unstore-filtered")) {
  // Remove our own pending matches that the deterministic filters reject (they were asked about before pruning ran).
  const ms = await q<any>(`SELECT m.id, c.bill_text, c.src_text, c.bill_text_id, c.src_text_id FROM prov_matches m JOIN prov_cands c ON c.match_id = m.id WHERE m.status='pending'`);
  let n = 0;
  for (const m of ms) {
    const b = byId.get(Number(m.bill_text_id))!, s = byId.get(Number(m.src_text_id))!;
    if (isBoilerplate(m.bill_text, m.src_text) || sourceMentionsBill(s, b.bill_node_id!)) {
      await pool.query(`DELETE FROM review_queue WHERE source_workstream='provenance' AND kind='wording_match' AND ref_table='prov_matches' AND ref_id=$1 AND status='pending'`, [String(m.id)]);
      await pool.query(`UPDATE prov_cands SET match_id=NULL WHERE match_id=$1`, [m.id]);
      await pool.query(`DELETE FROM prov_matches WHERE id=$1`, [m.id]); n++;
    }
  }
  console.log({ removed: n });
}
if (has("--store")) {
  const f = join(EVAL_DIR, "thresholds.json");
  if (!existsSync(f)) throw new Error("run provenance:eval first: data/eval/provenance/thresholds.json is missing");
  const th = JSON.parse(readFileSync(f, "utf8")) as { min_score: number; relations: string[]; min_containment_verbatim: number };
  const rows = await q<any>(`SELECT * FROM prov_cands WHERE relation = ANY($1) AND score >= $2 AND match_id IS NULL ORDER BY score DESC`, [th.relations, th.min_score]);
  let ins = 0;
  for (const r of rows) {
    const b = byId.get(Number(r.bill_text_id))!, s = byId.get(Number(r.src_text_id))!;
    if (!(s.text_date < b.text_date) || !b.bill_node_id) continue;
    if (isBoilerplate(r.bill_text, r.src_text) || sourceMentionsBill(s, b.bill_node_id)) continue;
    let kind: "verbatim" | "light_edit" | "paraphrase" = r.relation === "word_for_word" ? "verbatim" : r.relation === "lightly_edited" ? "light_edit" : "paraphrase";
    if (kind === "verbatim" && r.containment < th.min_containment_verbatim) kind = "light_edit";            // code check on the model's word
    if (kind === "light_edit" && r.containment < 0.3 && r.shingle_jaccard < 0.2) kind = "paraphrase";
    const meta = { cand_id: String(r.id), model: r.llm_meta, reason: r.reason, containment: r.containment, jaccard: r.shingle_jaccard, cosine: r.cosine, machine_label: true, labeled_by: "local model + threshold rule", thresholds: th };
    const m = await pool.query(
      `INSERT INTO prov_matches (bill_node_id, bill_version, bill_date, bill_url, bill_archive_url, bill_clause, source_kind, source_title, source_author_id, source_date, source_url, source_archive_url, source_clause, similarity, kind, status, extraction_meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending',$16)
       ON CONFLICT ((extraction_meta->>'cand_id')) DO NOTHING RETURNING id`,
      [b.bill_node_id, b.version, b.text_date, b.url, b.archive_url, excerpt(r.bill_text, r.src_text), s.source_kind, s.title, s.author_id, s.text_date, s.url, s.archive_url,
        excerpt(r.src_text, r.bill_text), r.score, kind, JSON.stringify(meta)]);
    if (!m.rows[0]) continue;
    await pool.query(`UPDATE prov_cands SET match_id=$2 WHERE id=$1`, [r.id, m.rows[0].id]);
    ins++;
    await enqueue({ workstream: "provenance", kind: "wording_match", refTable: "prov_matches", refId: m.rows[0].id,
      title: `${b.bill_node_id}: wording ${kind === "verbatim" ? "copied from" : kind === "light_edit" ? "lightly edited from" : "paraphrased from"} ${s.title.slice(0, 80)}`,
      payload: { rationale: r.reason, kind, similarity: r.score, bill_clause: r.bill_text, source_clause: r.src_text, machine_label: true },
      evidence: [{ label: `${b.bill_node_id} ${b.version ?? ""}`.trim(), url: b.url, archive_url: b.archive_url, date: b.text_date },
        { label: s.title, url: s.url, archive_url: s.archive_url, date: s.text_date }],
      confidence: Math.min(0.95, r.score), significance: r.score * (kind === "verbatim" ? 1 : kind === "light_edit" ? 0.7 : 0.4) });
  }
  console.log({ inserted: ins });
}
await pool.end();
