"use client";
// Notes the name of each page the reader opens (its h1), keyed by path, for this tab only, so a Back button on the next
// page can say where it goes ("← Anthropic"). Pages have no titles of their own, so the heading is the name.
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PAGE_NAMES_KEY } from "./BackButton";

// The heading noted for the last page. Right after a route change the old page's heading can still be on screen, so a
// heading is only taken for the new path once it is a different element.
let last: Element | null = null;

export default function PageNames() {
  const path = usePathname() ?? "/";
  const search = useSearchParams().toString();
  useEffect(() => {
    const key = search ? `${path}?${search}` : path;
    const note = () => {
      const el = document.querySelector("main h1");
      const h1 = el?.textContent?.trim();
      if (!el || !h1 || el === last) return false;
      last = el;
      try {
        const names = JSON.parse(sessionStorage.getItem(PAGE_NAMES_KEY) ?? "{}") as Record<string, string>;
        names[key] = h1;
        names[path] ??= h1;
        sessionStorage.setItem(PAGE_NAMES_KEY, JSON.stringify(names));
      } catch {}
      return true;
    };
    // The heading can stream in after the route changes: watch for it, for up to ten seconds.
    if (note()) return;
    const obs = new MutationObserver(() => { if (note()) obs.disconnect(); });
    obs.observe(document.querySelector("main") ?? document.body, { childList: true, subtree: true });
    const t = setTimeout(() => obs.disconnect(), 10000);
    return () => { obs.disconnect(); clearTimeout(t); };
  }, [path, search]);
  return null;
}
