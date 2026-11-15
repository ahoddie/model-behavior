// Fetch a page and reduce it to readable text; run extraction; store pending feed items.
import { q } from "../../src/lib/db.ts";
import { extract } from "./extract.ts";
import { insertFeed, politeFetch } from "./ingest.ts";

export function htmlToText(html: string): string {
  const body = html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
  return body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<\/(p|div|h\d|li|br)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&#8217;/g, "’").replace(/&ldquo;|&#8220;/g, "“").replace(/&rdquo;|&#8221;/g, "”")
    .replace(/&[a-z#0-9]+;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

export async function fetchText(url: string): Promise<{ text: string; finalUrl: string } | null> {
  try {
    const res = await politeFetch(url, { redirect: "follow", signal: AbortSignal.timeout(30000) } as RequestInit);
    if (!res.ok || !/html|text/.test(res.headers.get("content-type") ?? "")) return null;
    return { text: htmlToText(await res.text()), finalUrl: res.url };
  } catch { return null; }
}

let cache: { cands: { id: string; name: string }[]; targets: { id: string; name: string }[] } | null = null;
export async function candidates() {
  cache ??= {
    cands: await q(`SELECT id, name FROM nodes WHERE type NOT IN ('bill','race','rule','lawmaker','agency')`),
    targets: await q(`SELECT id, name FROM nodes WHERE type IN ('bill','race','rule')`),
  };
  return cache;
}

/** Extract statements from a document and store them as pending. `only` restricts speakers (e.g. a post's author). */
export async function ingestDocument(opts: { text: string; url: string; date: string; platform: string; kind: string; only?: string[]; origin: string }) {
  const { cands, targets } = await candidates();
  // A speaker is a candidate only if the document names them in full; a last word like "AI" matches almost anything.
  const pool = opts.only ? cands.filter((c) => opts.only!.includes(c.id)) : cands.filter((c) => opts.text.includes(c.name.replace(/\s*\(.*?\)/g, "").trim()));
  if (!pool.length) return 0;
  let n = 0;
  for (const x of await extract(opts.text, pool, targets)) {
    if (await insertFeed({ node: x.node, date: opts.date, kind: opts.kind, excerpt: x.excerpt, summary: x.summary, url: opts.url, platform: opts.platform,
      issues: x.issues, stance: x.stance, target: x.target }, opts.origin, "pending")) n++;
  }
  return n;
}

export const POLICY_TERMS = /\b(regulat|legislat|congress|senate|bill|SB ?\d+|AB ?\d+|RAISE Act|preempt|moratorium|policy|lawmaker|governor|executive order|export control|safety institute|super PAC|lobby|federal|state law)/i;
