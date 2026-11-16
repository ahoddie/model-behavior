// Federal bills: sponsor, cosponsor count, committees, policy area, status and recent actions, from the GPO's public
// BILLSTATUS XML (govinfo.gov/bulkdata/BILLSTATUS, no key). The source URL on each fact is the Congress.gov bill page.
// Usage: tsx scripts/thin/congress-bills.ts [--max-records 8]
import { begin, fact, q, pool, cachedGet } from "./lib.ts";

await begin();
const max = process.argv.includes("--max-records") ? Number(process.argv[process.argv.indexOf("--max-records") + 1]) : 8;
const nodes = await q<{ id: string; n: number }>(`SELECT n.id, (SELECT count(*)::int FROM facts f WHERE f.node_id=n.id) n FROM nodes n WHERE n.type='bill' AND n.id ~ '^us-\\d+-(hr|s|hjres|sjres)\\d+$'`);
const nice = (d: string) => new Date(d.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const tag = (s: string, t: string) => s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]?.trim() ?? null;
const items = (s: string | null) => (s ? [...s.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]) : []);
const clean = (t: string) => t.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
let added = 0;
for (const n of nodes) {
  if (n.n >= max) continue;
  const m = n.id.match(/^us-(\d+)-(hr|s|hjres|sjres)(\d+)$/)!;
  const xml = await cachedGet(`https://www.govinfo.gov/bulkdata/BILLSTATUS/${m[1]}/${m[2]}/BILLSTATUS-${m[1]}${m[2]}${m[3]}.xml`, `govinfo/${n.id}.xml`, 1500);
  if (!xml) { console.log("no status file", n.id); continue; }
  const bill = tag(xml, "bill")!;
  const url = tag(bill, "legislationUrl") ?? `https://www.congress.gov/bill/${m[1]}th-congress/${m[2] === "s" ? "senate-bill" : "house-bill"}/${m[3]}`;
  const rows: string[] = [];
  const sp = items(tag(bill, "sponsors"))[0];
  const intro = tag(bill, "introducedDate");
  if (sp) rows.push(`Introduced${intro ? ` ${nice(intro)}` : ""} by ${clean(tag(sp, "fullName") ?? "")}.`);
  const cos = items(tag(bill, "cosponsors")).length;
  if (cos) rows.push(`${cos} ${cos === 1 ? "cosponsor" : "cosponsors"} on record.`);
  const cmtes = [...new Set(items(tag(bill, "committees")).map((c) => tag(c, "name")).filter(Boolean))] as string[];
  if (cmtes.length) rows.push(`Committees: ${cmtes.map(clean).join("; ")}.`);
  const area = tag(tag(bill, "policyArea") ?? "", "name");
  if (area) rows.push(`Policy area (Congressional Research Service): ${clean(area)}.`);
  const acts = items(tag(bill, "actions")).map((a) => ({ d: tag(a, "actionDate"), t: clean(tag(a, "text") ?? "") })).filter((a) => a.d && a.t);
  const short = (t: string) => (t.length > 260 ? t.slice(0, 257).replace(/\s+\S*$/, "") + "…" : t);
  if (acts[0]) rows.push(`Latest action, ${nice(acts[0].d!)}: ${short(acts[0].t)}`);
  for (const a of acts.slice(1, 3)) rows.push(`Earlier action, ${nice(a.d!)}: ${short(a.t)}`);
  for (const text of rows) if (await fact({ node: n.id, text, url })) added++;
}
console.log(`added ${added} facts across ${nodes.length} federal bill nodes`);
await pool.end();
