// Handle discovery and verification (Workstream A).
// A handle is VERIFIED only when the person's own site or an official bio page (an org team page, a personal site) links to it,
// close to the person's name. Fame, a matching display name, or a search hit are never enough: those become `candidate`
// rows, which are listed in data/watchlist.yaml for a human to check and are never ingested.
//   Bluesky: public AppView getProfile gives the DID and follower count.   Mastodon: public accounts/lookup.
//   Blogs/Substacks: feed link advertised on the person's own site.        Threads/X: recorded only (see data/gaps.md).
// Usage: pnpm statements:handles [--limit N] [--tier-min 1] [--redo]
import "../../env.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pool, q } from "../../../src/lib/db.ts";
import { politeFetch, sleep } from "../../lib/ingest.ts";
import { fetchPage } from "./textutil.ts";

const BSKY = "https://public.api.bsky.app/xrpc";
const NOT_OFFICIAL = /(?:^|\.)(?:docquery\.fec\.gov|fec\.gov|lda\.gov|lda\.senate\.gov|govinfo\.gov|web\.archive\.org|archive\.org|wikipedia\.org|linkedin\.com|crunchbase\.com|fortune\.com|techcrunch\.com|prnewswire\.com|fedscoop\.com|reuters\.com|nytimes\.com|wsj\.com|bloomberg\.com|cnbc\.com|theverge\.com|wired\.com|axios\.com|politico\.com|semafor\.com|washingtonpost\.com|forbes\.com|businessinsider\.com|theinformation\.com|bruegel\.org|benton\.org|x\.com|twitter\.com|youtube\.com)$/i;
const MASTO_HOSTS = /^(?:mastodon\.social|mastodon\.online|hachyderm\.io|fosstodon\.org|mas\.to|infosec\.exchange|universeodon\.com|techhub\.social|sigmoid\.social|mstdn\.social|social\.coop|journa\.host|c\.im|masto\.ai|mastodon\.world|toot\.community|ruby\.social|indieweb\.social|noc\.social|polyglot\.city)$/i;
const seedFile = JSON.parse(readFileSync(join(import.meta.dirname, "seeds.json"), "utf8")) as { own: Record<string, string[]>; bio: Record<string, string[]> };

type Found = { platform: "bluesky" | "mastodon" | "threads" | "x" | "substack" | "blog_rss"; handle: string; page: string };
const strip = (html: string) => html.replace(/<(footer|nav|header|script|style)[\s\S]*?<\/\1>/gi, " ");

