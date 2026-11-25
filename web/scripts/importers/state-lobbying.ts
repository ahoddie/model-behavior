// State lobbying.
//  CA: CAL-ACCESS official bulk export (the search pages sit behind bot protection, which this does not bypass).
//      Opt-in because the zip is large: `tsx scripts/importers/state-lobbying.ts --ca-download`.
//      Uses CVR_LOBBY_DISCLOSURE_CD (Form 635 lobbyist-employer reports): every report filed by a lab/investor/
//      advocacy node becomes a filing; bills named in the activity text (e.g. "SB 53") link to bill nodes.
//  NY: data.ny.gov "Lobbying Clients Disclosures" (dataset 8bmh-tuz3). The open dataset currently stops in 2018;
//      set NY_LOBBY_DATASET to a newer dataset id when COELIG publishes one.
//  MA and others: no machine-readable source without bot-protected pages → logged in data/gaps.md.
import { REPO } from "../env.ts";
import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { q } from "../../src/lib/db.ts";
import { insertFiling, insertLink, startRun, endRun, politeFetch, sleep } from "../lib/ingest.ts";

const CA_SUFFIX = new Set(["AND", "ITS", "AFFILIATES", "AFFILIATED", "COM", "SERVICES", "AMERICA", "USA", "COMPUTER", "HOLDINGS"]);
const CA_ZIP_URL = "https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip";
const tokens = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !["INC", "LLC", "CORP", "CORPORATION", "THE", "CO", "LP", "PBC"].includes(t));

