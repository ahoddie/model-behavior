// Rule-based issue tags for statements. No language model, no network: phrase patterns on the quote, bill/rule names in the
// quote, and the statement's stance_target / target_id. Tags are topics only (no stance), from the fixed list in issue_areas.
// Precision comes first: a pattern is kept only if it names the issue in plain words, and at most 3 tags are given per statement.
// Output goes to statement_issue_rules (db/migrations/202), never to feed_items or statement_labels.
// Usage: pnpm tsx scripts/tag-issues-rules.ts [--dry-run (default)] [--apply] [--target] [--report] [--version r1]
//   dry run : prints counts per issue, sample tags with the words that fired, and precision/recall on the hand-labeled set
//   --apply : upserts one row per statement into statement_issue_rules (run db/migrations/202_statement_issue_rules.sql first)
//   --report: also writes data/validation/issue-rules-report.md (model vs rules vs combinations on reference-v5.json)
import "./env.ts";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pool, q } from "../src/lib/db.ts";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const has = (k: string) => process.argv.includes(k);
export const RULES_VERSION = arg("--version") ?? "r1";
// Off by default: on the hand-labeled set the target added 4 right tags and 5 wrong ones (a quote about SB 53 is often about
// something else), so precision is better without it. --target turns it on; the report shows both.
const USE_TARGET = has("--target");

// 1. Phrase rules on the quote. Case-insensitive unless a pattern is a bare acronym (then it is written with (?-i:...)).
const TEXT_RULES: [string, RegExp][] = [
  ["preemption", /preempt|moratorium|patchwork|\bfifty (?:different )?(?:state|laws)|\b50 (?:different |separate |state )?(?:state|laws|rules|regulat)|state[- ]by[- ]state|conflicting (?:state|local)|states? (?:should not|shouldn't|can't|cannot) regulate|(?:override|overrid\w+|supersed\w+|invalidat\w+|nullif\w+|block\w*|pause\w*) (?:key |existing |all )?(?:state|local) (?:AI )?(?:laws|regulations|rules|protections|bills)/i],
  ["frontier_rules", /frontier (?:AI|model|lab|developer|compan|system|safety|regulat|rules?)|third[- ]party (?:test|audit|evaluat)|(?:safety|risk) (?:testing|evaluation|framework|report|protocol|disclosure)|incident report|pre[- ]?deployment|model evaluation|AI safety institute|\bCAISI\b|\bSB[ -]?(?:1047|53)\b|\bRAISE Act\b|whistleblower|red[- ]team|compute threshold|(?:mandatory|required) (?:testing|audits?|reporting|disclosure)/i],
  ["catastrophic_risk", /catastroph|existential|\bx-?risk|loss of control|lose control|bioweapon|bio-?terror|biological weapon|superintelligen|extinction|AI takeover|rogue AI|misaligned/i],
  ["china", /\bChina\b|\bChinese\b|\bCCP\b|\bPRC\b|\bBeijing\b|export[- ]control|chip (?:export|security|smuggl)|\bDeepSeek\b|\bHuawei\b|foreign adversar|\bGAIN AI\b|\bAI race\b|arms race/i],
  ["open_models", /open[- ]source|open[- ]weight|open[- ]model|model weights|\bweights\b/i],
  ["copyright", /copyright|fair use|training data|\blikeness\b|NO FAKES|digital replica|intellectual property|\bpiracy\b|licens(?:e|ing) (?:fees|deals?)|(?:artists|authors|creators|musicians|publishers|journalists) .{0,40}(?:paid|compensat|permission|consent|scrap)/i],
  ["kids_safety", /\bchild(?:ren)?\b|\bkids?\b|\bminors?\b|\bteen(?:s|agers?)?\b|age (?:verification|assurance|check)|\bKOSA\b|\bCOPPA\b|self[- ]harm|suicide|companion (?:bot|chatbot|app)/i],
  ["jobs", /\bjobs?\b|\bworkers?\b|\bworkforce\b|unemploy|layoffs?|labor market|\bwages?\b|job (?:loss|displacement)|white[- ]collar|replace (?:humans|workers|people)|displac(?:e|ing) (?:workers|jobs|humans)/i],
  ["energy", /data[- ]?cent(?:er|re)s?|\benergy\b|electricity|power (?:grid|plants?|demand|supply|generation)|\bgrid\b|gigawatt|\bGW\b|nuclear (?:power|energy|plants?|reactors?)|permitting|\bpower for AI|\bcompute (?:buildout|capacity|infrastructure)|\bStargate\b/i],
  ["national_security", /national[- ]security|\bmilitary\b|\bPentagon\b|Department of (?:War|Defense)|\bDoD\b|\bdefen[cs]e\b|intelligence (?:community|agenc)|warfare|autonomous weapon|\bNDAA\b|\bwarfighter|\bbattlefield\b/i],
  ["liability", /\bliabilit|\bliable\b|safe harbor|duty of care|negligen|\bsued?\b|lawsuits?|held (?:legally )?(?:accountable|responsible)/i],
  ["civil_rights", /\bbias(?:ed)?\b|discriminat|civil (?:rights|liberties)|surveillance|facial recognition|algorithmic (?:accountability|fairness|discrimination)|disparate impact/i],
  ["elections", /\belections?\b|deepfakes?|synthetic media|political (?:ads?|advertis|deepfake)|disinformation|misinformation|\bvoters?\b|\bballots?\b|campaign (?:ads?|advertis)/i],
  ["innovation", /\binnovat|competitive(?:ness)?\b|\bstart-?ups?\b|small (?:business|compan|developer|team)|stifle|\bchoke\b|burdensome|over-?regulat|red tape|permissionless|slow(?:s|ing)? (?:down )?(?:AI|progress|development)|lead(?:ership)? (?:in|of) (?:AI|the world)|American leadership|AI leadership|\bwin the (?:AI )?race\b|fall behind/i],
  ["federal_framework", /(?:federal|national) (?:AI )?(?:framework|standard|legislation|law|approach|policy|rules)|(?:one|single|unified|uniform) (?:national|federal) (?:standard|approach|framework|rulebook)|comprehensive (?:federal )?(?:AI )?(?:law|legislation|regulation|framework)|Congress (?:should|must|needs to|has to|to) (?:pass|act|legislate|set|establish)|\bCongress (?:act|legislate)s?\b/i],
  ["agency_rules", /executive order|rulemaking|\bNIST\b|\bFTC\b|\bFCC\b|\bBIS\b|\bOMB\b|Federal Register|agency (?:rule|guidance|action)|AI Action Plan|Commerce Department|Department of Commerce|\bEO ?14\d{3}\b/i],
];

