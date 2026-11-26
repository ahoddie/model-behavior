import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { headers } from "next/headers";
import { RECORD_TAG } from "@/lib/data";
import { warmSite } from "@/lib/warm";

// Importers, the loader and the audit run outside Next; they POST here when they change the record.
// Requests from this machine are accepted. From anywhere else (the nightly GitHub Actions job refreshing the hosted
// site), only with "Authorization: Bearer <REVALIDATE_SECRET>", and only when REVALIDATE_SECRET is set.
function authorized(h: Headers, host: string) {
  const secret = process.env.REVALIDATE_SECRET;
  if (secret && secret.length >= 16) {
    const a = Buffer.from(h.get("authorization") ?? ""), b = Buffer.from(`Bearer ${secret}`);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  const fwd = h.get("x-forwarded-for");
  return !process.env.VERCEL && ["localhost", "127.0.0.1", "[::1]"].includes(host) && (!fwd || /^(127\.0\.0\.1|::1)$/.test(fwd));
}

export async function POST() {
  const h = await headers();
  const hostHeader = h.get("host") ?? "";
  if (!authorized(h, hostHeader.split(":")[0])) return new Response("forbidden", { status: 403 });
  // Mark the record stale rather than deleting it: a reader gets the copy on hand at once while the page is rebuilt behind
  // them, instead of waiting on the database. warmSite then rebuilds every page so the old copy is gone within minutes.
  revalidateTag(RECORD_TAG, "max");
  warmSite(`http://${hostHeader}`, 2_000);
  return Response.json({ ok: true });
}
