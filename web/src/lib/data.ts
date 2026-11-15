import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { q } from "./db";
import { buildLinker, type Part } from "./linkify";

// Every public read is cached for a few minutes under one tag. Writes clear it: review actions call
// updateTag("record"); importers and the loader POST to /api/revalidate (localhost only).
export const RECORD_TAG = "record";
function cached() { cacheLife("minutes"); cacheTag(RECORD_TAG); }

export type GNode = { id: string; type: string; name: string; descriptor: string | null; cluster: string; source_url: string; issues: string[]; first_date: string | null };
export type GLink = { id: number; from: string; to: string; type: "money" | "person" | "idea" | "position"; subtype: string | null; amount: number | null;
  date_start: string | null; date_end: string | null; stance: string | null; note: string | null; source_url: string };

export const COLUMN: Record<string, 0 | 1 | 2> = { lab: 0, person: 0, investor: 0, funder: 0, pac: 1, nonprofit: 1, think_tank: 1, bill: 2, race: 2, rule: 2, lawmaker: 2, agency: 2 };
export const TARGET_TYPES = ["bill", "race", "rule", "lawmaker", "agency"];

// "Lands on" groups: elections by two-year cycle (money in 2025-26 counts toward 2026), then bills by level,
// rules, and the federal bodies lobbied. Computed here so new importer rows group themselves.
export const LANDS_CLUSTER = `CASE
  WHEN n.type='race' THEN 'e-' || coalesce(substring(n.id from 'race-(\\d{4})'), (ly.y + ly.y % 2)::text, 'undated') || '-races'
  WHEN n.type='lawmaker' THEN 'e-' || coalesce(substring(n.external_ids->>'race' from 'race-(\\d{4})'), (ly.y + ly.y % 2)::text, 'undated') || '-candidates'
  WHEN n.type='bill' THEN CASE WHEN n.id LIKE 'us-%' THEN 'b-federal' WHEN n.id LIKE 'ca-%' THEN 'b-california' ELSE 'b-state' END
  WHEN n.type='rule' THEN CASE WHEN n.id LIKE 'eo-%' THEN 'r-orders' ELSE 'r-other' END
  WHEN n.type='agency' THEN CASE
    WHEN n.name ~* '(^house|house of rep|senate|congress|committee)' THEN 'g-congress'
    WHEN n.name ~* '(white house|executive office|science (and|&) technology policy|national security council|management (and|&) budget)' THEN 'g-whitehouse'
    ELSE 'g-agencies' END
  WHEN n.cluster='government' THEN 'administration'
  ELSE n.cluster END`;

export const FACT_ORDER = ["Type", "Legal form", "Founded", "Founders", "Leader", "Role", "Party", "Office", "Headquarters", "Affiliated with",
  "Parent", "Previously", "Education", "Funding", "Valuation", "Revenue", "Employees", "Website", "FEC ID", "EIN", "Social"];

export async function getGraph() {
  "use cache";
  cached();
  const nodes = await q<GNode>(`
    SELECT n.id, n.type, n.name, n.descriptor, ${LANDS_CLUSTER} AS cluster, n.source_url,
      coalesce((SELECT array_agg(DISTINCT i) FROM feed_items f, unnest(f.issues) i WHERE f.node_id=n.id AND f.status='approved'), '{}') AS issues,
      (SELECT min(d)::text FROM (SELECT min(date_start) d FROM links WHERE from_id=n.id OR to_id=n.id UNION ALL SELECT min(date) FROM feed_items WHERE node_id=n.id AND status='approved') x) AS first_date
    FROM nodes n
    LEFT JOIN LATERAL (SELECT max(extract(year FROM coalesce(date_end, date_start)))::int AS y FROM links WHERE to_id=n.id OR from_id=n.id) ly ON true`);
  const links = await q<GLink>(`
    -- note is left out: the map never shows it, and it is most of the payload. Profiles read it separately.
    SELECT id::int, from_id AS "from", to_id AS "to", type, subtype, amount::float8 AS amount, pdate(date_start, date_start_prec) AS date_start, pdate(date_end, date_end_prec) AS date_end, stance, NULL::text AS note, source_url
    FROM links WHERE NOT (type='money' AND subtype='lobbying' AND amount IS NULL)
    UNION ALL (
    -- Lobbying contacts without an amount arrive once per quarterly filing. The map shows one line per pair,
    -- sourced to the most recent filing; every filing is still listed on the profile.
    SELECT DISTINCT ON (from_id, to_id) id::int, from_id, to_id, type, subtype, NULL::float8, pdate(date_start, date_start_prec) AS date_start,
      (max(coalesce(date_end, date_start)) OVER (PARTITION BY from_id, to_id))::text,
      stance, NULL::text, source_url
    FROM links WHERE type='money' AND subtype='lobbying' AND amount IS NULL
    ORDER BY from_id, to_id, date_start DESC NULLS LAST)`);
  return { nodes, links };
}

