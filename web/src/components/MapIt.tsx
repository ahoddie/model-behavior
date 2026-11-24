// "Map it": opens the network map on this item with its links lit. The mini map is the item's own link pattern, one
// spoke per link (up to 14, in proportion), colored by type: positions carbon and dashed, money gold, people and ideas
// ink. It draws in on hover. Three sizes: a tile for a side column, a chip for a header row, and a 44px icon.
import Link from "@/components/Link";

type Kind = "m" | "p" | "h";
export type LinkCounts = { money?: number; position?: number; person?: number; idea?: number };

const MAX = 14;

// Spokes in proportion to the counts, interleaved so each type spreads around the circle.
function spokes(c: LinkCounts, max = MAX): Kind[] {
  const groups: [Kind, number][] = [["p", c.position ?? 0], ["m", c.money ?? 0], ["h", (c.person ?? 0) + (c.idea ?? 0)]];
  const total = groups.reduce((a, [, n]) => a + n, 0);
  if (!total) return [];
  const n = Math.min(max, total);
  const want = groups.map(([k, v]) => [k, v ? Math.max(1, Math.round((v / total) * n)) : 0] as [Kind, number]);
  const out: Kind[] = [];
  for (let i = 0; out.length < n && want.some(([, v]) => v > 0); i++) {
    const g = want[i % want.length];
    if (g[1] > 0) { out.push(g[0]); g[1]--; }
  }
  return out;
}

const seedOf = (id: string) => [...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 2147483646, 7) + 1;

function Mini({ w, h, seed, links }: { w: number; h: number; seed: number; links: Kind[] }) {
  let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.38;
  const pts = links.map((t, i) => {
    const a = (i / links.length) * 6.283 + r() * 0.5, rr = R * (0.7 + r() * 0.35);
    const x = cx + Math.cos(a) * rr * 1.25, y = cy + Math.sin(a) * rr;
    return { t, x, y, qx: (cx + x) / 2 + (r() - 0.5) * 14, qy: (cy + y) / 2 + (r() - 0.5) * 14 };
  });
  return (
    <svg className="mm" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
      {pts.map((p, i) => <path key={i} className={`e ${p.t}`} d={`M${cx} ${cy}Q${p.qx.toFixed(1)} ${p.qy.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`} />)}
      {pts.map((p, i) => <rect key={i} className="n" x={(p.x - 3.5).toFixed(1)} y={(p.y - 3.5).toFixed(1)} width="7" height="7" rx="1" />)}
      <rect className="ctr" x={cx - 6} y={cy - 6} width="12" height="12" rx="1.5" />
      <circle className="dot" cx={cx + 9} cy={cy - 9} r="3" />
    </svg>
  );
}

export default function MapIt({ id, name, counts, caption, size = "tile" }: {
  id: string; name: string; counts: LinkCounts; caption?: string; size?: "tile" | "chip" | "icon";
}) {
  const href = `/map?focus=${encodeURIComponent(id)}`;
  const seed = seedOf(id);
  let links = spokes(counts);
  // An item with no links yet still gets a small, quiet pattern, so the control reads the same everywhere.
  if (!links.length) links = ["h", "h", "h"];
  const label = `Map it: see ${name} on the network map`;
  if (size === "icon") return <Link className="mapit icon" href={href} aria-label={label}><Mini w={34} h={34} seed={seed} links={links.slice(0, 6)} /></Link>;
  if (size === "chip") return <Link className="mapit chipv" href={href} aria-label={label}><Mini w={44} h={32} seed={seed} links={links.slice(0, 7)} /><span className="t">Map it</span></Link>;
  return (
    <Link className="mapit tile" href={href} aria-label={label}>
      <Mini w={220} h={120} seed={seed} links={links} />
      <span className="lbl"><span className="t">Map it</span>{caption && <span className="s">{caption}</span>}</span>
    </Link>
  );
}

// "18 groups, 9 people, and 3 bills": distinct linked items by kind, with the Oxford comma.
export function linkCaption(others: { id: string; type: string }[]) {
  const seen = new Map<string, string>();
  for (const o of others) seen.set(o.id, o.type);
  let people = 0, rules = 0, groups = 0;
  for (const t of seen.values()) {
    if (t === "person" || t === "lawmaker") people++;
    else if (["bill", "rule"].includes(t)) rules++;
    else groups++;
  }
  const parts = [groups && `${groups} ${groups === 1 ? "group" : "groups"}`, people && `${people} ${people === 1 ? "person" : "people"}`,
    rules && `${rules} ${rules === 1 ? "bill or rule" : "bills and rules"}`].filter(Boolean) as string[];
  if (!parts.length) return "Not linked yet";
  return parts.length < 3 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}
