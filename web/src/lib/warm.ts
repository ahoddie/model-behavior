import "server-only";
import { q } from "./db";

// Visit every public page once, in the background, so each is rebuilt from the current record before a reader asks for it.
// Runs when the site starts (the daily import runs while the site is down, so the prebuilt pages may be a day old) and after
// a write clears the cached record. A page is always answered from the copy on hand; this is what keeps that copy current.
// It waits for writes to go quiet first (a review session clears the cache on every decision), a newer call cancels a pass
// already under way, and it makes two requests at a time so a reader is never queued behind it.
const g = globalThis as unknown as { __mbWarm?: { timer?: ReturnType<typeof setTimeout>; pass: number } };
const state = (g.__mbWarm ??= { pass: 0 });
const PAGES = ["/", "/map", "/money", "/targets", "/topics", "/data", "/search"];

export function warmSite(origin: string, quietMs = 15_000) {
  clearTimeout(state.timer);
  const pass = ++state.pass;
  state.timer = setTimeout(async () => {
    try {
      const ids = await q<{ id: string }>(`SELECT n.id FROM nodes n ORDER BY (SELECT count(*) FROM links l WHERE l.from_id=n.id OR l.to_id=n.id) DESC, n.id`);
      // Every starting point /money offers (a superset is harmless): each is its own cached trace.
      const starts = await q<{ id: string }>(`SELECT DISTINCT from_id AS id FROM links WHERE type='money' AND coalesce(subtype,'') <> 'lobbying'
        UNION SELECT DISTINCT coalesce(from_id, 'undisclosed:' || to_id) FROM money_hops`);
      const urls = [...PAGES, ...starts.map((r) => `/money?from=${encodeURIComponent(r.id)}`), ...ids.map((r) => `/node/${encodeURIComponent(r.id)}`)];
      const next = async () => { for (let u = urls.shift(); u && state.pass === pass; u = urls.shift()) await fetch(origin + u, { signal: AbortSignal.timeout(60_000) }).then((r) => r.arrayBuffer()).catch(() => {}); };
      await Promise.all([next(), next()]);
    } catch { /* database down: the next write or start tries again */ }
  }, quietMs);
  state.timer.unref?.();
}
