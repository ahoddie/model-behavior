// Load Nov 3, 2026 general-election results from data/elections/2026-general.json into nodes.external_ids.result
// (shape in src/lib/election.ts). Additive: it writes only the `result` key, and --revert removes every key it wrote.
//  - A race row ("race-2026-ny-12") puts the whole race on the race node and each tracked candidate's outcome on that
//    candidate's node.
//  - A seat row ("seat:lawmaker-adam-schiff") is a tracked lawmaker without a race page; only the lawmaker gets a result.
// Every row must carry a source_url; rows without one are skipped and listed.
//   tsx scripts/fix/load-election-results.ts [--dry-run] [--revert]
import { REPO } from "../env.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const ELECTION = "2026-11-03";
const TAG = "election-results-2026";
const DRY = process.argv.includes("--dry-run");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://mb:mb_local_only@127.0.0.1:5433/model_behavior", max: 1 });
const c = await pool.connect();
await c.query("SELECT set_config('mb.actor', $1, false)", [TAG]);

if (process.argv.includes("--revert")) {
  const r = await c.query(`UPDATE nodes SET external_ids = external_ids - 'result' WHERE external_ids->'result'->>'loaded_by' = $1`, [TAG]);
  console.log(`removed result from ${r.rowCount} nodes`);
  c.release(); await pool.end(); process.exit(0);
}

type Row = {
  race: string; on_ballot: boolean; status: "called" | "uncalled" | "runoff" | "not_up"; official: boolean; as_of: string | null;
  runoff_date?: string | null; source_url: string; source_name: string; note?: string | null;
  candidates: { name: string; party: string | null; votes: number | null; pct: number | null; winner: boolean; id?: string | null }[];
  tracked: { id: string; outcome: string; pct: number | null; note?: string | null }[];
};
const rows: Row[] = JSON.parse(readFileSync(join(REPO, "data/elections/2026-general.json"), "utf8")).races;

const names = new Map((await c.query<{ id: string; name: string }>(`SELECT id, name FROM nodes WHERE type IN ('lawmaker','race')`)).rows.map((r) => [r.id, r.name]));
const last = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/,? (jr|sr|ii|iii|iv)\.?$/, "").trim().split(/\s+/).pop();
const updates: [string, object][] = [];
const skipped: string[] = [];

for (const r of rows) {
  if (!r.source_url) { skipped.push(`${r.race}: no source`); continue; }
  const src = { official: !!r.official, as_of: r.as_of ?? null, source_url: r.source_url, source_name: r.source_name, loaded_by: TAG };
  const isRace = r.race.startsWith("race-");
  if (isRace && !names.has(r.race)) { skipped.push(`${r.race}: no such race node`); continue; }
  // Tie each result row to a tracked candidate by last name, when exactly one tracked candidate matches.
  const cands = r.candidates.map((x) => {
    const hits = r.tracked.filter((t) => names.has(t.id) && last(names.get(t.id)!) === last(x.name));
    return { ...x, id: x.id ?? (hits.length === 1 ? hits[0].id : null) };
  });
  const winner = cands.find((x) => x.winner);
  if (isRace) updates.push([r.race, {
    election: ELECTION, status: r.on_ballot ? r.status : "not_up",
    runoff_date: r.runoff_date ?? null, winner: winner?.id ?? null, winner_name: winner && r.status === "called" ? winner.name : null,
    candidates: cands, note: r.note ?? null, ...src,
  }]);
  for (const t of r.tracked) {
    if (!names.has(t.id)) { skipped.push(`${r.race}: tracked ${t.id} not found`); continue; }
    updates.push([t.id, { election: ELECTION, race: isRace ? r.race : null, outcome: t.outcome, pct: t.pct ?? null, note: t.note ?? null, ...src }]);
  }
}

const seen = new Set<string>();
for (const [id] of updates) { if (seen.has(id)) skipped.push(`${id}: written twice, last row wins`); seen.add(id); }
if (!DRY) {
  await c.query("BEGIN");
  for (const [id, v] of updates) await c.query(`UPDATE nodes SET external_ids = coalesce(external_ids, '{}'::jsonb) || jsonb_build_object('result', $2::jsonb) WHERE id = $1`, [id, JSON.stringify(v)]);
  await c.query("COMMIT");
}
console.log(`${DRY ? "would write" : "wrote"} ${updates.length} results (${updates.filter(([id]) => id.startsWith("race-")).length} races)`);
if (skipped.length) console.log("skipped:\n  " + skipped.join("\n  "));
c.release(); await pool.end();
