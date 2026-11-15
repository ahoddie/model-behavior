// Loads signatures on public letters as topic positions (table topic_positions). Signing is a public act in the person's
// own name; the stored words are the letter's own (25 words or fewer), with the letter page and its Wayback copy as sources.
// Signers are matched to existing person profiles only when the name matches AND the letter's listed employer appears in the
// profile's descriptor, a role link or FEC employer records. Name-only matches go to the review queue; nobody new is created.
// Parsed signer lists live in data/cache/letters/*.json (made from each letter's public page; names, titles, employers only).
//   tsx scripts/load-letters.ts [--dry-run]
import "./env.ts";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { REPO } from "./env.ts";
import { pool, q } from "../src/lib/db.ts";
import { enqueue } from "./lib/review.ts";

const dry = process.argv.includes("--dry-run");
const LETTERS = [
  { id: "pacing-the-frontier-2026", file: "pacing.json", topic: "rsi", name: "Pacing the Frontier", date: "2026-08-10",
    url: "https://www.pacingthefrontier.com/", archive: "https://web.archive.org/web/20261115185336/https://www.pacingthefrontier.com/",
    quote: "support an international effort to develop the technical and governance tools needed to deliberately pace" },
  { id: "superintelligence-statement-2025", file: "superint.json", topic: "loss_of_control", name: "Statement on Superintelligence", date: "2025-10-22",
    url: "https://superintelligence-statement.org/", archive: "https://web.archive.org/web/20261115185407/https://superintelligence-statement.org/",
    quote: "a prohibition on the development of superintelligence, not lifted before there is broad scientific consensus that it will be done safely and controllably" },
  { id: "cais-statement-on-ai-risk-2023", file: "cais.json", topic: "x_risk", name: "Statement on AI Risk (Center for AI Safety)", date: "2023-05-30",
    url: "https://safe.ai/work/statement-on-ai-extinction-risk", archive: "https://web.archive.org/web/20261115185437/https://safe.ai/work/statement-on-ai-extinction-risk",
    quote: "Mitigating the risk of extinction from AI should be a global priority alongside other societal-scale risks such as pandemics and nuclear war." },
];
for (const L of LETTERS) if (L.quote.split(/\s+/).length > 25) throw new Error(`${L.id}: quote over 25 words`);

await pool.query(`CREATE TABLE IF NOT EXISTS topic_positions (
  id bigserial PRIMARY KEY, node_id text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, topic_id text NOT NULL REFERENCES topics(id),
  basis text NOT NULL, document_id text NOT NULL, document_name text NOT NULL, quote text NOT NULL, answer smallint,
  signer_title text, date date, source_url text NOT NULL, archive_url text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, topic_id, document_id))`);

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter(Boolean);
const people = await q<{ id: string; name: string; evidence: string }>(`
  SELECT n.id, n.name, lower(concat_ws(' ', n.descriptor, n.name,
    (SELECT string_agg(o.name, ' ') FROM links l JOIN nodes o ON o.id = CASE WHEN l.from_id=n.id THEN l.to_id ELSE l.from_id END WHERE n.id IN (l.from_id, l.to_id) AND l.type='person'),
    (SELECT string_agg(DISTINCT x.employer, ' ') FROM money_x_fec_tx x JOIN money_hops h ON true JOIN money_x_hop_txns ht ON ht.hop_id=h.id AND ht.tx_id=x.id WHERE h.from_id=n.id))) AS evidence
  FROM nodes n WHERE n.type='person'`);
const byKey = new Map<string, typeof people>();
for (const p of people) { const w = norm(p.name); if (w.length >= 2) { const k = `${w[0]} ${w.at(-1)}`; byKey.set(k, [...(byKey.get(k) ?? []), p]); } }
const ORG_TOKEN = (org: string) => norm(org.replace(/google deepmind/i, "deepmind").replace(/\b(inc|llc|corp|corporation|university|of|the|pbc)\b/gi, ""))[0];

let matched = 0, queued = 0;
for (const L of LETTERS) {
  const path = resolve(REPO, "data/cache/letters", L.file);
  if (!existsSync(path)) { console.warn(`skip ${L.id}: ${path} missing`); continue; }
  const signers: { name: string; title: string; org: string }[] = JSON.parse(readFileSync(path, "utf8"));
  for (const s of signers) {
    const w = norm(s.name); if (w.length < 2) continue;
    const cands = byKey.get(`${w[0]} ${w.at(-1)}`) ?? [];
    if (!cands.length) continue;
    const tok = s.org ? ORG_TOKEN(s.org) : undefined;
    const sure = cands.filter((c) => tok && tok.length > 2 && c.evidence.includes(tok));
    const title = [s.title, s.org].filter(Boolean).join(", ");
    if (sure.length === 1) {
      matched++;
      if (!dry) await pool.query(`INSERT INTO topic_positions (node_id, topic_id, basis, document_id, document_name, quote, answer, signer_title, date, source_url, archive_url)
        VALUES ($1,$2,'signed letter',$3,$4,$5,1,$6,$7,$8,$9) ON CONFLICT (node_id, topic_id, document_id) DO NOTHING`,
        [sure[0].id, L.topic, L.id, L.name, L.quote, title || null, L.date, L.url, L.archive]);
      console.log(`signed ${L.id}: ${s.name} -> ${sure[0].id}`);
    } else {
      queued++;
      if (!dry) await enqueue({ workstream: "core", kind: "letter_signer", refTable: "topic_positions", refId: `${L.id}:${cands.map((c) => c.id).join("|")}`,
        title: `Is "${s.name}" (${title || "no affiliation listed"}) who signed ${L.name} the same as ${cands.map((c) => c.name).join(" / ")}?`,
        payload: { letter: L.id, topic: L.topic, signer: s, candidates: cands.map((c) => c.id) },
        evidence: [{ label: L.name, url: L.url, archive_url: L.archive, date: L.date }], confidence: 0.5, significance: 1 });
      console.log(`review ${L.id}: ${s.name} (${title}) ~ ${cands.map((c) => c.id).join(", ")}`);
    }
  }
}
console.log({ matched, queued, dry });
await pool.end();
