// Shared write path for public bill records (table bills). Importers read official sources and call upsertBill.
// Only plain public record fields: title, sponsor, dates, latest action, subjects, and a lifecycle stage derived from them.
import { pool } from "../../src/lib/db.ts";

export const STAGES = ["proposed", "introduced", "in_committee", "passed_one_chamber", "passed_legislature", "enacted", "vetoed", "failed"] as const;
export type Stage = (typeof STAGES)[number];

// AI relevance from a title or the source's subject terms. Kept narrow on purpose: a match must name AI or a
// technique or product built on it, not "technology" in general. \bgenerative avoids "regenerative".
const AI_RX = new RegExp([
  String.raw`artificial[- ]intelligence`, String.raw`\bA\.?I\.?\b(?![-.]?\d)`, String.raw`machine[- ]learning`, String.raw`deep[- ]?fakes?`,
  String.raw`\balgorithm(ic|s)?\b`, String.raw`automated decision`, String.raw`\bchat ?bots?\b`, String.raw`\bgenerative\b`,
  String.raw`synthetic (media|content|images?|video)`, String.raw`digital (replica|likeness)`, String.raw`frontier model`,
  String.raw`large language model`, String.raw`neural network`, String.raw`foundation model`, String.raw`facial recognition`,
].join("|"), "i");
// Subject terms that are AI by themselves (Congress.gov / CRS legislative subjects, state subject lists).
const AI_SUBJECT_RX = /^(artificial intelligence|algorithms?|deepfakes?|automated decision|machine learning)/i;

export function aiMatch(title: string, subjects: string[] = []): "subject" | "title" | null {
  if (subjects.some((s) => AI_SUBJECT_RX.test(s.trim()))) return "subject";
  if (AI_RX.test(title)) return "title";
  return null;
}

export type BillRow = {
  id: string; jurisdiction: string; session: string; identifier: string; bill_type?: string | null; number?: string | null;
  chamber?: "lower" | "upper" | "joint" | null; title: string; introduced_date?: string | null; stage: Stage; stage_date?: string | null;
  status_text?: string | null; status_date?: string | null; sponsor?: string | null; subjects?: string[]; ai_match: string;
  source: string; source_url: string; data_url?: string | null; external_ids?: Record<string, unknown>; source_modified?: string | null;
};

const d = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

/** Insert or refresh a bill. Returns true when the row is new. A curated node link (node_id) is never cleared here. */
export async function upsertBill(b: BillRow): Promise<boolean> {
  if (!STAGES.includes(b.stage)) throw new Error(`bad stage ${b.stage} for ${b.id}`);
  const r = await pool.query(
    `INSERT INTO bills (id,jurisdiction,session,identifier,bill_type,number,chamber,title,introduced_date,stage,stage_date,status_text,status_date,
       sponsor,subjects,ai_match,source,source_url,data_url,external_ids,source_modified)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, introduced_date=EXCLUDED.introduced_date, stage=EXCLUDED.stage, stage_date=EXCLUDED.stage_date,
       status_text=EXCLUDED.status_text, status_date=EXCLUDED.status_date, sponsor=EXCLUDED.sponsor, subjects=EXCLUDED.subjects,
       ai_match=CASE WHEN bills.ai_match='curated' THEN 'curated' ELSE EXCLUDED.ai_match END, source=EXCLUDED.source, source_url=EXCLUDED.source_url,
       data_url=EXCLUDED.data_url, external_ids=bills.external_ids || EXCLUDED.external_ids, source_modified=EXCLUDED.source_modified, updated_at=now()
     RETURNING (xmax = 0) AS inserted`,
    [b.id, b.jurisdiction, b.session, b.identifier, b.bill_type ?? null, b.number ?? null, b.chamber ?? null, b.title.trim(), d(b.introduced_date),
     b.stage, d(b.stage_date), b.status_text ?? null, d(b.status_date), b.sponsor ?? null, b.subjects ?? [], b.ai_match, b.source, b.source_url,
     b.data_url ?? null, JSON.stringify(b.external_ids ?? {}), b.source_modified ?? null]);
  return r.rows[0]?.inserted === true;
}

