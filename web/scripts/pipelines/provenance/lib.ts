// Shared helpers for Workstream E (bill wording provenance). Raw texts are cached under data/cache/provenance/ (git-ignored) and never shown.
import "../../env.ts";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, q } from "../../../src/lib/db.ts";
import { politeFetch, sleep } from "../../lib/ingest.ts";
import { htmlToText } from "../../lib/text.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "../../../..");
export const CACHE = join(ROOT, "data/cache/provenance");
export const EVAL_DIR = join(ROOT, "data/eval/provenance");
export const sha1 = (s: string | Buffer) => createHash("sha1").update(s).digest("hex");
export { pool, q, sleep };

export function ensureDir(p: string) { mkdirSync(p, { recursive: true }); return p; }

// ---- robots.txt (very small parser: User-agent * disallow prefixes) -------------------------------------------------
const robots = new Map<string, string[]>();
export async function allowed(url: string): Promise<boolean> {
  const u = new URL(url);
  if (!robots.has(u.host)) {
    let rules: string[] = [];
    try {
      const r = await fetch(`${u.protocol}//${u.host}/robots.txt`, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "ModelBehavior-local-research/0.1" } });
      const t = r.ok && /text|plain/.test(r.headers.get("content-type") ?? "") ? await r.text() : "";
      let star = false;
      for (const line of t.split(/\r?\n/)) {
        const l = line.split("#")[0].trim();
        if (/^user-agent:/i.test(l)) star = /:\s*\*\s*$/.test(l);
        else if (star && /^disallow:/i.test(l)) { const p = l.replace(/^disallow:\s*/i, "").trim(); if (p) rules.push(p); }
      }
    } catch { rules = []; }
    robots.set(u.host, rules);
  }
  const target = u.pathname + u.search;
  return !robots.get(u.host)!.some((p) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")).test(target));
}

export type Fetched = { buf: Buffer; contentType: string; finalUrl: string };
export async function getBytes(url: string): Promise<Fetched | null> {
  if (!(await allowed(url))) { console.log(`  robots.txt disallows ${url}`); return null; }
  const res = await politeFetch(url, { redirect: "follow", signal: AbortSignal.timeout(90000) } as RequestInit);
  if (!res.ok) return null;
  return { buf: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "", finalUrl: res.url };
}

export function pdfToText(buf: Buffer): string {
  const tmp = join(ensureDir(join(CACHE, "tmp")), `${sha1(buf).slice(0, 12)}.pdf`);
  writeFileSync(tmp, buf);
  return execFileSync("python3", ["-I", join(HERE, "pdf2txt.py"), tmp], { maxBuffer: 1 << 28 }).toString("utf8");
}

// Strip the line numbers legislatures print in the margin and other page furniture, then collapse whitespace.
export function cleanLegislative(t: string): string {
  return t.replace(/\r/g, "")
    .split("\n").map((l) => l.replace(/^\s*\d{1,2}\s{1,3}(?=\S)/, "").replace(/\s+\d{1,2}\s*$/, (m) => (/^\s+\d{1,2}\s*$/.test(m) && l.length < 12 ? "" : m)))
    .filter((l) => !/^\s*(\d{1,3}|Page \d+( of \d+)?|LBD\d+[-\d]*|EXPLANATION--.*|\[.*\])\s*$/i.test(l))
    .join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function toText(f: Fetched, how: "legislative" | "html" | "xml" | "auto" = "auto"): string {
  const isPdf = /pdf/i.test(f.contentType) || f.buf.subarray(0, 4).toString() === "%PDF";
  if (isPdf) return cleanLegislative(pdfToText(f.buf));
  const s = f.buf.toString("utf8");
  if (how === "xml" || /xml/i.test(f.contentType)) return cleanLegislative(decodeEntities(s.replace(/<[^>]+>/g, "\n")));
  if (/<pre[\s>]/i.test(s) && /govinfo|\.gov\/content\/pkg/i.test(f.finalUrl)) return cleanLegislative(decodeEntities(s.replace(/<[^>]+>/g, "")));
  return cleanLegislative(htmlToText(s));
}
export const decodeEntities = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&[a-z]+;/g, " ");

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
export function firstDate(t: string): string | null {
  const num = t.slice(0, 4000).match(/\bIntroduced\s+(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/);
  if (num) return `${num[3]}-${num[1].padStart(2, "0")}-${num[2].padStart(2, "0")}`;
  const m = t.slice(0, 3000).match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d\d)\b/);
  if (!m) return null;
  return `${m[3]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

export type NewText = {
  billNodeId?: string | null; version?: string | null; sourceKind: string; title: string; authorId?: string | null; authorName?: string | null;
  date: string; url: string; fetchUrl: string; text: string; via?: "direct" | "wayback"; note?: string | null;
};
// Stores the raw text in the cache and a metadata row. Returns the id, or null if the text is too short to be useful.
export async function saveText(t: NewText): Promise<number | null> {
  const words = t.text.split(/\s+/).filter(Boolean).length;
  if (words < 80) return null;
  const hash = sha1(t.text);
  const rel = `texts/${hash.slice(0, 2)}/${hash}.txt`;
  ensureDir(dirname(join(CACHE, rel)));
  writeFileSync(join(CACHE, rel), t.text);
  const r = await pool.query(
    `INSERT INTO prov_texts (bill_node_id, version, source_kind, title, author_id, author_name, text_date, url, fetch_url, text_path, text_sha1, n_words, fetched_via, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (fetch_url) DO UPDATE SET text_path=EXCLUDED.text_path, text_sha1=EXCLUDED.text_sha1, n_words=EXCLUDED.n_words, title=EXCLUDED.title,
       text_date=EXCLUDED.text_date, version=EXCLUDED.version, author_id=COALESCE(EXCLUDED.author_id, prov_texts.author_id)
     RETURNING id`,
    [t.billNodeId ?? null, t.version ?? null, t.sourceKind, t.title, t.authorId ?? null, t.authorName ?? null, t.date, t.url, t.fetchUrl, rel, hash, words, t.via ?? "direct", t.note ?? null]);
  return r.rows[0].id;
}
export const readText = (rel: string) => readFileSync(join(CACHE, rel), "utf8");

export async function logGap(line: string) {
  const f = join(ROOT, "data/gaps.md");
  const cur = existsSync(f) ? readFileSync(f, "utf8") : "";
  if (cur.includes(line)) return;
  writeFileSync(f, cur.replace(/\n*$/, "\n") + line + "\n");
}
