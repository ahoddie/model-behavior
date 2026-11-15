// Wikidata QIDs for watchlist actors, via the public Wikidata API (polite: one request every 3 seconds and honouring Retry-After, descriptive User-Agent).
//   pnpm er:wikidata [--all]      (default: spec §3 actors only; --all: every person/org node without a QID)
// A QID is stored only when it passes deterministic checks that give two independent matches beyond the name:
//   person: instance of human + label/alias matches the name (exact/variant) + the description or occupation fits what we already know
//   org:    label matches the normalized name + instance-of/description fits the node's type
// Everything else goes to er_id_proposals (pending) and the review queue; nothing is guessed.
import { pool, q } from "../../../src/lib/db.ts";
import { enqueue } from "../../lib/review.ts";
import { addExternalId } from "./ids-api.ts";
import { compareNames, keyFor, parsePerson } from "./normalize.ts";

const UA = "model-behavior-research/0.1 (local research project; entity resolution)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(params: Record<string, string>) {
  const u = new URL("https://www.wikidata.org/w/api.php"); for (const [k, v] of Object.entries({ format: "json", origin: "*", ...params })) u.searchParams.set(k, v);
  for (let i = 0; i < 8; i++) {
    await sleep(3000);
    const r = await fetch(u, { headers: { "User-Agent": UA } });
    if (r.status === 429 || r.status >= 500) { const ra = Number(r.headers.get("retry-after")); await sleep(((Number.isFinite(ra) && ra > 0 ? ra : 10 * (i + 1)) + 2) * 1000); continue; }
    if (!r.ok) throw new Error(`wikidata ${r.status}`);
    return r.json() as Promise<any>;
  }
  throw new Error("wikidata: gave up after retries");
}
const PERSON_FIT = /(entrepreneur|investor|venture|businessperson|businessman|businesswoman|executive|chief|ceo|founder|co-founder|computer scientist|researcher|engineer|programmer|philanthrop|technolog|artificial intelligence|\bAI\b|policy|lobbyist|lawyer|attorney|economist|politician|senator|scientist|professor|author|journalist|activist|advocate|director|cofounder|diplomat|official)/i;
const ORG_FIT: Record<string, RegExp> = {
  lab: /(company|corporation|artificial intelligence|technology|software|startup|laborator|research|search|social|cloud)/i,
  investor: /(venture|capital|investment|firm|fund|accelerator|incubator)/i, funder: /(foundation|philanthrop|fund|charit|grant)/i,
  think_tank: /(think tank|research|institute|policy|center|centre|foundation|nonpartisan|organi[sz]ation)/i, nonprofit: /(nonprofit|non-profit|organi[sz]ation|advocacy|foundation|institute|association|union|university|company)/i,
  pac: /(political action committee|super pac|committee|political)/i,
};

const all = process.argv.includes("--all");
const specNames = new Set((await q<{ node_id: string }>(`SELECT node_id FROM er_watchlist WHERE node_id IS NOT NULL`)).map((r) => r.node_id));
const targets = (await q<{ id: string; type: string; name: string; descriptor: string | null; cluster: string; source_url: string }>(
  `SELECT id,type,name,descriptor,cluster,source_url FROM nodes WHERE type IN ('person','lab','investor','funder','think_tank','nonprofit') AND NOT EXISTS (SELECT 1 FROM entity_external_ids e WHERE e.node_id=nodes.id AND e.system='wikidata') ORDER BY id`))
  .filter((n) => all || specNames.has(n.id));
