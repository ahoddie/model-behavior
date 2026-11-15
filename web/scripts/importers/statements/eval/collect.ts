// Collect-only run: pulls real documents from each source and writes the raw units to data/raw/statements-eval/units.jsonl (gitignored)
// WITHOUT calling the model and without touching cursors, seen-ids or feed items. The gold set is then sampled from these units.
// Usage: tsx scripts/importers/statements/eval/collect.ts [--per-source 120]
import "../../../env.ts";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../../env.ts";
import { pool } from "../../../../src/lib/db.ts";
import { hooks, mode } from "../cursors.ts";
import { buildUnits, newsCandidates, type Doc } from "../pipeline.ts";
import { passesPrefilter, sha1, words } from "../textutil.ts";
import { pollBluesky } from "../sources/bluesky.ts";
import { pollBlogs, pollNewsrooms } from "../sources/feeds.ts";
import { pollTestimony } from "../sources/testimony.ts";
import { pollTranscripts } from "../sources/transcripts.ts";
import { pollNews } from "../sources/news.ts";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const CAP = Number(arg("--per-source") ?? 150);
const only = arg("--sources")?.split(",");
const dir = join(REPO, "data/raw/statements-eval");
mkdirSync(dir, { recursive: true });
const out = join(dir, "units.jsonl");
mode.dry = true;
const counts: Record<string, number> = {};
class Stop extends Error {}
let current = "";

// Units are built WITHOUT the model (articles get candidate quote windows; the speaker question is part of what is evaluated).
hooks.onDoc = (doc: Doc) => {
  const people = doc.people ?? [];
  const unitsP = (async () => {
    const recs: any[] = [];
    if (doc.author || doc.turns) {
      for (const u of await buildUnits(doc)) recs.push({ person: u.person, attribution: u.attribution, text: u.text });
      // a sample of text the prefilter would drop, so the prefilter's recall can be measured against the gold labels
      if (doc.author) {
        const paras = (words(doc.text) > 220 ? doc.text.split(/\n+/) : [doc.text]).map((x) => x.trim()).filter((x) => words(x) >= 8 && x.length < 1100 && !passesPrefilter(x));
        const pick = paras[parseInt(sha1(doc.url).slice(0, 6), 16) % Math.max(1, paras.length)];
        if (pick && parseInt(sha1(doc.url).slice(6, 8), 16) % 4 === 0) recs.push({ person: doc.author, attribution: "direct", text: pick, prefilterFail: true });
      }
    } else {
      // article: a window around every quoted span or attribution verb that names a watchlist person (no model)
      for (const w of newsCandidates(doc.text, people)) recs.push({ person: w.names.length === 1 ? w.names[0] : null, names: w.names.map((n) => n.name), attribution: w.attribution, text: w.text, quote: w.quote });
    }
    return recs;
  })();
  pending.push(unitsP.then((recs) => {
    for (const r of recs) {
      if ((counts[current] ?? 0) >= CAP) return;
      counts[current] = (counts[current] ?? 0) + 1;
      appendFileSync(out, JSON.stringify({ id: sha1(`${doc.url}|${r.person?.id ?? r.names?.join(",")}|${r.text.slice(0, 80)}`).slice(0, 12), source: doc.source, platform: doc.platform, kind: doc.kind, url: doc.url, date: doc.date,
        person_id: r.person?.id ?? null, person: r.person?.name ?? null, attribution_hint: r.attribution, names: r.names, quote_span: r.quote, pf_fail: r.prefilterFail ?? false, text: r.text }) + "\n");
    }
  }));
  if ((counts[current] ?? 0) >= CAP) throw new Stop();
  return true;
};
const pending: Promise<unknown>[] = [];
async function stage(name: string, fn: () => Promise<unknown>) {
  if (only && !only.includes(name)) return;
  current = name; console.log("collecting", name);
  try { await fn(); } catch (e) { if (!(e instanceof Stop)) console.warn(name, (e as Error).message); }
  await Promise.all(pending); pending.length = 0;
  console.log(name, counts[name] ?? 0);
}
if (!only) writeFileSync(out, "");
await stage("bluesky", () => pollBluesky({ maxPages: 30 }));
await stage("testimony", () => pollTestimony({ maxHearings: 40 }));
await stage("transcript", () => pollTranscripts({}));
await stage("blog", async () => { await pollBlogs({}); });
await stage("newsroom", () => pollNewsrooms({ days: 400 }));
await stage("news", () => pollNews({ backfill: true, budgetMs: 25 * 60000, tierMin: 3 }));
console.log(counts);
await pool.end();
