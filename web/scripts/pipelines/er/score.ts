// Pairwise scoring for entity resolution (Workstream B). Deterministic; the LLM judge only sees pairs this leaves in the middle band.
import { compareNames, employerKey, keyFor, normCity, normDomain, normHandle, normOccupation, normState, parsePerson, zip5, type NameMatch } from "./normalize.ts";

export type Profile = {
  id: string;
  type: string;
  name: string;
  names: string[];                 // name + aliases
  ids: Record<string, string[]>;   // system -> values
  employers: string[];             // employerKey()s (from role edges, er_attrs, employer_string aliases)
  cityStates: string[];            // "san francisco|CA"
  zips: string[];
  handles: string[];
  domains: string[];
  titles: string[];                // role/occupation words known for the node ("ceo", "founder", ...)
  cluster?: string;
};

export const THRESHOLDS = { auto: 0.93, review: 0.5 } as const;
// Identifiers that name exactly one entity of the kind (a second, different value in the same system means two entities).
export const SINGLE_VALUED = new Set(["bioguide", "wikidata", "openstates", "lda_registrant", "lda_client"]);
export const STRONG_IDS = new Set(["bioguide", "wikidata", "openstates", "fec_candidate", "fec_committee", "ein", "lda_registrant", "lda_client", "lda_lobbyist", "opencorporates", "bluesky_did"]);

const COMMON_LAST = new Set("smith johnson williams brown jones garcia miller davis rodriguez martinez hernandez lopez gonzalez wilson anderson thomas taylor moore jackson martin lee perez thompson white harris sanchez clark ramirez lewis robinson walker young allen king wright scott torres nguyen hill flores green adams nelson baker hall rivera campbell mitchell carter roberts gomez phillips evans turner diaz parker cruz edwards collins reyes stewart morris morales murphy cook rogers gutierrez ortiz morgan cooper peterson bailey reed kelly howard ramos kim cox ward richardson watson brooks chavez wood james bennett gray mendoza ruiz hughes price alvarez castillo sanders patel myers long ross foster jimenez chen wang li zhang liu singh kumar shah cohen levy miller".split(" "));
const COMMON_FIRST = new Set("john james robert michael william david richard joseph thomas charles christopher daniel matthew anthony mark donald steven paul andrew joshua kenneth kevin brian george timothy ronald jason edward jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott brandon benjamin samuel gregory alexander patrick frank raymond jack dennis jerry tyler aaron jose adam nathan henry zachary mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty margaret sandra ashley kimberly emily donna michelle carol amanda melissa deborah stephanie rebecca laura sharon cynthia kathleen amy angela shirley anna brenda pamela nicole samantha katherine emma ruth christine catherine debra rachel carolyn janet virginia maria heather diane julie joyce victoria kelly christina lauren joan evelyn olivia judith megan cheryl martha andrea frances hannah jacqueline ann gloria jean kathryn alice teresa sara janice doris madison julia grace judy abigail marie denise beverly amber theresa marilyn danielle diana brittany natalie sophia rose isabella alexis kayla charlotte".split(" "));

export function isCommonName(full: string): boolean {
  const p = parsePerson(full);
  return COMMON_LAST.has(p.last) && COMMON_FIRST.has(p.canonFirst) ;
}

export type PairResult = {
  score: number;
  decision: "auto" | "review" | "reject";
  rule: string | null;
  nameMatch: NameMatch | "n/a";
  groups: string[];                // independent attribute groups that matched
  conflicts: string[];
  reason: string;
};
const R = (score: number, decision: PairResult["decision"], rule: string | null, nameMatch: PairResult["nameMatch"], groups: string[], conflicts: string[], reason: string): PairResult => ({ score: Math.round(score * 1000) / 1000, decision, rule, nameMatch, groups, conflicts, reason });

const inter = <T,>(a: T[], b: T[]) => a.filter((x) => b.includes(x));
const ORG_FAMILY = new Set(["lab", "investor", "think_tank", "nonprofit", "funder"]);
export function compatibleTypes(a: string, b: string) {
  if (a === b) return true;
  return ORG_FAMILY.has(a) && ORG_FAMILY.has(b);   // pac, agency, person, lawmaker, bill... never merge across kinds; a PAC and its sponsor are different entities
}

