import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { q } from "./db";
import { buildLinker, type Part } from "./linkify";

// Every public read is cached under one tag with the "record" profile (next.config.ts): served from cache, refreshed in
// the background once it is a minute old. Writes clear it: review actions call updateTag("record"); importers and the
// loader POST to /api/revalidate (localhost only). Pages await these outside <Suspense> so the result is built into the
// page at build time and a visit needs no database query.
export const RECORD_TAG = "record";
function cached() { cacheLife("record"); cacheTag(RECORD_TAG); }

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
  const [nodes, links] = await Promise.all([q<GNode>(`
    SELECT n.id, n.type, n.name, n.descriptor, ${LANDS_CLUSTER} AS cluster, n.source_url,
      coalesce((SELECT array_agg(DISTINCT i) FROM feed_items f, unnest(f.issues) i WHERE f.node_id=n.id AND f.status='approved'), '{}') AS issues,
      (SELECT min(d)::text FROM (SELECT min(date_start) d FROM links WHERE from_id=n.id OR to_id=n.id UNION ALL SELECT min(date) FROM feed_items WHERE node_id=n.id AND status='approved') x) AS first_date
    FROM nodes n
    LEFT JOIN LATERAL (SELECT max(extract(year FROM coalesce(date_end, date_start)))::int AS y FROM links WHERE to_id=n.id OR from_id=n.id) ly ON true`),
  q<GLink>(`
    -- note is left out: the map never shows it, and it is most of the payload. Profiles read it separately.
    SELECT id::int, from_id AS "from", to_id AS "to", type, subtype, amount::float8 AS amount, pdate(date_start, date_start_prec) AS date_start, pdate(date_end, date_end_prec) AS date_end, stance, NULL::text AS note, source_url
    FROM links_shown WHERE NOT (type='money' AND subtype='lobbying' AND amount IS NULL)
    UNION ALL (
    -- Lobbying contacts without an amount arrive once per quarterly filing. The map shows one line per pair,
    -- sourced to the most recent filing; every filing is still listed on the profile.
    SELECT DISTINCT ON (from_id, to_id) id::int, from_id, to_id, type, subtype, NULL::float8, pdate(date_start, date_start_prec) AS date_start,
      (max(coalesce(date_end, date_start)) OVER (PARTITION BY from_id, to_id))::text,
      stance, NULL::text, source_url
    FROM links_shown WHERE type='money' AND subtype='lobbying' AND amount IS NULL
    ORDER BY from_id, to_id, date_start DESC NULLS LAST)`)]);
  return { nodes, links };
}

// Names of other tracked actors inside a note link to their profiles. One cached list serves every profile.
async function nodeNames() {
  "use cache";
  cached();
  return q<{ id: string; name: string }>(`SELECT id, name FROM nodes`);
}

export async function getNodeSummary(id: string) {
  "use cache";
  cached();
  // Labeled facts (Founded, Leader, Website...) form the key-facts block; unlabeled ones are notes.
  const [[node], keyFacts, raw, names, [stats]] = await Promise.all([
    q<GNode & { external_ids: any; archive_url: string | null; logo_url: string | null; logo_source_url: string | null }>(`SELECT * FROM nodes WHERE id=$1`, [id]),
    q<{ label: string; text: string; url: string }>(`SELECT DISTINCT ON (label) label, text, url FROM facts WHERE node_id=$1 AND label IS NOT NULL ORDER BY label, id DESC`, [id]),
    q<{ text: string; url: string }>(`SELECT text, url FROM facts WHERE node_id=$1 AND label IS NULL ORDER BY id LIMIT 8`, [id]),
    nodeNames(),
    q<{ money_out: number; money_in: number; links: number; feed: number; filings: number }>(`
    SELECT (SELECT coalesce(sum(amount),0)::float8 FROM links_shown WHERE from_id=$1 AND type='money' AND subtype <> 'lobbying') AS money_out,
           (SELECT coalesce(sum(amount),0)::float8 FROM links_shown WHERE to_id=$1 AND type='money' AND subtype <> 'lobbying') AS money_in,
           (SELECT count(*)::int FROM links WHERE from_id=$1 OR to_id=$1) AS links,
           (SELECT count(*)::int FROM feed_items WHERE node_id=$1 AND status='approved') AS feed,
           (SELECT count(*)::int FROM filings WHERE node_id=$1) AS filings`, [id]),
  ]);
  if (!node) return null;
  keyFacts.sort((a, b) => FACT_ORDER.indexOf(a.label) - FACT_ORDER.indexOf(b.label));
  const link = buildLinker(names);
  const facts: { text: string; url: string; parts: Part[] }[] = raw.map((f) => ({ ...f, parts: link(f.text, id) }));
  return { node, facts, keyFacts, stats };
}

