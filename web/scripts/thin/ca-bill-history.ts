// California bill status and history from leginfo's per-bill history page, read from its existing Wayback copy
// (leginfo answers automated requests with a Cloudflare challenge, which we do not bypass). Nothing is saved to Wayback
// and no bulk file is downloaded: one ~70 KB page per bill. Insert-only; an existing (node, text) pair is skipped.
//   tsx scripts/thin/ca-bill-history.ts [--dry-run]
import "../env.ts";
import { pool, q } from "../../src/lib/db.ts";

const dry = process.argv.includes("--dry-run");
const UA = { "User-Agent": "ModelBehavior-local/0.1" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// archive.org refuses connections for a while after a burst; wait and retry instead of failing.
async function get(url: string) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) }); if (r.ok) return r; } catch {}
    await sleep(30000 * (i + 1));
  }
  return null;
}
const MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const day = (mdy: string) => { const [m, d, y] = mdy.split("/").map(Number); return `${MONTHS[m - 1]} ${d}, ${2000 + y}`; };
const decode = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

function billId(node: string) {
  const m = node.match(/^ca-(ab|sb)(\d+)-(\d{4})$/);
  if (!m) return null;
  const y = Number(m[3]), start = y % 2 ? y : y - 1;
  return `${start}${start + 1}0${m[1].toUpperCase()}${m[2]}`;
}

const bills = await q<{ id: string }>(`SELECT id FROM nodes WHERE type='bill' AND id LIKE 'ca-%' ORDER BY id`);
let added = 0;
for (const { id } of bills) {
  const bid = billId(id);
  if (!bid) { console.log("SKIP id", id); continue; }
  const url = `https://leginfo.legislature.ca.gov/faces/billHistoryClient.xhtml?bill_id=${bid}`;
  const av = await (await get(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`))?.json().catch(() => null);
  const snap: string | undefined = av?.archived_snapshots?.closest?.available ? av.archived_snapshots.closest.url.replace(/^http:/, "https:") : undefined;
  if (!snap) { console.log("NO COPY", id); continue; }
  await sleep(4000);
  const raw = snap.replace(/\/web\/(\d{14})\//, "/web/$1id_/");
  const html = (await (await get(raw))?.text().catch(() => "")) ?? "";
  await sleep(4000);
  const rows = [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)]
    .map((r) => [...r[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((c) => decode(c[1])))
    .filter((c) => c.length >= 2 && /^\d{2}\/\d{2}\/\d{2}$/.test(c[0]));
  if (!rows.length) { console.log("NO ROWS", id, snap); continue; }
  const asOf = snap.match(/\/web\/(\d{4})(\d{2})(\d{2})/)!;
  const asOfText = `${MONTHS[Number(asOf[2]) - 1]} ${Number(asOf[3])}, ${asOf[1]}`;
  const [lastDate, last] = rows[0];
  const intro = rows.find((r) => /^Introduced/.test(r[1]));
  const chapter = rows.find((r) => /Chaptered by Secretary of State/.test(r[1]));
  const veto = rows.find((r) => /Vetoed by (the )?Governor/i.test(r[1]));
  const amended = [...new Set(rows.filter((r) => /amended/i.test(r[1])).map((r) => r[0]))].reverse();

  const facts: { label: string | null; text: string }[] = [];
  if (chapter) {
    const signed = rows.find((r) => /Approved by the Governor/.test(r[1]));
    const ch = chapter[1].match(/Chapter \d+, Statutes of \d{4}/)?.[0];
    facts.push({ label: "Status", text: `Signed into law${signed ? ` on ${day(signed[0])}` : ""}${ch ? ` (${ch})` : ""}` });
  } else if (veto) {
    facts.push({ label: "Status", text: `Vetoed by the Governor on ${day(veto[0])}` });
  } else {
    const words = last.split(" ");
    facts.push({ label: "Status", text: `Latest action ${day(lastDate)}: ${words.slice(0, 30).join(" ")}${words.length > 30 ? "…" : ""} (as of ${asOfText})` });
  }
  if (intro) facts.push({ label: "Introduced", text: day(intro[0]) });
  if (amended.length) facts.push({ label: null, text: `The bill was amended ${amended.length === 1 ? "once" : `${amended.length} times`}: ${amended.map(day).join("; ")}.` });

  for (const f of facts) {
    if (dry) { console.log("DRY", id, f.label ?? "-", f.text); continue; }
    const r = await pool.query(
      `INSERT INTO facts (node_id,text,url,archive_url,label,sort) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (node_id,text) DO NOTHING`,
      [id, f.text, url, snap, f.label, f.label ? (f.label === "Status" ? 2 : 3) : null]);
    added += r.rowCount ?? 0;
  }
  console.log(id, rows.length, "actions", facts.map((f) => f.text).join(" | "));
}
console.log(`added ${added}`);
await pool.end();
