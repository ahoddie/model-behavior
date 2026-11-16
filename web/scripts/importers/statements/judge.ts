// The model steps of the statements pipeline. One question per call, words not numbers, a short `reason` first
// (CONTRACTS.md section 1). Every output is checked or mapped in code; nothing the model says is stored as a fact.
// Prompt versions live in PROMPT_VERSIONS; bump a version string on ANY change to its prompt, schema or mapping, and add a line
// to data/eval/statements/PROMPTS.md with the eval scores that justified it.
import { llmJson, type LlmResult } from "../../lib/llm.ts";
import { ISSUE_IDS, TAXONOMY, issueById, targetById } from "./taxonomy.ts";

export const PROMPT_VERSIONS = {
  relevance: "stmt-relevance-v1",   // relevance + issue tags in one call (model calls are scarce on the shared 7B)
  speaker: "stmt-speaker-v1",
  quote: "stmt-quote-v1",
  stanceA: "stmt-stance-a-v1",
  stanceB: "stmt-stance-b-v1",
  gate: "stmt-gate-v2",
  attitude: "stmt-attitude-v1",
} as const;
export const PROMPT_SET = Object.values(PROMPT_VERSIONS).join("+");

export type Stance = "support" | "oppose" | "mixed" | "none";
type Meta = LlmResult<unknown>["meta"];
export type Step<T> = T & { meta: Meta };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

// ---- 1. relevance + issue tags (one call) -------------------------------------------------------------------------------------
// Model calls are the scarce resource (about 25 s each while the Mac is busy), so the relevance question and the issue tags share one
// call: an irrelevant item costs one call and is dropped; a relevant one gets its tags from the same answer.
const REL_SYSTEM = `You sort public texts for a database about AI policy. Say whether the text is about AI policy, regulation or governance, and which issue areas it addresses.
It IS about AI policy when it discusses laws, bills, government rules, executive orders, regulators, lawmakers' action on AI, export controls on chips,
safety requirements or testing rules for AI, liability for AI harms, copyright rules for AI training, who should oversee AI, or whether government should act on AI.
It is NOT about AI policy when it is only: a product launch, a research result, a hiring or funding announcement, a technical explanation, a general
prediction about what AI can do, a company's own internal safety practice with no mention of government, or any other topic.
Write a reason of at most 20 words first. Then answer yes or no. If yes, list the issue areas it clearly addresses (at most 3, most important first, ids only);
skip areas that are merely adjacent. If no, the list is empty.

Issue areas (id: what it covers):
${TAXONOMY.issues.map((i) => `- ${i.id}: ${i.label}`).join("\n")}`;
const REL_SCHEMA = { type: "object", additionalProperties: false, required: ["reason", "about_ai_policy", "issues"],
  properties: { reason: { type: "string" }, about_ai_policy: { type: "string", enum: ["yes", "no"] },
    issues: { type: "array", maxItems: 3, items: { type: "string", enum: ISSUE_IDS } } } };
export async function relevanceAndIssues(speaker: string, text: string): Promise<Step<{ relevant: boolean; issues: string[]; reason: string }>> {
  const r = await llmJson<{ reason: string; about_ai_policy: string; issues: string[] }>({ promptVersion: PROMPT_VERSIONS.relevance, system: REL_SYSTEM,
    user: `Text by or about ${speaker}:\n"""${clip(text, 1500)}"""`, schema: REL_SCHEMA, maxTokens: 140 });
  const relevant = r.data.about_ai_policy === "yes";
  return { relevant, issues: relevant ? [...new Set(r.data.issues)] : [], reason: r.data.reason, meta: r.meta };
}

// ---- 2. who said the quoted words (news and transcripts only) --------------------------------------------------------------
const SPK_SYSTEM = `You read a passage from a news article. One passage in it is in quotation marks. Decide who said the words inside the quotation marks.
Answer with exactly one of the listed names, or "someone else or unclear" when the words belong to a person not on the list, to an organization, or when you cannot tell.
Do not guess from fame or topic: use only who the article says spoke. Write a short reason first.`;
export async function speaker(passage: string, quote: string, names: string[]): Promise<Step<{ name: string | null; reason: string }>> {
  const options = [...names, "someone else or unclear"];
  const r = await llmJson<{ reason: string; speaker: string }>({ promptVersion: PROMPT_VERSIONS.speaker, system: SPK_SYSTEM,
    user: `Names: ${names.join("; ")}\n\nPassage:\n"""${clip(passage, 1400)}"""\n\nThe quoted words: "${quote}"\nWho said the quoted words?`,
    schema: { type: "object", additionalProperties: false, required: ["reason", "speaker"], properties: { reason: { type: "string" }, speaker: { type: "string", enum: options } } }, maxTokens: 140 });
  return { name: names.includes(r.data.speaker) ? r.data.speaker : null, reason: r.data.reason, meta: r.meta };
}

