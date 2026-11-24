"use client";
// Site-wide dropdown. Follows the WAI-ARIA select-only combobox pattern, so it works by keyboard and screen reader.
// Pass `name` to use it inside a plain <form>: a hidden input carries the value.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type Opt = { value: string; label: string };

export default function Select({ label, options, value, defaultValue, onChange, name, submitOnChange, wide, searchable }: {
  label: string; options: Opt[]; value?: string; defaultValue?: string; onChange?: (v: string) => void;
  name?: string; submitOnChange?: boolean; wide?: boolean; searchable?: boolean;
}) {
  const router = useRouter();
  const canSearch = searchable ?? options.length > 12;
  const id = useId();
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value ?? "");
  const cur = value ?? inner;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ s: "", t: 0 });
  const findRef = useRef<HTMLInputElement>(null);
  const [find, setFind] = useState("");
  const selIdx = Math.max(0, options.findIndex((o) => o.value === cur));
  const f = find.trim().toLowerCase();
  const shown = f ? options.filter((o) => o.label.toLowerCase().includes(f)) : options;

  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [open]);
  useEffect(() => { if (open && canSearch) findRef.current?.focus({ preventScroll: true }); }, [open, canSearch]);
  // The active option is kept in view by scrolling the list alone: scrollIntoView would also move the page.
  useEffect(() => {
    const ul = list.current, li = ul?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    if (!open || !ul || !li) return;
    const top = li.offsetTop - ul.offsetTop;
    if (top < ul.scrollTop) ul.scrollTop = top;
    else if (top + li.offsetHeight > ul.scrollTop + ul.clientHeight) ul.scrollTop = top + li.offsetHeight - ul.clientHeight;
  }, [open, active]);
  // A list that would run past the right edge of the window opens leftward from the button's right edge instead,
  // so opening a dropdown at the end of a row never widens the page.
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    if (!open) { setFlip(false); return; }
    const pop = root.current?.querySelector<HTMLElement>(".sel-pop");
    if (pop && pop.getBoundingClientRect().right > document.documentElement.clientWidth - 8) setFlip(true);
  }, [open]);

  const show = () => { setFind(""); setActive(selIdx); setOpen(true); };
  const pick = (i: number) => {
    const v = shown[i]?.value;
    setOpen(false);
    btn.current?.focus();
    if (v === undefined || v === cur) return;
    setInner(v); onChange?.(v);
    // A filter change swaps the results in place; the page keeps its scroll position.
    if (submitOnChange) queueMicrotask(() => {
      const form = btn.current?.form;
      if (!form) return;
      const qs = new URLSearchParams([...new FormData(form).entries()].map(([k, x]) => [k, String(x)])).toString();
      router.replace(`${form.getAttribute("action") ?? location.pathname}?${qs}`, { scroll: false });
      // The loading screen shortens the page while results stream in; put the reader back once it is long enough.
      const y = window.scrollY, until = Date.now() + 4000;
      const restore = () => {
        const ready = location.search === `?${qs}` && !document.querySelector('main [role="status"]');
        if (ready && document.documentElement.scrollHeight >= y + window.innerHeight) window.scrollTo(0, y);
        else if (Date.now() < until) requestAnimationFrame(restore);
      };
      setTimeout(() => requestAnimationFrame(restore), 50);
    });
  };
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key, last = shown.length - 1;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(k)) { e.preventDefault(); show(); }
      return;
    }
    const go = (i: number) => { e.preventDefault(); setActive(Math.min(last, Math.max(0, i))); };
    if (k === "ArrowDown") go(active + 1);
    else if (k === "ArrowUp") go(active - 1);
    else if (k === "Home" && !canSearch) go(0);
    else if (k === "End" && !canSearch) go(last);
    else if (k === "PageDown") go(active + 8);
    else if (k === "PageUp") go(active - 8);
    else if (k === "Enter" || (k === " " && !canSearch)) { e.preventDefault(); pick(active); }
    else if (k === "Escape") { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (k === "Tab") pick(active);
    else if (k.length === 1 && !canSearch) {
      const t = typed.current, now = Date.now();
      t.s = now - t.t > 600 ? k.toLowerCase() : t.s + k.toLowerCase(); t.t = now;
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(t.s));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <span className={`sel${wide ? " sel-wide" : ""}`} ref={root}>
      <span className="sel-label" id={`${id}-l`}>{label}</span>
      <span className="sel-box">
      <button type="button" ref={btn} role="combobox" className="sel-btn" aria-haspopup="listbox" aria-expanded={open}
        aria-controls={`${id}-list`} aria-labelledby={`${id}-l ${id}-v`}
        aria-activedescendant={open ? `${id}-o${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKey}>
        <span id={`${id}-v`} className="sel-val">{options[selIdx]?.label}</span>
        <svg className="sel-caret" width="9" height="6" viewBox="0 0 9 6" aria-hidden><path d="M.5.5 4.5 5 8.5.5" /></svg>
      </button>
      {name && <input type="hidden" name={name} value={cur} />}
      {open && (
        <div className={`sel-pop${flip ? " sel-pop-end" : ""}`}>
        {canSearch && (
          <input ref={findRef} type="search" className="sel-find" placeholder="Type to filter" value={find} aria-label={`Filter ${label}`}
            role="combobox" aria-expanded aria-controls={`${id}-list`} aria-autocomplete="list"
            aria-activedescendant={shown.length ? `${id}-o${active}` : undefined}
            onChange={(e) => { setFind(e.target.value); setActive(0); }} onKeyDown={onKey} />
        )}
        <ul className="sel-list" role="listbox" id={`${id}-list`} ref={list} aria-labelledby={`${id}-l`} tabIndex={-1}>
          {shown.length === 0 && <li className="sel-none" role="presentation">No match</li>}
          {shown.map((o, i) => (
            <li key={o.value} id={`${id}-o${i}`} data-i={i} role="option" aria-selected={o.value === cur}
              className={i === active ? "on" : undefined} onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
              {o.label}
            </li>
          ))}
        </ul>
        </div>
      )}
      </span>
    </span>
  );
}
