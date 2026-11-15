// Applies and reverts proposed merges (merge_log). Run by the orchestrator at checkpoint 1.
//   pnpm er:apply  --ids 12,13 | --all-proposed  [--db <url>] [--dry-run]
//   pnpm er:revert --ids 12,13                   [--db <url>]
// A merge moves every reference to `merged_id` onto `kept_id` (every FK to nodes.id plus text columns that hold node ids),
// drops rows that would collide with an existing identical row (kept in the snapshot), merges external IDs, records the old
// name/id as aliases, then deletes the merged node. The full set of touched rows is stored in merge_log.snapshot, so revert
// restores the node, moves rows back and re-inserts collision rows. Each apply/revert runs in one transaction.
import pg from "pg";
import "../../env.ts";

const REF_NAMES = new Set(["node_id", "target_id", "from_id", "to_id", "source_node", "target_node", "lawmaker_id", "stance_target", "target_node_id"]);
const SKIP_TABLES = new Set(["merge_log", "changelog", "links_removed", "nodes"]);   // links_removed.kept_id etc. are history, not references
export type Ref = { table: string; col: string; pk: string[] };

export async function discoverRefs(c: pg.PoolClient): Promise<Ref[]> {
  const fk = await c.query(`SELECT c.conrelid::regclass::text AS t, a.attname AS col FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
                            WHERE c.contype='f' AND c.confrelid='nodes'::regclass`);
  const txt = await c.query(`SELECT table_name AS t, column_name AS col FROM information_schema.columns WHERE table_schema = current_schema() AND data_type='text' AND column_name = ANY($1)`, [[...REF_NAMES]]);
  const seen = new Set<string>(); const refs: Ref[] = [];
  for (const r of [...fk.rows, ...txt.rows]) {
    const t = String(r.t).replace(/^[^.]*\./, "").replace(/"/g, "");
    const k = `${t}.${r.col}`; if (seen.has(k) || SKIP_TABLES.has(t)) continue; seen.add(k);
    const pk = await c.query(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)`, [t]);
    if (!pk.rows.length) continue;   // can't address rows individually; none of ours
    refs.push({ table: t, col: r.col, pk: pk.rows.map((x) => x.attname) });
  }
  return refs;
}
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const pkWhere = (pk: string[], start = 1) => pk.map((k, i) => `${ident(k)} = $${i + start}`).join(" AND ");

type SnapRow = { table: string; col: string; pk: unknown[]; action: "moved" | "deleted"; row: any };

export async function applyMerge(c: pg.PoolClient, id: number, dryRun = false) {
  const { rows: [m] } = await c.query(`SELECT * FROM merge_log WHERE id=$1 FOR UPDATE`, [id]);
  if (!m) throw new Error(`merge_log ${id} not found`);
  if (m.action !== "merge" || m.status !== "proposed") throw new Error(`merge_log ${id} is ${m.action}/${m.status}, not a proposed merge`);
  const { kept_id: kept, merged_id: merged } = m;
  const { rows: [kn] } = await c.query(`SELECT * FROM nodes WHERE id=$1`, [kept]);
  const { rows: [mn] } = await c.query(`SELECT to_jsonb(n) AS j, n.* FROM nodes n WHERE id=$1`, [merged]);   // j keeps microsecond timestamps for the snapshot
  if (!kn || !mn) throw new Error(`merge ${id}: kept=${!!kn} merged=${!!mn} (one side is gone; reject this proposal)`);
  if (kn.type !== mn.type && !(["lab", "investor", "think_tank", "nonprofit", "funder"].includes(kn.type) && ["lab", "investor", "think_tank", "nonprofit", "funder"].includes(mn.type)) && !(kn.type === "person" || kn.type === "lawmaker")) throw new Error(`merge ${id}: incompatible types ${kn.type}/${mn.type}`);
  const refs = await discoverRefs(c);
  const snap: SnapRow[] = [];
  await c.query("SAVEPOINT merge_all");
  for (const r of refs) {
    const rows = (await c.query(`SELECT to_jsonb(t) AS row FROM ${ident(r.table)} t WHERE ${ident(r.col)} = $1`, [merged])).rows;
    for (const { row } of rows) {
      const pk = r.pk.map((k) => row[k]);
      await c.query("SAVEPOINT mv");
      try { await c.query(`UPDATE ${ident(r.table)} SET ${ident(r.col)} = $1 WHERE ${pkWhere(r.pk, 2)}`, [kept, ...pk]); await c.query("RELEASE mv");
        snap.push({ table: r.table, col: r.col, pk, action: "moved", row }); }
      catch (e: any) {
        await c.query("ROLLBACK TO mv");
        if (e.code !== "23505" && e.code !== "23514") throw e;          // unique collision / check: the kept node already has the equivalent row
        await c.query(`DELETE FROM ${ident(r.table)} WHERE ${pkWhere(r.pk)}`, pk);
        snap.push({ table: r.table, col: r.col, pk, action: "deleted", row });
      }
    }
  }
  // links that became self-loops (kept -> kept) are meaningless
  const loops = (await c.query(`SELECT to_jsonb(l) AS row, id FROM links l WHERE from_id=$1 AND to_id=$1`, [kept])).rows;
  for (const l of loops) {
    if (snap.some((s) => s.table === "links" && s.pk[0] === l.id)) { await c.query(`DELETE FROM links WHERE id=$1`, [l.id]);
      const s = snap.find((s) => s.table === "links" && s.pk[0] === l.id)!; s.action = "deleted"; }
  }
  // external_ids: union into kept (legacy jsonb column)
  const merged_ext = { ...mn.external_ids, ...kn.external_ids };
  for (const k of new Set([...Object.keys(mn.external_ids ?? {}), ...Object.keys(kn.external_ids ?? {})])) {
    const vals = [...[kn.external_ids?.[k] ?? []].flat(), ...[mn.external_ids?.[k] ?? []].flat()].map(String);
    const u = [...new Set(vals)]; (merged_ext as any)[k] = u.length === 1 ? u[0] : u;
  }
  await c.query(`UPDATE nodes SET external_ids=$2 WHERE id=$1`, [kept, JSON.stringify(merged_ext)]);
  // the old name and id remain findable
  const aliasIds: number[] = [];
  for (const [alias, kind] of [[mn.name, "former_name"], [merged, "former_name"]] as const) {
    const norm = alias.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const a = await c.query(`INSERT INTO entity_aliases (node_id, alias, alias_norm, kind, source_url, created_by) VALUES ($1,$2,$3,$4,$5,'er:apply') ON CONFLICT (node_id, alias_norm, kind) DO NOTHING RETURNING id`, [kept, alias, norm, kind, mn.source_url]);
    if (a.rows[0]) aliasIds.push(a.rows[0].id);
  }
  await c.query(`DELETE FROM nodes WHERE id=$1`, [merged]);
  const full = { ...(m.snapshot ?? {}), proposal: m.snapshot, applied: { merged_node: mn?.j, kept_before: { external_ids: kn.external_ids }, rows: snap, alias_ids: aliasIds } };
  await c.query(`UPDATE merge_log SET status='applied', applied_at=now(), snapshot=$2 WHERE id=$1`, [id, JSON.stringify(full)]);
  if (dryRun) await c.query("ROLLBACK TO merge_all"); else await c.query("RELEASE merge_all");
  return { id, kept, merged, moved: snap.filter((s) => s.action === "moved").length, collapsed: snap.filter((s) => s.action === "deleted").length };
}

export async function revertMerge(c: pg.PoolClient, id: number) {
  const { rows: [m] } = await c.query(`SELECT * FROM merge_log WHERE id=$1 FOR UPDATE`, [id]);
  if (!m || m.status !== "applied") throw new Error(`merge_log ${id} is ${m?.status}, only applied merges can be reverted`);
  const ap = m.snapshot?.applied; if (!ap) throw new Error(`merge_log ${id} has no applied snapshot`);
  const mn = ap.merged_node;
  const cols = Object.keys(mn);
  await c.query(`INSERT INTO nodes (${cols.map(ident).join(",")}) SELECT ${cols.map(ident).join(",")} FROM jsonb_populate_record(NULL::nodes, $1::jsonb)`, [JSON.stringify(mn)]);
  await c.query(`UPDATE nodes SET external_ids=$2 WHERE id=$1`, [m.kept_id, JSON.stringify(ap.kept_before.external_ids ?? {})]);
  if (ap.alias_ids?.length) await c.query(`DELETE FROM entity_aliases WHERE id = ANY($1)`, [ap.alias_ids]);
  const refs = new Map((await discoverRefs(c)).map((r) => [`${r.table}.${r.col}`, r]));
  for (const s of ap.rows as SnapRow[]) {
    const r = refs.get(`${s.table}.${s.col}`); if (!r) throw new Error(`reference ${s.table}.${s.col} no longer exists; cannot revert merge ${id}`);
    if (s.action === "moved") {
      const u = await c.query(`UPDATE ${ident(s.table)} SET ${ident(s.col)} = $1 WHERE ${pkWhere(r.pk, 2)}`, [m.merged_id, ...s.pk]);
      if (!u.rowCount) await insertRow(c, s.table, s.row);          // the moved row was later deleted: restore it
    } else {
      const ex = await c.query(`SELECT 1 FROM ${ident(s.table)} WHERE ${pkWhere(r.pk)}`, s.pk);
      if (!ex.rowCount) await insertRow(c, s.table, s.row);
    }
  }
  await c.query(`UPDATE merge_log SET status='reverted', reverted_at=now() WHERE id=$1`, [id]);
  return { id, restored: ap.rows.length };
}
async function insertRow(c: pg.PoolClient, table: string, row: any) {
  const cols = Object.keys(row);
  await c.query(`INSERT INTO ${ident(table)} (${cols.map(ident).join(",")}) SELECT ${cols.map(ident).join(",")} FROM jsonb_populate_record(NULL::${ident(table)}, $1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(row)]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode] = process.argv.slice(2);
  const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
  const url = arg("--db") ?? process.env.DATABASE_URL ?? "postgres://mb:mb_local_only@127.0.0.1:5433/model_behavior";
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const c = await pool.connect();
  let ids = (arg("--ids") ?? "").split(",").filter(Boolean).map(Number);
  if (!ids.length && process.argv.includes("--all-proposed")) ids = (await c.query(`SELECT id FROM merge_log WHERE action='merge' AND status='proposed' ${arg("--method") ? "AND method=" + `'${arg("--method")!.replace(/'/g, "")}'` : ""} ORDER BY id`)).rows.map((r) => r.id);
  if (!ids.length) { console.log("usage: er:apply|er:revert --ids 1,2,3 | --all-proposed [--method rule] [--db url] [--dry-run]"); process.exit(1); }
  await c.query("SELECT set_config('mb.actor', 'er', false)");
  let ok = 0, fail = 0;
  for (const id of ids) {
    try {
      await c.query("BEGIN");
      const r = mode === "revert" ? await revertMerge(c, id) : await applyMerge(c, id, process.argv.includes("--dry-run"));
      await c.query("COMMIT"); ok++; console.log(mode, JSON.stringify(r));
    } catch (e: any) { await c.query("ROLLBACK"); fail++;
      if (mode !== "revert" && /one side is gone/.test(e.message)) await c.query(`UPDATE merge_log SET status='rejected', rationale = coalesce(rationale,'') || ' [auto-rejected at apply: a node no longer exists]' WHERE id=$1 AND status='proposed'`, [id]); console.error(`${mode} ${id} FAILED: ${e.message}`); }
  }
  console.log(`${mode}: ${ok} ok, ${fail} failed`);
  c.release(); await pool.end();
}
