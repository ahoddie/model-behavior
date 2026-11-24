// The hand-off to Claude subagents when no API key is set. Readings that are not stored are written to a queue; each
// subagent answers one prompt (A or B) for a slice of it and writes answers-<a|b>-<n>.jsonl; `merge` joins them by key.
// Usage: node --experimental-strip-types scripts/importers/statements/positions/queue.ts merge
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { READINGS, hasReading, storeReading } from "./classify.ts";

export const QUEUE_DIR = join(dirname(READINGS), "queue");
type Item = { key: string; speaker: string; statement: string; quote: string; context?: string };
const queued = new Map<string, Item>();
export function queueReading(it: Item) { if (!hasReading(it.key)) queued.set(it.key, it); }
// Writes the queue in slices of `size`, one file per slice: queue/q-<n>.jsonl. Returns the file names.
export function flushQueue(size = 60): string[] {
  mkdirSync(QUEUE_DIR, { recursive: true });
  const all = [...queued.values()], files: string[] = [];
  for (let i = 0; i < all.length; i += size) {
    const f = join(QUEUE_DIR, `q-${Date.now().toString(36)}-${i / size}.jsonl`);
    writeFileSync(f, all.slice(i, i + size).map((x) => JSON.stringify(x)).join("\n") + "\n"); files.push(f);
  }
  return files;
}
export function merge() {
  const read = (p: string) => readdirSync(QUEUE_DIR).filter((f) => f.startsWith(`answers-${p}-`)).flatMap((f) =>
    readFileSync(join(QUEUE_DIR, f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
  const A = new Map(read("a").map((o: any) => [o.key, o.a ?? o])), B = new Map(read("b").map((o: any) => [o.key, o.b ?? o]));
  let n = 0;
  for (const [k, a] of A) if (B.has(k) && !hasReading(k)) { const { key: _, ...ra } = a as any; const { key: __, ...rb } = B.get(k) as any; storeReading(k, ra, rb); n++; }
  return n;
}
if (process.argv[1]?.endsWith("queue.ts") && process.argv[2] === "merge") console.log({ merged: existsSync(QUEUE_DIR) ? merge() : 0 });
