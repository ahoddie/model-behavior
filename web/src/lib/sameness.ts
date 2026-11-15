// When are two search results the same item? One rule shared by the search index and the header search.
//  - Nodes: merges applied by entity resolution (merge_log, status 'applied') always win. Otherwise two nodes are the same
//    when they share a type family and a normalized name. A trailing parenthetical is dropped only when it is the initials
//    of the name ("Federal Trade Commission (FTC)"), so "Chip Security Act (H.R. 3447)" and "(S. 1705)" stay separate.
//    People are never collapsed on name alone.
//  - Statements: the same words (case, punctuation and spacing ignored) are one item, listed under every speaker credited.
const ORGS = new Set(["lab", "investor", "think_tank", "pac", "nonprofit", "funder"]);

export const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

function initials(name: string) {
  return norm(name).split(" ").filter((w) => w && !["of", "the", "and", "for", "on", "in"].includes(w)).map((w) => w[0]).join("");
}

export function baseName(name: string) {
  const m = name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!m) return norm(name);
  // Drop the bracket when it holds only the name's initials, or a filing ID ("FPPC ID# 1423131", "C00123456").
  if (/^\s*(?:(?:FPPC|FEC|EIN|ID)\b[\s#:no.]*\d[\d-]*|C\d{8})\s*$/i.test(m[2]) || /\bID\s*#?\s*\d+/i.test(m[2])) return norm(m[1]);
  const inner = m[2].replace(/[^A-Za-z]/g, "").toLowerCase();
  return inner && inner === initials(m[1]) ? norm(m[1]) : norm(name);
}

export function nodeKey(n: { id: string; type: string; name: string }, merged?: Map<string, string>) {
  const kept = merged?.get(n.id);
  if (kept) return `id:${kept}`;
  if (n.type === "person" || n.type === "lawmaker") return `id:${n.id}`;
  const fam = ORGS.has(n.type) ? "org" : n.type;
  return `n:${fam}:${baseName(n.name)}`;
}

export const quoteKey = (text: string) => `q:${norm(text)}`;

// Pick the canonical one of a group: an applied merge's kept id, else the best-connected, else a non-provisional id.
export function pickCanonical<T extends { id: string; weight?: number }>(group: T[], merged?: Map<string, string>): T {
  const kept = merged && group.map((g) => merged.get(g.id)).find(Boolean);
  const byKept = kept && group.find((g) => g.id === kept);
  if (byKept) return byKept;
  return [...group].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || Number(a.id.startsWith("ent_")) - Number(b.id.startsWith("ent_")) || a.id.length - b.id.length)[0];
}

export const MERGED_SQL = `SELECT merged_id, kept_id FROM merge_log WHERE action='merge' AND status='applied' AND reverted_at IS NULL`;
