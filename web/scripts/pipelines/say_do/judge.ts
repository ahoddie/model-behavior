// Model judgments for say-vs-do. One question per call, word answers, a short reason first, two differently-phrased
// prompts per pair; a flag needs both to agree (the model's own confidence number is not used).
import { llmJson, type ExtractionMeta } from "../../lib/llm.ts";
import { fmtDate, type Pos } from "./core.ts";

const SCHEMA = (answers: string[]) => ({ type: "object", required: ["reason", "answer"], additionalProperties: false,
  properties: { reason: { type: "string" }, answer: { type: "string", enum: answers } } });
const SYSTEM = "You compare short items about public policy. Use only what the items say. Give a one-sentence reason first, then the answer.";
const clip = (s: string, n = 600) => (s.length > n ? s.slice(0, n) + "..." : s);
const chan = (p: Pos) => (p.channel === "said" ? "public statement" : p.kind);
const item = (n: number, p: Pos) => `Item ${n} (${fmtDate(p.date, p.date_prec)}, ${chan(p)}, stance: ${p.stance.replace(/_/g, " ")}): ${clip(p.text)}${p.scope ? ` Scope given: ${p.scope}.` : ""}`;

export type Judged = { answer: string; reason: string; meta: ExtractionMeta };

/** Q1: are the two items about the same proposal? same | narrower | different | unclear */
export async function judgeSameProposition(a: Pos, b: Pos, version?: string | null): Promise<Judged> {
  const user = `Policy target: ${a.target_label}${version ? ` (${version})` : ""}.
${item(1, a)}
${item(2, b)}

Question: do both items take a position on the same policy proposal: the same bill or rule, the same version, and the same part of it?
- same: both are about the whole proposal, or both are about the same specific part.
- narrower: one item is only about a narrower part, a condition, a different level of government, or a different version.
- different: they are about different proposals.
- unclear: the items do not say enough.`;
  const r = await llmJson<{ reason: string; answer: string }>({ promptVersion: "sd-prop-v1", system: SYSTEM, user, schema: SCHEMA(["same", "narrower", "different", "unclear"]), maxTokens: 200 });
  return { answer: r.data.answer, reason: r.data.reason, meta: r.meta };
}

/** Q2: could one organization hold both positions at once? fit_together | conflict | unclear */
export async function judgeConflict(a: Pos, b: Pos): Promise<Judged> {
  const user = `${item(1, a)}
${item(2, b)}

Question: picture one organization that holds both positions on ${a.target_label} at the same time, without changing its mind. Think about conditions such as "if amended", limits of scope, and level of government (federal or state).
- fit_together: both positions can be held at once.
- conflict: the two positions give opposite answers to the same question.
- unclear: the items do not say enough.`;
  const r = await llmJson<{ reason: string; answer: string }>({ promptVersion: "sd-conflict-v1", system: SYSTEM, user, schema: SCHEMA(["fit_together", "conflict", "unclear"]), maxTokens: 200 });
  return { answer: r.data.answer, reason: r.data.reason, meta: r.meta };
}

export type PairVerdict = { flag: boolean; same: Judged; conflict: Judged };
export async function judgePair(a: Pos, b: Pos, version?: string | null): Promise<PairVerdict> {
  const same = await judgeSameProposition(a, b, version);
  if (same.answer !== "same") return { flag: false, same, conflict: { answer: "skipped", reason: "not the same proposition", meta: same.meta } };
  const conflict = await judgeConflict(a, b);
  return { flag: conflict.answer === "conflict", same, conflict };
}

// ---- type 3: commitment removed or weakened -------------------------------------------------------------------------
export type Commit = { flag: boolean; kind: "removed" | "weakened" | "none"; q1: Judged; q2: Judged };
export async function judgeCommitment(topic: string, before: string, after: string): Promise<Commit> {
  const base = `Page topic: ${topic}.
Earlier version, sentence: ${clip(before, 700)}
Later version of the same page, nearest text: ${clip(after || "(nothing like it appears)", 900)}`;
  const q1u = `${base}

Question: the earlier sentence is a commitment (a promise or limit the organization put on itself). What does the later version do with it?
- kept: still there, same strength (rewording that keeps the same promise counts as kept).
- moved: the same promise appears elsewhere in the later text.
- weakened: still present but with a weaker promise, new exceptions, or softer words.
- removed: no longer present.
- not_a_commitment: the earlier sentence was not a promise or limit.`;
  const q1 = await llmJson<{ reason: string; answer: string }>({ promptVersion: "sd-commit-v1", system: SYSTEM, user: q1u, schema: SCHEMA(["kept", "moved", "weakened", "removed", "not_a_commitment"]), maxTokens: 220 });
  const a1: Judged = { answer: q1.data.answer, reason: q1.data.reason, meta: q1.meta };
  if (a1.answer !== "weakened" && a1.answer !== "removed") return { flag: false, kind: "none", q1: a1, q2: { answer: "skipped", reason: "", meta: q1.meta } };
  const q2u = `${base}

Question: a reader compares the two versions. Is the organization bound by less in the later version than in the earlier sentence?
- less_bound: yes, the later version binds the organization less, or drops the promise.
- same_or_more: no, it binds the organization the same or more, or the promise moved elsewhere.
- unclear: cannot tell.`;
  const q2 = await llmJson<{ reason: string; answer: string }>({ promptVersion: "sd-commit-v2", system: SYSTEM, user: q2u, schema: SCHEMA(["less_bound", "same_or_more", "unclear"]), maxTokens: 220 });
  const a2: Judged = { answer: q2.data.answer, reason: q2.data.reason, meta: q2.meta };
  return { flag: a2.answer === "less_bound", kind: a1.answer as "removed" | "weakened", q1: a1, q2: a2 };
}
