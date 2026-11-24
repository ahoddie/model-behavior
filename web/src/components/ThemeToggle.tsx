"use client";
// Light and dark switch. The choice is saved in the browser; with no saved choice the site follows the device setting.
// THEME_SCRIPT runs before the page paints (see layout.tsx) so a dark page never flashes light first.
import { useEffect, useState, type MouseEvent } from "react";

const KEY = "theme";
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => setDark(document.documentElement.dataset.theme === "dark");
    read();
    // Follow the device setting while the reader has not picked a side.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if (localStorage.getItem(KEY)) return;
      document.documentElement.dataset.theme = mq.matches ? "dark" : "light";
      read();
    };
    mq.addEventListener("change", onSystem);
    return () => mq.removeEventListener("change", onSystem);
  }, []);

  // Where the browser can, the new theme spreads out in a circle from this button (the "theme-vt" rules in globals.css).
  const flip = (e: MouseEvent<HTMLButtonElement>) => {
    const next = dark ? "light" : "dark";
    const root = document.documentElement;
    const apply = () => { root.dataset.theme = next; };
    try { localStorage.setItem(KEY, next); } catch {}
    setDark(!dark);
    if (!document.startViewTransition || document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches) return apply();
    const r = e.currentTarget.getBoundingClientRect();
    root.style.setProperty("--vt-x", `${r.left + r.width / 2}px`);
    root.style.setProperty("--vt-y", `${r.top + r.height / 2}px`);
    root.classList.add("theme-vt");
    const t = document.startViewTransition(apply);
    t.finished.catch(() => {}).finally(() => root.classList.remove("theme-vt"));
  };
  const label = dark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button type="button" className="iconbtn themebtn" onClick={flip} aria-label={label} title={label}>
      <svg className="i-moon" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <svg className="i-sun" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  );
}