console.log(`wikidata lookups: ${targets.length}`);
let stored = 0, proposed = 0, none = 0;
for (const n of targets) {
  try {
    const bare = n.name.replace(/\s*\([^)]*\)\s*/g, " ").trim();
    const s = await api({ action: "wbsearchentities", search: bare, language: "en", limit: "8", type: "item" });
    const ids: string[] = (s.search ?? []).map((x: any) => x.id); if (!ids.length) { none++; continue; }
    const e = await api({ action: "wbgetentities", ids: ids.join("|"), props: "labels|aliases|descriptions|claims", languages: "en" });
    const ok: { qid: string; desc: string; why: string }[] = [];
    for (const id of ids) {
      const ent = e.entities?.[id]; if (!ent || ent.missing !== undefined) continue;
      const label: string = ent.labels?.en?.value ?? ""; const desc: string = ent.descriptions?.en?.value ?? "";
      const names = [label, ...(ent.aliases?.en ?? []).map((a: any) => a.value)];
      const isHuman = (ent.claims?.P31 ?? []).some((c: any) => c.mainsnak?.datavalue?.value?.id === "Q5");
      if (n.type === "person") {
        if (!isHuman) continue;
        const nm = names.map((x) => compareNames(parsePerson(x), parsePerson(bare)));
        if (!nm.some((m) => m === "exact" || m === "variant")) continue;
        if (!PERSON_FIT.test(desc)) continue;
        // corroboration with what we know: cluster/descriptor keywords, or an organization we already link them to appearing in the description
        const ctx = `${n.descriptor ?? ""} ${n.cluster}`.toLowerCase();
        const fits = (/(a16z|investor|venture|funders?)/.test(ctx) && /(invest|venture|capital|entrepreneur|business)/i.test(desc)) || (/(executive|big-tech|labs?)/.test(ctx) && /(executive|chief|ceo|founder|entrepreneur|business|engineer|scientist)/i.test(desc))
          || (/(think-tank|safety|civil|national-security|policy)/.test(ctx) && /(policy|scholar|researcher|economist|lawyer|activist|professor|author|scientist|diplomat|official|advocate|director)/i.test(desc)) || (/government/.test(ctx) && /(official|investor|entrepreneur|politic|executive|adviser|advisor|technology)/i.test(desc));
        if (fits) ok.push({ qid: id, desc, why: `human; label "${label}" matches; description "${desc}" fits node group "${n.cluster}"` });
      } else {
        if (isHuman) continue;
        const k = keyFor(n.type, bare);
        if (!names.some((x) => keyFor(n.type, x) === k)) continue;
        if (!(ORG_FIT[n.type] ?? /./).test(desc)) continue;
        ok.push({ qid: id, desc, why: `label "${label}" matches normalized name; description "${desc}" fits type ${n.type}` });
      }
    }
    const url = (qid: string) => `https://www.wikidata.org/wiki/${qid}`;
    if (ok.length === 1) { const r = await addExternalId(n.id, "wikidata", ok[0].qid, url(ok[0].qid), "er:wikidata"); if (r === "added") stored++; else if (typeof r === "object") console.log(`  conflict ${ok[0].qid} already on ${r.conflict} (duplicate signal for ${n.id})`); }
    else if (ok.length > 1) {
      proposed++;
      for (const o of ok) await pool.query(`INSERT INTO er_id_proposals (node_id, system, value, source_url, evidence, confidence) VALUES ($1,'wikidata',$2,$3,$4,0.4) ON CONFLICT DO NOTHING`, [n.id, o.qid, url(o.qid), JSON.stringify({ why: o.why })]);
      await enqueue({ workstream: "er", kind: "external_id", refTable: "nodes", refId: `${n.id}:wikidata`, title: `Which Wikidata item is "${n.name}"? ${ok.length} plausible`, payload: { node: n.id, candidates: ok },
        evidence: [{ label: n.name, url: n.source_url }, ...ok.slice(0, 3).map((o) => ({ label: `${o.qid}: ${o.desc}`, url: url(o.qid) }))], confidence: 0.4, significance: 1 });
    } else none++;
  } catch (err: any) { console.warn(`${n.id}: ${err.message}`); }
}
console.log(`wikidata stored=${stored} ambiguous-proposed=${proposed} no-confident-match=${none}`);
await pool.end();