export async function getNodeSummary(id: string) {
  "use cache";
  cached();
  const [node] = await q<GNode & { external_ids: any; archive_url: string | null; logo_url: string | null; logo_source_url: string | null }>(`SELECT * FROM nodes WHERE id=$1`, [id]);
  if (!node) return null;
  // Labeled facts (Founded, Leader, Website...) form the key-facts block; unlabeled ones are notes.
  const keyFacts = await q<{ label: string; text: string; url: string }>(
    `SELECT DISTINCT ON (label) label, text, url FROM facts WHERE node_id=$1 AND label IS NOT NULL ORDER BY label, id DESC`, [id]);
  keyFacts.sort((a, b) => FACT_ORDER.indexOf(a.label) - FACT_ORDER.indexOf(b.label));
  const raw = await q<{ text: string; url: string }>(`SELECT text, url FROM facts WHERE node_id=$1 AND label IS NULL ORDER BY id LIMIT 8`, [id]);
  // Names of other tracked actors inside a note link to their profiles.
  const link = buildLinker(await q<{ id: string; name: string }>(`SELECT id, name FROM nodes`));
  const facts: { text: string; url: string; parts: Part[] }[] = raw.map((f) => ({ ...f, parts: link(f.text, id) }));
  const stats = (await q<{ money_out: number; money_in: number; links: number; feed: number; filings: number }>(`
    SELECT (SELECT coalesce(sum(amount),0)::float8 FROM links WHERE from_id=$1 AND type='money' AND subtype <> 'lobbying') AS money_out,
           (SELECT coalesce(sum(amount),0)::float8 FROM links WHERE to_id=$1 AND type='money' AND subtype <> 'lobbying') AS money_in,
           (SELECT count(*)::int FROM links WHERE from_id=$1 OR to_id=$1) AS links,
           (SELECT count(*)::int FROM feed_items WHERE node_id=$1 AND status='approved') AS feed,
           (SELECT count(*)::int FROM filings WHERE node_id=$1) AS filings`, [id]))[0];
  return { node, facts, keyFacts, stats };
}

export async function getProfile(id: string) {
  "use cache";
  cached();
  const s = await getNodeSummary(id);
  if (!s) return null;
  const feed = await q<any>(`SELECT f.*, pdate(f.date, f.date_prec) AS date, t.name AS target_name FROM feed_items f LEFT JOIN nodes t ON t.id=f.target_id
                             WHERE f.node_id=$1 AND f.status='approved' ORDER BY f.date DESC, f.id DESC`, [id]);
  const filings = await q<any>(`SELECT *, pdate(filed_date, filed_prec) AS filed_date, amount::float8 AS amount FROM filings WHERE node_id=$1
                                ORDER BY coalesce(filed_date, to_date(substring(period from '\\d{4}'), 'YYYY')) DESC NULLS LAST, id DESC`, [id]);
  const links = await q<any>(`
    SELECT l.id::int, l.type, l.subtype, l.amount::float8 AS amount, pdate(l.date_start, l.date_start_prec) AS date_start, pdate(l.date_end, l.date_end_prec) AS date_end, l.stance, l.note, l.source_url,
      CASE WHEN l.from_id=$1 THEN 'out' ELSE 'in' END AS dir,
      o.id AS other_id, o.name AS other_name, o.type AS other_type, o.descriptor AS other_descriptor
    FROM links l JOIN nodes o ON o.id = CASE WHEN l.from_id=$1 THEN l.to_id ELSE l.from_id END
    WHERE l.from_id=$1 OR l.to_id=$1 ORDER BY l.date_start DESC NULLS LAST`, [id]);
  return { ...s, feed, filings, links, flags: await conflictFlags(id) };
}

/** Places where what an actor says and what its money does point different ways. Each flag carries both sources. */
export async function conflictFlags(id: string) {
  "use cache";
  cached();
  type Ev = { label: string; url: string; date: string | null };
  const flags: { kind: string; text: string; said: Ev; did: Ev }[] = [];
  // 1. Says it supports bill B; funds a committee that opposes B, or spends against a candidate tied to B.
  const supports = await q<any>(`
    SELECT b.id AS bill, b.name AS bill_name, b.descriptor AS bill_desc, src.url, src.date, src.label FROM (
      SELECT target_id AS bill, url, pdate(date, date_prec) AS date, coalesce(excerpt, summary) AS label FROM feed_items WHERE node_id=$1 AND status='approved' AND stance='support' AND target_id IS NOT NULL
      UNION ALL SELECT to_id, source_url, pdate(date_start, date_start_prec) AS date_start, coalesce(note, 'Registered support') FROM links WHERE from_id=$1 AND type='position' AND stance IN ('support','support_if_amended')
    ) src JOIN nodes b ON b.id=src.bill AND b.type='bill'`, [id]);
  for (const s of supports) {
    const against = await q<any>(`
      SELECT p.name AS pac, m.source_url AS money_url, m.amount::float8, pdate(m.date_start, m.date_start_prec) AS date_start, opp.source_url AS opp_url, opp.note AS opp_note, pdate(opp.date_start, opp.date_start_prec) AS opp_date, opp.kind, tgt.name AS tgt
      FROM links m JOIN nodes p ON p.id=m.to_id
      JOIN LATERAL (
        SELECT 'bill' AS kind, source_url, note, date_start, date_start_prec, NULL::text AS to_id FROM links WHERE from_id=p.id AND to_id=$2 AND type='position' AND stance='oppose'
        UNION ALL
        SELECT 'candidate', l.source_url, l.note, l.date_start, l.date_start_prec, l.to_id FROM links l JOIN nodes lw ON lw.id=l.to_id AND lw.type='lawmaker'
          WHERE l.from_id=p.id AND l.stance='oppose' AND l.type='money'
            AND (position(lower(split_part(lw.name,' ',array_length(string_to_array(lw.name,' '),1))) in lower(coalesce($3,''))) > 0)
      ) opp ON true LEFT JOIN nodes tgt ON tgt.id=opp.to_id
      WHERE m.from_id=$1 AND m.type='money' AND p.type IN ('pac','nonprofit') LIMIT 5`, [id, s.bill, s.bill_desc]);
    for (const a of against) flags.push({
      kind: "says vs. funds",
      text: a.kind === "bill" ? `Backed ${s.bill_name}, and funds ${a.pac}, which opposed it.` : `Backed ${s.bill_name}, and funds ${a.pac}, which spent against ${a.tgt}, named in the bill's description.`,
      said: { label: s.label, url: s.url, date: s.date },
      did: { label: a.opp_note ?? `${a.pac} opposed it`, url: a.opp_url, date: a.opp_date },
    });
  }
  // 2. Opposite stances on the same target from the same actor.
  const flips = await q<any>(`
    WITH st AS (
      SELECT target_id AS t, stance, url, pdate(date, date_prec) AS date, coalesce(excerpt, summary) AS label FROM feed_items WHERE node_id=$1 AND status='approved' AND stance IN ('support','oppose') AND target_id IS NOT NULL
      UNION ALL SELECT to_id, CASE WHEN stance='support_if_amended' THEN 'support' ELSE stance END, source_url, pdate(date_start, date_start_prec) AS date_start, coalesce(note, stance) FROM links WHERE from_id=$1 AND type='position' AND stance IN ('support','oppose','support_if_amended'))
    SELECT a.t, n.name, a.label AS a_label, a.url AS a_url, a.date AS a_date, b.label AS b_label, b.url AS b_url, b.date AS b_date
    FROM st a JOIN st b ON a.t=b.t AND a.stance='support' AND b.stance='oppose' JOIN nodes n ON n.id=a.t LIMIT 10`, [id]);
  for (const f of flips) flags.push({ kind: "both sides", text: `On record both for and against ${f.name}.`, said: { label: f.a_label, url: f.a_url, date: f.a_date }, did: { label: f.b_label, url: f.b_url, date: f.b_date } });
  // 3. Calls for safety rules in public; pays a committee that spends against candidates who back them.
  const pro = await q<any>(`SELECT url, pdate(date, date_prec) AS date, coalesce(excerpt, summary) AS label FROM feed_items WHERE node_id=$1 AND status='approved' AND stance='support'
                            AND issues && ARRAY['frontier safety','transparency','state laws']::text[] ORDER BY date DESC LIMIT 1`, [id]);
  if (pro[0]) {
    const opp = await q<any>(`SELECT p.name AS pac, l.note, l.source_url, pdate(l.date_start, l.date_start_prec) AS date FROM links m JOIN nodes p ON p.id=m.to_id JOIN links l ON l.from_id=p.id
                              WHERE m.from_id=$1 AND m.type='money' AND l.type='money' AND l.stance='oppose' ORDER BY l.amount DESC NULLS LAST LIMIT 1`, [id]);
    if (opp[0]) flags.push({ kind: "says vs. funds", text: `Speaks for safety rules; funds ${opp[0].pac}, which spends against candidates.`, said: pro[0], did: { label: opp[0].note ?? "", url: opp[0].source_url, date: opp[0].date } });
  }
  return flags;
}

