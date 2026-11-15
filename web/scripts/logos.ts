// Logos: for every organization with a sourced Website fact, read its homepage and take the site's own icon.
// Preference: apple-touch-icon (square, large) > SVG icon > JSON-LD Organization logo > largest <link rel=icon> > /favicon.ico.
// The image stays hot-linked from the org's own site; logo_source_url records the homepage it came from.
// Usage: pnpm logos [--all]   (--all re-checks nodes that already have a logo)
import "./env.ts";
import { pool } from "../src/lib/db.ts";
import { politeFetch, sleep, notifySite } from "./lib/ingest.ts";

const all = process.argv.includes("--all");
const rows = (await pool.query(
  `SELECT DISTINCT ON (n.id) n.id, n.name, f.url AS site FROM nodes n JOIN facts f ON f.node_id=n.id AND f.label='Website'
   WHERE n.type IN ('lab','investor','funder','think_tank','nonprofit','pac','agency') ${all ? "" : "AND n.logo_url IS NULL"}
   ORDER BY n.id, f.id DESC`)).rows as { id: string; name: string; site: string }[];

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
const sizeOf = (s?: string) => Math.max(0, ...(s ?? "").split(/\s+/).map((x) => Number(x.split("x")[0]) || 0));

function candidates(html: string, base: string): string[] {
  const out: { url: string; score: number }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase(), href = attr(tag, "href");
    if (!href || !/icon/.test(rel)) continue;
    const type = attr(tag, "type") ?? "", size = sizeOf(attr(tag, "sizes"));
    const score = rel.includes("apple-touch-icon") ? 400 + size : type.includes("svg") || href.endsWith(".svg") ? 380 : 100 + size;
    out.push({ url: href, score });
  }
  for (const block of html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) ?? []) {
    const m = block.match(/"logo"\s*:\s*(?:\{[^}]*?"url"\s*:\s*)?"([^"]+)"/);
    if (m) out.push({ url: m[1], score: 300 });
  }
  out.push({ url: "/favicon.ico", score: 1 });
  return out.sort((a, b) => b.score - a.score).map((c) => { try { return new URL(c.url.replace(/&amp;/g, "&"), base).href; } catch { return ""; } }).filter(Boolean);
}

async function isImage(url: string) {
  try {
    const r = await politeFetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) });
    const ok = r.ok && /^image\//.test(r.headers.get("content-type") ?? "");
    await r.body?.cancel();
    return ok;
  } catch { return false; }
}

let found = 0;
for (const { id, name, site } of rows) {
  try {
    const res = await politeFetch(site, { redirect: "follow", signal: AbortSignal.timeout(20000) });
    if (!res.ok) { console.warn(`${id}: homepage ${res.status}`); continue; }
    const html = await res.text();
    let hit: string | null = null;
    for (const c of candidates(html, res.url)) if (await isImage(c)) { hit = c; break; }
    if (!hit) { console.warn(`${id}: no logo found on ${site}`); continue; }
    await pool.query(`UPDATE nodes SET logo_url=$2, logo_source_url=$3 WHERE id=$1`, [id, hit, site]);
    found++; console.log(`${name}: ${hit}`);
  } catch (e) { console.warn(`${id}: ${(e as Error).message}`); }
  await sleep(300);
}
console.log({ checked: rows.length, found });
await notifySite();
await pool.end();
