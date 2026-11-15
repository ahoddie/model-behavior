// Posts from the actors' own accounts.
//  Bluesky: daily pull of each tracked handle's feed via the public AppView; `--firehose` subscribes to Jetstream
//           (the filtered Bluesky firehose) for live posts from the tracked DIDs.
//  X: only if X_BEARER_TOKEN is set (API v2 user timelines).
// Handles live on nodes: external_ids.bluesky = "handle.bsky.social", external_ids.x = "username".
// Posts are kept only when they touch AI policy; quotes come from the post text itself.
import "../env.ts";
import { q } from "../../src/lib/db.ts";
import { startRun, endRun, politeFetch, sleep } from "../lib/ingest.ts";
import { ingestDocument, POLICY_TERMS } from "../lib/text.ts";

const BSKY = "https://public.api.bsky.app/xrpc";
const postUrl = (handle: string, uri: string) => `https://bsky.app/profile/${handle}/post/${uri.split("/").pop()}`;

async function bluesky(nodes: { id: string; external_ids: any }[]) {
  let added = 0;
  for (const n of nodes) {
    const handle = n.external_ids.bluesky;
    const res = await politeFetch(`${BSKY}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=50&filter=posts_no_replies`);
    if (!res.ok) continue;
    for (const item of (await res.json()).feed ?? []) {
      const p = item.post;
      if (p.author?.handle !== handle) continue; // skip reposts
      const text: string = p.record?.text ?? "";
      if (!POLICY_TERMS.test(text) || !/\bAI\b|artificial intelligence|model|compute|chip/i.test(text)) continue;
      added += await ingestDocument({ text, url: postUrl(handle, p.uri), date: (p.record?.createdAt ?? p.indexedAt).slice(0, 10), platform: "Bluesky",
        kind: "post", only: [n.id], origin: "importer:bluesky" });
    }
    await sleep(500);
  }
  return added;
}

async function firehose(nodes: { id: string; external_ids: any }[]) {
  const dids = new Map<string, { id: string; handle: string }>();
  for (const n of nodes) {
    const r = await politeFetch(`${BSKY}/com.atproto.identity.resolveHandle?handle=${n.external_ids.bluesky}`);
    if (r.ok) dids.set((await r.json()).did, { id: n.id, handle: n.external_ids.bluesky });
  }
  const url = `wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post&${[...dids.keys()].map((d) => `wantedDids=${d}`).join("&")}`;
  console.log(`jetstream: following ${dids.size} accounts`);
  const ws = new WebSocket(url);
  ws.onmessage = async (ev) => {
    const m = JSON.parse(String(ev.data));
    const who = dids.get(m.did);
    const rec = m.commit?.record;
    if (!who || m.commit?.operation !== "create" || !rec?.text || !POLICY_TERMS.test(rec.text)) return;
    const n = await ingestDocument({ text: rec.text, url: `https://bsky.app/profile/${who.handle}/post/${m.commit.rkey}`, date: rec.createdAt.slice(0, 10),
      platform: "Bluesky", kind: "post", only: [who.id], origin: "importer:bluesky" });
    if (n) console.log(`+${n} from ${who.handle}`);
  };
  await new Promise(() => {}); // run until stopped
}

async function x(nodes: { id: string; external_ids: any }[]) {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) { console.log("x: X_BEARER_TOKEN not set, skipping"); return 0; }
  let added = 0;
  const h = { Authorization: `Bearer ${token}` };
  for (const n of nodes) {
    const u = await politeFetch(`https://api.x.com/2/users/by/username/${n.external_ids.x}`, { headers: h });
    if (!u.ok) continue;
    const uid = (await u.json()).data?.id;
    const t = await politeFetch(`https://api.x.com/2/users/${uid}/tweets?max_results=50&exclude=retweets,replies&tweet.fields=created_at`, { headers: h });
    if (!t.ok) continue;
    for (const tw of (await t.json()).data ?? []) {
      if (!POLICY_TERMS.test(tw.text)) continue;
      added += await ingestDocument({ text: tw.text, url: `https://x.com/${n.external_ids.x}/status/${tw.id}`, date: tw.created_at.slice(0, 10), platform: "X",
        kind: "post", only: [n.id], origin: "importer:x" });
    }
    await sleep(1000);
  }
  return added;
}

export async function run() {
  const bs = await q<{ id: string; external_ids: any }>(`SELECT id, external_ids FROM nodes WHERE external_ids ? 'bluesky'`);
  if (process.argv.includes("--firehose")) return firehose(bs);
  const runId = await startRun("social");
  let added = 0;
  try {
    added += await bluesky(bs);
    added += await x(await q(`SELECT id, external_ids FROM nodes WHERE external_ids ? 'x'`));
    await endRun(runId, true, added);
  } catch (e) { await endRun(runId, false, added, String(e)); throw e; }
  return added;
}
if (import.meta.url === `file://${process.argv[1]}`) { console.log("social added", await run()); process.exit(0); }