// Coverage: how much of this profile's sourcing has been checked. "No record" is never a position, so the
// profile says how far the checks have got instead of letting an empty section read as "none exists".
export type Coverage = { cited: number; archived: number; checked: number; broken: number; last_checked: string | null; audit_run: boolean };
export async function getCoverage(id: string): Promise<Coverage> {
  "use cache";
  cached();
  const [r] = await q<Coverage>(`
    WITH u AS (
      SELECT source_url AS url FROM nodes WHERE id=$1
      UNION SELECT source_url FROM links WHERE from_id=$1 OR to_id=$1
      UNION SELECT url FROM feed_items WHERE node_id=$1 AND status='approved'
      UNION SELECT url FROM filings WHERE node_id=$1
      UNION SELECT url FROM facts WHERE node_id=$1)
    SELECT count(*)::int AS cited,
      count(a.archive_url)::int AS archived,
      count(c.url) FILTER (WHERE c.ok)::int AS checked,
      count(c.url) FILTER (WHERE NOT c.ok)::int AS broken,
      max(c.checked_at)::date::text AS last_checked,
      EXISTS (SELECT 1 FROM url_checks) AS audit_run
    FROM u LEFT JOIN archives a ON a.url=u.url LEFT JOIN url_checks c ON c.url=u.url`, [id]);
  return r;
}

export async function getTarget(id: string) {
  "use cache";
  cached();
  const s = await getNodeSummary(id);
  if (!s) return null;
  const pushes = await q<any>(`
    SELECT l.id::int, l.type, l.subtype, l.amount::float8 AS amount, pdate(l.date_start, l.date_start_prec) AS date_start, l.stance, l.note, l.source_url,
      a.id AS actor_id, a.name AS actor_name, a.type AS actor_type, a.cluster,
      (SELECT coalesce(sum(m.amount),0)::float8 FROM links m WHERE m.from_id=a.id AND m.type='money' AND m.subtype IN ('contribution','independent expenditure','donation','transfer')) AS actor_political_money
    FROM links l JOIN nodes a ON a.id=l.from_id WHERE l.to_id=$1 ORDER BY l.amount DESC NULLS LAST, l.date_start DESC NULLS LAST`, [id]);
  const statements = await q<any>(`SELECT f.*, pdate(f.date, f.date_prec) AS date, n.name AS actor_name FROM feed_items f JOIN nodes n ON n.id=f.node_id WHERE f.target_id=$1 AND f.status='approved' ORDER BY f.date DESC`, [id]);
  const candidates = s.node.type === "race" ? await q<any>(`SELECT id, name, descriptor FROM nodes WHERE type='lawmaker' AND external_ids->>'race'=$1`, [id]) : [];
  const candidatePushes = candidates.length ? await q<any>(`
    SELECT l.to_id AS candidate, l.stance, l.amount::float8 AS amount, pdate(l.date_start, l.date_start_prec) AS date_start, l.note, l.source_url, a.id AS actor_id, a.name AS actor_name
    FROM links l JOIN nodes a ON a.id=l.from_id WHERE l.to_id = ANY($1) ORDER BY l.amount DESC NULLS LAST`, [candidates.map((c) => c.id)]) : [];
  return { ...s, pushes, statements, candidates, candidatePushes };
}

