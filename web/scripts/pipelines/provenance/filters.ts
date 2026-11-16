// Deterministic filters applied before and after the model: legal boilerplate that every bill shares, and commentary that merely quotes the bill itself.
import { readText } from "./lib.ts";

const BOILER: RegExp[] = [
  /provisions of this (act|chapter|article|section|title) are severable/i,
  /\bbe it enacted by the\b/i,
  /key vote:\s*majority|appropriation:\s*no|fiscal committee:/i,
  /introduced the following bill/i,
  /this (act|chapter|article) (shall be|may be) (known|cited)|may be cited as the/i,
  /\bthe people of the state of california do enact\b/i,
  /^\W*(sec(tion|\.)?\s*\d+\.\s*)?(an act to|chapter [\d.]+ \(commencing with)|\(commencing with section [\d.]+\) (is|are) added/i,
  /imposes a limitation on the public.s right of access to the meetings of public bodies/i,
  /\bhas the same meaning as\b|\bhave the same meaning as\b/i,
  /\(commencing with section [\d.]+\) (is|are) added to|section [\d.]+ of the [a-z &]+ code is amended to read|is added to (part|division|chapter|title) [\d.]+/i,
  /^\W*(\d+\s+)?introduced by (assembly member|senator|sen\.|rep\.)/i,
  /does not limit the application of other laws/i,
  /the report required by this subdivision shall include all of the following/i,
  /^\W*\(?[a-z0-9]{1,4}\)?\s*the committee on [^.]{0,120}(senate|house)[^.]{0,200}$/i,
];
export function isBoilerplate(billClause: string, srcClause: string): boolean {
  return BOILER.some((r) => r.test(billClause)) && BOILER.some((r) => r.test(srcClause));
}

// Identifier patterns for a tracked bill, to spot commentary about the bill that quotes it.
export function billPattern(nodeId: string): RegExp | null {
  let m = nodeId.match(/^[a-z]{2}-(sb|ab|hb)(\d+)-/); if (m) return new RegExp(`\\b${m[1]}\\s*${m[2]}\\b`, "i");
  m = nodeId.match(/^us-\d+-(hr|s)(\d+)$/); if (m) return m[1] === "hr" ? new RegExp(`\\bh\\.?\\s?r\\.?\\s*${m[2]}\\b`, "i") : new RegExp(`\\bs\\.\\s*${m[2]}\\b`, "i");
  if (nodeId.startsWith("ny-raise")) return /\braise act\b/i;
  return null;
}
const mentionCache = new Map<string, boolean>();
export function sourceMentionsBill(src: { id: number; source_kind: string; text_path: string }, billNodeId: string): boolean {
  if (src.source_kind === "bill_version") return false;     // a bill reusing another bill is real provenance
  const k = `${src.id}|${billNodeId}`;
  if (mentionCache.has(k)) return mentionCache.get(k)!;
  const p = billPattern(billNodeId);
  const v = p ? p.test(readText(src.text_path)) : false;
  mentionCache.set(k, v);
  return v;
}
