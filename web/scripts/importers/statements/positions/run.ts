// The positions pipeline: for each statement, gather candidate quotes (web research files and approved feed quotes), check each
// quote at its link, read it against the statement, and store the result in stance_findings. High-confidence readings of
// verified quotes show on the Statements page (status 'auto'); everything else waits in /review.
// Usage: node --experimental-strip-types scripts/importers/statements/positions/run.ts [--load-statements] [--topic id] [--find]
//   --load-statements  upsert the statements in statements.ts into `topics` first
//   --find             with an API key, run the web finder for statements that have no research file yet
import "../../../env.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pool, q } from "../../../../src/lib/db.ts";
import { notifySite } from "../../../lib/ingest.ts";
import { REPO } from "../../../env.ts";
import { STATEMENTS, KEPT } from "./statements.ts";
import { classify, readingKey, offline, PROMPT_VERSION, MODEL } from "./classify.ts";
import { queueReading, flushQueue } from "./queue.ts";
import { verify } from "./verify.ts";
import { loadCandidates, findOnline, RESEARCH_DIR, type Candidate } from "./find.ts";
import { statusFor } from "./gate.ts";
import { usage, cost } from "./claude.ts";

const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const ONLY = arg("--topic");

if (process.argv.includes("--load-statements")) {
  for (const s of STATEMENTS) await pool.query(`INSERT INTO topics (id, label, description, positive, keywords, issue_id, sort) VALUES ($1,$2,$3,$4,$5,NULL,$6)
    ON CONFLICT (id) DO UPDATE SET label=$2, description=$3, positive=$4, keywords=$5, sort=$6`, [s.id, s.label, s.description, s.positive, s.keywords, s.sort]);
  for (const [id, k] of Object.entries(KEPT)) await pool.query(`UPDATE topics SET keywords=coalesce(keywords, $2), sort=$3 WHERE id=$1`, [id, k.keywords, k.sort]);
  // Only the listed statements show; the rest stay in the table, with their letters and readings, but leave the page.
  const ids = [...STATEMENTS.map((s) => s.id), ...Object.keys(KEPT)];
  await pool.query(`UPDATE topics SET shown = (id = ANY($1))`, [ids]);
  console.log(`loaded ${STATEMENTS.length} statements; showing ${ids.length}`);
}

const topics = await q<{ id: string; positive: string; keywords: string | null }>(`SELECT id, positive, keywords FROM topics WHERE shown ${ONLY ? "AND id=$1" : ""} ORDER BY sort`, ONLY ? [ONLY] : []);
const nodes = await q<{ id: string; name: string }>(`SELECT id, name FROM nodes WHERE type NOT IN ('bill','rule','race')`);
const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/\b(sen|rep|senator|representative|gov|governor|dr|the)\b\.?/g, "").replace(/[^a-z0-9]/g, "");
const byName = new Map<string, string>();
for (const n of nodes) { byName.set(norm(n.name), n.id); }
const nodeFor = (name: string) => byName.get(norm(name)) ?? null;

if (process.argv.includes("--find") && !offline()) {
  const names = readFileSync(join(REPO, "data/cache/claude/site-names.txt"), "utf8");
  for (const s of STATEMENTS.filter((s) => (!ONLY || s.id === ONLY) && !existsSync(join(RESEARCH_DIR, `${s.id}.jsonl`)))) {
    const found = await findOnline(s, names); console.log(`found ${found.length} for ${s.id}`);
  }
}

type Work = Candidate & { origin: "web" | "feed"; feed_id?: number; node_id?: string | null };
const tally: Record<string, Record<string, number>> = {};
let queued = 0;
for (const t of topics) {
  const work: Work[] = loadCandidates(t.id).map((c) => ({ ...c, origin: "web" as const }));
  if (t.keywords) {
    const feed = await q<any>(`SELECT DISTINCT ON (f.id) f.id, f.excerpt, f.url, f.node_id, n.name, n.descriptor, pdate(f.date, f.date_prec)::text AS date, f.platform
      FROM feed_items f JOIN nodes n ON n.id=f.node_id JOIN statement_labels l ON l.feed_id=f.id AND l.own_voice
      WHERE f.status='approved' AND f.excerpt IS NOT NULL AND f.excerpt ~* $1`, [t.keywords]);
    for (const f of feed) work.push({ topic_id: t.id, speaker_name: f.name, speaker_role: f.descriptor ?? undefined, quote: f.excerpt, url: f.url, date: f.date,
      source_kind: f.platform ?? "other", origin: "feed", feed_id: f.id, node_id: f.node_id });
  }
  const tt = (tally[t.id] = { candidates: work.length, verified: 0, agree: 0, disagree: 0, mixed: 0, none: 0, auto: 0, pending: 0, queued: 0 });
  for (const w of work) {
    if (!w.quote || !w.url || !w.speaker_name || w.quote.split(/\s+/).length < 5) continue;
    const r = await classify(w.speaker_name, w.quote, t.positive, w.source_kind);
    if (!r) { queueReading({ key: readingKey(w.speaker_name, w.quote, t.positive), speaker: w.speaker_name, statement: t.positive, quote: w.quote, context: w.source_kind }); tt.queued++; queued++; continue; }
    if (!r.side) { tt.none++; continue; }
    const v = w.origin === "feed" ? { ok: true, note: "approved feed item (checked when it was imported)" } : await verify(w.url, w.quote);
    if (v.ok) tt.verified++;
    const status = statusFor({ confidence: r.confidence, verified: v.ok });
    tt[r.side]++; tt[status]++;
    // A reviewer's decision is kept when the pipeline re-runs; only the machine's fields are refreshed.
    await pool.query(`INSERT INTO stance_findings (topic_id, node_id, speaker_name, speaker_role, quote, url, date, source_kind, origin, feed_id,
        side, answer, implied, confidence, reason, verified, verify_note, model, prompt_version, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT (topic_id, url, quote) DO UPDATE SET node_id=coalesce(stance_findings.node_id, $2), side=$11, answer=$12, implied=$13, confidence=$14, reason=$15,
        verified=$16, verify_note=$17, model=$18, prompt_version=$19, found_at=now(),
        status=CASE WHEN stance_findings.status IN ('confirmed','rejected') THEN stance_findings.status ELSE $20 END`,
      [t.id, w.node_id ?? nodeFor(w.speaker_name), w.speaker_name, w.speaker_role ?? null, w.quote, w.url, w.date ?? null, w.source_kind ?? null, w.origin, w.feed_id ?? null,
        r.side, r.answer, r.implied, r.confidence, r.reason, v.ok, v.note, offline() ? `${MODEL} (subagent)` : MODEL, PROMPT_VERSION, status]);
  }
}
console.table(tally);
const files = flushQueue();
if (files.length) { console.log(`${queued} readings queued for subagents (no API key):`); files.forEach((f) => console.log(" ", f)); }
console.log(`Claude: ${usage.calls} calls, ${usage.cached} cached, about $${cost().toFixed(2)}`);
await notifySite();
await pool.end();
