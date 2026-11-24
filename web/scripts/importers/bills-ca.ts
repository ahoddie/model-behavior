// California bills from LegInfo's own public database exports (downloads.leginfo.legislature.ca.gov; no key).
// The exports are 1 GB zips, almost all bill text. We read only four tables out of them with HTTP range requests
// (about 3 MB): bills, versions (for the subject line), authors, and history. The newest daily export covers the
// current session; older sessions are read once from their archive. Stage comes from LegInfo's own status fields.
import "../env.ts";
import { pool } from "../../src/lib/db.ts";
import { startRun, endRun, politeFetch } from "../lib/ingest.ts";
import { aiMatch, upsertBill, linkCuratedBills, saveHistory, actionKind, type Stage, type BillVote } from "../lib/bills.ts";
import { listZip, readZipEntry } from "../lib/remote-zip.ts";

const BASE = "https://downloads.leginfo.legislature.ca.gov";
const PAST_SESSIONS = ["2023"]; // archives read once, so bills already on the map (SB 1047, AB 2013...) have a record
const MEASURES = /^(AB|SB|ACA|SCA)$/; // bills and constitutional amendments; resolutions are left out

// LegInfo .dat files: tab separated, text fields wrapped in backticks, NULL for empty.
function rows(buf: Buffer): string[][] {
  return buf.toString("utf8").split("\n").filter(Boolean).map((l) => l.split("\t").map((f) => (f === "NULL" ? "" : f.replace(/^`|`$/g, ""))));
}

async function newestDaily(): Promise<string> {
  const html = await (await politeFetch(`${BASE}/`)).text();
  const files = [...html.matchAll(/(pubinfo_daily_\w+\.zip)<\/a>\s*<\/td>\s*<td[^>]*>\s*([\d-]+ [\d:]+)/g)].map((m) => ({ f: m[1], t: m[2] }));
  const fallback = [...html.matchAll(/pubinfo_daily_(\w+)\.zip/g)].map((m) => m[0]);
  if (files.length) return `${BASE}/${files.sort((a, b) => b.t.localeCompare(a.t))[0].f}`;
  // Listing layout changed: fall back to yesterday's weekday, which is complete by now.
  const day = new Date(Date.now() - 86400_000).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Los_Angeles" });
  return `${BASE}/${fallback.find((f) => f.includes(day)) ?? `pubinfo_daily_${day}.zip`}`;
}

async function tables(url: string) {
  const entries = await listZip(url);
  const get = async (n: string) => { const e = entries.find((x) => x.name.toUpperCase() === n); if (!e) throw new Error(`${n} missing in ${url}`); return rows(await readZipEntry(url, e)); };
  return { bills: await get("BILL_TBL.DAT"), versions: await get("BILL_VERSION_TBL.DAT"), authors: await get("BILL_VERSION_AUTHORS_TBL.DAT"), history: await get("BILL_HISTORY_TBL.DAT"),
    votes: await get("BILL_SUMMARY_VOTE_TBL.DAT"), motions: await get("BILL_MOTION_TBL.DAT"), locations: await get("LOCATION_CODE_TBL.DAT") };
}

// A two-year session ends on November 30 of its second year; anything still open then is dead.
const sessionOver = (session: string, now = new Date()) => now > new Date(`${session.slice(4, 8)}-12-01T08:00:00Z`);

