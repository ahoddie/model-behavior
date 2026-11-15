// Mastodon: public REST API, no key. Verified handles only (a link from the person's own site, ideally rel="me").
// Threads: the official API needs an access token the app owner creates; with THREADS_ACCESS_TOKEN unset it is skipped and logged as a gap.
import { pool, q } from "../../../../src/lib/db.ts";
import { politeFetch, sleep } from "../../../lib/ingest.ts";
import { htmlToText } from "../../../lib/text.ts";
import { processDoc, type Doc } from "../pipeline.ts";
import { FLOOR, emptyStats, type Stats } from "./bluesky.ts";
import { words } from "../textutil.ts";

export async function pollMastodon(opts: { maxPages?: number } = {}): Promise<Stats> {
  const st = emptyStats();
  const rows = await q<{ id: string; name: string; tier: number; handle: string }>(
    `SELECT n.id, n.name, w.influence_tier AS tier, h.handle FROM stmt_handles h JOIN stmt_watchlist w ON w.node_id=h.node_id JOIN nodes n ON n.id=h.node_id WHERE h.platform='mastodon' AND h.status='verified'`);
  for (const r of rows) {
    const [user, host] = r.handle.split("@");
    const [cur] = await q<{ cursor: string | null; done: boolean }>(`SELECT cursor, done FROM stmt_cursors WHERE source='mastodon' AND key=$1`, [r.handle]);
    const state: { newest?: string; maxId?: string } = cur?.cursor ? JSON.parse(cur.cursor) : {};
    const backfilling = !cur?.done;
    const acct = await politeFetch(`https://${host}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`);
    if (!acct.ok) continue;
    const id = ((await acct.json()) as any).id;
    let maxId = backfilling ? state.maxId : undefined, newest = state.newest ?? "";
    for (let page = 0; page < (opts.maxPages ?? (backfilling ? 30 : 2)); page++) {
      const res = await politeFetch(`https://${host}/api/v1/accounts/${id}/statuses?limit=40&exclude_replies=true&exclude_reblogs=true${maxId ? `&max_id=${maxId}` : ""}`);
      if (!res.ok) break;
      const list: any[] = await res.json();
      let old = !list.length;
      for (const s of list) {
        if (s.created_at > newest) newest = s.created_at;
        if (s.created_at.slice(0, 10) < FLOOR || (!backfilling && state.newest && s.created_at <= state.newest)) { old = true; continue; }
        const text = htmlToText(s.content ?? "");
        if (words(text) < 4) { st.skipped++; continue; }
        const doc: Doc = { source: "mastodon", platform: "Mastodon", kind: "post", url: s.url, date: s.created_at.slice(0, 10), text, author: { id: r.id, name: r.name, tier: r.tier } };
        const out = await processDoc(doc);
        st.docs++; st.stored += out.stored; st.duplicates += out.duplicates; st.dropped += out.dropped;
      }
      maxId = list.at(-1)?.id;
      await pool.query(`INSERT INTO stmt_cursors (source,key,cursor,done) VALUES ('mastodon',$1,$2,$3) ON CONFLICT (source,key) DO UPDATE SET cursor=$2, done=$3, updated_at=now()`,
        [r.handle, JSON.stringify({ newest, maxId: old ? undefined : maxId }), backfilling ? old : true]);
      if (old) break;
      await sleep(400);
    }
  }
  return st;
}

export async function pollThreads(): Promise<Stats> {
  if (!process.env.THREADS_ACCESS_TOKEN) { console.log("threads: THREADS_ACCESS_TOKEN not set, skipped (logged in data/gaps.md)"); return emptyStats(); }
  // With a token: GET https://graph.threads.net/v1.0/<user-id>/threads?fields=id,text,timestamp,permalink for each verified handle.
  // Only the account owner's own token can read their posts, and reading other public profiles requires Meta app review, so this stays off.
  return emptyStats();
}
