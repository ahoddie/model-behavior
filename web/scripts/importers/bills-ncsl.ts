// State AI bills, keyless, from NCSL's public Artificial Intelligence Legislation Database (ncsl.org; records supplied
// to NCSL by LexisNexis State Net). It lists every state bill NCSL staff count as AI legislation since 2025, each with
// its title, status, last action date, author, and dated action history. We keep those plain record fields only, not
// NCSL's summaries or topic tags. One search per state and year, a few seconds apart.
//
// California's bills come from LegInfo, so here NCSL's California list only widens which LegInfo bills count as AI
// (bill_scan source 'ncsl-ca'). When OPENSTATES_API_KEY is set, bills-states refreshes these same rows.
import "../env.ts";
import { pool } from "../../src/lib/db.ts";
import { startRun, endRun, politeFetch, sleep } from "../lib/ingest.ts";
import { upsertBill, saveHistory, linkCuratedBills, actionKind, type Stage, type BillAction } from "../lib/bills.ts";

const URL_DB = "https://www.ncsl.org/financial-services/artificial-intelligence-legislation-database";
const GAP_MS = 5000;
const P = "dnn$ctr34167$StateNetDB$";

// How each legislature writes its bill numbers, from State Net's one-letter chamber codes.
function identifierFor(st: string, type: string, num: string, year: string, code: string): string | null {
  if (/R/.test(type)) return null; // resolutions are left out, as for Congress and California
  const n = String(Number(num));
  if (st === "co") return `${type === "H" ? "HB" : "SB"}${year.slice(2)}${code !== "000" ? "B" : ""}-${num.padStart(code !== "000" ? 3 : 4, "0")}`;
  if (st === "ne") return `LB ${n}`;
  if (["ny", "nj", "ma", "vt"].includes(st)) return `${type} ${n}`;
  if (["mn", "ia"].includes(st)) return `${type === "H" ? "HF" : type === "S" ? "SF" : type} ${n}`;
  if (["nv", "wi"].includes(st) && type === "A") return `AB ${n}`;
  return `${type === "H" ? "HB" : type === "S" ? "SB" : type === "A" ? "AB" : type} ${n}`;
}

const mdy = (s: string) => { const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };
const clean = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const chamberOf = (t: string): BillAction["chamber"] =>
  /GOVERNOR/.test(t) ? "executive" : /\bSENATE\b/.test(t) ? "upper" : /\b(HOUSE|ASSEMBLY)\b/.test(t) ? "lower" : /LEGISLATURE/.test(t) ? "joint" : null;

export type NcslBill = { sid: string; st: string; year: string; code: string; type: string; num: string; title: string; status: string;
  lastAction: string | null; author: string | null; history: { date: string; text: string }[]; link: string };