// 2. A bill or rule the statement is about (stance_target, else target_id) names the issue(s) plainly. Broad documents
// (the OSTP RFIs, the Action Plan, voluntary commitments) are left out: they cover everything.
const TARGET_ISSUES: Record<string, string[]> = {
  "us-ai-moratorium-2025": ["preemption"],
  "us-ndaa-fy2026-ai-preemption": ["preemption"],
  "eo-14365": ["preemption"],
  "wh-ai-legislative-framework-2026": ["federal_framework"],
  "us-great-american-ai-act-draft-2026": ["federal_framework"],
  "ca-sb1047-2024": ["frontier_rules"],
  "ca-sb53-2025": ["frontier_rules"],
  "ny-raise-act-2025": ["frontier_rules"],
  "us-119-hr9925": ["frontier_rules"],
  "ma-h5576-2026": ["frontier_rules"],
  "il-sb3444-2026": ["liability"],
  "ca-ab2013-2024": ["copyright"],
  "us-119-s1367": ["copyright"],
  "ca-ab3211-2024": ["elections"],
  "us-119-s3150": ["china"],
  "rule-bis-ai-diffusion": ["china"],
  "eo-14110": ["agency_rules"],
};

// Tags are kept in this order when more than 3 fire: specific issues first, the broad ones (innovation, federal_framework,
// agency_rules, energy, jobs) last, because those words appear in many quotes that are about something else.
const PRIORITY = ["preemption", "frontier_rules", "catastrophic_risk", "china", "open_models", "copyright", "kids_safety", "liability", "elections",
  "civil_rights", "national_security", "energy", "jobs", "federal_framework", "agency_rules", "innovation"];
export const MAX_TAGS = 3;

export type Tagged = { issues: string[]; via: Record<string, string> };
export function tagIssues(text: string, target?: string | null, useTarget = true): Tagged {
  const via: Record<string, string> = {};
  for (const [issue, re] of TEXT_RULES) { const m = text.match(re); if (m) via[issue] = `text: ${m[0].toLowerCase()}`; }
  if (useTarget && target && TARGET_ISSUES[target]) for (const issue of TARGET_ISSUES[target]) via[issue] = `target: ${target}${via[issue] ? " + " + via[issue] : ""}`;
  const issues = PRIORITY.filter((i) => i in via).slice(0, MAX_TAGS);
  return { issues, via: Object.fromEntries(issues.map((i) => [i, via[i]])) };
}