function sharedIds(a: Profile, b: Profile) {
  const shared: string[] = [], conflicts: string[] = [];
  for (const sys of new Set([...Object.keys(a.ids), ...Object.keys(b.ids)])) {
    const x = a.ids[sys] ?? [], y = b.ids[sys] ?? [];
    if (!x.length || !y.length) continue;
    if (inter(x, y).length) shared.push(sys);
    else if (SINGLE_VALUED.has(sys)) conflicts.push(`${sys}:${x[0]}≠${y[0]}`);
  }
  return { shared, conflicts };
}

export function scorePair(a: Profile, b: Profile): PairResult {
  if (a.id === b.id) return R(1, "reject", null, "n/a", [], [], "same node");
  if (!compatibleTypes(a.type, b.type)) {
    // exception: a shared strong ID across the person-ish kinds (person <-> lawmaker) is a real merge candidate
    const personish = (t: string) => t === "person" || t === "lawmaker";
    if (!(personish(a.type) && personish(b.type))) return R(0, "reject", null, "n/a", [], ["type"], `incompatible types ${a.type}/${b.type}`);
  }
  const { shared, conflicts } = sharedIds(a, b);
  const strong = shared.filter((s) => STRONG_IDS.has(s));
  const personish = a.type === "person" || a.type === "lawmaker";

  if (conflicts.length) return R(0, "reject", null, "n/a", [], conflicts, "conflicting single-valued external IDs");

  if (personish) return scorePerson(a, b, strong);
  return scoreOrg(a, b, strong);
}

function scorePerson(a: Profile, b: Profile, strong: string[]): PairResult {
  const pa = parsePerson(a.name), pb = parsePerson(b.name);
  let nm = compareNames(pa, pb);
  // best match over aliases too
  for (const x of a.names) for (const y of b.names) { const m = compareNames(parsePerson(x), parsePerson(y)); if (rank(m) > rank(nm)) nm = m; }
  if (strong.length) {
    if (nm === "conflict") return R(0.5, "review", `shared_id:${strong[0]}`, nm, [], ["name"], "shared strong ID but names conflict");
    return R(nm === "none" ? 0.9 : 0.99, nm === "none" ? "review" : "auto", `shared_id:${strong.join("+")}`, nm, [], [], `shared ${strong.join(", ")}`);
  }
  if (nm === "conflict") return R(0, "reject", null, nm, [], ["name"], "same surname, irreconcilable first name/middle/suffix");
  if (nm === "none") return R(0, "reject", null, nm, [], [], "different names");

  const groups: string[] = [];
  if (inter(a.employers, b.employers).length) groups.push("employer");
  if (inter(a.cityStates, b.cityStates).length || inter(a.zips, b.zips).length) groups.push("location");
  if (inter(a.handles, b.handles).length) groups.push("handle");
  if (inter(a.domains, b.domains).length) groups.push("website");
  const titleHit = inter(a.titles, b.titles).length > 0;
  if (titleHit && groups.length >= 1) groups.push("title");
  const base = { exact: 0.9, variant: 0.87, swapped: 0.8, initial: 0.62, none: 0, conflict: 0 }[nm];
  const common = isCommonName(a.name) || isCommonName(b.name);
  let score: number;
  const n = groups.length;
  if (n === 0) score = 0.35;                       // name only: never a merge
  else if (n === 1) score = Math.min(base - 0.2, 0.7);
  else score = base + (n === 2 ? 0.06 : 0.12) - (common ? 0.08 : 0);
  if (nm === "initial") score = Math.min(score, 0.85);
  score = Math.round(score * 1000) / 1000;
  const decision = n >= 2 && score >= THRESHOLDS.auto ? "auto" : n >= 1 && score >= THRESHOLDS.review ? "review" : "reject";
  return R(score, decision, null, nm, groups, [], n < 2 ? `only ${n} independent attribute(s) beyond name` : `${nm} name + ${groups.join(", ")}${common ? " (common name)" : ""}`);
}
const rank = (m: NameMatch) => ({ exact: 5, variant: 4, swapped: 3, initial: 2, none: 1, conflict: 0 }[m]);

