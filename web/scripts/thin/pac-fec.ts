// PACs: committee type, totals by cycle and top disbursements, from the FEC's bulk files (no API key, no rate limit).
// cm = committee master, webk = PAC summary, oppexp = operating expenditures. Street addresses are never read into a row.
// Individual payees ("LAST, FIRST") are skipped. Usage: tsx scripts/thin/pac-fec.ts [--only <node id>]
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { begin, fact, filing, q, pool, zipOnce, usd, title } from "./lib.ts";

const CYCLES = [2022, 2024, 2026];
const TYPES: Record<string, string> = { O: "Super PAC (independent expenditure-only)", V: "Hybrid PAC (with non-contribution account)", W: "Hybrid PAC (with non-contribution account)",
  N: "PAC, nonqualified", Q: "PAC, qualified", U: "Single-candidate independent expenditure committee", X: "Party committee, nonqualified", Y: "Party committee, qualified", D: "Delegate committee", I: "Independent expenditor (person or group)" };
const SHORT: Record<string, string> = { O: "Super PAC", V: "Hybrid PAC", W: "Hybrid PAC" };
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
await begin();

const nodes = await q<{ id: string; name: string; fec: string }>(`
  SELECT n.id, n.name, coalesce(n.external_ids->>'fec', (SELECT value FROM entity_external_ids e WHERE e.node_id=n.id AND e.system IN ('fec','fec_committee') LIMIT 1)) AS fec
  FROM nodes n WHERE n.type='pac' ${only ? "AND n.id=$1" : ""}`, only ? [only] : []);
const byFec = new Map(nodes.filter((n) => n.fec && /^C\d{8}$/.test(n.fec)).map((n) => [n.fec, n]));
console.log(`${byFec.size} PACs with FEC ids`);
const hasLabel = new Set((await q<{ node_id: string; label: string }>(`SELECT node_id, label FROM facts WHERE label IN ('Type','Leader') AND node_id IN (SELECT id FROM nodes WHERE type='pac')`)).map((r) => `${r.node_id}|${r.label}`));

const money = (s: string) => Number(s) || 0;
const cdate = (s: string) => { const m = s.match(/^(\d\d)\/(\d\d)\/(\d{4})$/); return m ? `${m[3]}-${m[1]}-${m[2]}` : null; };
const nice = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
let nFacts = 0, nFilings = 0;

for (const y of CYCLES) {
  const yy = String(y).slice(2);
  const dir = await zipOnce(`https://www.fec.gov/files/bulk-downloads/${y}/webk${yy}.zip`, `fec/webk${yy}`);
  const cmDir = await zipOnce(`https://www.fec.gov/files/bulk-downloads/${y}/cm${yy}.zip`, `fec/cm${yy}`);
  // Committee master (latest cycle only): type code and treasurer (name only, no address).
  if (y === CYCLES[CYCLES.length - 1]) {
    for (const line of readFileSync(resolve(cmDir, "cm.txt"), "utf8").split("\n")) {
      const c = line.split("|"); const n = byFec.get(c[0]); if (!n) continue;
      const code = c[9]; const url = `https://www.fec.gov/data/committee/${c[0]}/`;
      if (TYPES[code] && !hasLabel.has(`${n.id}|Type`)) { if (await fact({ node: n.id, text: SHORT[code] ?? TYPES[code], url, label: "Type" })) nFacts++; }
      else if (TYPES[code]) { if (await fact({ node: n.id, text: `FEC committee type: ${TYPES[code]} (code ${code}).`, url })) nFacts++; }
      const t = c[2]?.trim();
      if (t && !hasLabel.has(`${n.id}|Leader`)) {
        const [last, first] = t.replace(/\s+(MR|MS|MRS|DR|HON)\.?$/i, "").split(",").map((s) => s.trim());
        if (first && last && await fact({ node: n.id, text: `${title(first)} ${title(last)} (Treasurer)`, url: `${url}tab/about-committee/`, label: "Leader" })) nFacts++;
      }
    }
  }
  for (const line of readFileSync(resolve(dir, `webk${yy}.txt`), "utf8").split("\n")) {
    const c = line.split("|"); const n = byFec.get(c[0]); if (!n) continue;
    const [rec, disb, cash, ie, toCmte] = [money(c[5]), money(c[12]), money(c[19]), money(c[24]), money(c[22])];
    if (!rec && !disb) continue;
    const end = cdate(c[26] ?? "");
    const parts = [rec && `raised ${usd(rec)}`, disb && `spent ${usd(disb)}`, ie && `of which independent expenditures ${usd(ie)}`, toCmte && `contributions to other committees ${usd(toCmte)}`, `cash on hand at the end ${usd(cash)}`].filter(Boolean);
    if (await fact({ node: n.id, text: `${y - 1}–${y} election cycle${end ? `, reported through ${nice(end)}` : ""}: ${parts.join("; ")}.`, url: `https://www.fec.gov/data/committee/${c[0]}/?cycle=${y}` })) nFacts++;
  }
  // Top disbursements of $1,000 or more, organizations only.
  const od = await zipOnce(`https://www.fec.gov/files/bulk-downloads/${y}/oppexp${yy}.zip`, `fec/oppexp${yy}`);
  const best = new Map<string, any[]>();
  const rl = createInterface({ input: createReadStream(resolve(od, `oppexp.txt`)), crlfDelay: Infinity });
  for await (const line of rl) {
    const c = line.split("|"); const n = byFec.get(c[0]); if (!n) continue;
    const amt = money(c[13]); const payee = (c[8] ?? "").trim();
    if (amt < 1000 || !payee || payee.includes(",") || c[18] === "X") continue; // memo lines and individuals
    const d = best.get(n.id) ?? []; d.push({ payee, amt, date: c[12], purpose: (c[15] ?? "").trim(), cat: (c[17] ?? "").trim(), fec: c[0], tran: c[23] }); best.set(n.id, d);
  }
  for (const [id, rows] of best) {
    const seen = new Set<string>();
    for (const r of rows.sort((a, b) => b.amt - a.amt)) {
      const k = r.payee; if (seen.has(k)) continue; seen.add(k); if (seen.size > 5) break;
      const m = r.date.match(/^(\d\d)\/(\d\d)\/(\d{4})$/);
      const ok = await filing({ node: id, filing_type: "FEC", period: String(y), filed_date: m ? `${m[3]}-${m[1]}-${m[2]}` : null, amount: r.amt, issues: [],
        description: `Operating expenditure to ${title(r.payee)}${r.purpose ? `: ${title(r.purpose)}` : ""}${r.cat ? ` (${title(r.cat)})` : ""}.`,
        url: `https://www.fec.gov/data/disbursements/?data_type=processed&committee_id=${r.fec}&two_year_transaction_period=${y}&recipient_name=${encodeURIComponent(r.payee)}&min_amount=1000`, filing_id: r.tran || null });
      if (ok) nFilings++;
    }
  }
}
console.log(`added ${nFacts} facts, ${nFilings} filings`);
await pool.end();
