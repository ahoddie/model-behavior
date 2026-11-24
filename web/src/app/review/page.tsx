import { connection } from "next/server";
import { headers } from "next/headers";
import Link from "@/components/Link";
import { q } from "@/lib/db";
import { decide, bulk, runImporter, decideQueued, decideStance } from "./actions";
import { getStanceQueue } from "@/lib/data";
import Select from "@/components/Select";

const READING = [{ value: "2", label: "agrees strongly" }, { value: "1", label: "agrees" }, { value: "0", label: "no clear side" }, { value: "-1", label: "disagrees" }, { value: "-2", label: "disagrees strongly" }];
const IMPORTERS = ["lda", "fec", "propublica", "regulations", "congress", "openstates", "state-lobbying", "news", "social", "blogs", "transcripts"];

export default async function Review(props: PageProps<"/review">) {
  await connection();
  const host = ((await headers()).get("host") ?? "").split(":")[0];
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return <div className="page"><h1>Review</h1><p>The review screen only opens on this machine.</p></div>;
  const sp = await props.searchParams;
  const origin = typeof sp.origin === "string" ? sp.origin : "";
  const pending = await q<any>(`SELECT f.*, f.date::text, n.name FROM feed_items f JOIN nodes n ON n.id=f.node_id WHERE f.status='pending' AND ($1='' OR f.origin=$1)
                                ORDER BY f.created_at DESC LIMIT 100`, [origin]);
  const origins = await q<{ origin: string; n: number }>(`SELECT origin, count(*)::int n FROM feed_items WHERE status='pending' GROUP BY origin ORDER BY n DESC`);
  const ws = typeof sp.ws === "string" ? sp.ws : "";
  // Pipeline queue: most significant first, then most confident.
  const queued = await q<any>(`SELECT * FROM review_queue WHERE status='pending' AND ($1='' OR source_workstream=$1)
    ORDER BY significance DESC, confidence DESC NULLS LAST, id LIMIT 100`, [ws]);
  const wsCounts = await q<{ source_workstream: string; n: number }>(`SELECT source_workstream, count(*)::int n FROM review_queue WHERE status='pending' GROUP BY 1 ORDER BY 2 DESC`);
  const readings = await getStanceQueue();
  const runs = await q<any>(`SELECT importer, started_at::text, finished_at, ok, added FROM import_runs ORDER BY id DESC LIMIT 12`);
  return (
    <div className="page">
      <h1>Review queue</h1>
      <p className="lede">Machine-found items wait here until approved. Check each against its source first.</p>

      <section className="panel" style={{ padding: "var(--s4)", marginBottom: "var(--s5)" }}>
        <h3>Run an importer now</h3>
        <div className="filters">
          {[...IMPORTERS, "all"].map((n) => <form key={n} action={runImporter}><input type="hidden" name="name" value={n} /><button type="submit">{n}</button></form>)}
        </div>
        <table className="data-table" style={{ marginTop: 12 }}><tbody>
          {runs.map((r, i) => <tr key={i}><td className="mono">{r.importer}</td><td className="mono">{r.started_at.slice(0, 16)}</td><td>{r.finished_at ? (r.ok ? "done" : "failed") : "running"}</td><td className="num">{r.added}</td></tr>)}
        </tbody></table>
      </section>

      {wsCounts.length > 0 && <section style={{ marginBottom: "var(--s5)" }}>
        <h2>From the pipelines</h2>
        <p className="note">Sorted by significance, then confidence. Check both sides of the evidence before approving.</p>
        <div className="filters">
          <Link href="/review" scroll={false} aria-current={!ws ? "page" : undefined}>All ({wsCounts.reduce((a, o) => a + o.n, 0)})</Link>
          {wsCounts.map((o) => <Link key={o.source_workstream} href={`/review?ws=${o.source_workstream}`} scroll={false} aria-current={ws === o.source_workstream ? "page" : undefined}>{o.source_workstream} ({o.n})</Link>)}
        </div>
        {queued.map((r) => (
          <form key={r.id} action={decideQueued} className="panel review-item">
            <input type="hidden" name="id" value={r.id} />
            <p className="mono muted">{r.source_workstream} · {r.kind} · significance {Number(r.significance).toFixed(2)}{r.confidence != null ? ` · confidence ${Number(r.confidence).toFixed(2)}` : ""}</p>
            <p><strong>{r.title}</strong></p>
            <ul>{r.evidence.map((e: any, i: number) => <li key={i}><a href={e.url} target="_blank" rel="noreferrer">{e.label}</a>{e.archive_url && <> · <a href={e.archive_url} target="_blank" rel="noreferrer">archived</a></>}{e.date && <span className="muted"> · {e.date}</span>}</li>)}</ul>
            {r.payload?.rationale && <p className="note">Model rationale: {r.payload.rationale}</p>}
            <div className="filters" style={{ marginTop: 8 }}>
              <label>Note <input type="text" name="note" style={{ width: 260 }} /></label>
              <button name="verdict" value="approve">Approve</button>
              <button name="verdict" value="reject">Reject</button>
            </div>
          </form>
        ))}
      </section>}

      {readings.length > 0 && <section id="stances" style={{ marginBottom: "var(--s5)" }}>
        <h2>Stance readings ({readings.length})</h2>
        <p className="note">A quote reaches the Statements page only after you confirm it here. Confirm only when the quote itself takes a side on the statement. Reject it when the side must be inferred or the quote is about something else.</p>
        {readings.map((r) => (
          <form key={`${r.feed_id}-${r.topic_id}`} action={decideStance} className="panel review-item">
            <input type="hidden" name="feed_id" value={r.feed_id} />
            <input type="hidden" name="topic_id" value={r.topic_id} />
            <input type="hidden" name="machine" value={r.v} />
            <p className="mono muted"><Link href={`/node/${r.node_id}`}>{r.name}</Link> · {r.date ?? "undated"} · <a href={r.url} target="_blank" rel="noreferrer">Open the source</a>{r.archive_url && <> · <a href={r.archive_url} target="_blank" rel="noreferrer">archived</a></>}</p>
            <p><strong>Statement:</strong> {r.positive}</p>
            <p>“{r.excerpt}”</p>
            <p className="note">Model&apos;s reading: {READING.find((o) => o.value === String(r.v))?.label ?? r.v}.{r.reason ? ` ${r.reason}` : ""}</p>
            <div className="filters" style={{ marginTop: 8 }}>
              <Select label="Reading" name="answer" defaultValue={String(r.v)} options={READING} />
              <label>Note <input type="text" name="note" style={{ width: 220 }} /></label>
              <button name="verdict" value="confirm">Confirm</button>
              <button name="verdict" value="reject">Reject</button>
            </div>
          </form>
        ))}
      </section>}

      <h2>Statements from importers</h2>
      <div className="filters">
        <Link href="/review" scroll={false} aria-current={!origin ? "page" : undefined}>All ({origins.reduce((a, o) => a + o.n, 0)})</Link>
        {origins.map((o) => <Link key={o.origin} href={`/review?origin=${encodeURIComponent(o.origin)}`} scroll={false} aria-current={origin === o.origin ? "page" : undefined}>{o.origin} ({o.n})</Link>)}
      </div>

      {pending.length === 0 ? <p className="muted">Nothing waiting.</p> : <>
        <form action={bulk} id="bulk" className="filters" style={{ margin: "var(--s4) 0" }}>
          <span>Selected:</span>
          <button name="verdict" value="approve">Approve</button>
          <button name="verdict" value="reject">Reject</button>
        </form>
        {pending.map((f) => (
          <form key={f.id} action={decide} className="panel review-item">
            <input type="hidden" name="id" value={f.id} />
            <label className="mono"><input type="checkbox" name="ids" value={f.id} form="bulk" /> select</label>
            <p className="mono muted"><Link href={`/node/${f.node_id}`}>{f.name}</Link> · {f.kind} · {f.platform} · {f.origin}</p>
            <p><a href={f.url} target="_blank" rel="noreferrer">Open the source</a></p>
            <div className="grid2">
              <label>Quote (verbatim, ≤25 words)<textarea name="excerpt" defaultValue={f.excerpt ?? ""} rows={2} /></label>
              <label>Summary<textarea name="summary" defaultValue={f.summary ?? ""} rows={2} /></label>
            </div>
            <div className="filters">
              <label>Date <input type="date" name="date" defaultValue={f.date} required /></label>
              <Select label="Stance" name="stance" defaultValue={f.stance ?? ""} options={["", "support", "oppose", "mixed"].map((v) => ({ value: v, label: v || "none" }))} />
              <label>Issues <input type="text" name="issues" defaultValue={f.issues.join(", ")} /></label>
              <label>URL <input type="text" name="url" defaultValue={f.url} required style={{ width: 340 }} /></label>
            </div>
            <div className="filters" style={{ marginTop: 8 }}>
              <button name="verdict" value="approve">Approve</button>
              <button name="verdict" value="save">Save, keep pending</button>
              <button name="verdict" value="reject">Reject</button>
            </div>
          </form>
        ))}
      </>}
    </div>
  );
}
