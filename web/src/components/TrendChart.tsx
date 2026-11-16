import { niceStep } from "@/components/RankChart";

// Positions by year as stacked columns: time runs left to right, each column is one year, split into supported, mixed
// and opposed, with the year's total written on top. Same grid and axis language as RankChart.
export type TrendYear = { y: number; support: number; mixed: number; oppose: number };
const PARTS = [["support", "supported"], ["mixed", "mixed or conditional"], ["oppose", "opposed"]] as const;

export default function TrendChart({ years, current, label }: { years: TrendYear[]; current: number; label: string }) {
  if (!years.length) return null;
  const total = (y: TrendYear) => y.support + y.mixed + y.oppose;
  const max = Math.max(...years.map(total), 1);
  const step = Math.max(niceStep(max, 4), 1);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  const pct = (v: number) => `${(v / top) * 100}%`;
  return (
    <div className="tc" role="group" aria-label={label}>
      <div className="tc-y" aria-hidden>{ticks.map((t) => <span key={t} style={{ bottom: pct(t) }}>{t}</span>)}</div>
      <div className="tc-plot">
        {ticks.slice(1).map((t) => <i key={t} className="tc-grid" style={{ bottom: pct(t) }} aria-hidden />)}
        <ol className="tc-cols">{years.map((y) => (
          <li key={y.y} title={`${y.y}: ${y.support} supported, ${y.mixed} mixed or conditional, ${y.oppose} opposed`}>
            <span className="tc-val" style={{ bottom: pct(total(y)) }}>{total(y)}</span>
            <span className="tc-stack" style={{ height: pct(total(y)) }}>
              {PARTS.filter(([k]) => y[k] > 0).map(([k, word]) => (
                <span key={k} className={`sw-${k}`} style={{ flex: y[k] }}><span className="sr-only">{y[k]} {word}</span></span>
              ))}
            </span>
          </li>
        ))}</ol>
      </div>
      <div />
      <ol className="tc-x">{years.map((y) => <li key={y.y}>{y.y}{y.y === current && <span className="tc-sofar">so far</span>}</li>)}</ol>
    </div>
  );
}