export function socialLinks(html: string, page: string, personName: string, ownSite: boolean): Found[] {
  const body = ownSite ? html : strip(html);
  const titleHit = new RegExp(personName.replace(/\s*\(.*?\)/g, "").trim().split(/\s+/).join("\\s+"), "i");
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") + " " + (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const dedicated = ownSite || titleHit.test(title.replace(/<[^>]+>/g, " "));
  const nameAt = [...body.matchAll(new RegExp(titleHit.source, "gi"))].map((m) => m.index!);
  const near = (i: number) => nameAt.some((n) => Math.abs(n - i) <= 1500);
  const out: Found[] = [];
  const add = (f: Found, idx: number) => { if ((dedicated || near(idx)) && !out.some((o) => o.platform === f.platform && o.handle.toLowerCase() === f.handle.toLowerCase())) out.push(f); };
  for (const m of body.matchAll(/https?:\/\/bsky\.app\/profile\/([A-Za-z0-9._:-]+)/g)) add({ platform: "bluesky", handle: m[1], page }, m.index!);
  for (const m of body.matchAll(/https?:\/\/(?:www\.)?threads\.(?:net|com)\/@([A-Za-z0-9._]+)/g)) add({ platform: "threads", handle: m[1], page }, m.index!);
  for (const m of body.matchAll(/https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?=["'/?#\s<])/g)) if (!/^(?:home|share|intent|i|search|hashtag)$/i.test(m[1])) add({ platform: "x", handle: m[1], page }, m.index!);
  for (const m of body.matchAll(/https?:\/\/([a-z0-9.-]+)\/@([A-Za-z0-9_]+)(?=["'/?#\s<])/gi)) {
    const rel = /rel=["'][^"']*\bme\b/i.test(body.slice(Math.max(0, m.index! - 200), m.index! + 300));
    if (MASTO_HOSTS.test(m[1]) || rel) add({ platform: "mastodon", handle: `${m[2]}@${m[1]}`, page }, m.index!);
  }
  if (ownSite) {
    for (const m of body.matchAll(/https?:\/\/([a-z0-9-]+)\.substack\.com/gi)) add({ platform: "substack", handle: `https://${m[1]}.substack.com/feed`, page }, m.index!);
    for (const m of html.matchAll(/<link[^>]+rel=["']alternate["'][^>]*>/gi)) {
      if (!/rss|atom/i.test(m[0])) continue;
      const href = m[0].match(/href=["']([^"']+)["']/i)?.[1];
      if (href) add({ platform: "blog_rss", handle: new URL(href, page).toString(), page }, m.index!);
    }
  }
  return out;
}

async function bskyProfile(actor: string) {
  const r = await politeFetch(`${BSKY}/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`);
  return r.ok ? ((await r.json()) as { did: string; handle: string; displayName?: string; description?: string; followersCount?: number }) : null;
}
const sameSurname = (name: string, display: string) => display.toLowerCase().includes(name.replace(/\s*\(.*?\)/g, "").trim().split(/\s+/).at(-1)!.toLowerCase());

export async function discoverHandles(opts: { limit?: number; tierMin?: number; redo?: boolean } = {}) {
  const people = await q<{ id: string; name: string; tier: number }>(
    `SELECT n.id, n.name, w.influence_tier AS tier FROM stmt_watchlist w JOIN nodes n ON n.id=w.node_id WHERE w.influence_tier >= $1
     AND ($2 OR NOT EXISTS (SELECT 1 FROM stmt_cursors c WHERE c.source='handles' AND c.key=n.id AND c.updated_at > now() - interval '30 days'))
     ORDER BY w.influence_tier DESC, w.score DESC LIMIT $3`, [opts.tierMin ?? 1, !!opts.redo, opts.limit ?? 1000]);
  const seen: Record<string, Set<string>> = {};          // handle -> person ids it was found for (org footers show up for many people)
  const found: { id: string; f: Found; own: boolean }[] = [];
  for (const p of people) {
    const pages = new Map<string, boolean>();             // url -> is an own-site seed
    for (const u of seedFile.own[p.id] ?? []) pages.set(u, true);
    for (const u of seedFile.bio[p.id] ?? []) pages.set(u, false);
    const links = await q<{ u: string }>(`SELECT DISTINCT l.source_url AS u FROM links l WHERE l.from_id=$1 AND l.type='person'`, [p.id]);
    const own = await q<{ u: string }>(`SELECT source_url AS u FROM nodes WHERE id=$1`, [p.id]);
    for (const { u } of [...links, ...own]) { try { if (!NOT_OFFICIAL.test(new URL(u).hostname)) pages.set(u, pages.get(u) ?? false); } catch { /* skip */ } }
    for (const [url, ownSite] of [...pages].slice(0, 5)) {
      const page = await fetchPage(url, { html: true });
      if (!page) continue;
      if (!ownSite && !new RegExp(p.name.replace(/\s*\(.*?\)/g, "").trim().split(/\s+/).join("\\s+"), "i").test(page.html.replace(/<[^>]+>/g, " "))) continue;
      for (const f of socialLinks(page.html, page.finalUrl, p.name, ownSite)) {
        found.push({ id: p.id, f, own: ownSite });
        (seen[`${f.platform}:${f.handle.toLowerCase()}`] ??= new Set()).add(p.id);
      }
      await sleep(400);
    }
    await pool.query(`INSERT INTO stmt_cursors (source, key, done) VALUES ('handles',$1,true) ON CONFLICT (source,key) DO UPDATE SET updated_at=now()`, [p.id]);
  }
  let verified = 0, candidates = 0;
  for (const { id, f, own } of found) {
    if (seen[`${f.platform}:${f.handle.toLowerCase()}`].size > 1) continue;      // shared by several people: an org account, not theirs
    const person = people.find((p) => p.id === id)!;
    if (f.platform === "bluesky") {
      const prof = await bskyProfile(f.handle);
      if (!prof) continue;
      const ok = sameSurname(person.name, `${prof.displayName ?? ""} ${prof.handle}`) || own;
      await pool.query(`INSERT INTO stmt_handles (node_id, platform, handle, did, status, verified_via, verified_at, followers, note) VALUES ($1,'bluesky',$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (node_id, platform, handle) DO UPDATE SET did=$3, status=$4, verified_via=$5, verified_at=$6, followers=$7, note=$8`,
        [id, prof.handle, prof.did, ok ? "verified" : "candidate", ok ? f.page : null, ok ? new Date() : null, prof.followersCount ?? null, ok ? null : `linked from ${f.page} but display name "${prof.displayName}" does not match`]);
      ok ? verified++ : candidates++;
    } else if (f.platform === "mastodon") {
      const [user, host] = f.handle.split("@");
      const r = await politeFetch(`https://${host}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`);
      if (!r.ok) continue;
      const a: any = await r.json();
      await pool.query(`INSERT INTO stmt_handles (node_id, platform, handle, status, verified_via, verified_at, followers) VALUES ($1,'mastodon',$2,'verified',$3,now(),$4)
        ON CONFLICT (node_id, platform, handle) DO UPDATE SET status='verified', verified_via=$3, verified_at=now(), followers=$4`, [id, f.handle, f.page, a.followers_count ?? null]);
      verified++;
    } else if (f.platform === "substack" || f.platform === "blog_rss") {
      const r = await politeFetch(f.handle);
      if (!r.ok || !/xml|rss|atom/i.test(r.headers.get("content-type") ?? "")) continue;
      await pool.query(`INSERT INTO stmt_handles (node_id, platform, handle, status, verified_via, verified_at) VALUES ($1,$2,$3,'verified',$4,now())
        ON CONFLICT (node_id, platform, handle) DO UPDATE SET status='verified', verified_via=$4, verified_at=now()`, [id, f.platform === "substack" ? "substack" : "blog_rss", f.handle, f.page]);
      verified++;
    } else if (f.platform === "threads") {
      await pool.query(`INSERT INTO stmt_handles (node_id, platform, handle, status, verified_via, verified_at, note) VALUES ($1,'threads',$2,'verified',$3,now(),'handle verified; reading it needs THREADS_ACCESS_TOKEN')
        ON CONFLICT (node_id, platform, handle) DO NOTHING`, [id, f.handle, f.page]);
      verified++;
    }
    await sleep(250);
  }
  // Unverified suggestions for tier 2-3 people with no verified Bluesky: an exact display-name match is a CANDIDATE only.
  for (const p of people.filter((x) => x.tier >= 2)) {
    if ((await q(`SELECT 1 FROM stmt_handles WHERE node_id=$1 AND platform='bluesky'`, [p.id])).length) continue;
    const r = await politeFetch(`${BSKY}/app.bsky.actor.searchActors?q=${encodeURIComponent(p.name)}&limit=3`);
    if (!r.ok) continue;
    for (const a of ((await r.json()).actors ?? []) as any[]) {
      if ((a.displayName ?? "").toLowerCase().replace(/[^a-z ]/g, "").trim() !== p.name.toLowerCase().replace(/\s*\(.*?\)/g, "").replace(/[^a-z ]/g, "").trim()) continue;
      await pool.query(`INSERT INTO stmt_handles (node_id, platform, handle, did, status, followers, note) VALUES ($1,'bluesky',$2,$3,'candidate',$4,$5) ON CONFLICT DO NOTHING`,
        [p.id, a.handle, a.did, a.followersCount ?? null, `search hit with an exact display-name match; not linked from the person's own site, so NOT ingested. Bio: ${String(a.description ?? "").replace(/\s+/g, " ").slice(0, 120)}`]);
      candidates++;
    }
    await sleep(300);
  }
  return { people: people.length, verified, candidates };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : undefined; };
  console.log(await discoverHandles({ limit: arg("--limit"), tierMin: arg("--tier-min"), redo: process.argv.includes("--redo") }));
  const { writeYaml } = await import("./watchlist.ts");
  await writeYaml();
  await pool.end();
}
