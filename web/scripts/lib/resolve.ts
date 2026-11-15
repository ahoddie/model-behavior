// resolve(): the single way any workstream turns a name or external ID into a node id (CONTRACTS.md §2).
// THIS IS THE STUB. Workstream B (entity resolution) replaces the body of resolve() with the real resolver and must keep
// these exported types and signatures unchanged.
//
// Stub behavior, deliberately conservative:
//   1. external ID match (entity_external_ids, then nodes.external_ids)   -> confidence 1, not provisional
//   2. alias match (entity_aliases.alias_norm), same type family           -> confidence 0.9
//   3. exact normalized name match on a non-person node of the same type   -> confidence 0.8
//   4. exact normalized name match on a person                             -> confidence 0.5, provisional (never a merge:
//      names alone don't identify people; callers should hold such items in review)
//   5. otherwise a new provisional id ent_<type>_<slug>_<shortid>, deterministic for (type, normalized name, ids)
// resolve() never writes nodes: the caller inserts a node (with its source URL) only when it has one.
import { createHash } from "node:crypto";
import { q } from "../../src/lib/db.ts";

export type EntityType = "lab" | "person" | "investor" | "think_tank" | "pac" | "nonprofit" | "funder" | "bill" | "race" | "rule" | "lawmaker" | "agency";

export type ResolveInput = {
  type: EntityType;
  name: string;
  externalIds?: Partial<Record<string, string>>;   // keys are entity_external_ids.system values, e.g. { fec_committee: "C00123456" }
  hints?: { employer?: string; occupation?: string; city?: string; state?: string; zip5?: string; handle?: string; website?: string };
};

export type ResolveResult = {
  id: string;
  provisional: boolean;            // true = no confident match; treat id as a placeholder
  exists: boolean;                 // true = id is an existing nodes row
  matchedBy: "external_id" | "alias" | "name" | "person_name_only" | "new";
  confidence: number;
};

export const normName = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[’'`]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|llc|lp|llp|ltd|corp|corporation|co|company|pbc|the)\b/g, " ").replace(/\s+/g, " ").trim();

const slug = (s: string) => normName(s).replace(/ /g, "-").slice(0, 40) || "x";
const ORG_FAMILY: EntityType[] = ["lab", "investor", "think_tank", "pac", "nonprofit", "funder", "agency"];
const family = (t: EntityType) => (ORG_FAMILY.includes(t) ? ORG_FAMILY : [t]);

export function provisionalId(input: ResolveInput) {
  const key = JSON.stringify([input.type, normName(input.name), Object.entries(input.externalIds ?? {}).sort()]);
  return `ent_${input.type}_${slug(input.name)}_${createHash("sha1").update(key).digest("hex").slice(0, 6)}`;
}

export async function resolve(input: ResolveInput): Promise<ResolveResult> {
  for (const [system, value] of Object.entries(input.externalIds ?? {})) {
    if (!value) continue;
    const [hit] = await q<{ node_id: string }>(`SELECT node_id FROM entity_external_ids WHERE system=$1 AND value=$2`, [system, value]);
    if (hit) return { id: hit.node_id, provisional: false, exists: true, matchedBy: "external_id", confidence: 1 };
    const [legacy] = await q<{ id: string }>(`SELECT id FROM nodes WHERE external_ids->>$1 = $2 LIMIT 2`, [system, value]);
    if (legacy) return { id: legacy.id, provisional: false, exists: true, matchedBy: "external_id", confidence: 1 };
  }
  const n = normName(input.name);
  const fam = family(input.type);
  const aliases = await q<{ node_id: string }>(`SELECT DISTINCT a.node_id FROM entity_aliases a JOIN nodes x ON x.id=a.node_id WHERE a.alias_norm=$1 AND x.type = ANY($2)`, [n, fam]);
  if (aliases.length === 1 && input.type !== "person") return { id: aliases[0].node_id, provisional: false, exists: true, matchedBy: "alias", confidence: 0.9 };
  const named = (await q<{ id: string; name: string }>(`SELECT id, name FROM nodes WHERE type = ANY($1)`, [fam])).filter((r) => normName(r.name) === n || normName(r.name.replace(/\s*\([^)]*\)\s*$/, "")) === n);
  if (named.length === 1) {
    if (input.type === "person") return { id: named[0].id, provisional: true, exists: true, matchedBy: "person_name_only", confidence: 0.5 };
    return { id: named[0].id, provisional: false, exists: true, matchedBy: "name", confidence: 0.8 };
  }
  return { id: provisionalId(input), provisional: true, exists: false, matchedBy: "new", confidence: 0 };
}

// Batch helper with the same semantics.
export async function resolveMany(inputs: ResolveInput[]) {
  const out: ResolveResult[] = [];
  for (const i of inputs) out.push(await resolve(i));
  return out;
}
