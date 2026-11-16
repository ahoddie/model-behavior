// Hand-checked facts for thin profiles. Reads a JSON array of { node, text, url, label?, archive? } and inserts them.
// Insert-only: a (node, text) pair that already exists is skipped, never updated. A row without an archive URL is not stored:
// the archive comes from the row itself, the archives table, an existing Wayback snapshot, or a fresh Save Page Now (6 s apart, 60 s after a 429).
// Usage: tsx scripts/thin/add-facts.ts <file.json> [--dry]
import { readFileSync, appendFileSync } from "node:fs";
import { begin, q, pool, sleep, URLS } from "./lib.ts";
import { isUrl, wordCount } from "../lib/ingest.ts";
import { FACT_ORDER } from "../lib/ingest.ts";

const file = process.argv[2]; const dry = process.argv.includes("--dry");
if (!file) throw new Error("usage: add-facts.ts <file.json> [--dry]");
await begin();
const rows: { node: string; text: string; url: string; label?: string; archive?: string }[] = JSON.parse(readFileSync(file, "utf8"));
const UA = { "User-Agent": "ModelBehavior-local-archiver/0.1" };
const snap = /^https:\/\/web\.archive\.org\/web\/\d{14}\/https?:\/\//;
async function available(url: string) {
  try { const j = await (await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(30000), headers: UA })).json(); const s = j?.archived_snapshots?.closest; return s?.available ? String(s.url).replace(/^http:/, "https:") : null; } catch { return null; }
}
async function save(url: string) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(`https://web.archive.org/save/${url}`, { redirect: "manual", signal: AbortSignal.timeout(120000), headers: UA });
      const loc = r.headers.get("location") ?? r.headers.get("content-location");
      if (loc && /\/web\/\d{14}/.test(loc)) return new URL(loc, "https://web.archive.org").toString();
      await sleep(r.status === 429 ? 60000 : 8000);
    } catch { await sleep(8000); }
  }
  return null;
}
// --no-wayback: store without contacting Wayback, using an archive only if one is already on record.
const noWayback = process.argv.includes("--no-wayback");
const memo = new Map<string, string | null>();
async function archiveFor(url: string, given?: string) {
  if (given && snap.test(given)) return given;
  if (memo.has(url)) return memo.get(url) ?? null;
  const hit = (await q<{ archive_url: string }>(`SELECT archive_url FROM archives WHERE url=$1 AND archive_url IS NOT NULL`, [url]))[0]?.archive_url
    ?? (await q<{ archive_url: string }>(`SELECT archive_url FROM facts WHERE url=$1 AND archive_url IS NOT NULL LIMIT 1`, [url]))[0]?.archive_url;
  if (noWayback) { memo.set(url, hit ?? null); return hit ?? null; }
  let a: string | null = hit ?? (await available(url));
  if (!a && !dry) { a = await save(url); await sleep(6000); }
  memo.set(url, a ?? null);
  return a ?? null;
}
let added = 0, dup = 0, noArchive = 0, bad = 0;
for (const r of rows) {
  const text = String(r.text ?? "").trim();
  if (!isUrl(r.url) || !text || (r.label && !FACT_ORDER.includes(r.label)) || (!r.label && wordCount(text) > 60)) { console.log("BAD", r.node, text.slice(0, 60)); bad++; continue; }
  if ((await q(`SELECT 1 FROM nodes WHERE id=$1`, [r.node])).length === 0) { console.log("NO NODE", r.node); bad++; continue; }
  if ((await q(`SELECT 1 FROM facts WHERE node_id=$1 AND text=$2`, [r.node, text])).length) { dup++; continue; }
  const a = await archiveFor(r.url, r.archive);
  if (!a && !noWayback) { console.log("NO ARCHIVE", r.url); noArchive++; continue; }
  if (dry) { console.log("DRY", r.node, r.label ?? "-", text.slice(0, 90), "|", a); continue; }
  const res = await pool.query(
    `INSERT INTO facts (node_id,text,url,archive_url,label,sort) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (node_id,text) DO NOTHING`,
    [r.node, text, r.url.trim(), a, r.label ?? null, r.label ? FACT_ORDER.indexOf(r.label) + 1 || 99 : null]);
  if (res.rowCount) { added++; appendFileSync(URLS, r.url + "\n"); }
}
console.log(`added ${added}, duplicate ${dup}, no archive ${noArchive}, bad ${bad}`);
await pool.end();
