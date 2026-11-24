import type { ReactNode } from "react";

// A ranked horizontal bar chart: names down the left, one bar each, the value written at the bar's end, and a light grid
// with a numbered axis underneath. Plain HTML and CSS so names stay links and the chart reflows: in a narrow container the
// name moves above its bar. A row's note is kept out of the plot so rows stay one line tall: it shows on hover. No hooks, so it renders on the server and inside client components alike.
export type RankRow = { id: string; label: ReactNode; name: string; value: number; tone?: "ink" | "support" | "oppose" | "mixed"; note?: string };

// Round axis steps: 1, 2 or 5 times a power of ten, about `want` of them.
export function niceStep(max: number, want = 6) {
  const raw = max / want, pow = 10 ** Math.floor(Math.log10(raw)), f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

// With onSelect, a row's bar area is a button: pressing it opens `detail` under that row (the caller decides what it holds).
export default function RankChart({ rows, unit, fmt = (n) => n.toLocaleString(), label, selected, onSelect, detail }: {
  rows: RankRow[]; unit: string; fmt?: (n: number) => string; label: string;
  selected?: string | null; onSelect?: (id: string) => void; detail?: ReactNode;
}) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const step = Math.max(niceStep(max), Number.isInteger(max) ? 1 : 0);
  const ticks: number[] = [];
  for (let t = 0; t <= max + step * 1e-9; t += step) ticks.push(t);
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="rc" role="group" aria-label={label} style={{ ["--rc-step" as string]: pct(step) }}>
      <ol className="rc-rows">{rows.map((r, i) => (
        <li key={r.id} className={`rc-row${selected === r.id ? " rc-open" : ""}`} style={{ ["--i" as string]: i }} title={`${r.name}: ${fmt(r.value)} ${unit}${r.note ? `. ${r.note}` : ""}`}>
          <div className="rc-label">{r.label}</div>
          <div className="rc-track">
            {onSelect ? (
              <button type="button" className="rc-line rc-hit" aria-expanded={selected === r.id} aria-label={`${r.name}: ${fmt(r.value)} ${unit}. Show the issues`} onClick={() => onSelect(r.id)}>
                <span className={`rc-bar rc-${r.tone ?? "ink"}`} style={{ width: pct(r.value) }} aria-hidden />
                <span className="rc-val">{fmt(r.value)}</span>
              </button>
            ) : (
              <div className="rc-line">
                <span className={`rc-bar rc-${r.tone ?? "ink"}`} style={{ width: pct(r.value) }} aria-hidden />
                <span className="rc-val">{fmt(r.value)}</span>
              </div>
            )}
          </div>
          {selected === r.id && detail && <div className="rc-detail">{detail}</div>}
        </li>
      ))}</ol>
      <div className="rc-row rc-axis" aria-hidden>
        <div />
        <div className="rc-ticks">
          {ticks.map((t) => <span key={t} style={{ left: pct(t) }}>{fmt(t)}</span>)}
          <span className="rc-unit">{unit} →</span>
        </div>
      </div>
    </div>
  );
}
