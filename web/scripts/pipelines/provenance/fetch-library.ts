// provenance:library — build the library of earlier texts that bill wording might have come from.
//  1. Approved feed_items (Workstream A's output) of kind docket comment, op-ed, testimony, blog post, position and policy change: the page or PDF is
//     fetched in full. The author is the feed item's own node id.
//  2. A short curated list of primary documents (executive orders, frameworks, company safety policies, earlier state bills), each with a source URL.
//     Authors go through resolve(); an unknown author is never inserted into nodes, it is sent to the review queue.
// Usage: tsx scripts/pipelines/provenance/fetch-library.ts [--feed] [--curated] [--limit N]
import { q, getBytes, toText, saveText, logGap, sleep, pool, decodeEntities } from "./lib.ts";
import { resolve } from "../../lib/resolve.ts";
import { enqueue } from "../../lib/review.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const doFeed = args.includes("--feed") || !args.includes("--curated");
const doCurated = args.includes("--curated") || !args.includes("--feed");
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 100000;
const KIND: Record<string, string> = { "docket comment": "comment_letter", "op-ed": "op_ed", testimony: "testimony", "blog post": "statement", position: "statement", "policy change": "statement" };
const SKIP_HOSTS = /(^|\.)(nytimes|wsj|cnbc|wired|semafor|thehill|podscripts|techpolicy|prnewswire|govtech|youtube|x|twitter|bsky|linkedin)\./;

const titleOf = (html: string) => decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim());
let stored = 0, failed = 0;

if (doFeed) {
  const rows = await q<{ url: string; node_id: string; date: string; kind: string; summary: string | null }>(`
    SELECT DISTINCT ON (url) url, node_id, date::text, kind, left(coalesce(summary, excerpt, ''), 160) AS summary
    FROM feed_items WHERE status='approved' AND kind = ANY($1) ORDER BY url, date ASC LIMIT $2`, [Object.keys(KIND), limit]);
  console.log(`${rows.length} feed urls`);
  for (const r of rows) {
    const host = new URL(r.url).host;
    if (SKIP_HOSTS.test(host)) { failed++; continue; }
    const have = await q(`SELECT 1 FROM prov_texts WHERE fetch_url=$1`, [r.url]);
    if (have.length) continue;
    const f = await getBytes(r.url);
    if (!f) { failed++; console.log(`  miss ${r.url}`); await sleep(500); continue; }
    const isPdf = /pdf/i.test(f.contentType) || f.buf.subarray(0, 4).toString() === "%PDF";
    const text = toText(f);
    const title = (isPdf ? "" : titleOf(f.buf.toString("utf8"))) || r.summary || new URL(r.url).pathname.split("/").pop() || host;
    const id = await saveText({ sourceKind: KIND[r.kind], title: title.slice(0, 200), authorId: r.node_id, date: r.date, url: r.url, fetchUrl: r.url, text, note: `from feed_items (${r.kind})` });
    if (id) { stored++; console.log(`  + ${r.node_id} ${r.date} ${text.split(/\s+/).length}w ${r.url}`); } else { failed++; console.log(`  short ${r.url}`); }
    await sleep(800);
  }
}

// ---- curated primary documents ----------------------------------------------------------------------------------------
type Cur = { url: string; fetch?: string; title: string; kind: string; author: { type: any; name: string } | null; date: string; note?: string };
const CURATED: Cur[] = JSON.parse(readFileSync(join(dirname(new URL(import.meta.url).pathname), "curated.json"), "utf8"));
if (doCurated) {
  for (const c of CURATED) {
    const fetchUrl = c.fetch ?? c.url;
    const have = await q(`SELECT 1 FROM prov_texts WHERE fetch_url=$1`, [fetchUrl]);
    if (have.length) continue;
    const f = await getBytes(fetchUrl);
    if (!f) { failed++; await logGap(`- [provenance] library: could not fetch ${fetchUrl} (${c.title}); not loaded.`); continue; }
    const text = toText(f);
    let authorId: string | null = null;
    if (c.author) {
      const r = await resolve({ type: c.author.type, name: c.author.name });
      if (r.exists && !r.provisional) authorId = r.id;
      else {
        await enqueue({ workstream: "provenance", kind: "new_source_author", refTable: "prov_texts", refId: fetchUrl, title: `New author for a source text: ${c.author.name}`,
          payload: { rationale: `resolve() found no confident existing node for "${c.author.name}" (matchedBy ${r.matchedBy}). Source text stored with no author id until a reviewer adds or maps the node.`, proposed_id: r.id, type: c.author.type },
          evidence: [{ label: c.title, url: c.url, date: c.date }], confidence: r.confidence });
      }
    }
    const id = await saveText({ sourceKind: c.kind, title: c.title, authorId, authorName: c.author?.name ?? null, date: c.date, url: c.url, fetchUrl, text, note: c.note ?? "curated" });
    if (id) { stored++; console.log(`  + curated ${c.date} ${text.split(/\s+/).length}w ${c.title}`); } else { failed++; console.log(`  short/none ${c.url}`); }
    await sleep(800);
  }
}
console.log({ stored, failed });
await pool.end();
