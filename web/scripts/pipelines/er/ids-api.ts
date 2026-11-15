// Alias and external-ID API (Workstream B). Library functions used by importers and the CLI (`pnpm er:ids ...`).
// Writes go only to entity_aliases / entity_external_ids, always with a source URL (the DB domain enforces it).
import { pool, q } from "../../../src/lib/db.ts";
import { employerKey, orgKey, parsePerson } from "./normalize.ts";
import { invalidateStore } from "./profiles.ts";

export type AliasKind = "name" | "employer_string" | "handle" | "committee_name" | "legal_name" | "former_name";
export const ID_SOURCE_URL: Record<string, (v: string) => string> = {
  fec_committee: (v) => `https://www.fec.gov/data/committee/${v}/`,
  fec_candidate: (v) => `https://www.fec.gov/data/candidate/${v}/`,
  ein: (v) => `https://projects.propublica.org/nonprofits/organizations/${v}`,
  bioguide: (v) => `https://bioguide.congress.gov/search/bio/${v}`,
  wikidata: (v) => `https://www.wikidata.org/wiki/${v}`,
  openstates: (v) => `https://openstates.org/person/${v.replace(/^ocd-person\//, "")}/`,
};
export const aliasNorm = (alias: string, kind: AliasKind = "name") =>
  kind === "handle" ? alias.trim().replace(/^@/, "").toLowerCase()
  : kind === "employer_string" || kind === "legal_name" || kind === "committee_name" ? (orgKey(alias) || alias.toLowerCase())
  : parsePerson(alias).tokens.join(" ") || alias.toLowerCase();

export async function addAlias(nodeId: string, alias: string, kind: AliasKind, sourceUrl: string, createdBy = "er") {
  const r = await pool.query(`INSERT INTO entity_aliases (node_id, alias, alias_norm, kind, source_url, created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (node_id, alias_norm, kind) DO NOTHING`,
    [nodeId, alias, aliasNorm(alias, kind), kind, sourceUrl, createdBy]);
  if (r.rowCount) invalidateStore();
  return !!r.rowCount;
}
/** Returns "added" | "exists" | { conflict: nodeId } (the ID already belongs to another node: a duplicate signal, never overwritten). */
export async function addExternalId(nodeId: string, system: string, value: string, sourceUrl: string | undefined, createdBy = "er") {
  const url = sourceUrl ?? ID_SOURCE_URL[system]?.(value);
  if (!url) throw new Error(`no source URL for ${system}:${value}`);
  const [cur] = await q<{ node_id: string }>(`SELECT node_id FROM entity_external_ids WHERE system=$1 AND value=$2`, [system, value]);
  if (cur) return cur.node_id === nodeId ? "exists" as const : { conflict: cur.node_id };
  await pool.query(`INSERT INTO entity_external_ids (system, value, node_id, source_url, created_by) VALUES ($1,$2,$3,$4,$5)`, [system, value, nodeId, url, createdBy]);
  invalidateStore();
  return "added" as const;
}
export async function addAttr(nodeId: string, kind: "city_state" | "zip5" | "employer" | "occupation" | "handle" | "website" | "title", value: string, sourceUrl: string, createdBy = "er") {
  const r = await pool.query(`INSERT INTO er_attrs (node_id, kind, value, source_url, created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [nodeId, kind, value, sourceUrl, createdBy]);
  if (r.rowCount) invalidateStore();
  return !!r.rowCount;
}
export async function lookupExternalId(system: string, value: string) {
  return (await q<{ node_id: string; source_url: string }>(`SELECT node_id, source_url FROM entity_external_ids WHERE system=$1 AND value=$2`, [system, value]))[0] ?? null;
}
export async function identityOf(nodeId: string) {
  const [ids, aliases, attrs] = await Promise.all([
    q(`SELECT system, value, source_url FROM entity_external_ids WHERE node_id=$1 ORDER BY system, value`, [nodeId]),
    q(`SELECT alias, kind, source_url FROM entity_aliases WHERE node_id=$1 ORDER BY kind, alias`, [nodeId]),
    q(`SELECT kind, value, source_url FROM er_attrs WHERE node_id=$1 ORDER BY kind, value`, [nodeId]),
  ]);
  return { nodeId, externalIds: ids, aliases, attrs };
}
export { employerKey };

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === "show") console.log(JSON.stringify(await identityOf(a), null, 1));
  else if (cmd === "lookup") console.log(await lookupExternalId(a, b));
  else if (cmd === "add-id") console.log(await addExternalId(a, b, c, process.argv[6]));
  else if (cmd === "add-alias") console.log(await addAlias(a, b, (c as AliasKind) ?? "name", process.argv[6]));
  else console.log("usage: er:ids show <node> | lookup <system> <value> | add-id <node> <system> <value> [source_url] | add-alias <node> <alias> <kind> <source_url>");
  await pool.end();
}
