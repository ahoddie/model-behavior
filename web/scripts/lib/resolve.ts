// resolve(): the single way any workstream turns a name or external ID into a node id (CONTRACTS.md §2).
// resolve() now delegates to Workstream B's resolver (pipelines/er/resolver.ts). Exported names and types are unchanged.
// Matching order: external ID, then scored alias/name match (people need two independent matching attributes beyond the name).
// resolve() never writes nodes: the caller inserts a node (with its source URL) only when it has one.
import { createHash } from "node:crypto";

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
  // Workstream B: the real resolver lives in pipelines/er (external IDs, aliases, scored name matching, the two-attribute rule for people).
  const { realResolve } = await import("../pipelines/er/resolver.ts");
  return realResolve(input, provisionalId);
}

// Batch helper with the same semantics.
export async function resolveMany(inputs: ResolveInput[]) {
  const out: ResolveResult[] = [];
  for (const i of inputs) out.push(await resolve(i));
  return out;
}
