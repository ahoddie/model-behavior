// Batch re-resolution of all existing nodes: block -> score -> judge middle band -> propose merges.
//   pnpm er:resolve-batch [--no-llm] [--limit N] [--watchlist path]
// Writes (all additive): er_candidates, merge_log (status 'proposed'), review_queue (middle band), er_id_proposals.
// Never touches nodes/links/feed_items/facts/filings; apply is a separate job (apply.ts) run by the orchestrator.
import { pool, q } from "../../../src/lib/db.ts";
import { enqueue } from "../../lib/review.ts";
import { keyFor, parsePerson } from "./normalize.ts";
import { loadStore } from "./profiles.ts";
import { judgePair } from "./judge.ts";
import { scorePair, type Profile } from "./score.ts";
import { detectServer } from "../../lib/llm.ts";

const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const useLlm = !process.argv.includes("--no-llm");
const limit = Number(arg("--limit") ?? 1e9);
const runId = `batch-${new Date().toISOString().slice(0, 16)}`;
const store = await loadStore(true, 0);
const nodes = [...store.byId.values()].filter((n) => !["bill", "race", "rule"].includes(n.type));   // targets have their own canonical IDs
const meta = new Map((await q<{ id: string; descriptor: string | null; source_url: string; archive_url: string | null }>(`SELECT id, descriptor, source_url, archive_url FROM nodes`)).map((r) => [r.id, r]));
const refCount = new Map<string, number>();
for (const r of await q<{ id: string; n: string }>(`SELECT id, sum(n)::text n FROM (
    SELECT from_id id, count(*) n FROM links GROUP BY 1 UNION ALL SELECT to_id, count(*) FROM links GROUP BY 1 UNION ALL SELECT node_id, count(*) FROM filings GROUP BY 1
    UNION ALL SELECT node_id, count(*) FROM feed_items GROUP BY 1 UNION ALL SELECT node_id, count(*) FROM facts GROUP BY 1) x GROUP BY id`)) refCount.set(r.id, Number(r.n));

// ---- blocking ----
const blocks = new Map<string, Set<string>>();
const add = (k: string, id: string) => { if (!k) return; (blocks.get(k) ?? blocks.set(k, new Set()).get(k)!).add(id); };
for (const n of nodes) {
  if (n.type === "person" || n.type === "lawmaker") {
    for (const nm of n.names) { const p = parsePerson(nm); if (p.last) { add(`p:${p.last}:${p.initial}`, n.id); add(`p:${p.last}:${p.canonFirst[0] ?? ""}`, n.id); } if (p.first && p.tokens.length === 2) add(`p:${p.first}:${p.last[0] ?? ""}`, n.id); }
  } else {
    const fam = n.type === "pac" ? "pac" : n.type === "agency" ? "agency" : "org";
    for (const nm of n.names) { const k = keyFor(n.type, nm); if (k.length >= 3) { add(`o:${fam}:${k}`, n.id); if (k.length >= 5) add(`o:${fam}:pre:${k.slice(0, 5)}`, n.id); } }
    for (const h of n.handles) add(`h:${h}`, n.id);
  }
  for (const [s, vs] of Object.entries(n.ids)) for (const v of vs) add(`id:${s}:${v}`, n.id);
}
const pairs = new Set<string>();
for (const ids of blocks.values()) { const a = [...ids]; if (a.length > 40) continue; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) pairs.add(a[i] < a[j] ? `${a[i]}|${a[j]}` : `${a[j]}|${a[i]}`); }
console.log(`nodes=${nodes.length} blocks=${blocks.size} candidate pairs=${pairs.size}`);

// ---- score ----
type Scored = { a: Profile; b: Profile; r: ReturnType<typeof scorePair> };
const scored: Scored[] = [];
for (const p of pairs) { const [x, y] = p.split("|"); const a = store.byId.get(x)!, b = store.byId.get(y)!; const r = scorePair(a, b); if (r.decision !== "reject" || r.conflicts.length) scored.push({ a, b, r }); }
scored.sort((x, y) => y.r.score - x.r.score);
const autos = scored.filter((s) => s.r.decision === "auto"), reviews = scored.filter((s) => s.r.decision === "review");
console.log(`auto=${autos.length} review=${reviews.length} rejected-with-conflict=${scored.filter((s) => s.r.decision === "reject").length}`);

