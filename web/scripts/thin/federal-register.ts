// Rules (executive orders, RFIs, notices): signing and publication dates, citation, issuing agency, orders revoked or
// amended, comment deadline and docket, from the Federal Register API (no key). Nodes whose source URL is a
// federalregister.gov document are covered; others are logged as gaps by the caller.
// Usage: tsx scripts/thin/federal-register.ts [--max-records 6]
import { begin, fact, q, pool, cachedGet, today } from "./lib.ts";

await begin();
const max = process.argv.includes("--max-records") ? Number(process.argv[process.argv.indexOf("--max-records") + 1]) : 6;
const nodes = await q<{ id: string; name: string; source_url: string; n: number }>(`
  SELECT n.id, n.name, n.source_url, (SELECT count(*)::int FROM facts f WHERE f.node_id=n.id) AS n
  FROM nodes n WHERE n.type='rule' AND n.source_url ILIKE '%federalregister.gov/documents/%'`);
const nice = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
let added = 0;
for (const n of nodes) {
  if (n.n >= max) continue;
  const num = n.source_url.match(/\/(\d{4}-\d{5})\//)?.[1];
  if (!num) continue;
  const body = await cachedGet(`https://www.federalregister.gov/api/v1/documents/${num}.json`, `fr/${num}.json`, 600);
  if (!body) { console.log("no FR record", n.id); continue; }
  const d = JSON.parse(body);
  const url = d.html_url as string;
  const agencies = (d.agencies ?? []).map((a: any) => a.name).filter(Boolean);
  const rows: { text: string; label?: string }[] = [];
  if (d.executive_order_number) rows.push({ text: `Executive Order ${d.executive_order_number}${d.signing_date ? `, signed ${nice(d.signing_date)}` : ""}.` });
  if (d.publication_date) rows.push({ text: `Published in the Federal Register on ${nice(d.publication_date)}${d.citation ? ` (${d.citation})` : ""}${d.type ? `, as a ${String(d.subtype ?? d.type).toLowerCase()}` : ""}.` });
  if (agencies.length) rows.push({ text: `Issued by ${agencies.join("; ")}.`  });
  const notes: string = d.executive_order_notes || d.disposition_notes || "";
  if (notes) rows.push({ text: `Federal Register note: ${notes.length > 300 ? notes.slice(0, 297).replace(/\s+\S*$/, "") + "…" : notes}` });
  if (d.comments_close_on) rows.push({ text: `Comments were due ${nice(d.comments_close_on)}${d.docket_ids?.length ? ` (docket ${d.docket_ids.join(", ")})` : ""}.` });
  if (d.page_length) rows.push({ text: `${d.page_length} ${d.page_length === 1 ? "page" : "pages"} in the Federal Register.` });
  for (const r of rows) if (await fact({ node: n.id, text: r.text, url, label: r.label })) added++;
}
console.log(`added ${added} facts across ${nodes.length} rule nodes (${today()})`);
await pool.end();
