// Load web/.env.local for scripts run outside Next.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const f = resolve(import.meta.dirname, "../.env.local");
if (existsSync(f)) for (const line of readFileSync(f, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
export const REPO = resolve(import.meta.dirname, "../..");