export async function listTargets() {
  "use cache";
  cached();
  return q<any>(`SELECT n.id, n.type, n.name, n.descriptor, ${LANDS_CLUSTER} AS grp, count(l.id)::int AS pushes, count(DISTINCT l.from_id)::int AS actors,
      count(*) FILTER (WHERE l.subtype='lobbying')::int AS lobbying,
      coalesce(sum(l.amount) FILTER (WHERE l.type='money'),0)::float8 AS money,
      (SELECT count(*)::int FROM nodes c WHERE c.type='lawmaker' AND c.external_ids->>'race'=n.id) AS candidates,
      (SELECT coalesce(sum(l2.amount),0)::float8 FROM links l2 JOIN nodes c ON c.id=l2.to_id
        WHERE l2.type='money' AND c.type='lawmaker' AND c.external_ids->>'race'=n.id) AS race_money
    FROM nodes n
    LEFT JOIN LATERAL (SELECT max(extract(year FROM coalesce(date_end, date_start)))::int AS y FROM links WHERE to_id=n.id OR from_id=n.id) ly ON true
    LEFT JOIN links l ON l.to_id=n.id WHERE n.type IN ('bill','race','rule','lawmaker','agency')
    GROUP BY n.id, ly.y ORDER BY coalesce(sum(l.amount) FILTER (WHERE l.type='money'),0) DESC, count(l.id) DESC, n.name`);
}

export async function moneyFlows(start: string, depth = 4) {
  "use cache";
  cached();
  const rows = await q<any>(`
    WITH RECURSIVE walk(id, from_id, to_id, amount, date_start, note, source_url, subtype, stance, d, path) AS (
      SELECT id, from_id, to_id, amount::float8, pdate(date_start, date_start_prec) AS date_start, note, source_url, subtype, stance, 1, ARRAY[from_id, to_id]
        FROM links WHERE from_id=$1 AND type='money' AND subtype <> 'lobbying'
      UNION ALL
      SELECT l.id, l.from_id, l.to_id, l.amount::float8, pdate(l.date_start, l.date_start_prec) AS date_start, l.note, l.source_url, l.subtype, l.stance, w.d+1, w.path || l.to_id
        FROM links l JOIN walk w ON l.from_id=w.to_id
        WHERE l.type='money' AND l.subtype <> 'lobbying' AND w.d < $2 AND NOT l.to_id = ANY(w.path))
    SELECT DISTINCT ON (w.id) w.*, f.name AS from_name, t.name AS to_name, t.type AS to_type FROM walk w
      JOIN nodes f ON f.id=w.from_id JOIN nodes t ON t.id=w.to_id ORDER BY w.id, w.d`, [start, depth]);
  return rows;
}

export async function moneyStarts() {
  "use cache";
  cached();
  return q<{ id: string; name: string; type: string; out: number }>(`
    SELECT n.id, n.name, n.type, sum(l.amount)::float8 AS out FROM nodes n JOIN links l ON l.from_id=n.id AND l.type='money' AND l.subtype <> 'lobbying'
    GROUP BY n.id HAVING sum(l.amount) > 0 ORDER BY sum(l.amount) DESC`);
}

export { fmtMoney } from "./format";

