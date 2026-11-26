// Download raw .fec filings (docquery.fec.gov/dcdev/posted/<file>.fec) for tracked committees. No API key needed;
// robots.txt asks for a 10 s crawl delay, which we keep. Files are cached under data/cache/money/fec/ (gitignored).
//   tsx fecfiles.ts            # file numbers from the DB's existing FEC links/filings + the cached FEC filings lists
import "../../env.ts";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { REPO } from "../../env.ts";
import { q, pool } from "../../../src/lib/db.ts";
import { cached } from "./fecapi.ts";
import { TRACKED } from "./tracked.ts";

export const FEC_DIR = resolve(REPO, "data/cache/money/fec");
mkdirSync(FEC_DIR, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function wantedFilings(): Promise<Map<string, string>> {  // file_number -> committee id
  const m = new Map<string, string>();
  const rows = await q<{ u: string }>(`SELECT source_url::text u FROM links UNION SELECT url::text FROM filings`);
  for (const { u } of rows) { const x = u.match(/forms\/(C\d+)\/(\d+)/); if (x && TRACKED.some((t) => t.fec === x[1])) m.set(x[2], x[1]); }
  for (const t of TRACKED) {
    const j = cached(`/committee/${t.fec}/filings/`, { per_page: 100, sort: "-receipt_date" });
    for (const r of j?.results ?? []) if (/^F(3|3X|3P|5|24|1M)/.test(r.form_type ?? "") || r.form_type?.startsWith("F")) m.set(String(r.file_number), t.fec);
  }
  return m;
}

async function main() {
  const want = await wantedFilings();
  const have = new Set(readdirSync(FEC_DIR).map((f) => f.replace(".fec", "")));
  const todo = [...want.keys()].filter((f) => !have.has(f));
  console.log(`${want.size} wanted, ${todo.length} to download`);
  for (const f of todo) {
    const res = await fetch(`https://docquery.fec.gov/dcdev/posted/${f}.fec`, { headers: { "User-Agent": "ModelBehavior-local-research/0.1" } });
    if (res.ok) writeFileSync(resolve(FEC_DIR, `${f}.fec`), Buffer.from(await res.arrayBuffer()));
    else console.log("fail", f, res.status);
    await sleep(10_000);
  }
  await pool.end();
  console.log("done");
}
if (import.meta.url === `file://${process.argv[1]}`) main();
