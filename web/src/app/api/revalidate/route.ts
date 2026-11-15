import { revalidateTag } from "next/cache";
import { headers } from "next/headers";
import { RECORD_TAG } from "@/lib/data";

// Importers, the loader and the audit run outside Next; they POST here when they change the record.
// Local only: requests from anywhere but this machine are refused.
export async function POST() {
  const h = await headers();
  const host = (h.get("host") ?? "").split(":")[0];
  const fwd = h.get("x-forwarded-for");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host) || (fwd && !/^(127\.0\.0\.1|::1)$/.test(fwd))) return new Response("local only", { status: 403 });
  revalidateTag(RECORD_TAG, { expire: 0 });
  return Response.json({ ok: true });
}
