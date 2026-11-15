// Resume points (stmt_cursors) and the collect-only switch used to build evaluation corpora without touching real progress.
import { pool, q } from "../../../src/lib/db.ts";

export const mode = { dry: false };          // dry = collect documents only: no cursor, seen or feed writes (eval/collect.ts sets it)
export const hooks: { onDoc?: (doc: import("./pipeline.ts").Doc) => boolean | void } = {};

export async function getCursor(source: string, key: string) {
  const [r] = await q<{ cursor: string | null; done: boolean }>(`SELECT cursor, done FROM stmt_cursors WHERE source=$1 AND key=$2`, [source, key]);
  return r ?? null;
}
export async function setCursor(source: string, key: string, cursor: string | null, done: boolean) {
  if (mode.dry) return;
  await pool.query(`INSERT INTO stmt_cursors (source, key, cursor, done) VALUES ($1,$2,$3,$4)
    ON CONFLICT (source, key) DO UPDATE SET cursor=$3, done=$4, updated_at=now()`, [source, key, cursor, done]);
}
