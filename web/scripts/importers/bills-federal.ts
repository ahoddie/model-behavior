// Federal bills from GovInfo's BILLSTATUS bulk data (the Library of Congress record behind Congress.gov; no API key).
// Covers bills and joint resolutions (hr, s, hjres, sjres) of the current and previous Congress. The first run reads
// each type's zip once (about 50 MB in all); after that only files GovInfo lists as changed since the last scan are
// fetched. Every file scanned is remembered, so a bill that later gains the CRS subject "Artificial intelligence" is
// picked up when its record changes. Stage comes from the action record; see stageFor below.
import "../env.ts";
import { pool } from "../../src/lib/db.ts";
import { startRun, endRun, politeFetch, sleep } from "../lib/ingest.ts";
import { aiMatch, upsertBill, linkCuratedBills, scanned, markScanned, saveHistory, actionKind, type Stage, type BillVote } from "../lib/bills.ts";
import { listZipBuffer, readZipBufferEntry } from "../lib/remote-zip.ts";

const BULK = "https://www.govinfo.gov/bulkdata";
const TYPES = ["hr", "s", "hjres", "sjres"] as const;
const LABEL: Record<string, string> = { hr: "H.R.", s: "S.", hjres: "H.J.Res.", sjres: "S.J.Res." };
const URL_KIND: Record<string, string> = { hr: "house-bill", s: "senate-bill", hjres: "house-joint-resolution", sjres: "senate-joint-resolution" };
const ZIP_IF_MORE_THAN = 600; // past this many changed files, one zip is cheaper than single requests

// The Congress sitting on a date: the 119th runs Jan 3 2025 to Jan 3 2027, and so on every two years.
export function congressOn(date = new Date()): number {
  const y = date.getUTCFullYear();
  const startedThisYear = y % 2 === 1 && (date.getUTCMonth() > 0 || date.getUTCDate() >= 3);
  const firstYear = y % 2 === 1 ? (startedThisYear ? y : y - 2) : y - 1;
  return 119 + (firstYear - 2025) / 2;
}

const tag = (x: string, t: string) => x.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]?.trim() ?? null;
const all = (x: string, t: string) => [...x.matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, "g"))].map((m) => m[1].trim());
const unxml = (s: string | null) => s?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'") ?? null;
const drop = (x: string, ...ts: string[]) => ts.reduce((s, t) => s.replace(new RegExp(`<${t}>[\\s\\S]*?</${t}>`, "g"), ""), x);

type Action = { date: string; text: string; type: string; code: string | null; roll: string | null; chamber: string | null };

/** Stage from the action record. Floor passage is read from the action codes (8000 House, 17000 Senate) or their text. */
export function stageFor(actions: Action[], hasLaw: boolean, congressOver: boolean): { stage: Stage; date: string | null } {
  const by = (f: (a: Action) => boolean) => actions.filter(f).sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.date ?? null;
  const law = by((a) => a.type === "BecameLaw" || /Became Public Law/i.test(a.text));
  if (hasLaw || law) return { stage: "enacted", date: law };
  const veto = by((a) => a.type === "Veto" || /^(Vetoed|Pocket vetoed) by President/i.test(a.text));
  if (veto) return { stage: "vetoed", date: veto };
  const house = by((a) => a.code === "8000" || /Passed\/agreed to in House|passed House/i.test(a.text));
  const senate = by((a) => a.code === "17000" || /Passed\/agreed to in Senate|passed Senate/i.test(a.text));
  const presented = by((a) => a.code === "28000" || /Presented to President/i.test(a.text));
  let s: { stage: Stage; date: string | null };
  if (presented || (house && senate)) s = { stage: "passed_legislature", date: presented ?? [house!, senate!].sort().at(-1)! };
  else if (house || senate) s = { stage: "passed_one_chamber", date: house ?? senate };
  else {
    const ref = by((a) => a.type === "IntroReferral" && /referred/i.test(a.text) || a.type === "Committee");
    s = ref ? { stage: "in_committee", date: actions.find((a) => a.type === "IntroReferral" && /referred/i.test(a.text))?.date ?? ref } : { stage: "introduced", date: null };
  }
  // A Congress that has ended takes its unfinished bills with it; they must be reintroduced.
  if (congressOver && s.stage !== "passed_legislature") return { stage: "failed", date: null };
  return s;
}

