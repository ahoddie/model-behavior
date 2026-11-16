// Where the average reading falls between disagree and agree, said in words. The bar is a picture of the words.
export const stanceWords = (v: number) =>
  v >= 1.5 ? "Agree strongly" : v >= 0.5 ? "Mostly agree" : v > -0.5 ? "Split" : v > -1.5 ? "Mostly disagree" : "Disagree strongly";

export default function StanceBar({ value }: { value: number | null }) {
  if (value == null) return <span className="stancebar-none">No side taken</span>;
  const pct = ((value + 2) / 4) * 100;
  const words = stanceWords(value);
  return (
    <span className="stancebar" role="img" aria-label={`${words}, ${value > 0 ? "+" : value < 0 ? "minus " : ""}${Math.abs(value).toFixed(1)} on a scale from −2 (disagree strongly) to +2 (agree strongly)`}>
      <span className="sb-word">{words} <span className="sb-num">{value > 0 ? "+" : value < 0 ? "−" : ""}{Math.abs(value).toFixed(1)}</span></span>
      <span className="sb-line">
        <span className="sb-end">Disagree −2</span>
        <span className="sb-track" aria-hidden><span className="sb-mid" /><span className="sb-dot" style={{ left: `${pct}%` }} /></span>
        <span className="sb-end">+2 Agree</span>
      </span>
    </span>
  );
}