// ---- evaluation on the hand-labeled set, measured the way validate.ts reads it: tags only, direction ignored ----
type Cell = { tp: number; fp: number; fn: number };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");
const prf = (c: Cell) => ({ p: pct(c.tp, c.tp + c.fp), r: pct(c.tp, c.tp + c.fn), f: c.tp ? `${Math.round((2 * c.tp / (2 * c.tp + c.fp + c.fn)) * 100)}%` : "n/a" });

async function evaluate(useTarget: boolean, version = "v5") {
  const ref = JSON.parse(readFileSync(new URL(`../../data/validation/reference-${version}.json`, import.meta.url), "utf8")).labels as Record<string, { issues: Record<string, number> }>;
  const ids = Object.keys(ref);
  const rows = await q<{ id: string; excerpt: string; stance_target: string | null; target_id: string | null; own_voice: boolean; issues: Record<string, number> }>(`
    SELECT fi.id, fi.excerpt, fi.stance_target, fi.target_id, sl.own_voice, sl.issues FROM feed_items fi
    JOIN statement_labels sl ON sl.feed_id = fi.id AND sl.prompt_version = $1 WHERE fi.id = ANY($2::bigint[])`, [version, ids]);
  const systems = ["model", "rules", "both agree (AND)", "either (OR)"] as const;
  const cells: Record<string, Record<string, Cell>> = Object.fromEntries(systems.map((s) => [s, {}]));
  const allIssues = new Set<string>();
  const per: { id: string; gold: string[]; model: string[]; rules: string[]; via: Record<string, string>; text: string }[] = [];
  for (const r of rows) {
    const gold = Object.keys(ref[String(r.id)].issues);
    const model = r.own_voice ? Object.keys(r.issues) : []; // as validate.ts: a statement judged not the speaker's own gets no issues
    const t = tagIssues(r.excerpt ?? "", r.stance_target ?? r.target_id, useTarget);
    const set = { model, rules: t.issues, "both agree (AND)": model.filter((i) => t.issues.includes(i)), "either (OR)": [...new Set([...model, ...t.issues])] };
    [...gold, ...model, ...t.issues].forEach((i) => allIssues.add(i));
    for (const s of systems) for (const i of new Set([...gold, ...set[s]])) {
      const c = (cells[s][i] ??= { tp: 0, fp: 0, fn: 0 });
      const g = gold.includes(i), p = set[s].includes(i);
      if (g && p) c.tp++; else if (p) c.fp++; else c.fn++;
    }
    per.push({ id: String(r.id), gold, model, rules: t.issues, via: t.via, text: r.excerpt ?? "" });
  }
  const total = (s: string) => Object.values(cells[s]).reduce((a, c) => ({ tp: a.tp + c.tp, fp: a.fp + c.fp, fn: a.fn + c.fn }), { tp: 0, fp: 0, fn: 0 });
  return { n: rows.length, systems, cells, total, issues: [...allIssues].sort(), per };
}

function reportMd(e: Awaited<ReturnType<typeof evaluate>>, et: Awaited<ReturnType<typeof evaluate>>) {
  const line = (label: string, s: string, c: Cell) => { const x = prf(c); return `| ${label} | ${s} | ${c.tp} | ${c.fp} | ${c.fn} | ${x.p} | ${x.r} | ${x.f} |`; };
  const overall = e.systems.map((s) => line("**All issues**", s, e.total(s))).join("\n");
  const perIssue = e.issues.map((i) => e.systems.map((s) => line(i, s, e.cells[s][i] ?? { tp: 0, fp: 0, fn: 0 })).join("\n")).join("\n");
  const wrong = e.per.filter((p) => p.rules.some((i) => !p.gold.includes(i)) || p.gold.some((i) => !p.rules.includes(i)))
    .map((p) => `- #${p.id} gold [${p.gold}] rules [${p.rules.map((i) => `${i} (${p.via[i]})`)}] model [${p.model}]. “${p.text}”`).join("\n");
  return `# Issue tags: rules vs model vs combinations

Hand-labeled set: ${e.n} statements in \`reference-v5.json\` (labeled by Claude, not a person; the same 50 statements as v3 and v4). Model labels: \`statement_labels\`, prompt v5.
Rules: \`web/scripts/tag-issues-rules.ts\` rules version \`${RULES_VERSION}\`${USE_TARGET ? ", target mapping on" : ""}. No language model.
A tag counts as right when the reference lists the same issue id for that statement; direction (agree/disagree) is ignored. This is the same
reading validate.ts uses for "issues the model found that the reference also found" (precision) and "issues the reference found that the model also found" (recall).
Model tags on statements judged not to be the speaker's own opinion are dropped, as in validate.ts.

Caution: 50 statements and ${e.total("rules").tp + e.total("rules").fn} reference tags is a small set. The patterns were written from the issue definitions and tag-filings.ts word lists, then checked against this set, so the rules numbers are a little optimistic. Per-issue rows with fewer than about 5 tags are noise.

| Issue | System | Right | Wrong | Missed | Precision | Recall | F1 |
|---|---|---|---|---|---|---|---|
${overall}
${perIssue}

## Same rules with the target mapping switched ${USE_TARGET ? "off" : "on"} (stance_target / target_id adds the bill's issue)

| Issue | System | Right | Wrong | Missed | Precision | Recall | F1 |
|---|---|---|---|---|---|---|---|
${et.systems.filter((s) => s !== "model").map((s) => line("**All issues**", s, et.total(s))).join("\n")}

## Statements where rules and reference differ

${wrong}
`;
}