// Home page: a readable overview of the record. Every row below links back to its source on the profile or target page.
// Money counts the first hop only (a tracked lab, person, investor or funder paying someone directly), so a dollar that
// moves on through a PAC is never counted twice. Each dollar is credited to whoever gave it.
const SOURCE_TYPES = `('lab','person','investor','funder')`;
export async function getHome() {
  "use cache";
  cached();
  const [counts] = await q<any>(`SELECT
      (SELECT count(DISTINCT n.id)::int FROM nodes n WHERE n.type NOT IN ('bill','race','rule','lawmaker','agency')) AS actors,
      (SELECT count(*)::int FROM feed_items WHERE status='approved' AND excerpt IS NOT NULL) AS quotes,
      (SELECT count(*)::int FROM links WHERE type='position') + (SELECT count(*)::int FROM feed_items WHERE status='approved' AND stance IS NOT NULL) AS stances,
      (SELECT coalesce(sum(l.amount),0)::float8 FROM links l JOIN nodes f ON f.id=l.from_id WHERE l.type='money' AND l.amount > 0 AND f.type IN ${SOURCE_TYPES}) AS direct,
      (SELECT count(*)::int FROM filings) AS filings,
      (SELECT count(DISTINCT u)::int FROM (SELECT source_url u FROM links UNION SELECT url FROM feed_items UNION SELECT url FROM filings UNION SELECT url FROM facts) x) AS sources`);
  const givers = await q<any>(`SELECT f.id, f.name, f.type, sum(l.amount)::float8 AS total, count(*)::int AS n, count(DISTINCT l.to_id)::int AS recipients
    FROM links l JOIN nodes f ON f.id=l.from_id WHERE l.type='money' AND l.amount > 0 AND f.type IN ${SOURCE_TYPES}
    GROUP BY f.id ORDER BY total DESC LIMIT 10`);
  const recipients = await q<any>(`SELECT t.id, t.name, t.type, t.descriptor, sum(l.amount)::float8 AS total, count(DISTINCT l.from_id)::int AS givers,
      (SELECT string_agg(name, ', ') FROM (SELECT f2.name FROM links l2 JOIN nodes f2 ON f2.id=l2.from_id WHERE l2.to_id=t.id AND l2.type='money' AND f2.type IN ${SOURCE_TYPES}
        GROUP BY f2.name ORDER BY sum(l2.amount) DESC NULLS LAST LIMIT 3) g) AS top_givers
    FROM links l JOIN nodes f ON f.id=l.from_id JOIN nodes t ON t.id=l.to_id
    WHERE l.type='money' AND l.amount > 0 AND f.type IN ${SOURCE_TYPES} GROUP BY t.id ORDER BY total DESC LIMIT 10`);
  // Stances toward a named bill or rule, from position links and from quotes with a stance. One row per actor and target: the latest.
  const stances = await q<any>(`
    WITH s AS (
      SELECT l.from_id AS actor, l.to_id AS target, l.stance, l.date_start AS d, pdate(l.date_start, l.date_start_prec) AS date, l.source_url AS url
        FROM links l JOIN nodes t ON t.id=l.to_id WHERE l.type='position' AND l.stance IS NOT NULL AND t.type IN ('bill','rule')
      UNION ALL
      SELECT fi.node_id, fi.target_id, fi.stance, fi.date, pdate(fi.date, fi.date_prec), fi.url
        FROM feed_items fi JOIN nodes t ON t.id=fi.target_id WHERE fi.status='approved' AND fi.stance IS NOT NULL AND t.type IN ('bill','rule')),
    latest AS (SELECT DISTINCT ON (actor, target) * FROM s ORDER BY actor, target, d DESC NULLS LAST)
    SELECT t.id, t.name, t.descriptor, json_agg(json_build_object('id', a.id, 'name', a.name, 'stance', latest.stance, 'date', latest.date, 'url', latest.url) ORDER BY a.name) AS actors
    FROM latest JOIN nodes t ON t.id=latest.target JOIN nodes a ON a.id=latest.actor
    WHERE a.type NOT IN ('lawmaker','agency')
    GROUP BY t.id HAVING count(*) FILTER (WHERE latest.stance IN ('support','oppose')) >= 3 ORDER BY count(*) DESC, t.name LIMIT 8`);
  const byYear = await q<any>(`SELECT extract(year FROM d)::int AS y,
      count(*) FILTER (WHERE st='support')::int AS support, count(*) FILTER (WHERE st='support_if_amended' OR st='mixed' OR st='neutral')::int AS mixed,
      count(*) FILTER (WHERE st='oppose')::int AS oppose
    FROM (SELECT l.date_start d, l.stance st FROM links l JOIN nodes a ON a.id=l.from_id WHERE l.type='position' AND l.stance IS NOT NULL AND a.type NOT IN ('lawmaker','agency')
          UNION ALL SELECT fi.date, fi.stance FROM feed_items fi JOIN nodes a ON a.id=fi.node_id WHERE fi.status='approved' AND fi.stance IS NOT NULL AND a.type NOT IN ('lawmaker','agency')) x
    WHERE d IS NOT NULL AND d >= '2019-01-01' GROUP BY 1 ORDER BY 1`);
  const quotes = await q<any>(`SELECT fi.id, fi.excerpt, pdate(fi.date, fi.date_prec) AS date, fi.url, fi.archive_url, fi.platform, n.id AS node_id, n.name, t.id AS target_id, t.name AS target_name
    FROM feed_items fi JOIN nodes n ON n.id=fi.node_id LEFT JOIN nodes t ON t.id=fi.target_id
    WHERE fi.status='approved' AND fi.excerpt IS NOT NULL AND fi.kind NOT IN ('donation','policy change','filing') AND n.type NOT IN ('lawmaker','agency') AND fi.date IS NOT NULL
    ORDER BY fi.date DESC, fi.id DESC LIMIT 12`);
  return { counts, givers, recipients, stances, byYear, quotes };
}

// Lands on: each target's latest stated position per actor, grouped into sides, so a row says who stood where.
export async function targetSides() {
  "use cache";
  cached();
  const rows = await q<{ target: string; side: string; names: { id: string; name: string }[]; n: number }>(`
    WITH s AS (
      SELECT l.from_id AS actor, l.to_id AS target, l.stance, l.date_start AS d FROM links l WHERE l.type='position' AND l.stance IS NOT NULL
      UNION ALL
      SELECT fi.node_id, fi.target_id, fi.stance, fi.date FROM feed_items fi WHERE fi.status='approved' AND fi.stance IS NOT NULL AND fi.target_id IS NOT NULL),
    latest AS (SELECT DISTINCT ON (actor, target) actor, target, stance FROM s ORDER BY actor, target, d DESC NULLS LAST)
    SELECT target, CASE WHEN stance='support' THEN 'support' WHEN stance='oppose' THEN 'oppose' ELSE 'mixed' END AS side,
      json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.name) AS names, count(*)::int AS n
    FROM latest JOIN nodes a ON a.id=latest.actor WHERE a.type NOT IN ('lawmaker','agency','bill','race','rule') GROUP BY 1, 2`);
  const out: Record<string, Record<string, { names: { id: string; name: string }[]; n: number }>> = {};
  for (const r of rows) (out[r.target] ??= {})[r.side] = { names: r.names, n: r.n };
  return out;
}

// ── Analysis (machine-classified; see scripts/analyze.ts and the methodology page) ──
// Labels used: the newest label per statement, own-voice only, confidence ≥ 0.6.
const LABELS = `(SELECT DISTINCT ON (sl.feed_id) sl.* FROM statement_labels sl ORDER BY sl.feed_id, sl.labeled_at DESC)`;
const GOOD = `l.own_voice AND l.confidence >= 0.6`;  // qualified: feed_items also has a confidence column
export type IssueRow = { id: string; label: string; description: string; positive: string; statements: number; actors: number; avg: number | null;
  plus: number; minus: number; neutral: number; money: number; money_givers: { id: string; name: string; total: number }[] };

