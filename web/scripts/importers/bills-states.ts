// State bills (every state but California, which LegInfo covers) from the Open States API v3. Needs OPENSTATES_API_KEY
// (free at open.pluralpolicy.com). Full-text searches for AI terms, then keeps only bills whose title, abstract, or
// subject terms name AI (or that are on the map). The free key allows few requests, so each run spends at most
// BUDGET of them, waits between calls, and remembers where it stopped; the first full pass can take a few days of
// daily runs, after which a run only asks for bills updated since the last complete pass.
import "../env.ts";
import { pool } from "../../src/lib/db.ts";
import { startRun, endRun, politeFetch, sleep } from "../lib/ingest.ts";
import { aiMatch, upsertBill, linkCuratedBills, saveHistory, actionKind, existingStateBill, type Stage } from "../lib/bills.ts";

const KEY = process.env.OPENSTATES_API_KEY;
const API = "https://v3.openstates.org";
const BUDGET = Number(process.env.OPENSTATES_BUDGET ?? 400);
const GAP_MS = 7000; // under ten requests a minute
const TERMS = ["artificial intelligence", "deepfake", "chatbot", "algorithmic", "automated decision", "synthetic media", "machine learning", "generative"];
const FIRST_SINCE = "2025-01-01"; // the first pass reaches back to the 2025 sessions

let spent = 0;
async function get(path: string): Promise<any | null> {
  if (spent >= BUDGET) return null;
  spent++;
  const res = await politeFetch(`${API}${path}`, { headers: { "X-API-KEY": KEY! }, signal: AbortSignal.timeout(60_000) });
  await sleep(GAP_MS);
  if (res.status === 429) { spent = BUDGET; return null; } // daily allowance gone: stop and resume tomorrow
  if (!res.ok) return null;
  return res.json();
}

const stateOf = (jid: string) => jid.match(/state:([a-z]{2})/)?.[1] ?? (jid.includes("district:dc") ? "dc" : jid.includes("territory:pr") ? "pr" : null);

const sessionEnds = new Map<string, Map<string, string | null>>();
async function sessionEnd(jid: string, session: string): Promise<string | null> {
  if (!sessionEnds.has(jid)) {
    const j = await get(`/jurisdictions/${encodeURIComponent(jid)}?include=legislative_sessions`);
    if (!j) return null; // not cached, so a later bill of the same state asks again once budget allows
    sessionEnds.set(jid, new Map((j.legislative_sessions ?? []).map((s: any) => [s.identifier, s.end_date || null])));
  }
  return sessionEnds.get(jid)!.get(session) ?? null;
}

type Act = { date: string; classification: string[]; org: string };
/** Stage from Open States' action classifications. Nebraska has one chamber, so one passage is the whole legislature. */
export function stageFor(actions: Act[], unicameral: boolean, over: boolean): { stage: Stage; date: string | null } {
  const sorted = [...actions].sort((a, b) => a.date.localeCompare(b.date));
  const last = (c: string) => sorted.filter((a) => a.classification.includes(c)).at(-1)?.date ?? null;
  const law = last("became-law") ?? last("executive-signature");
  const veto = last("executive-veto");
  const override = last("veto-override-passage");
  if (law || (veto && override && override >= veto)) return { stage: "enacted", date: law ?? override };
  if (veto) return { stage: "vetoed", date: veto.slice(0, 10) };
  const passed = sorted.filter((a) => a.classification.includes("passage"));
  const chambers = new Set(passed.map((a) => a.org));
  let s: { stage: Stage; date: string | null };
  if (last("executive-receipt") || chambers.size >= 2 || (unicameral && chambers.size >= 1)) s = { stage: "passed_legislature", date: last("executive-receipt") ?? passed.at(-1)!.date };
  else if (chambers.size === 1) s = { stage: "passed_one_chamber", date: passed.at(-1)!.date };
  else if (sorted.at(-1)?.classification.some((c) => c === "failure" || c === "withdrawal")) s = { stage: "failed", date: sorted.at(-1)!.date };
  else if (last("referral-committee")) s = { stage: "in_committee", date: sorted.find((a) => a.classification.includes("referral-committee"))!.date };
  else s = { stage: "introduced", date: null };
  if (over && s.stage !== "passed_legislature" && s.stage !== "failed") return { stage: "failed", date: null };
  return s;
}

