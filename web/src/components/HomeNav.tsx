import Link from "@/components/Link";

// The row under the homepage title: one box per main page, each with a small drawing of what that page shows.
// The drawings are stylized, not screenshots, and take their colors from the theme so they follow light and dark.

// Network: givers on the left, groups in the middle, and the bills and races on the right, joined by lines.
function NetworkMock() {
  const L = [16, 34, 52, 70, 88], M = [24, 48, 72, 92], R = [14, 30, 46, 62, 78, 94];
  const links: [number, number, "m" | "p"][] = [[0, 0, "m"], [0, 1, "m"], [1, 1, "m"], [2, 2, "m"], [3, 2, "p"], [4, 3, "m"], [1, 3, "p"]];
  const out: [number, number, "m" | "p"][] = [[0, 0, "m"], [0, 2, "p"], [1, 1, "m"], [1, 3, "m"], [2, 3, "p"], [2, 4, "m"], [3, 5, "m"], [3, 4, "p"]];
  const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`;
  return (
    <svg viewBox="0 0 240 108" aria-hidden className="hn-svg">
      <g fill="none" strokeWidth="1.2">
        {links.map(([a, b, k], i) => <path key={`a${i}`} className={`hn-line hn-${k}`} d={curve(36, L[a], 104, M[b])} style={{ ["--i" as any]: i }} />)}
        {out.map(([a, b, k], i) => <path key={`b${i}`} className={`hn-line hn-${k}`} d={curve(136, M[a], 200, R[b])} style={{ ["--i" as any]: i + 3 }} />)}
      </g>
      {L.map((y, i) => <g key={i}><circle cx="30" cy={y} r="5" className="hn-node" /><rect x="6" y={y - 1.5} width="16" height="3" className="hn-text" /></g>)}
      {M.map((y, i) => <rect key={i} x="104" y={y - 6} width="32" height="12" rx="2" className="hn-box" />)}
      {R.map((y, i) => <g key={i}><rect x="200" y={y - 4} width="8" height="8" className="hn-node hn-target" /><rect x="212" y={y - 1.5} width={14 + (i % 3) * 5} height="3" className="hn-text" /></g>)}
    </svg>
  );
}

// Nodes: one giver, its money fanning out to recipients and on to theirs.
function NodesMock() {
  const mid = [[14, 18], [38, 12], [56, 8], [70, 6], [82, 4]] as const, far = [[30, 6], [50, 4], [68, 3]] as const;
  const ribbon = (x1: number, y1: number, h1: number, x2: number, y2: number, h2: number) => {
    const c = (x1 + x2) / 2;
    return `M${x1} ${y1} C${c} ${y1} ${c} ${y2} ${x2} ${y2} L${x2} ${y2 + h2} C${c} ${y2 + h2} ${c} ${y1 + h1} ${x1} ${y1 + h1} Z`;
  };
  let y0 = 30;
  return (
    <svg viewBox="0 0 160 108" aria-hidden className="hn-svg">
      {mid.map(([y, h], i) => { const d = ribbon(34, y0, h, 72, y, h); y0 += h; return <path key={i} d={d} className="hn-ribbon" style={{ ["--i" as any]: i }} />; })}
      {far.map(([y, h], i) => <path key={i} d={ribbon(96, mid[i][0] + 2, h, 124, y, h)} className="hn-ribbon hn-ribbon-far" style={{ ["--i" as any]: i + 5 }} />)}
      <rect x="8" y="28" width="26" height="52" rx="2" className="hn-box hn-box-strong" />
      {mid.map(([y, h], i) => <rect key={i} x="72" y={y} width="24" height={Math.max(h, 5)} rx="1.5" className="hn-box" />)}
      {far.map(([y, h], i) => <rect key={i} x="124" y={y} width="26" height={Math.max(h, 5)} rx="1.5" className="hn-box" />)}
    </svg>
  );
}

// Policy: bill tiles, each with a title, a line of text, and the split of positions drawn as a bar.
function PolicyMock() {
  const tiles = [[6, 8, 0.7], [82, 8, 0.45], [6, 58, 0.85], [82, 58, 0.3]] as const;
  return (
    <svg viewBox="0 0 160 108" aria-hidden className="hn-svg">
      {tiles.map(([x, y, s], i) => (
        <g key={i} className="hn-tile" style={{ ["--i" as any]: i }}>
          <rect x={x} y={y} width="72" height="44" rx="2" className="hn-box" />
          <rect x={x + 6} y={y + 7} width="46" height="4" className="hn-title" />
          <rect x={x + 6} y={y + 15} width="56" height="2.5" className="hn-text" />
          <rect x={x + 6} y={y + 20} width="40" height="2.5" className="hn-text" />
          <rect x={x + 6} y={y + 30} width={60 * s} height="4" className="hn-support" />
          <rect x={x + 6 + 60 * s} y={y + 30} width={60 * (1 - s)} height="4" className="hn-oppose" />
          <rect x={x + 6} y={y + 37} width="20" height="2" className="hn-text" />
          <rect x={x + 36} y={y + 37} width="16" height="2" className="hn-text" />
        </g>
      ))}
    </svg>
  );
}

// Statements: not a picture of a chart but of what the page collects, people saying where they stand, in their words.
function StatementsMock() {
  const posts = [[8, 8, "s", 58], [40, 32, "o", 50], [14, 56, "s", 66], [46, 80, "o", 44]] as const;
  return (
    <svg viewBox="0 0 160 108" aria-hidden className="hn-svg">
      <defs><filter id="hn-blur" x="-5%" y="-30%" width="110%" height="160%"><feGaussianBlur stdDeviation="0.9" /></filter></defs>
      {posts.map(([x, y, side, w], i) => (
        <g key={i} className="hn-post" style={{ ["--i" as any]: i }}>
          <circle cx={x + 7} cy={y + 9} r="6" className="hn-avatar" />
          <rect x={x + 17} y={y} width={w + 30} height="20" rx="8" className="hn-bubble" />
          <g filter="url(#hn-blur)">
            <rect x={x + 24} y={y + 6} width={w} height="2.6" className="hn-text" />
            <rect x={x + 24} y={y + 11.5} width={w * 0.7} height="2.6" className="hn-text" />
          </g>
          <rect x={x + w + 34} y={y + 6} width="8" height="8" className={side === "s" ? "hn-support" : "hn-oppose"} />
        </g>
      ))}
    </svg>
  );
}

const PAGES = [
  { href: "/map", name: "Network", note: "The money behind AI policy drawn as one connected map", Mock: NetworkMock, wide: true },
  { href: "/money", name: "Nodes", note: "Pick any giver and follow each dollar to where it lands", Mock: NodesMock },
  { href: "/targets", name: "Policy", note: "AI bills and rules in play plus the races that drew the money", Mock: PolicyMock },
  { href: "/statements", name: "Statements", note: "Where leaders stand on AI's open questions in their own words", Mock: StatementsMock },
];

export default function HomeNav() {
  return (
    <nav className="hn" aria-labelledby="hn-head">
      <h2 id="hn-head" className="hn-head">Scroll for an overview, or go straight to a page:</h2>
      <ul className="hn-row">{PAGES.map(({ href, name, note, Mock, wide }) => (
        <li key={href} className={`hn-card${wide ? " hn-wide" : ""}`}>
          <Link href={href}>
            <span className="hn-art"><Mock /></span>
            <span className="hn-name">{name}<span className="hn-arrow" aria-hidden>→</span></span>
            <span className="hn-note">{note}</span>
          </Link>
        </li>
      ))}</ul>
    </nav>
  );
}