// ---- judge the middle band ----
let llmOk = false;
if (useLlm) { try { await detectServer(); llmOk = true; } catch (e: any) { console.warn("no local model; middle band goes to review without a rationale:", e.message); } }
const judged = new Map<string, Awaited<ReturnType<typeof judgePair>>>();
if (llmOk) for (const s of reviews.slice(0, limit)) {
  try { judged.set(`${s.a.id}|${s.b.id}`, await judgePair({ ...s.a, descriptor: meta.get(s.a.id)?.descriptor, source: new URL(meta.get(s.a.id)!.source_url).hostname } as any, { ...s.b, descriptor: meta.get(s.b.id)?.descriptor, source: new URL(meta.get(s.b.id)!.source_url).hostname } as any)); }
  catch (e: any) { console.warn(`judge failed ${s.a.id} ~ ${s.b.id}: ${e.message}`); }
}

// ---- propose ----
const pickKept = (a: Profile, b: Profile) => {
  const ra = refCount.get(a.id) ?? 0, rb = refCount.get(b.id) ?? 0;
  const ga = a.id.startsWith("ent_") ? 0 : 1, gb = b.id.startsWith("ent_") ? 0 : 1;   // grandfathered ids win over provisional ones
  if (ga !== gb) return ga > gb ? [a, b] : [b, a];
  if (ra !== rb) return ra > rb ? [a, b] : [b, a];
  return a.id.length <= b.id.length ? [a, b] : [b, a];
};
// union-find so chains collapse onto one kept id
const parent = new Map<string, string>();
const find = (x: string): string => { let r = x; while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!; return r; };
const proposals: { kept: Profile; merged: Profile; s: Scored; method: "rule" | "llm"; j?: Awaited<ReturnType<typeof judgePair>> }[] = [];
const toPropose: { s: Scored; method: "rule" | "llm"; j?: any }[] = [];
for (const s of autos) toPropose.push({ s, method: "rule" });
for (const s of reviews) { const j = judged.get(`${s.a.id}|${s.b.id}`); if (j?.verdict === "same" && j.agree && s.a.type !== "person" && s.a.type !== "lawmaker") toPropose.push({ s, method: "llm", j }); }
for (const { s, method, j } of toPropose) {
  const ra = find(s.a.id), rb = find(s.b.id); if (ra === rb) continue;
  const [kept, merged] = pickKept(store.byId.get(ra)!, store.byId.get(rb)!);
  parent.set(merged.id, kept.id); proposals.push({ kept, merged, s, method, j });
}
const finalKept = (id: string) => find(id);

