// Searches the web for people and organizations who have taken a position on one statement, on BOTH sides, and returns
// candidate quotes with links. The finder's own guess at the side ("lean") is kept only to balance the search; the side shown
// on the page always comes from classify.ts, and the quote must pass verify.ts. Candidates are saved as research files
// (data/research/positions/<statement>.jsonl) so every run, and every person checking the site, sees the same evidence.
// With an API key this runs on Claude with web search and web fetch. Without one, Claude subagents follow FINDER_BRIEF.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../../env.ts";
import { call, textOf } from "./claude.ts";
import type { Statement } from "./statements.ts";

export const FINDER_VERSION = "pos-find-v1";
export const RESEARCH_DIR = join(REPO, "data/research/positions");
export type Candidate = { topic_id: string; speaker_name: string; speaker_role?: string; quote: string; url: string; date?: string | null;
  source_kind?: string; lean?: "agree" | "disagree" | "mixed"; found_by?: string };

export const FINDER_BRIEF = (s: Statement, siteNames: string) => `You are researching public positions for a neutral, beginner-friendly website about who shapes US AI policy.

Statement: "${s.positive}"
Background: ${s.description}

Find people and organizations who have publicly taken a side on this statement: in interviews, posts, op-eds, testimony, podcasts, speeches, press releases, or public comment letters. Most will never say the statement word for word. Look for what they actually said that commits them to a side: backing or attacking a bill that would do this, arguing for or against the idea, or a remix of it in their own words.

Balance matters most. Find people who DISAGREE as hard as you look for people who agree. Aim for roughly 12 to 20 candidates, with at least a third on the side that is easier to miss. Include mixed views (yes, but only with conditions) when you find them.
Prefer people and organizations already on the site (list below), but include notable others: lawmakers, officials, companies, researchers, advocacy groups, trade groups, unions, and think tanks.

Rules, which are strict:
1. Every quote must be copied exactly, character for character, from a page you actually opened. Never paraphrase, tidy, merge sentences, or quote from memory. A program will fetch the link and reject any quote it cannot find there word for word.
2. The quote must be the speaker's own words (or the organization's official text), not a journalist's summary of them.
3. The url must be the page where the quote appears, not a search results page. Prefer the original (the op-ed, the transcript, the letter, the official site) over coverage of it. Social posts are fine when you could open them.
4. Keep each quote short: one to three sentences, 15 to 80 words, enough to show the side.
5. Give the date it was said or published (YYYY-MM-DD, or YYYY-MM, or YYYY) when the page shows it.
6. If you cannot open a page to copy the quote, leave that candidate out.

Site names (prefer these spellings when it is the same person or organization):
${siteNames}`;

export const OUTPUT_FORMAT = `Output: JSON lines, one candidate per line, with these fields:
{"topic_id": "<statement id>", "speaker_name": "...", "speaker_role": "short descriptor, e.g. US senator (R-TX)", "quote": "exact words", "url": "https://...", "date": "YYYY-MM-DD or null", "source_kind": "interview|post|op-ed|testimony|podcast|speech|press release|comment letter|report|other", "lean": "agree|disagree|mixed"}`;

export function loadCandidates(topicId?: string): Candidate[] {
  if (!existsSync(RESEARCH_DIR)) return [];
  const files = (topicId ? [`${topicId}.jsonl`] : []).concat(topicId ? [] : readdirSync(RESEARCH_DIR).filter((f: string) => f.endsWith(".jsonl")));
  return files.filter((f) => existsSync(join(RESEARCH_DIR, f))).flatMap((f) => readFileSync(join(RESEARCH_DIR, f), "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
}

// API path: one search session per statement.
export async function findOnline(s: Statement, siteNames: string): Promise<Candidate[]> {
  const m = await call(FINDER_VERSION, { max_tokens: 32000, output_config: { effort: "medium" },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 25 }, { type: "web_fetch_20260209", name: "web_fetch", max_uses: 40 }],
    messages: [{ role: "user", content: `${FINDER_BRIEF(s, siteNames)}\n\n${OUTPUT_FORMAT.replace("<statement id>", s.id)}\nReply with only the JSON lines.` }] });
  const found = textOf(m).split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{")).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((c): c is Candidate => !!c?.quote && !!c?.url && !!c?.speaker_name).map((c) => ({ ...c, topic_id: s.id, found_by: FINDER_VERSION }));
  mkdirSync(RESEARCH_DIR, { recursive: true });
  const file = join(RESEARCH_DIR, `${s.id}.jsonl`);
  const old = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, old + found.map((c) => JSON.stringify(c)).join("\n") + (found.length ? "\n" : ""));
  return found;
}
