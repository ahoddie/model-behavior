// Watchlist builder (Workstream A). Rebuilt from the database on every run, so new FEC, 990 and lobbying rows add people automatically.
//   Who:  leaders, board members, founders, fellows and policy staff of the labs, companies, nonprofits and think tanks in the map;
//         people who gave money to AI-related causes (money links from the person themself, never their company's);
//         people who turn up testifying or writing op-eds (feed items of those kinds); registered federal lobbyists.
//   Tier: 1-3 (3 = most influential) from role, money given and audience size. The parts are stored so a tier can be audited.
// Output: stmt_watchlist (the working copy) and data/watchlist.yaml (the readable export, with verified handles).
// Usage: pnpm statements:watchlist
import "../../env.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../env.ts";
import { pool, q } from "../../../src/lib/db.ts";

type Basis = { kind: string; detail: string; url: string; date?: string | null };
const ROLE_POINTS: Record<string, number> = { executive: 2, founder: 2, cofounder: 2, "board seat": 1.5, fellow: 1, advisor: 1, employee: 0.75, "former staff": 0.5, "revolving door": 0.5 };
const SENIOR = /\b(CEO|chief|founder|co-?founder|president|chair(?:man|woman)?|director|general counsel|head of|global affairs|government affairs|public policy|managing partner|partner)\b/i;
const ORG_TYPES = ["lab", "think_tank", "nonprofit", "pac", "funder", "investor"];

export async function buildWatchlist() {
  const people = await q<{ id: string; name: string; descriptor: string | null; source_url: string }>(`SELECT id, name, descriptor, source_url FROM nodes WHERE type='person'`);
  const roleLinks = await q<{ from_id: string; subtype: string; org: string; org_type: string; url: string; d: string | null }>(
    `SELECT l.from_id, l.subtype, o.name AS org, o.type AS org_type, l.source_url AS url, l.date_start::text AS d
     FROM links l JOIN nodes o ON o.id=l.to_id JOIN nodes p ON p.id=l.from_id
     WHERE p.type='person' AND l.type='person' AND o.type = ANY($1) ORDER BY l.date_start DESC NULLS LAST`, [ORG_TYPES]);
  // from_id is the PERSON: only money the person gave themself (never a company's money, never credited the other way).
  const moneyLinks = await q<{ from_id: string; amount: string | null; subtype: string; to_name: string; url: string; d: string | null }>(
    `SELECT l.from_id, l.amount::text, l.subtype, o.name AS to_name, l.source_url AS url, l.date_start::text AS d
     FROM links l JOIN nodes o ON o.id=l.to_id JOIN nodes p ON p.id=l.from_id
     WHERE p.type='person' AND l.type='money' AND l.subtype IN ('contribution','donation','grant')`);
  const voice = await q<{ node_id: string; kind: string; url: string; d: string }>(
    `SELECT node_id, kind, url, date::text AS d FROM feed_items WHERE kind IN ('testimony','op-ed') AND status='approved' AND node_id IN (SELECT id FROM nodes WHERE type='person')`);
  const lobbyists = await q<{ node_id: string; value: string; source_url: string }>(`SELECT node_id, value, source_url FROM entity_external_ids WHERE system='lda_lobbyist'`);
  const followers = await q<{ node_id: string; f: number }>(`SELECT node_id, max(followers) AS f FROM stmt_handles WHERE status='verified' AND followers IS NOT NULL GROUP BY node_id`);
  const fol = new Map(followers.map((r) => [r.node_id, r.f]));

  const rows: { id: string; tier: number; score: number; parts: Record<string, number>; basis: Basis[] }[] = [];
  for (const p of people) {
    const basis: Basis[] = [];
    let role = 0;
    for (const l of roleLinks.filter((x) => x.from_id === p.id)) {
      role = Math.max(role, ROLE_POINTS[l.subtype] ?? 0.5);
      basis.push({ kind: "role", detail: `${l.subtype} at ${l.org}`, url: l.url, date: l.d });
    }
    if (role && p.descriptor && SENIOR.test(p.descriptor)) role += 1;
    role = Math.min(role, 3.5);
    const gave = moneyLinks.filter((x) => x.from_id === p.id);
    const total = gave.reduce((s, x) => s + Number(x.amount ?? 0), 0);
    for (const g of [...gave].sort((a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0)).slice(0, 3))
      basis.push({ kind: "money", detail: `${g.subtype} to ${g.to_name}${g.amount ? ` ($${Number(g.amount).toLocaleString("en-US")})` : ""}`, url: g.url, date: g.d });
    const money = total >= 1e6 ? 2 : total >= 1e5 ? 1.5 : total >= 1e4 ? 1 : total > 0 ? 0.5 : 0;
    const v = voice.filter((x) => x.node_id === p.id);
    for (const x of v.slice(0, 2)) basis.push({ kind: x.kind, detail: `${x.kind} on record`, url: x.url, date: x.d });
    const voicePts = Math.min(1, v.length * 0.5);
    const lob = lobbyists.find((x) => x.node_id === p.id);
    if (lob) basis.push({ kind: "lobbying", detail: "registered federal lobbyist (LDA)", url: lob.source_url });
    if (!basis.length) continue;
    const aud = fol.get(p.id) ?? 0;
    const audience = aud >= 1e5 ? 1.5 : aud >= 1e4 ? 1 : aud >= 1e3 ? 0.5 : 0;
    const score = Math.round((role + money + voicePts + (lob ? 0.5 : 0) + audience) * 100) / 100;
    rows.push({ id: p.id, tier: score >= 4 ? 3 : score >= 2 ? 2 : 1, score, parts: { role, money, voice: voicePts, lobbying: lob ? 0.5 : 0, audience }, basis });
  }
  const before = new Set((await q<{ node_id: string }>(`SELECT node_id FROM stmt_watchlist`)).map((r) => r.node_id));
  for (const r of rows)
    await pool.query(`INSERT INTO stmt_watchlist (node_id, influence_tier, score, score_parts, basis) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (node_id) DO UPDATE SET influence_tier=$2, score=$3, score_parts=$4, basis=$5, built_at=now()`, [r.id, r.tier, r.score, JSON.stringify(r.parts), JSON.stringify(r.basis)]);
  await pool.query(`DELETE FROM stmt_watchlist WHERE node_id <> ALL($1)`, [rows.map((r) => r.id)]);
  const added = rows.filter((r) => !before.has(r.id)).map((r) => r.id);
  await writeYaml();
  return { total: rows.length, added, byTier: [1, 2, 3].map((t) => rows.filter((r) => r.tier === t).length) };
}

