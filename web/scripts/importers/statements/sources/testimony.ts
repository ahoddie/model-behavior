// Congressional testimony from GovInfo (published hearing transcripts, collection CHRG). Hearings are found with the GovInfo search service
// (needs DATA_GOV_KEY; DEMO_KEY allows about 30 calls an hour, so searches are few and results are cached by cursor) and read from the
// public govinfo.gov text page, which needs no key. State legislature video archives have no common feed: logged in data/gaps.md.
// A turn is attributed to a watchlist person only when their full name appears in the hearing text and no other watchlist person in
// that hearing shares the surname. The statement date is the hearing date printed in the transcript, never the print date.
import { pool, q } from "../../../../src/lib/db.ts";
import { politeFetch, sleep } from "../../../lib/ingest.ts";
import { loadWatchlist, nameRe, processDoc, type Doc, type Person } from "../pipeline.ts";
import { FLOOR, emptyStats, type Stats } from "./bluesky.ts";
import { fetchPage } from "../textutil.ts";

const KEY = () => process.env.DATA_GOV_KEY ?? "DEMO_KEY";
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const DATE_RE = new RegExp(`(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\\s+(${MONTHS})\\s+(\\d{1,2}),\\s+(\\d{4})`, "i");
const TURN = /(?:^|\n)[ \t]*(?:Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.|Senator|Chairman|Chairwoman|Chair|Ranking Member|Representative|Secretary|General|Admiral|Commissioner|Director|Judge)[ \t]+([A-Z][A-Za-z'’-]+(?:[ \t]+[A-Z][A-Za-z'’-]+)?)\.[ \t]/g;

export function hearingDate(text: string): string | null {
  const m = text.slice(0, 6000).match(DATE_RE);
  if (!m) return null;
  const d = new Date(`${m[1]} ${m[2]}, ${m[3]} 12:00:00 UTC`);
  return isNaN(+d) ? null : d.toISOString().slice(0, 10);
}

export function witnessTurns(text: string, people: Person[]): { person: Person; text: string }[] {
  const named = people.filter((p) => nameRe(p.name).test(text));
  const bySurname = new Map<string, Person[]>();
  for (const p of named) { const s = p.name.replace(/\s*\(.*?\)/g, "").trim().split(/\s+/).at(-1)!.toLowerCase(); bySurname.set(s, [...(bySurname.get(s) ?? []), p]); }
  const starts = [...text.matchAll(TURN)].map((m) => ({ at: m.index! + (m[0].startsWith("\n") ? 1 : 0), end: m.index! + m[0].length, label: m[1] }));
  const out: { person: Person; text: string }[] = [];
  for (const [i, t] of starts.entries()) {
    const cands = bySurname.get(t.label.trim().split(/\s+/).at(-1)!.toLowerCase());
    if (cands?.length !== 1) continue;
    const body = text.slice(t.end, starts[i + 1]?.at ?? t.end + 6000).replace(/\s+/g, " ").trim();
    if (body.length > 200) out.push({ person: cands[0], text: body.slice(0, 6000) });
  }
  return out;
}

export async function pollTestimony(opts: { maxHearings?: number } = {}): Promise<Stats> {
  const st = emptyStats();
  const people = await loadWatchlist();
  const queries = [
    `collection:CHRG AND title:("artificial intelligence") AND publishdate:range(${FLOOR},)`,
    `collection:CHRG AND title:(chatbots OR "frontier" OR "AI" OR algorithmic OR deepfakes OR "export controls" OR semiconductors) AND publishdate:range(${FLOOR},)`,
  ];
  const hearings = new Map<string, { id: string; title: string }>();
  for (const query of queries) {
    const [c] = await q<{ done: boolean }>(`SELECT done FROM stmt_cursors WHERE source='testimony_search' AND key=$1 AND updated_at > now() - interval '7 days'`, [query]);
    if (c?.done) continue;
    const r = await politeFetch(`https://api.govinfo.gov/search?api_key=${KEY()}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, pageSize: 100, offsetMark: "*", sorts: [{ field: "publishdate", sortOrder: "DESC" }], historical: true, resultLevel: "default" }) });
    if (!r.ok) { console.log(`testimony: govinfo search ${r.status}${r.status === 429 ? " (rate limited; DEMO_KEY allows ~30/hour). Retry later." : ""}`); continue; }
    for (const x of ((await r.json()).results ?? []) as any[]) hearings.set(x.packageId, { id: x.packageId, title: x.title });
    await pool.query(`INSERT INTO stmt_cursors (source,key,done) VALUES ('testimony_search',$1,true) ON CONFLICT (source,key) DO UPDATE SET done=true, updated_at=now()`, [query]);
  }
  // Hearings found earlier but not yet read are picked up from the cursor table.
  for (const h of hearings.values()) await pool.query(`INSERT INTO stmt_cursors (source,key,cursor,done) VALUES ('testimony_hearing',$1,$2,false) ON CONFLICT DO NOTHING`, [h.id, h.title]);
  const todo = await q<{ key: string; cursor: string }>(`SELECT key, cursor FROM stmt_cursors WHERE source='testimony_hearing' AND NOT done LIMIT $1`, [opts.maxHearings ?? 25]);
  for (const h of todo) {
    const url = `https://www.govinfo.gov/content/pkg/${h.key}/html/${h.key}.htm`;
    const page = await fetchPage(url);
    if (page) {
      const date = hearingDate(page.text);
      if (date && date >= FLOOR) {
        const turns = witnessTurns(page.text, people);
        for (const person of new Map(turns.map((t) => [t.person.id, t.person])).values()) {
          const mine = turns.filter((t) => t.person.id === person.id);
          const doc: Doc = { source: "testimony", platform: "govinfo.gov", kind: "testimony", url, date, text: "", turns: mine };
          doc.text = mine.map((t) => t.text).join("\n");
          const r = await processDoc(doc);
          st.docs++; st.stored += r.stored; st.duplicates += r.duplicates; st.dropped += r.dropped;
        }
      }
      await pool.query(`UPDATE stmt_cursors SET done=true, updated_at=now() WHERE source='testimony_hearing' AND key=$1`, [h.key]);
    }
    await sleep(800);
  }
  return st;
}
