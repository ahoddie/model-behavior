// provenance:bills — pull every reachable version of each tracked bill's text into data/cache/provenance/ and prov_texts.
// Federal: govinfo.gov (keyless; version codes probed, because Congress.gov's DEMO_KEY allows only 10 calls an hour).
// California: leginfo is behind a Cloudflare challenge, so we read the Wayback copy of the bill page (latest version at capture time).
// New York: legislation.nysenate.gov PDFs. Others: the legislature's own file where a stable URL exists.
// Usage: tsx scripts/pipelines/provenance/fetch-bills.ts [--only node-id]
import { q, getBytes, toText, firstDate, saveText, logGap, decodeEntities, sleep } from "./lib.ts";

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const GOV_CODES: Record<string, string> = { ih: "Introduced in House", is: "Introduced in Senate", rh: "Reported in House", rs: "Reported in Senate", rfs: "Referred in Senate",
  rds: "Received in Senate", eh: "Engrossed in House", es: "Engrossed in Senate", eas: "Engrossed Amendment Senate", pcs: "Placed on Calendar Senate", pch: "Placed on Calendar House",
  ath: "Agreed to House", ats: "Agreed to Senate", enr: "Enrolled", cph: "Considered and Passed House", cps: "Considered and Passed Senate", rih: "Referred in House", ris: "Referred in Senate" };

type Node = { id: string; name: string; source_url: string };
const nodes = await q<Node>(`SELECT id, name, source_url FROM nodes WHERE type IN ('bill','rule') ORDER BY id`);
const sdv = await q<{ target_id: string; label: string; effective_from: string }>(`SELECT target_id, label, effective_from::text FROM sd_bill_versions ORDER BY 1,3`);
let saved = 0;

async function add(n: Node, version: string, date: string | null, url: string, fetchUrl: string, how: "legislative" | "auto" = "auto", via: "direct" | "wayback" = "direct", note?: string) {
  const f = await getBytes(fetchUrl);
  if (!f) { console.log(`  miss ${fetchUrl}`); return false; }
  const text = toText(f, how);
  const d = date ?? firstDate(text);
  if (!d) { await logGap(`- [provenance] ${n.id} ${version}: text fetched but no date could be read, so it was not stored (${url}).`); return false; }
  const id = await saveText({ billNodeId: n.id, version, sourceKind: "bill_version", title: `${n.name}: ${version}`, date: d, url, fetchUrl, text, via, note });
  if (id) { saved++; console.log(`  + ${n.id} ${version} ${d} ${text.split(/\s+/).length}w`); }
  return !!id;
}

// ---- federal bills on govinfo ----------------------------------------------------------------------------------------
for (const n of nodes) {
  if (only && n.id !== only) continue;
  const m = n.id.match(/^us-(\d+)-(hr|s)(\d+)$/);
  if (!m) continue;
  const [, cong, typ, num] = m;
  console.log(n.id);
  let any = false;
  for (const code of Object.keys(GOV_CODES)) {
    const u = `https://www.govinfo.gov/content/pkg/BILLS-${cong}${typ}${num}${code}/html/BILLS-${cong}${typ}${num}${code}.htm`;
    const head = await fetch(u, { method: "HEAD", signal: AbortSignal.timeout(30000), headers: { "User-Agent": "ModelBehavior-local-research/0.1" } }).catch(() => null);
    if (!head?.ok) continue;
    any = (await add(n, GOV_CODES[code], null, u, u)) || any;
    await sleep(300);
  }
  if (!any) await logGap(`- [provenance] ${n.id}: no text found on govinfo.gov (probed ${Object.keys(GOV_CODES).length} version codes); not loaded.`);
}

// ---- California: Wayback copy of the leginfo bill page ----------------------------------------------------------------
for (const n of nodes) {
  if (only && n.id !== only) continue;
  const m = n.source_url.match(/leginfo\.legislature\.ca\.gov\/faces\/\w+\.xhtml\?bill_id=(\w+)/);
  if (!m || !n.id.startsWith("ca-")) continue;
  console.log(n.id);
  const page = `https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=${m[1]}`;
  const wb = `https://web.archive.org/web/2id_/${page}`;
  const f = await getBytes(wb);
  if (!f) { await logGap(`- [provenance] ${n.id}: no Wayback copy of the leginfo bill-text page; text not loaded.`); continue; }
  const html = f.buf.toString("utf8");
  const vid = html.match(/id="vid"[^>]*value="(\w+)"/)?.[1] ?? html.match(/value="(\w+)" id="vid"/)?.[1];
  const opt = vid ? html.match(new RegExp(`<option value="${vid}"[^>]*>\\s*(\\d\\d)/(\\d\\d)/(\\d\\d)\\s*-\\s*([^<]+)<`)) : null;
  const body = html.slice(html.indexOf('id="bill_all"'));
  if (!opt || body.length < 2000) { await logGap(`- [provenance] ${n.id}: Wayback copy of the leginfo page had no readable bill text or version date; not loaded.`); continue; }
  const date = `20${opt[3]}-${opt[1]}-${opt[2]}`;
  const text = toText({ ...f, buf: Buffer.from(body), contentType: "text/html" }, "auto");
  const id = await saveText({ billNodeId: n.id, version: opt[4].trim(), sourceKind: "bill_version", title: `${n.name}: ${opt[4].trim()}`, date, url: page, fetchUrl: wb, text, via: "wayback",
    note: "Latest version at the time of the Wayback capture; leginfo serves other versions only behind a bot challenge." });
  if (id) { saved++; console.log(`  + ${n.id} ${opt[4].trim()} ${date}`); }
}
await logGap(`- [provenance] California: only the latest version of each bill's text could be read (from a Wayback copy of leginfo.legislature.ca.gov, which sits behind a Cloudflare challenge that we do not bypass). Earlier amended versions need the official bulk file pubinfo_2023.zip / pubinfo_2025.zip (1.2 GB each, over the 500 MB approval line) — open decision.`);

