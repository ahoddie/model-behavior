// Moves legacy nodes.external_ids into entity_external_ids / entity_aliases (with source URLs). Idempotent. Never modifies nodes.
// An ID that already belongs to a different node is reported as a duplicate signal and never overwritten.
import { pool, q } from "../../../src/lib/db.ts";
import { addAlias, addExternalId } from "./ids-api.ts";
import { legacyToSystems } from "./profiles.ts";

const nodes = await q<{ id: string; type: string; name: string; external_ids: any; source_url: string }>(`SELECT id,type,name,external_ids,source_url FROM nodes ORDER BY id`);
let ids = 0, aliases = 0; const conflicts: string[] = [];
for (const n of nodes) {
  for (const [k, v] of Object.entries(n.external_ids ?? {})) for (const m of legacyToSystems(n.type, k, v)) {
    if (m.system) {
      const r = await addExternalId(n.id, m.system, m.value, undefined, "er:seed");
      if (r === "added") ids++; else if (typeof r === "object") conflicts.push(`${m.system}:${m.value} on ${n.id} already belongs to ${r.conflict}`);
    } else if (m.handle) {
      const url = k === "x" ? `https://x.com/${m.handle}` : `https://bsky.app/profile/${m.handle}`;
      if (await addAlias(n.id, m.handle, "handle", url, "er:seed")) aliases++;
    }
  }
  // a name without its trailing parenthetical is an alias ("Federal Trade Commission (FTC)" -> "Federal Trade Commission", "FTC")
  const bare = n.name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const paren = n.name.match(/\(([^)]+)\)\s*$/)?.[1];
  if (bare && bare !== n.name && (await addAlias(n.id, bare, "name", n.source_url, "er:seed"))) aliases++;
  if (paren && /^[A-Za-z0-9 .&-]{2,12}$/.test(paren) && !/^now |^super/i.test(paren) && (await addAlias(n.id, paren, "name", n.source_url, "er:seed"))) aliases++;
}
console.log(`external ids added: ${ids}, aliases added: ${aliases}, conflicts: ${conflicts.length}`);
for (const c of conflicts) console.log("  CONFLICT", c);
await pool.end();
