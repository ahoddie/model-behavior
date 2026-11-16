// Lawmakers: current office, party, first and current term and official website from the congress-legislators
// dataset (a public-domain compilation of the Congress Biographical Directory), plus the FEC candidate summary.
// Matches on bioguide or FEC candidate id only, never on name. Source URLs: bioguide.congress.gov and fec.gov.
// Usage: tsx scripts/thin/lawmakers.ts [--max-records 6]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { begin, fact, q, pool, cachedGet, zipOnce, usd } from "./lib.ts";

await begin();
const max = process.argv.includes("--max-records") ? Number(process.argv[process.argv.indexOf("--max-records") + 1]) : 6;
const body = await cachedGet("https://unitedstates.github.io/congress-legislators/legislators-current.json", "legislators-current.json", 500);
if (!body) throw new Error("no legislators file");
const leg: any[] = JSON.parse(body);
const byBio = new Map(leg.map((l) => [l.id.bioguide, l]));
const byFec = new Map(leg.flatMap((l) => (l.id.fec ?? []).map((f: string) => [f, l] as const)));
const nodes = await q<{ id: string; name: string; fec: string | null; bio: string | null; n: number }>(`
  SELECT n.id, n.name, n.external_ids->>'fec' fec,
    coalesce(n.external_ids->>'bioguide', (SELECT value FROM entity_external_ids e WHERE e.node_id=n.id AND e.system='bioguide' LIMIT 1)) bio,
    (SELECT count(*)::int FROM facts f WHERE f.node_id=n.id) n
  FROM nodes n WHERE n.type='lawmaker'`);
const have = new Set((await q<{ node_id: string; label: string }>(`SELECT node_id, label FROM facts WHERE label IS NOT NULL`)).map((r) => `${r.node_id}|${r.label}`));
const weball = await zipOnce("https://www.fec.gov/files/bulk-downloads/2026/weball26.zip", "fec/weball26");
const cand = new Map(readFileSync(resolve(weball, "weball26.txt"), "utf8").split("\n").map((l) => l.split("|")).filter((c) => c[0]).map((c) => [c[0], c]));
const PARTY: Record<string, string> = { Republican: "Republican", Democrat: "Democratic", Independent: "Independent" };
const nice = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
let added = 0;
for (const n of nodes) {
  if (n.n >= max) continue;
  const l = (n.bio && byBio.get(n.bio)) || (n.fec && byFec.get(n.fec)) || null;
  if (l) {
    const url = `https://bioguide.congress.gov/search/bio/${l.id.bioguide}`;
    const t = l.terms[l.terms.length - 1], first = l.terms[0];
    const chamber = t.type === "sen" ? "Senator" : "Representative";
    const seat = t.type === "sen" ? t.state : `${t.state}-${t.district === 0 ? "at large" : t.district}`;
    if (!have.has(`${n.id}|Office`) && await fact({ node: n.id, text: `U.S. ${chamber}, ${seat}`, url, label: "Office" })) added++;
    if (!have.has(`${n.id}|Party`) && PARTY[t.party] && await fact({ node: n.id, text: PARTY[t.party], url, label: "Party" })) added++;
    if (await fact({ node: n.id, text: `Current term began ${nice(t.start)} and runs to ${nice(t.end)}. First took federal office on ${nice(first.start)}${first.type !== t.type ? ` (as a ${first.type === "sen" ? "Senator" : "Representative"})` : ""}.`, url })) added++;
    if (!have.has(`${n.id}|Website`) && t.url && await fact({ node: n.id, text: t.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), url: t.url, label: "Website" })) added++;
  }
  const c = n.fec && cand.get(n.fec);
  if (c) {
    const num = (i: number) => Number(c[i]) || 0;
    const end = c.find((x) => /^\d\d\/\d\d\/\d{4}$/.test(x));
    const when = end ? `, through ${nice(`${end.slice(6)}-${end.slice(0, 2)}-${end.slice(3, 5)}`)}` : "";
    if (num(5) || num(7)) if (await fact({ node: n.id, text: `2026 cycle campaign committee: raised ${usd(num(5))}, spent ${usd(num(7))}, cash on hand ${usd(num(10))}${when}.`, url: `https://www.fec.gov/data/candidate/${n.fec}/?cycle=2026` })) added++;
  }
}
console.log(`added ${added} facts`);
await pool.end();
