import "server-only";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { q } from "./db";

// Visit every public page once, in the background, so each is rebuilt from the current record before a reader asks for it.
// Called when the site starts (the daily import runs while the site is down) and after a write clears the cached record.
// A page is always answered from the copy on hand; this is what keeps that copy current.
//
// Next keeps each rebuilt page on disk (each /money trace and each tab of /targets and the profiles too, since src/proxy.ts
// makes every one of them a prebuilt page), so when the record has not changed since the last finished pass of this build
// there is nothing to rebuild: Postgres counts every row written, per table, and that count is the record's version.
// It waits for writes to go quiet first (a review session clears the cache on every decision), a newer call cancels a pass
// under way, and it makes one request at a time so a reader's request always gets a turn.
const g = globalThis as unknown as { __mbWarm?: { timer?: ReturnType<typeof setTimeout>; pass: number } };
const state = (g.__mbWarm ??= { pass: 0 });
const PAGES = ["/", "/map", "/money", "/targets", "/targets?kind=rules", "/targets?kind=elections", "/targets?kind=lobbied", "/statements", "/data", "/search"];
// turbopackIgnore: these are runtime paths, not files for the bundler to trace into the build.
const dist = join(/*turbopackIgnore: true*/ process.cwd(), process.env.NEXT_DIST_DIR || ".next");
const marker = join(dist, "cache", "warmed");

async function version() {
  const [{ v }] = await q<{ v: string }>(`SELECT coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::text AS v FROM pg_stat_user_tables`);
  // A new build starts with only the prebuilt pages, so it always gets a pass.
  return `${await readFile(join(dist, "BUILD_ID"), "utf8").catch(() => "")}:${v}`;
}

export function warmSite(origin: string, quietMs = 15_000) {
  // On Vercel each request may land on a fresh, short-lived instance with no server of its own to fetch from; pages are
  // rebuilt there on the first visit after a refresh instead.
  if (process.env.VERCEL) return;
  clearTimeout(state.timer);
  const pass = ++state.pass;
  state.timer = setTimeout(async () => {
    try {
      const v = await version();
      const current = v === await readFile(marker, "utf8").catch(() => "");
      const ids = current ? [] : await q<{ id: string }>(`SELECT n.id FROM nodes n ORDER BY (SELECT count(*) FROM links l WHERE l.from_id=n.id OR l.to_id=n.id) DESC, n.id`);
      // Every starting point /money offers (a superset is harmless): each is its own prebuilt trace.
      const starts = current ? [] : await q<{ id: string }>(`SELECT DISTINCT from_id AS id FROM links WHERE type='money' AND coalesce(subtype,'') <> 'lobbying'
        UNION SELECT DISTINCT coalesce(from_id, 'undisclosed:' || to_id) FROM money_hops`);
      const urls = [...(current ? [] : PAGES), ...starts.map((r) => `/money?from=${encodeURIComponent(r.id)}`), ...ids.map((r) => `/node/${encodeURIComponent(r.id)}`)];
      if (!urls.length) return;
      const t0 = Date.now(), n = urls.length;
      for (let u = urls.shift(); u && state.pass === pass; u = urls.shift()) await fetch(origin + u, { signal: AbortSignal.timeout(60_000) }).then((r) => r.arrayBuffer()).catch(() => {});
      if (state.pass !== pass) return;
      console.log(`[warm] rebuilt ${n} pages in ${Math.round((Date.now() - t0) / 1000)}s`);
      await mkdir(join(dist, "cache"), { recursive: true });
      await writeFile(marker, v);
    } catch (e) { console.warn(`[warm] skipped: ${(e as Error).message}`); /* database down: the next write or start tries again */ }
  }, quietMs);
  state.timer.unref?.();
}
