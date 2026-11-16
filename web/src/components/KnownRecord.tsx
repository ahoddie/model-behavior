// Shown when a profile has no sourced records at all. States what is known (type, descriptor, public IDs with links to
// their record pages) and says plainly that nothing more is on record. Never leaves the page blank.
import Src from "./Src";
import { q } from "@/lib/db";
import { TYPE_LABEL } from "@/lib/format";

type Ext = { system: string; value: string };

const LABEL: Record<string, string> = {
  fec: "FEC committee ID", fec_committee: "FEC committee ID", fec_candidate: "FEC candidate ID", fec_house: "FEC candidate ID", fec_alt: "FEC ID",
  ein: "IRS employer ID", bioguide: "Congress bioguide ID", wikidata: "Wikidata ID", leginfo_bill_id: "California bill ID", openstates: "Open States ID",
  lda_registrant: "Lobbying registrant ID", lda_client: "Lobbying client ID", lda_lobbyist: "Lobbyist ID", bluesky: "Bluesky handle", x: "X handle", race: "Race",
};

/** Link to the public record page for an ID, when its address is known from the ID alone. */
export function recordUrl(system: string, value: string): string | null {
  const v = encodeURIComponent(value);
  switch (system) {
    case "fec": case "fec_committee": return /^C\d{8}$/.test(value) ? `https://www.fec.gov/data/committee/${v}/` : /^[HSP]\d[A-Z]{2}\d{5}$/.test(value) ? `https://www.fec.gov/data/candidate/${v}/` : null;
    case "fec_candidate": case "fec_house": case "fec_alt": return /^[HSP]\d[A-Z]{2}\d{5}$/.test(value) ? `https://www.fec.gov/data/candidate/${v}/` : /^C\d{8}$/.test(value) ? `https://www.fec.gov/data/committee/${v}/` : null;
    case "ein": return `https://projects.propublica.org/nonprofits/organizations/${v.replace(/-/g, "")}`;
    case "bioguide": return `https://bioguide.congress.gov/search/bio/${v}`;
    case "wikidata": return `https://www.wikidata.org/wiki/${v}`;
    case "leginfo_bill_id": return `https://leginfo.legislature.ca.gov/faces/billStatusClient.xhtml?bill_id=${v}`;
    case "lda_registrant": return `https://lda.senate.gov/filings/public/filing/search/?registrant_id=${v}`;
    case "bluesky": return `https://bsky.app/profile/${v}`;
    case "x": return null; // X is only read through its official API, so no page link is made here
    default: return null;
  }
}

/** Congress.gov page for ids like us-119-s3062 or us-119-hr2385. */
function congressUrl(id: string): string | null {
  const m = id.match(/^us-(\d+)-(hr|s|hjres|sjres|hres|sres)(\d+)$/);
  if (!m) return null;
  const kind = { hr: "house-bill", s: "senate-bill", hjres: "house-joint-resolution", sjres: "senate-joint-resolution", hres: "house-resolution", sres: "senate-resolution" }[m[2]]!;
  const ord = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
  return `https://www.congress.gov/bill/${ord(Number(m[1]))}-congress/${kind}/${m[3]}`;
}

export default async function KnownRecord({ node }: { node: { id: string; type: string; descriptor?: string | null; source_url: string; archive_url?: string | null; external_ids?: Record<string, unknown> | null } }) {
  const rows = await q<Ext>(`SELECT system, value FROM entity_external_ids WHERE node_id=$1 ORDER BY system, value`, [node.id]).catch(() => [] as Ext[]);
  const ids: Ext[] = [];
  const seen = new Set<string>();
  for (const [k, v] of Object.entries(node.external_ids ?? {})) if (typeof v === "string" || typeof v === "number") ids.push({ system: k, value: String(v) });
  for (const r of rows) ids.push(r);
  const uniq = ids.filter((i) => { const k = `${i.system}:${i.value}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const cg = congressUrl(node.id);
  return (
    <section className="known-record" aria-label="What is known">
      <h2>What is known</h2>
      <dl className="keyfacts">
        <div><dt>Type</dt><dd>{TYPE_LABEL[node.type] ?? node.type}</dd></div>
        {node.descriptor && <div><dt>Description</dt><dd>{node.descriptor}</dd></div>}
        {uniq.map((i) => {
          const u = recordUrl(i.system, i.value);
          return <div key={`${i.system}:${i.value}`}><dt>{LABEL[i.system] ?? i.system}</dt><dd>{u ? <a href={u} target="_blank" rel="noreferrer">{i.value}</a> : i.value}</dd></div>;
        })}
        {cg && <div><dt>Public record</dt><dd><a href={cg} target="_blank" rel="noreferrer">Congress.gov bill page</a></dd></div>}
        <div><dt>Listed from</dt><dd><Src url={node.source_url} archive={node.archive_url} /></dd></div>
      </dl>
      <p className="muted">No sourced records yet.</p>
    </section>
  );
}
