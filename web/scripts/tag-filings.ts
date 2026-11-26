// Topic tags for lobbying filings and grants, taken from what was filed. No stance: only which of the fixed issues
// (table issue_areas) the filed text is about.
//   1. AI check in code: a filing or grant is tagged only if its own text mentions AI (AI, artificial intelligence,
//      machine learning, algorithm, semiconductor, chips, export control, data center and so on). The rest are stored as
//      ai_related = false with no tags, so counts are kept and re-runs skip them.
//   2. Rules in code: plain phrases (for example "export control" -> china, "deepfake" -> elections) and, when an AI-related
//      LDA filing lists a single general issue code with a clear match (DEF -> national_security), that code.
//   3. The local model (Qwen 2.5 7B via Ollama) reads the same text and picks up to 3 issue ids, or none, from a word enum.
// Final tags are the union of 2 and 3; `via` records which pass added each one.
// Lobbying links (links.subtype = 'lobbying') are not tagged separately: each one cites its filing's URL, and the site joins
// on that. Grants are links.subtype = 'grant', tagged from the link's note (the purpose as written on the grant page).
// Results go to filing_issue_tags, keyed by source row + model + prompt version, with a hash of the input. Identical texts
// (the same registrant filing the same description each quarter) are sent to the model once per run.
// Usage: pnpm tag-filings [--model qwen2.5:7b-instruct] [--version t4] [--model-from t3] [--limit N] [--ids filing:12,grant:2315] [--redo]
import "./env.ts";
import { createHash } from "node:crypto";
import { pool, q } from "../src/lib/db.ts";
import { setActor, notifySite } from "./lib/ingest.ts";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const MODEL = arg("--model") ?? process.env.ANALYSIS_MODEL ?? "qwen2.5:7b-instruct";
const OLLAMA = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const LIMIT = Number(arg("--limit") ?? 0);
const REDO = process.argv.includes("--redo");
const IDS = arg("--ids")?.split(",").map((s) => s.includes(":") ? s : `filing:${s}`);
// t3: issue_areas grew to 16 (federal_framework, agency_rules).
// t4: fixes from data/validation/filing-tags-report.md. Rules now match only sentences that themselves mention AI; the liability
//     rule no longer fires on Section 230 or intermediary liability; elections needs an election word, not just "deepfake";
//     new rules for moratoriums, transparency acts, AI risk and AI innovation; issues the model alone tags loosely (see
//     NEEDS_RULE) are kept only when a rule or code agrees; at most 3 issues per item. The model prompt and the model's input
//     are unchanged from t3, so `--model-from t3` reuses each item's t3 model picks instead of calling the model again.
// t5: the innovation rule no longer fires on any "innovation" (bill names like the Workforce Innovation and Opportunity Act);
//     "content liability" is not AI liability; "campaign ads" counts for elections.
export const PROMPT_VERSION = arg("--version") ?? "t5";
const MODEL_FROM = arg("--model-from");

type Area = { id: string; label: string; description: string };
const areas = await q<Area>(`SELECT id, label, description FROM issue_areas ORDER BY sort`);
const ids = areas.map((a) => a.id);

