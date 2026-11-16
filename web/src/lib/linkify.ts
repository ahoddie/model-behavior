// Turns names of tracked actors inside a sentence into links. Plain string matching, no model:
// exact names (and names with a trailing parenthetical removed, e.g. "Coefficient Giving (fmr. Open Philanthropy)"),
// longest first, whole words only. Names shared by two profiles, and very short names, are skipped to avoid wrong links.
export type Part = { t: string; id?: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildLinker(nodes: { id: string; name: string }[]) {
  const byName = new Map<string, string | null>();
  for (const n of nodes) {
    for (const v of new Set([n.name, n.name.replace(/\s*\([^)]*\)\s*$/, "")])) {
      const k = v.trim();
      if (k.length < 5) continue;
      byName.set(k, byName.has(k) && byName.get(k) !== n.id ? null : n.id);
    }
  }
  const names = [...byName].filter(([, id]) => id).map(([k]) => k).sort((a, b) => b.length - a.length);
  if (!names.length) return (text: string): Part[] => [{ t: text }];
  const re = new RegExp(`(?<![\\w])(${names.map(esc).join("|")})(?![\\w])`, "g");
  return (text: string, self?: string): Part[] => {
    const out: Part[] = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      const id = byName.get(m[0])!;
      if (id === self) continue;
      if (m.index! > last) out.push({ t: text.slice(last, m.index) });
      out.push({ t: m[0], id });
      last = m.index! + m[0].length;
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out;
  };
}
