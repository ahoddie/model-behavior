// Bluesky: the highest-priority source. Only VERIFIED handles on the watchlist are read (see handles.ts).
//   poll:      per-account backfill to 2023-01-01 (resumable, one page at a time), then incremental polling of new posts.
//   firehose:  Jetstream filtered to the watchlist DIDs, run as a long-lived local process (`pnpm statements:firehose`).
// Reposts and replies are skipped; a quote-post that adds under three words is skipped as a repost. The post's own text is the only
// text read, so everything stored from here is attribution = direct.
import { pool, q } from "../../../../src/lib/db.ts";
import { politeFetch, sleep } from "../../../lib/ingest.ts";
import { processDoc, type Doc, type Person } from "../pipeline.ts";
import { words } from "../textutil.ts";

const BSKY = "https://public.api.bsky.app/xrpc";
export const FLOOR = "2023-01-01";
export type Stats = { docs: number; stored: number; duplicates: number; dropped: number; skipped: number };
export const emptyStats = (): Stats => ({ docs: 0, stored: 0, duplicates: 0, dropped: 0, skipped: 0 });

type Account = { person: Person; did: string; handle: string };
export async function accounts(): Promise<Account[]> {
  const rows = await q<{ id: string; name: string; tier: number; did: string; handle: string }>(
    `SELECT n.id, n.name, w.influence_tier AS tier, h.did, h.handle FROM stmt_handles h JOIN stmt_watchlist w ON w.node_id=h.node_id JOIN nodes n ON n.id=h.node_id
     WHERE h.platform='bluesky' AND h.status='verified' AND h.did IS NOT NULL ORDER BY w.influence_tier DESC`);
  return rows.map((r) => ({ person: { id: r.id, name: r.name, tier: r.tier }, did: r.did, handle: r.handle }));
}

export function postDoc(a: Account, rkey: string, text: string, createdAt: string, quotedWithoutText = false): Doc | null {
  if (!text.trim() || quotedWithoutText || words(text) < 4) return null;
  return { source: "bluesky", platform: "Bluesky", kind: "post", url: `https://bsky.app/profile/${a.handle}/post/${rkey}`, date: createdAt.slice(0, 10), text, author: a.person };
}

export async function pollBluesky(opts: { maxPages?: number; only?: string } = {}): Promise<Stats> {
  const st = emptyStats();
  for (const a of await accounts()) {
    if (opts.only && a.person.id !== opts.only) continue;
    const [cur] = await q<{ cursor: string | null; done: boolean }>(`SELECT cursor, done FROM stmt_cursors WHERE source='bluesky' AND key=$1`, [a.did]);
    const state: { newest?: string; next?: string } = cur?.cursor ? JSON.parse(cur.cursor) : {};
    const backfilling = !cur?.done;
    let next: string | undefined = backfilling ? state.next : undefined;
    let newest = state.newest ?? "";
    for (let page = 0; page < (opts.maxPages ?? (backfilling ? 60 : 3)); page++) {
      const r = await politeFetch(`${BSKY}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(a.did)}&filter=posts_no_replies&limit=100${next ? `&cursor=${encodeURIComponent(next)}` : ""}`);
      if (!r.ok) break;
      const j: any = await r.json();
      let reachedOld = false;
      for (const item of j.feed ?? []) {
        if (item.reason) continue;                                   // repost or pin
        const p = item.post;
        if (p.author?.did !== a.did) continue;
        const created: string = p.record?.createdAt ?? p.indexedAt;
        if (created > newest) newest = created;
        if (created.slice(0, 10) < FLOOR) { reachedOld = true; continue; }
        if (!backfilling && state.newest && created <= state.newest) { reachedOld = true; continue; }
        const embed = p.record?.embed?.$type ?? "";
        const doc = postDoc(a, p.uri.split("/").pop(), p.record?.text ?? "", created, /embed\.record$/.test(embed) && words(p.record?.text ?? "") < 3);
        if (!doc) { st.skipped++; continue; }
        const res = await processDoc(doc);
        st.docs++; st.stored += res.stored; st.duplicates += res.duplicates; st.dropped += res.dropped;
      }
      next = j.cursor;
      const done = reachedOld || !next;
      await pool.query(`INSERT INTO stmt_cursors (source, key, cursor, done) VALUES ('bluesky',$1,$2,$3)
        ON CONFLICT (source,key) DO UPDATE SET cursor=$2, done=$3, updated_at=now()`, [a.did, JSON.stringify({ newest, next: done ? undefined : next }), backfilling ? done : true]);
      if (done) break;
      await sleep(300);
    }
  }
  return st;
}

// ---- Jetstream ---------------------------------------------------------------------------------------------------------------------
export async function firehose() {
  const accts = await accounts();
  if (!accts.length) { console.log("firehose: no verified Bluesky handles on the watchlist yet; run `pnpm statements:handles`"); return; }
  const byDid = new Map(accts.map((a) => [a.did, a]));
  const queue: Doc[] = [];
  let busy = false;
  const drain = async () => {
    if (busy) return; busy = true;
    while (queue.length) {
      const doc = queue.shift()!;
      try { const r = await processDoc(doc); if (r.stored) console.log(`[${new Date().toISOString()}] +${r.stored} ${doc.url}`); } catch (e) { console.warn("firehose item failed:", (e as Error).message); }
    }
    busy = false;
  };
  let lastUs = 0;
  const saveCursor = async () => { if (lastUs) await pool.query(`INSERT INTO stmt_cursors (source,key,cursor) VALUES ('bluesky_firehose','jetstream',$1) ON CONFLICT (source,key) DO UPDATE SET cursor=$1, updated_at=now()`, [String(lastUs)]); };
  setInterval(saveCursor, 30000);
  for (let attempt = 0; ; attempt++) {
    const [c] = await q<{ cursor: string | null }>(`SELECT cursor FROM stmt_cursors WHERE source='bluesky_firehose' AND key='jetstream'`);
    const since = c?.cursor ? Number(c.cursor) - 5_000_000 : 0;      // replay five seconds so nothing falls in the gap
    const url = `wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post&${[...byDid.keys()].map((d) => `wantedDids=${d}`).join("&")}${since > 0 ? `&cursor=${since}` : ""}`;
    console.log(`jetstream: following ${byDid.size} accounts${since ? ` from ${new Date(since / 1000).toISOString()}` : ""}`);
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data));
        if (m.time_us) lastUs = m.time_us;
        const a = byDid.get(m.did);
        const rec = m.commit?.record;
        if (!a || m.commit?.operation !== "create" || m.commit?.collection !== "app.bsky.feed.post" || !rec?.text || rec.reply) return;
        const doc = postDoc(a, m.commit.rkey, rec.text, rec.createdAt, /embed\.record$/.test(rec.embed?.$type ?? "") && words(rec.text) < 3);
        if (doc) { queue.push(doc); void drain(); }
      };
      ws.onclose = () => resolve();
      ws.onerror = () => ws.close();
    });
    await saveCursor();
    await sleep(Math.min(60000, 2000 * 2 ** Math.min(attempt, 5)));      // reconnect with backoff; the cursor replays what was missed
  }
}
