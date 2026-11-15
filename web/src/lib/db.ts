import { Pool, type QueryResultRow } from "pg";

const g = globalThis as unknown as { __mbPool?: Pool };
export const pool =
  g.__mbPool ?? new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://mb:mb_local_only@127.0.0.1:5433/model_behavior", max: 8,
    // JIT compiling costs 10-30 s per query on this small database and saves nothing.
    options: "-c jit=off" });
g.__mbPool = pool;

export async function q<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query<T>(text, params);
  return r.rows;
}
