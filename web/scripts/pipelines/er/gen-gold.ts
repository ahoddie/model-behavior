// Builds the entity-resolution gold set at data/eval/er/gold.jsonl.
// IMPORTANT: this gold set was labeled by the model (Claude, Workstream B session), not by a human:
//   - "synthetic" pairs are constructed from real node names with a scenario whose true answer is known by construction
//     (the same person with an FEC-style variant record; two different people who share a name; father/son; etc.).
//     The attribute values (cities, ZIPs, fictional employers for generic names) are invented test data, never stored as facts.
//   - "real" pairs are existing node pairs; their labels were assigned by the model from the node names/types and general knowledge
//     and are listed in REAL_LABELS below so they can be audited line by line.
// Deterministic (seeded). Re-run: pnpm exec tsx scripts/pipelines/er/gen-gold.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { q, pool } from "../../../src/lib/db.ts";

let seed = 20261115;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const CITIES: [string, string, string][] = [["San Francisco", "CA", "94107"], ["Palo Alto", "CA", "94301"], ["Menlo Park", "CA", "94025"], ["New York", "NY", "10011"], ["Washington", "DC", "20001"], ["Arlington", "VA", "22201"], ["Seattle", "WA", "98101"], ["Austin", "TX", "78701"], ["Boston", "MA", "02110"], ["Los Angeles", "CA", "90013"], ["Mountain View", "CA", "94043"], ["Cambridge", "MA", "02139"], ["Chicago", "IL", "60601"], ["Denver", "CO", "80202"], ["Miami", "FL", "33131"], ["Atlanta", "GA", "30303"]];
const OCC = ["CEO", "FOUNDER", "ENGINEER", "ATTORNEY", "PROFESSOR", "INVESTOR", "PARTNER", "CONSULTANT", "PHYSICIAN", "TEACHER", "SALES", "MANAGER", "WRITER", "ARCHITECT"];
const FICT_EMP = ["ACME ROBOTICS INC", "NORTHWIND LLC", "BLUE HARBOR CAPITAL", "GLOBEX CORPORATION", "INITECH", "CONTOSO LTD", "WAYNE LOGISTICS", "STARK ANALYTICS LP", "UMBRELLA HEALTH", "HOOLI SYSTEMS", "PIED PIPER INC", "VANDELAY IMPORTS", "SOYLENT FOODS", "TYRELL SOFTWARE"];
const COMMON = ["John Smith", "Michael Johnson", "David Williams", "Robert Brown", "James Jones", "William Garcia", "Mary Miller", "Jennifer Davis", "Richard Martinez", "Thomas Anderson", "Daniel Wilson", "Christopher Moore", "Matthew Taylor", "Joseph Thomas", "Steven Lee", "Kevin Harris", "Brian Clark", "Jason Lewis", "Eric Walker", "Mark Young", "Paul Hall", "Andrew King", "George Wright", "Edward Scott", "Charles Green", "Donald Baker", "Kenneth Adams", "Ronald Nelson", "Timothy Hill", "Jeffrey Campbell", "Linda Roberts", "Susan Turner", "Karen Phillips", "Nancy Evans", "Lisa Collins", "Patricia Stewart", "Barbara Morris", "Sarah Rogers"];
const NICK_PAIRS: [string, string][] = [["Robert", "Bob"], ["William", "Bill"], ["James", "Jim"], ["Michael", "Mike"], ["David", "Dave"], ["Thomas", "Tom"], ["Christopher", "Chris"], ["Daniel", "Dan"], ["Joseph", "Joe"], ["Richard", "Rick"], ["Steven", "Steve"], ["Matthew", "Matt"], ["Benjamin", "Ben"], ["Samuel", "Sam"], ["Nicholas", "Nick"], ["Gregory", "Greg"], ["Jonathan", "Jon"], ["Anthony", "Tony"], ["Elizabeth", "Beth"], ["Katherine", "Kate"], ["Alexander", "Alex"], ["Zachary", "Zach"]];
const MID = "ABCDEFGHJKLMNPRSTW".split("");

