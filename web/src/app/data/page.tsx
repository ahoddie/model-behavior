import { connection } from "next/server";
import Link from "next/link";
import { q } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import Src from "@/components/Src";

export default async function OpenData(props: PageProps<"/data">) {
  await connection();
  const sp = await props.searchParams;
  const view = typeof sp.view === "string" ? sp.view : "download";
  const counts = (await q<any>(`SELECT (SELECT count(*) FROM nodes)::int nodes, (SELECT count(*) FROM links)::int links, (SELECT count(*) FROM feed_items WHERE status='approved')::int feed_items,
    (SELECT count(*) FROM filings)::int filings, (SELECT count(*) FROM facts)::int facts,
    (SELECT count(*) FROM archives WHERE archive_url IS NOT NULL)::int archived, (SELECT count(DISTINCT url) FROM url_checks)::int checked`))[0];
  const changes = view === "changelog" ? await q<any>(`SELECT c.*, c.at::text FROM changelog c ORDER BY id DESC LIMIT 300`) : [];
  const corrections = view === "corrections" ? await q<any>(`SELECT *, at::text FROM corrections ORDER BY id DESC LIMIT 500`) : [];
  const runs = view === "methodology" ? await q<any>(`SELECT DISTINCT ON (importer) importer, started_at::text, ok, added, message FROM import_runs ORDER BY importer, started_at DESC`) : [];
  return (
    <div className="page">
      <h1>Open data</h1>
      <nav className="tabs" aria-label="Open data sections">
        {[["download", "Download"], ["methodology", "Methodology"], ["corrections", "Corrections"]].map(([v, l]) =>
          <Link key={v} href={`/data?view=${v}`} scroll={false} aria-current={view === v ? "page" : undefined}>{l}</Link>)}
      </nav>

      {view === "download" && <>
        <p className="lede">Every table, with each row&apos;s source URL and archive copy.</p>
        <table className="data-table"><thead><tr><th>Table</th><th className="num">Rows</th><th>Files</th></tr></thead><tbody>
          {(["nodes", "links", "feed_items", "filings", "facts"] as const).map((t) => (
            <tr key={t}><td className="mono">{t}</td><td className="num">{counts[t].toLocaleString()}</td>
              <td><a href={`/api/export/${t}.csv`}>CSV</a> · <a href={`/api/export/${t}.json`}>JSON</a></td></tr>
          ))}
          <tr><td className="mono">corrections</td><td /><td><a href="/api/export/corrections.csv">CSV</a> · <a href="/api/export/corrections.json">JSON</a></td></tr>
        </tbody></table>
        <p className="mono muted">{counts.archived.toLocaleString()} sources archived · {counts.checked.toLocaleString()} checked for link rot</p>
      </>}

      {view === "methodology" && <div className="prose">
        <dl className="keyfacts compact defs">
          <div><dt>Money</dt><dd>FEC, Senate LDA, state lobbying, IRS 990s, grants. Credited to the named giver, never a donor&apos;s employer.</dd></div>
          <div><dt>People</dt><dd>Jobs, boards, advisory roles, government moves.</dd></div>
          <div><dt>Ideas</dt><dd>Reports, op-eds, testimony, model bills.</dd></div>
          <div><dt>Positions</dt><dd>Support or opposition on the record: analyses, letters, comments.</dd></div>
          <div><dt>Dates</dt><dd>Shown as precisely as the source gives them: &ldquo;2025&rdquo; stays 2025.</dd></div>
          <div id="coverage"><dt>Empty sections</dt><dd>Mean nothing was found in the sources checked so far, not that none exists.</dd></div>
          <div id="analysis"><dt>Issue analysis</dt><dd>An open-source model (Qwen 2.5 7B, run locally) reads each quote with only the speaker&apos;s name. It decides whether the speaker gives their own view, which issues the quote covers, and how far it agrees with a plain statement for each issue (−2 to +2). Only own-view quotes with confidence 0.6 or higher count, and neutral mentions are left out of averages. Money by issue splits each gift across the issues its recipient talks about. Labels can be wrong and describe what was said, not what anyone believes. Each one links to its quote.</dd></div>
          <div><dt>Checks</dt><dd>A link check confirms the page loads and the quote appears on it. It does not confirm the claim.</dd></div>
        </dl>
        <h2>Importers</h2>
        <table className="data-table"><thead><tr><th>Importer</th><th>Last run</th><th>OK</th><th className="num">Added</th><th>Note</th></tr></thead><tbody>
          {runs.map((r) => <tr key={r.importer}><td className="mono">{r.importer}</td><td className="mono">{r.started_at.slice(0, 16)}</td><td>{r.ok ? "yes" : r.ok === false ? "no" : "running"}</td><td className="num">{r.added}</td><td>{r.message}</td></tr>)}
        </tbody></table>
      </div>}

      {view === "changelog" && <table className="data-table"><thead><tr><th>When</th><th>Action</th><th>Table</th><th>Row</th><th>By</th></tr></thead><tbody>
        {changes.map((c) => <tr key={c.id}><td className="mono">{c.at.slice(0, 16)}</td><td>{c.action}</td><td className="mono">{c.table_name}</td>
          <td className="mono">{c.table_name === "nodes" ? <Link href={`/node/${c.row_ref}`}>{c.row_ref}</Link> : c.row_ref}</td><td className="mono">{c.actor}</td></tr>)}
      </tbody></table>}

      {view === "corrections" && (corrections.length === 0 ? <p className="muted">No corrections yet.</p> :
        <ul className="feed">{corrections.map((c) => <li key={c.id}><div className="when">{fmtDate(c.at)}</div><div>{c.what_changed} <Src url={c.url} /></div></li>)}</ul>)}
    </div>
  );
}