export function parseBillStatus(xml: string) {
  const b = drop(tag(xml, "bill") ?? "", "relatedBills", "cosponsors", "titles", "summaries", "textVersions", "cboCostEstimates", "committeeReports",
    "committees", "amendments", "constitutionalAuthorityStatementText", "notes", "cdata");
  // Actions are read before the committee blocks are stripped: each action's own committee code tells its chamber.
  const actionsXml = (tag(drop(tag(xml, "bill") ?? "", "relatedBills", "amendments", "cosponsors", "titles", "summaries", "textVersions"), "actions") ?? "")
    // Nested committee lists would split an action's <item> early; keep only the first committee's code.
    .replace(/<committees>[\s\S]*?<\/committees>/g, (c) => `<cmte>${tag(c, "systemCode") ?? ""}</cmte>`)
    .replace(/<recordedVotes>[\s\S]*?<\/recordedVotes>/g, (r) => `<rollUrl>${tag(r, "url") ?? ""}</rollUrl><rollChamber>${tag(r, "chamber") ?? ""}</rollChamber>`);
  const actions: Action[] = all(actionsXml, "item").filter((i) => tag(i, "actionDate")).map((i) => ({
    date: tag(i, "actionDate")!, text: unxml(tag(drop(i, "committees", "sourceSystem"), "text")) ?? "", type: tag(drop(i, "committees", "sourceSystem"), "type") ?? "",
    code: tag(i, "actionCode"), roll: tag(i, "rollUrl") || null,
    chamber: (tag(i, "rollChamber") || null) ?? (/^H/.test(tag(i, "actionCode") ?? "") ? "House" : /^S/.test(tag(i, "actionCode") ?? "") ? "Senate" : null)
      // Committee actions carry no action code; the committee's system code says which chamber (hs..., ss...).
      ?? ({ h: "House", s: "Senate" } as Record<string, string>)[(tag(i, "cmte") ?? "").slice(0, 1)] ?? null }));
  const subjXml = tag(b, "subjects") ?? "";
  const subjects = [...all(tag(subjXml, "legislativeSubjects") ?? "", "name"), ...(tag(subjXml, "policyArea") ? [tag(tag(subjXml, "policyArea")!, "name")!] : [])].map((s) => unxml(s)!);
  const latest = tag(b, "latestAction") ?? "";
  const sponsorItem = tag(tag(b, "sponsors") ?? "", "item") ?? "";
  return {
    congress: Number(tag(b, "congress")), type: (tag(b, "type") ?? "").toLowerCase(), number: tag(b, "number")!,
    title: unxml(tag(drop(b, "actions", "latestAction", "sponsors", "subjects", "laws", "policyArea"), "title")) ?? "",
    introduced: tag(b, "introducedDate"), updated: tag(b, "updateDateIncludingText") ?? tag(b, "updateDate"),
    url: tag(b, "legislationUrl"), sponsor: unxml(tag(sponsorItem, "fullName")), subjects, actions,
    latest: { date: tag(latest, "actionDate"), text: unxml(tag(latest, "text")) }, hasLaw: /<laws>\s*<item>/.test(b),
  };
}