async function saveBill(b: any, onMap: Set<string>) {
  const st = stateOf(b.jurisdiction?.id ?? "");
  if (!st || st === "ca") return false;
  const abstracts = (b.abstracts ?? []).map((a: any) => a.abstract).join(" ");
  const ident = String(b.identifier);
  const years = [...new Set([b.first_action_date, b.latest_action_date, ...(String(b.session).match(/\d{4}/g) ?? [])].filter(Boolean).map((x: string) => String(x).slice(0, 4)))];
  // A bill NCSL already listed keeps its row (and id); Open States then becomes its source and refreshes it.
  const id = (await existingStateBill(st, ident, years)) ?? `${st}-${String(b.session).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${ident.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const nodeGuess = [...onMap].some((n) => n.startsWith(`${st}-${ident.toLowerCase().replace(/[^a-z0-9-]/g, "")}-`));
  const match = aiMatch(b.title ?? "", b.subject ?? []) ?? (aiMatch(abstracts) ? "title" : null) ?? (nodeGuess ? "curated" : null);
  if (!match) return false;
  const actions: Act[] = (b.actions ?? []).map((a: any) => ({ date: String(a.date).slice(0, 10), classification: a.classification ?? [], org: a.organization?.classification ?? a.organization?.name ?? "" }));
  const end = await sessionEnd(b.jurisdiction.id, b.session);
  const { stage, date } = stageFor(actions, st === "ne", !!end && new Date(end) < new Date());
  const official = (b.sources ?? []).map((s: any) => s.url).find((u: string) => /^https?:\/\//.test(u) && !/openstates|pluralpolicy/.test(u));
  const org = b.from_organization?.classification;
  await upsertBill({
    id, jurisdiction: st, session: String(b.session), identifier: ident, bill_type: ident.replace(/[\s\d-]+.*$/, "").toLowerCase() || null,
    number: ident.match(/\d+/)?.[0] ?? null, chamber: org === "upper" ? "upper" : org === "lower" ? "lower" : org === "legislature" ? "joint" : null,
    title: b.title, introduced_date: b.first_action_date, stage, stage_date: date, status_text: b.latest_action_description, status_date: b.latest_action_date,
    sponsor: (b.sponsorships ?? []).find((s: any) => s.primary)?.name ?? null, subjects: b.subject ?? [], ai_match: match, source: "openstates",
    source_url: official ?? b.openstates_url, data_url: `${API}/bills/${b.id}`, external_ids: { openstates: b.id, years },
    source_modified: b.updated_at,
  });
  const ch = (o: string) => (o === "upper" ? "upper" : o === "lower" ? "lower" : o === "executive" ? "executive" : o === "legislature" ? "joint" : null) as any;
  await saveHistory(id, (b.actions ?? []).map((a: any) => ({ date: String(a.date).slice(0, 10), text: a.description, chamber: ch(a.organization?.classification ?? ""),
    kind: (a.classification ?? []).includes("became-law") || (a.classification ?? []).includes("executive-signature") ? "enacted"
      : (a.classification ?? []).includes("executive-veto") ? "vetoed" : actionKind(a.description ?? "") })));
  return true;
}

export async function run() {
  if (!KEY) { console.log("bills-states: OPENSTATES_API_KEY not set, skipping"); return 0; }
  const runId = await startRun("bills-states");
  spent = 0;
  let kept = 0;
  try {
    // Progress: one bill_scan row per term holds the page to resume from and, once a pass completes, its start time.
    const state = new Map((await pool.query(`SELECT key, modified, relevant FROM bill_scan WHERE source='openstates-pass'`)).rows.map((r: any) => [r.key, r]));
    const cursor = (await pool.query(`SELECT key FROM bill_scan WHERE source='openstates-cursor'`)).rows[0]?.key ?? "";
    const onMap = new Set((await pool.query(`SELECT id FROM nodes WHERE type='bill' AND id ~ '^[a-z]{2}-' AND id !~ '^(us|ca)-'`)).rows.map((r: any) => r.id));
    for (const term of TERMS) {
      const prev = state.get(term);
      const since = prev?.modified ? new Date(prev.modified).toISOString().slice(0, 10) : FIRST_SINCE;
      const [cTerm, cPage, cStart] = cursor.split("|");
      let page = cTerm === term ? Number(cPage) : 1;
      const passStart = cTerm === term && cStart ? cStart : new Date().toISOString();
      for (;;) {
        const qs = new URLSearchParams({ q: term, classification: "bill", updated_since: since, sort: "updated_asc", per_page: "20", page: String(page) });
        for (const inc of ["actions", "sponsorships", "sources", "abstracts"]) qs.append("include", inc);
        const j = await get(`/bills?${qs}`);
        if (!j) {
          await pool.query(`DELETE FROM bill_scan WHERE source='openstates-cursor'`);
          await pool.query(`INSERT INTO bill_scan (source, key) VALUES ('openstates-cursor', $1)`, [`${term}|${page}|${passStart}`]);
          console.log(`bills-states: stopped at "${term}" page ${page} (${spent} requests); resumes next run`);
          await linkCuratedBills();
          await endRun(runId, true, kept, `paused at ${term} p${page}`);
          return kept;
        }
        for (const b of j.results ?? []) if (await saveBill(b, onMap)) kept++;
        if (page >= (j.pagination?.max_page ?? 1)) break;
        page++;
      }
      await pool.query(`INSERT INTO bill_scan (source, key, modified, relevant) VALUES ('openstates-pass', $1, $2, true)
        ON CONFLICT (source, key) DO UPDATE SET modified=EXCLUDED.modified`, [term, passStart]);
      await pool.query(`DELETE FROM bill_scan WHERE source='openstates-cursor'`);
      console.log(`bills-states "${term}": done since ${since}`);
    }
    await linkCuratedBills();
    await endRun(runId, true, kept, `${spent} requests`);
  } catch (e) { await endRun(runId, false, kept, String(e)); throw e; }
  return kept;
}
if (import.meta.url === `file://${process.argv[1]}`) { console.log("bills-states kept", await run()); await pool.end(); }