// LDA general issue codes (lda.gov reference list), used only to show the model what the filer ticked.
const LDA_CODES: Record<string, string> = {
  ACC: "Accounting", ADV: "Advertising", AER: "Aerospace", AGR: "Agriculture", ALC: "Alcohol and drug abuse", ANI: "Animals",
  APP: "Apparel", ART: "Arts and entertainment", AUT: "Automotive", AVI: "Aviation", BAN: "Banking", BNK: "Bankruptcy",
  BEV: "Beverage industry", BUD: "Budget and appropriations", CAW: "Clean air and water", CDT: "Commodities", CHM: "Chemicals",
  CIV: "Civil rights and civil liberties", COM: "Communications, broadcasting, radio and TV", CPI: "Computer industry",
  CON: "Constitution", CPT: "Copyright, patent and trademark", CSP: "Consumer issues, safety and protection", DEF: "Defense",
  DIS: "Disaster planning", DOC: "District of Columbia", ECN: "Economics and economic development", EDU: "Education",
  ENG: "Energy and nuclear", ENV: "Environment", FAM: "Family issues", FIN: "Financial institutions and securities",
  FIR: "Firearms", FOO: "Food industry", FOR: "Foreign relations", FUE: "Fuel, gas and oil", GAM: "Gaming",
  GOV: "Government issues", HCR: "Health issues", HOM: "Homeland security", HOU: "Housing", IMM: "Immigration",
  IND: "Indian and Native American affairs", INS: "Insurance", INT: "Intelligence and surveillance",
  LAW: "Law enforcement and crime", LBR: "Labor, antitrust and workplace", MAN: "Manufacturing", MAR: "Marine and maritime",
  MED: "Medical and disease research", MIA: "Media and publishing", MMM: "Medicare and Medicaid", MON: "Minting and money",
  NAT: "Natural resources", PHA: "Pharmacy", POS: "Postal", RRR: "Railroads", RES: "Real estate", REL: "Religion",
  RET: "Retirement", ROD: "Roads and highways", SCI: "Science and technology", SMB: "Small business", SPO: "Sports",
  TAX: "Taxation", TEC: "Telecommunications", TOB: "Tobacco", TOR: "Torts", TRA: "Transportation", TOU: "Travel and tourism",
  TRD: "Trade", TRU: "Trucking and shipping", UNM: "Unemployment", URB: "Urban development", UTI: "Utilities",
  VET: "Veterans", WAS: "Waste", WEL: "Welfare",
};
// Codes that map to one issue when an AI-related filing ticks that code alone. Broad codes (CPI, SCI, TRD, LBR, BUD) are left out.
const CODE_ISSUE: Record<string, string> = { DEF: "national_security", INT: "national_security", HOM: "national_security",
  ENG: "energy", UTI: "energy", CPT: "copyright", CIV: "civil_rights", TOR: "liability" };

// Does the text touch AI? Acronyms are matched case-sensitively so words like "said" never count.
const AI_ACRONYM = /\b(?:AI|A\.I\.|AGI|LLMs?|GPUs?|ML)\b|\bCHIPS\b/;
const AI_WORDS = /artificial intelligence|machine learning|algorithm|semiconductor|\bchips?\b|export control|data cent(?:er|re)s?|large language model|generative|deepfake|digital replica|neural network|automated decision|facial recognition|frontier model|superintelligen|chatbot|foundation model|compute (?:capacity|infrastructure)|autonomous weapon/i;
export const aiRelated = (s: string) => AI_ACRONYM.test(s) || AI_WORDS.test(s);

// Plain phrases that name an issue outright. Only applied to AI-related text.
const RULES: [RegExp, string][] = [
  [/export control|chip security|diffusion (?:rule|framework)|\bChina\b|\bPRC\b|foreign adversar|\bGAIN AI\b|remote access security/i, "china"],
  [/preempt|moratorium|patchwork of state/i, "preemption"],
  [/frontier (?:AI|model)|AI safety institute|CAISI|model (?:evaluation|testing)|safety testing|incident reporting|AI transparency|model transparency|evaluating AI systems|dangerous capabilit/i, "frontier_rules"],
  [/catastroph|existential|loss of control|\bAI[- ]risk|risks? from (?:advanced )?(?:AI|artificial intelligence)|dangerous capabilit|bioweapon|biosecurity|accident risk|superintelligen/i, "catastrophic_risk"],
  [/open[- ]source AI|open[- ]weight|open model/i, "open_models"],
  [/copyright|digital replica|NO FAKES|training data/i, "copyright"],
  [/\bchild|\bkids\b|\bminors?\b|\bteens?\b|age verification|age assurance|KOSA|COPPA/i, "kids_safety"],
  [/workforce|\bworkers?\b|\bjobs\b|AI skills/i, "jobs"],
  [/data cent(?:er|re)|\benergy\b|electricity|power grid|\bgrid\b|permitting|nuclear/i, "energy"],
  [/\bdefen[cs]e\b|military|Department of War|Pentagon|\bNDAA\b|national security|intelligence community|government (?:use|adoption) of AI|AI procurement|\bAI and security\b|AI security/i, "national_security"],
  [/(?<!intermediary |content )\bliabilit/i, "liability"],
  [/\bbias\b|discriminat|civil rights|civil liberties|facial recognition|algorithmic accountability/i, "civil_rights"],
  [/\belections?\b(?! security)|synthetic media|political ad|campaign ad/i, "elections"],
  [/comprehensive (?:federal )?AI|federal AI (?:framework|legislation|standard)|national AI (?:framework|standard)/i, "federal_framework"],
  [/executive order|rulemaking|(?:proposed|interim final|final) rule|OMB memorand|diffusion (?:rule|framework)/i, "agency_rules"],
  [/competitiveness|\bNAIRR\b|AI research resource|AI (?:research and development|R&D)|American AI leadership|AI leadership|leadership in (?:AI|artificial intelligence)|AI (?:and )?innovation|innovation (?:in|of) (?:AI|artificial intelligence)|Research, Innovation/i, "innovation"],
];
// The model alone tagged these loosely in the t3 check (innovation 5/11, national_security, catastrophic_risk, preemption,
// liability, china): keep them only when a rule or the LDA code agrees.
const NEEDS_RULE = new Set(["innovation", "national_security", "catastrophic_risk", "preemption", "liability", "china"]);
const MAX_ISSUES = 3;
// Rules read sentence by sentence, and only sentences that mention AI, so one long activity listing many topics does not
// tag them all. A sentence ends at ". " after a lowercase word and before a capital ("H.R. 3447" is not split).
const aiSentences = (s: string) => s.split(/(?<=[a-z)]{2}[.!?])\s+(?=[A-Z])|;\s*/).filter((x) => aiRelated(x)).join(" ; ");

