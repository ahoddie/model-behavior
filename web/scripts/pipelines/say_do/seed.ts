// Loads sourced bill sponsors and version lists from seeds.json into sd_bill_sponsors / sd_bill_versions.
// Archive URLs are looked up from the Wayback availability API (existing snapshots only); null when none, for the archive job to fill.
import "../../env.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, q } from "../../../src/lib/db.ts";

const seeds = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "seeds.json"), "utf8"));
export async function waybackFor(url: string): Promise<string | null> {
  const known = (await q<any>(`SELECT archive_url FROM archives WHERE url=$1 AND archive_url IS NOT NULL`, [url]))[0]?.archive_url;
  if (known) return known;
  try {
    const r = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(30000) });
    const s = (await r.json())?.archived_snapshots?.closest;
    return s?.available && s.url ? String(s.url).replace(/^http:/, "https:") : null;
  } catch { return null; }
}
for (const s of seeds.sponsors) {
  const arch = await waybackFor(s.source_url);
  await pool.query(`INSERT INTO sd_bill_sponsors (target_id, lawmaker_id, role, source_url, archive_url) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (target_id, lawmaker_id, role) DO UPDATE SET source_url=EXCLUDED.source_url, archive_url=coalesce(EXCLUDED.archive_url, sd_bill_sponsors.archive_url)`, [s.target_id, s.lawmaker_id, s.role, s.source_url, arch]);
}
for (const [target, v] of Object.entries<any>(seeds.versions)) {
  const arch = await waybackFor(v.source_url);
  for (const [date, label] of v.list) await pool.query(`INSERT INTO sd_bill_versions (target_id, label, effective_from, substantive_change, note, source_url, archive_url) VALUES ($1,$2,$3,true,$4,$5,$6)
    ON CONFLICT (target_id, effective_from) DO UPDATE SET label=EXCLUDED.label, archive_url=coalesce(EXCLUDED.archive_url, sd_bill_versions.archive_url)`, [target, label, date, seeds.versions_note, v.source_url, arch]);
}
console.log(await q(`SELECT (SELECT count(*) FROM sd_bill_sponsors) sponsors, (SELECT count(*) FROM sd_bill_versions) versions, (SELECT count(*) FROM sd_bill_sponsors WHERE archive_url IS NULL) sponsors_no_archive`));
await pool.end();
