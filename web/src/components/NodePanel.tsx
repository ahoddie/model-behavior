"use client";
import Linked from "./Linked";
import { useEffect, useRef, useState } from "react";
import Link from "@/components/Link";
import type { GNode, GLink } from "@/lib/data";
import { fmtMoney, fmtDate, TYPE_LABEL } from "@/lib/format";
import { Mark, KeyFacts } from "./ProfileHead";
import Src from "./Src";

type Summary = { node: GNode & { logo_url?: string | null }; facts: { text: string; url: string }[]; keyFacts: { label: string; text: string; url: string }[]; stats: { money_out: number; money_in: number; links: number; feed: number; filings: number } };

export default function NodePanel({ id, links, byId, onSelect, onClose }: { id: string; links: GLink[]; byId: Map<string, GNode>; onSelect: (id: string) => void; onClose: () => void }) {
  const [loaded, setS] = useState<Summary | null>(null);
  const ref = useRef<HTMLElement>(null);
  // A new item starts at the top of its own panel. The panel is sized to the screen below any sticky bar, so when it
  // opens partly off screen the page scrolls until all of it shows, top first.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = 0;
    const r = el.getBoundingClientRect();
    const bar = [document.querySelector<HTMLElement>(".masthead"), el.closest(".mapwrap")?.querySelector<HTMLElement>(".maptools")]
      .filter((b): b is HTMLElement => !!b && getComputedStyle(b).position === "sticky");
    const offset = bar.reduce((h, b) => h + b.offsetHeight, 0) + 12;
    if (r.top < offset) window.scrollBy({ top: r.top - offset, behavior: "smooth" });
    else if (r.bottom > window.innerHeight - 12) window.scrollBy({ top: Math.min(r.top - offset, r.bottom - window.innerHeight + 12), behavior: "smooth" });
  }, [id]);
  const s = loaded?.node.id === id ? loaded : null;
  useEffect(() => {
    let live = true;
    fetch(`/api/node/${encodeURIComponent(id)}`).then((r) => r.json()).then((d) => live && setS(d));
    return () => { live = false; };
  }, [id]);
  // The fetched record wins; byId is the caller's copy and may hold only a name (the Funding page has no network to draw on).
  const n = s?.node ?? byId.get(id)!;
  const mine = links.filter((l) => l.from === id || l.to === id).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 14);
  return (
    <aside ref={ref} className="nodepanel panel" aria-label={`${n.name} summary`}>
      <button className="close" onClick={onClose} aria-label="Close panel">×</button>
      <div className="profile-title">
        <Mark node={{ ...n, logo_url: s?.node.logo_url }} size={40} />
        <div><h2>{n.name}</h2></div>
      </div>
      <p>{n.descriptor ? <>{n.descriptor} <Src url={n.source_url} /></> : TYPE_LABEL[n.type]}</p>
      <p className="panel-open"><Link href={`/node/${id}`}>Open the full profile</Link></p>
      {s?.keyFacts?.length ? <KeyFacts facts={s.keyFacts} compact /> : null}
      {s?.facts.length ? <ul className="facts">{s.facts.map((f, i) => <li key={i}><Linked parts={(f as any).parts} text={f.text} /> <Src url={f.url} /></li>)}</ul> : null}
      <h3>Connections</h3>
      <ul className="conns">
        {mine.map((l) => {
          const other = byId.get(l.from === id ? l.to : l.from)!;
          return (
            <li key={l.id}>
              <span className={`tag ${l.type}`}>{l.subtype ?? l.type}</span>{" "}
              {l.from === id ? "→ " : "← "}
              <button className="linkish" onClick={() => onSelect(other.id)}>{other.name}</button>{" "}
              {[l.amount ? fmtMoney(l.amount) : null, l.stance, fmtDate(l.date_start)].filter(Boolean).join(" · ")} <Src url={l.source_url} />
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
