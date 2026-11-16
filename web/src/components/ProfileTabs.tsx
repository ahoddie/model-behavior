"use client";
// Profile tabs that switch in the browser. The server renders every tab's panel once; choosing a tab only changes which
// panel shows and rewrites the address, so there is no request and nothing to wait for. Back and forward, and a link
// straight to ?tab=…, land on the same panel. The address is read directly (not through the router's useSearchParams,
// which updates as a low-priority transition) so the panel changes in the same frame as the click.
// The statements panel is rendered for one filter (?kind, ?issue). While a filter is on, a tab link is an ordinary
// navigation, so the server clears the filter instead of this showing a filtered list under an unfiltered address.
import NextLink from "next/link";
import { useSyncExternalStore, type MouseEvent, type ReactNode } from "react";

const CHANGED = "profile-tab";
const subscribe = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  window.addEventListener(CHANGED, cb);
  return () => { window.removeEventListener("popstate", cb); window.removeEventListener(CHANGED, cb); };
};

export function TabLink({ href, current, children }: { href: string; current?: boolean; children: ReactNode }) {
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    const q = new URLSearchParams(window.location.search);
    if (q.has("kind") || q.has("issue") || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    window.history.pushState(null, "", href);
    window.dispatchEvent(new Event(CHANGED));
  };
  return <NextLink href={href} prefetch={false} scroll={false} onClick={go} aria-current={current ? "page" : undefined}>{children}</NextLink>;
}

// `search` is the query string the server rendered for, so the first paint and hydration agree with it.
export default function ProfileTabs({ base, search, tabs, panels }: { base: string; search: string; tabs: [string, ReactNode][]; panels: Record<string, ReactNode> }) {
  const now = useSyncExternalStore(subscribe, () => window.location.search, () => search);
  const tab = new URLSearchParams(now).get("tab") ?? "record";
  const shown = tab in panels ? tab : "record";
  return (
    <>
      <nav className="tabs" aria-label="Profile sections">
        {tabs.map(([t, label]) => <TabLink key={t} href={`${base}?tab=${t}`} current={shown === t}>{label}</TabLink>)}
      </nav>
      {tabs.map(([t]) => <div key={t} hidden={shown !== t}>{panels[t]}</div>)}
    </>
  );
}
