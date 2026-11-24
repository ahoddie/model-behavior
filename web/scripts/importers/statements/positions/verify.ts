// Checks that a quote really appears at its link: fetches the page (HTML or PDF), reduces page and quote to letters and digits,
// and looks for the quote inside the page. An ellipsis in the quote splits it into parts that must each appear, in order.
// Nothing a model says about a source is trusted: a finding whose quote is not found here never shows without a person's check.
// Results are cached in data/cache/claude/verify.json (keyed by url and quote).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const CACHE = join(dirname(fileURLToPath(import.meta.url)), "../../../../../data/cache/claude/verify.json");
const cache: Record<string, { ok: boolean; note: string }> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
const save = () => { mkdirSync(dirname(CACHE), { recursive: true }); writeFileSync(CACHE, JSON.stringify(cache)); };
const pages = new Map<string, Promise<string | { error: string }>>();

export const fold = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…" };
export const htmlText = (h: string) => h.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-z]+);/gi, (m, e) => ENT[e.toLowerCase()] ?? m);

function pdfText(buf: Buffer) {
  const f = join(tmpdir(), `pos-${createHash("md5").update(buf).digest("hex")}.pdf`);
  writeFileSync(f, buf);
  try {
    return execFileSync("python3", ["-I", "-c", "import sys,pypdf;print('\\n'.join((p.extract_text() or '') for p in pypdf.PdfReader(sys.argv[1]).pages))", f], { maxBuffer: 1 << 28, timeout: 120000 }).toString();
  } finally { rmSync(f, { force: true }); }
}

async function page(url: string): Promise<string | { error: string }> {
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30000), headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8" } });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    const pdf = (r.headers.get("content-type") ?? "").includes("pdf") || buf.subarray(0, 5).toString() === "%PDF-";
    return pdf ? pdfText(buf) : htmlText(buf.toString("utf8"));
  } catch (e: any) { return { error: String(e?.cause?.code ?? e?.name ?? e).slice(0, 60) }; }
}

export function quoteIn(quote: string, text: string): boolean {
  const hay = fold(text);
  const parts = quote.split(/\.{3}|…|\[[^\]]*\]/).map(fold).filter((p) => p.length >= 12);
  if (!parts.length) return false;
  let at = 0;
  for (const p of parts) { const i = hay.indexOf(p, at); if (i < 0) return false; at = i + p.length; }
  return true;
}

export async function verify(url: string, quote: string): Promise<{ ok: boolean; note: string }> {
  const key = createHash("sha256").update(`${url}|${quote}`).digest("hex").slice(0, 20);
  if (cache[key]) return cache[key];
  if (!pages.has(url)) pages.set(url, page(url));
  const p = await pages.get(url)!;
  const res = typeof p === "string"
    ? (quoteIn(quote, p) ? { ok: true, note: "found word for word" } : { ok: false, note: p.length < 2000 ? "page text too short to check (likely needs a browser)" : "not found in page text" })
    : { ok: false, note: `could not fetch: ${p.error}` };
  // A failed fetch is not cached, so a later run can try again.
  if (typeof p === "string") { cache[key] = res; save(); }
  return res;
}
