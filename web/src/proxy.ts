import { NextResponse, type NextRequest } from "next/server";

// /money, /targets, /data and every profile choose what they show from the query string (?from, ?kind, ?view, ?tab…). A page
// that reads the query string is rendered for each request, which kept a reader looking at "Loading the record…" for a second
// or more on every visit. So the query is moved into the path of an internal route (the v/ folder beside each page), where
// each combination is a prebuilt page kept on disk and refreshed from the record like every other page (lib/data, cached()).
// The address in the browser does not change. "_" stands for a parameter that is not set.
const KEYS: Record<string, string[]> = { money: ["from"], targets: ["kind", "cycle"], data: ["view"], node: ["tab", "kind", "issue"] };
const seg = (v: string | null) => (v ? encodeURIComponent(v) : "_");

export function proxy(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const [, section, id] = pathname.split("/");
  const keys = KEYS[section];
  if (!keys) return NextResponse.next();
  const vals = keys.map((k) => searchParams.get(k));
  const base = section === "node" ? `/node/${id}/v` : `/${section}/v`;
  // With nothing set, a section page has its own prebuilt copy with no parameters, so a link to it can be prefetched whole.
  const path = section !== "node" && vals.every((v) => !v) ? base : `${base}/${vals.map(seg).join("/")}`;
  const url = req.nextUrl.clone();
  url.pathname = path;
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/money", "/targets", "/data", "/node/:id"] };
