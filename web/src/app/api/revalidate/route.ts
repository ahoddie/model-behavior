import { revalidateTag } from "next/cache";
import { headers } from "next/headers";
import { RECORD_TAG } from "@/lib/data";
import { warmSite } from "@/lib/warm";

// Importers, the loader and the audit run outside Next; they POST here when they change the record.
// Local only: requests from anywhere but this machine are refused.
export async function POST() {
  const h = await headers();
  const hostHeader = h.get("host") ?? "";
  const host = hostHeader.split(":")[0];
  const fwd = h.get("x-forwarded-for");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host) || (fwd && !/^(127\.0\.0\.1|::1)$/.test(fwd))) return new Response("local only", { status: 403 });
  // Mark the record stale rather than deleting it: a reader gets the copy on hand at once while the page is rebuilt behind
  // them, instead of waiting on the database. warmSite then rebuilds every page so the old copy is gone within minutes.
  revalidateTag(RECORD_TAG, "max");
  warmSite(`http://${hostHeader}`, 2_000);
  return Response.json({ ok: true });
}
