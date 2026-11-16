import { cacheLife, cacheTag } from "next/cache";
import { q } from "@/lib/db";
import { RECORD_TAG } from "@/lib/data";

// Newest write to the record (research loads, importers, review edits), from the changelog.
export default async function LastUpdated() {
  "use cache";
  cacheLife("record");
  cacheTag(RECORD_TAG);
  const [r] = await q<{ at: string | null }>(`SELECT max(at)::text AS at FROM changelog`);
  if (!r?.at) return null;
  const d = new Date(r.at);
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return <span>Last updated <time dateTime={d.toISOString()}>{label}</time></span>;
}
