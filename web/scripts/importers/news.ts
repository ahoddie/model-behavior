// News quotes: GDELT DOC 2.0 API and Google News RSS. For each person and lab, find recent articles that mention
// them alongside AI-policy terms, fetch the article, extract attributed quotes, store as pending.
import "../env.ts";
import Parser from "rss-parser";
import { q } from "../../src/lib/db.ts";
import { startRun, endRun, politeFetch, sleep } from "../lib/ingest.ts";
import { fetchText, ingestDocument, POLICY_TERMS, AI_TERMS } from "../lib/text.ts";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../env.ts";

const timespan = process.argv.find((a) => a.startsWith("--timespan="))?.slice(11) ?? "2d";
// Caps, for the nightly GitHub Actions job (a full pass over every person and lab took up to 9 hours). Unset = no cap.
//   NEWS_BUDGET_MIN   stop after this many minutes
//   NEWS_MAX_ACTORS   stop after this many actors
// Actors are taken in id order from where the last run stopped (data/cache/news-cursor.json), wrapping around, so a
// capped run each night still reaches everyone in rotation. The 2-day --timespan should then be widened to match the
// rotation length; the nightly job passes --timespan to cover it.
const BUDGET_MS = Number(process.env.NEWS_BUDGET_MIN ?? 0) * 60_000;
const MAX_ACTORS = Number(process.env.NEWS_MAX_ACTORS ?? 0);
const parser = new Parser();

async function gdelt(name: string) {
  const query = `"${name}" "artificial intelligence" (regulation OR legislation OR policy OR congress OR lawmakers)`;
  const u = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=25&timespan=${timespan}&sourcelang=english`;
  const res = await politeFetch(u);
  if (!res.ok) return [];
  try { return ((await res.json()).articles ?? []).map((a: any) => ({ url: a.url, date: `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}`, title: a.title })); }
  catch { return []; }
}
async function gnews(name: string) {
  const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${encodeURIComponent(`"${name}" AI regulation when:${timespan}`)}&hl=en-US&gl=US&ceid=US:en`).catch(() => null);
  // Items without a published date are skipped rather than dated today.
  return (feed?.items ?? []).filter((i) => i.link && i.pubDate && !isNaN(Date.parse(i.pubDate))).map((i) => ({ url: i.link!, date: new Date(i.pubDate!).toISOString().slice(0, 10), title: i.title ?? "" }));
}

export async function run() {
  const runId = await startRun("news");
  let added = 0;
  // Articles fetched on earlier nights are not fetched again; the list keeps the last 20,000.
  const seenFile = join(REPO, "data/cache/news-seen.json");
  const prior: string[] = existsSync(seenFile) ? JSON.parse(readFileSync(seenFile, "utf8")) : [];
  const seen = new Set<string>(prior);
  const cursorFile = join(REPO, "data/cache/news-cursor.json");
  const save = (last?: string) => {
    mkdirSync(join(REPO, "data/cache"), { recursive: true });
    writeFileSync(seenFile, JSON.stringify([...seen].slice(-20000)));
    if (last !== undefined) writeFileSync(cursorFile, JSON.stringify({ last, at: new Date().toISOString() }));
  };
  const t0 = Date.now();
  try {
    const all = await q<{ id: string; name: string }>(`SELECT id, name FROM nodes WHERE type IN ('person','lab') ORDER BY id`);
    const capped = BUDGET_MS > 0 || MAX_ACTORS > 0;
    const after: string = capped && existsSync(cursorFile) ? JSON.parse(readFileSync(cursorFile, "utf8")).last ?? "" : "";
    const start = Math.max(0, all.findIndex((a) => a.id > after));
    const actors = capped ? [...all.slice(start), ...all.slice(0, start)] : all;
    let done = 0;
    for (const a of actors) {
      if ((BUDGET_MS && Date.now() - t0 > BUDGET_MS) || (MAX_ACTORS && done >= MAX_ACTORS)) {
        console.log(`news: cap reached after ${done} of ${all.length} actors; next run starts after ${actors[done - 1]?.id}`);
        break;
      }
      const arts = [...(await gdelt(a.name)), ...(await gnews(a.name))];
      for (const art of arts) {
        if (!art.url || seen.has(art.url)) continue;
        seen.add(art.url);
        const page = await fetchText(art.url);
        // Google News links are redirects; keep only articles that resolve to the publisher's own URL.
        if (!page || /news\.google\.com/.test(page.finalUrl) || !POLICY_TERMS.test(page.text) || !AI_TERMS.test(page.text)) continue;
        added += await ingestDocument({ text: page.text, url: page.finalUrl, date: art.date, platform: new URL(page.finalUrl).hostname.replace(/^www\./, ""),
          kind: "quote", origin: "importer:news", requireQuote: true });
      }
      await sleep(1500);
      done++;
      if (capped && done % 10 === 0) save(a.id); // a run cut off by the job's own timeout still keeps most of its progress
    }
    save(capped && done ? actors[done - 1].id : undefined);
    await endRun(runId, true, added);
  } catch (e) { await endRun(runId, false, added, String(e)); throw e; }
  return added;
}
if (import.meta.url === `file://${process.argv[1]}`) { console.log("news added", await run()); process.exit(0); }
