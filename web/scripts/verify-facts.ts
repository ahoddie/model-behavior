// Checks profile facts against the pages they cite before they load.
// For each fact: fetch the URL; pass if most of the fact's distinctive terms (names, years, numbers) appear in the page text.
// Failing facts move to the file's "held" array, which the loader ignores, with a reason. Usage: tsx scripts/verify-facts.ts data/research/profiles-*.json
import "./env.ts";
import fs from "node:fs";
import { politeFetch, sleep } from "./lib/ingest.ts";

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'").replace(/\s+/g, " ");
const STOP = new Set(["previously", "founded", "co-founded", "director", "president", "senior", "former", "member", "about", "since", "with", "from", "and", "the", "for"]);
// Terms worth checking: capitalized words, numbers/years, handles. Generic words are skipped.
function terms(t: string): string[] {
  const out = new Set<string>();
  for (const m of t.matchAll(/@?[A-Z][\w.&-]{2,}|\b\d{4}\b|\$?\d[\d.,]*[MBK]?\b|C\d{8}|\d{2}-\d{7}/g)) {
    const w = norm(m[0]).replace(/^\$/, "").replace(/[.,]$/, "");
    if (w.length >= 3 && !STOP.has(w)) out.add(w);
  }
  return [...out];
}

const cache = new Map<string, string | null>();
async function page(url: string) {
  if (!cache.has(url)) {
    let txt: string | null = null;
    // Raw HTML (entities decoded), so both visible text and link targets such as x.com/<handle> can be matched.
    try {
      const r = await politeFetch(url, { redirect: "follow", signal: AbortSignal.timeout(30000) });
      if (r.ok) txt = norm((await r.text()).replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;/g, "'").replace(/&nbsp;/g, " ").replace(/<[^>]+?>/g, (t) => (/href=/.test(t) ? t : " ")));
    } catch { txt = null; }
    cache.set(url, txt); await sleep(new URL(url).hostname.endsWith("fec.gov") ? 1500 : 700);
  }
  return cache.get(url)!;
}

for (const file of process.argv.slice(2)) {
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  // Re-check earlier holds too, except identity problems, which no page fetch can settle.
  const fixed = (d.held ?? []).filter((h: any) => /inferred|identity/.test(h.reason));
  const todo = [...(d.facts ?? []), ...(d.held ?? []).filter((h: any) => !fixed.includes(h)).map(({ reason, ...f }: any) => f)];
  const keep: any[] = [], held: any[] = [...fixed], socials: any[] = [];
  for (const f of todo) {
    if (f.label === "Website") { // the homepage itself is the source; just confirm it loads
      if (await page(f.url)) keep.push(f); else held.push({ ...f, reason: "homepage did not load" });
      continue;
    }
    if (f.label === "Social") { socials.push(f); continue; }
    const txt = await page(f.url);
    if (!txt) { held.push({ ...f, reason: "page did not load (blocked or dead)" }); continue; }
    const ts = terms(f.text);
    if (f.label === "Type" && ts.length === 0) { keep.push(f); continue; } // short characterization; the page loaded
    const hit = ts.filter((t) => txt.includes(t));
    const ratio = ts.length ? hit.length / ts.length : txt.includes(norm(f.text)) ? 1 : 0;
    if (ratio >= 0.6) keep.push(f);
    else held.push({ ...f, reason: `only ${hit.length}/${ts.length} key terms found on page (missing: ${ts.filter((t) => !hit.includes(t)).join(", ")})` });
  }
  // A social handle counts only if it appears on another page cited for the same node (bio page, homepage).
  for (const f of socials) {
    const h = norm((f.text.match(/@([\w.-]+)/)?.[1] ?? f.url.replace(/\/$/, "").split("/").pop() ?? ""));
    const pages = await Promise.all(keep.filter((k) => k.node === f.node && k.url !== f.url).map((k) => page(k.url)));
    if (h && pages.some((t) => t && (t.includes("x.com/" + h) || t.includes("twitter.com/" + h) || t.includes("@" + h) || t.includes("bsky.app/profile/" + h))))
      keep.push(f);
    else held.push({ ...f, reason: "handle not found on another cited page for this actor" });
  }
  d.facts = keep; d.held = held;
  fs.writeFileSync(file, JSON.stringify(d, null, 2));
  console.log(file, { kept: keep.length, held: held.length });
}
