"use client";
// Header search: an icon that opens a field with live name matches. Enter opens full results on /search.
// "/" or Cmd/Ctrl+K opens it from anywhere; Escape closes.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Hit = { id: string; name: string; kind: string };

export function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

export default function HeaderSearch() {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? "");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); setOpen(true); }
    };
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey); document.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => {
    if (term.trim().length < 2) return; // the change handler already cleared the results
    const ctl = new AbortController();
    const t = setTimeout(() => fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal }).then((r) => r.json()).then((h) => { setHits(h); setActive(-1); }).catch(() => {}), 120);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [term]);

  const type = (value: string) => { setTerm(value); if (value.trim().length < 2) setHits([]); };
  const go = (href: string) => { setOpen(false); type(""); router.push(href); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
    else if (e.key === "Enter" && term.trim()) {
      e.preventDefault();
      go(active >= 0 && active < hits.length ? `/node/${hits[active].id}` : `/search?q=${encodeURIComponent(term.trim())}`);
    }
  };

  return (
    <div className="hsearch" ref={box}>
      <button type="button" className="iconbtn" aria-label="Search" aria-expanded={open} title="Search ( / )" onClick={() => setOpen(!open)}><SearchIcon /></button>
      {open && (
        <div className="hsearch-pop">
          <input ref={input} type="search" value={term} onChange={(e) => type(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Search people, groups, bills, quotes" aria-label="Search" role="combobox" aria-expanded={hits.length > 0} aria-controls="hsearch-list"
            aria-activedescendant={active >= 0 ? `hs-${active}` : undefined} />
          {term.trim().length >= 2 && (
            <ul id="hsearch-list" role="listbox">
              {hits.map((h, i) => (
                <li key={h.id} id={`hs-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); go(`/node/${h.id}`); }} onMouseEnter={() => setActive(i)}>
                  <span>{h.name}</span><span className="mono muted">{h.kind}</span>
                </li>
              ))}
              <li id={`hs-${hits.length}`} role="option" aria-selected={active === hits.length} className="hsearch-all"
                onMouseDown={(e) => { e.preventDefault(); go(`/search?q=${encodeURIComponent(term.trim())}`); }} onMouseEnter={() => setActive(hits.length)}>
                <span>All results for &ldquo;{term.trim()}&rdquo;</span><span className="mono muted">Enter</span>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
