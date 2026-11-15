// Entry point for Workstream A. Resumable: every source keeps its own cursor in stmt_cursors, every item's outcome is in stmt_seen.
//   pnpm statements:run                       hourly set: watchlist, Bluesky, Mastodon, blogs, newsrooms, news (last 2 days), testimony
//   pnpm statements:run --backfill            walk every source back to 2023-01-01 (stops at --budget-min, resumes next run)
//   pnpm statements:run --sources bluesky,news --budget-min 30
import "../../env.ts";
import { pool } from "../../../src/lib/db.ts";
import { endRun, startRun } from "../../lib/ingest.ts";
import { buildWatchlist } from "./watchlist.ts";
import { discoverHandles } from "./handles.ts";
import { pollBluesky, type Stats } from "./sources/bluesky.ts";
import { pollMastodon, pollThreads } from "./sources/mastodon.ts";
import { pollBlogs, pollNewsrooms } from "./sources/feeds.ts";
import { pollNews } from "./sources/news.ts";
import { pollTestimony } from "./sources/testimony.ts";
import { pollTranscripts } from "./sources/transcripts.ts";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const backfill = process.argv.includes("--backfill");
const budgetMs = Number(arg("--budget-min") ?? (backfill ? 240 : 25)) * 60000;
const ALL = ["bluesky", "mastodon", "threads", "blogs", "newsrooms", "news", "testimony", "transcripts"];
const picked = (arg("--sources")?.split(",") ?? ALL.filter((s) => backfill || s !== "transcripts"));

export async function run() {
  const runId = await startRun("statements");
  const out: Record<string, Stats | string> = {};
  let stored = 0;
  const t0 = Date.now();
  try {
    const wl = await buildWatchlist();       // new FEC / 990 / role rows add people here, automatically
    console.log(`watchlist: ${wl.total} people, ${wl.added.length} new`);
    if (wl.added.length || backfill) console.log("handles:", await discoverHandles({ limit: 40 }));
    const jobs: Record<string, () => Promise<Stats>> = {
      bluesky: () => pollBluesky(), mastodon: () => pollMastodon(), threads: () => pollThreads(),
      blogs: () => pollBlogs(backfill ? {} : { days: 7 }), newsrooms: () => pollNewsrooms({ days: backfill ? 60 : 3 }),
      news: () => pollNews({ backfill, when: "2d", tierMin: backfill ? 1 : 2, budgetMs: Math.max(60000, budgetMs - (Date.now() - t0)) }),
      testimony: () => pollTestimony({ maxHearings: backfill ? 60 : 10 }), transcripts: () => pollTranscripts(backfill ? {} : { days: 14 }),
    };
    for (const s of picked) {
      if (!jobs[s]) continue;
      try { const r = await jobs[s](); out[s] = r; stored += r.stored; console.log(s, JSON.stringify(r)); }
      catch (e) { out[s] = `error: ${(e as Error).message}`; console.error(s, e); }
    }
    await endRun(runId, true, stored, JSON.stringify(out).slice(0, 1800));
  } catch (e) { await endRun(runId, false, stored, String(e)); throw e; }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) { await run(); await pool.end(); }
