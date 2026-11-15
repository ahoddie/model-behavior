// Type 3: a public commitment later removed or weakened. Uses only snapshots that already exist in the Wayback Machine
// (CDX index); never creates one. For each watched page, consecutive snapshots with different content are compared sentence by
// sentence in code; sentences that read like commitments and have no close match later go to the model (two prompts must agree).
// The flag's evidence is the two snapshot URLs. Quotes are shown only if 25 words or fewer and an exact substring.
// Usage: pnpm say-do:commitments [--dry] [--page <url-substring>] [--max-snapshots N]
import "../../env.ts";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, q } from "../../../src/lib/db.ts";
import { htmlToText } from "../../lib/text.ts";
import { detectServer } from "../../lib/llm.ts";
import { judgeCommitment } from "./judge.ts";
import { assertNeutral, describeType3, quoteOk, severityFor, norm } from "./core.ts";
import { store } from "./store.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, "../../../../data/cache/say_do/snap");
mkdirSync(CACHE, { recursive: true });
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const UA = { "User-Agent": "ModelBehavior-local-research/0.1 (read-only; existing snapshots only)" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_SNAP = Number(arg("--max-snapshots") ?? 12);

export const COMMIT_WORDS = /\b(will not|won't|will never|never|we will|we commit|committed to|pledge|prohibit|do not|does not|must not|shall not|not (?:use|develop|deploy|pursue|build|design))\b/i;
export const sentences = (t: string) => t.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"“])/).map((s) => s.trim()).filter((s) => s.split(" ").length >= 6 && s.split(" ").length <= 80);
const toks = (s: string) => new Set(norm(s).replace(/[^a-z0-9 ]/g, " ").split(" ").filter((w) => w.length > 2));
export function jaccard(a: string, b: string) { const A = toks(a), B = toks(b); let i = 0; for (const x of A) if (B.has(x)) i++; return A.size + B.size - i ? i / (A.size + B.size - i) : 0; }
export function bestMatch(s: string, after: string[]) { let best = { s: "", j: 0 }; for (const a of after) { const j = jaccard(s, a); if (j > best.j) best = { s: a, j }; } return best; }

async function cdx(url: string): Promise<{ ts: string; digest: string }[]> {
  const r = await fetch(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&fl=timestamp,digest,statuscode&filter=statuscode:200&collapse=digest&limit=300`, { headers: UA, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`CDX ${r.status}`);
  const rows: string[][] = await r.json();
  return rows.slice(1).map(([ts, digest]) => ({ ts, digest }));
}
async function snapText(ts: string, url: string): Promise<string | null> {
  const f = join(CACHE, `${ts}_${createHash("sha1").update(url).digest("hex").slice(0, 10)}.txt`);
  if (existsSync(f)) return readFileSync(f, "utf8");
  await sleep(1500);
  const r = await fetch(`https://web.archive.org/web/${ts}id_/${url}`, { headers: UA, signal: AbortSignal.timeout(90000) });
  if (!r.ok) return null;
  const t = htmlToText(await r.text());
  writeFileSync(f, t);
  return t;
}
const snapUrl = (ts: string, url: string) => `https://web.archive.org/web/${ts}/${url}`;
const tsDate = (ts: string) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  await detectServer();
  const only = arg("--page");
  const watch = (await q<any>(`SELECT id, node_id, page_url, topic FROM sd_page_watch ORDER BY id`)).filter((w) => !only || w.page_url.includes(only));
  const stats = { pages: watch.length, snapshots: 0, pairs: 0, candidates: 0, flags: 0 };
  for (const w of watch) {
    let snaps: { ts: string; digest: string }[] = [];
    try { snaps = await cdx(w.page_url); } catch (e) { console.log(`skip ${w.page_url}: ${e}`); continue; }
    if (snaps.length > MAX_SNAP) { // keep first, last, and an even spread
      const keep = new Set<number>([0, snaps.length - 1]);
      for (let i = 1; i < MAX_SNAP - 1; i++) keep.add(Math.round((i * (snaps.length - 1)) / (MAX_SNAP - 1)));
      snaps = snaps.filter((_, i) => keep.has(i));
    }
    for (const s of snaps) await pool.query(`INSERT INTO sd_page_snapshots (page_id, ts, snapshot_url, digest) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [w.id, s.ts, snapUrl(s.ts, w.page_url), s.digest]);
    stats.snapshots += snaps.length;
    for (let i = 0; i + 1 < snaps.length; i++) {
      const a = snaps[i], b = snaps[i + 1];
      const ta = await snapText(a.ts, w.page_url), tb = await snapText(b.ts, w.page_url);
      if (!ta || !tb) continue;
      stats.pairs++;
      const sa = sentences(ta), sb = sentences(tb);
      for (const s of sa) {
        if (!COMMIT_WORDS.test(s) || s.split(" ").length > 25) continue;       // only quotable commitment-like sentences
        const m = bestMatch(s, sb);
        if (m.j >= 0.85) continue;                                             // still there (near-identical)
        if (!quoteOk(s, ta)) continue;
        stats.candidates++;
        const near = m.j >= 0.35 ? m.s : "";
        const r = await judgeCommitment(w.topic, s, near || sb.filter((x) => jaccard(s, x) > 0.2).slice(0, 3).join(" "));
        console.log(`${r.flag ? "FLAG" : "no  "}\t${r.q1.answer}/${r.q2.answer}\t${s.slice(0, 100)}`);
        if (!r.flag) continue;
        const afterQuote = r.kind === "weakened" && near && near.split(" ").length <= 25 && quoteOk(near, tb) ? near : null;
        const description = assertNeutral(describeType3(w.topic, { date: tsDate(a.ts), quote: s }, { date: tsDate(b.ts), quote: afterQuote }));
        const res = await store({ type: "commitment_weakened", key: `t3:${w.id}:${a.ts}:${b.ts}:${createHash("sha1").update(s).digest("hex").slice(0, 10)}`, node_id: w.node_id, target_id: null,
          severity: severityFor("commitment_weakened"), confidence: 0.7, description,
          rationale: `First reading: ${r.q1.reason} Second reading: ${r.q2.reason} Closest later text (similarity ${m.j.toFixed(2)}): ${near || "none"}`,
          said: [{ label: s, url: snapUrl(a.ts, w.page_url), archive_url: snapUrl(a.ts, w.page_url), date: tsDate(a.ts) }],
          did: [{ label: afterQuote ?? "Not present in the later version", url: snapUrl(b.ts, w.page_url), archive_url: snapUrl(b.ts, w.page_url), date: tsDate(b.ts) }], meta: { page: w.page_url, q1: r.q1.meta, q2: r.q2.meta } });
        if (res === "new") stats.flags++;
      }
    }
  }
  console.log(stats);
  await pool.end();
}
