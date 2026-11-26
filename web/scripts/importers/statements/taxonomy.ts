// Reads config/taxonomy.yaml (CONTRACTS.md section 3) and adds deterministic target detection.
// The yaml is small and regular, so this is a line parser rather than a dependency (a `yaml` dependency would be a contract change).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../env.ts";

export type Issue = { id: string; label: string; statement: string };
export type Target = { id: string; node: string; label: string; issues: string[] };

function load() {
  const lines = readFileSync(join(REPO, "config/taxonomy.yaml"), "utf8").split("\n");
  const issues: Issue[] = [], targets: Target[] = [];
  let section = "", cur: Partial<Issue> | null = null;
  const flush = () => { if (cur?.id && cur.label && cur.statement) issues.push(cur as Issue); cur = null; };
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, (m) => (m.includes('"') ? m : "")).trimEnd();
    if (/^issues:/.test(line)) { section = "issues"; continue; }
    if (/^targets:/.test(line)) { flush(); section = "targets"; continue; }
    if (section === "issues") {
      let m = line.match(/^\s*- id: (\S+)/); if (m) { flush(); cur = { id: m[1] }; continue; }
      m = line.match(/^\s+label: (.*)$/); if (m && cur) cur.label = m[1].trim();
      m = line.match(/^\s+statement: (.*)$/); if (m && cur) cur.statement = m[1].trim();
    } else if (section === "targets") {
      const m = line.match(/^\s*- \{ id: ([^,]+), node: ([^,]+), label: "([^"]+)", issues: \[([^\]]*)\] \}/);
      if (m) targets.push({ id: m[1].trim(), node: m[2].trim(), label: m[3], issues: m[4].split(",").map((s) => s.trim()).filter(Boolean) });
    }
  }
  flush();
  if (issues.length < 10 || targets.length < 10) throw new Error(`taxonomy.yaml parse looks wrong: ${issues.length} issues, ${targets.length} targets`);
  return { issues, targets };
}
export const TAXONOMY = load();
export const ISSUE_IDS = TAXONOMY.issues.map((i) => i.id);
export const TARGET_IDS = TAXONOMY.targets.map((t) => t.id);
export const issueById = (id: string) => TAXONOMY.issues.find((i) => i.id === id);
export const targetById = (id: string) => TAXONOMY.targets.find((t) => t.id === id);

// Words that identify each target in text. A target is only ever attached to a statement when one of these appears in the
// statement's own text, so the model cannot invent a target.
const PATTERNS: Record<string, RegExp> = {
  "us-ai-moratorium-2025": /\bmoratorium\b|10-year (?:ban|pause|freeze)|ten-year (?:ban|pause|freeze)/i,
  "us-ndaa-fy2026-ai-preemption": /\bNDAA\b.{0,80}(?:AI|preempt)|(?:AI|preempt).{0,80}\bNDAA\b/is,
  "eo-14365": /\bEO ?14365\b|executive order 14365|executive order.{0,60}(?:state AI laws|preempt|national policy framework)/i,
  "wh-ai-legislative-framework-2026": /(?:White House|administration).{0,40}(?:AI )?legislative framework|national AI legislative framework/i,
  "us-great-american-ai-act-draft-2026": /Great American AI Act/i,
  "ca-sb53-2025": /\bSB[ -]?53\b/i,
  "ca-sb1047-2024": /\bSB[ -]?1047\b/i,
  "ny-raise-act-2025": /\bRAISE Act\b/i,
  "ca-sb813-2025": /\bSB[ -]?813\b/i,
  "us-119-hr9925": /\bFRONTIER Act\b|\bH\.?R\.? ?9925\b/i,
  "il-sb3444-2026": /\bSB[ -]?3444\b/i,
  "us-119-s1792": /AI Whistleblower Protection Act|\bS\.? ?1792\b/i,
  "rule-bis-ai-diffusion": /AI diffusion (?:rule|framework)|diffusion (?:rule|framework)|Framework for Artificial Intelligence Diffusion/i,
  "us-119-hr3447": /\bH\.?R\.? ?3447\b/i,
  "us-119-s1705": /\bS\.? ?1705\b|\bChip Security Act\b/i,           // a bare "Chip Security Act" maps to the Senate bill (original vehicle)
  "us-119-hr5885": /\bH\.?R\.? ?5885\b/i,
  "us-119-s3150": /\bS\.? ?3150\b|\bGAIN AI Act\b/i,                  // bare "GAIN AI Act" maps to the Senate bill
  "us-119-s146": /TAKE IT DOWN Act/i,
  "ca-sb1119-2026": /\bSB[ -]?1119\b/i,
  "ca-ab2023-2026": /\bAB[ -]?2023\b/i,
  "us-119-s1367": /NO FAKES Act/i,
  "us-119-s2750": /\bSANDBOX Act\b/i,
  "ostp-ai-action-plan-rfi-2025": /(?:AI Action Plan).{0,60}(?:RFI|request for information)|OSTP.{0,40}(?:RFI|request for information)/i,
  "ai-action-plan-2025": /\bAI Action Plan\b/i,
  "eo-14110": /\bEO ?14110\b|executive order 14110|Biden(?:'s|’s)? (?:AI |artificial intelligence )?executive order/i,
  "co-sb24-205-2024": /Colorado(?:'s|’s)? (?:AI Act|artificial intelligence act)|\bSB ?24-205\b/i,
  "ca-ab1018-2025": /\bAB[ -]?1018\b/i,
};
// Order matters when several match: the more specific target is listed first.
const SPECIFIC_FIRST = ["ostp-ai-action-plan-rfi-2025", "us-119-hr3447", "us-119-hr5885", "us-ndaa-fy2026-ai-preemption", "eo-14365", "ai-action-plan-2025"];

export function detectTargets(text: string): string[] {
  const hits = TARGET_IDS.filter((id) => PATTERNS[id]?.test(text));
  return [...hits].sort((a, b) => (SPECIFIC_FIRST.includes(b) ? 1 : 0) - (SPECIFIC_FIRST.includes(a) ? 1 : 0));
}
export const patternFor = (id: string) => PATTERNS[id];
