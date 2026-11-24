// Reads one quote against one statement: agree, disagree, mixed, or not about it, with a confidence between 0 and 1.
// Two independent readings with different wording. Confidence starts from how sure the first reading says it is and drops
// when the second reading disagrees. Implied positions count (most people never say the statement word for word), but a
// view may never be guessed from who the speaker is or what they usually think.
// Bump PROMPT_VERSION on any change to a prompt, schema or the confidence rule, and add a line to data/eval/statements/PROMPTS.md.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { json, MODEL } from "./claude.ts";

export const PROMPT_VERSION = "pos-classify-v1";
export type Side = "agree" | "disagree" | "mixed";
export type Reading = { side: Side | null; answer: number; implied: boolean; confidence: number; reason: string; a: string; b: string; certainty: string };

export const SYSTEM_A = `You read one quote from a public figure or organization and one statement about AI policy. Decide where the speaker stands on the statement, judging only from the quote.
People rarely repeat a statement word for word. Count a position when the quote commits the speaker to a view on it: they argue for or against what the statement says, back or attack a bill or policy that would do what it says, or say something that only makes sense if they agree or disagree.
Do not count a position when the quote only mentions the subject, reports news, describes other people's views, or describes a risk without saying what should be done about it. Never use what you know about the speaker; use only the quote.
Answers:
- "agree": the quote supports the statement.
- "disagree": the quote rejects it, or supports the opposite.
- "mixed": the quote supports part and rejects part, or supports it only with a condition that changes it.
- "not about this": the quote takes no side on this statement.
"strength": "strong" when the wording is emphatic or unqualified, else "plain".
"explicit": "yes" when the quote states the statement or its opposite nearly outright, "no" when the side is implied.
"certainty": "certain" when any careful reader would answer the same, "likely" when most would, "unsure" when it is a close call.
Write "reason" first: one sentence quoting the words that decide it.`;
export const SCHEMA_A = { type: "object", additionalProperties: false, required: ["reason", "answer", "strength", "explicit", "certainty"], properties: {
  reason: { type: "string" }, answer: { type: "string", enum: ["agree", "disagree", "mixed", "not about this"] },
  strength: { type: "string", enum: ["strong", "plain"] }, explicit: { type: "string", enum: ["yes", "no"] },
  certainty: { type: "string", enum: ["certain", "likely", "unsure"] } } };

export const SYSTEM_B = `Imagine handing the speaker of a quote a card with a sentence on it, and asking them to say whether they agree. Based only on the quote, predict their answer.
Answers: "would agree", "would disagree", "would agree with part of it" (they would accept some of it or only with conditions), or "the quote does not tell" (the quote is about something else, or does not show their view on this sentence).
Do not use outside knowledge about the speaker. Watch the direction: someone who calls a rule harmful would disagree that the rule should exist. Give a short reason first.`;
export const SCHEMA_B = { type: "object", additionalProperties: false, required: ["reason", "answer"], properties: {
  reason: { type: "string" }, answer: { type: "string", enum: ["would agree", "would disagree", "would agree with part of it", "the quote does not tell"] } } };

const SIDE_A: Record<string, Side | null> = { agree: "agree", disagree: "disagree", mixed: "mixed", "not about this": null };
const SIDE_B: Record<string, Side | null> = { "would agree": "agree", "would disagree": "disagree", "would agree with part of it": "mixed", "the quote does not tell": null };
const SURE: Record<string, number> = { certain: 0.95, likely: 0.8, unsure: 0.5 };

export const userA = (speaker: string, quote: string, statement: string, context?: string) =>
  `Statement: "${statement}"\nSpeaker: ${speaker}${context ? `\nWhere it was said: ${context}` : ""}\nQuote: """${quote.slice(0, 2500)}"""`;
export const userB = (speaker: string, quote: string, statement: string) =>
  `Sentence on the card: "${statement}"\n\n${speaker} said: """${quote.slice(0, 2500)}"""\n\nWould ${speaker} agree with the sentence on the card?`;
export const readingKey = (speaker: string, quote: string, statement: string) =>
  createHash("sha256").update(`${PROMPT_VERSION}|${statement}|${speaker}|${quote}`).digest("hex").slice(0, 16);

// Readings can also come from a file: when no API key is set, Claude subagents answer the same two prompts and append
// {key, a, b} lines here (a and b are the two prompts' JSON answers, from separate agents so they stay independent).
export const READINGS = join(dirname(fileURLToPath(import.meta.url)), `../../../../../data/cache/claude/readings-${PROMPT_VERSION}.jsonl`);
let stored: Map<string, { a: any; b: any }> | null = null;
const loadStored = () => (stored ??= new Map(existsSync(READINGS) ? readFileSync(READINGS, "utf8").split("\n").filter(Boolean).map((l) => { const o = JSON.parse(l); return [o.key, o]; }) : []));
export const hasReading = (key: string) => loadStored().has(key);
export function storeReading(key: string, a: any, b: any) { mkdirSync(dirname(READINGS), { recursive: true }); appendFileSync(READINGS, JSON.stringify({ key, a, b }) + "\n"); loadStored().set(key, { a, b }); }
export const offline = () => !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN;

// The confidence rule, kept apart from the calls so the eval and the page use exactly the same arithmetic.
export function combine(ra: any, rb: any): Reading {
  const a = SIDE_A[ra.answer] ?? null, b = SIDE_B[rb.answer] ?? null;
  // Confidence: the first reading's certainty, cut hard when the second reading lands elsewhere.
  let confidence = SURE[ra.certainty] ?? 0.5;
  if (a !== b) confidence *= b === null || a === null ? 0.5 : 0.3;
  const side = a ?? null;
  const strong = ra.strength === "strong";
  const answer = side === "agree" ? (strong ? 2 : 1) : side === "disagree" ? (strong ? -2 : -1) : 0;
  return { side, answer, implied: ra.explicit !== "yes", confidence: Math.round(confidence * 100) / 100, reason: String(ra.reason ?? "").slice(0, 400),
    a: ra.answer, b: rb.answer, certainty: ra.certainty };
}

// One reading, or null when it is not stored and there is no API key (the caller queues it for the subagents).
export async function classify(speaker: string, quote: string, statement: string, context?: string): Promise<Reading | null> {
  const key = readingKey(speaker, quote, statement);
  const s = loadStored().get(key);
  if (s) return combine(s.a, s.b);
  if (offline()) return null;
  const [ra, rb] = await Promise.all([
    json<any>(`${PROMPT_VERSION}-a`, SYSTEM_A, userA(speaker, quote, statement, context), SCHEMA_A, 600),
    json<any>(`${PROMPT_VERSION}-b`, SYSTEM_B, userB(speaker, quote, statement), SCHEMA_B, 400),
  ]);
  storeReading(key, ra, rb);
  return combine(ra, rb);
}
export { MODEL };
