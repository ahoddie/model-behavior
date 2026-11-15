// Compares the local model's labels with a reference set and writes data/validation/report-<version>.md.
// Usage: pnpm validate [--version v3]
import "./env.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { pool, q } from "../src/lib/db.ts";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const VERSION = arg("--version") ?? "v3";
const dir = new URL("../../data/validation/", import.meta.url);
const ref = JSON.parse(readFileSync(new URL(`reference-${VERSION}.json`, dir), "utf8"));
type L = { own: boolean; issues: Record<string, number>; tone: number | null };
const refs: Record<string, L> = ref.labels;

const rows = await q<{ feed_id: string; own_voice: boolean; issues: Record<string, number>; tone: number | null; name: string; excerpt: string }>(`
  SELECT sl.feed_id, sl.own_voice, sl.issues, sl.tone, n.name, fi.excerpt FROM statement_labels sl
  JOIN feed_items fi ON fi.id = sl.feed_id JOIN nodes n ON n.id = fi.node_id
  WHERE sl.prompt_version = $1 AND sl.feed_id = ANY($2::bigint[])`, [VERSION, Object.keys(refs)]);
const got = new Map(rows.map((r) => [String(r.feed_id), r]));

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");
const sign = (v: number) => Math.sign(v);
let n = 0, ownAgree = 0;
let toneBoth = 0, toneExact = 0, toneWithin1 = 0, toneFlip = 0, toneNullAgree = 0;
let refIssues = 0, modelIssues = 0, shared = 0, issExact = 0, issWithin1 = 0, issFlip = 0;
const misses: string[] = [];

for (const [id, r] of Object.entries(refs)) {
  const m = got.get(id);
  if (!m) continue;
  n++;
  if (m.own_voice === r.own) ownAgree++;
  const mTone = m.own_voice ? m.tone : null;
  if (r.tone == null && mTone == null) toneNullAgree++;
  if (r.tone != null && mTone != null) {
    toneBoth++;
    if (r.tone === mTone) toneExact++;
    if (Math.abs(r.tone - mTone) <= 1) toneWithin1++;
    if (sign(r.tone) * sign(mTone) < 0) { toneFlip++; misses.push(`#${id} ${m.name}: tone reference ${r.tone}, model ${mTone}. “${m.excerpt}”`); }
  }
  const mi = m.own_voice ? m.issues : {};
  refIssues += Object.keys(r.issues).length;
  modelIssues += Object.keys(mi).length;
  for (const [k, v] of Object.entries(r.issues)) {
    if (!(k in mi)) continue;
    shared++;
    if (mi[k] === v) issExact++;
    if (Math.abs(mi[k] - v) <= 1) issWithin1++;
    if (sign(mi[k]) * sign(v) < 0) { issFlip++; misses.push(`#${id} ${m.name}: ${k} reference ${v}, model ${mi[k]}. “${m.excerpt}”`); }
  }
}

const report = `# Label agreement, prompt ${VERSION}

${n} statements from the random reference sample in \`reference-${VERSION}.json\` had model labels.
The reference was labeled by Claude, not a person, without seeing the model's answers. Treat these numbers as a first check, not a final one.

| Measure | Result |
|---|---|
| Own voice: same answer | ${ownAgree} of ${n} (${pct(ownAgree, n)}) |
| Tone, where both gave one: exact | ${toneExact} of ${toneBoth} (${pct(toneExact, toneBoth)}) |
| Tone, where both gave one: within 1 | ${toneWithin1} of ${toneBoth} (${pct(toneWithin1, toneBoth)}) |
| Tone: opposite direction | ${toneFlip} of ${toneBoth} |
| Tone: both said "not about rules" | ${toneNullAgree} |
| Issues the reference found that the model also found | ${shared} of ${refIssues} (${pct(shared, refIssues)}) |
| Issues the model found that the reference also found | ${shared} of ${modelIssues} (${pct(shared, modelIssues)}) |
| Shared issues: exact | ${issExact} of ${shared} (${pct(issExact, shared)}) |
| Shared issues: within 1 | ${issWithin1} of ${shared} (${pct(issWithin1, shared)}) |
| Shared issues: opposite direction | ${issFlip} of ${shared} |

## Opposite-direction cases

${misses.length ? misses.map((s) => `- ${s}`).join("\n") : "None."}
`;
writeFileSync(new URL(`report-${VERSION}.md`, dir), report);
console.log(report);
await pool.end();
