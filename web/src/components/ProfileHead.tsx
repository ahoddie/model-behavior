// Shared top of every profile: logo (or an initials box), name, a one-sentence headline, a short description and the key
// facts. People and organizations list their sources once, at the bottom of the page (ProfileSources), so the top reads as
// plain text; bills and other targets still end each fact in a source pill (components/Src.tsx). Website values link to the site.
import CiteButton from "./CiteButton";
import { TYPE_LABEL } from "@/lib/format";
import Linked from "./Linked";
import Src from "./Src";
import type { Part } from "@/lib/linkify";

type KeyFact = { label: string; text: string; url: string; parts?: Part[] };
const ORGS = new Set(["lab", "investor", "funder", "think_tank", "nonprofit", "pac", "agency"]);

export function Mark({ node, size = 56 }: { node: { name: string; type: string; logo_url?: string | null }; size?: number }) {
  const sm = size <= 28 ? " mark-sm" : "";
  if (node.logo_url) {
    // eslint-disable-next-line @next/next/no-img-element -- the org's own icon, saved under /logos; sizes vary
    return <img className={`mark${sm}`} src={node.logo_url} alt="" width={size} height={size} referrerPolicy="no-referrer" loading="lazy" />;
  }
  const initials = node.name.replace(/\(.*?\)/g, "").split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return <span className={`mark mark-blank${sm}${ORGS.has(node.type) ? "" : " mark-person"}`} style={{ width: size, height: size, ...(sm ? { fontSize: Math.round(size * 0.45) } : {}) }} aria-hidden>{initials}</span>;
}

// A name with its mark in front, for lists and tables.
export function Named({ node, size = 20, children }: { node: { name: string; type: string; logo_url?: string | null }; size?: number; children: React.ReactNode }) {
  return <span className="named"><Mark node={node} size={size} />{children}</span>;
}

export function KeyFacts({ facts, compact, inlineSources = true }: { facts: KeyFact[]; compact?: boolean; inlineSources?: boolean }) {
  if (!facts.length) return null;
  const shown = compact ? facts.filter((f) => !["Website", "Social", "FEC ID", "EIN"].includes(f.label)).slice(0, 5) : facts;
  return (
    <dl className={`keyfacts${compact ? " compact" : ""}`}>
      {shown.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.label === "Website" ? <a href={f.url} target="_blank" rel="noreferrer">{f.text}</a>
            : <><Linked parts={f.parts} text={f.text} />{inlineSources && <> <Src url={f.url} /></>}</>}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ProfileHead({ node, keyFacts, kicker, logoSource, citePath, headline, description, mapIt, mapChip }: {
  node: { name: string; type: string; descriptor?: string | null; source_url: string; logo_url?: string | null };
  keyFacts: KeyFact[]; kicker?: React.ReactNode; logoSource?: string | null; citePath?: string;
  // Given a headline, the page lists its sources at the bottom: no source pills up here.
  headline?: { parts?: Part[]; text: string }; description?: { parts?: Part[]; text: string } | null;
  mapIt?: React.ReactNode; mapChip?: React.ReactNode;
}) {
  const quiet = !!headline;
  return (
    <header className={`profile-head${quiet ? " profile-quiet" : ""}`}>
      <div className={`profile-top${mapIt ? " has-aside" : ""}`}>
        <div>
          <div className="profile-title">
            {logoSource && node.logo_url ? <a className="no-ext" href={logoSource} target="_blank" rel="noreferrer" aria-label={`${node.name} logo source`}><Mark node={node} /></a> : <Mark node={node} />}
            <div>
              <h1>{node.name}</h1>
              {headline ? (headline.text && <p className="lede">{<Linked parts={headline.parts} text={headline.text} />}</p>)
                : node.descriptor && <p className="lede">{node.descriptor} <Src url={node.source_url} /></p>}
              <p className="profile-meta">{kicker ?? TYPE_LABEL[node.type]}{citePath && <> <CiteButton small kind="page" title={node.name} path={citePath} /></>}</p>
              {mapChip && <div className="profile-mapchip">{mapChip}</div>}
            </div>
          </div>
          {description?.text && <p className="profile-desc"><Linked parts={description.parts} text={description.text} /></p>}
        </div>
        {mapIt && <div className="profile-aside">{mapIt}</div>}
      </div>
      <KeyFacts facts={keyFacts} inlineSources={!quiet} />
    </header>
  );
}

// One quiet list of where the facts above come from, at the bottom of a profile: "Legal form: ProPublica".
// Labels that share a source are merged onto one line. A written label (from profile_text, marked lead) comes first; key-fact
// labels it already covers ("Founders" under "Founding and founders") are left out, the rest follow after a semicolon.
export type SourceLine = { label: string; name: string; url: string; lead?: boolean };
const join = (l: string[]) => (l.length < 3 ? l.join(" and ") : `${l.slice(0, -1).join(", ")}, and ${l.at(-1)}`);
// Later labels in a line start lower case ("Founded and headquarters"), unless they open with an acronym.
const low = (x: string) => (/^[A-Z][a-z]/.test(x) ? x[0].toLowerCase() + x.slice(1) : x);
const stem = (x: string) => x.toLowerCase().slice(0, 5);

export function ProfileSources({ sources }: { sources: SourceLine[] }) {
  const byUrl = new Map<string, { lead: string[]; rest: string[]; name: string; url: string }>();
  for (const s of sources) {
    if (!s.url) continue;
    const e = byUrl.get(s.url) ?? { lead: [], rest: [], name: s.name, url: s.url };
    if (s.lead) { if (!e.lead.length) e.name = s.name; if (!e.lead.includes(s.label)) e.lead.push(s.label); }
    else if (s.label && !e.rest.includes(s.label)) e.rest.push(s.label);
    byUrl.set(s.url, e);
  }
  if (!byUrl.size) return null;
  const line = (e: { lead: string[]; rest: string[] }) => {
    const covered = e.lead.join(" ").toLowerCase();
    const rest = e.rest.filter((l) => !covered.includes(stem(l)));
    const head = e.lead.length ? join(e.lead.map((x, i) => (i ? low(x) : x))) : "";
    const tail = rest.length ? join(rest.map((x, i) => (i || head ? low(x) : x))) : "";
    return [head, tail].filter(Boolean).join("; ");
  };
  return (
    <section id="sources" className="profile-sources" aria-labelledby="profile-sources-h" tabIndex={-1}>
      <h2 id="profile-sources-h">Sources</h2>
      <ul>{[...byUrl.values()].map((e) => { const l = line(e); return (
        <li key={e.url}>{l && <span className="lbl">{l}: </span>}<a href={e.url} target="_blank" rel="noreferrer" title={e.url}>{e.name}</a></li>
      ); })}</ul>
    </section>
  );
}
