"use client";
// Layered flow from one starting point: each column is one step further along the money.
// Clicking a box opens the same summary panel as the network; a modified click still opens the full profile.
import { useEffect, useMemo, useState } from "react";
import { fmtMoney } from "@/lib/format";
import NodePanel from "./NodePanel";
import type { GNode, GLink } from "@/lib/data";

type Flow = { from_id: string; to_id: string; from_name: string; to_name: string; amount: number | null; d: number; source_url: string; stance: string | null;
  subtype?: string | null; date_start?: string | null; date_end?: string | null; note?: string | null };

export default function MoneyFlow({ start, flows }: { start: string; flows: Flow[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { setSelected(null); }, [start]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  // The panel's connections are the money steps in this trace. Its header and facts come from the record itself.
  const { links, byId } = useMemo(() => {
    const byId = new Map<string, GNode>();
    const add = (id: string, name: string) => { if (!byId.has(id)) byId.set(id, { id, name, type: "", descriptor: null, cluster: "", source_url: "", issues: [], first_date: null }); };
    const links: GLink[] = flows.map((f, i) => {
      add(f.from_id, f.from_name); add(f.to_id, f.to_name);
      return { id: i, from: f.from_id, to: f.to_id, type: "money", subtype: f.subtype ?? null, amount: f.amount, date_start: f.date_start ?? null, date_end: f.date_end ?? null, stance: f.stance, note: f.note ?? null, source_url: f.source_url };
    });
    return { links, byId };
  }, [flows]);
  const depth = new Map<string, number>([[start, 0]]);
  const names = new Map<string, string>();
  for (const f of [...flows].sort((a, b) => a.d - b.d)) {
    names.set(f.from_id, f.from_name); names.set(f.to_id, f.to_name);
    if (!depth.has(f.to_id)) depth.set(f.to_id, (depth.get(f.from_id) ?? f.d - 1) + 1);
  }
  // Collapse duplicate edges between the same pair.
  const pair = new Map<string, { from: string; to: string; amount: number; url: string; n: number; stance: string | null }>();
  for (const f of flows) {
    if ((depth.get(f.to_id) ?? 0) <= (depth.get(f.from_id) ?? 0)) continue;
    const k = `${f.from_id}|${f.to_id}`;
    const p = pair.get(k) ?? { from: f.from_id, to: f.to_id, amount: 0, url: f.source_url, n: 0, stance: f.stance };
    p.amount += f.amount ?? 0; p.n++; pair.set(k, p);
  }
  const edges = [...pair.values()];
  const inflow = new Map<string, number>();
  for (const e of edges) inflow.set(e.to, (inflow.get(e.to) ?? 0) + e.amount);
  inflow.set(start, edges.filter((e) => e.from === start).reduce((a, e) => a + e.amount, 0));
  const cols = Math.max(...depth.values()) + 1;
  const W = 1040, colW = 190, gapX = cols > 1 ? (W - colW) / (cols - 1) : 0;
  const max = Math.max(...inflow.values(), 1);
  const H = 22 + 70;
  const pos = new Map<string, { x: number; y: number; h: number }>();
  let height = 0;
  for (let c = 0; c < cols; c++) {
    const ids = [...depth.entries()].filter(([, d]) => d === c).map(([id]) => id).sort((a, b) => (inflow.get(b) ?? 0) - (inflow.get(a) ?? 0)).slice(0, 18);
    let y = 10;
    for (const id of ids) { const h = 22 + 70 * Math.sqrt((inflow.get(id) ?? 0) / max); pos.set(id, { x: c * gapX, y, h }); y += h + 10; }
    height = Math.max(height, y);
  }
  void H;
  const out = new Map<string, number>(), inn = new Map<string, number>();
  return (
    <div className="flowwrap">
      <svg viewBox={`0 0 ${W} ${height + 10}`} width="100%" role="img" aria-label="Money flow diagram">
        {edges.filter((e) => pos.has(e.from) && pos.has(e.to)).sort((a, b) => b.amount - a.amount).map((e, i) => {
          const a = pos.get(e.from)!, b = pos.get(e.to)!;
          const w = Math.max(1.5, 60 * Math.sqrt(e.amount / max));
          const oy = out.get(e.from) ?? 0, iy = inn.get(e.to) ?? 0;
          out.set(e.from, oy + Math.min(w, 8)); inn.set(e.to, iy + Math.min(w, 8));
          const y1 = a.y + Math.min(a.h / 2, 10 + oy), y2 = b.y + Math.min(b.h / 2, 10 + iy);
          const x1 = a.x + colW, x2 = b.x, mx = (x1 + x2) / 2;
          return (
            <a key={i} href={e.url} target="_blank" rel="noreferrer" aria-label={`${names.get(e.from)} to ${names.get(e.to)}: ${fmtMoney(e.amount)}`}>
              <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} className="edge edge-money" strokeWidth={w} style={{ opacity: e.stance === "oppose" ? 0.45 : 0.6 }} />
            </a>
          );
        })}
        {[...pos.entries()].map(([id, p]) => {
          // "Undisclosed donors" is a placeholder, not a profile, so it is drawn without a link.
          const box = (
            <g transform={`translate(${p.x},${p.y})`} className={`item${selected === id ? " sel" : ""}`}>
              <rect width={colW} height={p.h} rx="2" />
              <text x="8" y="15" className="nlabel">{(names.get(id) ?? id).slice(0, 28)}</text>
              <text x="8" y="29" className="namt">{fmtMoney(inflow.get(id))}</text>
            </g>
          );
          if (id.startsWith("undisclosed:")) return <g key={id}>{box}</g>;
          return (
            <a key={id} href={`/node/${id}`} aria-label={`${names.get(id) ?? id}: open summary`} aria-expanded={selected === id}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                setSelected((s) => (s === id ? null : id));
              }}>{box}</a>
          );
        })}
      </svg>
      {selected && <NodePanel id={selected} links={links} byId={byId} onSelect={(id) => setSelected(id.startsWith("undisclosed:") ? null : id)} onClose={() => setSelected(null)} />}
    </div>
  );
}