export async function getProfile(id: string) {
  "use cache";
  cached();
  const s = await getNodeSummary(id);
  if (!s) return null;
  const [feed, filings, links] = await Promise.all([q<any>(`SELECT f.*, pdate(f.date, f.date_prec) AS date, t.name AS target_name FROM feed_items f LEFT JOIN nodes t ON t.id=f.target_id
                             WHERE f.node_id=$1 AND f.status='approved' ORDER BY f.date DESC, f.id DESC`, [id]),
  q<any>(`SELECT *, pdate(filed_date, filed_prec) AS filed_date, amount::float8 AS amount FROM filings WHERE node_id=$1
                                ORDER BY coalesce(filed_date, to_date(substring(period from '\\d{4}'), 'YYYY')) DESC NULLS LAST, id DESC`, [id]),
  q<any>(`
    SELECT l.id::int, l.type, l.subtype, l.amount::float8 AS amount, pdate(l.date_start, l.date_start_prec) AS date_start, pdate(l.date_end, l.date_end_prec) AS date_end, l.stance, l.note, l.source_url,
      CASE WHEN l.from_id=$1 THEN 'out' ELSE 'in' END AS dir,
      o.id AS other_id, o.name AS other_name, o.type AS other_type, o.descriptor AS other_descriptor
    FROM links_shown l JOIN nodes o ON o.id = CASE WHEN l.from_id=$1 THEN l.to_id ELSE l.from_id END
    WHERE l.from_id=$1 OR l.to_id=$1 ORDER BY l.date_start DESC NULLS LAST`, [id])]);
  return { ...s, feed, filings, links };
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
  const [pushes, statements, candidates] = await Promise.all([q<any>(`
    SELECT l.id::int, l.type, l.subtype, l.amount::float8 AS amount, pdate(l.date_start, l.date_start_prec) AS date_start, l.stance, l.note, l.source_url,
      a.id AS actor_id, a.name AS actor_name, a.type AS actor_type, a.cluster,
      (SELECT coalesce(sum(m.amount),0)::float8 FROM links_shown m WHERE m.from_id=a.id AND m.type='money' AND m.subtype IN ('contribution','independent expenditure','donation','transfer')) AS actor_political_money
    FROM links_shown l JOIN nodes a ON a.id=l.from_id WHERE l.to_id=$1 ORDER BY l.amount DESC NULLS LAST, l.date_start DESC NULLS LAST`, [id]),
  q<any>(`SELECT f.*, pdate(f.date, f.date_prec) AS date, n.name AS actor_name FROM feed_items f JOIN nodes n ON n.id=f.node_id WHERE f.target_id=$1 AND f.status='approved' ORDER BY f.date DESC`, [id]),
  s.node.type === "race" ? q<any>(`SELECT id, name, descriptor FROM nodes WHERE type='lawmaker' AND external_ids->>'race'=$1`, [id]) : [] as any[]]);
  const candidatePushes = candidates.length ? await q<any>(`
    SELECT l.to_id AS candidate, l.stance, l.amount::float8 AS amount, pdate(l.date_start, l.date_start_prec) AS date_start, l.note, l.source_url, a.id AS actor_id, a.name AS actor_name
    FROM links_shown l JOIN nodes a ON a.id=l.from_id WHERE l.to_id = ANY($1) ORDER BY l.amount DESC NULLS LAST`, [candidates.map((c) => c.id)]) : [];
  return { ...s, pushes, statements, candidates, candidatePushes };
}

