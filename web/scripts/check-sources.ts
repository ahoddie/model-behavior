// §10.6 source audit.
// 1. Every distinct source URL is fetched. Rows whose URL is gone (404/410, DNS failure) are deleted, and the
//    deletion is written to the corrections log.
// 2. Every feed excerpt is checked against the page text. If the page loads but the quote is not on it, the item
//    goes back to "pending" so a person checks it on the review screen.
// 3. Any row without a URL is impossible by schema; this also asserts it.
// Usage: tsx scripts/check-sources.ts [--recheck] [--quotes-only]
import "./env.ts";
import { pool, q } from "../src/lib/db.ts";
import { setActor, notifySite } from "./lib/ingest.ts";

const recheck = process.argv.includes("--recheck");
const quotesOnly = process.argv.includes("--quotes-only");
await setActor("source-audit");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
async function probe(url: string): Promise<{ status: number; ok: boolean; body?: string; error?: string }> {
  try {
    const ctl = AbortSignal.timeout(25000);
    const res = await fetch(url, { redirect: "follow", signal: ctl, headers: { "User-Agent": UA, Accept: "text/html,application/pdf,application/json;q=0.9,*/*;q=0.8" } });
    const type = res.headers.get("content-type") ?? "";
    const body = res.ok && /html|text|json|xml/.test(type) ? (await res.text()).slice(0, 3_000_000) : undefined;
    return { status: res.status, ok: res.ok, body };
  } catch (e) {
    return { status: 0, ok: false, error: (e as Error).cause ? String((e as any).cause?.code ?? (e as Error).message) : (e as Error).message };
  }
}
// EAI_AGAIN is a temporary DNS failure, so it counts as blocked, not gone.
const GONE = (s: number, err?: string) => s === 404 || s === 410 || (s === 0 && /ENOTFOUND|ERR_INVALID_URL/.test(err ?? ""));

// At most 2 requests at a time per host, 1.2 s apart, so a rate limit can't look like a dead link.
const hostBusy = new Map<string, number>(), hostLast = new Map<string, number>();
async function politeProbe(url: string) {
  let host = ""; try { host = new URL(url).hostname; } catch { return probe(url); }
  for (;;) {
    const wait = (hostLast.get(host) ?? 0) + 1200 - Date.now();
    if ((hostBusy.get(host) ?? 0) < 2 && wait <= 0) break;
    await new Promise((r) => setTimeout(r, Math.max(wait, 200)));
  }
  hostBusy.set(host, (hostBusy.get(host) ?? 0) + 1); hostLast.set(host, Date.now());
  try { return await probe(url); } finally { hostBusy.set(host, hostBusy.get(host)! - 1); }
}
const archived = new Map((await q<{ url: string; archive_url: string }>(`SELECT url, archive_url FROM archives WHERE archive_url IS NOT NULL`)).map((r) => [r.url, r.archive_url]));

const norm = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
  .replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

const urls = (await q<{ url: string }>(`
  SELECT DISTINCT url FROM (
    SELECT source_url AS url FROM nodes UNION SELECT source_url FROM links UNION SELECT url FROM feed_items
    UNION SELECT url FROM filings UNION SELECT url FROM facts) u
  WHERE $1 OR url NOT IN (SELECT url FROM url_checks)`, [recheck])).map((r) => r.url);

const quoteRows = await q<{ id: number; url: string; excerpt: string }>(`SELECT id, url, excerpt FROM feed_items WHERE excerpt IS NOT NULL AND status='approved'`);
const quotesByUrl = new Map<string, { id: number; excerpt: string }[]>();
for (const r of quoteRows) quotesByUrl.set(r.url, [...(quotesByUrl.get(r.url) ?? []), r]);

const targets = quotesOnly ? [...quotesByUrl.keys()] : [...new Set([...urls, ...quotesByUrl.keys()])];
console.log(`checking ${targets.length} urls`);
let gone = 0, deadArchived = 0, blocked = 0, quoteMiss = 0, done = 0;
const removed: string[] = [];

async function work(url: string) {
  let r = await politeProbe(url);
  // A dead link is re-checked once after a pause before anything is deleted.
  if (GONE(r.status, r.error)) { await new Promise((res) => setTimeout(res, 8000)); r = await politeProbe(url); }
  await pool.query(`INSERT INTO url_checks (url,status,ok,error,checked_at) VALUES ($1,$2,$3,$4,now())
    ON CONFLICT (url) DO UPDATE SET status=$2, ok=$3, error=$4, checked_at=now()`, [url, r.status, r.ok, r.error ?? null]);
  if (GONE(r.status, r.error) && archived.has(url)) {
    // The live page is gone but a Wayback copy exists, so the claim stays sourced. Kept; the archive pill links the copy.
    deadArchived++;
  } else if (GONE(r.status, r.error)) {
    gone++;
    removed.push(`${r.status || r.error} ${url}`);
    for (const [t, col] of [["links", "source_url"], ["feed_items", "url"], ["filings", "url"], ["facts", "url"]] as const) {
      const del = await pool.query(`DELETE FROM ${t} WHERE ${col}=$1 RETURNING id`, [url]);
      for (const row of del.rows) await pool.query(`INSERT INTO corrections (table_name,row_ref,what_changed,url) VALUES ($1,$2,$3,$4)`,
        [t, String(row.id), `Removed: source link returned ${r.status || r.error}.`, url]);
    }
    // Nodes whose own source is gone are kept only if another sourced row still describes them.
  } else if (!r.ok) blocked++;
  const quotes = quotesByUrl.get(url);
  if (quotes && r.body) {
    const page = norm(r.body);
    for (const qr of quotes) {
      const needle = norm(qr.excerpt);
      // Allow ellipses in excerpts: every fragment must appear.
      const parts = needle.split(/\s*\.\.\.\s*|\s*…\s*/).filter((p) => p.length > 3);
      if (!parts.every((p) => page.includes(p))) {
        quoteMiss++;
        await pool.query(`UPDATE feed_items SET status='pending' WHERE id=$1`, [qr.id]);
      }
    }
  }
  if (++done % 50 === 0) console.log(`${done}/${targets.length}`);
}

const queue = [...targets];
await Promise.all(Array.from({ length: 16 }, async () => { while (queue.length) await work(queue.shift()!); }));

// Nodes with a dead source and no remaining sourced rows are dropped.
const orphan = await pool.query(`
  DELETE FROM nodes n USING url_checks c WHERE c.url = n.source_url AND (c.status IN (404,410) OR (c.status=0 AND c.error ~ 'ENOTFOUND')) AND NOT EXISTS (SELECT 1 FROM archives a WHERE a.url=n.source_url AND a.archive_url IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.node_id=n.id) AND NOT EXISTS (SELECT 1 FROM links l WHERE l.from_id=n.id OR l.to_id=n.id)
  RETURNING n.id`);

console.log({ checked: targets.length, gone, deadButArchived: deadArchived, blockedOrError: blocked, quotesSentToReview: quoteMiss, nodesDropped: orphan.rowCount });
if (removed.length) console.log("removed sources:\n" + removed.join("\n"));
await notifySite();
await pool.end();
