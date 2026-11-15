// Spec §3 actors, transcribed from docs/AI Policy Positions Tracker Spec.md. `want` = the expected node-type family for resolution.
// `aka` are alternative names used only to find the node; nothing here is stored as a fact.
export type SpecActor = { name: string; want: "org" | "pac" | "person" | "agency"; aka?: string[]; group: string; loose?: string };
const o = (group: string, names: (string | [string, ...string[]])[], want: SpecActor["want"] = "org"): SpecActor[] =>
  names.map((n) => (Array.isArray(n) ? { name: n[0], aka: n.slice(1), want, group } : { name: n, want, group }));

export const SPEC_ACTORS: SpecActor[] = [
  ...o("labs", ["Anthropic", "OpenAI", "Google DeepMind", "Meta", "xAI", "Microsoft", "Amazon", ["Nvidia", "NVIDIA"], "Apple", "Perplexity", "Scale AI", "Palantir", ["Mistral", "Mistral AI"], "Cohere", "Safe Superintelligence", ["Thinking Machines", "Thinking Machines Lab"]]),
  ...o("people", ["Marc Andreessen", "Ben Horowitz", "Vinod Khosla", "Reid Hoffman", "Peter Thiel", "Joe Lonsdale", "Garry Tan", "Chris Larsen", "Greg Brockman", "Anna Brockman", "Sam Altman", "Dario Amodei", "Demis Hassabis", "Mark Zuckerberg", "Elon Musk", "Jensen Huang", "Satya Nadella", "Sundar Pichai", "Mustafa Suleyman", "Eric Schmidt", "David Sacks", "Jaan Tallinn", "Dustin Moskovitz"], "person"),
  ...o("think_tanks_advocacy", ["Abundance Institute", "R Street Institute", ["Cato Institute"], ["AEI", "American Enterprise Institute"], ["Mercatus Center", "Mercatus Center at George Mason University"], ["Hoover Institution"], "Foundation for American Innovation", ["Heritage Foundation"], ["American Edge", "American Edge Project"],
    "Americans for Responsible Innovation", "Center for AI Policy", "Encode", "Secure AI Project", ["FLI", "Future of Life Institute"], ["CAIS Action Fund", "Center for AI Safety Action Fund"],
    ["IFP", "Institute for Progress"], ["CSET", "Center for Security and Emerging Technology"], ["CNAS", "Center for a New American Security"], ["RAND", "RAND Corporation"], ["Brookings", "Brookings Institution"], ["CSIS", "Center for Strategic and International Studies"],
    ["CDT", "Center for Democracy & Technology"], ["AI Now", "AI Now Institute"], ["EPIC", "Electronic Privacy Information Center"], "Public Citizen"]),
  ...o("pacs_funders", ["Leading the Future", "Think Big", "American Mission", "Public First", ["Public First Action"], "Jobs and Democracy", ["Defending Our Values", "Defending Our Values PAC"], ["Innovation Council Action", "Innovation Council"], "Abundant Future"], "pac"),
  // note: the spec names the 501(c)(4) "Innovation Council Action"; the only node is the super PAC (FEC C00922815). Reported, not merged.
  ...o("pacs_funders", [["Open Philanthropy", "Coefficient Giving"], ["a16z", "Andreessen Horowitz"]]),
];
// "company and executive PACs" are an open-ended class; resolved from the data rather than listed here.
export const SPEC_PAC_CLASS_NOTE = "company and executive PACs: any node of type pac whose FEC committee name or connected organization is a spec §3 lab/company or person";

export const LOOSE: Record<string, string> = { "Innovation Council Action": "spec names the Innovation Council Action (c4) but only the Innovation Council super PAC node exists; needs a human decision on whether to add a separate node" };