export async function listTargets() {
  "use cache";
  cached();
  return q<any>(`SELECT n.id, n.type, n.name, n.descriptor, ${LANDS_CLUSTER} AS grp, count(l.id)::int AS pushes, count(DISTINCT l.from_id)::int AS actors,
      count(*) FILTER (WHERE l.subtype='lobbying')::int AS lobbying,
      coalesce(sum(l.amount) FILTER (WHERE l.type='money'),0)::float8 AS money,
      (SELECT count(*)::int FROM nodes c WHERE c.type='lawmaker' AND c.external_ids->>'race'=n.id) AS candidates,
      (SELECT coalesce(sum(l2.amount),0)::float8 FROM links_shown l2 JOIN nodes c ON c.id=l2.to_id
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
        FROM links_shown WHERE from_id=$1 AND type='money' AND subtype <> 'lobbying'
      UNION ALL
      SELECT l.id, l.from_id, l.to_id, l.amount::float8, pdate(l.date_start, l.date_start_prec) AS date_start, l.note, l.source_url, l.subtype, l.stance, w.d+1, w.path || l.to_id
        FROM links_shown l JOIN walk w ON l.from_id=w.to_id
        WHERE l.type='money' AND l.subtype <> 'lobbying' AND w.d < $2 AND NOT l.to_id = ANY(w.path))
    SELECT DISTINCT ON (w.id) w.*, f.name AS from_name, t.name AS to_name, t.type AS to_type FROM walk w
      JOIN nodes f ON f.id=w.from_id JOIN nodes t ON t.id=w.to_id ORDER BY w.id, w.d`, [start, depth]);
  return rows;
}