// ---- 3. quote selection (long own-words texts) --------------------------------------------------------------------------------
const QUOTE_SYSTEM = `You pick one short passage from a text. Copy, word for word, the single passage of 25 words or fewer that most directly states what the speaker
thinks should happen about AI policy (a law, rule, government action or oversight). Copy exactly: do not fix, shorten inside, reorder or merge words.
Choose a complete sentence or clause. If the speaker states no view on policy, copy the sentence that comes closest.`;
export async function pickQuote(speakerName: string, text: string): Promise<Step<{ quote: string }>> {
  const r = await llmJson<{ quote: string }>({ promptVersion: PROMPT_VERSIONS.quote, system: QUOTE_SYSTEM,
    user: `Speaker: ${speakerName}\nText:\n"""${clip(text, 2000)}"""`, schema: { type: "object", additionalProperties: false, required: ["quote"], properties: { quote: { type: "string" } } }, maxTokens: 120 });
  return { quote: r.data.quote, meta: r.meta };
}

// ---- 5. stance toward one proposition, asked two different ways ------------------------------------------------------------
// The proposition is the named target ("CA SB 53 (2025)") or, with no target, the primary issue's plain statement from the
// taxonomy ("Federal law should override or pause state AI laws."). Two prompts with different wording and answer words; agreement
// between them is the confidence signal (the 7B model's own confidence number is uninformative).
const MAP_A: Record<string, Stance> = { "in favor": "support", "in favor only under conditions": "mixed", "against": "oppose", "mixed or sarcastic": "mixed", "no position": "none" };
const MAP_B: Record<string, Stance> = { "wants it": "support", "wants it with changes": "mixed", "does not want it": "oppose", "neutral or unclear": "none" };
export type Proposition = { kind: "target"; id: string } | { kind: "issue"; id: string };
const propositionText = (p: Proposition) => p.kind === "target" ? `the policy "${targetById(p.id)!.label}"` : `this idea: "${issueById(p.id)!.statement}"`;

const STANCE_A_SYSTEM = `You read one public statement and say where the speaker stands on one policy idea. Use only the statement; ignore what you know about the speaker.
First write "summary": ONE plain sentence of 30 words or fewer, third person, present tense, starting with the speaker's name, saying what the speaker says about AI policy.
Use only what the statement says; no background, no motives, no words like "slams" or "blasts" unless the statement uses them. If the speaker backs something only under a condition, or is sarcastic, put that in the sentence.
If the text is a paraphrase inside a news article, start with "According to the article,". Then give "stance":
- "in favor": the speaker backs the idea, asks for it, or praises it.
- "against": the speaker opposes it, criticizes it, or asks to stop or weaken it.
- "in favor only under conditions": the speaker backs it only if something changes or is added ("I'd support it if ...", "good idea but ...").
- "mixed or sarcastic": the speaker is mocking, or praises and criticizes the same idea.
- "no position": the statement does not say whether the speaker wants it. Describing a problem, reporting news or asking a question is no position.`;
const STANCE_B_SYSTEM = `Here is a short public statement and a policy idea. Decide what the speaker wants to happen with that idea, judging only from the statement.
Answers: "wants it" (the speaker wants the idea adopted, kept or done); "does not want it" (the speaker wants it dropped, blocked, narrowed or opposes it);
"wants it with changes" (the speaker wants it only if specific changes or conditions are met, or is sarcastic or split); "neutral or unclear" (the statement gives no clear wish about it).
First write one sentence of at most 25 words saying what the speaker wants, then the answer.`;

