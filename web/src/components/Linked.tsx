import Link from "@/components/Link";
import type { Part } from "@/lib/linkify";

// A sentence with tracked actors' names linked to their profiles.
export default function Linked({ parts, text }: { parts?: Part[]; text: string }) {
  if (!parts) return <>{text}</>;
  return <>{parts.map((p, i) => (p.id ? <Link key={i} href={`/node/${p.id}`}>{p.t}</Link> : <span key={i}>{p.t}</span>))}</>;
}
