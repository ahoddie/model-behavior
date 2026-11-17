"use client";
// Mobile view of the map: pick a node, see where it goes, keep tapping.
import { useMemo, useState } from "react";
import Link from "@/components/Link";
import type { GNode, GLink } from "@/lib/data";
import { clusterName, fmtMoney, fmtDate, TYPE_LABEL } from "@/lib/format";

const COLUMN: Record<string, number> = { lab: 0, person: 0, investor: 0, funder: 0, pac: 1, nonprofit: 1, think_tank: 1, bill: 2, race: 2, rule: 2, lawmaker: 2, agency: 2 };
const COLS = ["The Valley", "Through", "Lands on"];

export default function SteppedList({ nodes, links, initial }: { nodes: GNode[]; links: GLink[]; initial: string | null }) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const [trail, setTrail] = useState<string[]>(initial ? [initial] : []);
  const [col, setCol] = useState(0);
  const active = useMemo(() => new Set(links.flatMap((l) => [l.from, l.to])), [links]);
  const current = trail.at(-1);

  if (!current) {
    const groups = new Map<string, GNode[]>();
    for (const n of nodes) if (COLUMN[n.type] === col && active.has(n.id)) groups.set(n.cluster, [...(groups.get(n.cluster) ?? []), n]);
    return (
      <div className="stepped">
        <div className="tabs" role="tablist">{COLS.map((c, i) => <a key={c} href="#" role="tab" aria-selected={i === col} aria-current={i === col ? "page" : undefined} onClick={(e) => { e.preventDefault(); setCol(i); }}>{c}</a>)}</div>
        {[...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([c, ns]) => (
          <details key={c}>
            <summary><strong>{clusterName(c)}</strong> <span className="mono muted">{ns.length}</span></summary>
            <ul className="steplist">{ns.map((n) => <li key={n.id}><button className="linkish" onClick={() => setTrail([n.id])}>{n.name}</button></li>)}</ul>
          </details>
        ))}
      </div>
    );
  }
  const n = byId.get(current)!;
  const mine = links.filter((l) => l.from === current || l.to === current);
  return (
    <div className="stepped">
      <nav aria-label="Path" className="mono crumbs">
        <button className="linkish" onClick={() => setTrail([])}>All</button>
        {trail.map((t, i) => <span key={t + i}> → <button className="linkish" onClick={() => setTrail(trail.slice(0, i + 1))}>{byId.get(t)?.name}</button></span>)}
      </nav>
      <h2>{n.name}</h2>
      <p className="mono muted">{TYPE_LABEL[n.type]}{n.descriptor ? <> · <a href={n.source_url}>{n.descriptor}</a></> : null}</p>
      <p><Link href={`/node/${n.id}`}>Open the full profile</Link></p>
      <ul className="steplist">
        {mine.map((l) => {
          const o = byId.get(l.from === current ? l.to : l.from)!;
          return (
            <li key={l.id}>
              <span className={`tag ${l.type}`}>{l.subtype ?? l.type}</span> {l.from === current ? "→" : "←"}{" "}
              <button className="linkish" onClick={() => setTrail([...trail, o.id])}>{o.name}</button>
              <br /><a href={l.source_url} className="mono">{[fmtMoney(l.amount), l.stance, fmtDate(l.date_start) || "source"].filter(Boolean).join(" · ")}</a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