export async function moneyStarts() {
  "use cache";
  cached();
  return q<{ id: string; name: string; type: string; out: number }>(`
    SELECT n.id, n.name, n.type, sum(l.amount)::float8 AS out FROM nodes n JOIN links_shown l ON l.from_id=n.id AND l.type='money' AND l.subtype <> 'lobbying'
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
      (SELECT coalesce(sum(l.amount),0)::float8 FROM links_shown l JOIN nodes f ON f.id=l.from_id WHERE l.type='money' AND l.amount > 0 AND f.type IN ${SOURCE_TYPES}) AS direct,
      (SELECT count(*)::int FROM filings) AS filings,
      (SELECT count(DISTINCT u)::int FROM (SELECT source_url u FROM links UNION SELECT url FROM feed_items UNION SELECT url FROM filings UNION SELECT url FROM facts) x) AS sources`);
  const givers = await q<any>(`SELECT f.id, f.name, f.type, sum(l.amount)::float8 AS total, count(*)::int AS n, count(DISTINCT l.to_id)::int AS recipients
    FROM links_shown l JOIN nodes f ON f.id=l.from_id WHERE l.type='money' AND l.amount > 0 AND f.type IN ${SOURCE_TYPES}
    GROUP BY f.id ORDER BY total DESC LIMIT 10`);
  const recipients = await q<any>(`SELECT t.id, t.name, t.type, t.descriptor, sum(l.amount)::float8 AS total, count(DISTINCT l.from_id)::int AS givers,
      (SELECT string_agg(name, ', ') FROM (SELECT f2.name FROM links_shown l2 JOIN nodes f2 ON f2.id=l2.from_id WHERE l2.to_id=t.id AND l2.type='money' AND f2.type IN ${SOURCE_TYPES}
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
  // The date this overview was computed, read inside the cache so the page itself has no clock to wait on.
  const today = new Date().toISOString().slice(0, 10);
  return { counts, givers, recipients, stances, byYear, quotes, today };
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
    gifts AS (SELECT l.from_id, l.to_id, l.amount::float8 AS amount FROM links_shown l JOIN nodes f ON f.id=l.from_id
      WHERE l.type='money' AND l.amount > 0 AND coalesce(l.subtype,'') <> 'lobbying' AND f.type IN ${SOURCE_TYPES})
    SELECT m.issue, g.from_id, f.name, sum(g.amount * m.share)::float8 AS total
    FROM gifts g JOIN enough e ON e.node_id=g.to_id JOIN mix m ON m.node_id=g.to_id JOIN nodes f ON f.id=g.from_id GROUP BY 1, 2, 3`);
  const [cover] = await q<any>(`
    WITH s AS (SELECT fi.node_id FROM ${LABELS} l JOIN feed_items fi ON fi.id=l.feed_id, jsonb_each_text(l.issues) e WHERE ${GOOD}),
    enough AS (SELECT node_id FROM s GROUP BY 1 HAVING count(*) >= 2)
    SELECT coalesce(sum(l.amount) FILTER (WHERE l.to_id IN (SELECT node_id FROM enough)),0)::float8 AS assigned, coalesce(sum(l.amount),0)::float8 AS total
    FROM links_shown l JOIN nodes f ON f.id=l.from_id WHERE l.type='money' AND l.amount > 0 AND coalesce(l.subtype,'') <> 'lobbying' AND f.type IN ${SOURCE_TYPES}`);
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
// The prompt version shown on the site: the one that measured best in data/validation/filing-tags-report.md.
const FILING_TAGS_VERSION = "t5";
const FILING_TAGS = `(SELECT DISTINCT ON (t.source_kind, t.source_id) t.* FROM filing_issue_tags t WHERE t.prompt_version = '${FILING_TAGS_VERSION}' ORDER BY t.source_kind, t.source_id, t.tagged_at DESC)`;
export type LobbyIssue = { id: string; label: string; n: number;
  filings: { id: number; period: string | null; filed: string | null; url: string; archive_url: string | null; amount: number | null; firm: string | null; items: string[] }[];
  grants: { id: number; dir: "out" | "in"; other_id: string; other_name: string; date: string | null; url: string }[] };

// One actor's LDA filings (as client) and grants (given or received), grouped by the issues their own text names.
// An LDA description reads "3rd Quarter - Report. Via TOWER 19. Issues related to X | Issues related to Y". Split it into the
// lobbying firm and the listed items, each cut to 25 words, in the filing's own words.
function lobbyItems(d: string | null): { firm: string | null; items: string[] } {
  if (!d) return { firm: null, items: [] };
  let rest = d.replace(/^[^.]*(Quarter|Report|Year|Termination|Amendment)[^.]*\.\s*/i, "");
  const via = rest.match(/^Via (.+?)\.\s+/);
  const inHouse = !via && /^In-house\.\s*/i.test(rest);
  const firm = via ? via[1].replace(/\.$/, "").trim() : inHouse ? "its own staff" : null;
  if (via) rest = rest.slice(via[0].length); else if (inHouse) rest = rest.replace(/^In-house\.\s*/i, "");
  const items = [...new Set(rest.split(/\s*\|\s*/).map((x) => x.trim().replace(/\.$/, "")).filter(Boolean))]
    // "Issues related to Artificial Intelligence in the FY24 NDAA" -> "FY24 NDAA": the boilerplate opening repeats on every item.
    .map((x) => x.replace(/^issues? (related to|regarding|concerning|pertaining to)\s+/i, "").replace(/^(artificial intelligence|AI)( policy| technology| issues)?(,?\s*(generally|in general))?\s*(,|;|:|and|in|including|related to|regarding|for|on)?\s*(the\s+)?/i, "").trim())
    .map((x) => x ? x[0].toUpperCase() + x.slice(1) : "AI in general")
    .map((x) => { const w = x.split(/\s+/); return w.length > 25 ? w.slice(0, 25).join(" ") + " …" : x; });
  return { firm, items };
}

export async function getActorLobbyingIssues(id: string): Promise<LobbyIssue[]> {
  "use cache";
  cached();
  const [filings, grants, areas] = await Promise.all([q<any>(`
    SELECT i AS issue, f.id::int, f.period, f.filed_date::text AS filed, f.url, f.archive_url, f.amount::float8 AS amount, f.description
    FROM ${FILING_TAGS} t JOIN filings f ON t.source_kind='filing' AND f.id=t.source_id, unnest(t.issues) i
    WHERE f.node_id=$1 ORDER BY f.filed_date DESC NULLS LAST, f.id`, [id]),
    q<any>(`
    SELECT i AS issue, l.id::int, CASE WHEN l.from_id=$1 THEN 'out' ELSE 'in' END AS dir,
      o.id AS other_id, o.name AS other_name, l.date_start::text AS date, l.source_url AS url
    FROM ${FILING_TAGS} t JOIN links l ON t.source_kind='grant' AND l.id=t.source_id
      JOIN nodes o ON o.id = CASE WHEN l.from_id=$1 THEN l.to_id ELSE l.from_id END, unnest(t.issues) i
    WHERE $1 IN (l.from_id, l.to_id) ORDER BY l.date_start DESC NULLS LAST, l.id`, [id]),
    q<any>(`SELECT id, label FROM issue_areas ORDER BY sort`)]);
  return areas.map((a: any) => {
    const fs = filings.filter((f: any) => f.issue === a.id).map(({ issue, description, ...f }: any) => ({ ...f, ...lobbyItems(description) }));
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

// ---- Said and did: reviewed conflict flags (Workstream C). Only flags a reviewer approved. ------------------------------
export type FlagEvidence = { label: string; url: string; archive_url: string | null; date: string | null };
export type ApprovedFlag = { id: number; type: "statement_vs_action" | "statement_vs_money" | "commitment_weakened" | "reversal_near_event";
  target_id: string | null; target_name: string | null; severity: number; description: string; said: FlagEvidence[]; did: FlagEvidence[] };
export async function approvedConflictFlags(id: string): Promise<ApprovedFlag[]> {
  "use cache";
  cached();
  return q<ApprovedFlag>(`
    SELECT f.id, f.type, f.target_id, t.name AS target_name, f.severity, f.description, f.said_evidence AS said, f.did_evidence AS did
    FROM conflict_flags f LEFT JOIN nodes t ON t.id = f.target_id
    WHERE f.node_id = $1 AND f.status = 'approved' ORDER BY f.severity DESC, f.created_at DESC`, [id]);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Workstream D (money chains). Reads money_chains / money_hops, built by web/scripts/pipelines/money/.
// One row per distinct pair of parties. Amounts are pool-level totals of the filed lines between the pair: a chain does not trace one
// donor's dollars through a PAC (the filings never say which receipt funded which spend). Undisclosed hops have from_id
// "undisclosed:<entity id>", the name "Undisclosed donors" and a null amount: never a person, never a guessed donor.
// The grouping lives in the money_edges view (db/migrations/193, over money_hops_shown since 196), shared with scripts/pipelines/money/export.ts.
const CHAIN_EDGES = `SELECT * FROM money_edges`;

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
}

// Where a merged-away id now lives, following chains of applied merges. Null if the id was never merged.
export async function getMergedInto(id: string): Promise<string | null> {
  "use cache";
  cached();
  let cur = id;
  for (let i = 0; i < 5; i++) {
    const r = await q<{ kept_id: string }>(`SELECT kept_id FROM merge_log WHERE action='merge' AND status='applied' AND reverted_at IS NULL AND merged_id=$1 ORDER BY applied_at DESC LIMIT 1`, [cur]);
    if (!r.length) break;
    cur = r[0].kept_id;
  }
  return cur === id ? null : cur;
}

// ── Notable topics (table `topics`) ──
// Where each actor stands on each topic, from three kinds of evidence: quotes labeled on the topic itself (topic_labels),
// quotes labeled on the issue a topic reuses (statement_labels via topics.issue_id), and public letters the person signed
// (topic_positions). Quote readings are machine labels; a signature is the person's own public act.
export type TopicEvidence = { kind: "quote" | "letter"; v: number; text: string; url: string; archive_url: string | null; date: string | null; doc?: string };
export type TopicActor = { id: string; name: string; type: string; avg: number; items: TopicEvidence[] };
export type TopicRow = { id: string; label: string; description: string; positive: string; agree: TopicActor[]; neutral: TopicActor[]; disagree: TopicActor[] };
export async function getTopics(): Promise<TopicRow[]> {
  "use cache";
  cached();
  const topics = await q<any>(`SELECT id, label, description, positive, issue_id FROM topics ORDER BY sort`);
  const rows = await q<any>(`
    SELECT t.id AS topic, fi.node_id, tl.answer::int AS v, 'quote' AS kind, fi.excerpt AS text, fi.url, fi.archive_url, pdate(fi.date, fi.date_prec)::text AS date, NULL AS doc
      FROM topic_labels tl JOIN topics t ON t.id=tl.topic_id JOIN feed_items fi ON fi.id=tl.feed_id
     WHERE tl.answer IS NOT NULL AND fi.status='approved'
    UNION ALL
    SELECT t.id, fi.node_id, e.value::int, 'quote', fi.excerpt, fi.url, fi.archive_url, pdate(fi.date, fi.date_prec)::text, NULL
      FROM topics t JOIN ${LABELS} l ON true JOIN feed_items fi ON fi.id=l.feed_id, jsonb_each_text(l.issues) e
     WHERE t.issue_id IS NOT NULL AND e.key=t.issue_id AND fi.status='approved' AND ${GOOD}
    UNION ALL
    SELECT p.topic_id, p.node_id, p.answer::int, 'letter', p.quote, p.source_url, p.archive_url, p.date::text, p.document_name
      FROM topic_positions p`);
  const nodes = new Map((await q<any>(`SELECT id, name, type FROM nodes WHERE id = ANY($1)`, [[...new Set(rows.map((r: any) => r.node_id))]])).map((n: any) => [n.id, n]));
  return topics.map((t: any) => {
    const by = new Map<string, TopicEvidence[]>();
    for (const r of rows.filter((r: any) => r.topic === t.id)) by.set(r.node_id, [...(by.get(r.node_id) ?? []), { kind: r.kind, v: r.v, text: r.text, url: r.url, archive_url: r.archive_url, date: r.date, doc: r.doc ?? undefined }]);
    const actors: TopicActor[] = [...by.entries()].filter(([id]) => nodes.has(id)).map(([id, items]) => {
      const sided = items.filter((i) => i.v !== 0);
      const avg = sided.length ? sided.reduce((a, i) => a + i.v, 0) / sided.length : 0;
      const n = nodes.get(id);
      return { id, name: n.name, type: n.type, avg, items: items.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""))) };
    }).sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
    return { id: t.id, label: t.label, description: t.description, positive: t.positive,
      agree: actors.filter((a) => a.avg > 0), neutral: actors.filter((a) => a.avg === 0), disagree: actors.filter((a) => a.avg < 0) };
  });
}

// ── Read-only view APIs (data/CONTRACTS.md §9). Reviewed rows and public records only. ──
const cut25 = (s: string | null) => { if (!s) return s; const w = s.split(/\s+/); return w.length > 25 ? w.slice(0, 25).join(" ") + " …" : s; };
export async function viewIssueQuarterly(issue?: string) {
  "use cache";
  cached();
  const args = issue ? [issue] : [];
  const st = await q<any>(`
    WITH s AS (SELECT e.key AS issue, e.value::int AS v, fi.id, fi.node_id, fi.excerpt, fi.url, fi.archive_url, fi.date
      FROM ${LABELS} l JOIN feed_items fi ON fi.id=l.feed_id, jsonb_each_text(l.issues) e
      WHERE ${GOOD} AND fi.status='approved' AND fi.date IS NOT NULL ${issue ? "AND e.key=$1" : ""})
    SELECT issue, to_char(date_trunc('quarter', date), 'YYYY"Q"Q') AS quarter,
      count(*) FILTER (WHERE v>0)::int AS agree, count(*) FILTER (WHERE v<0)::int AS disagree, count(*) FILTER (WHERE v=0)::int AS neutral,
      (array_agg(json_build_object('feed_id', id, 'node_id', node_id, 'quote', excerpt, 'reading', v, 'machine_label', true, 'date', date::text, 'source_url', url, 'archive_url', archive_url) ORDER BY date DESC))[1:3] AS examples
    FROM s GROUP BY 1, 2`, args);
  const fl = await q<any>(`
    SELECT i AS issue, coalesce(replace(f.period, ' ', ''), to_char(date_trunc('quarter', f.filed_date), 'YYYY"Q"Q')) AS quarter, count(DISTINCT f.id)::int AS n
    FROM ${FILING_TAGS} t JOIN filings f ON t.source_kind='filing' AND f.id=t.source_id, unnest(t.issues) i
    WHERE f.filing_type='LDA' ${issue ? "AND i=$1" : ""} GROUP BY 1, 2`, args);
  const key = (r: any) => `${r.issue}|${r.quarter}`;
  const m = new Map<string, any>();
  for (const r of st) m.set(key(r), { issue: r.issue, quarter: r.quarter, statements: { agree: r.agree, disagree: r.disagree, neutral: r.neutral }, lobbying_filings: 0,
    examples: (r.examples ?? []).map((x: any) => ({ ...x, quote: cut25(x.quote) })) });
  for (const r of fl) { if (!r.quarter) continue; const o = m.get(key(r)) ?? { issue: r.issue, quarter: r.quarter, statements: { agree: 0, disagree: 0, neutral: 0 }, lobbying_filings: 0, examples: [] }; o.lobbying_filings = r.n; m.set(key(r), o); }
  return [...m.values()].sort((a, b) => a.issue.localeCompare(b.issue) || a.quarter.localeCompare(b.quarter));
}
export async function viewWordingSources(billId: string) {
  "use cache";
  cached();
  const [t] = await q<{ ok: boolean }>(`SELECT to_regclass('prov_matches') IS NOT NULL AS ok`);
  if (!t?.ok) return [];
  const rows = await q<any>(`SELECT id::int, bill_clause, bill_version, bill_date::text, bill_url, bill_archive_url, source_clause, source_title, source_author_id,
      source_date::text, source_url, source_archive_url, similarity, kind FROM prov_matches WHERE bill_node_id=$1 AND status='approved' ORDER BY similarity DESC`, [billId]);
  return rows.map((r: any) => ({ ...r, bill_clause: cut25(r.bill_clause), source_clause: cut25(r.source_clause) }));
}

// ── Small reads that used to run on every request ──
export async function allNodeIds(): Promise<string[]> {
  "use cache";
  cached();
  // Best-connected first: the build prebuilds the head of this list, and the background refresh works down it.
  return (await q<{ id: string }>(`SELECT n.id FROM nodes n ORDER BY (SELECT count(*) FROM links l WHERE l.from_id=n.id OR l.to_id=n.id) DESC, n.id`)).map((r) => r.id);
}

export async function getOpenData() {
  "use cache";
  cached();
  const [counts] = await q<any>(`SELECT (SELECT count(*) FROM nodes)::int nodes, (SELECT count(*) FROM links)::int links, (SELECT count(*) FROM feed_items WHERE status='approved')::int feed_items,
    (SELECT count(*) FROM filings)::int filings, (SELECT count(*) FROM facts)::int facts,
    (SELECT count(*) FROM archives WHERE archive_url IS NOT NULL)::int archived, (SELECT count(DISTINCT url) FROM url_checks)::int checked`);
  const changes = await q<any>(`SELECT id, at::text, action, table_name, row_ref, actor FROM changelog ORDER BY id DESC LIMIT 300`);
  const corrections = await q<any>(`SELECT id, at::text, what_changed, url FROM corrections ORDER BY id DESC LIMIT 500`);
  const runs = await q<any>(`SELECT DISTINCT ON (importer) importer, started_at::text, ok, added, message FROM import_runs ORDER BY importer, started_at DESC`);
  return { counts, changes, corrections, runs };
}

// Everything the header's name lookup matches against, so a keystroke filters in memory instead of querying.
export async function getNameIndex() {
  "use cache";
  cached();
  const nodes = await q<{ id: string; name: string; type: string; descriptor: string | null; weight: number }>(
    `SELECT id, name, type, descriptor, (SELECT count(*)::int FROM links l WHERE l.from_id=n.id OR l.to_id=n.id) AS weight FROM nodes n`);
  const aliases = await q<{ node_id: string; alias: string }>(`SELECT node_id, alias FROM entity_aliases`);
  const merged = await q<{ merged_id: string; kept_id: string }>(`SELECT merged_id, kept_id FROM merge_log WHERE action='merge' AND status='applied' AND reverted_at IS NULL`);
  return { nodes, aliases, merged };
}
