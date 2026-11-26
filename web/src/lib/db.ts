import { Pool, type QueryResultRow } from "pg";

const g = globalThis as unknown as { __mbPool?: Pool };
const url = process.env.DATABASE_URL ?? "postgres://mb:mb_local_only@127.0.0.1:5433/model_behavior";
export const pool =
  g.__mbPool ?? new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 8),
    // JIT compiling costs 10-30 s per query on this small database and saves nothing. A pooled hosted connection (Neon's
    // "-pooler" host) refuses startup options, so there it is set once on the database instead (docs/deploy.md).
    ...(/-pooler\./.test(url) ? {} : { options: "-c jit=off" }) });
g.__mbPool = pool;

export async function q<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query<T>(text, params);
  return r.rows;
}
