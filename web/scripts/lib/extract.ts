// §6: pull speaker, a short verbatim quote, stance and issue tags out of an article, post or transcript.
// The model proposes; this code verifies. A quote is kept only if it appears word for word in the source text
// and is 25 words or fewer. Everything extracted lands as "pending" for the review screen.
import { llmJson, detectServer } from "./llm.ts";
import { wordCount } from "./ingest.ts";

export const ISSUES = ["preemption", "frontier safety", "export controls", "chips", "copyright", "child safety", "open source", "energy",
  "labor", "national security", "liability", "transparency", "elections", "privacy", "China", "antitrust", "federal funding", "state laws"] as const;

// Local model only (CONTRACTS.md §1). Words, not numbers; the code checks every quote against the source text.
const EXTRACT_SCHEMA = (ids: string[], tids: string[]) => ({
  type: "object", additionalProperties: false, required: ["items"],
  properties: { items: { type: "array", maxItems: 10, items: { type: "object", additionalProperties: false,
    required: ["speaker_id", "quote", "stance", "target_id", "issues", "summary"],
    properties: {
      speaker_id: { type: "string", enum: [...ids, "none"] },
      quote: { type: "string" },
      stance: { type: "string", enum: ["support", "oppose", "mixed", "none"] },
      target_id: { type: "string", enum: [...tids, "none"] },
      issues: { type: "array", maxItems: 4, items: { type: "string", enum: [...ISSUES] } },
      summary: { type: "string" },
    } } } },
});
export type Extracted = { node: string; excerpt: string | null; summary: string; stance: string | null; target: string | null; issues: string[] };

const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

export async function extract(text: string, candidates: { id: string; name: string }[], targets: { id: string; name: string }[]): Promise<Extracted[]> {
  const body = text.slice(0, 12000);   // a 7B model's context is small; long pages are cut
  try { await detectServer(); } catch { return heuristic(body, candidates); }
  const { data } = await llmJson<{ items: any[] }>({
    promptVersion: "news-extract-v1",
    system: "You extract on-the-record statements about AI policy for a sourced public database. Only return quotes that appear word for word in the text and are clearly attributed to one of the candidate speakers. Never paraphrase inside `quote`. If a speaker is paraphrased, not quoted, leave them out. Return an empty list if there are none.",
    user: `Candidate speakers:\n${candidates.map((c) => `${c.id}: ${c.name}`).join("\n")}\n\nTargets:\n${targets.map((t) => `${t.id}: ${t.name}`).join("\n")}\n\n<text>\n${body}\n</text>`,
    schema: EXTRACT_SCHEMA(candidates.map((c) => c.id), targets.map((t) => t.id)),
    maxTokens: 1500,
  });
  const known = new Set(candidates.map((c) => c.id));
  const tknown = new Set(targets.map((t) => t.id));
  const page = norm(body);
  return data.items
    .filter((i) => known.has(i.speaker_id))
    .map((i) => {
      const ok = i.quote && wordCount(i.quote) <= 25 && page.includes(norm(i.quote));
      return { node: i.speaker_id, excerpt: ok ? i.quote.trim() : null, summary: i.summary, stance: i.stance === "none" ? null : i.stance,
        target: tknown.has(i.target_id) ? i.target_id : null, issues: i.issues };
    })
    .filter((i) => i.excerpt || i.summary);
}

// No local model server: keep only quotes the text itself attributes, with a speech verb right beside the speaker's name:
// `"…," Huang said`, `said Huang`, `Huang said: "…"`. A quote that merely sits near a name (a board statement, a
// reporter's line, someone else's words) is dropped. Still lands as pending.
const SAID = "(?:said|says|told|wrote|writes|added|argued|warned|testified|posted|stated|explained|noted)";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function heuristic(text: string, candidates: { id: string; name: string }[]): Extracted[] {
  const out: Extracted[] = [];
  for (const c of candidates) {
    const full = c.name.replace(/\s*\(.*?\)/g, "").trim();
    const last = full.split(" ").at(-1)!;
    const who = `(?:${esc(full)}|${esc(last)})`;
    const res = [
      new RegExp(`[“"]([^”"]{20,220})[,.!?]?[”"]\\s*,?\\s*(?:${who}\\s+${SAID}|${SAID}\\s+${who})\\b`, "g"),
      new RegExp(`\\b${who}\\s+${SAID}(?:\\s+\\w+){0,3}\\s*[:,]\\s*[“"]([^”"]{20,220})[”"]`, "g"),
    ];
    for (const re of res) {
      const m = re.exec(text);
      if (!m) continue;
      const qt = m[1].trim().replace(/[,.]$/, "");
      if (wordCount(qt) > 25) continue;
      out.push({ node: c.id, excerpt: qt, summary: `Attributed to ${full} in the article text.`, stance: null, target: null, issues: [] });
      break;
    }
  }
  return out;
}