// ---- New York RAISE Act: Assembly versions with dates already in sd_bill_versions -------------------------------------
for (const n of nodes) {
  if (only && n.id !== only) continue;
  if (n.id !== "ny-raise-act-2025") continue;
  for (const v of sdv.filter((x) => x.target_id === n.id)) {
    const code = v.label.match(/A6453([AB]?)/)![0].replace(/ as introduced/, "");
    const bare = v.label.includes("as introduced") ? "A6453" : code;
    const page = `https://www.nysenate.gov/legislation/bills/2025/A6453/amendment/${bare.slice(5) || "original"}`;
    await add(n, v.label, v.effective_from, bare === "A6453" ? "https://www.nysenate.gov/legislation/bills/2025/A6453/amendment/original" : page, `https://legislation.nysenate.gov/pdf/bills/2025/${bare}`);
  }
}
await logGap(`- [provenance] New York: only the RAISE Act's Assembly versions were loaded (dates from the bill history). S8828 and A3283 PDFs print no date and the Open Legislation API needs a key, so they are not loaded.`);

// ---- Other states: one stable file per bill (introduced version) ------------------------------------------------------
const OTHER: { id: string; version: string; date: string; page: string; fetch: string }[] = [
  { id: "ut-hb286-2026", version: "Introduced", date: "", page: "https://le.utah.gov/~2026/bills/static/HB0286.html", fetch: "https://le.utah.gov/~2026/bills/static/HB0286.html" },
  { id: "ne-lb1083-2026", version: "Introduced", date: "", page: "https://www.nebraskalegislature.gov/FloorDocs/109/PDF/Intro/LB1083.pdf", fetch: "https://www.nebraskalegislature.gov/FloorDocs/109/PDF/Intro/LB1083.pdf" },
  { id: "mi-hb4668-2025", version: "Introduced", date: "2025-06-24", page: "https://legislature.mi.gov/Bills/Bill?ObjectName=2025-HB-4668", fetch: "https://legislature.mi.gov/documents/2025-2026/billintroduced/House/htm/2025-HIB-4668.htm" },
  { id: "tn-hb1898-2026", version: "Introduced", date: "2026-02-02", page: "https://wapp.capitol.tn.gov/apps/BillInfo/Default.aspx?BillNumber=HB1898&GA=114", fetch: "https://www.capitol.tn.gov/Bills/114/Bill/HB1898.pdf" },
  { id: "il-sb3444-2026", version: "Introduced", date: "", page: "https://www.ilga.gov/Legislation/BillStatus?DocNum=3444&GAID=18&DocTypeID=SB&SessionID=114", fetch: "https://www.ilga.gov/Legislation/BillStatus/FullText?GAID=18&DocNum=3444&DocTypeID=SB&LegId=0&SessionID=114" },
  { id: "il-sb3261-2026", version: "Introduced", date: "", page: "https://www.ilga.gov/Legislation/BillStatus?DocNum=3261&GAID=18&DocTypeID=SB&SessionID=114", fetch: "https://www.ilga.gov/Legislation/BillStatus/FullText?GAID=18&DocNum=3261&DocTypeID=SB&LegId=0&SessionID=114" },
  { id: "il-hb4705-2026", version: "Introduced", date: "", page: "https://www.ilga.gov/Legislation/BillStatus?DocNum=4705&GAID=18&DocTypeID=HB&SessionID=114", fetch: "https://www.ilga.gov/Legislation/BillStatus/FullText?GAID=18&DocNum=4705&DocTypeID=HB&LegId=0&SessionID=114" },
  { id: "co-sb24-205-2024", version: "Enrolled", date: "", page: "https://leg.colorado.gov/bills/sb24-205", fetch: "https://leg.colorado.gov/sites/default/files/documents/2024A/bills/2024a_205_enr.pdf" },
];
for (const o of OTHER) {
  if (only && o.id !== only) continue;
  const n = nodes.find((x) => x.id === o.id); if (!n) continue;
  console.log(o.id);
  const ok = await add(n, o.version, o.date || null, o.page, o.fetch);
  if (!ok) await logGap(`- [provenance] ${o.id}: could not load ${o.version} text from ${o.fetch}.`);
}
console.log({ saved });
process.exit(0);
