// Logos: for every organization with a sourced Website fact, read its homepage and take the site's own icon,
// then store the image locally at web/public/logos/<node id>.<ext> and set logo_url to '/logos/<id>.<ext>'.
// Preference: apple-touch-icon (square, large) > SVG icon > JSON-LD Organization logo > largest <link rel=icon> > /favicon.ico.
// A raster under 32px is only used when no larger candidate works. SVGs with <script or on*= handlers are rejected.
// robots.txt is checked before every request. logo_source_url records the homepage the icon was found on.
// Usage: pnpm logos [--all] [--localize] [--site <id>=<homepage> ...]
//   --all       re-check nodes that already have a logo
//   --site      only these nodes, from the homepage given (for an org with no Website fact); repeatable
//   --localize  download existing hot-linked logos (logo_url starting with http) and rewrite logo_url
import "./env.ts";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pool } from "../src/lib/db.ts";
import { politeFetch, sleep, notifySite } from "./lib/ingest.ts";

const all = process.argv.includes("--all");
// Cleared after a visual check (see data/gaps.md, logos): what the site serves is not a usable mark for the org.
const SKIP = new Set(["mainstream-democrats-pac", "agency-patent-and-trademark-office-pto", "secure-ai-project", "macroscopic", "thinking-machines"]);
const localize = process.argv.includes("--localize");
const OUT = fileURLToPath(new URL("../public/logos/", import.meta.url));
mkdirSync(OUT, { recursive: true });
const TYPES = `('lab','investor','funder','think_tank','nonprofit','pac','agency')`;
const MAX_BYTES = 2_000_000;

// ---- robots.txt (per origin, cached). Honors the "*" group and our own user agent; Allow/Disallow longest match wins.
const robotsCache = new Map<string, { allow: string[]; disallow: string[] }>();
async function robots(origin: string) {
  let r = robotsCache.get(origin);
  if (r) return r;
  r = { allow: [], disallow: [] };
  try {
    const res = await politeFetch(origin + "/robots.txt", { redirect: "follow", signal: AbortSignal.timeout(10000) }, 0);
    if (res.ok && /text|plain/.test(res.headers.get("content-type") ?? "text/plain")) {
      let applies = false, groupHasAgent = false;
      for (const raw of (await res.text()).split(/\r?\n/)) {
        const line = raw.replace(/#.*/, "").trim();
        const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
        if (!m) continue;
        const k = m[1].toLowerCase(), v = m[2].trim();
        if (k === "user-agent") {
          if (!groupHasAgent) applies = false;
          groupHasAgent = true;
          if (v === "*" || /modelbehavior/i.test(v)) applies = true;
        } else {
          groupHasAgent = false;
          if (!applies || !v) continue;
          if (k === "allow") r.allow.push(v); else if (k === "disallow") r.disallow.push(v);
        }
      }
    }
  } catch { /* unreachable robots.txt: treat as no rules */ }
  robotsCache.set(origin, r);
  return r;
}
async function allowed(url: string) {
  let u: URL; try { u = new URL(url); } catch { return false; }
  const r = await robots(u.origin);
  const path = u.pathname + u.search;
  const match = (rules: string[]) => Math.max(-1, ...rules.map((p) => {
    const re = new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    return re.test(path) ? p.length : -1;
  }));
  return match(r.disallow) <= match(r.allow);
}
async function fetchOk(url: string, timeout = 20000) {
  if (!(await allowed(url))) throw new Error(`robots.txt disallows ${url}`);
  return politeFetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeout) });
}

// ---- candidate discovery
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
  const seen = new Set<string>();
  return out.sort((a, b) => b.score - a.score)
    .map((c) => { try { return new URL(c.url.replace(/&amp;/g, "&"), base).href; } catch { return ""; } })
    .filter((u) => u && /^https?:/.test(u) && !seen.has(u) && seen.add(u));
}

// ---- image download, sniffing, dimensions
type Img = { buf: Buffer; ext: string; px: number | null }; // px: longest side for rasters, null for svg
const EXT: Record<string, string> = { "image/png": "png", "image/svg+xml": "svg", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/ico": "ico", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp" };

function sniff(b: Buffer): { ext: string; px: number | null } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { ext: "png", px: Math.max(b.readUInt32BE(16), b.readUInt32BE(20)) };
  if (b.length > 4 && b.readUInt32LE(0) === 0x00010000 || (b.length > 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0)) {
    const n = b.readUInt16LE(4); let m = 0;
    for (let i = 0; i < n && 6 + i * 16 + 2 <= b.length; i++) m = Math.max(m, b[6 + i * 16] || 256, b[7 + i * 16] || 256);
    return { ext: "ico", px: m };
  }
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const mk = b[i + 1];
      if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) return { ext: "jpg", px: Math.max(b.readUInt16BE(i + 5), b.readUInt16BE(i + 7)) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    return { ext: "jpg", px: null };
  }
  if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const t = b.toString("ascii", 12, 16);
    if (t === "VP8X") return { ext: "webp", px: Math.max(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)) };
    if (t === "VP8 ") return { ext: "webp", px: Math.max(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff) };
    if (t === "VP8L") { const v = b.readUInt32LE(21); return { ext: "webp", px: Math.max((v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1) }; }
    return { ext: "webp", px: null };
  }
  const head = b.subarray(0, 600).toString("utf8");
  if (/<svg[\s>]/i.test(head)) return { ext: "svg", px: null };
  return null;
}
function svgSafe(b: Buffer) {
  const s = b.toString("utf8");
  return !/<script/i.test(s) && !/\son[a-z]+\s*=/i.test(s) && !/javascript:/i.test(s) && !/<foreignObject/i.test(s);
}

