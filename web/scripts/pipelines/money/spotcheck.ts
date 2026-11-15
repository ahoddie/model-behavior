// Spot-check hops against the original filing documents: sample hop lines (seeded), re-open the raw .fec file the line came from, find the line by
// transaction id with a fresh read (not the parser), and compare name, amount and date to what the hop says.
// NOTE: this checks us against the filing as filed. It is automated; a human check against the FEC website is still recommended for a subset.
//   tsx spotcheck.ts [n=60]
import "../../env.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO } from "../../env.ts";
import { q, pool } from "../../../src/lib/db.ts";
import { FEC_DIR } from "./fecfiles.ts";

const n = Number(process.argv[2] ?? 60);
const rows = await q<any>(`SELECT ht.hop_id, ht.amount::float8 amt, ht.tx_date::text d, x.transaction_id, x.file_number, x.name, x.sched, x.source_url::text url,
    h.hop_basis, coalesce(f.name,'Undisclosed donors') fn, t.name tn, h.chain_id
  FROM money_x_hop_txns ht JOIN money_x_fec_tx x ON x.id=ht.tx_id JOIN money_hops h ON h.id=ht.hop_id LEFT JOIN nodes f ON f.id=h.from_id JOIN nodes t ON t.id=h.to_id
  ORDER BY md5(ht.hop_id::text || ht.tx_id::text) LIMIT $1`, [n]);
const res: string[] = ["| # | Hop | Filing | Line | Doc says | Hop says | Result |", "|---|---|---|---|---|---|---|"];
let pass = 0;
for (const [i, r] of rows.entries()) {
  const raw = readFileSync(resolve(FEC_DIR, `${r.file_number}.fec`), "latin1").split(/\r?\n/).find((l) => l.split("\x1c")[2]?.replace(/"/g, "") === r.transaction_id);
  const f = raw?.split("\x1c") ?? [];
  const docAmt = Number(f[20]), docDate = (f[19] ?? "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
  const docName = ((f[6] ?? "").replace(/"/g, "") || `${(f[7] ?? "").replace(/"/g, "")}, ${(f[8] ?? "").replace(/"/g, "")}`).toLowerCase();
  const ok = !!raw && Math.abs(docAmt - r.amt) < 0.01 && docDate === r.d && docName.replace(/[^a-z]/g, "").slice(0, 8) === r.name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 8);
  if (ok) pass++;
  res.push(`| ${i + 1} | ${r.fn} → ${r.tn} (${r.hop_basis}) | ${r.file_number} | ${r.transaction_id} | ${docName} ${docAmt} ${docDate} | ${r.name} ${r.amt} ${r.d} | ${ok ? "match" : "MISMATCH"} |`);
}
writeFileSync(resolve(REPO, "data/eval/money/spotcheck.md"), `# Hop spot-check (workstream D)\n\n${pass}/${rows.length} sampled hop lines match the raw filing document (name, amount, date). Automated check against the .fec file; not a manual website check.\n\n${res.join("\n")}\n`);
console.log(`${pass}/${rows.length}`);
await pool.end();
