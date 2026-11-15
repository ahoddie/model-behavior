"use client";
import { useEffect, useState } from "react";

// A sticky list of the page's sections on wide screens. The section in view is marked.
export default function SectionNav({ items, label = "On this page" }: { items: { id: string; label: string }[]; label?: string }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    // The current section is the last one whose top has scrolled above the upper third of the screen.
    let raf = 0;
    const pick = () => {
      raf = 0;
      let cur = items[0]?.id;
      for (const i of items) { const el = document.getElementById(i.id); if (el && el.getBoundingClientRect().top < window.innerHeight * 0.35) cur = i.id; }
      setActive(cur);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(pick); };
    pick();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [items]);
  return (
    <nav className="secnav" aria-label={label}>
      <ol>{items.map((i) => (
        <li key={i.id}><a href={`#${i.id}`} aria-current={active === i.id ? "location" : undefined}>{i.label}</a></li>
      ))}</ol>
    </nav>
  );
}
