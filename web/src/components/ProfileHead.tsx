// Shared top of every profile: logo (or an initials box), name, descriptor and the sourced key facts.
// Each fact ends in a source pill (components/Src.tsx); Website values link to the site itself.
import CiteButton from "./CiteButton";
import { fmtDate } from "@/lib/format";
import { TYPE_LABEL } from "@/lib/format";
import Src from "./Src";

type KeyFact = { label: string; text: string; url: string };
const ORGS = new Set(["lab", "investor", "funder", "think_tank", "nonprofit", "pac", "agency"]);

export function Mark({ node, size = 56 }: { node: { name: string; type: string; logo_url?: string | null }; size?: number }) {
  if (node.logo_url) {
    // eslint-disable-next-line @next/next/no-img-element -- hot-linked from the org's own site, sizes vary
    return <img className="mark" src={node.logo_url} alt="" width={size} height={size} referrerPolicy="no-referrer" loading="lazy" />;
  }
  const initials = node.name.replace(/\(.*?\)/g, "").split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return <span className={`mark mark-blank${ORGS.has(node.type) ? "" : " mark-person"}`} style={{ width: size, height: size }} aria-hidden>{initials}</span>;
}

export function KeyFacts({ facts, compact }: { facts: KeyFact[]; compact?: boolean }) {
  if (!facts.length) return null;
  const shown = compact ? facts.filter((f) => !["Website", "Social", "FEC ID", "EIN"].includes(f.label)).slice(0, 5) : facts;
  return (
    <dl className={`keyfacts${compact ? " compact" : ""}`}>
      {shown.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.label === "Website" ? <a href={f.url} target="_blank" rel="noreferrer">{f.text}</a> : <>{f.text} <Src url={f.url} /></>}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ProfileHead({ node, keyFacts, kicker, logoSource, citePath }: {
  node: { name: string; type: string; descriptor?: string | null; source_url: string; logo_url?: string | null };
  keyFacts: KeyFact[]; kicker?: React.ReactNode; logoSource?: string | null; citePath?: string;
}) {
  return (
    <header className="profile-head">
      <div className="profile-title">
        {logoSource && node.logo_url ? <a className="no-ext" href={logoSource} target="_blank" rel="noreferrer" aria-label={`${node.name} logo source`}><Mark node={node} /></a> : <Mark node={node} />}
        <div>
          <h1>{node.name}</h1>
          {node.descriptor && <p className="lede">{node.descriptor} <Src url={node.source_url} /></p>}
          <p className="profile-meta">{kicker ?? TYPE_LABEL[node.type]}{citePath && <> <CiteButton small kind="page" title={node.name} path={citePath} /></>}</p>
        </div>
      </div>
      <KeyFacts facts={keyFacts} />
    </header>
  );
}
