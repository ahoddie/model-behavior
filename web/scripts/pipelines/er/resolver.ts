// The real resolve() body (Workstream B). lib/resolve.ts re-exports resolve() from here with the stub's types unchanged.
//   1. External ID (entity_external_ids, legacy nodes.external_ids) -> exact, confidence 1. Disagreeing IDs are not guessed at.
//   2. Aliases and normalized names, scored with the same pairwise scorer the batch job uses (score.ts).
//   3. People: a name never resolves alone. Needs >= 2 independent matching attributes (employer, location, handle, website,
//      employer+title); otherwise the result is provisional "person_name_only" and the caller holds the item for review.
//   4. Organizations: normalized-name key within the same kind (PACs never resolve to their sponsor and vice versa).
import { loadStore } from "./profiles.ts";
import { keyFor } from "./normalize.ts";
import { THRESHOLDS, compatibleTypes, profileFromInput, scorePair, type Profile } from "./score.ts";
import type { ResolveInput, ResolveResult } from "../../lib/resolve.ts";

const ID_PRIORITY = ["bioguide", "wikidata", "fec_candidate", "fec_committee", "openstates", "ein", "lda_registrant", "lda_client", "lda_lobbyist", "opencorporates", "bluesky_did", "mastodon", "threads", "website"];

export async function realResolve(input: ResolveInput, provisionalId: (i: ResolveInput) => string): Promise<ResolveResult> {
  const store = await loadStore();
  const inp = profileFromInput(input);
  const isPerson = input.type === "person" || input.type === "lawmaker";

  // 1. external IDs
  const hits = new Map<string, string[]>();   // node -> systems
  for (const sys of ID_PRIORITY.concat(Object.keys(input.externalIds ?? {}))) {
    const v = input.externalIds?.[sys]; if (!v) continue;
    for (const id of store.idIndex.get(`${sys}:${v}`) ?? []) hits.set(id, [...(hits.get(id) ?? []), sys]);
  }
  if (hits.size === 1) { const [id] = hits.keys(); return { id, provisional: false, exists: true, matchedBy: "external_id", confidence: 1 }; }
  if (hits.size > 1) {
    // IDs point at different nodes: that is itself a duplicate signal. Prefer the node holding the most IDs, flag it as not certain.
    const [id] = [...hits.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    return { id, provisional: true, exists: true, matchedBy: "external_id", confidence: 0.6 };
  }

  // 2/3/4. candidate generation by name key
  const key = isPerson ? null : keyFor(input.type, input.name);
  const cands: Profile[] = [];
  for (const p of store.byId.values()) {
    if (!compatibleTypes(p.type, input.type) && !(isPerson && (p.type === "person" || p.type === "lawmaker"))) continue;
    if (isPerson) {
      const pp = p.names.some((n) => lastTok(n) === lastTok(input.name) || (lastTok(n) === firstTok(input.name) && firstTok(n) === lastTok(input.name)));
      if (pp) cands.push(p);
    } else if (key && key.length >= 3) {
      const k = (s: string) => keyFor(input.type, s);
      if (p.names.some((n) => k(n) === key)) cands.push(p);
    }
  }
  if (!cands.length) return { id: provisionalId(input), provisional: true, exists: false, matchedBy: "new", confidence: 0 };

  const scored = cands.map((c) => ({ c, r: scorePair(inp, c) })).filter((x) => x.r.decision !== "reject").sort((a, b) => b.r.score - a.r.score);
  if (!scored.length) {
    // names matched but nothing else did
    if (isPerson) {
      const nameOnly = cands.filter((c) => scorePair({ ...inp, names: [input.name] }, c).nameMatch !== "none");
      void nameOnly;
      const [first] = cands.filter((c) => c.names.some((n) => sameFullName(n, input.name)));
      if (first) return { id: first.id, provisional: true, exists: true, matchedBy: "person_name_only", confidence: 0.5 };
    }
    return { id: provisionalId(input), provisional: true, exists: false, matchedBy: "new", confidence: 0 };
  }
  // candidates that are proposed/applied merges of each other count as one entity (canonical = the kept id)
  const canon = (id: string) => { let x = id; for (let i = 0; i < 5 && store.mergeMap.has(x); i++) x = store.mergeMap.get(x)!; return x; };
  const seen = new Set<string>(); const dedup = scored.filter((s) => { const c = canon(s.c.id); if (seen.has(c)) return false; seen.add(c); return true; });
  for (const d of dedup) { const c = canon(d.c.id); if (c !== d.c.id && store.byId.has(c)) d.c = store.byId.get(c)!; }
  const best = dedup[0], second = dedup[1];
  const unique = !second || best.r.score - second.r.score >= 0.1;
  if (best.r.decision === "auto" && unique) return { id: best.c.id, provisional: false, exists: true, matchedBy: isPerson ? "name" : (best.c.names.some((n) => n.toLowerCase() === input.name.toLowerCase()) ? "name" : "alias"), confidence: Math.min(0.99, best.r.score) };
  if (isPerson) return { id: best.c.id, provisional: true, exists: true, matchedBy: "person_name_only", confidence: Math.min(0.6, best.r.score) };
  return { id: best.c.id, provisional: true, exists: true, matchedBy: "name", confidence: Math.min(0.7, best.r.score) };
}
void THRESHOLDS;

const toks = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\([^)]*\)/g, " ").replace(/[^a-z ]+/g, " ").split(/\s+/).filter(Boolean).filter((t) => !["jr", "sr", "ii", "iii", "iv", "dr", "mr", "mrs", "ms"].includes(t));
const lastTok = (s: string) => {
  if (s.includes(",")) return toks(s.split(",")[0]).pop() ?? "";
  return toks(s).pop() ?? "";
};
const firstTok = (s: string) => (s.includes(",") ? toks(s.split(",").slice(1).join(" "))[0] : toks(s)[0]) ?? "";
const sameFullName = (a: string, b: string) => firstTok(a) === firstTok(b) && lastTok(a) === lastTok(b);
