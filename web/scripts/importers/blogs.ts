// Company blogs and newsrooms (data/sources/feeds.json): RSS feeds, plus index pages for sites without RSS.
// Only posts that touch AI policy are kept; statements are attributed to the publishing company's node.
import { REPO } from "../env.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Parser from "rss-parser";
import { q } from "../../src/lib/db.ts";
import { nodeExists, startRun, endRun, politeFetch, sleep } from "../lib/ingest.ts";
import { fetchText, ingestDocument, POLICY_TERMS } from "../lib/text.ts";

const cfg = JSON.parse(readFileSync(join(REPO, "data/sources/feeds.json"), "utf8"));
const parser = new Parser();
const sinceDays = Number(process.argv.find((a) => a.startsWith("--days="))?.slice(7) ?? 14);
const cutoff = Date.now() - sinceDays * 864e5;

export async function run() {
  const runId = await startRun("blogs");
  let added = 0;
  try {
    const known = new Set((await q<{ url: string }>(`SELECT url FROM feed_items WHERE origin='importer:blogs'`)).map((r) => r.url));
    const posts: { node: string; url: string; date: string }[] = [];
    for (const f of cfg.rss) {
      if (!(await nodeExists(f.node))) continue;
      const feed = await parser.parseURL(f.url).catch((e) => { console.warn(`rss ${f.url}: ${e.message}`); return null; });
      for (const i of feed?.items ?? []) {
        const d = new Date(i.isoDate ?? i.pubDate ?? 0);
        if (i.link && d.getTime() > cutoff) posts.push({ node: f.node, url: i.link, date: d.toISOString().slice(0, 10) });
      }
    }
    for (const f of cfg.index) {
      if (!(await nodeExists(f.node))) continue;
      const res = await politeFetch(f.url);
      if (!res.ok) continue;
      const html = await res.text();
      const re = new RegExp(f.pattern);
      const links = [...new Set([...html.matchAll(/href="([^"#?]+)"/g)].map((m) => m[1]).filter((h) => re.test(h)))].slice(0, 25);
      for (const l of links) posts.push({ node: f.node, url: new URL(l, f.url).toString(), date: "" });
    }
    for (const p of posts) {
      if (known.has(p.url)) continue;
      const page = await fetchText(p.url);
      if (!page || !POLICY_TERMS.test(page.text)) continue;
      // Index pages have no date: take the first date printed on the post.
      const date = p.date || (page.text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, 20\d\d\b/)?.[0] ?? "");
      const iso = date.length === 10 ? date : date ? new Date(date).toISOString().slice(0, 10) : null;
      if (!iso || new Date(iso).getTime() < cutoff) continue;
      added += await ingestDocument({ text: page.text, url: p.url, date: iso, platform: new URL(p.url).hostname.replace(/^www\./, ""), kind: "blog post", only: [p.node], origin: "importer:blogs" });
      await sleep(800);
    }
    await endRun(runId, true, added);
  } catch (e) { await endRun(runId, false, added, String(e)); throw e; }
  return added;
}
if (import.meta.url === `file://${process.argv[1]}`) { console.log("blogs added", await run()); process.exit(0); }
