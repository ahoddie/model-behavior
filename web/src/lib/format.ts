export const fmtMoney = (n: number | null | undefined) =>
  n == null ? "" : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;

// Dates arrive at the precision the source gave (SQL pdate): "2025", "2025-03" or "2025-03-04".
export const fmtDate = (d: string | null | undefined) => {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-");
  if (!m) return y;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
  return day ? `${mon} ${Number(day)}, ${y}` : `${mon} ${y}`;
};

const CLUSTER_NAMES: Record<string, string> = {
  "leading-the-future-network": "Leading the Future network", "public-first-network": "Public First network", "a16z-partners": "a16z & partners",
  "openai-executives": "OpenAI & executives", "anthropic-executives": "Anthropic & executives", "big-tech": "Big Tech", "ai-labs": "AI labs",
  "safety-funders": "Safety-focused funders", "pro-innovation-think-tanks": "Pro-innovation think tanks", "safety-advocacy": "Safety advocates",
  "national-security-think-tanks": "National-security think tanks", "civil-society": "Civil society", "other-investors": "Other investors & leaders",
  "innovation-council-network": "Innovation Council network", "civil-society-funders": "Civil-society funders", "labor-creatives": "Labor & creatives",
  "kids-family-safety": "Kids & family safety", "populist-right": "Populist right", "public-voices": "Public voices", "trade-associations": "Trade associations",
  government: "Agencies and offices engaged", bills: "Bills", races: "Races", rules: "Rules & executive actions", lawmakers: "Candidates & lawmakers",
};
const LANDS_NAMES: Record<string, string> = {
  "b-federal": "Federal bills", "b-california": "California bills", "b-state": "Other state bills",
  "r-orders": "Executive orders", "r-other": "Other federal actions", "g-congress": "Congress",
  "g-whitehouse": "White House", "g-agencies": "Federal agencies", administration: "Administration officials & funds",
};
export const clusterName = (c: string) => {
  const e = c.match(/^e-(\d{4}|undated)-(races|candidates)$/);
  if (e) return e[1] === "undated" ? `Undated ${e[2]}` : e[2] === "candidates" ? `${e[1]} election` : `${e[1]} races`;
  return LANDS_NAMES[c] ?? CLUSTER_NAMES[c] ?? c.replace(/-/g, " ").replace(/^\w/, (x) => x.toUpperCase());
};
// Fixed reading order for the Lands on column: newest election first, then bills, rules, bodies lobbied.
export const landsRank = (c: string) => {
  const e = c.match(/^e-(\d{4})-(races|candidates)$/);
  if (e) return (3000 - Number(e[1])) * 2 + (e[2] === "races" ? 0 : 1);
  return 10000 + ["e-undated-races", "e-undated-candidates", "b-federal", "b-california", "b-state", "r-orders", "r-other", "g-congress", "g-whitehouse", "g-agencies"].indexOf(c);
};

export const STATE_NAMES: Record<string, string> = {
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California", co: "Colorado", ct: "Connecticut", de: "Delaware",
  dc: "District of Columbia", fl: "Florida", ga: "Georgia", hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa",
  ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland", ma: "Massachusetts", mi: "Michigan", mn: "Minnesota",
  ms: "Mississippi", mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire", nj: "New Jersey",
  nm: "New Mexico", ny: "New York", nc: "North Carolina", nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon",
  pa: "Pennsylvania", ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota", tn: "Tennessee", tx: "Texas", ut: "Utah",
  vt: "Vermont", va: "Virginia", wa: "Washington", wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming",
};
// Where a bill sits: "us" for Congress, else the state's two-letter code. Bill ids lead with it (us-119-hr5885, il-sb315-2026);
// a measure without that prefix names its state in the title, as in "(CA ballot initiative, 2026)".
export const billPlace = (id: string, name = ""): string => {
  const p = id.match(/^([a-z]{2})-/)?.[1];
  if (p === "us" || (p && STATE_NAMES[p])) return p;
  const m = [...name.matchAll(/\b([A-Z]{2})\b/g)].map((x) => x[1].toLowerCase()).find((c) => STATE_NAMES[c]);
  return m ?? "other";
};

// A bill's lifecycle stage, in the order a bill moves through them.
export const STAGE_LABEL: Record<string, string> = {
  proposed: "Proposed", introduced: "Introduced", in_committee: "In committee", passed_one_chamber: "Passed one chamber",
  passed_legislature: "Passed the legislature", enacted: "Enacted", vetoed: "Vetoed", failed: "Failed",
};

export const TYPE_LABEL: Record<string, string> = { lab: "Lab", person: "Person", investor: "Investor", funder: "Funder", pac: "PAC", nonprofit: "Nonprofit",
  think_tank: "Think tank", bill: "Bill", race: "Race", rule: "Rule", lawmaker: "Candidate", agency: "Federal body" };

