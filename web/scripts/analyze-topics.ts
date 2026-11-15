// Labels quotes on notable topics (table `topics`). One question per call, which a 7B model answers far better than a list:
// "does the speaker agree with <statement>?" Only own-view quotes (statement_labels.own_voice from the main analyzer) whose
// text matches the topic's keywords are sent. Topics that reuse an issue (topics.issue_id) are skipped here.
// Usage: pnpm analyze-topics [--topic x_risk] [--redo]
import "./env.ts";
import { createHash } from "node:crypto";
import { pool, q } from "../src/lib/db.ts";
import { llmJson } from "./lib/llm.ts";
import { notifySite } from "./lib/ingest.ts";

export const PROMPT_VERSION = "topics-v1";
const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const ONLY = arg("--topic");
const REDO = process.argv.includes("--redo");
const ANSWER: Record<string, number | null> = { "agrees strongly": 2, "agrees": 1, "takes no clear side": 0, "disagrees": -1, "disagrees strongly": -2, "not about this": null };

const SYSTEM = `You read one short quote and one statement. Say whether the speaker, in this quote, agrees or disagrees with the statement.
Answer from the quote alone. Describing a risk counts as agreeing that the risk is real; calling a risk overblown counts as disagreeing.
If the quote is about something else, answer "not about this". Give a short reason first.
Example: statement "Cars should have speed limiters." quote "Speed limiters would save thousands of lives." -> agrees.
Example: statement "Cars should have speed limiters." quote "Limiters are a solution in search of a problem." -> disagrees.`;
const SCHEMA = { type: "object", properties: { reason: { type: "string" }, answer: { type: "string", enum: Object.keys(ANSWER) } }, required: ["reason", "answer"] };

const topics = await q<{ id: string; positive: string; keywords: string }>(
  `SELECT id, positive, keywords FROM topics WHERE issue_id IS NULL AND keywords IS NOT NULL ${ONLY ? "AND id=$1" : ""} ORDER BY sort`, ONLY ? [ONLY] : []);
let n = 0, skipped = 0;
for (const t of topics) {
  const rows = await q<{ id: number; excerpt: string; name: string }>(`
    SELECT f.id, f.excerpt, n.name FROM feed_items f JOIN nodes n ON n.id=f.node_id
    JOIN statement_labels l ON l.feed_id=f.id AND l.own_voice
    WHERE f.status='approved' AND f.excerpt ~* $1 GROUP BY f.id, f.excerpt, n.name`, [t.keywords]);
  for (const r of rows) {
    const hash = createHash("sha256").update(`${PROMPT_VERSION}|${t.positive}|${r.name}|${r.excerpt}`).digest("hex").slice(0, 16);
    if (!REDO && (await q(`SELECT 1 FROM topic_labels WHERE feed_id=$1 AND topic_id=$2 AND prompt_version=$3 AND input_hash=$4`, [r.id, t.id, PROMPT_VERSION, hash])).length) { skipped++; continue; }
    const { data, meta } = await llmJson<{ reason: string; answer: string }>({
      promptVersion: PROMPT_VERSION, system: SYSTEM, schema: SCHEMA, maxTokens: 200,
      user: `Statement: "${t.positive}"\nSpeaker: ${r.name}\nQuote: "${r.excerpt}"`,
    });
    const answer = data.answer in ANSWER ? ANSWER[data.answer] : null;
    await pool.query(`INSERT INTO topic_labels (feed_id, topic_id, model, prompt_version, input_hash, answer, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (feed_id, topic_id, model, prompt_version) DO UPDATE SET input_hash=$5, answer=$6, reason=$7, labeled_at=now()`,
      [r.id, t.id, meta.model, PROMPT_VERSION, hash, answer, String(data.reason ?? "").slice(0, 300)]);
    n++; console.log(`${t.id} #${r.id} ${r.name}: ${data.answer}`);
  }
}
console.log({ labeled: n, skipped });
await notifySite();
await pool.end();
