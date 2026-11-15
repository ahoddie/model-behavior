// Local-model pairwise judge for middle-band pairs. Two differently phrased prompts; "same" only counts when both agree
// (the model's self-reported confidence is uninformative, per CONTRACTS.md §1). The judge is advisory: it can raise a pair into
// the review queue with a rationale, but never lets two people merge on name alone (see decideFromJudge).
import { llmJson, type ExtractionMeta } from "../../lib/llm.ts";
import type { Profile } from "./score.ts";

const SCHEMA = { type: "object", properties: { reason: { type: "string" }, verdict: { type: "string", enum: ["same", "different", "unsure"] } }, required: ["reason", "verdict"], additionalProperties: false };
const SYSTEM_A = `You compare two records from a database about US AI-policy actors and decide if they describe the SAME real-world entity.
Rules: people with the same name are different people unless at least two independent facts agree (employer, city, handle, website). A political committee (PAC) is a different entity from the company or nonprofit that sponsors it. A parent organization and its institute, fund, foundation or subsidiary with a different purpose are different entities. A name that is only a shorter form of another (an acronym, a missing "Inc", "LLC", or a trailing office/agency acronym in parentheses) is the same entity.
Write one short reason, then the verdict: same, different, or unsure.`;
const SYSTEM_B = `Two database rows may be duplicates. Think about which answer is safer: wrongly merging two different entities is worse than leaving a duplicate. Say "same" only if the evidence clearly shows one entity (same legal name once suffixes and abbreviations are removed, same registry ID, or two or more matching independent facts for a person). If a committee and its sponsor, or a parent and a subunit, differ, they are "different". If you cannot tell, say "unsure". Give a short reason first.`;

const fmt = (p: Profile & { descriptor?: string | null; source?: string }) => [
  `name: ${p.name}`, `type: ${p.type}`, p.descriptor ? `descriptor: ${p.descriptor}` : "", `group: ${p.cluster ?? ""}`,
  p.names.length > 1 ? `also known as: ${p.names.slice(1, 6).join("; ")}` : "",
  Object.keys(p.ids).length ? `ids: ${Object.entries(p.ids).map(([k, v]) => `${k}=${v.slice(0, 3).join(",")}`).join(" ")}` : "",
  p.employers.length ? `linked organizations: ${p.employers.slice(0, 6).join(", ")}` : "", p.handles.length ? `handles: ${p.handles.slice(0, 4).join(", ")}` : "",
  p.cityStates.length ? `places: ${p.cityStates.join(", ")}` : "", p.source ? `source: ${p.source}` : ""].filter(Boolean).join("\n");

export type Judgement = { verdict: "same" | "different" | "unsure"; agree: boolean; reasons: string[]; meta: ExtractionMeta[] };
export async function judgePair(a: Profile, b: Profile): Promise<Judgement> {
  const user = `RECORD A\n${fmt(a)}\n\nRECORD B\n${fmt(b)}\n\nAre A and B the same entity?`;
  const [x, y] = [await llmJson<{ reason: string; verdict: Judgement["verdict"] }>({ promptVersion: "er-pair-v1a", system: SYSTEM_A, user, schema: SCHEMA, maxTokens: 300 }),
    await llmJson<{ reason: string; verdict: Judgement["verdict"] }>({ promptVersion: "er-pair-v1b", system: SYSTEM_B, user, schema: SCHEMA, maxTokens: 300 })];
  const agree = x.data.verdict === y.data.verdict;
  return { verdict: agree ? x.data.verdict : "unsure", agree, reasons: [x.data.reason, y.data.reason], meta: [x.meta, y.meta] };
}