export function parseResults(html: string): NcslBill[] {
  const parts = html.split(/<a href='(?=http:\/\/custom\.statenet\.com\/public\/resources\.cgi\?id=ID:bill:)/).slice(1);
  const out: NcslBill[] = [];
  for (const p of parts) {
    const link = p.slice(0, p.indexOf("'"));
    const sid = link.match(/ID:bill:([A-Z0-9]+)/)?.[1] ?? "";
    const m = sid.match(/^([A-Z]{2})(\d{4})(\d{3})([A-Z]+)(\d+)$/);
    if (!m) continue;
    const field = (label: string) => p.match(new RegExp(`<b>${label}:\\s*</b>([\\s\\S]*?)<br`))?.[1];
    const hist = p.match(/class="historyList"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    out.push({
      sid, st: m[1].toLowerCase(), year: m[2], code: m[3], type: m[4], num: m[5], link: link.replace(/&amp;/g, "&"),
      title: clean(p.match(/<div style="font-weight: bold;">([\s\S]*?)<\/div>/)?.[1] ?? ""),
      status: clean(field("Status") ?? ""), lastAction: mdy(field("Date of Last Action") ?? ""), author: clean(field("Author") ?? "") || null,
      history: hist.split(/<br\s*\/?>/).map((l) => clean(l)).map((l) => ({ date: mdy(l.slice(0, 10)) ?? "", text: l.replace(/^\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*/, "") }))
        .filter((h) => h.date && h.text),
    });
  }
  return out;
}

/** Stage from NCSL's status line, and for pending bills from which chambers the history says passed it. */
export function stageFor(b: NcslBill): { stage: Stage; date: string | null } {
  const s = b.status.toLowerCase();
  const last = (rx: RegExp) => b.history.filter((h) => rx.test(h.text)).at(-1)?.date ?? null;
  if (s.startsWith("enacted")) return { stage: "enacted", date: last(/signed by governor|enacted|became law|chapter|act no|public act|approved by governor/i) ?? b.lastAction };
  if (s.startsWith("vetoed") || s.startsWith("override pending")) return { stage: "vetoed", date: last(/veto/i) ?? b.lastAction };
  if (s.startsWith("to governor")) return { stage: "passed_legislature", date: last(/to governor|enrolled/i) ?? b.lastAction };
  if (s.startsWith("failed")) return { stage: "failed", date: b.lastAction };
  const passed = new Set(b.history.filter((h) => /\bPassed (SENATE|HOUSE|ASSEMBLY|LEGISLATURE)\b/i.test(h.text)).map((h) => h.text.match(/Passed (\w+)/i)![1].toUpperCase()));
  if (passed.size >= 2 || (b.st === "ne" && passed.size >= 1)) return { stage: "passed_legislature", date: last(/\bPassed (SENATE|HOUSE|ASSEMBLY|LEGISLATURE)\b/i) };
  if (passed.size === 1) return { stage: "passed_one_chamber", date: last(/\bPassed (SENATE|HOUSE|ASSEMBLY|LEGISLATURE)\b/i) };
  const ref = b.history.find((h) => /committee|referred/i.test(h.text));
  if (ref || /committee/i.test(s)) return { stage: "in_committee", date: ref?.date ?? null };
  return { stage: "introduced", date: b.history[0]?.date ?? null };
}

async function search(st: string, year: string): Promise<string> {
  const r0 = await politeFetch(URL_DB, { signal: AbortSignal.timeout(90_000) });
  const cookie = (r0.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const page = await r0.text();
  const idx = page.match(new RegExp(`name="${P.replace(/\$/g, "\\$")}ckBxStates\\$(\\d+)" value="${st.toUpperCase()}"`))?.[1];
  if (idx === undefined) throw new Error(`no state box for ${st}`);
  const f = new URLSearchParams();
  for (const m of page.matchAll(/name="(__[A-Z]+)"[^>]*value="([^"]*)"/g)) f.set(m[1], m[2]);
  f.set(`${P}ckBxStates$${idx}`, st.toUpperCase());
  f.set(`${P}ddlYear`, year); f.set(`${P}ddlStatus`, "NA");
  for (const k of ["txtKeyword", "txtBillNumber", "txtAuthor"]) f.set(P + k, "");
  f.set(`${P}btnSearch`, "Search");
  await sleep(1500);
  const r = await politeFetch(URL_DB, { method: "POST", body: f, signal: AbortSignal.timeout(180_000),
    headers: { cookie, "Content-Type": "application/x-www-form-urlencoded" } });
  if (!r.ok) throw new Error(`NCSL ${st} ${year}: HTTP ${r.status}`);
  return r.text();
}

export async function run(opts: { states?: string[]; years?: string[] } = {}) {
  const runId = await startRun("bills-ncsl");
  const now = new Date().getUTCFullYear();
  const years = opts.years ?? [String(now - 1), String(now)].filter((y) => Number(y) >= 2025);
  const states = opts.states ?? (await pool.query(`SELECT code FROM jurisdictions WHERE level='state' ORDER BY sort`)).rows.map((r: any) => r.code);
  let kept = 0;
  const failures: string[] = [];
  try {
    const byId = new Map<string, NcslBill & { years: Set<string> }>();
    for (const st of states) for (const year of years) {
      let html: string;
      try { html = await search(st, year); } catch (e) { failures.push(`${st} ${year}: ${(e as Error).message}`); await sleep(GAP_MS); continue; }
      const found = parseResults(html);
      for (const b of found) {
        const prev = byId.get(b.sid);
        // The same bill shows in both years of a two-year session; the later listing has the newer history.
        if (!prev || (b.history.length >= prev.history.length)) byId.set(b.sid, { ...b, years: new Set([...(prev?.years ?? []), year]) });
        else prev.years.add(year);
      }
      console.log(`bills-ncsl ${st} ${year}: ${found.length}`);
      await sleep(GAP_MS);
    }
    const caIndex: string[] = [];
    for (const b of byId.values()) {
      if (b.st === "ca") {
        // LegInfo id: session start year + session code + type + number, e.g. 202520260SB53.
        const start = Number(b.year) % 2 ? Number(b.year) : Number(b.year) - 1;
        if (!/R/.test(b.type)) caIndex.push(`${start}${start + 1}${b.code === "000" ? "0" : b.code.slice(-1)}${b.type === "A" ? "AB" : b.type === "S" ? "SB" : b.type}${b.num.replace(/^0+/, "")}`);
        continue;
      }
      const ident = identifierFor(b.st, b.type, b.num, b.year, b.code);
      if (!ident || !b.title) continue;
      const session = b.code === "000" ? b.year : `${b.year}-special-${Number(b.code)}`;
      const id = `${b.st}-${session}-${ident.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
      const { stage, date } = stageFor(b);
      const lastH = b.history.at(-1);
      await upsertBill({
        id, jurisdiction: b.st, session, identifier: ident, bill_type: ident.replace(/[\s\d-].*$/, "").toLowerCase(), number: String(Number(b.num)),
        chamber: b.st === "ne" ? "joint" : b.type.startsWith("H") || b.type === "A" ? "lower" : "upper", title: b.title,
        introduced_date: b.history.find((h) => /introduc|prefiled|filed/i.test(h.text))?.date ?? b.history[0]?.date ?? null,
        stage, stage_date: date, status_text: lastH?.text ?? b.status, status_date: lastH?.date ?? b.lastAction,
        sponsor: b.author, ai_match: "ncsl", source: "ncsl", source_url: b.link, data_url: URL_DB,
        external_ids: { statenet: b.sid, years: [...new Set([b.year, ...b.years])], ncsl_status: b.status },
      });
      await saveHistory(id, b.history.map((h) => ({ date: h.date, text: h.text, chamber: chamberOf(h.text), kind: actionKind(h.text) })));
      kept++;
    }
    if (caIndex.length) {
      await pool.query(`DELETE FROM bill_scan WHERE source='ncsl-ca'`);
      await pool.query(`INSERT INTO bill_scan (source, key, modified, relevant) SELECT 'ncsl-ca', k, now(), true FROM unnest($1::text[]) k ON CONFLICT DO NOTHING`, [caIndex]);
    }
    await linkCuratedBills();
    await endRun(runId, failures.length < states.length, kept, failures.join("; ").slice(0, 1900));
    if (failures.length) console.log("bills-ncsl failures:", failures);
  } catch (e) { await endRun(runId, false, kept, String(e)); throw e; }
  return kept;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const states = process.argv.slice(2).filter((a) => /^[a-z]{2}$/.test(a));
  console.log("bills-ncsl kept", await run(states.length ? { states } : {}));
  await pool.end();
}