export async function scanned(source: string): Promise<Map<string, number>> {
  const r = await pool.query(`SELECT key, extract(epoch FROM modified)::float8 AS m FROM bill_scan WHERE source=$1`, [source]);
  return new Map(r.rows.map((x: any) => [x.key, x.m ?? 0]));
}
export async function markScanned(source: string, rows: { key: string; modified: string | null; relevant: boolean }[]) {
  for (let i = 0; i < rows.length; i += 1000) {
    const part = rows.slice(i, i + 1000);
    await pool.query(
      `INSERT INTO bill_scan (source, key, modified, relevant) SELECT $1, k, m::timestamptz, r FROM unnest($2::text[], $3::text[], $4::bool[]) AS t(k, m, r)
       ON CONFLICT (source, key) DO UPDATE SET modified=EXCLUDED.modified, relevant=EXCLUDED.relevant`,
      [source, part.map((x) => x.key), part.map((x) => x.modified), part.map((x) => x.relevant)]);
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Point each bill node on the map at its public record. Federal and LegInfo ids are exact; a state node id like
 * il-sb3444-2026 matches that state's record whose identifier is SB 3444 in a session covering 2026. Nodes no feed
 * covers get the research stage in config/bill-stages.json, and only while no official record matches.
 */
export async function linkCuratedBills(): Promise<number> {
  const { readFileSync } = await import("node:fs");
  const { REPO } = await import("../env.ts");
  const nodes = (await pool.query(`SELECT id, name, source_url, external_ids FROM nodes WHERE type='bill'`)).rows;
  const bills = (await pool.query(`SELECT id, jurisdiction, session, identifier, node_id, source, external_ids FROM bills WHERE source <> 'research'`)).rows;
  let linked = 0;
  for (const n of nodes) {
    const lid = n.external_ids?.leginfo_bill_id;
    const m = n.id.match(/^([a-z]{2})-([a-z]+\d*[a-z]?-?\d+)-(\d{4})$/); // st-<type><num>-<year>
    const hit = bills.find((b) => b.id === n.id)
      ?? (lid ? bills.find((b) => b.external_ids?.leginfo_bill_id === lid) : undefined)
      ?? (m ? bills.find((b) => {
        // Sessions named by ordinal (Illinois "104th") carry their calendar years in external_ids.years.
        const years = [b.session, ...(b.external_ids?.years ?? [])].join(" ");
        return b.jurisdiction === m[1] && norm(b.identifier) === norm(m[2]) && (years.includes(m[3]) || years.includes(String(Number(m[3]) - 1)));
      }) : undefined);
    if (!hit || hit.node_id === n.id) continue;
    await pool.query(`UPDATE bills SET node_id=NULL WHERE node_id=$1`, [n.id]);
    await pool.query(`UPDATE bills SET node_id=$2, ai_match='curated' WHERE id=$1`, [hit.id, n.id]);
    linked++;
  }
  const curated = JSON.parse(readFileSync(`${REPO}/config/bill-stages.json`, "utf8"));
  const official = new Set((await pool.query(`SELECT node_id FROM bills WHERE node_id IS NOT NULL AND source <> 'research'`)).rows.map((r: any) => r.node_id));
  await pool.query(`DELETE FROM bills WHERE source='research' AND (node_id IS NULL OR node_id = ANY($1))`, [[...official]]);
  for (const n of nodes) {
    const c = curated[n.id];
    if (!c || official.has(n.id)) continue;
    await upsertBill({ id: n.id, jurisdiction: c.jurisdiction, session: c.session, identifier: c.identifier, title: n.name, stage: c.stage,
      stage_date: c.stage_date ?? null, ai_match: "curated", source: "research", source_url: c.source_url ?? n.source_url });
    await pool.query(`UPDATE bills SET node_id=$1 WHERE id=$1`, [n.id]);
  }
  return linked;
}

export type BillAction = { date: string; text: string; chamber?: "lower" | "upper" | "joint" | "executive" | null; kind?: string | null };
export type BillVote = { date: string; chamber?: "lower" | "upper" | "joint" | null; motion: string; yes?: number | null; no?: number | null;
  other?: number | null; result?: string | null; source_url?: string | null };

// Coarse kind of an action from its wording, the same way for every source.
export function actionKind(text: string): string {
  const t = text.toLowerCase();
  if (/veto/.test(t) && !/override/.test(t)) return "vetoed";
  if (/became (public )?law|signed by (the )?(governor|president)|approved by (the )?governor|chaptered|enacted|public act/.test(t)) return "enacted";
  if (/to governor|presented to (the )?(governor|president)|enrolled/.test(t)) return "governor";
  if (/\bfail|died|tabled|postponed indefinitely|withdrawn|adjourned sine die/.test(t)) return "failed";
  if (/passed|agreed to|third reading.*(ayes|yeas)|adopted/.test(t) && !/^(amendment|.*amendment (no\.|#|\d|sa|ha))|motion to reconsider|motion to table/.test(t)) return "passed";
  if (/committee|referred|re-referred|hearing/.test(t)) return "committee";
  if (/introduc|first reading|read first time|prefiled|filed/.test(t)) return "introduced";
  return "other";
}

/** Replace a bill's action history and votes with the source's current list. */
export async function saveHistory(billId: string, actions: BillAction[], votes: BillVote[] = []) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`DELETE FROM bill_actions WHERE bill_id=$1`, [billId]);
    await c.query(`DELETE FROM bill_votes WHERE bill_id=$1`, [billId]);
    const a = actions.filter((x) => /^\d{4}-\d{2}-\d{2}/.test(x.date) && x.text);
    if (a.length) await c.query(
      `INSERT INTO bill_actions (bill_id, seq, date, text, chamber, kind) SELECT $1, s, d::date, t, NULLIF(ch, ''), k
       FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[]) AS u(s, d, t, ch, k)`,
      [billId, a.map((_, i) => i + 1), a.map((x) => x.date.slice(0, 10)), a.map((x) => x.text.trim()), a.map((x) => x.chamber ?? ""), a.map((x) => x.kind ?? actionKind(x.text))]);
    const v = votes.filter((x) => /^\d{4}-\d{2}-\d{2}/.test(x.date));
    for (const [i, x] of v.entries())
      await c.query(`INSERT INTO bill_votes (bill_id, seq, date, chamber, motion, yes, no, other, result, source_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [billId, i + 1, x.date.slice(0, 10), x.chamber ?? null, x.motion, x.yes ?? null, x.no ?? null, x.other ?? null, x.result ?? null, x.source_url ?? null]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

/**
 * The id of a state bill already on file under another source's naming, so a second source (Open States after NCSL,
 * say) refreshes that row instead of adding a duplicate. Matches state, identifier letters and number, and a year.
 */
export async function existingStateBill(st: string, identifier: string, years: string[]): Promise<string | null> {
  const r = await pool.query(`SELECT id, session, external_ids FROM bills WHERE jurisdiction=$1 AND source <> 'research'
    AND regexp_replace(lower(identifier), '[^a-z0-9]', '', 'g') = $2`, [st, norm(identifier)]);
  const hit = r.rows.find((b: any) => [b.session, ...(b.external_ids?.years ?? [])].some((y: string) => years.some((x) => String(y).includes(x))));
  return hit?.id ?? null;
}
