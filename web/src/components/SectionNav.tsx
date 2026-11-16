"use client";
import { useEffect, useRef, useState } from "react";

// Light line icons for the nav, drawn on a 16-unit grid in the text color.
const ICONS = {
  money: <><circle cx="8" cy="8" r="6.25" /><path d="M10 5.75H7.25a1.25 1.25 0 0 0 0 2.5h1.5a1.25 1.25 0 0 1 0 2.5H6M8 4.25v1.5M8 10.75v1.5" /></>,
  priorities: <><path d="M3.5 14.5V2" /><path d="M3.5 2.5h8.25l-1.75 3 1.75 3H3.5" /></>,
  stances: <><path d="M8 2.5v11M5 13.5h6M3 4.5h10" /><path d="M3 4.5 1.25 9a1.9 1.9 0 0 0 3.5 0zM13 4.5 11.25 9a1.9 1.9 0 0 0 3.5 0z" /></>,
  evolution: <><path d="M1.75 13.75h12.5" /><path d="M2.5 11 6 7.25l2.75 2.25 4.75-5.5" /><path d="M10.5 4h3v3" /></>,
  quotes: <><path d="M2.25 3.25h11.5v7.5H7l-3 2.5v-2.5H2.25z" /><path d="M5.5 6.25v1.5M8 6.25v1.5" /></>,
  network: <><circle cx="8" cy="3.5" r="1.75" /><circle cx="3.25" cy="12" r="1.75" /><circle cx="12.75" cy="12" r="1.75" /><path d="M7.1 5 4.15 10.5M8.9 5l2.95 5.5M5 12h6" /></>,
};
export type NavIcon = keyof typeof ICONS;

// A sticky list of the page's sections on wide screens. The section in view is marked.
export default function SectionNav({ items, label = "On this page" }: { items: { id: string; label: string; icon?: NavIcon }[]; label?: string }) {
  const [active, setActive] = useState(items[0]?.id);
  // While a click's glide is running, the clicked section stays marked so the marker doesn't step through the ones passed.
  const gliding = useRef(0);
  const go = (e: React.MouseEvent, id: string) => {
    const el = document.getElementById(id);
    if (!el || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    history.pushState(null, "", `#${id}`);
    setActive(id);
    const from = window.scrollY, to = el.getBoundingClientRect().top + from - (parseFloat(getComputedStyle(el).scrollMarginTop) || 0);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { window.scrollTo({ top: to, behavior: "instant" }); return; }
    // Ease in and out; longer trips take a little longer, capped so a far jump still feels quick.
    const dur = Math.min(900, 350 + Math.abs(to - from) * 0.06), t0 = performance.now(), id0 = ++gliding.current;
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now: number) => {
      if (id0 !== gliding.current) return;
      const t = Math.min(1, (now - t0) / dur);
      window.scrollTo({ top: from + (to - from) * ease(t), behavior: "instant" });
      if (t < 1) requestAnimationFrame(step); else { gliding.current = 0; el.focus?.({ preventScroll: true }); }
    };
    requestAnimationFrame(step);
  };
  useEffect(() => {
    // The current section is the last one whose top has scrolled above the upper third of the screen.
    let raf = 0;
    const pick = () => {
      raf = 0;
      if (gliding.current) return;
      let cur = items[0]?.id;
      for (const i of items) { const el = document.getElementById(i.id); if (el && el.getBoundingClientRect().top < window.innerHeight * 0.35) cur = i.id; }
      setActive(cur);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(pick); };
    pick();
    // The reader's own wheel or touch stops a glide in progress.
    const stop = () => { if (gliding.current) { gliding.current = 0; pick(); } };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("wheel", stop); window.removeEventListener("touchstart", stop); if (raf) cancelAnimationFrame(raf); };
  }, [items]);
  return (
    <nav className="secnav" aria-label={label}>
      <ol>{items.map((i) => (
        <li key={i.id}><a href={`#${i.id}`} onClick={(e) => go(e, i.id)} aria-current={active === i.id ? "location" : undefined}>{i.icon && <svg className="secnav-icon" viewBox="0 0 16 16" aria-hidden="true">{ICONS[i.icon]}</svg>}{i.label}</a></li>
      ))}</ol>
    </nav>
  );
}