const s = (v: unknown) => JSON.stringify(v ?? null); // JSON strings are valid YAML scalars
export async function writeYaml() {
  const list = await q<{ node_id: string; name: string; influence_tier: number; score: number; score_parts: unknown; basis: Basis[] }>(
    `SELECT w.node_id, n.name, w.influence_tier, w.score, w.score_parts, w.basis FROM stmt_watchlist w JOIN nodes n ON n.id=w.node_id ORDER BY w.influence_tier DESC, w.score DESC, n.name`);
  const handles = await q<{ node_id: string; platform: string; handle: string; did: string | null; status: string; verified_via: string | null; followers: number | null; note: string | null }>(
    `SELECT node_id, platform, handle, did, status, verified_via, followers, note FROM stmt_handles WHERE status <> 'rejected' ORDER BY node_id, status, platform`);
  const xs = await q<{ id: string; x: string }>(`SELECT id, external_ids->>'x' AS x FROM nodes WHERE external_ids ? 'x' AND type='person'`);
  const xMap = new Map(xs.map((r) => [r.id, r.x]));
  const out = [
    "# Generated by `pnpm statements:watchlist` (web/scripts/importers/statements/watchlist.ts). Do not edit by hand; it is rebuilt from the database.",
    "# influence_tier: 3 = most influential. basis: why the person is listed, each with a source URL. handles: only status=verified handles are ingested.",
    `generated: ${s(new Date().toISOString())}`, `count: ${list.length}`, "people:",
  ];
  for (const p of list) {
    out.push(`  - id: ${p.node_id}`, `    name: ${s(p.name)}`, `    influence_tier: ${p.influence_tier}`, `    score: ${p.score}`, `    score_parts: ${s(p.score_parts)}`, "    basis:");
    for (const b of p.basis) out.push(`      - { kind: ${s(b.kind)}, detail: ${s(b.detail)}, url: ${s(b.url)}${b.date ? `, date: ${s(b.date)}` : ""} }`);
    const hs = handles.filter((h) => h.node_id === p.node_id);
    const x = xMap.get(p.node_id);
    if (hs.length || x) {
      out.push("    handles:");
      for (const h of hs)
        out.push(`      - { platform: ${s(h.platform)}, handle: ${s(h.handle)}${h.did ? `, did: ${s(h.did)}` : ""}, status: ${s(h.status)}${h.verified_via ? `, verified_via: ${s(h.verified_via)}` : ""}${h.followers != null ? `, followers: ${h.followers}` : ""}${h.note ? `, note: ${s(h.note)}` : ""} }`);
      if (x) out.push(`      - { platform: "x", handle: ${s(x)}, status: "recorded", note: "from the research load; not ingested (no X_API_KEY)" }`);
    }
  }
  writeFileSync(join(REPO, "data/watchlist.yaml"), out.join("\n") + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await buildWatchlist();
  console.log(`watchlist: ${r.total} people (tier 1/2/3: ${r.byTier.join("/")}), ${r.added.length} new`);
  await pool.end();
}
