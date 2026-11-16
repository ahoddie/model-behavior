// provenance:archive — Wayback copy for the page each prov_texts row came from (and the same link onto prov_matches).
// Availability API first; Save Page Now only if there is no snapshot. Slow on purpose (about 6 captures a minute); failures are retried on the next run.
// Usage: tsx scripts/pipelines/provenance/archive.ts [--limit N] [--no-save] [--matched-first]
import { q, pool, sleep } from "./lib.ts";

const args = process.argv.slice(2);
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 1000;
const noSave = args.includes("--no-save");
const UA = "ModelBehavior-local-archiver/0.1";

async function available(url: string): Promise<string | null> {
  try {
    const r = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const s = (await r.json())?.archived_snapshots?.closest;
    return s?.available && s.url ? String(s.url).replace(/^http:/, "https:") : null;
  } catch { return null; }
}
async function save(url: string): Promise<{ archive: string | null; status: number }> {
  try {
    const r = await fetch(`https://web.archive.org/save/${url}`, { redirect: "manual", signal: AbortSignal.timeout(120000), headers: { "User-Agent": UA } });
    const loc = r.headers.get("location") ?? r.headers.get("content-location");
    if (loc && /\/web\/\d{14}/.test(loc)) return { archive: new URL(loc, "https://web.archive.org").toString(), status: r.status };
    if (r.ok) { const m = (await r.text()).match(/\/web\/(\d{14})\/[^"'\s<]+/); if (m) return { archive: `https://web.archive.org${m[0]}`, status: r.status }; }
    return { archive: null, status: r.status };
  } catch { return { archive: null, status: 0 }; }
}

const rows = await q<{ url: string }>(`
  SELECT url FROM (
    SELECT t.url, min(CASE WHEN m.id IS NULL THEN 1 ELSE 0 END) AS rank FROM prov_texts t
    LEFT JOIN prov_matches m ON m.source_url = t.url OR m.bill_url = t.url
    WHERE t.archive_url IS NULL GROUP BY t.url) x ORDER BY rank, url LIMIT $1`, [limit]);
console.log(`${rows.length} urls to archive`);
let found = 0, saved = 0, failed = 0;
for (const { url } of rows) {
  let a = await available(url);
  if (a) found++;
  else if (!noSave) {
    const s = await save(url); a = s.archive;
    if (a) saved++; else failed++;
    await sleep(s.status === 429 ? 60000 : 10000);
  } else failed++;
  if (a) {
    await pool.query(`UPDATE prov_texts SET archive_url=$2 WHERE url=$1`, [url, a]);
    await pool.query(`UPDATE prov_matches SET source_archive_url=$2 WHERE source_url=$1 AND source_archive_url IS NULL`, [url, a]);
    await pool.query(`UPDATE prov_matches SET bill_archive_url=$2 WHERE bill_url=$1 AND bill_archive_url IS NULL`, [url, a]);
  }
}
console.log({ found, saved, failed });
await pool.end();
