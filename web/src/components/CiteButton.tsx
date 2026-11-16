"use client";
import { useEffect, useRef, useState } from "react";
import { fmtDate } from "@/lib/format";

// "Cite" opens a small card with a ready-to-paste citation and a copy button.
// Two shapes: a page or section of this site, or a single quote with its original source and archived copy.
// asOf is the date the data was read. A page built ahead of time has no clock, so it leaves asOf out and the card fills in
// the reader's date when it opens.
type PageCite = { kind: "page"; title: string; path: string; asOf?: string };
type QuoteCite = { kind: "quote"; speaker: string; quote: string; date: string; url: string; archive?: string | null; outlet: string };

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

function text(c: PageCite | QuoteCite, origin: string) {
  // The site is not published yet, so a local address is left out of the citation rather than handed to readers.
  const local = !origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
  if (c.kind === "page") return `Model Behavior. “${c.title}.” Data as of ${c.asOf ?? fmtDate(new Date().toISOString().slice(0, 10))}.${local ? "" : ` ${origin}${c.path}`}`;
  return `${c.speaker}, “${c.quote}” ${c.outlet || host(c.url)}${c.date ? `, ${c.date}` : ""}. ${c.url}${c.archive ? ` (archived: ${c.archive})` : ""}`;
}

export default function CiteButton(props: (PageCite | QuoteCite) & { small?: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const [side, setSide] = useState<"left" | "right">("left");
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", off);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", off); };
  }, [open]);
  const value = open ? text(props, origin) : "";
  return (
    <span className={`cite${props.small ? " cite-sm" : ""}`} ref={box}>
      <button type="button" className="cite-btn" aria-expanded={open} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setSide(r.left + 430 > window.innerWidth ? "right" : "left"); setOpen((o) => !o); setCopied(false); }}>
        <span aria-hidden>“</span> Cite
      </button>
      {open && (
        <span className={`cite-card cite-${side}`} role="dialog" aria-label="Citation">
          <span className="cite-text">{value}</span>
          <span className="cite-actions">
            <button type="button" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
            {props.kind === "quote" && props.archive && <a href={props.archive} target="_blank" rel="noreferrer">Archived copy</a>}
          </span>
        </span>
      )}
    </span>
  );
}
