// §0.7: archive every source URL on the Wayback Machine and store the archive link on each row.
// Uses the availability API first; if there is no snapshot, asks Save Page Now for one.
// Resumable: URLs already in the archives table with an archive_url are skipped.
// Usage: tsx scripts/archive.ts [--no-save] [--limit N]
import "./env.ts";
import { pool, q } from "../src/lib/db.ts";
import { sleep, setActor, notifySite } from "./lib/ingest.ts";

const noSave = process.argv.includes("--no-save");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : 100000;
await setActor("archiver");

const urls = (await q<{ url: string }>(`
  SELECT DISTINCT url FROM (
    SELECT source_url AS url FROM nodes UNION SELECT source_url FROM links UNION SELECT url FROM feed_items
    UNION SELECT url FROM filings UNION SELECT url FROM facts UNION SELECT url FROM corrections) u
  WHERE url NOT IN (SELECT url FROM archives WHERE archive_url IS NOT NULL) LIMIT $1`, [limit])).map((r) => r.url);
console.log(`${urls.length} urls to archive`);

async function available(url: string): Promise<string | null> {
  try {
    const r = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    const j = await r.json();
    const s = j?.archived_snapshots?.closest;
    return s?.available && s.url ? String(s.url).replace(/^http:/, "https:") : null;
  } catch { return null; }
}
async function save(url: string): Promise<{ archive: string | null; status: number; error?: string }> {
  try {
    const r = await fetch(`https://web.archive.org/save/${url}`, { redirect: "manual", signal: AbortSignal.timeout(120000), headers: { "User-Agent": "ModelBehavior-local-archiver/0.1" } });
    const loc = r.headers.get("location") ?? r.headers.get("content-location");
    if (loc && /\/web\/\d{14}/.test(loc)) return { archive: new URL(loc, "https://web.archive.org").toString(), status: r.status };
    if (r.ok) {
      const t = await r.text();
      const m = t.match(/\/web\/(\d{14})\/[^"'\s<]+/);
      if (m) return { archive: `https://web.archive.org${m[0]}`, status: r.status };
    }
    return { archive: null, status: r.status };
  } catch (e) { return { archive: null, status: 0, error: (e as Error).message }; }
}

let found = 0, saved = 0, failed = 0;
for (const [i, url] of urls.entries()) {
  let archive = await available(url);
  let status = 200, error: string | undefined;
  if (archive) found++;
  else if (!noSave) {
    const s = await save(url); archive = s.archive; status = s.status; error = s.error;
    if (archive) saved++; else failed++;
    await sleep(s.status === 429 ? 60000 : 6000); // Save Page Now allows a handful of captures per minute.
  } else failed++;
  await pool.query(`INSERT INTO archives (url, archive_url, http_status, error, checked_at) VALUES ($1,$2,$3,$4,now())
    ON CONFLICT (url) DO UPDATE SET archive_url=COALESCE($2, archives.archive_url), http_status=$3, error=$4, checked_at=now()`, [url, archive, status, error ?? null]);
  if (i % 25 === 0) console.log(`${i}/${urls.length} found=${found} saved=${saved} failed=${failed}`);
}

// Propagate archive links onto every row.
for (const [t, col] of [["nodes", "source_url"], ["links", "source_url"], ["feed_items", "url"], ["filings", "url"], ["facts", "url"]] as const)
  await pool.query(`UPDATE ${t} x SET archive_url=a.archive_url FROM archives a WHERE a.url=x.${col} AND a.archive_url IS NOT NULL AND x.archive_url IS DISTINCT FROM a.archive_url`);
console.log({ found, saved, failed });
await notifySite();
await pool.end();