// ---- main ----
const APPLY = has("--apply");
const ev = await evaluate(USE_TARGET);
const o = (s: string) => { const c = ev.total(s), x = prf(c); return `${s.padEnd(18)} precision ${x.p.padStart(4)}  recall ${x.r.padStart(4)}  F1 ${x.f.padStart(4)}  (right ${c.tp}, wrong ${c.fp}, missed ${c.fn})`; };
console.log(`Hand-labeled set (${ev.n} statements):\n${ev.systems.map(o).join("\n")}\n`);
if (has("--report")) { writeFileSync(new URL("../../data/validation/issue-rules-report.md", import.meta.url), reportMd(ev, await evaluate(!USE_TARGET))); console.log("wrote data/validation/issue-rules-report.md"); }

// Same population analyze.ts labels.
const rows = await q<{ id: number; excerpt: string; stance_target: string | null; target_id: string | null; name: string }>(`
  SELECT fi.id, fi.excerpt, fi.stance_target, fi.target_id, n.name FROM feed_items fi JOIN nodes n ON n.id = fi.node_id
  WHERE fi.status = 'approved' AND fi.excerpt IS NOT NULL AND fi.kind NOT IN ('donation','policy change','filing') AND n.type NOT IN ('lawmaker','agency','bill','race','rule')
  ORDER BY fi.date DESC NULLS LAST, fi.id`);
const done = new Map((await q<{ feed_id: number; input_hash: string }>(`SELECT feed_id, input_hash FROM statement_issue_rules WHERE rules_version = $1`, [RULES_VERSION]).catch(() => [])).map((r) => [r.feed_id, r.input_hash]));
const counts: Record<string, number> = {};
const out = rows.map((r) => {
  const tgt = r.stance_target ?? r.target_id;
  const t = tagIssues(r.excerpt, tgt, USE_TARGET);
  t.issues.forEach((i) => (counts[i] = (counts[i] ?? 0) + 1));
  return { r, t, hash: createHash("sha256").update(`${RULES_VERSION}|${USE_TARGET}|${tgt ?? ""}|${r.excerpt}`).digest("hex").slice(0, 16) };
});
const changed = out.filter((x) => done.get(x.r.id) !== x.hash);
console.log(`${rows.length} statements, ${out.filter((x) => x.t.issues.length).length} get at least one tag, ${changed.length} new or changed for ${RULES_VERSION}`);
console.log("tags per issue:", Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
if (!APPLY) {
  console.log("\nSample (dry run, nothing written):");
  for (const x of out.filter((x) => x.t.issues.length).slice(0, 15)) console.log(`#${x.r.id} ${x.r.name}: ${x.t.issues.map((i) => `${i} [${x.t.via[i]}]`).join(", ")}\n   “${x.r.excerpt.slice(0, 140)}”`);
  console.log("\nRe-run with --apply to write these to statement_issue_rules.");
} else {
  for (const x of changed)
    await pool.query(`INSERT INTO statement_issue_rules (feed_id, rules_version, input_hash, issues, via) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (feed_id, rules_version) DO UPDATE SET input_hash=$3, issues=$4, via=$5, tagged_at=now()`, [x.r.id, RULES_VERSION, x.hash, x.t.issues, JSON.stringify(x.t.via)]);
  console.log(`wrote ${changed.length} rows to statement_issue_rules`);
}
await pool.end();
