// Clause splitting and fuzzy-overlap scoring. Local only: word n-gram shingles, Jaccard, containment and tf-idf cosine.
export const STOP = new Set("a an and are as at be by for from has have in is it its of on or shall that the their this to was were will with which who any each such than then there these those under may not no".split(" "));

export const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
export const words = (s: string) => norm(s).split(" ").filter(Boolean);
export const wc = (s: string) => s.split(/\s+/).filter(Boolean).length;

// Split a document into clauses: sentences and numbered sub-paragraphs, 12 to 120 words each.
export function splitClauses(text: string): string[] {
  const flat = text.replace(/\n(?=\s*(\(\w{1,4}\)|\d+\.|Sec(tion|\.)|SEC(TION|\.)|§))/g, "\n\n").split(/\n{2,}/);
  const out: string[] = [];
  for (const para of flat) {
    const p = para.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
    if (!p) continue;
    // sentence boundaries, but not after abbreviations or enumerators
    const parts = p.split(/(?<=[.;:?!])(?<!\b(?:No|Sec|Secs|U\.S|Inc|Corp|vs|Mr|Mrs|Dr|St|Ch|Art|Pub|Stat|Cal|Gov|Bus|Prof|Code|Rev|cf|e\.g|i\.e))\s+(?=[A-Z(“"\d])/);
    let buf = "";
    for (const s of parts) {
      buf = buf ? `${buf} ${s}` : s;
      if (wc(buf) >= 12) { out.push(buf); buf = ""; }
    }
    if (buf && wc(buf) >= 8) { if (out.length && wc(buf) < 12) out[out.length - 1] += ` ${buf}`; else out.push(buf); }
  }
  // break very long clauses at semicolons
  const res: string[] = [];
  for (const c of out) {
    if (wc(c) <= 120) { res.push(c); continue; }
    let buf = "";
    for (const seg of c.split(/(?<=;)\s+/)) { buf = buf ? `${buf} ${seg}` : seg; if (wc(buf) >= 40) { res.push(buf); buf = ""; } }
    if (buf) { if (wc(buf) < 12 && res.length) res[res.length - 1] += ` ${buf}`; else res.push(buf); }
  }
  return res.filter((c) => wc(c) >= 12 && !/^\W*(Page \d+|Table of contents)/i.test(c));
}

export function shingles(tokens: string[], n = 4): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) s.add(tokens.slice(i, i + n).join(" "));
  return s;
}
export function overlap(a: Set<string>, b: Set<string>) {
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter;
}

// The 25-word window of `clause` that shares the most 4-grams with `other` (clauses shown to users are 25 words or fewer).
export function excerpt(clause: string, other: string, max = 25): string {
  const w = clause.split(/\s+/).filter(Boolean);
  if (w.length <= max) return w.join(" ");
  const o = shingles(words(other));
  let best = 0, bi = 0;
  for (let i = 0; i + max <= w.length; i++) {
    const sh = shingles(words(w.slice(i, i + max).join(" ")));
    const v = overlap(sh, o);
    if (v > best) { best = v; bi = i; }
  }
  return w.slice(bi, bi + max).join(" ");
}
