// Writes the names of people and organizations on the site to data/cache/claude/site-names.txt, for the finder brief.
import "../../../env.ts";
import { writeFileSync } from "node:fs";
import { pool, q } from "../../../../src/lib/db.ts";
const r = await q<any>(`SELECT name, type, descriptor FROM nodes WHERE type IN ('person','lawmaker','lab','nonprofit','think_tank','investor') ORDER BY type, name`);
writeFileSync(process.argv[2] ?? "../data/cache/claude/site-names.txt", r.map((n: any) => `${n.name} (${n.type}${n.descriptor ? `: ${String(n.descriptor).slice(0, 60)}` : ""})`).join("\n") + "\n");
console.log(r.length); await pool.end();