export async function getAnalysis() {
  "use cache";
  cached();
  const [meta] = await q<any>(`SELECT count(*)::int AS labeled, count(*) FILTER (WHERE ${GOOD})::int AS used, max(model) AS model, max(labeled_at)::text AS at,
      (SELECT count(*)::int FROM feed_items WHERE status='approved' AND excerpt IS NOT NULL) AS quotes FROM ${LABELS} l`);
  if (!meta?.labeled) return null;
  // Per issue: how many statements address it, from how many actors, and the spread of stances.
  const issues = await q<any>(`
    WITH s AS (SELECT fi.node_id, e.key AS issue, e.value::int AS v FROM ${LABELS} l JOIN feed_items fi ON fi.id=l.feed_id, jsonb_each_text(l.issues) e WHERE ${GOOD})
    SELECT a.id, a.label, a.description, a.positive, count(s.issue)::int AS statements, count(DISTINCT s.node_id)::int AS actors,
      round(avg(s.v) FILTER (WHERE s.v <> 0), 2)::float8 AS avg,
      count(*) FILTER (WHERE s.v > 0)::int AS plus, count(*) FILTER (WHERE s.v < 0)::int AS minus, count(*) FILTER (WHERE s.v = 0)::int AS neutral
    FROM issue_areas a LEFT JOIN s ON s.issue=a.id GROUP BY a.id ORDER BY count(s.issue) DESC, a.sort`);
  // Money by issue: each recipient's issue mix comes from its own labeled statements (at least 2). A gift is split across
  // the recipient's issues in proportion to how often it speaks on each. Gifts to recipients without enough statements stay unassigned.
  const money = await q<any>(`
    WITH s AS (SELECT fi.node_id, e.key AS issue FROM ${LABELS} l JOIN feed_items fi ON fi.id=l.feed_id, jsonb_each_text(l.issues) e WHERE ${GOOD}),
    mix AS (SELECT node_id, issue, count(*)::float8 / sum(count(*)) OVER (PARTITION BY node_id) AS share FROM s GROUP BY 1, 2),
    enough AS (SELECT node_id FROM s GROUP BY 1 HAVING count(*) >= 2),
    gifts AS (SELECT l.from_id, l.to_id, l.amount::float8 AS amount FROM links l JOIN nodes f ON f.id=l.from_id
      WHERE l.type='money' AND l.amount > 0 AND coalesce(l.subtype,'') <> 'lobbying' AND f.type IN ${SOURCE_TYPES})
    SELECT m.issue, g.from_id, f.name, sum(g.amount * m.share)::float8 AS total
    FROM gifts g JOIN enough e ON e.node_id=g.to_id JOIN mix m ON m.node_id=g.to_id JOIN nodes f ON f.id=g.from_id GROUP BY 1, 2, 3`);
  const [cover] = await q<any>(`
    WITH s AS (SELECT fi.node_id FROM ${LABELS} l JOIN feed_items fi ON fi.id=l.feed_id, jsonb_each_text(l.issues) e WHERE ${GOOD}),
    enough AS (SELECT node_id FROM s GROUP BY 1 HAVING count(*) >= 2)
    SELECT coalesce(sum(l.amount) FILTER (WHERE l.to_id IN (SELECT node_id FROM enough)),0)::float8 AS assigned, coalesce(sum(l.amount),0)::float8 AS total
    FROM links l JOIN nodes f ON f.id=l.from_id WHERE l.type='money' AND l.amount > 0 AND coalesce(l.subtype,'') <> 'lobbying' AND f.type IN ${SOURCE_TYPES}`);
  const rows: IssueRow[] = issues.map((i: any) => {
    const ms = money.filter((m: any) => m.issue === i.id).sort((a: any, b: any) => b.total - a.total);
    return { ...i, money: ms.reduce((x: number, m: any) => x + m.total, 0), money_givers: ms.slice(0, 3).map((m: any) => ({ id: m.from_id, name: m.name, total: m.total })) };
  });
  const tone = await q<any>(`SELECT extract(year FROM fi.date)::int AS y, round(avg(l.tone), 2)::float8 AS avg, count(*)::int AS n
    FROM ${LABELS} l JOIN feed_items fi ON fi.id=l.feed_id WHERE ${GOOD} AND l.tone IS NOT NULL AND fi.date >= '2019-01-01' GROUP BY 1 ORDER BY 1`);
  return { meta, issues: rows, cover, tone };
}

// One actor's issue profile: stance per issue with the statements behind it.
export async function getActorIssues(id: string) {
  "use cache";
  cached();
  return q<any>(`
    SELECT a.id, a.label, a.positive, round(avg(e.value::int) FILTER (WHERE e.value::int <> 0), 1)::float8 AS avg, count(*)::int AS n,
      json_agg(json_build_object('feed_id', fi.id, 'v', e.value::int, 'excerpt', fi.excerpt, 'url', fi.url, 'date', pdate(fi.date, fi.date_prec), 'reason', l.reason) ORDER BY fi.date DESC) AS items
    FROM ${LABELS} l JOIN feed_items fi ON fi.id=l.feed_id, jsonb_each_text(l.issues) e JOIN issue_areas a ON a.id=e.key
    WHERE fi.node_id=$1 AND fi.status='approved' AND ${GOOD}
    GROUP BY a.id ORDER BY count(*) DESC, a.sort`, [id]);
}

// ── Lobbying and grants by issue (topic tags from the filed text; see scripts/tag-filings.ts) ──
// The newest tag row per filing or grant. Tags name topics only, never a position.
const FILING_TAGS = `(SELECT DISTINCT ON (t.source_kind, t.source_id) t.* FROM filing_issue_tags t ORDER BY t.source_kind, t.source_id, t.tagged_at DESC)`;
export type LobbyIssue = { id: string; label: string; n: number;
  filings: { id: number; period: string | null; filed: string | null; url: string }[];
  grants: { id: number; dir: "out" | "in"; other_id: string; other_name: string; date: string | null; url: string }[] };

