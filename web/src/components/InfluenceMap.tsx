"use client";
import Select from "./Select";
import NameSearch from "./NameSearch";
import { Suspense, useEffect, useMemo, useRef, useState, useCallback, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import * as d3 from "d3";
import { landsRank, clusterName, fmtMoney, fmtDate, TYPE_LABEL } from "@/lib/format";
import type { GNode, GLink } from "@/lib/data";
import SteppedList from "./SteppedList";
import NodePanel from "./NodePanel";

const COLUMN: Record<string, number> = { lab: 0, person: 0, investor: 0, funder: 0, pac: 1, nonprofit: 1, think_tank: 1, bill: 2, race: 2, rule: 2, lawmaker: 2, agency: 2 };
const COL_TITLES = ["The Valley", "Through", "Lands on"];
const LINK_TYPES = ["money", "person", "idea", "position"] as const;
const TOP_N = 10;
const COL_W = 250, ROW_H = 32, CLUSTER_H = 48, MORE_H = 24, GAP = 10, TOP = 64;

function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => { const mq = window.matchMedia(query); mq.addEventListener("change", cb); return () => mq.removeEventListener("change", cb); },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

type Item = { key: string; kind: "cluster" | "node" | "more" | "colmore" | "header"; col: number; y: number; h: number; label: string; sub?: string;
  cluster: string; nodeId?: string; count?: number; money?: number; hidden?: number };
type Edge = { key: string; from: Item; to: Item; type: string; amount: number; count: number; links: GLink[]; fromCluster: string; toCluster: string };

// Reads ?view= and ?focus= in the browser and hands them to the map. It sits in its own <Suspense> so the map around it is
// prebuilt as static HTML; a page that read the URL on the server could not be.
function FromUrl({ apply }: { apply: (view: string | null, focus: string | null) => void }) {
  const sp = useSearchParams();
  const view = sp.get("view"), focus = sp.get("focus");
  useEffect(() => { apply(view, focus); }, [view, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function InfluenceMap({ nodes, links }: { nodes: GNode[]; links: GLink[] }) {
  const [mode, setModeState] = useState<"map" | "timeline">("map");
  // Keep the URL in step so a link to the time view (?view=time) opens it.
  const setMode = (m: "map" | "timeline") => {
    setModeState(m);
    const u = new URL(window.location.href);
    if (m === "timeline") u.searchParams.set("view", "time"); else u.searchParams.delete("view");
    window.history.replaceState(null, "", u);
  };
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const years = useMemo(() => {
    const ys = links.map((l) => Number(l.date_start?.slice(0, 4))).filter((y) => y > 2000);
    return { min: Math.max(2016, Math.min(...ys, 2024)), max: Math.max(...ys, new Date().getFullYear()) };
  }, [links]);
  const issues = useMemo(() => [...new Set(nodes.flatMap((n) => n.issues ?? []))].sort(), [nodes]);

  const [types, setTypes] = useState<Set<string>>(new Set(LINK_TYPES));
  const [issue, setIssue] = useState("");
  const [yearFrom, setYearFrom] = useState(years.min);
  const [yearTo, setYearTo] = useState(years.max);
  const [minAmount, setMinAmount] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [moreOpen, setMoreOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  // No zoom or pan: a fixed scale keeps clicks reliable (d3-zoom swallowed any click with the slightest mouse movement).
  const k = 1;
  const [hoverEdge, setHoverEdge] = useState<Edge | null>(null);
  const [width, setWidth] = useState(1200);
  const mobile = useMedia("(max-width: 767px)");
  // Timeline
  const months = useMemo(() => {
    const out: string[] = [];
    for (let y = 2024; y <= years.max; y++) for (let m = 1; m <= 12; m++) out.push(`${y}-${String(m).padStart(2, "0")}`);
    const now = new Date().toISOString().slice(0, 7);
    return out.filter((m) => m <= now);
  }, [years.max]);
  const [monthIdx, setMonthIdx] = useState(months.length - 1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1); // 1x = one month every 0.7 s
  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");

  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(960, e.contentRect.width)));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [mobile]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setMonthIdx((i) => { if (i >= months.length - 1) { setPlaying(false); return i; } return i + 1; }), 700 / speed);
    return () => clearInterval(t);
  }, [playing, months.length, speed]);

  // ── Filtering ────────────────────────────────────────────────
  const dateCut = mode === "timeline" ? `${months[monthIdx]}-31` : null;
  const fLinks = useMemo(() => links.filter((l) => {
    if (!types.has(l.type)) return false;
    if (!byId.has(l.from) || !byId.has(l.to)) return false;
    const y = l.date_start ? Number(l.date_start.slice(0, 4)) : null;
    if (y && (y < yearFrom || y > yearTo)) return false;
    if (dateCut && (!l.date_start || l.date_start > dateCut)) return false;
    if (minAmount > 0 && l.type === "money" && (l.amount ?? 0) < minAmount) return false;
    if (issue && !(byId.get(l.from)!.issues?.includes(issue) || byId.get(l.to)!.issues?.includes(issue))) return false;
    return true;
  }), [links, types, yearFrom, yearTo, minAmount, issue, byId, dateCut]);

  const nodeScore = useMemo(() => {
    const s = new Map<string, { money: number; count: number }>();
    for (const l of fLinks) for (const id of [l.from, l.to]) {
      const v = s.get(id) ?? { money: 0, count: 0 };
      v.count++; if (l.type === "money" && l.subtype !== "lobbying") v.money += l.amount ?? 0;
      s.set(id, v);
    }
    return s;
  }, [fLinks]);
  const score = useCallback((id: string) => { const v = nodeScore.get(id); return v ? v.money / 1e6 + v.count : 0; }, [nodeScore]);

  // Focus: everything within two steps of the selected node.
  const focus = useMemo(() => {
    if (!selected || !byId.has(selected)) return null;
    const hop = new Map<string, number>([[selected, 0]]);
    for (let d = 1; d <= 2; d++) for (const l of fLinks) {
      const a = hop.get(l.from), b = hop.get(l.to);
      if (a === d - 1 && !hop.has(l.to)) hop.set(l.to, d);
      if (b === d - 1 && !hop.has(l.from)) hop.set(l.from, d);
    }
    return hop;
  }, [selected, fLinks, byId]);

  // ── Layout ───────────────────────────────────────────────────
  const { items, nodeItem, height } = useMemo(() => {
    const items: Item[] = [];
    const nodeItem = new Map<string, Item>();
    const colX = [0, 1, 2];
    const clustersOut = k < 0.7 && !focus; // zoomed out: clusters only
    let maxY = 0;
    for (const col of colX) {
      const inCol = [...nodeScore.keys()].map((id) => byId.get(id)!).filter((n) => COLUMN[n.type] === col && (!focus || focus.has(n.id)));
      const groups = d3.group(inCol, (n) => n.cluster);
      const clusters = [...groups.entries()].map(([c, ns]) => ({ c, ns: ns.sort((a, b) => score(b.id) - score(a.id)), w: d3.sum(ns, (n) => score(n.id)) }))
        .sort((a, b) => (col === 2 ? landsRank(a.c) - landsRank(b.c) : b.w - a.w));
      const colKey = `${col}:__more`;
      const showClusters = focus || col === 2 || moreOpen.has(colKey) ? clusters : clusters.slice(0, TOP_N);
      let y = TOP;
      for (const { c, ns } of showClusters) {
        const key = `${col}:${c}`;
        const money = d3.sum(ns, (n) => nodeScore.get(n.id)?.money ?? 0);
        const open = focus ? true : !clustersOut && expanded.has(key);
        const head: Item = { key, kind: open ? "header" : "cluster", col, y, h: open ? 28 : CLUSTER_H, label: clusterName(c), cluster: c, count: ns.length, money };
        items.push(head); y += head.h;
        if (!open) { for (const n of ns) nodeItem.set(n.id, head); y += GAP; continue; }
        const showAll = focus || moreOpen.has(key);
        const vis = showAll ? ns : ns.slice(0, TOP_N);
        for (const n of vis) {
          const it: Item = { key: `n:${n.id}`, kind: "node", col, y, h: ROW_H, label: n.name, sub: n.descriptor ?? TYPE_LABEL[n.type], cluster: c, nodeId: n.id, money: nodeScore.get(n.id)?.money };
          items.push(it); nodeItem.set(n.id, it); y += ROW_H;
        }
        if (ns.length > vis.length) {
          const more: Item = { key: `m:${key}`, kind: "more", col, y, h: MORE_H, label: `+${ns.length - vis.length} more`, cluster: c, hidden: ns.length - vis.length };
          items.push(more); for (const n of ns.slice(vis.length)) nodeItem.set(n.id, more); y += MORE_H;
        }
        y += GAP;
      }
      if (clusters.length > showClusters.length) {
        const rest = clusters.slice(showClusters.length);
        const more: Item = { key: colKey, kind: "colmore", col, y, h: MORE_H + 4, label: `+${d3.sum(rest, (r) => r.ns.length)} more`, cluster: "__more" };
        items.push(more); for (const r of rest) for (const n of r.ns) nodeItem.set(n.id, more); y += MORE_H + 4;
      }
      maxY = Math.max(maxY, y);
    }
    return { items, nodeItem, height: maxY + 40 };
  }, [nodeScore, byId, score, expanded, moreOpen, focus, k]);

  const xOf = (col: number) => (col === 0 ? 40 : col === 1 ? width / 2 - COL_W / 2 : width - COL_W - 40);

  const edges = useMemo(() => {
    const agg = new Map<string, Edge>();
    for (const l of fLinks) {
      const a = nodeItem.get(l.from), b = nodeItem.get(l.to);
      if (!a || !b || a === b) continue;
      const key = `${a.key}|${b.key}|${l.type}`;
      const e = agg.get(key) ?? { key, from: a, to: b, type: l.type, amount: 0, count: 0, links: [], fromCluster: byId.get(l.from)!.cluster, toCluster: byId.get(l.to)!.cluster };
      e.count++; e.amount += l.type === "money" ? l.amount ?? 0 : 0; e.links.push(l);
      agg.set(key, e);
    }
    return [...agg.values()];
  }, [fLinks, nodeItem, byId]);

  const clusterCenter = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) if (it.kind === "cluster" || it.kind === "header") m.set(`${it.col}:${it.cluster}`, it.y + it.h / 2);
    return m;
  }, [items]);

  const maxMoney = d3.max(edges, (e) => e.amount) || 1;
  const maxCount = d3.max(edges, (e) => e.count) || 1;
  const widthOf = (e: Edge) => e.type === "money" && e.amount > 0 ? 1.2 + 13 * Math.sqrt(e.amount / maxMoney) : 1 + 5 * Math.sqrt(e.count / maxCount);

  function pathOf(e: Edge) {
    const a = e.from, b = e.to;
    const ay = a.y + a.h / 2, by = b.y + b.h / 2;
    if (a.col === b.col) { // same column: arc on the outer side
      const left = a.col !== 2; const x = left ? xOf(a.col) : xOf(a.col) + COL_W; const bend = left ? -46 : 46;
      return `M${x},${ay} C${x + bend},${ay} ${x + bend},${by} ${x},${by}`;
    }
    const fwd = a.col < b.col;
    const sx = fwd ? xOf(a.col) + COL_W : xOf(a.col), tx = fwd ? xOf(b.col) : xOf(b.col) + COL_W;
    // Bundle: every edge between the same two clusters passes through one shared point, then splits near its ends.
    const ca = clusterCenter.get(`${a.col}:${e.fromCluster}`) ?? ay, cb = clusterCenter.get(`${b.col}:${e.toCluster}`) ?? by;
    const mx = (sx + tx) / 2, my = (ca + cb) / 2;
    const c1 = sx + (mx - sx) * 0.55, c2 = tx - (tx - mx) * 0.55;
    return `M${sx},${ay} C${c1},${ay} ${c1},${my} ${mx},${my} C${c2},${my} ${c2},${by} ${tx},${by}`;
  }

  const selItem = selected ? nodeItem.get(selected) : null;
  const edgeTone = (e: Edge) => {
    if (focus && selected) {
      const touches = e.links.some((l) => l.from === selected || l.to === selected);
      return touches ? 1 : 0.4;
    }
    if (hoverEdge) return hoverEdge.key === e.key ? 1 : 0.15;
    return 0.75;
  };

  const toggle = (set: Set<string>, v: string) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };
  const activate = (it: Item) => {
    if (it.kind === "cluster") setExpanded((s) => toggle(s, it.key));
    else if (it.kind === "header") { if (!focus) setExpanded((s) => toggle(s, it.key)); }
    else if (it.kind === "more") setMoreOpen((s) => toggle(s, `${it.col}:${it.cluster}`));
    else if (it.kind === "colmore") setMoreOpen((s) => toggle(s, it.key));
    else if (it.nodeId) setSelected((s) => (s === it.nodeId ? null : it.nodeId!));
  };
  const onKey = (e: React.KeyboardEvent, it: Item) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(it); } };

  const yearOpts = d3.range(years.min, years.max + 1).map((y) => ({ value: String(y), label: String(y) }));
  // Federal election cycles run two years and are named for the even year: 2025-26 is the 2026 cycle.
  const cycles = d3.range(years.max + (years.max % 2), years.min - 1, -2);
  const cycleVal = cycles.find((c) => yearTo === Math.min(years.max, c) && yearFrom === Math.max(years.min, c - 1));
  const cycleValStr = cycleVal && !(yearFrom === years.min && yearTo === years.max) ? String(cycleVal) : "";

  const zoomCtl = (selected || expanded.size > 0 || moreOpen.size > 0) ? (
    <span className="zoomctl" role="group" aria-label="Reset the map">
      <button onClick={() => { setSelected(null); setExpanded(new Set()); setMoreOpen(new Set()); }}>Close all</button>
    </span>
  ) : null;
  // Toolbar, two rows: how to view the map (and find a name), then what to show.
  const viewRow = (
    <div className="tool-row">
      <span className="seg" role="group" aria-label="View">
        <button aria-pressed={mode === "map"} onClick={() => setMode("map")}>Overall</button>
        <button aria-pressed={mode === "timeline"} onClick={() => { setMode("timeline"); setMonthIdx(months.length - 1); }}>Timeline</button>
      </span>
      <span className="tool-right">
        <NameSearch names={nodes} onPick={setSelected} />
        {zoomCtl}
      </span>
    </div>
  );
  const filterRow = (
    <div className="tool-row tool-filters" role="group" aria-label="Filters">
      <span className="chips" role="group" aria-label="Connections to show">
        <span className="tool-label">Show</span>
        {LINK_TYPES.map((t) => (
          <button key={t} aria-pressed={types.has(t)} onClick={() => setTypes((s) => toggle(s, t))} className={`chip lt-${t}`}>
            <svg width="18" height="8" aria-hidden><line x1="0" y1="4" x2="18" y2="4" className={`edge-${t}`} strokeWidth="2" /></svg>{t}
          </button>
        ))}
      </span>
      <span className="tool-selects">
        <Select label="Issue" value={issue} onChange={setIssue} options={[{ value: "", label: "All" }, ...issues.map((i) => ({ value: i, label: i }))]} />
        {mode === "map" && <Select label="Election" value={cycleValStr} onChange={(v) => { const c = Number(v); if (c) { setYearFrom(Math.max(years.min, c - 1)); setYearTo(Math.min(years.max, c)); } else { setYearFrom(years.min); setYearTo(years.max); } }}
          options={[{ value: "", label: "All years" }, ...cycles.map((c) => ({ value: String(c), label: `${c} cycle` }))]} />}
        {mode === "map" && <span className="years-range"><Select label="Years" value={String(yearFrom)} onChange={(v) => setYearFrom(Number(v))} options={yearOpts.filter((o) => Number(o.value) <= yearTo)} />
          <span aria-hidden>–</span><Select label="to" value={String(yearTo)} onChange={(v) => setYearTo(Number(v))} options={yearOpts.filter((o) => Number(o.value) >= yearFrom)} /></span>}
        <Select label="Min $" value={String(minAmount)} onChange={(v) => setMinAmount(Number(v))} options={[0, 10000, 100000, 1000000, 10000000].map((v) => ({ value: String(v), label: v ? fmtMoney(v) : "Any" }))} />
      </span>
    </div>
  );
  const filters = <>{viewRow}{filterRow}</>;

  const timeline = mode === "timeline" && (
    <div className="timebar">
      <button onClick={() => { if (monthIdx >= months.length - 1) setMonthIdx(0); setPlaying((p) => !p); }} aria-pressed={playing} disabled={reducedMotion && !playing}
        title={reducedMotion ? "Autoplay is off because your system asks for reduced motion. Drag the slider instead." : undefined}>{playing ? "Pause" : "Play"}</button>
      <span className="seg speed" role="group" aria-label="Playback speed">
        {[1, 2, 4, 8].map((x) => <button key={x} aria-pressed={speed === x} onClick={() => setSpeed(x)}>{x}×</button>)}
      </span>
      <input type="range" min={0} max={months.length - 1} value={monthIdx} onChange={(e) => { setPlaying(false); setMonthIdx(Number(e.target.value)); }} aria-label="Show the network as of" aria-valuetext={months[monthIdx]} />
      <span className="mono">{fmtDate(`${months[monthIdx]}-01`).replace(/ 1,/, "")} · {fLinks.length} dated links</span>
    </div>
  );

  // ?view=time opens the timeline and ?focus=id selects a name; a link to the map from elsewhere on the site lands here too.
  const fromUrl = <Suspense fallback={null}><FromUrl apply={(view, focus) => { setModeState(view === "time" ? "timeline" : "map"); if (focus) setSelected(focus); }} /></Suspense>;
  // SteppedList takes its starting name once, so a name arriving from the URL or the search box remounts it.
  if (mobile) return (<div className="mapwrap">{fromUrl}{filters}{timeline}<SteppedList key={selected ?? ""} nodes={nodes} links={fLinks} initial={selected} /></div>);

  return (
    <div className="mapwrap" ref={wrap}>
      {fromUrl}
      <div className="maptools">
        {filters}
      </div>
      {timeline}
      <div className={`mapstage${focus ? " focused" : ""}`}>
        <svg ref={svgRef} width={width} height={height} role="group" aria-label="Influence map: The Valley, Through, Lands on" className="map">
          <g ref={gRef}>
            {COL_TITLES.map((t, i) => (
              <g key={t} transform={`translate(${xOf(i)},${TOP - 24})`}>
                <text className="coltitle">{t}</text>
                <line x1="0" x2={COL_W} y1="8" y2="8" className="colrule" />
              </g>
            ))}
            <g className="edges">
              {edges.map((e) => (
                <path key={e.key} d={pathOf(e)} className={`edge edge-${e.type}`} strokeWidth={widthOf(e)} style={{ opacity: edgeTone(e) }}
                  onMouseEnter={() => setHoverEdge(e)} onMouseLeave={() => setHoverEdge(null)} />
              ))}
            </g>
            {k >= 1.3 && edges.filter((e) => e.type === "money" && e.amount > 0 && e.from.kind === "node" && e.to.kind === "node").map((e) => (
              <text key={`t${e.key}`} className="edgeamt" x={(xOf(e.from.col) + COL_W + xOf(e.to.col)) / 2} y={(e.from.y + e.to.y) / 2 + 12} textAnchor="middle">{fmtMoney(e.amount)}</text>
            ))}
            {items.map((it) => {
              const x = xOf(it.col);
              const isSel = it.nodeId && it.nodeId === selected;
              const hop = it.nodeId && focus ? focus.get(it.nodeId) : undefined;
              return (
                <g key={it.key} transform={`translate(${x},${it.y})`} className={`item item-${it.kind}${isSel ? " sel" : ""}${hop === 2 ? " hop2" : ""}`}
                  role="button" tabIndex={0} aria-expanded={it.kind === "cluster" || it.kind === "header" ? it.kind === "header" : undefined}
                  aria-pressed={it.kind === "node" ? Boolean(isSel) : undefined}
                  aria-label={it.kind === "node" ? `${it.label}${it.money ? `, ${fmtMoney(it.money)}` : ""}` : it.kind === "cluster" ? `${it.label}, ${it.count} names. Expand` : it.label}
                  onClick={() => activate(it)} onKeyDown={(e) => onKey(e, it)}>
                  {it.kind === "cluster" && <>
                    <rect width={COL_W} height={CLUSTER_H - 6} rx="2" />
                    <text x="12" y="18" className="clabel">{it.label}</text>
                    <text x="12" y="33" className="csub">{it.count} {it.count === 1 ? "name" : "names"}{it.money ? ` · ${fmtMoney(it.money)}` : ""}</text>
                    <text x={COL_W - 14} y="27" className="chev" textAnchor="end">+</text>
                  </>}
                  {it.kind === "header" && <>
                    <rect width={COL_W} height={28} className="hit" />
                    <text x="0" y="18" className="hlabel">{it.label}</text>
                    {!focus && <text x={COL_W - 6} y="19" className="chev" textAnchor="end">−</text>}
                    <line x1="0" x2={COL_W} y1="24" y2="24" className="colrule" />
                  </>}
                  {it.kind === "node" && <>
                    <rect width={COL_W} height={ROW_H} className="hit" />
                    <rect width={COL_W} height={ROW_H - 4} rx="2" className="nrow" />
                    <circle cx="11" cy={(ROW_H - 4) / 2} r="3.5" className="dot" />
                    <text x="22" y={(ROW_H - 4) / 2 + 4.5} className="nlabel">{it.label.length > 30 ? it.label.slice(0, 29) + "…" : it.label}</text>
                    {it.money ? <text x={COL_W - 10} y={(ROW_H - 4) / 2 + 4} className="namt" textAnchor="end">{fmtMoney(it.money)}</text> : null}
                    {k >= 1.3 && it.sub && <text x="20" y="31" className="nsub">{it.sub.slice(0, 46)}</text>}
                  </>}
                  {(it.kind === "more" || it.kind === "colmore") && <>
                    <rect width={COL_W} height={it.h - 4} rx="2" className="morerow" />
                    <text x={COL_W / 2} y={(it.h - 4) / 2 + 4} textAnchor="middle" className="morelabel">{it.label}</text>
                  </>}
                </g>
              );
            })}
          </g>
        </svg>
        {hoverEdge && (
          <div className="edgetip mono" role="status">
            {hoverEdge.count} {hoverEdge.type} {hoverEdge.count === 1 ? "link" : "links"}{hoverEdge.amount ? ` · ${fmtMoney(hoverEdge.amount)}` : ""}<br />
            {hoverEdge.from.label} → {hoverEdge.to.label}
          </div>
        )}
        {selected && byId.has(selected) && <NodePanel id={selected} links={fLinks} byId={byId} onSelect={setSelected} onClose={() => setSelected(null)} />}
      </div>
      {selItem === undefined && selected && <p className="muted">That name has no links under the current filters.</p>}
    </div>
  );
}
