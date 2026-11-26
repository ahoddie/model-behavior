// Statement analysis with an open-source model running locally in Ollama (default: Qwen 2.5 7B Instruct).
// For each approved statement with a verbatim quote, the model reads ONLY the quote and the speaker's name and returns:
//   own_voice  - is this the speaker stating their own view (not reporting someone else's, not a description of them)?
//   issues     - which of the fixed issue areas (table issue_areas) it addresses, each answered as agree/disagree with a
//                fixed statement, mapped in code to -2..+2 (0 = mentions it without taking a side).
//   tone       - the speaker's stance on government rules for AI, -2..+2, or null if the quote takes none.
//   confidence - 0..1, how likely a careful human reader is to agree.
// Results go to statement_labels, keyed by model + prompt version + a hash of the input, so re-runs only label what changed.
// Nothing here is published as fact: the site labels these as machine-classified and links every one to its quote.
// Usage: pnpm analyze [--model qwen2.5:7b-instruct] [--limit N] [--ids 1,2] [--redo] [--budget-min M]
// --budget-min (or ANALYZE_BUDGET_MIN): stop cleanly after M minutes; the rest is labeled next run. Used by the nightly
// GitHub Actions job, where the model runs on the runner's CPU and is slower than on this Mac.
import "./env.ts";
import { createHash } from "node:crypto";
import { pool, q } from "../src/lib/db.ts";
import { setActor, notifySite } from "./lib/ingest.ts";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const MODEL = arg("--model") ?? process.env.ANALYSIS_MODEL ?? "qwen2.5:7b-instruct";
const OLLAMA = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const LIMIT = Number(arg("--limit") ?? 0);
const REDO = process.argv.includes("--redo");
const IDS = arg("--ids")?.split(",").map(Number);
const BUDGET_MS = Number(arg("--budget-min") ?? process.env.ANALYZE_BUDGET_MIN ?? 0) * 60_000;
export const PROMPT_VERSION = "v5";

type Area = { id: string; label: string; description: string; positive: string };
const areas = await q<Area>(`SELECT id, label, description, positive FROM issue_areas ORDER BY sort`);
const ids = areas.map((a) => a.id);

// Two separate calls. A 7B model did worse when one prompt asked both "who is speaking?" and "what is their stance?",
// so step 1 only decides whether the quote is the speaker's opinion, and step 2 labels issues on those quotes only.
const SOURCE_SYSTEM = `You sort short quotes by who is talking. Read only the quote. Answer from who is talking, not from what they want.
- "speaker's opinion": the speaker's own words giving a view, judgment, warning, complaint, prediction or recommendation, even with no request.
- "reports others": the quote tells what someone else said or did, or describes the speaker in a reporter's words.
- "bare fact": a plain fact with no opinion at all, such as an amount spent, a job title or a funding policy.
Most quotes here are "speaker's opinion". Sarcasm, slogans and short reactions ("This is a disaster") are opinions.`;
const SOURCE_SCHEMA = { type: "object", properties: { source: { type: "string", enum: ["speaker's opinion", "reports others", "bare fact"] } }, required: ["source"] };

const SYSTEM = `You label short public statements about AI policy. Each quote is the speaker's own opinion. Read only the quote you are given.
Do not use outside knowledge about the speaker.

Rules:
- reason: write this FIRST. One plain sentence: what does the speaker want to happen, if anything? Base every label on that sentence.
- issues: include only issues the quote clearly addresses, at most 3. Each issue below is a statement. Say whether the speaker,
  in this quote, would agree with that statement: "agrees strongly", "agrees", "mentions only", "disagrees" or "disagrees strongly".
  Use "mentions only" when the quote touches the issue without taking a side.
- Describing a harm is not a position. Only say agrees or disagrees if the quote asks for, praises, or rejects something.
- tone: the speaker's view of government rules for AI in general: "wants more rules", "leans more rules", "balanced",
  "leans fewer rules", "wants fewer rules", or "not about rules".
- Criticizing a government action for doing too little means the speaker wants more rules. Criticizing rules as too heavy or bad for
  innovation means the speaker wants fewer.
- "mentions only" is rare. If the quote leans either way, say agrees or disagrees.
- A pause or moratorium on state AI laws is federal override of state laws. Asking for one national approach instead of
  50 state laws agrees with that. Calling such a pause too broad disagrees with it.
- Saying a policy names a harm but "offers no solutions" means the speaker wants action on that harm: agrees.

Invented examples (not real quotes):
- "The new chip rules will only hand the market to our foreign rivals." -> china: disagrees; tone: leans fewer rules.
- "Congress should set one standard so companies aren't stuck with fifty." -> preemption: agrees; tone: balanced.
- "Every lab should have to publish its safety tests before launch." -> frontier_rules: agrees strongly; tone: wants more rules.
- "Heavy-handed rules now would kill the startups that compete with Big Tech." -> innovation: agrees strongly; tone: wants fewer rules.
- "This plan lists the dangers to workers but does nothing about them." -> jobs: agrees; tone: leans more rules.

- confidence: from 0 to 1, how likely a careful human reader would agree with your labels.

Issues (id: label. what it covers. Statement to agree or disagree with):
${areas.map((a) => `- ${a.id}: ${a.label}. ${a.description} Statement: "${a.positive}"`).join("\n")}`;

