// News quotes and op-eds: Google News RSS (all dates, `after:`/`before:` windows) and GDELT DOC 2.0 (about the last three months).
//  - Google News links are redirect tokens. They are resolved to the publisher's own URL the way a browser does (old tokens embed the URL;
//    newer ones need one lookup against news.google.com), at most one every 2 seconds. Rows always store the PUBLISHER URL, never the Google link.
//  - Publisher pages are fetched only if robots.txt allows. Paywalled or empty pages are skipped.
//  - A page whose byline (meta author) is a watchlist person is an op-ed in that person's own words (direct); anything else is read for
//    quotes and attributed statements by the people it names.
//  - Backfill is windowed and resumable: tier 3 people by month, tier 2 by quarter, tier 1 by half-year, from 2023-01-01.
import { pool, q } from "../../../../src/lib/db.ts";
import { mode, setCursor } from "../cursors.ts";
import { politeFetch, sleep } from "../../../lib/ingest.ts";
import Parser from "rss-parser";
import { loadWatchlist, nameRe, processDoc, type Doc, type Person } from "../pipeline.ts";
import { FLOOR, emptyStats, type Stats } from "./bluesky.ts";
import { fetchPage, sha1 } from "../textutil.ts";

const parser = new Parser();
type Hit = { link: string; date: string; title: string };
const TOPIC = `(AI OR "artificial intelligence") (regulation OR legislation OR law OR bill OR Congress OR policy OR "export controls" OR preemption OR lawmakers)`;

export async function googleNews(name: string, window: { after?: string; before?: string; when?: string }): Promise<Hit[]> {
  const range = window.when ? ` when:${window.when}` : ` after:${window.after} before:${window.before}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`"${name.replace(/\s*\(.*?\)/g, "")}" ${TOPIC}${range}`)}&hl=en-US&gl=US&ceid=US:en`;
  const r = await politeFetch(url);
  if (!r.ok) return [];
  const feed = await parser.parseString(await r.text()).catch(() => null);
  // Items without a published date are skipped rather than dated today.
  return (feed?.items ?? []).filter((i) => i.link && i.pubDate && !isNaN(Date.parse(i.pubDate))).map((i) => ({ link: i.link!, date: new Date(i.pubDate!).toISOString().slice(0, 10), title: i.title ?? "" }));
}
let lastGdelt = 0;
export async function gdelt(name: string, timespan: string): Promise<Hit[]> {
  const wait = lastGdelt + 5500 - Date.now(); if (wait > 0) await sleep(wait);      // GDELT asks for one request per 5 seconds
  lastGdelt = Date.now();
  const r = await politeFetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`"${name.replace(/\s*\(.*?\)/g, "")}" (regulation OR legislation OR "AI policy" OR Congress OR lawmakers)`)}&mode=artlist&format=json&maxrecords=50&timespan=${timespan}&sourcelang=english`);
  if (!r.ok) return [];
  try { return ((await r.json()).articles ?? []).map((a: any) => ({ link: a.url, date: `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}`, title: a.title })); } catch { return []; }
}

let lastDecode = 0;
export async function publisherUrl(link: string): Promise<string | null> {
  if (!/news\.google\.com\/(?:rss\/)?articles\//.test(link)) return link;
  const id = new URL(link).pathname.split("/").pop()!;
  try {
    const raw = Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1");
    const m = raw.match(/https?:\/\/[^\s\x00-\x1f"<>\\]+/);
    if (m && !/^AU_yq/.test(raw.slice(4, 10))) return m[0];
  } catch { /* fall through to the lookup */ }
  const wait = lastDecode + 2000 - Date.now(); if (wait > 0) await sleep(wait);
  lastDecode = Date.now();
  const page = await politeFetch(`https://news.google.com/rss/articles/${id}`);
  if (!page.ok) return null;
  const html = await page.text();
  const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1], ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts) return null;
  const inner = JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
  const res = await politeFetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: `f.req=${encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]))}` });
  if (!res.ok) return null;
  try { const url = JSON.parse(JSON.parse((await res.text()).split("\n\n")[1])[0][2])[1]; return typeof url === "string" && /^https?:\/\//.test(url) ? url : null; } catch { return null; }
}

