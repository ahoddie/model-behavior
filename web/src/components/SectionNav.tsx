"use client";
import { useEffect, useRef, useState } from "react";

// A sticky list of the page's sections on wide screens. The section in view is marked.
export default function SectionNav({ items, label = "On this page" }: { items: { id: string; label: string }[]; label?: string }) {
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
        <li key={i.id}><a href={`#${i.id}`} onClick={(e) => go(e, i.id)} aria-current={active === i.id ? "location" : undefined}>{i.label}</a></li>
      ))}</ol>
    </nav>
  );
}