async function download(url: string): Promise<Img | null> {
  try {
    const r = await fetchOk(url, 15000);
    const ct = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!r.ok || /html|json|text\/plain/.test(ct)) { await r.body?.cancel(); return null; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;
    const s = sniff(buf);
    if (!s) return null;
    // extension comes from the content-type when it names an image type; the sniffed type must agree on the family.
    const ext = EXT[ct] ?? s.ext;
    if (ext !== s.ext && !(ext === "ico" && s.ext === "png")) return null;
    if (ext === "svg" && !svgSafe(buf)) return null;
    return { buf, ext, px: s.px };
  } catch { return null; }
}

function store(id: string, img: Img) {
  for (const f of readdirSync(OUT)) if (f.startsWith(id + ".") && f.slice(id.length + 1).match(/^(png|svg|ico|jpg|webp)$/)) unlinkSync(OUT + f);
  writeFileSync(`${OUT}${id}.${img.ext}`, img.buf);
  return `/logos/${id}.${img.ext}`;
}

async function findLogo(site: string): Promise<{ img: Img; from: string } | null> {
  const res = await fetchOk(site);
  if (!res.ok) throw new Error(`homepage ${res.status}`);
  const html = await res.text();
  let small: { img: Img; from: string } | null = null;
  for (const c of candidates(html, res.url)) {
    const img = await download(c);
    if (!img) continue;
    if (img.px !== null && img.px < 32) { small ??= { img, from: c }; continue; }
    return { img, from: c };
  }
  return small;
}

// ---- main
let rows: { id: string; name: string; site: string | null; logo: string | null }[];
const sites = process.argv.flatMap((a, i) => (process.argv[i - 1] === "--site" ? [a.split("=") as [string, string]] : []));
if (sites.length) {
  const named = new Map(sites);
  rows = (await pool.query(`SELECT id, name, logo_url AS logo FROM nodes WHERE id = ANY($1) ORDER BY id`, [[...named.keys()]])).rows
    .map((r: any) => ({ ...r, site: named.get(r.id)! }));
} else if (localize) {
  rows = (await pool.query(
    `SELECT n.id, n.name, n.logo_url AS logo, (SELECT f.url FROM facts f WHERE f.node_id=n.id AND f.label='Website' ORDER BY f.id DESC LIMIT 1) AS site
     FROM nodes n WHERE n.type IN ${TYPES} AND n.logo_url ~ '^https?:' ORDER BY n.id`)).rows;
} else {
  rows = (await pool.query(
    `SELECT DISTINCT ON (n.id) n.id, n.name, f.url AS site, n.logo_url AS logo FROM nodes n JOIN facts f ON f.node_id=n.id AND f.label='Website'
     WHERE n.type IN ${TYPES} ${all ? "" : "AND n.logo_url IS NULL"} ORDER BY n.id, f.id DESC`)).rows;
}
rows = rows.filter((r) => !SKIP.has(r.id));

let found = 0;
for (const { id, name, site, logo } of rows) {
  try {
    let img: Img | null = null, from = "";
    if (localize && logo) {
      img = await download(logo);
      if (img && img.px !== null && img.px < 32) { const b = site ? await findLogo(site).catch(() => null) : null; if (b && (b.img.px === null || b.img.px >= 32)) { img = b.img; from = b.from; } }
      if (img && !from) from = logo;
    }
    if (!img && site) { const f = await findLogo(site); if (f) { img = f.img; from = f.from; } }
    if (!img) { console.warn(`${id}: no logo found${site ? " on " + site : " (no website)"}`); continue; }
    const local = store(id, img);
    if (localize && site) await pool.query(`UPDATE nodes SET logo_url=$2, logo_source_url=COALESCE(logo_source_url,$3) WHERE id=$1`, [id, local, site]);
    else await pool.query(`UPDATE nodes SET logo_url=$2, logo_source_url=$3 WHERE id=$1`, [id, local, site ?? from]);
    found++; console.log(`${name}: ${local} <- ${from} (${img.px ?? "svg"}px, ${createHash("sha1").update(img.buf).digest("hex").slice(0, 8)})`);
  } catch (e) { console.warn(`${id}: ${(e as Error).message}`); }
  await sleep(400);
}
console.log({ checked: rows.length, found });
await notifySite();
await pool.end();
