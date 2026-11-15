// Links lawmaker nodes to bioguide and Wikidata IDs through the shared FEC candidate ID, using the public-domain
// unitedstates/congress-legislators dataset (https://github.com/unitedstates/congress-legislators). Deterministic: a shared FEC
// candidate ID is a strong ID; no name matching. Idempotent. Run: pnpm exec tsx scripts/pipelines/er/legislators.ts
import { pool, q } from "../../../src/lib/db.ts";
import { addExternalId } from "./ids-api.ts";

const FILES = ["legislators-current", "legislators-historical"];
const byFec = new Map<string, any>();
for (const f of FILES) {
  const res = await fetch(`https://unitedstates.github.io/congress-legislators/${f}.json`, { headers: { "User-Agent": "model-behavior-research/0.1 (local research project)" } });
  if (!res.ok) { console.warn(`${f}: HTTP ${res.status}`); continue; }
  for (const l of (await res.json()) as any[]) for (const fec of l.id?.fec ?? []) byFec.set(fec, l);
}
console.log(`legislator records indexed by FEC candidate ID: ${byFec.size}`);
const lm = await q<{ node_id: string; value: string }>(`SELECT node_id, value FROM entity_external_ids WHERE system='fec_candidate'`);
let b = 0, w = 0, hit = 0; const conflicts: string[] = [];
for (const r of lm) {
  const l = byFec.get(r.value); if (!l) continue; hit++;
  const [{ type }] = await q<{ type: string }>(`SELECT type FROM nodes WHERE id=$1`, [r.node_id]);
  void type;
  for (const [sys, val] of [["bioguide", l.id.bioguide], ["wikidata", l.id.wikidata]] as const) {
    if (!val) continue;
    const res = await addExternalId(r.node_id, sys, val, undefined, "er:legislators");
    if (res === "added") sys === "bioguide" ? b++ : w++; else if (typeof res === "object") conflicts.push(`${sys}:${val} for ${r.node_id} already on ${res.conflict}`);
  }
}
console.log(`lawmaker nodes matched via FEC candidate ID: ${hit}; bioguide added ${b}; wikidata added ${w}; conflicts ${conflicts.length}`);
for (const c of conflicts) console.log("  CONFLICT", c);
await pool.end();