type Rec = { type: string; name: string; hints?: Record<string, string>; externalIds?: Record<string, string> };
type Pair = { id: string; a: Rec; b: Rec; label: "same" | "different"; kind: string; hard: boolean; origin: "synthetic" | "real"; note: string; labeled_by: string };
const LB = "claude (model-labeled; not a human)";
const pairs: Pair[] = [];
const push = (p: Omit<Pair, "id" | "labeled_by">) => pairs.push({ id: `g${String(pairs.length + 1).padStart(4, "0")}`, labeled_by: LB, ...p });

const split = (n: string) => { const t = n.replace(/\([^)]*\)/g, "").trim().split(/\s+/); return { first: t[0], last: t[t.length - 1], mid: t.slice(1, -1).join(" ") }; };
const fec = (n: string, style = rnd()) => { const { first, last, mid } = split(n); return style < 0.5 ? `${last.toUpperCase()}, ${first.toUpperCase()}${mid ? " " + mid.toUpperCase() : ""}` : n; };
const empVar = (e: string) => pick([e.toUpperCase(), e, `${e} Inc.`, `${e} LLC`, e.replace(/ /g, "").toUpperCase(), `${e} Holdings LP`]);
const city = (c: [string, string, string]) => ({ city: c[0].toUpperCase(), state: c[1], zip5: c[2] });

