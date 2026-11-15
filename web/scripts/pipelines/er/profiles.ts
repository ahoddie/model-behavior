// Builds in-memory profiles of every node (names, aliases, external IDs, employers, handles) for matching.
import { q } from "../../../src/lib/db.ts";
import { employerKey, nameVariants, normCity, normDomain, normHandle, normState, orgKey, zip5 } from "./normalize.ts";
import { titleWords, type Profile } from "./score.ts";

// Legacy nodes.external_ids keys -> entity_external_ids systems. Handles become aliases of kind 'handle', not IDs.
export function legacyToSystems(type: string, key: string, raw: unknown): { system?: string; handle?: string; value: string }[] {
  const vals = [raw].flat().filter((v) => v != null && v !== "").map(String);
  const out: { system?: string; handle?: string; value: string }[] = [];
  for (const value of vals) {
    if (key === "fec" || key === "fec_alt" || key === "fec_house") out.push({ system: /^C\d{8}$/.test(value) ? "fec_committee" : /^[HSP]\d[A-Z]{2}\d{5}$/.test(value) ? "fec_candidate" : undefined, value });
    else if (key === "ein") out.push({ system: "ein", value: value.replace(/\D/g, "").padStart(9, "0") });
    else if (key === "x") out.push({ handle: value.replace(/^@/, ""), value });
    else if (key === "bluesky") out.push({ handle: value, value });
    else if (key === "bioguide") out.push({ system: "bioguide", value });
    else if (key === "openstates") out.push({ system: "openstates", value });
    else if (key === "lda_client") out.push({ system: "lda_client", value });
    else if (key === "lda_registrant") out.push({ system: "lda_registrant", value });
    else if (key === "wikidata") out.push({ system: "wikidata", value });
  }
  return out.filter((o) => o.system || o.handle);
}

export type Store = { byId: Map<string, Profile>; idIndex: Map<string, string[]>; mergeMap: Map<string, string>; builtAt: number; nodeCount: number };
let cache: Store | null = null;

export async function loadStore(force = false, maxAgeMs = 30_000): Promise<Store> {
  if (!force && cache && Date.now() - cache.builtAt < maxAgeMs) return cache;
  const nodes = await q<{ id: string; type: string; name: string; external_ids: any; cluster: string }>(`SELECT id,type,name,external_ids,cluster FROM nodes`);
  const byId = new Map<string, Profile>();
  for (const n of nodes) {
    const p: Profile = { id: n.id, type: n.type, name: n.name, names: [n.name], ids: {}, employers: [], cityStates: [], zips: [], handles: [], domains: [], titles: [], cluster: n.cluster };
    p.names = nameVariants(n.name);
    for (const [k, v] of Object.entries(n.external_ids ?? {})) for (const m of legacyToSystems(n.type, k, v)) {
      if (m.system) (p.ids[m.system] ??= []).push(m.value);
      if (m.handle) p.handles.push(normHandle(m.handle)!);
    }
    byId.set(n.id, p);
  }
  for (const r of await q<{ node_id: string; alias: string; kind: string }>(`SELECT node_id, alias, kind FROM entity_aliases`)) {
    const p = byId.get(r.node_id); if (!p) continue;
    if (r.kind === "handle") p.handles.push(normHandle(r.alias)!);
    else if (r.kind === "employer_string") { const e = employerKey(r.alias); if (e && p.type !== "person") p.names.push(r.alias); }
    else p.names.push(r.alias);
  }
  for (const r of await q<{ node_id: string; system: string; value: string }>(`SELECT node_id, system, value FROM entity_external_ids`)) {
    const p = byId.get(r.node_id); if (p) { (p.ids[r.system] ??= []); if (!p.ids[r.system].includes(r.value)) p.ids[r.system].push(r.value); }
  }
  for (const r of await q<{ node_id: string; kind: string; value: string }>(`SELECT node_id, kind, value FROM er_attrs`)) {
    const p = byId.get(r.node_id); if (!p) continue;
    if (r.kind === "city_state") p.cityStates.push(r.value);
    else if (r.kind === "zip5") p.zips.push(r.value);
    else if (r.kind === "employer") { const e = employerKey(r.value); if (e) p.employers.push(e); }
    else if (r.kind === "handle") p.handles.push(normHandle(r.value)!);
    else if (r.kind === "website") p.domains.push(normDomain(r.value)!);
    else if (r.kind === "title" || r.kind === "occupation") p.titles.push(...titleWords(r.value));
  }
  // Person role edges: employers are the orgs the person is linked to by a person-type link; titles come from the link subtype.
  const roles = await q<{ pid: string; oid: string; subtype: string }>(
    `SELECT CASE WHEN a.type IN ('person','lawmaker') THEN a.id ELSE b.id END pid, CASE WHEN a.type IN ('person','lawmaker') THEN b.id ELSE a.id END oid, l.subtype
       FROM links l JOIN nodes a ON a.id=l.from_id JOIN nodes b ON b.id=l.to_id
      WHERE l.type='person' AND ((a.type IN ('person','lawmaker')) <> (b.type IN ('person','lawmaker')))`);
  const SUBTITLE: Record<string, string[]> = { founder: ["founder", "executive"], cofounder: ["founder", "executive"], executive: ["executive"], "board seat": ["director"], fellow: ["academic"], advisor: ["director"] };
  for (const r of roles) {
    const p = byId.get(r.pid), o = byId.get(r.oid); if (!p || !o) continue;
    for (const nm of o.names) { const e = orgKey(nm); if (e && !p.employers.includes(e)) p.employers.push(e); }
    for (const t of SUBTITLE[r.subtype] ?? []) if (!p.titles.includes(t)) p.titles.push(t);
  }
  for (const p of byId.values()) { p.handles = [...new Set(p.handles)]; p.employers = [...new Set(p.employers)]; }
  const idIndex = new Map<string, string[]>();
  for (const p of byId.values()) for (const [s, vs] of Object.entries(p.ids)) for (const v of vs) { const k = `${s}:${v}`; const a = idIndex.get(k) ?? []; if (!a.includes(p.id)) a.push(p.id); idIndex.set(k, a); }
  // proposed or applied merges: merged_id -> kept_id, so resolve() answers with the canonical id before the orchestrator applies them
  const mergeMap = new Map<string, string>();
  for (const m of await q<{ kept_id: string; merged_id: string }>(`SELECT kept_id, merged_id FROM merge_log WHERE action='merge' AND status IN ('proposed','applied') ORDER BY id`)) mergeMap.set(m.merged_id, m.kept_id);
  cache = { byId, idIndex, mergeMap, builtAt: Date.now(), nodeCount: nodes.length };
  return cache;
}
export const invalidateStore = () => { cache = null; };
export { normCity, normState, zip5 };
