"use client";
// Name finder for the map: an editable combobox that shares the dropdown styling in Select.tsx.
import { useId, useMemo, useState } from "react";

export default function NameSearch({ names, onPick }: { names: { id: string; name: string }[]; onPick: (id: string) => void }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const starts = names.filter((n) => n.name.toLowerCase().startsWith(s));
    const has = names.filter((n) => !n.name.toLowerCase().startsWith(s) && n.name.toLowerCase().includes(s));
    return [...starts, ...has].slice(0, 8);
  }, [q, names]);
  const shown = open && hits.length > 0;

  const choose = (i: number) => {
    const h = hits[i];
    if (!h) return;
    setQ(h.name); setOpen(false); onPick(h.id);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(hits.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(shown ? active : 0); }
    else if (e.key === "Escape") { if (shown) { e.preventDefault(); setOpen(false); } else setQ(""); }
  };

  return (
    <span className="sel mapsearch">
      <input type="search" role="combobox" placeholder="Find a name" aria-label="Find a name on the map" value={q}
        aria-expanded={shown} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={shown ? `${id}-o${active}` : undefined}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={onKey} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} />
      {shown && (
        <ul className="sel-list" role="listbox" id={`${id}-list`} aria-label="Matching names">
          {hits.map((h, i) => (
            <li key={h.id} id={`${id}-o${i}`} role="option" aria-selected={i === active} className={i === active ? "on" : undefined}
              onPointerEnter={() => setActive(i)} onPointerDown={(e) => e.preventDefault()} onClick={() => choose(i)}>
              {h.name}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
