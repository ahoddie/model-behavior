// Turns names of tracked actors inside a sentence into links. Plain string matching, no model:
// exact names (and names with a trailing parenthetical removed, e.g. "Coefficient Giving (fmr. Open Philanthropy)", or the
// former name inside it),
// longest first, whole words only. Names shared by two profiles, and very short names, are skipped to avoid wrong links.
export type Part = { t: string; id?: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Give each node's type where known: a person's name is never treated as the start of a longer name.
export function buildLinker(nodes: { id: string; name: string; type?: string }[]) {
  const people = new Set(nodes.filter((n) => n.type === "person" || n.type === "lawmaker").map((n) => n.id));
  const byName = new Map<string, string | null>();
  for (const n of nodes) {
    // A former or new name in the parenthetical ("Coefficient Giving (fmr. Open Philanthropy)") links too.
    const other = n.name.match(/\((?:fmr\.|formerly|now)\s+([^)]+)\)\s*$/)?.[1];
    for (const v of new Set([n.name, n.name.replace(/\s*\([^)]*\)\s*$/, ""), ...(other ? [other] : [])])) {
      const k = v.trim();
      if (k.length < 5) continue;
      byName.set(k, byName.has(k) && byName.get(k) !== n.id ? null : n.id);
    }
  }
  const names = [...byName].filter(([, id]) => id).map(([k]) => k).sort((a, b) => b.length - a.length);
  if (!names.length) return (text: string): Part[] => [{ t: text }];
  // A lookahead finds a candidate at every word start, so a long name that starts inside a shorter one is still seen.
  const re = new RegExp(`(?<![\\w])(?=(${names.map(esc).join("|")})(?![\\w]))`, "g");
  return (text: string, self?: string): Part[] => {
    const found: { at: number; end: number; t: string; id: string }[] = [];
    for (const m of text.matchAll(re)) {
      const t = m[1], at = m.index!, end = at + t.length, id = byName.get(t)!;
      if (id === self || (!people.has(id) && insideLongerName(text, at, end, t))) continue;
      found.push({ at, end, t, id });
    }
    // The longest names win; a shorter one that overlaps a kept one is dropped.
    found.sort((x, y) => y.t.length - x.t.length || x.at - y.at);
    const kept: typeof found = [];
    for (const f of found) if (!kept.some((k) => f.at < k.end && k.at < f.end)) kept.push(f);
    kept.sort((x, y) => x.at - y.at);
    const out: Part[] = [];
    let last = 0;
    for (const k of kept) {
      if (k.at > last) out.push({ t: text.slice(last, k.at) });
      out.push({ t: k.t, id: k.id });
      last = k.end;
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out;
  };
}

// A known organization name that runs on into more of a name is the start of another, longer name the site does not track:
// "White House Office" inside "White House Office of Management and Budget", "Commerce Committee" inside "Senate Commerce
// Committee", "Meta" in "Meta Superintelligence Labs". People's names are never cut this way ("Paul Scharre of CNAS").
// Kept: titles and company suffixes after a name ("Anthropic CEO", "NVIDIA Corporation"), dates, and "of"/"for" after a
// name that doesn't end in an institutional word ("OpenAI for Countries" is checked; "Google of all places" is not).
const AFTER_OK = /^(Co-\w+|CEO|CTO|COO|CFO|President|Chair|Chairman|Chairwoman|Director|Founder|Co-founder|Cofounder|Executive|Senior|Vice|Head|Board|General|Chief|Secretary|Counsel|Corporation|Corp\.?|Inc\.?|Technologies|Holdings|Group|OpCo|Co\.|Ltd\.?|PBC|LLC|PAC|January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/;
const HEAD_NOUN = /\b(Office|Department|Center|Centre|Institute|Council|Committee|Subcommittee|Bureau|Agency|Administration|Commission|Foundation|School|Board|Director|Secretary|University|College|Division|Service|Fund|Program|Project|Initiative|Coalition|Association|Alliance|Society)$/;
const BEFORE_PREFIX = /^(Senate|House|Assembly|National|Federal|State|Joint|Select|Standing|Deputy|Associate|Assistant|Acting|Interim|Special|Principal)$/;
function insideLongerName(text: string, at: number, end: number, name: string) {
  const prev = text.slice(0, at).match(/(?:^|\s)([A-Z][a-z]+) $/);
  if (prev && BEFORE_PREFIX.test(prev[1])) return true;
  const after = text.slice(end);
  if (name.endsWith(".")) return false; // "MAGA Inc. It uses…": the next word starts a sentence
  const next = after.match(/^ ([A-Z][\w'’.-]*)/);
  if (next && /^[A-Z][a-z]/.test(next[1]) && !AFTER_OK.test(next[1])) return true;
  return HEAD_NOUN.test(name) && /^ (?:of|for) (?:the )?[A-Z]/.test(after);
}
