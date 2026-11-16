// Archives only the URLs the thin-profile enrichers wrote (data/cache/thin/urls.txt) on the Wayback Machine, then
// copies archive links onto those rows. Same method and pace as scripts/archive.ts. Resumable.
// Usage: tsx scripts/thin/archive.ts [--limit N]
import { readFileSync, existsSync } from "node:fs";
import { begin, URLS, q, pool, sleep } from "./lib.ts";

await begin();
const lim = process.argv.includes("--limit") ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : 1e9;
const all = [...new Set((existsSync(URLS) ? readFileSync(URLS, "utf8") : "").split("\n").filter(Boolean))];
const done = new Set((await q<{ url: string }>(`SELECT url FROM archives WHERE archive_url IS NOT NULL`)).map((r) => r.url));
const todo = all.filter((u) => !done.has(u)).slice(0, lim);
console.log(`${all.length} urls, ${todo.length} to archive`);
const UA = { "User-Agent": "ModelBehavior-local-archiver/0.1" };
async function available(url: string) {
  try { const j = await (await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(30000), headers: UA })).json(); const s = j?.archived_snapshots?.closest; return s?.available ? String(s.url).replace(/^http:/, "https:") : null; } catch { return null; }
}
async function save(url: string) {
  try {
    const r = await fetch(`https://web.archive.org/save/${url}`, { redirect: "manual", signal: AbortSignal.timeout(120000), headers: UA });
    const loc = r.headers.get("location") ?? r.headers.get("content-location");
    if (loc && /\/web\/\d{14}/.test(loc)) return { a: new URL(loc, "https://web.archive.org").toString(), s: r.status };
    return { a: null, s: r.status };
  } catch { return { a: null, s: 0 }; }
}
let ok = 0;
for (const [i, u] of todo.entries()) {
  let a = await available(u), s = 200;
  if (!a) { const r = await save(u); a = r.a; s = r.s; await sleep(s === 429 ? 60000 : 6000); }
  if (a) ok++;
  await pool.query(`INSERT INTO archives (url, archive_url, http_status, checked_at) VALUES ($1,$2,$3,now()) ON CONFLICT (url) DO UPDATE SET archive_url=COALESCE($2, archives.archive_url), http_status=$3, checked_at=now()`, [u, a, s]);
  if (i % 25 === 0) console.log(`${i}/${todo.length} archived=${ok}`);
}
for (const [t, col] of [["links", "source_url"], ["filings", "url"], ["facts", "url"]] as const)
  await pool.query(`UPDATE ${t} x SET archive_url=a.archive_url FROM archives a WHERE a.url=x.${col} AND a.archive_url IS NOT NULL AND x.archive_url IS NULL AND x.${col} = ANY($1)`, [all]);
console.log(`archived ${ok}/${todo.length}`);
await pool.end();