function byline(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<meta[^>]+(?:name|property)=["'](?:author|article:author|parsely-author)["'][^>]+content=["']([^"']+)["']/gi)) out.push(m[1]);
  for (const m of html.matchAll(/"author"\s*:\s*(?:\[\s*)?\{[^}]*?"name"\s*:\s*"([^"]+)"/g)) out.push(m[1]);
  return out;
}
const pageDate = (html: string) => html.match(/<meta[^>]+(?:property|name)=["'](?:article:published_time|og:article:published_time|parsely-pub-date|date)["'][^>]+content=["'](\d{4}-\d{2}-\d{2})/i)?.[1];

export async function handleArticle(hit: Hit, people: Person[], st: Stats) {
  const marker = sha1(`${hit.link}|_doc`);
  if ((await q(`SELECT 1 FROM stmt_seen WHERE item_key=$1`, [marker])).length) return;
  const mark = (o: string) => mode.dry ? Promise.resolve() : pool.query(`INSERT INTO stmt_seen (item_key, source, outcome, prompt_versions) VALUES ($1,'news',$2,'fetch') ON CONFLICT DO NOTHING`, [marker, o]);
  const url = await publisherUrl(hit.link);
  if (!url || /news\.google\.com/.test(url)) { await mark("skipped"); return; }
  const page = await fetchPage(url);
  if (!page || page.text.length < 400) { await mark("skipped"); return; }
  const finalUrl = page.finalUrl.replace(/[?#].*$/, (m) => (/^\?(?:utm_|ref=|cid=)/.test(m) ? "" : m));
  const date = hit.date || pageDate(page.html);
  if (!date) { await mark("skipped"); return; }
  const platform = new URL(finalUrl).hostname.replace(/^www\./, "");
  const text = page.text.slice(0, 40000);
  const authors = byline(page.html);
  const own = people.find((p) => authors.some((a) => nameRe(p.name).test(a)));
  const docs: Doc[] = [];
  if (own && /opinion|op-ed|oped|commentary|perspective|guest-essay|viewpoint/i.test(finalUrl + " " + page.html.slice(0, 6000)))
    docs.push({ source: "oped", platform, kind: "op-ed", url: finalUrl, date, text, author: own });
  docs.push({ source: "news", platform, kind: "quote", url: finalUrl, date, text, people: own ? people.filter((p) => p.id !== own.id) : people });
  for (const d of docs) { const r = await processDoc(d); st.docs++; st.stored += r.stored; st.duplicates += r.duplicates; st.dropped += r.dropped; }
  await mark("skipped");
}

const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function pollNews(opts: { when?: string; backfill?: boolean; budgetMs?: number; tierMin?: number; maxPerPerson?: number } = {}): Promise<Stats> {
  const st = emptyStats();
  const t0 = Date.now(), people = await loadWatchlist();
  const over = () => opts.budgetMs != null && Date.now() - t0 > opts.budgetMs;
  const targets = people.filter((p) => p.tier >= (opts.tierMin ?? 1));
  const seen = new Set<string>();
  const run = async (hits: Hit[], max = opts.maxPerPerson ?? 40) => {
    for (const h of hits.slice(0, max)) { if (over()) return; if (seen.has(h.link)) continue; seen.add(h.link); await handleArticle(h, people, st); }
  };
  if (!opts.backfill) {
    for (const p of targets) {
      if (over()) break;
      await run(await googleNews(p.name, { when: opts.when ?? "2d" }));
      if (p.tier >= 3) await run(await gdelt(p.name, opts.when ?? "2d"));
    }
    return st;
  }
  const step = (tier: number) => (tier >= 3 ? 1 : tier === 2 ? 3 : 6);
  for (const p of targets) {
    for (let d = new Date(FLOOR + "T00:00:00Z"); d < new Date(); d = addMonths(d, step(p.tier))) {
      if (over()) return st;
      const key = `${p.id}|${iso(d)}`;
      if ((await q(`SELECT 1 FROM stmt_cursors WHERE source='news' AND key=$1 AND done`, [key])).length) continue;
      const end = addMonths(d, step(p.tier));
      await run(await googleNews(p.name, { after: iso(d), before: iso(end) }), p.tier >= 3 ? 30 : 15);
      if (!over()) await setCursor("news", key, null, true);
    }
  }
  return st;
}
