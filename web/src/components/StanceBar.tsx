// A -2..+2 scale with a marker at the average stance. The words carry the meaning; the bar is a picture of the number.
export default function StanceBar({ value, label }: { value: number | null; label?: string }) {
  if (value == null) return <span className="stancebar-none">No stance taken</span>;
  const pct = ((value + 2) / 4) * 100;
  return (
    <span className="stancebar" role="img" aria-label={label ?? `Average stance ${value > 0 ? "+" : ""}${value.toFixed(1)} on a scale from −2 (disagrees strongly) to +2 (agrees strongly)`}>
      <span className="sb-track"><span className="sb-mid" /><span className="sb-dot" style={{ left: `${pct}%` }} /></span>
      <span className="sb-num">{value > 0 ? "+" : ""}{value.toFixed(1)}</span>
    </span>
  );
}