const ANSWER: Record<string, number> = { "agrees strongly": 2, agrees: 1, "mentions only": 0, disagrees: -1, "disagrees strongly": -2 };
const TONE: Record<string, number | null> = { "wants more rules": 2, "leans more rules": 1, balanced: 0, "leans fewer rules": -1, "wants fewer rules": -2, "not about rules": null };

const SCHEMA = {
  type: "object",
  properties: {
    reason: { type: "string" },
    issues: { type: "object", properties: Object.fromEntries(ids.map((i) => [i, { type: "string", enum: Object.keys(ANSWER) }])), additionalProperties: false },
    tone: { type: "string", enum: Object.keys(TONE) },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["reason", "issues", "tone", "confidence"],
};

async function chat(system: string, format: object, user: string) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    body: JSON.stringify({ model: MODEL, stream: false, format, options: { temperature: 0, seed: 7, num_ctx: 4096 },
      messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  return JSON.parse((await res.json()).message.content);
}

async function label(speaker: string, quote: string) {
  const user = `Speaker: ${speaker}\nQuote: "${quote}"`;
  const src = await chat(SOURCE_SYSTEM, SOURCE_SCHEMA, user);
  if (src.source !== "speaker's opinion") return { own_voice: false, issues: {}, tone: null, confidence: 1, reason: `Not the speaker's opinion (${String(src.source)}).` };
  const out = await chat(SYSTEM, SCHEMA, user);
  // Keep only known issues and valid values; the model's output is never trusted as-is.
  const issues = Object.fromEntries(Object.entries(out.issues ?? {}).filter(([k, v]) => ids.includes(k) && typeof v === "string" && v in ANSWER).slice(0, 3).map(([k, v]) => [k, ANSWER[v as string]]));
  const tone = typeof out.tone === "string" && out.tone in TONE ? TONE[out.tone] : null;
  return { own_voice: true, issues, tone, confidence: Math.min(1, Math.max(0, Number(out.confidence) || 0)), reason: String(out.reason ?? "").slice(0, 300) };
}

await setActor("analysis");
const rows = await q<{ id: number; excerpt: string; name: string }>(`
  SELECT fi.id, fi.excerpt, n.name FROM feed_items fi JOIN nodes n ON n.id = fi.node_id
  WHERE fi.status = 'approved' AND fi.excerpt IS NOT NULL AND fi.kind NOT IN ('donation','policy change','filing') AND n.type NOT IN ('lawmaker','agency','bill','race','rule')
  ORDER BY fi.date DESC NULLS LAST, fi.id`);
const done = new Map((await q<{ feed_id: number; input_hash: string }>(`SELECT feed_id, input_hash FROM statement_labels WHERE model=$1 AND prompt_version=$2`, [MODEL, PROMPT_VERSION]))
  .map((r) => [r.feed_id, r.input_hash]));
const promptHash = createHash("sha256").update(SOURCE_SYSTEM + SYSTEM).digest("hex").slice(0, 12);
let todo = rows.filter((r) => REDO || done.get(r.id) !== createHash("sha256").update(`${promptHash}|${r.name}|${r.excerpt}`).digest("hex").slice(0, 16));
if (IDS) todo = rows.filter((r) => IDS.includes(Number(r.id)));
if (LIMIT) todo = todo.slice(0, LIMIT);
console.log(`${MODEL}: ${rows.length} statements, ${todo.length} to label`);

let n = 0, failed = 0;
const t0 = Date.now();
for (const r of todo) {
  if (BUDGET_MS && Date.now() - t0 > BUDGET_MS) { console.log(`time budget reached; ${todo.length - n - failed} left for next run`); break; }
  const hash = createHash("sha256").update(`${promptHash}|${r.name}|${r.excerpt}`).digest("hex").slice(0, 16);
  try {
    const l = await label(r.name, r.excerpt);
    await pool.query(`INSERT INTO statement_labels (feed_id, model, prompt_version, input_hash, own_voice, issues, tone, confidence, reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (feed_id, model, prompt_version) DO UPDATE SET input_hash=$4, own_voice=$5, issues=$6, tone=$7, confidence=$8, reason=$9, labeled_at=now()`,
      [r.id, MODEL, PROMPT_VERSION, hash, l.own_voice, JSON.stringify(l.issues), l.tone, l.confidence, l.reason]);
    n++;
  } catch (e) { failed++; console.warn(`#${r.id}: ${(e as Error).message}`); }
  if ((n + failed) % 20 === 0) console.log(`${n + failed}/${todo.length} (${((Date.now() - t0) / 1000 / (n + failed)).toFixed(1)}s each)`);
}
console.log({ labeled: n, failed, seconds: Math.round((Date.now() - t0) / 1000) });
await notifySite();
await pool.end();