// Drop the "<report type>. Via <REGISTRANT>." prefix the LDA importer writes, so a lobbying firm's name is never read as content.
const filedText = (s: string) => s.replace(/^[^.|]*?\.\s+(?:In-house\.\s*|Via [^a-z]*?\.\s+)/, "").trim();
// A filing joins several lobbying activities with " | ", and each activity often lists many items with ";" or new lines.
// Only the pieces that touch AI are read, so a tax or immigration item in the same filing is never tagged.
const aiPieces = (s: string) => [...new Set(s.split(/\s\|\s|;|\n|\u2022/).map((x) => x.trim()).filter((x) => x && aiRelated(x)))].join("; ");

const SYSTEM = `You tag short descriptions of US lobbying filings and grants by topic. Read only the text you are given.
Do not use outside knowledge about the filer, the lobbying firm or the bills.

Rules:
- reason: write this FIRST. One plain sentence: what AI-related topics does the text itself name?
- issues: pick the issues below that the text names or clearly describes in connection with AI, at most 3. For each one,
  copy into "words" the exact words from the text that name that issue. If no words in the text name it, do not pick it.
- Pick none (an empty list) if the text only says "artificial intelligence", "AI policy", "AI principles" or "generative AI"
  with nothing more specific. Most filings name zero or one issue.
- These are topics only. Do not judge whether the filer is for or against anything.
- A topic in the text that is not about AI (for example tax, trade in general, health, privacy in general) is not an issue here.
- A bill counts only when its name in the text makes the topic plain (for example "Chip Security Act" is US-China competition).
- innovation: only when the text is about competitiveness, AI research funding or keeping US AI development ahead.
- national_security: military or intelligence use of AI, defense bills about AI, or the government buying and using AI.
- federal_framework: only when the text names comprehensive or national AI legislation or a federal AI framework, not any one AI bill.
- agency_rules: only when the text names an executive order, an agency rule or a rulemaking about AI.

Invented examples (not real filings):
- "Issues related to artificial intelligence policy." -> none
- "AI principles; generative AI." -> none
- "Export controls on advanced AI chips; H.R. 3447, Chip Security Act." -> china (words: "Export controls on advanced AI chips")
- "AI in defense procurement; NDAA provisions on artificial intelligence." -> national_security (words: "AI in defense procurement")
- "Federal AI legislation, including preemption of state AI laws." -> preemption (words: "preemption of state AI laws")
- "Energy infrastructure and permitting for AI data centers." -> energy (words: "permitting for AI data centers")
- "Grant for research on evaluating dangerous capabilities of frontier AI models." -> frontier_rules (words: "evaluating dangerous
  capabilities of frontier AI models"), catastrophic_risk (words: "dangerous capabilities")

Issues (id: label. what it covers):
${areas.map((a) => `- ${a.id}: ${a.label}. ${a.description}`).join("\n")}`;

