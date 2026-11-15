// Local scheduler: `pnpm scheduler` keeps running and fires the daily jobs.
//  05:00  all importers
//  06:30  archive (Wayback lookups + Save Page Now for new URLs)
//  07:00  source audit (dead links, quote checks)
//  07:30  search reindex + email digests
// The Bluesky firehose runs separately and continuously: `pnpm firehose`.
import "./env.ts";
import cron from "node-cron";
import { spawn } from "node:child_process";
import { join } from "node:path";

const tsx = join(import.meta.dirname, "../node_modules/.bin/tsx");
const job = (label: string, file: string, args: string[] = []) => () => {
  console.log(`[${new Date().toISOString()}] start ${label}`);
  const p = spawn(tsx, [join(import.meta.dirname, file), ...args], { stdio: "inherit" });
  p.on("exit", (code) => console.log(`[${new Date().toISOString()}] ${label} exited ${code}`));
};

cron.schedule("0 5 * * *", job("importers", "run-importers.ts"));
cron.schedule("30 6 * * *", job("archive", "archive.ts"));
cron.schedule("0 7 * * *", job("source audit", "check-sources.ts"));
cron.schedule("30 7 * * *", job("search + digest", "digest.ts"));
console.log("scheduler running: importers 05:00, archive 06:30, audit 07:00, digest 07:30 (local time)");
if (process.argv.includes("--now")) job("importers", "run-importers.ts")();
