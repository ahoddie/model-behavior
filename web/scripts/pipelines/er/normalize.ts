// Name, employer, title and location normalizers for entity resolution (Workstream B).
// Pure functions, no DB access. Everything here is deterministic and unit-testable (see eval.ts).

const strip = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
const base = (s: string) => strip(s).toLowerCase().replace(/[’'`.]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

// ---------- organizations ----------
const LEGAL = /\b(inc|incorporated|llc|l l c|lp|l p|llp|ltd|limited|corp|corporation|co|company|pbc|plc|gmbh|sa|ag|opco|holdings?|group|capital management|management|services|the|of america|usa|us|international|foundation inc|fund inc)\b/g;
const GENERIC_ORG_SUFFIX = /\b(pac|political action committee|super pac|action fund|committee|campaign)\b/g;

export function orgCore(name: string): string {
  let s = base(name.replace(/\([^)]*\)/g, " "));
  s = s.replace(LEGAL, " ").replace(/\s+/g, " ").trim();
  return s;
}
/** Compact comparison key: "Open AI LP" and "OpenAI OpCo LLC" -> "openai". */
export const orgKey = (name: string) => orgCore(name).replace(/ /g, "");

const ABBR: [RegExp, string][] = [[/\bnatl\b/g, "national"], [/\bdept\b/g, "department"], [/\bu s\b/g, "us"], [/\bgov\b/g, "government"], [/\bassn\b/g, "association"], [/\bcmte\b/g, "committee"], [/\bcmtee\b/g, "committee"]];
/** Agencies: "Commerce, Dept of (DOC)" ~ "U.S. Department of Commerce"; "White House Office of Science and Technology Policy" ~ "Office of Science & Technology Policy (OSTP)". */
export function agencyKey(name: string): string {
  let s = name.replace(/\([^)]*\)/g, " ").replace(/^\s*[A-Za-z]{2,8}\s+[-–]\s+/, "");   // "FCC - Federal Communications Commission"
  const m = s.match(/^\s*([^,]+),\s*(dept|department)\.?\s+of\s*$/i); // "Commerce, Dept of"
  if (m) s = `department of ${m[1]}`;
  s = base(s);
  for (const [r, t] of ABBR) s = s.replace(r, t);
  s = s.replace(/\b(the|united states|us|white house|federal|office)\b/g, " ").replace(/\b(of|and|for)\b/g, " ").replace(/\s+/g, " ").trim();
  const k = s.replace(/ /g, "");
  return k.length >= 3 ? k : base(name.replace(/\([^)]*\)/g, " ")).replace(/ /g, "");   // "White House Office" would otherwise strip to nothing
}
/** Acronym in trailing parentheses, if any: "Federal Trade Commission (FTC)" -> "ftc". */
export const parenAcronym = (name: string) => name.match(/\(([A-Za-z]{2,8})\)\s*$/)?.[1]?.toLowerCase() ?? null;

/** PAC names: "Anthropic PBC Political Action Committee" ~ "Anthropic PAC" ~ "Employees of Palantir Technologies Inc. PAC" (sponsor words kept, committee words dropped). */
export function pacKey(name: string): string {
  const s = base(name.replace(/\([^)]*\)/g, " ")).replace(/\b(political action committee|separate segregated fund|ssf|pac|committee|voluntary|federal|employees of|employees|stakeholders|super|inc|llc|pbc|corporation|corp|company|co|the|for|of|fund)\b/g, " ").replace(/\s+/g, " ").trim();
  return s.replace(/ /g, "");
}
export const keyFor = (type: string, name: string) => (type === "agency" ? agencyKey(name) : type === "pac" ? pacKey(name) : orgKey(name));

// ---------- employers ----------
const NON_EMPLOYER = new Set(["", "none", "na", "n a", "self", "self employed", "selfemployed", "retired", "not employed", "unemployed", "homemaker", "requested", "information requested", "info requested", "student", "n a n a"]);
export function employerKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const b = base(raw);
  if (NON_EMPLOYER.has(b)) return null;
  const k = orgKey(raw);
  return k.length >= 2 ? k : null;
}

// ---------- people ----------
const NICK: Record<string, string> = {
  bob: "robert", rob: "robert", bobby: "robert", robbie: "robert", bill: "william", billy: "william", will: "william", willy: "william",
  jim: "james", jimmy: "james", jamie: "james", joe: "joseph", joey: "joseph", jack: "john", johnny: "john", jon: "jonathan", jonathan: "jonathan", mike: "michael", mick: "michael",
  dave: "david", davey: "david", dan: "daniel", danny: "daniel", tom: "thomas", tommy: "thomas", tim: "timothy", chris: "christopher", kit: "christopher",
  steve: "steven", stephen: "steven", greg: "gregory", gregg: "gregory", ben: "benjamin", benny: "benjamin", sam: "samuel", sammy: "samuel", andy: "andrew", drew: "andrew",
  tony: "anthony", nick: "nicholas", nic: "nicholas", matt: "matthew", pete: "peter", rick: "richard", rich: "richard", dick: "richard", ricky: "richard", ted: "edward", ed: "edward", eddie: "edward", ned: "edward",
  liz: "elizabeth", beth: "elizabeth", betty: "elizabeth", lisa: "elizabeth", kate: "katherine", katie: "katherine", kathy: "katherine", catherine: "katherine", kathryn: "katherine",
  jen: "jennifer", jenny: "jennifer", jess: "jessica", sue: "susan", susie: "susan", suzy: "susan", pat: "patrick", patty: "patricia", peggy: "margaret", maggie: "margaret", meg: "margaret",
  alex: "alexander", sandy: "alexander", al: "albert", fred: "frederick", freddie: "frederick", larry: "lawrence", laurie: "lawrence", ken: "kenneth", kenny: "kenneth", ron: "ronald", ronnie: "ronald",
  don: "donald", donnie: "donald", doug: "douglas", jeff: "jeffrey", geoff: "geoffrey", gene: "eugene", hank: "henry", harry: "henry", jerry: "gerald", gerry: "gerald", chuck: "charles", charlie: "charles",
  abby: "abigail", becky: "rebecca", debbie: "deborah", deb: "deborah", vicky: "victoria", vic: "victor", zach: "zachary", zack: "zachary", josh: "joshua", jb: "jb", cj: "cj", tj: "tj",
  mitch: "mitchell", nate: "nathan", nathaniel: "nathan", phil: "philip", phillip: "philip", terry: "terence", wes: "wesley", walt: "walter", wally: "walter", vince: "vincent",
};
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "2nd", "3rd", "esq", "phd", "md", "dds"]);
const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "professor", "hon", "honorable", "sen", "senator", "rep", "representative", "gov", "governor", "amb", "ambassador", "gen", "general", "adm", "sec", "secretary", "president", "judge", "rev", "sir", "dame", "lt", "col", "capt"]);

