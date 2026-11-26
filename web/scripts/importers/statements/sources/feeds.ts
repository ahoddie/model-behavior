// Personal blogs, Substacks and company newsrooms.
//  - Verified blog/Substack feeds of watchlist people (stmt_handles platform blog_rss | substack): the post is the person's own words (direct).
//    Substack backfill walks the site's public archive API back to 2023-01-01.
//  - Company newsrooms (data/sources/feeds.json): the post is the company's text, so only people the post names are looked at
//    (their quoted words become `quoted`, attributed statements `paraphrased`). Bylined posts by a watchlist person are direct.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Parser from "rss-parser";
import { REPO } from "../../../env.ts";
import { q } from "../../../../src/lib/db.ts";
import { getCursor, setCursor } from "../cursors.ts";
import { politeFetch, sleep } from "../../../lib/ingest.ts";
import { htmlToText } from "../../../lib/text.ts";
import { loadWatchlist, processDoc } from "../pipeline.ts";
import { FLOOR, emptyStats, type Stats } from "./bluesky.ts";
import { allowedByRobots, fetchPage } from "../textutil.ts";

const parser = new Parser({ customFields: { item: [["content:encoded", "contentEncoded"]] } });
const add = (st: Stats, r: { stored: number; duplicates: number; dropped: number }) => { st.docs++; st.stored += r.stored; st.duplicates += r.duplicates; st.dropped += r.dropped; };

export async function pollBlogs(opts: { days?: number } = {}): Promise<Stats> {
  const st = emptyStats();
  const cutoff = opts.days ? new Date(Date.now() - opts.days * 864e5).toISOString().slice(0, 10) : FLOOR;
  const rows = await q<{ id: string; name: string; tier: number; platform: string; handle: string }>(
    `SELECT n.id, n.name, w.influence_tier AS tier, h.platform, h.handle FROM stmt_handles h JOIN stmt_watchlist w ON w.node_id=h.node_id JOIN nodes n ON n.id=h.node_id
     WHERE h.platform IN ('blog_rss','substack') AND h.status='verified'`);
  for (const r of rows) {
    const person = { id: r.id, name: r.name, tier: r.tier };
    const posts: { url: string; date: string; text: string }[] = [];
    if (r.platform === "substack") {
      const base = r.handle.replace(/\/feed$/, "");
      const cur = await getCursor("substack", base);
      // The public archive listing the site itself uses; fetched politely and only when robots.txt allows it.
      if (!cur?.done && (await allowedByRobots(`${base}/api/v1/archive`))) {
        for (let off = 0; off < 600; off += 25) {
          const res = await politeFetch(`${base}/api/v1/archive?sort=new&limit=25&offset=${off}`);
          if (!res.ok) break;
          const list: any[] = await res.json();
          if (!list.length) break;
          for (const p of list) if (p.post_date && p.post_date.slice(0, 10) >= cutoff && p.audience !== "only_paid" && p.canonical_url) posts.push({ url: p.canonical_url, date: p.post_date.slice(0, 10), text: "" });
          if (list.at(-1).post_date.slice(0, 10) < cutoff) break;
          await sleep(500);
        }
        await setCursor("substack", base, null, true);
      }
    }
    const res = await politeFetch(r.handle);
    if (res.ok) {
      const feed = await parser.parseString(await res.text()).catch(() => null);
      for (const i of feed?.items ?? []) {
        const d = (i.isoDate ?? i.pubDate ?? "").slice(0, 10);
        if (i.link && d >= cutoff) posts.push({ url: i.link, date: d, text: htmlToText((i as any).contentEncoded ?? i.content ?? "") });
      }
    }
    for (const p of [...new Map(posts.map((x) => [x.url, x])).values()]) {
      let text = p.text;
      if (words(text) < 150) text = (await fetchPage(p.url))?.text ?? text;       // feeds often carry only a teaser
      if (!text) continue;
      add(st, await processDoc({ source: "blog", platform: new URL(p.url).hostname.replace(/^www\./, ""), kind: "blog post", url: p.url, date: p.date, text, author: person }));
    }
  }
  return st;
}
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export async function pollNewsrooms(opts: { days?: number } = {}): Promise<Stats> {
  const st = emptyStats();
  const cfg = JSON.parse(readFileSync(join(REPO, "data/sources/feeds.json"), "utf8"));
  const people = await loadWatchlist();
  const cutoff = new Date(Date.now() - (opts.days ?? 14) * 864e5).toISOString().slice(0, 10);
  const urls: { url: string; date: string }[] = [];
  for (const f of cfg.rss) {
    const res = await politeFetch(f.url);
    const feed = res.ok ? await parser.parseString(await res.text()).catch(() => null) : null;
    for (const i of feed?.items ?? []) { const d = (i.isoDate ?? i.pubDate ?? "").slice(0, 10); if (i.link && d >= cutoff) urls.push({ url: i.link, date: d }); }
  }
  for (const f of cfg.index) {
    const page = await fetchPage(f.url, { html: true });
    if (!page) continue;
    const re = new RegExp(f.pattern);
    for (const m of [...new Set([...page.html.matchAll(/href="([^"#?]+)"/g)].map((x) => x[1]).filter((h) => re.test(h)))].slice(0, 25)) urls.push({ url: new URL(m, f.url).toString(), date: "" });
  }
  for (const u of urls) {
    const page = await fetchPage(u.url);
    if (!page) continue;
    const date = u.date || (() => { const m = page.text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, 20\d\d\b/)?.[0]; return m ? new Date(m).toISOString().slice(0, 10) : ""; })();
    if (!date || date < cutoff) continue;
    add(st, await processDoc({ source: "blog", platform: new URL(u.url).hostname.replace(/^www\./, ""), kind: "quote", url: u.url, date, text: page.text, people }));
    await sleep(600);
  }
  return st;
}