export function stageFor(b: { measureState: string; status: string; currentHouse: string; origin: string; history: { date: string; action: string }[]; over: boolean }): { stage: Stage; date: string | null } {
  const last = (rx: RegExp) => b.history.filter((h) => rx.test(h.action)).sort((x, y) => x.date.localeCompare(y.date)).at(-1)?.date ?? null;
  if (b.measureState === "Chaptered" || b.status === "Chaptered") return { stage: "enacted", date: last(/Chaptered by Secretary of State|Approved by (the )?Governor/i) };
  // The status field can lag (archived sessions keep "Enrolled"), so the history's veto entries count too. An override
  // that succeeded is chaptered and was caught above.
  if (b.status === "Vetoed" || /^Vetoed/i.test(b.measureState) || b.history.some((h) => /Vetoed by (the )?Governor|Governor's veto/i.test(h.action)))
    return { stage: "vetoed", date: last(/Vetoed by (the )?Governor/i) ?? last(/Governor's veto/i) };
  if (/^(Died|Failed)/i.test(b.status)) return { stage: "failed", date: last(/died|failed|returned to secretary of senate|returned to chief clerk/i) };
  let s: { stage: Stage; date: string | null };
  if (b.measureState === "Enrolled" || b.status === "Passed" || /Enrolled and presented|Enrolled and to the Governor/i.test(b.history.map((h) => h.action).join("\n")))
    s = { stage: "passed_legislature", date: last(/Enrolled/i) };
  else if (b.currentHouse && b.currentHouse !== b.origin && /^(Assembly|Senate)$/.test(b.currentHouse))
    s = { stage: "passed_one_chamber", date: last(b.origin === "Assembly" ? /^In Senate\. Read first time/i : /^In Assembly\. Read first time/i) };
  else if (b.status === "Pending Referral" || b.status === "" || b.measureState === "Introduced" && !b.history.some((h) => /Referred to/i.test(h.action)))
    s = { stage: "introduced", date: null };
  else s = { stage: "in_committee", date: last(/Referred to/i) };
  if (b.over && s.stage !== "passed_legislature") return { stage: "failed", date: null };
  return s;
}

async function importTables(t: Awaited<ReturnType<typeof tables>>, curated: Map<string, string>, extra: Set<string>) {
  // Roll calls, floor and committee: summary vote rows joined to the motion wording and the place it was taken.
  const motion = new Map(t.motions.map((m) => [m[0], m[1]]));
  const place = new Map(t.locations.map((l) => [l[1], l[4] || l[5]]));
  const votesBy = new Map<string, BillVote[]>();
  for (const v of t.votes) {
    const loc = v[1];
    if (!votesBy.has(v[0])) votesBy.set(v[0], []);
    votesBy.get(v[0])!.push({ date: v[2].slice(0, 10), chamber: /^(A|CX)/.test(loc) ? "lower" : /^(S|CS)/.test(loc) ? "upper" : null,
      motion: [place.get(loc), motion.get(v[4])].filter(Boolean).join(": ") || "Vote", yes: Number(v[5]) || 0, no: Number(v[6]) || 0,
      other: v[7] === "" ? null : Number(v[7]) || 0, result: /^\(?PASS/i.test(v[8]) ? "passed" : /^\(?FAIL/i.test(v[8]) ? "failed" : v[8] || null, source_url: null });
  }
  const versions = new Map<string, { bill: string; date: string; subject: string }[]>();
  const subjectById = new Map<string, string>();
  for (const v of t.versions) {
    subjectById.set(v[0], v[6]);
    if (!versions.has(v[1])) versions.set(v[1], []);
    versions.get(v[1])!.push({ bill: v[1], date: v[3].slice(0, 10), subject: v[6] });
  }
  const lead = new Map<string, string>();
  for (const a of t.authors) if (a[4] === "LEAD_AUTHOR" && (a[9] === "Y" || !lead.has(a[0])))
    lead.set(a[0], `${a[2] === "SENATE" ? "Sen." : "Asm."} ${a[3]}`);
  const history = new Map<string, { date: string; action: string; seq: number }[]>();
  for (const h of t.history) {
    if (!history.has(h[0])) history.set(h[0], []);
    history.get(h[0])!.push({ date: h[2].slice(0, 10), action: h[3].replace(/\s+/g, " ").trim(), seq: Number(h[6]) || 0 });
  }
  let added = 0, relevant = 0;
  for (const b of t.bills) {
    const [billId, session, , type, num, measureState, , , , , latestVersion, , , , , , currentHouse, status] = b;
    if (!MEASURES.test(type)) continue;
    const title = (subjectById.get(latestVersion) || versions.get(billId)?.at(-1)?.subject || "").replace(/\.$/, "").trim();
    const id = `ca-${session}-${type.toLowerCase()}${num}`;
    const match = aiMatch(title) ?? (curated.has(billId) ? "curated" : extra.has(billId) ? "ncsl" : null);
    if (!match || !title) continue;
    relevant++;
    const hist = (history.get(billId) ?? []).sort((x, y) => x.date.localeCompare(y.date) || x.seq - y.seq);
    const origin = type.startsWith("A") ? "Assembly" : "Senate";
    const { stage, date } = stageFor({ measureState, status, currentHouse, origin, history: hist, over: sessionOver(session) });
    const introduced = (versions.get(billId) ?? []).map((v) => v.date).sort()[0] ?? null;
    if (await upsertBill({
      id, jurisdiction: "ca", session, identifier: `${type} ${num}`, bill_type: type.toLowerCase(), number: num, chamber: origin === "Assembly" ? "lower" : "upper",
      title, introduced_date: introduced, stage, stage_date: date, status_text: hist.at(-1)?.action ?? null, status_date: hist.at(-1)?.date ?? null,
      sponsor: lead.get(latestVersion) ?? null, ai_match: match, source: "leginfo",
      source_url: `https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=${billId}`, data_url: null, external_ids: { leginfo_bill_id: billId },
    })) added++;
    await saveHistory(id, hist.map((h) => ({ date: h.date, text: h.action, chamber: /^In Senate|Senate/.test(h.action) ? "upper" : /^In Assembly|Assembly/.test(h.action) ? "lower" : null,
      kind: actionKind(h.action) })), (votesBy.get(billId) ?? []).sort((a, b) => a.date.localeCompare(b.date)));
  }
  return { added, relevant };
}

export async function run() {
  const runId = await startRun("bills-ca");
  let added = 0;
  try {
    // Bills on the map that LegInfo should know about, by LegInfo id, so they are kept even if the subject line doesn't say AI.
    const curated = new Map<string, string>();
    for (const n of (await pool.query(`SELECT id, external_ids->>'leginfo_bill_id' AS lid FROM nodes WHERE type='bill' AND id LIKE 'ca-%'`)).rows) {
      const m = n.id.match(/^ca-([a-z]+)(\d+)-(\d{4})$/);
      const start = m ? (Number(m[3]) % 2 ? Number(m[3]) : Number(m[3]) - 1) : 0;
      const lid = n.lid ?? (m ? `${start}${start + 1}0${m[1].toUpperCase()}${m[2]}` : null);
      if (lid) curated.set(lid, n.id);
    }
    // California bills NCSL lists as AI legislation (bills-ncsl), counted even when the subject line doesn't say AI.
    const extra = new Set<string>((await pool.query(`SELECT key FROM bill_scan WHERE source='ncsl-ca'`)).rows.map((r: any) => r.key));
    const done = await pool.query(`SELECT key FROM bill_scan WHERE source='leginfo-archive'`);
    for (const year of PAST_SESSIONS) {
      if (done.rows.some((r: any) => r.key === year)) continue;
      const r = await importTables(await tables(`${BASE}/pubinfo_${year}.zip`), curated, extra);
      await pool.query(`INSERT INTO bill_scan (source, key, modified, relevant) VALUES ('leginfo-archive', $1, now(), true) ON CONFLICT DO NOTHING`, [year]);
      console.log(`bills-ca ${year} archive: ${r.relevant} about AI, ${r.added} new`);
      added += r.added;
    }
    const daily = await newestDaily();
    const r = await importTables(await tables(daily), curated, extra);
    console.log(`bills-ca current (${daily.split("/").at(-1)}): ${r.relevant} about AI, ${r.added} new`);
    added += r.added;
    await linkCuratedBills();
    await endRun(runId, true, added);
  } catch (e) { await endRun(runId, false, added, String(e)); throw e; }
  return added;
}
if (import.meta.url === `file://${process.argv[1]}`) { console.log("bills-ca added", await run()); await pool.end(); }
