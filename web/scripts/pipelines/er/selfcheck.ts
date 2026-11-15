// Self-check of the live resolve(): every existing node should resolve to itself (or its proposed-merge target) from its own name,
// ids and role-edge hints. Reports misses; never writes.   pnpm exec tsx scripts/pipelines/er/selfcheck.ts
import { pool, q } from "../../../src/lib/db.ts";
import { resolve, type EntityType } from "../../lib/resolve.ts";
import { loadStore } from "./profiles.ts";

const store = await loadStore(true);
const nodes = await q<{ id: string; type: EntityType; name: string }>(`SELECT id,type,name FROM nodes WHERE type NOT IN ('bill','race','rule') ORDER BY id`);
const stat: Record<string, Record<string, number>> = {}; const bad: string[] = [];
const bump = (t: string, k: string) => ((stat[t] ??= {})[k] = (stat[t][k] ?? 0) + 1);
for (const n of nodes) {
  const p = store.byId.get(n.id)!;
  const person = n.type === "person" || n.type === "lawmaker";
  const hints = person ? { employer: p.employers[0] ? [...(store.byId.values())].find((o) => o.type !== "person" && o.names.some((x) => x.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(p.employers[0].slice(0, 6))))?.name : undefined, occupation: p.titles.includes("executive") ? "CEO" : undefined } : undefined;
  const ext = Object.fromEntries(Object.entries(p.ids).map(([k, v]) => [k, v[0]]));
  const r = await resolve({ type: n.type, name: n.name, externalIds: person ? undefined : ext, hints });
  const target = store.mergeMap.get(n.id) ?? n.id;
  const ok = r.id === n.id || r.id === target;
  bump(n.type, ok ? (r.provisional ? "self_provisional" : "self_confident") : "other");
  if (!ok) bad.push(`${n.type} ${n.id} -> ${r.id} (${r.matchedBy}, ${r.confidence})`);
}
console.table(stat);
console.log(bad.slice(0, 40).join("\n"));
await pool.end();