await pool.query(`SELECT set_config('mb.actor','er',false)`);
let logged = 0;
for (const p of proposals) {
  const keptId = finalKept(p.merged.id);
  const [exists] = await q(`SELECT id FROM merge_log WHERE action='merge' AND ((merged_id=$1 AND kept_id=$2) OR (merged_id=$2 AND kept_id=$1))`, [p.merged.id, keptId]);
  if (exists) continue;
  const kn = meta.get(keptId)!, mn = meta.get(p.merged.id)!;
  const snapshot = { note: "proposal-time summary; the full reversal snapshot (every moved/deleted row) is written by er:apply", kept: { id: keptId, refs: refCount.get(keptId) ?? 0 }, merged: { id: p.merged.id, name: p.merged.name, type: p.merged.type, refs: refCount.get(p.merged.id) ?? 0, ids: p.merged.ids } };
  const evidence = [{ label: `${p.kept.name}`, url: kn.source_url, archive_url: kn.archive_url }, { label: `${p.merged.name}`, url: mn.source_url, archive_url: mn.archive_url }];
  const r = await pool.query(`INSERT INTO merge_log (action, status, kept_id, merged_id, snapshot, method, evidence, rationale, confidence, extraction_meta) VALUES ('merge','proposed',$1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [keptId, p.merged.id, JSON.stringify(snapshot), p.method, JSON.stringify({ rule: p.s.r.rule, groups: p.s.r.groups, conflicts: p.s.r.conflicts, links: evidence }), p.j ? p.j.reasons.join(" | ") : p.s.r.reason, p.s.r.score, p.j ? JSON.stringify(p.j.meta) : null]);
  await pool.query(`INSERT INTO er_candidates (a_id, b_id, rule, score, features, decision, llm, merge_log_id, run_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (a_id,b_id) DO UPDATE SET score=EXCLUDED.score, features=EXCLUDED.features, decision=EXCLUDED.decision, llm=EXCLUDED.llm, merge_log_id=EXCLUDED.merge_log_id, run_id=EXCLUDED.run_id`,
    [p.s.a.id, p.s.b.id, p.s.r.rule, p.s.r.score, JSON.stringify(p.s.r), p.s.r.decision, p.j ? JSON.stringify(p.j) : null, r.rows[0].id, runId]);
  logged++;
}
// review queue + candidate rows for all unmerged middle-band pairs
let queued = 0;
const proposedPairs = new Set(proposals.map((p) => `${p.s.a.id}|${p.s.b.id}`));
for (const s of reviews) {
  const key = `${s.a.id}|${s.b.id}`, j = judged.get(key);
  await pool.query(`INSERT INTO er_candidates (a_id, b_id, rule, score, features, decision, llm, run_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (a_id,b_id) DO UPDATE SET score=EXCLUDED.score, features=EXCLUDED.features, llm=COALESCE(EXCLUDED.llm, er_candidates.llm), run_id=EXCLUDED.run_id`,
    [s.a.id, s.b.id, s.r.rule, s.r.score, JSON.stringify(s.r), "review", j ? JSON.stringify(j) : null, runId]);
  if (proposedPairs.has(key) && j?.verdict === "same" && j.agree) {
    // still goes to a human: a model-judged merge is never applied unreviewed
  }
  if (j?.verdict === "different" && j.agree && s.r.score < 0.6) continue;   // both prompts say different and the score is low: not worth a reviewer's time
  const [ma, mb] = [meta.get(s.a.id)!, meta.get(s.b.id)!];
  const id = await enqueue({ workstream: "er", kind: "merge", refTable: "er_candidates", refId: key, title: `Same entity? "${s.a.name}" (${s.a.type}) ~ "${s.b.name}" (${s.b.type})`,
    payload: { a: s.a.id, b: s.b.id, score: s.r.score, groups: s.r.groups, reason: s.r.reason, judge: j?.verdict ?? null, rationale: j ? j.reasons.join(" | ") : null },
    evidence: [{ label: s.a.name, url: ma.source_url, archive_url: ma.archive_url }, { label: s.b.name, url: mb.source_url, archive_url: mb.archive_url }], confidence: s.r.score, significance: Math.min(3, 1 + Math.log10(1 + (refCount.get(s.a.id) ?? 0) + (refCount.get(s.b.id) ?? 0))) * s.r.score });
  if (id) queued++;
}
// shared external IDs on different nodes is a duplicate signal already covered by 'auto'; report the ID conflicts that block merges
const blockedConflicts = scored.filter((s) => s.r.conflicts.some((c) => c.includes("≠")));
console.log(`merge proposals written: ${logged} (rule ${proposals.filter((p) => p.method === "rule").length}, llm ${proposals.filter((p) => p.method === "llm").length}); review-queue items: ${queued}; judged: ${judged.size}; blocked by ID conflict: ${blockedConflicts.length}`);
for (const p of proposals) console.log(`  MERGE ${p.merged.id} -> ${finalKept(p.merged.id)}  [${p.method} ${p.s.r.score}] ${p.s.r.reason}`);
await pool.end();