// One actor's LDA filings (as client) and grants (given or received), grouped by the issues their own text names.
export async function getActorLobbyingIssues(id: string): Promise<LobbyIssue[]> {
  "use cache";
  cached();
  const filings = await q<any>(`
    SELECT i AS issue, f.id::int, f.period, f.filed_date::text AS filed, f.url
    FROM ${FILING_TAGS} t JOIN filings f ON t.source_kind='filing' AND f.id=t.source_id, unnest(t.issues) i
    WHERE f.node_id=$1 ORDER BY f.filed_date DESC NULLS LAST, f.id`, [id]);
  const grants = await q<any>(`
    SELECT i AS issue, l.id::int, CASE WHEN l.from_id=$1 THEN 'out' ELSE 'in' END AS dir,
      o.id AS other_id, o.name AS other_name, l.date_start::text AS date, l.source_url AS url
    FROM ${FILING_TAGS} t JOIN links l ON t.source_kind='grant' AND l.id=t.source_id
      JOIN nodes o ON o.id = CASE WHEN l.from_id=$1 THEN l.to_id ELSE l.from_id END, unnest(t.issues) i
    WHERE $1 IN (l.from_id, l.to_id) ORDER BY l.date_start DESC NULLS LAST, l.id`, [id]);
  const areas = await q<any>(`SELECT id, label FROM issue_areas ORDER BY sort`);
  return areas.map((a: any) => {
    const fs = filings.filter((f: any) => f.issue === a.id).map(({ issue, ...f }: any) => f);
    const gs = grants.filter((g: any) => g.issue === a.id).map(({ issue, ...g }: any) => g);
    return { id: a.id, label: a.label, n: fs.length, filings: fs, grants: gs };
  }).filter((r) => r.filings.length || r.grants.length).sort((x, y) => y.n - x.n || y.grants.length - x.grants.length);
}