function scoreOrg(a: Profile, b: Profile, strong: string[]): PairResult {
  const key = (s: string) => keyFor(a.type, s);
  const ka = new Set(a.names.map(key)), kb = new Set(b.names.map(key));
  const nameEq = inter([...ka], [...kb]).filter((k) => k.length >= 3).length > 0;
  const groups: string[] = [];
  if (inter(a.domains, b.domains).length) groups.push("website");
  if (inter(a.handles, b.handles).length) groups.push("handle");
  if (strong.length) return R(0.98, "auto", `shared_id:${strong.join("+")}`, "n/a", groups, [], `shared ${strong.join(", ")}`);
  if (nameEq) {
    const sameType = a.type === b.type;
    const score = (sameType ? 0.95 : 0.8) + (groups.length ? 0.03 : 0);
    return R(score, score >= THRESHOLDS.auto ? "auto" : "review", "name_key", "exact", groups, sameType ? [] : ["type_differs"], `normalized names equal${sameType ? "" : ` but types differ (${a.type}/${b.type})`}`);
  }
  // containment ("Anthropic" vs "Anthropic Institute" is NOT a merge, so containment only goes to review with the judge deciding)
  const sa = [...ka][0] ?? "", sb = [...kb][0] ?? "";
  if (sa.length >= 5 && sb.length >= 5 && (sa.includes(sb) || sb.includes(sa))) return R(0.55, "review", null, "n/a", groups, [], "one normalized name contains the other");
  if (groups.length >= 2) return R(0.6, "review", null, "n/a", groups, [], "shares website and handle");
  return R(0, "reject", null, "n/a", groups, [], "no shared id and names differ");
}

// Helper for building a profile from a raw record (resolve() input).
export function profileFromInput(i: { type: string; name: string; externalIds?: Record<string, string | undefined>; hints?: { employer?: string; occupation?: string; city?: string; state?: string; zip5?: string; handle?: string; website?: string } }): Profile {
  const h = i.hints ?? {};
  const city = normCity(h.city), st = normState(h.state);
  const e = employerKey(h.employer);
  return {
    id: "(input)", type: i.type, name: i.name, names: [i.name],
    ids: Object.fromEntries(Object.entries(i.externalIds ?? {}).filter(([, v]) => v).map(([k, v]) => [k, [String(v)]])),
    employers: e ? [e] : [], cityStates: city && st ? [`${city}|${st}`] : [], zips: zip5(h.zip5) ? [zip5(h.zip5)!] : [],
    handles: [normHandle(h.handle)].filter(Boolean) as string[], domains: [normDomain(h.website)].filter(Boolean) as string[],
    titles: titleWords(h.occupation),
  };
}
// Occupation / role words collapse to a few role classes so "CEO", "Chief Executive Officer" and a recorded "executive" role agree.
const ROLE_CLASSES: Record<string, string[]> = {
  executive: ["ceo", "cto", "cfo", "coo", "cpo", "president", "chairman", "chair", "chief", "executive", "svp", "vp", "evp"],
  founder: ["founder", "cofounder", "co-founder"], investor: ["partner", "investor", "venture", "vc", "capitalist", "principal"],
  director: ["director", "board", "trustee"], legislator: ["senator", "congressman", "congresswoman", "representative", "legislator"],
  lobbyist: ["lobbyist", "government affairs", "policy"], academic: ["professor", "researcher", "fellow", "scientist"], counsel: ["counsel", "attorney", "lawyer"],
};
export function titleWords(s?: string | null): string[] {
  const o = normOccupation(s); if (!o) return [];
  const toks = o.split(" ");
  return Object.entries(ROLE_CLASSES).filter(([, ws]) => ws.some((w) => (w.includes(" ") ? o.includes(w) : toks.includes(w)))).map(([k]) => k);
}