async function main() {
  const people = await q<{ id: string; name: string; cluster: string }>(`SELECT id,name,cluster FROM nodes WHERE type='person' AND name ~ '^[A-Z][a-z]+ ([A-Z]\\.? )?[A-Z]' ORDER BY id`);
  const orgs = await q<{ id: string; name: string; type: string }>(`SELECT id,name,type FROM nodes WHERE type IN ('lab','investor','funder','think_tank','nonprofit') ORDER BY id`);
  const roleOrg = new Map((await q<{ pid: string; oname: string }>(`SELECT a.id pid, b.name oname FROM links l JOIN nodes a ON a.id=l.from_id JOIN nodes b ON b.id=l.to_id WHERE l.type='person' AND a.type='person' AND b.type IN ('lab','investor','funder','think_tank','nonprofit')`)).map((r) => [r.pid, r.oname.replace(/\s*\(.*$/, "")]));

  // ---------- people: positives ----------
  const real = people.filter((p) => roleOrg.has(p.id));
  const sample = (a: any[], n: number) => { const c = [...a]; const out: any[] = []; while (out.length < n && c.length) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); return out; };
  const base = (n: string, emp: string, c: [string, string, string], occ = pick(OCC)) => ({ name: fec(n), hints: { employer: empVar(emp), occupation: occ, ...city(c) } });
  let k = 0;
  for (const p of sample(real, 60)) {   // P1 same person, same employer, same city, differently formatted
    const c = pick(CITIES), emp = roleOrg.get(p.id)!;
    push({ a: { type: "person", ...base(p.name, emp, c) }, b: { type: "person", name: p.name, hints: { employer: empVar(emp), ...city(c), zip5: pick(CITIES.filter((x) => x[0] === c[0]))[2] } }, label: "same", kind: "person:same_employer_city", hard: false, origin: "synthetic", note: `${p.name}: two FEC-style records, employer and city agree` });
  }
  for (const p of sample(real, 30)) {   // P1b same person, employer + occupation agree, no location
    const emp = roleOrg.get(p.id)!;
    push({ a: { type: "person", name: fec(p.name), hints: { employer: empVar(emp), occupation: "CEO" } }, b: { type: "person", name: p.name, hints: { employer: empVar(emp), occupation: "Chief Executive Officer" } }, label: "same", kind: "person:employer_title", hard: true, origin: "synthetic", note: `${p.name}: employer and title agree, no location` });
  }
  for (const [full, nick] of sample(NICK_PAIRS, 22) as [string, string][]) {   // P5 nickname variants, employer + city agree
    const last = pick(["Reyes", "Okafor", "Lindqvist", "Marchetti", "Tanaka", "Halvorsen", "Delacroix", "Brennan", "Castellanos", "Whitfield"]); const emp = pick(FICT_EMP), c = pick(CITIES);
    push({ a: { type: "person", name: `${full} ${last}`, hints: { employer: emp, ...city(c) } }, b: { type: "person", name: `${nick} ${last}`, hints: { employer: empVar(emp.replace(/ (INC|LLC|LP|LTD|CORPORATION)$/, "")), ...city(c) } }, label: "same", kind: "person:nickname", hard: true, origin: "synthetic", note: "nickname vs formal first name, employer and city agree" });
  }
  for (const p of sample(real, 20)) {   // P3 employer changed, same handle + same city
    const c = pick(CITIES); const h = p.name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 12);
    push({ a: { type: "person", name: p.name, hints: { employer: roleOrg.get(p.id)!, handle: h, ...city(c) } }, b: { type: "person", name: fec(p.name), hints: { employer: pick(FICT_EMP), handle: `@${h}`, ...city(c) } }, label: "same", kind: "person:changed_employer", hard: true, origin: "synthetic", note: "executive changed employers; handle and city agree" });
  }
  for (const p of sample(real, 18)) {   // P4 employer changed, only city agrees: same person, but evidence is one attribute
    const c = pick(CITIES);
    push({ a: { type: "person", name: p.name, hints: { employer: roleOrg.get(p.id)!, ...city(c) } }, b: { type: "person", name: fec(p.name), hints: { employer: pick(FICT_EMP), ...city(c) } }, label: "same", kind: "person:changed_employer_one_attr", hard: true, origin: "synthetic", note: "executive changed employers; only city agrees (one independent attribute: must not auto-merge)" });
  }
  for (const p of sample(real, 8)) {   // P6 name only
    push({ a: { type: "person", name: p.name, hints: {} }, b: { type: "person", name: fec(p.name), hints: { employer: "SELF-EMPLOYED", occupation: "INFORMATION REQUESTED" } }, label: "same", kind: "person:name_only", hard: true, origin: "synthetic", note: "same person, but the second record carries no usable attribute" });
  }
  for (const p of sample(real.filter((x: any) => split(x.name).mid === ""), 12)) {   // middle-initial and ZIP-only agreement, employer missing
    const c = pick(CITIES); const { first, last } = split(p.name); const mi = pick(MID);
    push({ a: { type: "person", name: `${first} ${mi}. ${last}`, hints: { employer: roleOrg.get(p.id)!, ...city(c) } }, b: { type: "person", name: p.name, hints: { employer: empVar(roleOrg.get(p.id)!), zip5: c[2] } }, label: "same", kind: "person:middle_initial", hard: false, origin: "synthetic", note: "middle initial present on one side; employer and ZIP agree" });
  }

  // ---------- people: negatives ----------
  for (const nm of sample(COMMON, 30)) {   // N1 common name, different employer and city
    let c1 = pick(CITIES), c2 = pick(CITIES); while (c2[0] === c1[0]) c2 = pick(CITIES);
    push({ a: { type: "person", name: fec(nm), hints: { employer: pick(FICT_EMP), occupation: pick(OCC), ...city(c1) } }, b: { type: "person", name: nm, hints: { employer: pick(["TEXAS DEPARTMENT OF EDUCATION", "SELF-EMPLOYED", "KAISER PERMANENTE", "US ARMY", "WALMART"]), occupation: pick(OCC), ...city(c2) } }, label: "different", kind: "person:common_name", hard: true, origin: "synthetic", note: "common name, different employer and city" });
  }
  for (const nm of sample(COMMON, 20)) {   // N2 same name, same big employer, different city and occupation
    let c1 = pick(CITIES), c2 = pick(CITIES); while (c2[0] === c1[0]) c2 = pick(CITIES);
    const emp = pick(["GOOGLE", "MICROSOFT", "AMAZON", "META", "APPLE", "KAISER PERMANENTE"]);
    push({ a: { type: "person", name: nm, hints: { employer: emp, occupation: "ENGINEER", ...city(c1) } }, b: { type: "person", name: fec(nm), hints: { employer: empVar(emp), occupation: "ATTORNEY", ...city(c2) } }, label: "different", kind: "person:same_employer_only", hard: true, origin: "synthetic", note: "same name and large shared employer, different city and occupation: only one attribute" });
  }
  for (const nm of sample(COMMON, 22)) {   // N3 father/son with suffix
    const c = pick(CITIES), emp = pick(FICT_EMP); const { first, last } = split(nm);
    push({ a: { type: "person", name: `${first} ${last} Sr.`, hints: { employer: emp, ...city(c) } }, b: { type: "person", name: `${first} ${last} Jr.`, hints: { employer: empVar(emp), ...city(c) } }, label: "different", kind: "person:father_son_suffix", hard: true, origin: "synthetic", note: "Sr./Jr. at the same employer and city" });
  }
  for (const nm of sample(COMMON, 18)) {   // N4 father/son without suffix: same city, different employer and occupation
    const c = pick(CITIES);
    push({ a: { type: "person", name: fec(nm), hints: { employer: pick(FICT_EMP), occupation: "RETIRED", ...city(c) } }, b: { type: "person", name: nm, hints: { employer: pick(FICT_EMP), occupation: "STUDENT", ...city(c) } }, label: "different", kind: "person:father_son_nosuffix", hard: true, origin: "synthetic", note: "same household city, different employer and occupation, no suffix" });
  }
  for (const p of sample(real, 12)) {   // N5 spouses / relatives: same surname, different first names, same employer-ish and city
    const c = pick(CITIES); const { last } = split(p.name);
    push({ a: { type: "person", name: p.name, hints: { employer: roleOrg.get(p.id)!, ...city(c) } }, b: { type: "person", name: `${pick(["Anna", "Maria", "Susan", "Laura", "Peter", "Paul", "Nina", "Owen"])} ${last}`, hints: { employer: empVar(roleOrg.get(p.id)!), ...city(c) } }, label: "different", kind: "person:relatives", hard: true, origin: "synthetic", note: "same surname, different first name, same employer and city" });
  }
  for (const nm of sample(COMMON, 10)) {   // N8 initial vs full name, different employer
    const { first, last } = split(nm); const c = pick(CITIES);
    push({ a: { type: "person", name: `${first[0]}. ${last}`, hints: { employer: pick(FICT_EMP), ...city(c) } }, b: { type: "person", name: nm, hints: { employer: pick(FICT_EMP), ...city(c) } }, label: "different", kind: "person:initial_only", hard: true, origin: "synthetic", note: "first initial only, different employers, same city" });
  }
  for (const nm of sample(COMMON, 10)) {   // N9 same name, same occupation/title only
    const c1 = pick(CITIES), c2 = pick(CITIES);
    push({ a: { type: "person", name: nm, hints: { employer: pick(FICT_EMP), occupation: "CEO", ...city(c1) } }, b: { type: "person", name: fec(nm), hints: { employer: pick(FICT_EMP), occupation: "CEO", ...city(c2) } }, label: "different", kind: "person:same_title_only", hard: true, origin: "synthetic", note: "same name and same title only" });
  }
  for (const p of sample(real, 16)) {   // N10 different real people with a common first name / surname
    const o = pick(real.filter((x: any) => x.id !== p.id && split(x.name).last !== split(p.name).last));
    push({ a: { type: "person", name: p.name, hints: { employer: roleOrg.get(p.id)! } }, b: { type: "person", name: o.name, hints: { employer: roleOrg.get(o.id)! } }, label: "different", kind: "person:different_people", hard: false, origin: "synthetic", note: "two different watchlist people" });
  }

  // N11 coincident attributes: two different people with the same uncommon name who share employer AND city (indistinguishable from the records alone)
  const UNC = ["Anika Reyes", "Tobias Lindgren", "Priya Venkataraman", "Marcus Oyelaran", "Elena Kowalczyk", "Dmitri Volkov", "Sofia Marchetti", "Kwame Asante", "Ingrid Halvorsen", "Rafael Castellanos", "Noor Haddad", "Yuki Tanaka", "Liam Fitzgerald", "Amara Okafor", "Henrik Sorensen", "Leila Nasser"];
  for (const nm of UNC) { const emp = pick(FICT_EMP), c = pick(CITIES); push({ a: { type: "person", name: nm, hints: { employer: emp, occupation: pick(OCC), ...city(c) } }, b: { type: "person", name: fec(nm), hints: { employer: empVar(emp), occupation: pick(OCC), ...city(c) } }, label: "different", kind: "person:coincident_attributes", hard: true, origin: "synthetic", note: "two different people, same uncommon name, same employer and same city (adversarial: indistinguishable from one person on these fields)" }); }

  // ---------- organizations: positives (variants of real names) ----------
  const SUF = [" Inc", " Inc.", " LLC", ", LLC", " LP", " Corp", " Corporation", " PBC", " OpCo LLC", " Holdings LP"];
  const variant = (n: string) => { const b = n.replace(/\s*\(.*$/, ""); const r = rnd(); return r < 0.3 ? b.toUpperCase() + pick(SUF).toUpperCase() : r < 0.55 ? b + pick(SUF) : r < 0.75 ? b.replace(/\s+/g, "").length < 14 && b.includes(" ") ? b.split(" ").join("") : b.toUpperCase() : b.replace(/^The /i, "").toUpperCase(); };
  for (const o of sample(orgs, 60)) push({ a: { type: o.type, name: o.name.replace(/\s*\(.*$/, "") }, b: { type: o.type, name: variant(o.name) }, label: "same", kind: "org:name_variant", hard: false, origin: "synthetic", note: `${o.id}: suffix/case/spacing variant of the same organization` });
  push({ a: { type: "lab", name: "OpenAI" }, b: { type: "lab", name: "Open AI LP" }, label: "same", kind: "org:name_variant", hard: false, origin: "synthetic", note: "example from the brief" });
  push({ a: { type: "lab", name: "OpenAI" }, b: { type: "lab", name: "OpenAI OpCo LLC" }, label: "same", kind: "org:name_variant", hard: false, origin: "synthetic", note: "example from the brief" });
  const AG: [string, string][] = [["Commerce, Dept of (DOC)", "U.S. Department of Commerce"], ["Natl Security Council (NSC)", "White House National Security Council"], ["Federal Trade Commission (FTC)", "Federal Trade Commission"], ["Defense, Dept of (DOD)", "Department of Defense"], ["Energy, Dept of", "U.S. Department of Energy"], ["Natl Science Foundation (NSF)", "National Science Foundation"], ["Treasury, Dept of", "Department of the Treasury"], ["State, Dept of (DOS)", "U.S. Department of State"], ["Justice, Dept of (DOJ)", "Department of Justice"], ["Natl Institute of Standards & Technology (NIST)", "National Institute of Standards and Technology"], ["Natl Telecommunications & Information Administration (NTIA)", "National Telecommunications and Information Administration"], ["Securities & Exchange Commission (SEC)", "Securities and Exchange Commission"], ["Health & Human Services, Dept of (HHS)", "U.S. Department of Health and Human Services"], ["Homeland Security, Dept of (DHS)", "Department of Homeland Security"], ["Office of Science & Technology Policy (OSTP)", "White House Office of Science and Technology Policy"], ["Federal Communications Commission (FCC)", "FCC - Federal Communications Commission"]];
  for (const [x, y] of AG) push({ a: { type: "agency", name: x }, b: { type: "agency", name: y }, label: "same", kind: "agency:variant", hard: false, origin: "synthetic", note: "agency written two ways (LDA style vs plain)" });
  const PACV: [string, string][] = [["Anthropic PBC Political Action Committee", "Anthropic PAC"], ["Meta Platforms, Inc. PAC", "Meta Platforms PAC"], ["Microsoft Corporation Stakeholders Voluntary PAC (MSVPAC)", "Microsoft Corporation Stakeholders Voluntary PAC"], ["Employees of Palantir Technologies Inc. PAC", "Palantir Technologies PAC"], ["NVIDIA Corporation Employees Federal PAC (NVPAC)", "NVIDIA Corporation PAC"], ["Google LLC NetPAC", "GOOGLE LLC NETPAC"], ["Leading the Future", "LEADING THE FUTURE"], ["Think Big", "THINK BIG"], ["Defending Our Values PAC", "Defending Our Values"], ["Jobs and Democracy PAC", "Jobs and Democracy"]];
  for (const [x, y] of PACV) push({ a: { type: "pac", name: x }, b: { type: "pac", name: y }, label: "same", kind: "pac:variant", hard: false, origin: "synthetic", note: "committee name variants" });

  // ---------- organizations: negatives ----------
  const NEG: [string, string, string, string, string][] = [   // [typeA, nameA, typeB, nameB, note]
    ["lab", "Anthropic", "pac", "Anthropic PBC Political Action Committee", "company vs its PAC"], ["lab", "Meta", "pac", "Meta Platforms, Inc. PAC", "company vs its PAC"], ["lab", "Microsoft", "pac", "Microsoft Corporation Stakeholders Voluntary PAC (MSVPAC)", "company vs its PAC"],
    ["lab", "NVIDIA", "pac", "NVIDIA Corporation Employees Federal PAC (NVPAC)", "company vs its PAC"], ["lab", "Palantir", "pac", "Employees of Palantir Technologies Inc. PAC", "company vs its PAC"], ["lab", "Amazon", "pac", "Amazon PAC", "company vs its PAC"], ["lab", "Google", "pac", "Google LLC NetPAC", "company vs its PAC"],
    ["lab", "Anthropic", "think_tank", "The Anthropic Institute", "company vs its institute"], ["lab", "Google", "lab", "Google DeepMind", "parent vs subsidiary"], ["lab", "Palantir", "funder", "Palantir Foundation for Defense Policy and International Affairs", "company vs its foundation"],
    ["funder", "Open Philanthropy", "funder", "Open Philanthropy Action Fund", "funder vs its action fund (separate legal entity)"], ["nonprofit", "Center for AI Safety", "nonprofit", "Center for AI Safety Action Fund", "c3 vs c4 sibling"], ["nonprofit", "Center for AI Safety Action Fund", "pac", "Center for AI Safety Action Fund PAC", "c4 vs its PAC"],
    ["pac", "American Mission", "pac", "American Mission Florida", "national vs state committee"], ["pac", "Public First", "nonprofit", "Public First Action", "PAC vs c4"], ["pac", "Leading the Future", "pac", "Think Big", "sibling committees"], ["pac", "Think Big", "pac", "American Mission", "sibling committees"],
    ["nonprofit", "AFT SOLIDARITY", "nonprofit", "AFT Solidarity 527", "same labor family, separate committees"], ["think_tank", "AEI", "think_tank", "Brookings Institution", "different think tanks"], ["think_tank", "Cato Institute", "think_tank", "Hoover Institution", "different think tanks"],
    ["think_tank", "RAND Corporation", "think_tank", "R Street Institute", "similar-looking names"], ["think_tank", "Center for AI Policy", "nonprofit", "Center for AI Safety", "similar names, different orgs"], ["nonprofit", "Americans for Responsible Innovation", "nonprofit", "Center for Responsible Innovation", "similar names"],
    ["lab", "Scale AI", "lab", "Scale Venture Partners", "shared token"], ["investor", "Khosla Ventures", "investor", "Founders Fund", "different VCs"], ["lab", "Apple", "lab", "Apple Hospitality REIT", "shared token"], ["lab", "Meta", "nonprofit", "Meta Platforms Foundation", "company vs foundation (hypothetical name)"],
    ["funder", "Good Ventures", "investor", "Haun Ventures", "shared token"], ["nonprofit", "Public Citizen", "nonprofit", "Public Citizen Foundation", "c4 vs c3 sibling"], ["think_tank", "AI Now Institute", "think_tank", "Stanford AI Index", "different"], ["lab", "xAI", "lab", "X Corp", "different companies"],
    ["lab", "Mistral AI", "lab", "Mistral Pharma", "shared token"], ["lab", "Cohere", "lab", "Cohere Health", "shared token"], ["nonprofit", "Encode", "nonprofit", "Encode Justice Action", "similar names (hypothetical)"], ["pac", "Abundant Future", "pac", "Abundance Network PAC", "similar names (hypothetical)"],
    ["pac", "Innovation Council", "think_tank", "Abundance Institute", "different"], ["agency", "Office of Management & Budget (OMB)", "agency", "White House Office", "different"], ["agency", "Senate", "agency", "Senate Commerce, Science & Transportation Committee", "chamber vs committee"], ["agency", "Federal Trade Commission", "agency", "Federal Communications Commission", "similar acronyms"],
    ["agency", "Natl Science Foundation (NSF)", "agency", "Natl Institutes of Health (NIH)", "different agencies"], ["agency", "Defense, Dept of (DOD)", "agency", "Defense Advanced Research Projects Agency (DARPA)", "dept vs sub-agency"], ["agency", "Commerce, Dept of (DOC)", "agency", "Bureau of Industry And Security (BIS)", "dept vs sub-agency"], ["agency", "Justice, Dept of (DOJ)", "agency", "Federal Bureau of Investigation", "dept vs sub-agency"],
    ["agency", "Vice President of The U.S.", "agency", "White House Office", "different offices"], ["agency", "Natl Economic Council (NEC)", "agency", "Natl Security Council (NSC)", "similar names, different councils"], ["agency", "Treasury, Dept of", "agency", "Internal Revenue Service (IRS)", "dept vs bureau"],
  ];
  for (const [ta, na, tb, nb, note] of NEG) push({ a: { type: ta, name: na }, b: { type: tb, name: nb }, label: "different", kind: "org:related_not_same", hard: true, origin: "synthetic", note });
  // hard negatives drawn from real nodes: highest token overlap between distinct existing nodes (all distinct entities by construction unless listed in REAL_DUP)
  const toks = (s: string) => new Set(s.toLowerCase().replace(/\([^)]*\)/g, "").split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !["the", "inc", "llc", "and", "for", "action", "fund", "pac"].includes(t)));
  const REAL_DUP = new Set(["commerce-department|agency-commerce-dept-of-doc", "ftc|agency-federal-trade-commission-ftc", "national-security-council|agency-natl-security-council-nsc", "ostp|agency-office-of-science-and-technology-policy-ostp", "osd|agency-office-of-the-secretary-of-defense", "white-house|agency-executive-office-of-the-president-eop", "agency-vice-president-of-the-u-s|agency-office-of-the-vice-president-of-the-united-states"]);
  const all = await q<{ id: string; name: string; type: string }>(`SELECT id,name,type FROM nodes WHERE type IN ('lab','investor','funder','think_tank','nonprofit','pac','agency') AND id NOT LIKE 'ent\\_%' ORDER BY id`);
  const cand: [number, any, any][] = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) { const a = toks(all[i].name), b = toks(all[j].name); const inter = [...a].filter((t) => b.has(t)).length; if (inter && inter / Math.max(a.size, b.size) >= 0.34 && !REAL_DUP.has(`${all[i].id}|${all[j].id}`) && !REAL_DUP.has(`${all[j].id}|${all[i].id}`)) cand.push([inter / Math.max(a.size, b.size), all[i], all[j]]); }
  cand.sort((x, y) => y[0] - x[0]);
  const have = new Set(pairs.filter((p) => p.kind.startsWith("org") || p.kind.startsWith("agency")).map((p) => `${p.a.name}|${p.b.name}`));
  let rn = 0;
  for (const [, a, b] of cand) { if (rn >= 50) break; if (have.has(`${a.name}|${b.name}`)) continue; rn++; push({ a: { type: a.type, name: a.name }, b: { type: b.type, name: b.name }, label: "different", kind: "org:real_token_overlap", hard: true, origin: "real", note: `existing nodes ${a.id} and ${b.id}: distinct canonical nodes` }); }
  // real duplicates found in the data
  for (const d of REAL_DUP) { const [x, y] = d.split("|"); const a = all.find((n) => n.id === x)!, b = all.find((n) => n.id === y)!; push({ a: { type: a.type, name: a.name }, b: { type: b.type, name: b.name }, label: "same", kind: "agency:real_duplicate", hard: false, origin: "real", note: `existing duplicate nodes ${x} and ${y}` }); }
  // same organization recorded with different node types (typing mistake): positive, but types differ
  push({ a: { type: "lab", name: "Perplexity" }, b: { type: "nonprofit", name: "Perplexity (Perplex AI Inc.)" }, label: "same", kind: "org:type_mismatch", hard: true, origin: "real", note: "existing node perplexity is typed nonprofit; the same company typed lab" });

  // ---------- shared-ID pairs ----------
  const ids: [string, string, string][] = [["fec_committee", "C00916114", "Leading the Future"], ["ein", "932592059", "Abundance Institute"], ["fec_committee", "C00923417", "Think Big"], ["ein", "471052538", "Future of Life Institute"], ["fec_committee", "C00960070", "NVIDIA Corporation Employees Federal PAC (NVPAC)"], ["ein", "872449729", "Institute for Progress"]];
  for (const [s, v, n] of ids) push({ a: { type: s === "ein" ? "think_tank" : "pac", name: n, externalIds: { [s]: v } }, b: { type: s === "ein" ? "think_tank" : "pac", name: n.split(" ").slice(0, 2).join(" "), externalIds: { [s]: v } }, label: "same", kind: "id:shared", hard: false, origin: "synthetic", note: `shared ${s} ${v} with an abbreviated name` });
  for (const [s, v, n] of ids.slice(0, 3)) push({ a: { type: s === "ein" ? "think_tank" : "pac", name: n, externalIds: { [s]: v } }, b: { type: s === "ein" ? "think_tank" : "pac", name: n, externalIds: { [s]: v.slice(0, -1) + (v.endsWith("1") ? "2" : "1") } }, label: "same", kind: "id:different_id_same_name", hard: true, origin: "synthetic", note: "same name, different registry ID (an org can hold several committees/EINs; name equality still points at one entity)" });
  for (const [bio, name] of [["S000148", "Chuck Schumer"], ["W000817", "Elizabeth Warren"], ["C001035", "Susan Collins"], ["B001230", "Tammy Baldwin"]]) {
    push({ a: { type: "lawmaker", name, externalIds: { bioguide: bio } }, b: { type: "lawmaker", name: name.split(" ").reverse().join(", "), externalIds: { bioguide: bio } }, label: "same", kind: "id:bioguide", hard: false, origin: "synthetic", note: `shared bioguide ${bio}; name in reversed order` });
    push({ a: { type: "lawmaker", name, externalIds: { bioguide: bio } }, b: { type: "lawmaker", name, externalIds: { bioguide: "X000999" } }, label: "different", kind: "id:bioguide_conflict", hard: true, origin: "synthetic", note: "same name, conflicting bioguide IDs" });
  }
  mkdirSync("../data/eval/er", { recursive: true });
  writeFileSync("../data/eval/er/gold.jsonl", pairs.map((p) => JSON.stringify(p)).join("\n") + "\n");
  const by = (f: (p: Pair) => string) => pairs.reduce((m: any, p) => ((m[f(p)] = (m[f(p)] ?? 0) + 1), m), {});
  console.log(`gold pairs: ${pairs.length}`, by((p) => p.label), by((p) => p.kind.split(":")[0]), `hard=${pairs.filter((p) => p.hard).length}`);
  await pool.end();
}
await main();