export async function stanceA(speakerName: string, text: string, p: Proposition, paraphrased = false): Promise<Step<{ stance: Stance; summary: string }>> {
  const r = await llmJson<{ summary: string; stance: string }>({ promptVersion: PROMPT_VERSIONS.stanceA, system: STANCE_A_SYSTEM,
    user: `Speaker: ${speakerName}\nParaphrase in a news article: ${paraphrased ? "yes" : "no"}\nStatement:\n"""${clip(text, 1500)}"""\n\nPolicy idea: ${propositionText(p)}\nWhere does the speaker stand on it?`,
    schema: { type: "object", additionalProperties: false, required: ["summary", "stance"], properties: { summary: { type: "string" }, stance: { type: "string", enum: Object.keys(MAP_A) } } }, maxTokens: 150 });
  return { stance: MAP_A[r.data.stance], summary: r.data.summary.trim(), meta: r.meta };
}
export async function stanceB(speakerName: string, text: string, p: Proposition): Promise<Step<{ stance: Stance; reason: string }>> {
  const r = await llmJson<{ wish: string; answer: string }>({ promptVersion: PROMPT_VERSIONS.stanceB, system: STANCE_B_SYSTEM,
    user: `Policy idea: ${propositionText(p)}\n\n${speakerName} said:\n"""${clip(text, 1500)}"""\n\nWhat does ${speakerName} want to happen with that idea?`,
    schema: { type: "object", additionalProperties: false, required: ["wish", "answer"], properties: { wish: { type: "string" }, answer: { type: "string", enum: Object.keys(MAP_B) } } }, maxTokens: 120 });
  return { stance: MAP_B[r.data.answer], reason: r.data.wish, meta: r.meta };
}

// ---- 5b. gate: does the speaker give a view at all? ---------------------------------------------------------------------
// The first eval showed the stance prompts read topic or tone as a position (gold "no clear stance" items were labelled support 36 of 77
// times). This asks only whether the text states the speaker's own view on the idea or only reports/describes. One question, one call.
const GATE_SYSTEM = `You read one public statement and one policy idea. Decide whether the speaker gives their OWN view on that idea.
Answers: "gives own view" (the speaker says they want it, oppose it, or clearly judge it good or bad, or ask others to act on it);
"only describes" (the text reports news, summarizes research or other people's views, explains how things work, describes a risk or an opportunity, or asks a question, without saying what the speaker wants done about the idea);
"about something else" (the idea is not what the text is about).
Warning signs of "only describes": newsletter summaries, "X argues", "researchers found", predictions, neutral explanation, product news.
First write "evidence": at most 12 words quoted from the text that show the speaker's own wish about the idea, or "none". Then answer.`;
export async function stanceGate(speakerName: string, text: string, p: Proposition): Promise<Step<{ opinion: boolean; evidence: string }>> {
  const r = await llmJson<{ evidence: string; answer: string }>({ promptVersion: PROMPT_VERSIONS.gate, system: GATE_SYSTEM,
    user: `Policy idea: ${propositionText(p)}\n\n${speakerName} wrote or said:\n"""${clip(text, 1500)}"""\n\nDoes ${speakerName} give their own view on that idea?`,
    schema: { type: "object", additionalProperties: false, required: ["evidence", "answer"], properties: { evidence: { type: "string" }, answer: { type: "string", enum: ["gives own view", "only describes", "about something else"] } } }, maxTokens: 220 });
  return { opinion: r.data.answer === "gives own view", evidence: r.data.evidence.trim(), meta: r.meta };
}

// ---- 6. general attitude to regulation, -2..+2 ----------------------------------------------------------------------------
const TONE: Record<string, number | null> = { "wants many more rules": 2, "leans toward more rules": 1, "balanced or mixed": 0, "leans toward fewer rules": -1, "wants far fewer rules": -2, "not about government rules": null };
const TONE_SYSTEM = `You read one public statement about AI and say what the speaker thinks about government rules for AI in general. Use only the statement.
- Asking for laws, oversight, testing requirements, limits or penalties for AI companies means more rules. Criticizing government for doing too little means more rules.
- Calling rules too heavy, a burden on innovation, or asking to block, pause or override rules means fewer rules.
- Asking for one federal standard in place of many state laws means fewer state rules; judge whether the speaker wants it light or strong.
- "balanced or mixed" is for statements that want some rules and warn against others.
- Describing a harm, or praising a product, is "not about government rules".
Write a short reason first.`;
export async function attitude(speakerName: string, text: string): Promise<Step<{ value: number | null; reason: string }>> {
  const r = await llmJson<{ reason: string; attitude: string }>({ promptVersion: PROMPT_VERSIONS.attitude, system: TONE_SYSTEM,
    user: `Speaker: ${speakerName}\nStatement:\n"""${clip(text, 1500)}"""`,
    schema: { type: "object", additionalProperties: false, required: ["reason", "attitude"], properties: { reason: { type: "string" }, attitude: { type: "string", enum: Object.keys(TONE) } } }, maxTokens: 140 });
  return { value: TONE[r.data.attitude] ?? null, reason: r.data.reason, meta: r.meta };
}

