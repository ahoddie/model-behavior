// Archive every source URL used by money hops / hop lines / ads on the Wayback Machine (same method and `archives` table as scripts/archive.ts),
// then copy archive links onto money_hops, money_x_hop_txns, money_x_fec_tx and money_x_ads. Resumable; failures keep archive_url null for a later retry.
//   tsx archive-hops.ts [--limit N]
import "../../env.ts";
import { pool, q } from "../../../src/lib/db.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const li = process.argv.indexOf("--limit");
const limit = li > 0 ? Number(process.argv[li + 1]) : 100000;
const urls = (await q<{ url: string }>(`SELECT DISTINCT url FROM (SELECT source_url::text url FROM money_hops UNION SELECT source_url::text FROM money_x_hop_txns UNION SELECT source_url::text FROM money_x_ads) u
  WHERE url NOT IN (SELECT url FROM archives WHERE archive_url IS NOT NULL) LIMIT $1`, [limit])).map((r) => r.url);
console.log(`${urls.length} urls`);
async function available(url: string) {
  try { const j: any = await (await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(30000) })).json();
    const s = j?.archived_snapshots?.closest; return s?.available && s.url ? String(s.url).replace(/^http:/, "https:") : null; } catch { return null; }
}
async function save(url: string) {
  try {
    const r = await fetch(`https://web.archive.org/save/${url}`, { redirect: "manual", signal: AbortSignal.timeout(120000), headers: { "User-Agent": "ModelBehavior-local-archiver/0.1" } });
    const loc = r.headers.get("location") ?? r.headers.get("content-location");
    if (loc && /\/web\/\d{14}/.test(loc)) return { archive: new URL(loc, "https://web.archive.org").toString(), status: r.status };
    if (r.ok) { const m = (await r.text()).match(/\/web\/(\d{14})\/[^"'\s<]+/); if (m) return { archive: `https://web.archive.org${m[0]}`, status: r.status }; }
    return { archive: null, status: r.status };
  } catch { return { archive: null, status: 0 }; }
}
let found = 0, saved = 0, failed = 0;
for (const [i, url] of urls.entries()) {
  let archive = await available(url), status = 200;
  if (archive) found++;
  else { const s = await save(url); archive = s.archive; status = s.status; if (archive) saved++; else failed++; await sleep(s.status === 429 ? 60000 : 6000); }
  await pool.query(`INSERT INTO archives (url, archive_url, http_status, error, checked_at) VALUES ($1,$2,$3,NULL,now())
    ON CONFLICT (url) DO UPDATE SET archive_url=COALESCE($2, archives.archive_url), http_status=$3, checked_at=now()`, [url, archive, status]);
  if (i % 10 === 0) console.log(`${i}/${urls.length} found=${found} saved=${saved} failed=${failed}`);
}
for (const [t, col] of [["money_hops", "source_url"], ["money_x_hop_txns", "source_url"], ["money_x_fec_tx", "source_url"], ["money_x_ads", "source_url"]] as const)
  await pool.query(`UPDATE ${t} x SET archive_url=a.archive_url FROM archives a WHERE a.url=x.${col}::text AND a.archive_url IS NOT NULL AND x.archive_url IS DISTINCT FROM a.archive_url`);
console.log({ found, saved, failed });
await pool.end();