// Short name for a source URL, shown in the source pill.
const SOURCE_NAMES: [RegExp, string][] = [
  [/(^|\.)fec\.gov$/, "FEC"], [/(^|\.)lda\.(senate\.)?gov$/, "Senate LDA"], [/projects\.propublica\.org$/, "ProPublica"],
  [/(^|\.)regulations\.gov$/, "Regulations.gov"], [/(^|\.)congress\.gov$/, "Congress.gov"], [/bioguide\.congress\.gov$/, "Congress bio"],
  [/clerk\.house\.gov$/, "House Clerk"], [/(^|\.)senate\.gov$/, "Senate.gov"], [/(^|\.)house\.gov$/, "House.gov"],
  [/leginfo\.legislature\.ca\.gov$/, "CA Legislature"], [/(^|\.)nysenate\.gov$/, "NY Senate"], [/(^|\.)federalregister\.gov$/, "Federal Register"],
  [/(^|\.)whitehouse\.gov$/, "White House"], [/(^|\.)sec\.gov$/, "SEC"], [/(^|\.)irs\.gov$/, "IRS"], [/cal-access\.sos\.ca\.gov$|(^|\.)sos\.ca\.gov$/, "CA Secretary of State"],
  [/(^|\.)(x|twitter)\.com$/, "X"], [/(^|\.)bsky\.app$/, "Bluesky"], [/(^|\.)youtube\.com$|youtu\.be$/, "YouTube"], [/(^|\.)linkedin\.com$/, "LinkedIn"],
  [/wikipedia\.org$/, "Wikipedia"], [/web\.archive\.org$/, "Wayback"], [/(^|\.)ballotpedia\.org$/, "Ballotpedia"], [/(^|\.)opensecrets\.org$/, "OpenSecrets"],
  [/(^|\.)nytimes\.com$/, "NYT"], [/(^|\.)wsj\.com$/, "WSJ"], [/(^|\.)washingtonpost\.com$/, "Washington Post"], [/(^|\.)politico\.com$/, "Politico"],
  [/(^|\.)axios\.com$/, "Axios"], [/(^|\.)semafor\.com$/, "Semafor"], [/(^|\.)reuters\.com$/, "Reuters"], [/(^|\.)bloomberg\.com$/, "Bloomberg"],
  [/(^|\.)wired\.com$/, "Wired"], [/(^|\.)theverge\.com$/, "The Verge"], [/(^|\.)techcrunch\.com$/, "TechCrunch"], [/(^|\.)cnbc\.com$/, "CNBC"],
  [/(^|\.)ft\.com$/, "FT"], [/(^|\.)theinformation\.com$/, "The Information"], [/(^|\.)apnews\.com$/, "AP"], [/(^|\.)calmatters\.org$/, "CalMatters"],
  [/(^|\.)britannica\.com$/, "Britannica"], [/(^|\.)substack\.com$/, "Substack"], [/(^|\.)medium\.com$/, "Medium"], [/arxiv\.org$/, "arXiv"],
];
export function sourceName(url: string): string {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { return "source"; }
  for (const [re, name] of SOURCE_NAMES) if (re.test(host)) return name;
  return host;
}

// What kind of source a URL is, said in words in each source link's tooltip so a reader can weigh it.
const GOV = /(\.gov|\.mil)$|(^|\.)(legislature|senate|assembly)\.[a-z]+\.(us|gov)$|courtlistener\.com$|regulations\.gov$/;
const SOCIAL = /(^|\.)(x|twitter|bsky|linkedin|youtube|threads)\.(com|app|net)$|youtu\.be$/;
const NEWS = /(nytimes|wsj|washingtonpost|politico|axios|semafor|reuters|bloomberg|wired|theverge|techcrunch|cnbc|ft|theinformation|apnews|calmatters|fortune|thehill|time|businessinsider|cbsnews|foxnews|foxbusiness|theguardian|bostonglobe|sfstandard|gizmodo|engadget|nextgov|govtech|euronews|observer|breitbart|ibtimes|entrepreneur|tomshardware|transformernews|rollcall|maginative|the-decoder|businesstoday|thenationalnews|inquirer|geo|meritalk|broadbandbreakfast|iapp|capitolnewsillinois|cryptobriefing|pymnts|reason)\./;
export function sourceKind(url: string): string {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { return "Source"; }
  if (host === "web.archive.org") return "Archived copy";
  if (GOV.test(host)) return "Government record";
  if (SOCIAL.test(host)) return "Social media post";
  if (NEWS.test(host)) return "News report";
  return "Organization or personal site";
}
