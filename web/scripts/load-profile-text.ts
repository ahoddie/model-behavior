// Load data/profiles/*.json (headline, description and sources per person or organization) into profile_text.
// Checks every entry and loads only the ones that pass; prints the rest. With --check it only reports.
// Warnings (length, a tracked name left unlinked) don't block loading.
import { REPO } from "./env.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pool, q } from "../src/lib/db.ts";
import { parseDescription, plainDescription } from "../src/lib/profile-text.ts";
import { buildLinker } from "../src/lib/linkify.ts";

const CHECK = process.argv.includes("--check");
const dir = join(REPO, "data/profiles");
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const nodes = await q<{ id: string; name: string; type: string }>(`SELECT id, name, type FROM nodes`);
const byId = new Map(nodes.map((n) => [n.id, n]));
const link = buildLinker(nodes);
const TEXT_TYPES = new Set(["person", "lawmaker", "lab", "investor", "think_tank", "pac", "nonprofit", "funder", "agency"]);

const errors: string[] = [], warnings: string[] = [];
const seen = new Map<string, string>();
const good: { id: string; p: any; batch: string }[] = [];

for (const f of files) {
  const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const batch = d.batch ?? f.replace(/\.json$/, "");
  for (const p of d.profiles ?? []) {
    const id = p.id, where = `${f} ${id}`, errs: string[] = [];
    const n = byId.get(id);
    if (!n) errs.push("unknown node");
    else if (!TEXT_TYPES.has(n.type)) errs.push(`type ${n.type} doesn't get profile text`);
    if (seen.has(id)) errs.push(`also in ${seen.get(id)}`);
    const h = String(p.headline ?? "").trim(), desc = String(p.description ?? "").trim();
    if (!h || !/[.]$/.test(h)) errs.push("headline missing or not ending in a period");
    if (h.length > 140) warnings.push(`${where}: headline is ${h.length} characters`);
    if (!desc) errs.push("description missing");
    const parts = parseDescription(desc);
    for (const x of parts) if (x.id && !byId.has(x.id)) errs.push(`link to unknown node ${x.id}`);
    if (/\]\(|\[[^\]]*\]/.test(parts.filter((x) => !x.id).map((x) => x.t).join(""))) errs.push("malformed link markup");
    const words = plainDescription(desc).split(/\s+/).filter(Boolean).length;
    if (!p.thin && (words < 30 || words > 75)) warnings.push(`${where}: description is ${words} words`);
    // A tracked actor named in plain text should be a link.
    const linked = new Set(parts.filter((x) => x.id).map((x) => x.id));
    for (const x of parts) if (!x.id) for (const m of link(x.t, id)) if (m.id && !linked.has(m.id)) warnings.push(`${where}: "${m.t}" is on the site (${m.id}) but not linked`);
    const sources = Array.isArray(p.sources) ? p.sources : [];
    if (!sources.length) errs.push("no sources");
    for (const s of sources) if (!s.label || !s.name || !/^https?:\/\/\S+$/.test(s.url ?? "")) errs.push(`bad source ${JSON.stringify(s)}`);
    if (errs.length) { errors.push(`${where}: ${errs.join("; ")}`); continue; }
    seen.set(id, f);
    good.push({ id, p: { headline: h, description: desc, sources: sources.map(({ label, name, url }: any) => ({ label, name, url })), thin: !!p.thin }, batch });
  }
}

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
if (!CHECK) {
  for (const { id, p, batch } of good) await pool.query(
    `INSERT INTO profile_text (node_id, headline, description, sources, thin, batch, updated_at) VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (node_id) DO UPDATE SET headline=$2, description=$3, sources=$4, thin=$5, batch=$6, updated_at=now()
     WHERE (profile_text.headline, profile_text.description, profile_text.sources, profile_text.thin) IS DISTINCT FROM ($2,$3,$4::jsonb,$5)`,
    [id, p.headline, p.description, JSON.stringify(p.sources), p.thin, batch]);
}
const covered = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM profile_text`).catch(() => [{ n: 0 }]))[0].n;
const total = nodes.filter((n) => TEXT_TYPES.has(n.type)).length;
console.log(`${good.length} ok, ${errors.length} rejected, ${warnings.length} warnings${CHECK ? " (check only)" : `; ${covered} of ${total} profiles have text`}`);
await pool.end();
