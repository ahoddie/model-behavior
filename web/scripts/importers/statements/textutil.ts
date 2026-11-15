// Deterministic text helpers for the statements pipeline: quote verification, windows, prefilter, robots-aware fetching.
import { createHash } from "node:crypto";
import { politeFetch, sleep } from "../../lib/ingest.ts";
import { htmlToText } from "../../lib/text.ts";

export const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
export const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

// ---- quote verification ------------------------------------------------------------------------------------------------------
// A quote is kept only if it is a verbatim substring of the source text (after folding curly quotes, dashes and whitespace runs).
// The stored excerpt is the SOURCE's own slice, never the model's output.
const fold = (c: string) => ({ "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'", "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"', "–": "-", "—": "-", "−": "-", " ": " " } as Record<string, string>)[c] ?? c;
function normMap(s: string) {
  let out = "";
  const map: number[] = [];
  let prevSpace = true;
  for (let i = 0; i < s.length; i++) {
    const c = fold(s[i]);
    if (/\s/.test(c)) { if (!prevSpace) { out += " "; map.push(i); prevSpace = true; } continue; }
    out += c; map.push(i); prevSpace = false;
  }
  return { norm: out.trimEnd(), map };
}
export type QuoteCheck = { text: string; strict: boolean } | null;
export function verifyQuote(quote: string, source: string, maxWords = 25): QuoteCheck {
  const q0 = quote.trim().replace(/^["“'‘]+|["”'’]+$/g, "").trim();
  if (!q0 || /\.\.\.|…/.test(q0)) return null;          // an ellipsis means the model joined pieces
  if (words(q0) > maxWords) return null;
  if (source.includes(q0)) return { text: q0, strict: true };
  const s = normMap(source), q = normMap(q0).norm;
  if (!q) return null;
  const at = s.norm.indexOf(q);
  if (at < 0) return null;
  const start = s.map[at], end = s.map[at + q.length - 1] + 1;
  const text = source.slice(start, end).replace(/\s+/g, " ").trim();
  return words(text) <= maxWords ? { text, strict: false } : null;
}

// ---- prefilter ---------------------------------------------------------------------------------------------------------------
const AI_TERMS = /\b(?:AI|A\.I\.|AGI|GPUs?|LLMs?|OpenAI|Anthropic|DeepMind|ChatGPT|Gemini|Claude|Nvidia|xAI)\b|artificial intelligence|machine learning|language models?|frontier (?:models?|labs?|AI|developers?)|foundation models?|generative|chatbots?|superintelligen|data cent(?:er|re)s?|semiconductors?|\bchips?\b|model weights|deepfakes?|compute\b/;
const POLICY_STRONG = /\b(?:regulat\w*|legislat\w*|laws?|lawmakers?|congress\w*|senat\w*|house of representatives|bills?|preempt\w*|moratorium|executive orders?|export controls?|polic(?:y|ies)|governance|oversight|liabilit\w*|licens(?:e|ing)|mandat\w*|government|federal|state AI|White House|FTC|NIST|CAISI|safety institute|ban(?:s|ned)?\b|testif\w*|hearing|SB ?\d+|AB ?\d+|H\.?R\.? ?\d+|treat(?:y|ies)|tariffs?|antitrust|lobby\w*|super ?PAC|rulemaking|statute|compliance|transparency (?:requirement|law|rule)|safety (?:law|rule|requirement|standard|testing))/i;
export const aiTerms = (t: string) => AI_TERMS.test(t);
export const policyTerms = (t: string) => POLICY_STRONG.test(t);
export const passesPrefilter = (t: string) => AI_TERMS.test(t) && POLICY_STRONG.test(t);
const density = (t: string) => (t.match(new RegExp(AI_TERMS.source, "g"))?.length ?? 0) + (t.match(new RegExp(POLICY_STRONG.source, "gi"))?.length ?? 0);

// Split a long own-words document into model-sized windows and keep the most policy-dense ones.
export function topWindows(text: string, k = 3, maxChars = 1100): string[] {
  const paras = text.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 40);
  const wins: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length > maxChars) { wins.push(cur); cur = ""; }
    cur += (cur ? "\n" : "") + (p.length > maxChars ? p.slice(0, maxChars) : p);
  }
  if (cur) wins.push(cur);
  return wins.filter(passesPrefilter).sort((a, b) => density(b) / Math.sqrt(b.length) - density(a) / Math.sqrt(a.length)).slice(0, k);
}

export function sentences(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?]["”’']?)\s+(?=[A-Z“"'‘(])/).map((s) => s.trim()).filter(Boolean);
}

export const normQuote = (s: string) => normMap(s).norm.toLowerCase().replace(/[^\p{L}\p{N} ]+/g, " ").replace(/\s+/g, " ").trim();
export function similar(a: string, b: string): boolean {
  const x = normQuote(a), y = normQuote(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const A = new Set(x.split(" ")), B = new Set(y.split(" "));
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter) >= 0.8;
}

// ---- robots.txt-aware fetching (CONTRACTS.md rule 6) ---------------------------------------------------------------------------
const robots = new Map<string, { disallow: string[]; allow: string[] } | null>();
const UA = "ModelBehavior-local-research";
async function robotsFor(origin: string) {
  if (robots.has(origin)) return robots.get(origin)!;
  let rules: { disallow: string[]; allow: string[] } | null = null;
  try {
    const r = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": `${UA}/0.1` } });
    if (r.ok) {
      const dis: string[] = [], alw: string[] = [];
      let applies = false, seen = false;
      for (const line of (await r.text()).split("\n")) {
        const m = line.replace(/#.*/, "").match(/^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/);
        if (!m) continue;
        const [k, v] = [m[1].toLowerCase(), m[2]];
        if (k === "user-agent") { const star = v === "*", me = v.toLowerCase().includes("modelbehavior"); if (!seen || !applies) applies = star || me; else applies = applies || star || me; seen = true; }
        else if (applies && k === "disallow" && v) dis.push(v);
        else if (applies && k === "allow" && v) alw.push(v);
      }
      rules = { disallow: dis, allow: alw };
    }
  } catch { /* no robots.txt reachable: treat as allowed */ }
  robots.set(origin, rules);
  return rules;
}
export async function allowedByRobots(url: string): Promise<boolean> {
  const u = new URL(url);
  const r = await robotsFor(u.origin);
  if (!r) return true;
  const path = u.pathname + u.search;
  const longest = (list: string[]) => Math.max(-1, ...list.filter((p) => path.startsWith(p.replace(/\*.*$/, ""))).map((p) => p.length));
  return longest(r.allow) >= longest(r.disallow);
}
export async function fetchPage(url: string, opts: { html?: boolean } = {}): Promise<{ text: string; html: string; finalUrl: string } | null> {
  try {
    if (!(await allowedByRobots(url))) return null;
    const res = await politeFetch(url, { redirect: "follow", signal: AbortSignal.timeout(30000) } as RequestInit);
    if (!res.ok || !/html|text|xml/.test(res.headers.get("content-type") ?? "")) return null;
    const html = await res.text();
    return { html, text: opts.html ? "" : htmlToText(html), finalUrl: res.url };
  } catch { return null; }
}
export { sleep };
