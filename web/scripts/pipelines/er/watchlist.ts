// Resolves every spec §3 actor (and, when it exists, data/watchlist.yaml people from Workstream A) to one canonical node.
// Output: er_watchlist rows, data/er/watchlist-resolved.json, review-queue items for anything ambiguous or unmatched.
//   pnpm er:watchlist [--watchlist ../data/watchlist.yaml]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pool, q } from "../../../src/lib/db.ts";
import { enqueue } from "../../lib/review.ts";
import { loadStore } from "./profiles.ts";
import { orgKey, parsePerson, compareNames } from "./normalize.ts";
import { LOOSE, SPEC_ACTORS } from "./spec-actors.ts";

const store = await loadStore(true);
const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const nodes = [...store.byId.values()];

function findOrg(name: string, aka: string[], wantPac: boolean) {
  const keys = new Set([name, ...aka].map(orgKey));
  const match = (n: (typeof nodes)[number]) => n.names.some((x) => keys.has(orgKey(x)) || keys.has(orgKey(x.replace(/\s*\(.*$/, ""))) || keys.has(orgKey(x.replace(/\s+(pac|at .*)$/i, ""))));
  const orgLike = (n: (typeof nodes)[number]) => !["person", "lawmaker", "agency", "bill", "race", "rule"].includes(n.type);
  const exact = nodes.filter((n) => (wantPac ? n.type === "pac" : orgLike(n) && n.type !== "pac") && match(n));
  // a spec "PAC/funder" actor may be held as a nonprofit (e.g. Public First Action is a 501(c)(4)); fall back to any organization node
  return exact.length || !wantPac ? exact : nodes.filter((n) => orgLike(n) && match(n));
}
function findPerson(name: string) {
  const p = parsePerson(name);
  return nodes.filter((n) => (n.type === "person" || n.type === "lawmaker") && n.names.some((x) => { const m = compareNames(parsePerson(x), p); return m === "exact" || m === "variant" || m === "swapped"; }));
}

type Row = { key: string; spec_name: string; kind: string; node_id: string | null; status: "resolved" | "ambiguous" | "missing"; notes: string };
const rows: Row[] = [];
for (const a of SPEC_ACTORS) {
  const hits = a.want === "person" ? findPerson(a.name) : findOrg(a.name, a.aka ?? [], a.want === "pac");
  const key = `${a.want === "person" ? "person" : a.group}:${a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  if (hits.length === 1 && LOOSE[a.name]) rows.push({ key, spec_name: a.name, kind: a.group, node_id: hits[0].id, status: "ambiguous", notes: LOOSE[a.name] });
  else if (hits.length === 1) rows.push({ key, spec_name: a.name, kind: a.group, node_id: hits[0].id, status: "resolved", notes: `${hits[0].type}: ${hits[0].name}` });
  else if (hits.length > 1) rows.push({ key, spec_name: a.name, kind: a.group, node_id: hits[0].id, status: "ambiguous", notes: hits.map((h) => `${h.id} (${h.type})`).join("; ") });
  else rows.push({ key, spec_name: a.name, kind: a.group, node_id: null, status: "missing", notes: "no node found" });
}

// Workstream A's watchlist (people) when present.
const wl = arg("--watchlist") ?? ["data/watchlist.yaml", "../data/watchlist.yaml"].find((p) => existsSync(p));
const wlPeople: string[] = [];
if (wl && existsSync(wl)) {
  for (const m of readFileSync(wl, "utf8").matchAll(/^\s*-?\s*name:\s*["']?([^"'\n#]+?)["']?\s*(?:#.*)?$/gm)) wlPeople.push(m[1].trim());
  for (const n of wlPeople) {
    if (rows.some((r) => r.spec_name.toLowerCase() === n.toLowerCase())) continue;
    const hits = findPerson(n);
    rows.push({ key: `watchlist:${n.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, spec_name: n, kind: "watchlist", node_id: hits[0]?.id ?? null, status: hits.length === 1 ? "resolved" : hits.length ? "ambiguous" : "missing", notes: hits.map((h) => h.id).join("; ") });
  }
}
// Every existing person node is itself a watchlist person: confirm each has exactly one node (no same-name twin).
const people = nodes.filter((n) => n.type === "person");
const dupNames = new Map<string, string[]>();
for (const p of people) { const k = parsePerson(p.name); const key = `${k.canonFirst} ${k.last}`; dupNames.set(key, [...(dupNames.get(key) ?? []), p.id]); }
const twins = [...dupNames.values()].filter((v) => v.length > 1);

for (const r of rows) await pool.query(`INSERT INTO er_watchlist (key, spec_name, kind, node_id, status, notes) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (key) DO UPDATE SET node_id=EXCLUDED.node_id, status=EXCLUDED.status, notes=EXCLUDED.notes, updated_at=now()`, [r.key, r.spec_name, r.kind, r.node_id, r.status, r.notes]);
for (const r of rows.filter((r) => r.status !== "resolved")) {
  const n = r.node_id ? store.byId.get(r.node_id) : null;
  if (!n) continue;   // nothing to link as evidence: logged in data/gaps.md instead
  await enqueue({ workstream: "er", kind: "watchlist_actor", refTable: "er_watchlist", refId: r.key, title: `Spec §3 actor "${r.spec_name}" is ${r.status}`, payload: { notes: r.notes, group: r.kind },
    evidence: [{ label: `Node source: ${n.name}`, url: (await q<{ source_url: string }>(`SELECT source_url FROM nodes WHERE id=$1`, [n.id]))[0].source_url }], confidence: 0.5, significance: 2 });
}
mkdirSync("../data/er", { recursive: true });
writeFileSync("../data/er/watchlist-resolved.json", JSON.stringify({ generated_at: new Date().toISOString(), rows, same_name_person_twins: twins }, null, 1));
const c = (s: string) => rows.filter((r) => r.status === s).length;
console.log(`spec actors: ${rows.length} resolved=${c("resolved")} ambiguous=${c("ambiguous")} missing=${c("missing")}; person nodes=${people.length}; same-name twins=${twins.length}`);
for (const r of rows.filter((r) => r.status !== "resolved")) console.log(`  ${r.status.toUpperCase()} ${r.spec_name}: ${r.notes}`);
await pool.end();
