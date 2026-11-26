// Federal races: the candidates registered with the FEC for the seat, party, incumbency and campaign totals, from the
// FEC's bulk candidate files (cn = candidate master, weball = candidate summary). No key needed. Addresses are never read.
// Candidate pages and election pages on fec.gov are the source URLs. Usage: tsx scripts/thin/races-fec.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { begin, fact, q, pool, zipOnce, usd, title } from "./lib.ts";

await begin();
const dir = await zipOnce("https://www.fec.gov/files/bulk-downloads/2026/weball26.zip", "fec/weball26");
const cn = await zipOnce("https://www.fec.gov/files/bulk-downloads/2026/cn26.zip", "fec/cn26");
const master = new Map<string, { ici: string; status: string; yr: string }>();
for (const l of readFileSync(resolve(cn, "cn.txt"), "utf8").split("\n")) { const c = l.split("|"); if (c[0]) master.set(c[0], { ici: c[7], status: c[8], yr: c[3] }); }
type Cand = { id: string; name: string; party: string; ici: string; rec: number; disb: number; cash: number; end: string };
const byRace = new Map<string, Cand[]>();
const nm = (raw: string) => { const [last, first, suf] = raw.split(",").map((s) => s.trim()); return first ? `${title(first)} ${title(last)}${suf ? `, ${title(suf)}` : ""}` : title(raw); };
for (const l of readFileSync(resolve(dir, "weball26.txt"), "utf8").split("\n")) {
  const c = l.split("|"); if (!c[0]) continue;
  const m = master.get(c[0]); if (!m || m.status !== "C" || m.yr !== "2026") continue;
  const st = c[18].toLowerCase(), office = c[0][0];
  const key = office === "S" ? `race-2026-${st}-sen` : office === "H" ? `race-2026-${st}-${Number(c[19]) || "al"}` : null;
  if (!key) continue;
  (byRace.get(key) ?? byRace.set(key, []).get(key)!).push({ id: c[0], name: nm(c[1]), party: c[4], ici: c[2], rec: Number(c[5]) || 0, disb: Number(c[7]) || 0, cash: Number(c[10]) || 0, end: c.find((x) => /^\d\d\/\d\d\/\d{4}$/.test(x)) ?? "" });
}
const races = await q<{ id: string }>(`SELECT id FROM nodes WHERE type='race'`);
let added = 0; const missing: string[] = [];
const nice = (s: string) => { const m = s.match(/^(\d\d)\/(\d\d)\/(\d{4})$/); return m ? new Date(`${m[3]}-${m[1]}-${m[2]}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null; };
for (const { id } of races) {
  const cs = byRace.get(id);
  if (!cs?.length) { missing.push(id); continue; }
  const m = id.match(/^race-2026-([a-z]{2})-(sen|\d+)$/)!;
  const ST = m[1].toUpperCase();
  const page = m[2] === "sen" ? `https://www.fec.gov/data/elections/senate/${ST}/2026/` : `https://www.fec.gov/data/elections/house/${ST}/${m[2].padStart(2, "0")}/2026/`;
  cs.sort((a, b) => b.rec - a.rec);
  if (await fact({ node: id, text: `${cs.length} ${cs.length === 1 ? "candidate" : "candidates"} registered with the FEC for this seat in the 2026 cycle.`, url: page })) added++;
  for (const c of cs.slice(0, 6)) {
    const inc = c.ici === "I" ? ", incumbent" : c.ici === "O" ? ", open seat" : "";
    const t = `${c.name} (${c.party || "no party listed"}${inc}): raised ${usd(c.rec)}, spent ${usd(c.disb)}, cash on hand ${usd(c.cash)}${nice(c.end) ? `, through ${nice(c.end)}` : ""}.`;
    if (await fact({ node: id, text: t, url: `https://www.fec.gov/data/candidate/${c.id}/?cycle=2026` })) added++;
  }
}
console.log(`added ${added} facts; races with no FEC candidates: ${missing.join(", ") || "none"}`);
await pool.end();
