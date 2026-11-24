"use client";
// A quiet "Back" above a detail page's title. It returns to the page the reader came from on this site; opened from
// elsewhere (a shared link, a new tab), it goes to the list the page belongs to.
import { useRouter } from "next/navigation";

// The previous history entry is a page of this site. The Navigation API sees in-app moves too; the referrer only sees full loads.
function cameFromSite() {
  try {
    const nav = (window as any).navigation;
    if (nav?.entries && nav.currentEntry) {
      const prev = nav.entries()[nav.currentEntry.index - 1];
      return !!prev?.url && new URL(prev.url).origin === location.origin;
    }
    return !!document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1;
  } catch { return false; }
}

export default function BackLink({ fallback, label = "Back" }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <a className="backlink" href={fallback} onClick={(e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      if (cameFromSite()) { e.preventDefault(); router.back(); }
    }}><span aria-hidden>←</span> {label}</a>
  );
}