// Per issue: how many LDA filings name it, from how many actors (the filing's client).
export async function getLobbyingByIssue(): Promise<Record<string, { filings: number; actors: number }>> {
  "use cache";
  cached();
  const rows = await q<any>(`
    SELECT i AS issue, count(DISTINCT f.id)::int AS filings, count(DISTINCT f.node_id)::int AS actors
    FROM ${FILING_TAGS} t JOIN filings f ON t.source_kind='filing' AND f.id=t.source_id, unnest(t.issues) i GROUP BY 1`);
  return Object.fromEntries(rows.map((r: any) => [r.issue, { filings: r.filings, actors: r.actors }]));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Workstream D (money chains). Reads money_chains / money_hops, built by web/scripts/pipelines/money/.
// One row per distinct pair of parties. Amounts are pool-level totals of the filed lines between the pair: a chain does not trace one
// donor's dollars through a PAC (the filings never say which receipt funded which spend). Undisclosed hops have from_id
// "undisclosed:<entity id>", the name "Undisclosed donors" and a null amount: never a person, never a guessed donor.
const CHAIN_EDGES = `
  SELECT coalesce(h.from_id, 'undisclosed:' || h.to_id) AS from_id, h.to_id, h.hop_basis,
         coalesce(f.name, 'Undisclosed donors') AS from_name, t.name AS to_name, t.type AS to_type,
         max(h.amount)::float8 AS amount, min(h.source_url) AS source_url, min(h.archive_url) AS archive_url, max(h.date)::text AS date,
         (SELECT max(CASE x.support_oppose WHEN 'S' THEN 'support' WHEN 'O' THEN 'oppose' END) FROM money_x_hop_txns ht JOIN money_x_fec_tx x ON x.id=ht.tx_id WHERE ht.hop_id = (array_agg(h.id))[1]) AS stance,
         (SELECT count(*)::int FROM money_x_hop_txns ht WHERE ht.hop_id = (array_agg(h.id))[1]) AS n_lines
    FROM money_hops h JOIN nodes t ON t.id=h.to_id LEFT JOIN nodes f ON f.id=h.from_id
   GROUP BY 1, 2, 3, 4, 5, 6, (CASE WHEN h.hop_basis='disclosed' THEN coalesce((SELECT max(x.support_oppose) FROM money_x_hop_txns ht JOIN money_x_fec_tx x ON x.id=ht.tx_id WHERE ht.hop_id=h.id), '') ELSE '' END)`;

// Same shape as moneyFlows() so the existing <MoneyFlow> component can draw it, plus basis/archive_url/n_lines.
// `start` may be an actor id or "undisclosed:<entity id>" to start from an Undisclosed-donors placeholder.
export async function moneyChainFlows(start: string, depth = 4) {
  "use cache";
  cached();
  return q<any>(`
    WITH RECURSIVE edge AS (${CHAIN_EDGES}),
    walk(from_id, to_id, from_name, to_name, to_type, amount, source_url, archive_url, date, stance, hop_basis, n_lines, d, path) AS (
      SELECT from_id, to_id, from_name, to_name, to_type, amount, source_url, archive_url, date, stance, hop_basis, n_lines, 1, ARRAY[from_id, to_id] FROM edge WHERE from_id=$1
      UNION ALL
      SELECT e.from_id, e.to_id, e.from_name, e.to_name, e.to_type, e.amount, e.source_url, e.archive_url, e.date, e.stance, e.hop_basis, e.n_lines, w.d+1, w.path || e.to_id
        FROM edge e JOIN walk w ON e.from_id=w.to_id WHERE w.d < $2 AND NOT e.to_id = ANY(w.path))
    SELECT DISTINCT ON (from_id, to_id, stance) *, (hop_basis='undisclosed') AS undisclosed FROM walk ORDER BY from_id, to_id, stance, d`, [start, depth]);
}

// Starting points for the Follow-the-money picker: sources with filed or self-reported outflow, plus Undisclosed-donors placeholders.
export async function moneyChainStarts() {
  "use cache";
  cached();
  return q<{ id: string; name: string; type: string; out: number | null; basis: string }>(`
    WITH edge AS (${CHAIN_EDGES})
    SELECT from_id AS id, from_name AS name, CASE WHEN hop_basis='undisclosed' THEN 'undisclosed' ELSE (SELECT type FROM nodes WHERE id=edge.from_id) END AS type,
           sum(amount)::float8 AS out, min(hop_basis) AS basis
      FROM edge WHERE from_id NOT IN (SELECT id FROM nodes WHERE type='lawmaker')
      GROUP BY from_id, from_name, hop_basis HAVING hop_basis='undisclosed' OR sum(amount) > 0
        AND from_id NOT IN (SELECT to_id FROM edge e2 WHERE e2.hop_basis<>'undisclosed' AND e2.to_type IN ('pac','nonprofit') AND e2.from_id <> edge.from_id)
      ORDER BY (hop_basis='undisclosed'), sum(amount) DESC NULLS LAST`);
}

// Totals by source actor, by target race and by committee, with disclosed / self-reported / undisclosed-upstream shares.
export async function moneyChainSummary() {
  "use cache";
  cached();
  const [bySource, byRace, byCommittee, reconcile, counts] = await Promise.all([
    q<any>(`WITH edge AS (${CHAIN_EDGES})
      SELECT e.from_id AS id, e.from_name AS name, sum(e.amount) FILTER (WHERE e.hop_basis='disclosed')::float8 AS disclosed, sum(e.amount) FILTER (WHERE e.hop_basis='self_reported')::float8 AS self_reported,
             array_agg(DISTINCT e.to_name) AS to_names
        FROM edge e JOIN nodes f ON f.id=e.from_id WHERE e.to_type='pac' AND e.hop_basis<>'undisclosed' AND f.type IN ('person','lab','investor','funder')
         OR (e.hop_basis='self_reported')
        GROUP BY 1, 2 ORDER BY coalesce(sum(e.amount),0) DESC LIMIT 30`),
    q<any>(`WITH edge AS (${CHAIN_EDGES})
      SELECT coalesce(n.external_ids->>'race', e.to_id) AS race_id, coalesce(r.name, e.to_name) AS race, sum(e.amount) FILTER (WHERE e.stance='support')::float8 AS support,
             sum(e.amount) FILTER (WHERE e.stance='oppose')::float8 AS oppose, sum(e.amount)::float8 AS total, array_agg(DISTINCT e.from_name) AS spenders
        FROM edge e JOIN nodes n ON n.id=e.to_id AND n.type='lawmaker' LEFT JOIN nodes r ON r.id=n.external_ids->>'race' GROUP BY 1, 2 ORDER BY total DESC LIMIT 40`),
    q<any>(`WITH edge AS (${CHAIN_EDGES}), opaque AS (SELECT to_id AS id FROM edge WHERE hop_basis='undisclosed')
      SELECT e.to_id AS id, e.to_name AS name, sum(e.amount)::float8 AS itemized_in,
             sum(e.amount) FILTER (WHERE e.from_id IN (SELECT id FROM opaque))::float8 AS via_undisclosed_intermediary,
             sum(e.amount) FILTER (WHERE e.hop_basis='self_reported')::float8 AS self_reported_in
        FROM edge e WHERE e.to_type IN ('pac','nonprofit') AND e.hop_basis<>'undisclosed' GROUP BY 1, 2 ORDER BY itemized_in DESC NULLS LAST`),
    q<any>(`SELECT count(*) FILTER (WHERE status='ok')::int AS ok, count(*) FILTER (WHERE status='explained')::int AS explained, count(*) FILTER (WHERE status='open')::int AS open FROM money_x_reconcile`),
    q<any>(`SELECT (SELECT count(*)::int FROM money_chains) AS chains, (SELECT count(*)::int FROM money_hops) AS hops,
             (SELECT count(*)::int FROM money_hops WHERE hop_basis='undisclosed') AS undisclosed_hops, (SELECT count(*)::int FROM money_hops WHERE hop_basis='self_reported') AS self_reported_hops`),
  ]);
  return { bySource, byRace, byCommittee, reconcile: reconcile[0], counts: counts[0] };
}

// Ad spend as filed (FEC Schedule E): which PAC ran what, for or against whom, where and when.
export async function moneyAds(node: string, limit = 50) {
  "use cache";
  cached();
  return q<any>(`SELECT a.id, a.amount::float8 AS amount, a.start_date::text AS date, a.placement, a.description, a.support_oppose, a.target_node, a.target_label, a.source_url, a.archive_url
    FROM money_x_ads a WHERE a.node_id=$1 ORDER BY a.start_date DESC NULLS LAST, a.amount DESC LIMIT $2`, [node, limit]);

// Where a merged-away id now lives, following chains of applied merges. Null if the id was never merged.
export async function getMergedInto(id: string): Promise<string | null> {
  let cur = id;
  for (let i = 0; i < 5; i++) {
    const r = await q<{ kept_id: string }>(`SELECT kept_id FROM merge_log WHERE action='merge' AND status='applied' AND reverted_at IS NULL AND merged_id=$1 ORDER BY applied_at DESC LIMIT 1`, [cur]);
    if (!r.length) break;
    cur = r[0].kept_id;
  }
  return cur === id ? null : cur;
}
