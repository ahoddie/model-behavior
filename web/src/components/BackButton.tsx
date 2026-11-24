"use client";
// Back, named for where it goes. It returns to the page the reader came from on this site and says that page's name
// ("Anthropic", "Policy"); opened from elsewhere (a shared link, a new tab), it goes to the item's list ("All bills").
// Page names come from PageNames (in the layout), which notes each page's title as the reader moves through the site.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NAV } from "./MainNav";

// The previous history entry, when it is a page of this site. The Navigation API sees in-app moves too; the referrer only
// sees full loads.
function previousOnSite(): string | null {
  try {
    const nav = (window as any).navigation;
    if (nav?.entries && nav.currentEntry) {
      const prev = nav.entries()[nav.currentEntry.index - 1];
      if (!prev?.url) return null;
      const u = new URL(prev.url);
      return u.origin === location.origin ? u.pathname + u.search : null;
    }
    if (document.referrer && history.length > 1) {
      const u = new URL(document.referrer);
      return u.origin === location.origin ? u.pathname + u.search : null;
    }
  } catch {}
  return null;
}

export const PAGE_NAMES_KEY = "mb:page-names";
function nameFor(path: string): string | null {
  const section = NAV.find(([href]) => path === href || path.startsWith(`${href}?`) || path.startsWith(`${href}/`));
  if (section && !path.startsWith("/node/")) return section[1];
  if (path === "/" || path.startsWith("/?")) return "Home";
  try {
    const names = JSON.parse(sessionStorage.getItem(PAGE_NAMES_KEY) ?? "{}") as Record<string, string>;
    const key = path.split("#")[0];
    return names[key] ?? names[key.split("?")[0]] ?? null;
  } catch { return null; }
}

export default function BackButton({ fallback, fallbackLabel, icon }: { fallback: string; fallbackLabel: string; icon?: boolean }) {
  const router = useRouter();
  // Server render and first paint say where the fallback goes; once the browser knows the history, the name follows it.
  const [prev, setPrev] = useState<{ path: string; name: string | null } | null>(null);
  useEffect(() => { const p = previousOnSite(); if (p) setPrev({ path: p, name: nameFor(p) }); }, []);
  const label = prev ? prev.name ?? "Back" : fallbackLabel;
  return (
    <a className={`back${icon ? " icon" : ""}`} href={fallback} aria-label={icon ? `Back to ${label === "Back" ? "the previous page" : label}` : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (prev) { e.preventDefault(); router.back(); }
      }}>
      <span className="arr" aria-hidden>←</span>{!icon && <span>{label}</span>}
    </a>
  );
}