const SCHEMA = {
  type: "object",
  properties: { reason: { type: "string" }, issues: { type: "array", maxItems: 3, items: { type: "object",
    properties: { issue: { type: "string", enum: ids }, words: { type: "string" } }, required: ["issue", "words"] } } },
  required: ["reason", "issues"],
};

async function chat(user: string) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    body: JSON.stringify({ model: MODEL, stream: false, format: SCHEMA, options: { temperature: 0, seed: 7, num_ctx: 4096 },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const out = JSON.parse((await res.json()).message.content);
  // Keep only known ids, at most 3, and only when the quoted words really are in the text (and say more than "AI").
  // The model's output is never trusted as-is.
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const hay = norm(user);
  const picked = [...new Set<string>((Array.isArray(out.issues) ? out.issues : [])
    .filter((x: any) => x && ids.includes(x.issue) && typeof x.words === "string")
    .filter((x: any) => { const w = norm(x.words); return w.length >= 4 && !/^(ai|artificial intelligence|generative ai|ai policy)$/.test(w) && hay.includes(w); })
    .map((x: any) => x.issue as string))].slice(0, 3);
  return { issues: picked, reason: String(out.reason ?? "").slice(0, 300) };
}

type Item = { kind: "filing" | "grant"; id: number; text: string; codes: string[]; ai: string };
const filings = await q<{ id: number; description: string | null; issues: string[] }>(
  `SELECT id, description, issues FROM filings WHERE filing_type = 'LDA' ORDER BY id`);
const grants = await q<{ id: number; note: string | null }>(`SELECT id, note FROM links WHERE type = 'money' AND subtype = 'grant' ORDER BY id`);
const items: Item[] = [
  ...filings.map((f) => ({ kind: "filing" as const, id: Number(f.id), text: filedText(f.description ?? ""), codes: f.issues ?? [], ai: aiPieces(filedText(f.description ?? "")) })),
  ...grants.map((g) => ({ kind: "grant" as const, id: Number(g.id), text: (g.note ?? "").trim(), codes: [], ai: aiRelated(g.note ?? "") ? (g.note ?? "").trim() : "" })),
];

const promptHash = createHash("sha256").update(SYSTEM + JSON.stringify(RULES.map(([r, i]) => [r.source, i])) + JSON.stringify(CODE_ISSUE)).digest("hex").slice(0, 12);
const inputOf = (it: Item) => `${it.kind === "filing" ? "LDA lobbying filing" : "Grant"} text: "${it.ai || it.text}"` +
  (it.codes.length ? `\nGeneral issue codes ticked: ${it.codes.map((c) => `${c} (${LDA_CODES[c] ?? c})`).join(", ")}` : "");
const hashOf = (it: Item) => createHash("sha256").update(`${promptHash}|${inputOf(it)}`).digest("hex").slice(0, 16);

const done = new Map((await q<{ source_kind: string; source_id: number; input_hash: string }>(
  `SELECT source_kind, source_id, input_hash FROM filing_issue_tags WHERE model = $1 AND prompt_version = $2`, [MODEL, PROMPT_VERSION]))
  .map((r) => [`${r.source_kind}:${r.source_id}`, r.input_hash]));
let todo = items.filter((it) => REDO || done.get(`${it.kind}:${it.id}`) !== hashOf(it));
if (IDS) todo = items.filter((it) => IDS.includes(`${it.kind}:${it.id}`));
if (LIMIT) todo = todo.slice(0, LIMIT);

await setActor("tag-filings");
console.log(`${MODEL}: ${filings.length} LDA filings and ${grants.length} grants, ${todo.length} to scan`);

// Same input text -> one model call, ever: seeded from stored rows with the same hash (the model's picks are the "model" entries in via).
const cache = new Map<string, { issues: string[]; reason: string }>();
if (!REDO) for (const r of await q<{ input_hash: string; via: Record<string, string>; reason: string | null }>(
  `SELECT DISTINCT ON (input_hash) input_hash, via, reason FROM filing_issue_tags WHERE model=$1 AND prompt_version=$2 AND ai_related`, [MODEL, PROMPT_VERSION]))
  cache.set(r.input_hash, { issues: Object.entries(r.via).filter(([, v]) => v.includes("model")).map(([k]) => k), reason: r.reason ?? "" });
// --model-from <version>: the model's picks stored for the same source under that version (same prompt, same input).
const reused = new Map<string, { issues: string[]; reason: string }>();
if (MODEL_FROM) for (const r of await q<{ source_kind: string; source_id: number; via: Record<string, string>; reason: string | null }>(
  `SELECT source_kind, source_id, via, reason FROM filing_issue_tags WHERE model=$1 AND prompt_version=$2 AND ai_related`, [MODEL, MODEL_FROM]))
  reused.set(`${r.source_kind}:${r.source_id}`, { issues: Object.entries(r.via).filter(([, v]) => v.includes("model")).map(([k]) => k), reason: r.reason ?? "" });
const rank = (v: string) => (v.includes("model") && v !== "model" ? 0 : v === "model" ? 2 : 1);
const counts = { scanned: 0, ai_related: 0, no_text: 0, model_calls: 0, reused: 0, tagged: 0, failed: 0, dropped_model_only: 0, capped: 0 };
const t0 = Date.now();
for (const it of todo) {
  counts.scanned++;
  const hash = hashOf(it);
  const ai = it.ai.length > 0;
  if (!it.text) counts.no_text++;
  let issues: string[] = [], reason: string | null = null;
  const via: Record<string, string> = {};
  if (ai) {
    counts.ai_related++;
    const sentences = aiSentences(it.ai);
    for (const [re, issue] of RULES) if (re.test(sentences)) via[issue] ??= "rule";
    const known = it.codes.filter((c) => c in LDA_CODES);
    if (known.length === 1 && CODE_ISSUE[known[0]]) via[CODE_ISSUE[known[0]]] ??= "code";
    try {
      let m = reused.get(`${it.kind}:${it.id}`) ?? cache.get(hash);
      if (reused.has(`${it.kind}:${it.id}`)) counts.reused++;
      else if (!m) { m = await chat(inputOf(it)); cache.set(hash, m); counts.model_calls++; }
      for (const i of m!.issues) {
        if (!via[i] && NEEDS_RULE.has(i)) { counts.dropped_model_only++; continue; }
        via[i] = via[i] ? `${via[i]}+model` : "model";
      }
      reason = m!.reason;
    } catch (e) { counts.failed++; console.warn(`${it.kind}:${it.id}: ${(e as Error).message}`); continue; }
    // At most 3: tags the rule and the model agree on first, then rule or code, then the model alone; ties in issue order.
    issues = ids.filter((i) => i in via).sort((a, b) => rank(via[a]) - rank(via[b]) || ids.indexOf(a) - ids.indexOf(b));
    if (issues.length > MAX_ISSUES) { counts.capped++; for (const i of issues.slice(MAX_ISSUES)) delete via[i]; issues = issues.slice(0, MAX_ISSUES); }
    issues = ids.filter((i) => issues.includes(i));
    if (issues.length) counts.tagged++;
  }
  await pool.query(`INSERT INTO filing_issue_tags (source_kind, source_id, model, prompt_version, input_hash, ai_related, issues, via, reason)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (source_kind, source_id, model, prompt_version) DO UPDATE SET input_hash=$5, ai_related=$6, issues=$7, via=$8, reason=$9, tagged_at=now()`,
    [it.kind, it.id, MODEL, PROMPT_VERSION, hash, ai, issues, JSON.stringify(via), reason]);
  if (counts.ai_related && ai && counts.ai_related % 25 === 0)
    console.log(`${counts.scanned}/${todo.length} scanned, ${counts.ai_related} AI-related, ${counts.model_calls} model calls (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
console.log({ ...counts, seconds: Math.round((Date.now() - t0) / 1000) });
const byIssue = await q<{ issue: string; filings: number; grants: number }>(`
  SELECT i AS issue, count(*) FILTER (WHERE source_kind = 'filing')::int AS filings, count(*) FILTER (WHERE source_kind = 'grant')::int AS grants
  FROM filing_issue_tags, unnest(issues) i WHERE model = $1 AND prompt_version = $2 GROUP BY i ORDER BY 2 DESC`, [MODEL, PROMPT_VERSION]);
console.table(byIssue);
await notifySite();
await pool.end();