async function listing(congress: number, type: string): Promise<{ name: string; modified: string }[] | null> {
  const res = await politeFetch(`${BULK}/json/BILLSTATUS/${congress}/${type}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) return null; // e.g. a new Congress with no bills yet
  const j: any = await res.json();
  // formattedLastModifiedTime is "28-Sep-2026 16:24" (GovInfo's clock, Eastern); the minute is all we need for change detection.
  return (j.files ?? []).filter((f: any) => f.name.endsWith(".xml")).map((f: any) => {
    const t = new Date(`${f.formattedLastModifiedTime} EST`);
    return { name: f.name, modified: (isNaN(+t) ? new Date() : t).toISOString() };
  });
}

async function save(xml: string, file: string, modified: string, current: number) {
  const p = parseBillStatus(xml);
  // A bill on the map is kept even when its title and subjects don't say AI (the Chip Security Act, say).
  const curated = await pool.query(`SELECT 1 FROM nodes WHERE id=$1 AND type='bill'`, [`us-${p.congress}-${p.type}${p.number}`]);
  const match = aiMatch(p.title, p.subjects) ?? (curated.rowCount ? "curated" : null);
  if (!match || !p.title) return { relevant: false, added: false };
  const { stage, date } = stageFor(p.actions, p.hasLaw, p.congress < current);
  const added = await upsertBill({
    id: `us-${p.congress}-${p.type}${p.number}`, jurisdiction: "us", session: String(p.congress), identifier: `${LABEL[p.type]} ${p.number}`,
    bill_type: p.type, number: p.number, chamber: p.type.startsWith("h") ? "lower" : "upper", title: p.title, introduced_date: p.introduced,
    stage, stage_date: date, status_text: p.latest.text, status_date: p.latest.date, sponsor: p.sponsor, subjects: p.subjects, ai_match: match,
    source: "govinfo", source_url: p.url ?? `https://www.congress.gov/bill/${p.congress}th-congress/${URL_KIND[p.type]}/${p.number}`,
    data_url: `${BULK}/BILLSTATUS/${p.congress}/${p.type}/${file}`, source_modified: modified,
  });
  // History: Congress.gov lists most floor actions twice (the chamber's own record and the Library's); keep one of each.
  const seen = new Set<string>();
  const acts = [...p.actions].reverse().sort((a, b) => a.date.localeCompare(b.date)).filter((a) => {
    const k = `${a.date}|${a.text.replace(/^(Passed\/agreed to in (House|Senate)): /, "")}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  const ch = (c: string | null) => (c === "House" ? "lower" : c === "Senate" ? "upper" : null) as "lower" | "upper" | null;
  // Roll calls: the tally is in the action's own wording ("Yeas and Nays: 409 - 2", "Yea-Nay Vote. 99 - 1").
  const votes: BillVote[] = [];
  const rolls = new Set<string>();
  for (const a of acts) {
    const t = a.text.match(/(?:Yeas and Nays|Yea-Nay Vote|Recorded Vote)[^]*?(\d+)\s*-\s*(\d+)/i);
    if (!t) continue;
    const key = a.roll ?? `${a.date}|${t[1]}-${t[2]}`;
    if (rolls.has(key)) continue; rolls.add(key);
    const roll = a.roll && /clerk\.house\.gov/.test(a.roll) ? "House" : a.roll && /senate\.gov/.test(a.roll) ? "Senate" : null;
    votes.push({ date: a.date, chamber: ch(a.chamber ?? roll), motion: a.text, yes: Number(t[1]), no: Number(t[2]),
      result: /agreed to|passed|adopted|ordered to be reported/i.test(a.text) ? "passed" : /failed|not agreed|rejected/i.test(a.text) ? "failed" : null, source_url: a.roll });
  }
  await saveHistory(`us-${p.congress}-${p.type}${p.number}`, acts.map((a) => ({ date: a.date, text: a.text, chamber: ch(a.chamber),
    kind: a.type === "BecameLaw" ? "enacted" : a.type === "Veto" ? "vetoed" : actionKind(a.text) })), votes);
  return { relevant: true, added };
}

export async function run(opts: { congresses?: number[] } = {}) {
  const current = congressOn();
  const congresses = opts.congresses ?? [current - 1, current];
  const runId = await startRun("bills-federal");
  let added = 0, touched = 0;
  try {
    const seen = await scanned("govinfo");
    for (const congress of congresses) for (const type of TYPES) {
      const files = await listing(congress, type);
      if (!files) { console.log(`bills-federal: no listing for ${congress}/${type}`); continue; }
      const changed = files.filter((f) => (seen.get(f.name) ?? -1) < Date.parse(f.modified) / 1000);
      if (!changed.length) continue;
      const marks: { key: string; modified: string; relevant: boolean }[] = [];
      const want = new Map(changed.map((f) => [f.name, f.modified]));
      if (changed.length > ZIP_IF_MORE_THAN) {
        const res = await politeFetch(`${BULK}/BILLSTATUS/${congress}/${type}/BILLSTATUS-${congress}-${type}.zip`, { signal: AbortSignal.timeout(20 * 60_000) });
        if (!res.ok) throw new Error(`zip ${congress}/${type}: HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        for (const e of listZipBuffer(buf)) {
          const name = e.name.split("/").at(-1)!;
          if (!want.has(name)) continue;
          const r = await save(readZipBufferEntry(buf, e).toString("utf8"), name, want.get(name)!, current);
          marks.push({ key: name, modified: want.get(name)!, relevant: r.relevant });
          if (r.relevant) touched++;
          if (r.added) added++;
        }
      } else {
        for (const f of changed) {
          const res = await politeFetch(`${BULK}/BILLSTATUS/${congress}/${type}/${f.name}`, { signal: AbortSignal.timeout(60_000) });
          if (!res.ok) continue;
          const r = await save(await res.text(), f.name, f.modified, current);
          marks.push({ key: f.name, modified: f.modified, relevant: r.relevant });
          if (r.relevant) touched++;
          if (r.added) added++;
          await sleep(150);
        }
      }
      await markScanned("govinfo", marks);
      console.log(`bills-federal ${congress}/${type}: ${changed.length} changed, ${marks.filter((m) => m.relevant).length} about AI`);
    }
    // When a Congress ends, its open bills fail even if GovInfo never touches their files again.
    await pool.query(`UPDATE bills SET stage='failed', stage_date=NULL, updated_at=now() WHERE jurisdiction='us' AND session::int < $1
      AND stage IN ('introduced','in_committee','passed_one_chamber')`, [current]);
    await linkCuratedBills();
    await endRun(runId, true, added, `${touched} AI bills new or changed`);
  } catch (e) { await endRun(runId, false, added, String(e)); throw e; }
  return added;
}
if (import.meta.url === `file://${process.argv[1]}`) { console.log("bills-federal added", await run()); await pool.end(); }
