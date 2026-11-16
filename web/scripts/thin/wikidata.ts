// Agencies, nonprofits, funders, think tanks and labs with few records: founding date, headquarters, parent body and
// official website from Wikidata, and its short description. A node is matched only on an exact name match against a
// Wikidata item whose description fits an organization (no people, no disambiguation pages). Labeled facts are added
// only where the profile lacks that label. Source URL: the Wikidata item page.
// Usage: tsx scripts/thin/wikidata.ts [--max-records 3] [--dry]
import { begin, fact, q, pool, cachedGet, sleep } from "./lib.ts";
import { thinRows } from "../find-thin.ts";

await begin();
const max = process.argv.includes("--max-records") ? Number(process.argv[process.argv.indexOf("--max-records") + 1]) : 3;
const dry = process.argv.includes("--dry");
const TYPES = new Set(["agency", "nonprofit", "funder", "think_tank", "lab", "investor"]);
const thin = (await thinRows()).filter((r) => TYPES.has(r.type) && r.records <= max);
const info = new Map((await q<{ id: string; name: string; type: string }>(`SELECT id, name, type FROM nodes`)).map((n) => [n.id, n]));
const have = new Set((await q<{ node_id: string; label: string }>(`SELECT node_id, label FROM facts WHERE label IS NOT NULL`)).map((r) => `${r.node_id}|${r.label}`));
const norm = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/&/g, " and ").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").replace(/\bdepartment of defense\b/, "department of defense").trim();
const ORG = /agency|administration|bureau|office|commission|department|committee|council|board|institute|foundation|organi[sz]ation|nonprofit|non-profit|think tank|laboratory|company|fund|trust|unit|service|authority|activity/i;
const nice = (t: string) => { const m = t.match(/^\+(\d{4})-(\d\d)-(\d\d)/); if (!m) return null; return m[2] === "00" ? m[1] : m[3] === "00" ? `${new Date(`${m[1]}-${m[2]}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}` : new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }); };
const get = async (u: string, name: string) => { const b = await cachedGet(u, `wd/${name}.json`, 700); return b ? JSON.parse(b) : null; };
let added = 0;
for (const r of thin) {
  const node = info.get(r.id)!;
  const s = await get(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=5&search=${encodeURIComponent(node.name.replace(/\([^)]*\)/g, "").trim())}`, `s-${r.id}`);
  const want = norm(node.name);
  const hit = (s?.search ?? []).find((x: any) => norm(x.label ?? "") === want && ORG.test(x.description ?? ""));
  if (!hit) { console.log("no exact org match:", r.id); continue; }
  const e = (await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&ids=${hit.id}&props=claims|descriptions&languages=en`, `e-${hit.id}`))?.entities?.[hit.id];
  if (!e) continue;
  const url = `https://www.wikidata.org/wiki/${hit.id}`;
  const claim = (p: string) => e.claims?.[p]?.find((c: any) => c.rank !== "deprecated")?.mainsnak?.datavalue?.value;
  const labelOf = async (qid: string) => (await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&ids=${qid}&props=labels&languages=en`, `l-${qid}`))?.entities?.[qid]?.labels?.en?.value as string | undefined;
  const out: { text: string; label?: string }[] = [];
  const desc = e.descriptions?.en?.value;
  if (desc) out.push({ text: `Wikidata describes it as: ${desc}.` });
  const inc = claim("P571"); if (inc?.time && !have.has(`${r.id}|Founded`)) { const t = nice(inc.time); if (t) out.push({ text: t, label: "Founded" }); }
  const hq = claim("P159"); if (hq?.id && !have.has(`${r.id}|Headquarters`)) { const l = await labelOf(hq.id); if (l) out.push({ text: l, label: "Headquarters" }); }
  const par = claim("P749") ?? claim("P361"); if (par?.id && !have.has(`${r.id}|Parent`)) { const l = await labelOf(par.id); if (l) out.push({ text: l, label: "Parent" }); }
  const web = claim("P856"); if (typeof web === "string" && /^https?:\/\//.test(web) && !have.has(`${r.id}|Website`)) out.push({ text: web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), label: "Website" });
  for (const o of out) { if (dry) console.log(r.id, o); else if (await fact({ node: r.id, text: o.text, url: o.label === "Website" ? web : url, label: o.label })) added++; }
  await sleep(200);
}
console.log(`added ${added} facts`);
await pool.end();