async function caImport(actors: { id: string; name: string; external_ids: any }[], bills: Map<string, string>) {
  const dir = join(REPO, "data/raw/calaccess");
  const zip = join(dir, "dbwebexport.zip");
  if (!existsSync(zip)) {
    if (!process.argv.includes("--ca-download")) { console.log("ca: no bulk export on disk; run with --ca-download to fetch it"); return 0; }
    mkdirSync(dir, { recursive: true });
    console.log(`ca: downloading ${CA_ZIP_URL}`);
    const res = await fetch(CA_ZIP_URL);
    if (!res.ok || !res.body) throw new Error(`ca download ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(zip));
  }
  const unz = spawn("unzip", ["-p", zip, "*CVR_LOBBY_DISCLOSURE_CD.TSV"]);
  const rl = createInterface({ input: unz.stdout });
  let header: string[] | null = null, added = 0;
  const want = actors.map((a) => ({ a, t: tokens([a.external_ids?.calaccess_name ?? a.name].flat()[0]) }));
  for await (const line of rl) {
    const cols = line.split("\t");
    if (!header) { header = cols.map((c) => c.trim().toUpperCase()); continue; }
    const row = Object.fromEntries(header.map((h, i) => [h, cols[i]?.trim() ?? ""]));
    if (row.FORM_TYPE !== "F635") continue;
    // The filer's name must start with the tracked name, followed only by a corporate suffix: "Apple Inc." and "Google LLC
    // and its affiliates" match, but "California Apple Commission", "Town of Apple Valley", and unions that merely carry
    // "AFL-CIO" in their names do not.
    const filer = tokens(`${row.FILER_NAML} ${row.FILER_NAMF}`);
    const hit = want.find(({ t }) => t.length && t.every((x, i) => filer[i] === x) && (filer.length === t.length || CA_SUFFIX.has(filer[t.length])));
    if (!hit) continue;
    const url = `https://cal-access.sos.ca.gov/PDFGen/pdfgen.prg?filingid=${row.FILING_ID}&amendid=${row.AMEND_ID}`;
    const from = row.FROM_DATE?.split(" ")[0], thru = row.THRU_DATE?.split(" ")[0];
    // Some reports carry typo'd years (0212, 2033); a date outside the years CAL-ACCESS covers is dropped, not guessed.
    const iso = (d?: string) => { const m = d?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m && +m[3] >= 1999 && +m[3] <= new Date().getFullYear() + 1 ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };
    const activity = row.LBY_ACTVTY ?? "";
    if (await insertFiling({ node: hit.a.id, filing_type: "state lobbying", period: `CA ${iso(from) ?? from} to ${iso(thru) ?? thru}`, filed_date: iso(row.RPT_DATE?.split(" ")[0]),
      description: `California Form 635 (lobbyist employer report). ${activity.slice(0, 1200)}`, url, filing_id: `CA-${row.FILING_ID}-${row.AMEND_ID}` }, "importer:state-lobbying")) added++;
    for (const m of activity.matchAll(/\b(SB|AB|ACA|SCA)\s?-?(\d{1,4})\b/gi)) {
      const year = (iso(thru) ?? "").slice(0, 4);
      const bill = bills.get(`ca-${m[1].toLowerCase()}${m[2]}-${year}`) ?? bills.get(`ca-${m[1].toLowerCase()}${m[2]}-${Number(year) - 1}`);
      if (bill) await insertLink({ from: hit.a.id, to: bill, type: "money", subtype: "lobbying", amount: null, date_start: iso(from),
        note: `Named in a California Form 635 lobbying report.`, source_url: url }, "importer:state-lobbying");
    }
  }
  return added;
}

async function nyImport(actors: { id: string; name: string; external_ids: any }[]) {
  const ds = process.env.NY_LOBBY_DATASET || "8bmh-tuz3";
  let added = 0;
  for (const a of actors) {
    const name = [a.external_ids?.ny_lobby_name ?? a.name].flat()[0].toUpperCase().replace(/'/g, "''");
    const url = `https://data.ny.gov/resource/${ds}.json?$where=${encodeURIComponent(`upper(client_name) like '%${name}%'`)}&$limit=500`;
    const res = await politeFetch(url);
    if (!res.ok) continue;
    for (const r of (await res.json()) as any[]) {
      const bills = Object.entries(r).filter(([k]) => k.startsWith("bill_details")).map(([, v]) => v).filter((v) => v && v !== "NULL").join("; ");
      const amount = Number(r.total_compensation ?? 0) + Number(r.total_expenses ?? 0) || null;
      const src = `https://data.ny.gov/resource/${ds}.json?$where=${encodeURIComponent(`client_name='${r.client_name.replace(/'/g, "''")}' AND reporting_year='${r.reporting_year}' AND reporting_period='${r.reporting_period}'`)}`;
      // A few rows carry a client_name thousands of characters long, which makes a URL too big for the filings index and
      // ended the whole run (2026-11-24). Skip those rows.
      if (src.length > 2000) { console.warn(`ny: skipped a ${a.id} row whose client_name is ${r.client_name.length} characters`); continue; }
      if (await insertFiling({ node: a.id, filing_type: "state lobbying", period: `NY ${r.reporting_year} ${r.reporting_period}`, amount,
        description: `New York client disclosure. ${bills.slice(0, 1200)}`, url: src, filing_id: `NY-${r.client_name}-${r.reporting_year}-${r.reporting_period}` }, "importer:state-lobbying")) added++;
    }
    await sleep(300);
  }
  return added;
}

export async function run() {
  const runId = await startRun("state-lobbying");
  let added = 0;
  try {
    const actors = await q<{ id: string; name: string; external_ids: any }>(`SELECT id,name,external_ids FROM nodes WHERE type IN ('lab','investor','funder','think_tank','nonprofit')`);
    const bills = new Map((await q<{ id: string }>(`SELECT id FROM nodes WHERE type='bill' AND id LIKE 'ca-%'`)).map((b) => [b.id, b.id]));
    added += await caImport(actors, bills);
    added += await nyImport(actors);
    await endRun(runId, true, added);
  } catch (e) { await endRun(runId, false, added, String(e)); throw e; }
  return added;
}
if (import.meta.url === `file://${process.argv[1]}`) { console.log("state lobbying added", await run()); process.exit(0); }
