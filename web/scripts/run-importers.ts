// Run importers on demand: `pnpm import` (all) or `pnpm import lda fec`.
// After importing: refresh search. (New URLs are no longer archived, since 2026-11-16.)
import "./env.ts";
import { pool } from "../src/lib/db.ts";
import { notifySite } from "./lib/ingest.ts";

export const IMPORTERS = ["lda", "fec", "propublica", "regulations", "congress", "openstates", "bills-federal", "bills-ncsl", "bills-ca", "bills-states", "state-lobbying", "news", "social", "blogs", "transcripts"] as const;

export async function runImporters(names: string[]) {
  const results: Record<string, number | string> = {};
  for (const name of names) {
    try {
      const mod = await import(`./importers/${name}.ts`);
      results[name] = await mod.run();
    } catch (e) { results[name] = `error: ${(e as Error).message}`; console.error(name, e); }
    console.log(name, results[name]);
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pick = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const names = pick.length ? pick : [...IMPORTERS];
  await runImporters(names);
  const { indexAll } = await import("./index-search.ts");
  await indexAll().catch((e) => console.warn("search index:", e.message));
  await notifySite();
  await pool.end();
}
