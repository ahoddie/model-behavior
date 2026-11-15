// Circumstantial facts about the nodes in the money chains. These are NEVER hops. Each goes to the review queue as a proposed
// fact (kind "fact") with the filing as evidence; nothing is written to `facts` until a reviewer approves it.
// Today: shared treasurers across tracked committees, read from the treasurer fields of the committees' own F3X/F24 headers.
// LLC formation dates / registered agents need state registries or OpenCorporates (no key, no account): see data/gaps.md.
//   tsx facts.ts
import "../../env.ts";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pool, q } from "../../../src/lib/db.ts";
import { enqueue } from "../../lib/review.ts";
import { FEC_DIR } from "./fecfiles.ts";
import { TRACKED } from "./tracked.ts";

const clean = (s: string) => s.replace(/^"|"$/g, "").trim();
const byTreasurer = new Map<string, Map<string, string>>();   // treasurer -> committee -> file number
for (const f of readdirSync(FEC_DIR).filter((x) => x.endsWith(".fec"))) {
  const line = readFileSync(resolve(FEC_DIR, f), "latin1").split(/\r?\n/).find((l) => /^F\d/.test(l));
  if (!line) continue;
  const p = line.split("\x1c");
  const form = clean(p[0]);
  const [last, first] = /^F3X/.test(form) ? [p[16], p[17]] : /^F24/.test(form) ? [p[10], p[11]] : [null, null];
  if (!last || !first) continue;
  const name = `${clean(first)} ${clean(last)}`.replace(/\b([a-z])([a-z]*)/gi, (_, a, b) => a.toUpperCase() + b.toLowerCase());
  const m = byTreasurer.get(name) ?? new Map(); m.set(clean(p[1]), f.replace(".fec", "")); byTreasurer.set(name, m);
}
const nodeOf = new Map(TRACKED.map((t) => [t.fec, t.node]));
let n = 0;
for (const [name, cm] of byTreasurer) {
  const cmtes = [...cm.keys()].filter((c) => nodeOf.has(c));
  if (cmtes.length < 2) continue;
  const names = cmtes.map((c) => q<{ name: string }>(`SELECT name FROM nodes WHERE id=$1`, [nodeOf.get(c)!]));
  const nm = (await Promise.all(names)).map((x) => x[0].name);
  for (const c of cmtes) {
    const file = cm.get(c)!;
    await enqueue({ workstream: "money", kind: "fact", refTable: "nodes", refId: `${nodeOf.get(c)}:treasurer:${name}`,
      title: `${nm.join(", ")} list the same treasurer: ${name}`,
      payload: { node: nodeOf.get(c), key: "Treasurer", value: name, shared_with: cmtes.filter((x) => x !== c).map((x) => nodeOf.get(x)),
        rationale: "Treasurer is named in the committee's own FEC report header. A shared treasurer is a circumstantial fact about the committees, not evidence about who funds them." },
      evidence: [{ label: "FEC report header", url: `https://docquery.fec.gov/cgi-bin/forms/${c}/${file}/` }], confidence: 0.95, significance: 0.3 });
    n++;
  }
}
console.log("treasurer fact proposals", n);

// FEC memo lines that attribute an organisation's contribution to named individuals (for example an LLC's gift split between its partners).
// The memo is a filed attribution, not a transfer from those people to the organisation, so it is a proposed fact and never a hop.
const memos = await q<any>(`SELECT m.id, m.node_id, m.name AS person, m.amount::float8 amount, m.tx_date::text d, m.source_url::text url, p.name AS org, p.amount::float8 org_amount
  FROM money_x_fec_tx m JOIN money_x_fec_tx p ON p.file_number=m.file_number AND p.sched='A' AND NOT p.memo AND p.entity_type<>'IND' AND p.tx_date=m.tx_date AND p.amount >= m.amount
  WHERE m.sched='A' AND m.memo AND m.entity_type='IND' AND NOT m.superseded AND NOT p.superseded`);
let nm = 0;
for (const m of memos) {
  const [first, last] = m.person.includes(",") ? m.person.split(",").reverse().map((x: string) => x.trim()) : ["", m.person];
  const person = `${first} ${last}`.replace(/\b([a-z])([a-z]*)/gi, (_: string, a: string, b: string) => a.toUpperCase() + b.toLowerCase()).trim();
  await enqueue({ workstream: "money", kind: "fact", refTable: "money_x_fec_tx", refId: m.id, title: `FEC memo attributes ${m.org}'s ${Math.round(m.amount).toLocaleString("en-US")} dollar gift (${m.d}) to ${person}`,
    payload: { node: m.node_id, key: "Contribution attribution", value: `${person}: ${m.amount.toLocaleString("en-US")} of ${m.org}'s ${m.org_amount.toLocaleString("en-US")} dollars`, rationale: "Memo line in the committee's own report. It attributes the organisation's contribution; it does not show money moving from the person to the organisation." },
    evidence: [{ label: "FEC filing line (memo)", url: m.url, date: m.d }], confidence: 0.9, significance: Math.min(1, m.amount / 1e7) });
  nm++;
}
console.log("memo attribution proposals", nm);
await pool.end();