export type PersonName = { first: string; middle: string; last: string; suffix: string; canonFirst: string; initial: string; full: string; tokens: string[] };

/** Handles "LAST, FIRST M. JR", "First M. Last Jr.", titles, nicknames in quotes or parentheses. */
export function parsePerson(raw: string): PersonName {
  let s = raw.trim();
  const nick = s.match(/["“(]([^")”]+)[")”]/)?.[1];
  s = s.replace(/["“(][^")”]*[")”]/g, " ");
  let toks: string[];
  if (s.includes(",")) {
    const [l, rest] = [s.split(",")[0], s.split(",").slice(1).join(" ")];
    toks = [...base(rest).split(" "), ...base(l).split(" ")];
  } else toks = base(s).split(" ");
  toks = toks.filter(Boolean);
  while (toks.length && TITLES.has(toks[0])) toks.shift();
  let suffix = "";
  // suffixes may sit mid-string in "LAST, FIRST M JR" form once reordered, so strip them wherever they are (never the first token)
  toks = toks.filter((t, i) => {
    if (i === 0 || !SUFFIXES.has(t)) return true;
    if (["jr", "sr", "ii", "iii", "iv", "v", "2nd", "3rd"].includes(t)) suffix = t === "2nd" ? "ii" : t === "3rd" ? "iii" : t;
    return false;
  });
  const first = toks[0] ?? "", last = toks.length > 1 ? toks[toks.length - 1] : "", middle = toks.slice(1, -1).join(" ");
  const canon = (f: string) => NICK[f] ?? f;
  void nick;
  return { first, middle, last, suffix, canonFirst: canon(first), initial: first[0] ?? "", full: toks.join(" "), tokens: toks };
}

export type NameMatch = "exact" | "variant" | "initial" | "swapped" | "none" | "conflict";
/** Compare two parsed names. "conflict" = same surname but irreconcilable (different first names, or suffix clash like Jr vs Sr). */
export function compareNames(a: PersonName, b: PersonName): NameMatch {
  if (!a.last || !b.last) return "none";
  if (a.last !== b.last) {
    // surname/forename swapped ("Ziegler Daniel" vs "Daniel Ziegler")
    if (a.last === b.first && a.first === b.last && a.tokens.length === 2 && b.tokens.length === 2) return "swapped";
    return "none";
  }
  if (a.suffix && b.suffix && a.suffix !== b.suffix) return "conflict";   // father/son
  const midConflict = a.middle && b.middle && a.middle[0] !== b.middle[0];
  if (a.first === b.first) return midConflict ? "conflict" : a.middle === b.middle && a.suffix === b.suffix ? "exact" : "variant";
  if (a.canonFirst === b.canonFirst) return midConflict ? "conflict" : "variant";
  if ((a.first.length === 1 && a.first === b.initial) || (b.first.length === 1 && b.first === a.initial)) return "initial";
  return "conflict";
}

// ---------- location ----------
export const normCity = (c?: string | null) => (c ? base(c).replace(/^(saint|st)\s/, "st ").replace(/^(sf)$/, "san francisco").replace(/^nyc$|^new york city$/, "new york") : null);
export const normState = (s?: string | null) => (s ? s.trim().toUpperCase().slice(0, 2) : null);
export const zip5 = (z?: string | null) => (z && /^\d{5}/.test(z.trim()) ? z.trim().slice(0, 5) : null);
// Zip codes that share a metro: matching on 5-digit ZIP or city+state counts as one "location" attribute.
export const normHandle = (h?: string | null) => (h ? h.trim().replace(/^@/, "").toLowerCase() : null);
export const normDomain = (u?: string | null) => (u ? u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") : null);
export const normOccupation = (o?: string | null) => (o ? base(o) : null);

/** All name strings worth matching on for an organization: the name, without a trailing parenthetical, and a long parenthetical full name. */
export function nameVariants(name: string): string[] {
  const out = [name];
  const bare = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (bare && bare !== name) out.push(bare);
  const paren = name.match(/\(([^)]{12,})\)/)?.[1]?.trim();
  if (paren && paren.split(/\s+/).length >= 3 && !/^(now|formerly|fpp|super)/i.test(paren)) out.push(paren);
  return out;
}
