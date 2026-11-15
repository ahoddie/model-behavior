// Say-vs-do detector over the live database. Reads sd_positions, sd_money_edges, sd_ie, sd_bill_sponsors, sd_bill_versions,
// writes conflict_flags (status pending) and puts each one in the review queue. Nothing goes live until a reviewer approves.
// Usage: pnpm say-do:run [--dry] [--types 1,2,3,4] [--limit N]
import "../../env.ts";
import { pool, q } from "../../../src/lib/db.ts";
import { detectServer } from "../../lib/llm.ts";
import { gatePair, describeType1, findMoneyPaths, gateMoney, describeType2, gateReversal, describeType4, assertNeutral, severityFor, versionLabel,
  type Pos, type Version, type Edge, type IE, type Sponsor, type Event, type Ev, type MoneyPath, type Prec } from "./core.ts";
import { judgePair } from "./judge.ts";
import { store, DRY, type Cand } from "./store.ts";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const TYPES = (arg("--types") ?? "1,2,4").split(",").map(Number);
const LIMIT = Number(arg("--limit") ?? 0);

const toEv = (p: Pos): Ev => ({ label: p.text.slice(0, 200), url: p.url, archive_url: p.archive_url, date: p.date, ref_table: p.ref_table, ref_id: p.ref_id });

export async function loadInputs() {
  const pos = await q<any>(`
    SELECT p.ref_table, p.ref_id, p.actor_id, a.name AS actor_name, p.target_id, t.name AS target_label, t.type AS target_type, p.stance,
           p.date::text AS date, p.date_prec, p.channel, p.kind, coalesce(p.excerpt, p.text, '') AS text, p.url, p.archive_url
    FROM sd_positions p JOIN nodes a ON a.id=p.actor_id JOIN nodes t ON t.id=p.target_id`);
  const versions = await q<Version>(`SELECT target_id, label, effective_from::text, substantive_change FROM sd_bill_versions ORDER BY effective_from`);
  const sponsors = await q<Sponsor>(`SELECT s.target_id, s.lawmaker_id, n.name AS lawmaker_name, s.role, s.source_url, s.archive_url FROM sd_bill_sponsors s JOIN nodes n ON n.id=s.lawmaker_id`);
  const edges = await q<any>(`SELECT ref_table, ref_id, from_id, to_id, amount::float8 AS amount, date::text AS date, date_prec, subtype, source_url AS url, archive_url FROM sd_money_edges`);
  const ies = await q<any>(`SELECT ref_id, spender_id, candidate_id, stance, amount::float8 AS amount, date::text AS date, date_prec, source_url AS url, archive_url FROM sd_ie`);
  const names = Object.fromEntries((await q<any>(`SELECT id, name FROM nodes`)).map((n) => [n.id, n.name]));
  const receipts: Record<string, number> = {};
  for (const e of edges) receipts[e.to_id] = (receipts[e.to_id] ?? 0) + e.amount;
  const lobbyLinks = await q<any>(`SELECT l.id::text AS id, l.from_id, l.to_id, l.date_start::text AS date, l.date_start_prec AS date_prec, l.source_url AS url, l.archive_url FROM links l WHERE l.type='money' AND l.subtype='lobbying' AND l.to_id IN (SELECT id FROM nodes WHERE type IN ('bill','rule'))`);
  return { pos: pos as Pos[], versions, sponsors, edges: edges as Edge[], ies: ies as IE[], names, receipts, lobbyLinks };
}
type Inputs = Awaited<ReturnType<typeof loadInputs>>;

const confidence = (agree: number, version: string, formal: boolean) =>
  Math.min(0.95, 0.6 + 0.1 * agree + (version === "same" ? 0.1 : 0) + (formal ? 0.05 : 0));

// ---- type 1 ---------------------------------------------------------------------------------------------------------
export async function detectType1(inp: Inputs): Promise<Cand[]> {
  const out: Cand[] = [];
  const by = new Map<string, Pos[]>();
  for (const p of inp.pos) (by.get(`${p.actor_id}|${p.target_id}`) ?? by.set(`${p.actor_id}|${p.target_id}`, []).get(`${p.actor_id}|${p.target_id}`)!).push(p);
  for (const group of by.values()) {
    const saids = group.filter((p) => p.channel === "said"), dids = group.filter((p) => p.channel === "did");
    for (const s of saids) for (const d of dids) {
      const vs = inp.versions.filter((v) => v.target_id === s.target_id);
      const g = gatePair(s, d, vs);
      if (!g.ok) continue;
      const verdict = await judgePair(s, d, versionLabel(vs, s.date));
      if (!verdict.flag) continue;
      const description = assertNeutral(describeType1(s, d));
      out.push({ type: "statement_vs_action", key: `t1:${s.ref_table}:${s.ref_id}:${d.ref_table}:${d.ref_id}`, node_id: s.actor_id, target_id: s.target_id,
        severity: severityFor("statement_vs_action", d.kind), confidence: confidence(2, g.version, d.kind === "letter" || d.kind === "docket comment"),
        description, rationale: `Same proposition: ${verdict.same.reason} Opposite positions: ${verdict.conflict.reason} Version check: ${g.version}${g.version === "unknown" ? " (no version history loaded for this target)" : ""}. Gap ${g.gap_days} days.`,
        said: [toEv(s)], did: [toEv(d)], meta: { same: verdict.same.meta, conflict: verdict.conflict.meta, version_check: g.version } });
    }
  }
  return out;
}

// ---- type 2 ---------------------------------------------------------------------------------------------------------
export function detectType2(inp: Inputs): Cand[] {
  const out: Cand[] = [];
  const saids = inp.pos.filter((p) => p.channel === "said" && (p.stance === "support" || p.stance === "oppose"));
  const actors = new Set(saids.map((s) => s.actor_id));
  for (const actor of actors) {
    const paths = findMoneyPaths(actor, inp.edges, inp.ies, inp.sponsors);
    for (const s of saids.filter((x) => x.actor_id === actor)) for (const p of paths) {
      if (!gateMoney(s, p).ok) continue;
      const mp: MoneyPath = { hops: p.hops, ie: p.ie, sponsor: p.sponsor, names: inp.names, receipts: inp.receipts };
      const description = assertNeutral(describeType2(s, mp));
      const hopEv: Ev[] = p.hops.map((h) => ({ label: `${inp.names[h.from_id]} to ${inp.names[h.to_id]}: $${Math.round(h.amount).toLocaleString("en-US")}`, url: h.url, archive_url: h.archive_url, date: h.date, ref_table: h.ref_table, ref_id: h.ref_id }));
      const ieEv: Ev = { label: `${inp.names[p.ie.spender_id]} independent expenditures ${p.ie.stance === "oppose" ? "opposing" : "supporting"} ${p.sponsor.lawmaker_name}`, url: p.ie.url, archive_url: p.ie.archive_url, date: p.ie.date, ref_table: "links", ref_id: p.ie.ref_id };
      const spEv: Ev = { label: `${p.sponsor.lawmaker_name}, ${p.sponsor.role} of ${s.target_label}`, url: p.sponsor.source_url, archive_url: p.sponsor.archive_url, date: null };
      out.push({ type: "statement_vs_money", key: `t2:${s.ref_table}:${s.ref_id}:${p.hops.map((h) => h.ref_id).join("-")}:${p.ie.ref_id}:${p.sponsor.lawmaker_id}`, node_id: actor, target_id: s.target_id,
        severity: severityFor("statement_vs_money"), confidence: Math.max(0.5, 0.85 - 0.1 * (p.hops.length - 1)),
        description, rationale: `Path of ${p.hops.length} disclosed transfer(s) from the speaker to the spender. The record shows money moved and was spent; it does not show who directed the spending. Statement stance: ${s.stance}.`,
        said: [toEv(s)], did: [...hopEv, ieEv, spEv], meta: { hops: p.hops.length } });
    }
  }
  return out;
}

// ---- type 4 ---------------------------------------------------------------------------------------------------------
export function detectType4(inp: Inputs): Cand[] {
  const out: Cand[] = [];
  const by = new Map<string, Pos[]>();
  for (const p of inp.pos) if (p.date) (by.get(`${p.actor_id}|${p.target_id}`) ?? by.set(`${p.actor_id}|${p.target_id}`, []).get(`${p.actor_id}|${p.target_id}`)!).push(p);
  for (const group of by.values()) {
    group.sort((a, b) => a.date!.localeCompare(b.date!));
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const e = group[i], l = group[j];
      const events = eventsFor(inp, e.actor_id, e.target_id);
      for (const ev of events) {
        const g = gateReversal(e, l, ev, inp.versions.filter((v) => v.target_id === e.target_id));
        if (!g.ok) continue;
        out.push({ type: "reversal_near_event", key: `t4:${e.ref_table}:${e.ref_id}:${l.ref_table}:${l.ref_id}:${ev.ref_table}:${ev.ref_id}`, node_id: e.actor_id, target_id: e.target_id,
          severity: 1, confidence: 0.6, description: assertNeutral(describeType4(e, l, ev)),
          rationale: `Stance changed between the two dates; event ${g.days} days from the later stance. Dates only; no claim that one led to the other.`,
          said: [toEv(e), toEv(l)], did: [{ label: ev.summary, url: ev.url, archive_url: ev.archive_url, date: ev.date, ref_table: ev.ref_table, ref_id: ev.ref_id }], meta: { days: g.days } });
      }
    }
  }
  return out;
}
/** Events tied to the same target: the actor's lobbying link to it, or money from the actor to a spender that spent on its sponsors. */
function eventsFor(inp: Inputs, actor: string, target: string): Event[] {
  const evs: Event[] = [];
  for (const x of inp.lobbyLinks) if (x.from_id === actor && x.to_id === target && x.date) evs.push({ kind: "lobbying", date: x.date, date_prec: x.date_prec, summary: `its lobbying filing lists ${inp.names[target]}`, url: x.url, archive_url: x.archive_url, ref_table: "links", ref_id: x.id });
  const sp = new Set(inp.sponsors.filter((s) => s.target_id === target).map((s) => s.lawmaker_id));
  for (const p of findMoneyPaths(actor, inp.edges, inp.ies, inp.sponsors).filter((p) => sp.has(p.sponsor.lawmaker_id))) {
    const h = p.hops[0];
    if (h.date) evs.push({ kind: "funding", date: h.date, date_prec: h.date_prec, summary: `${inp.names[h.from_id]} gave $${Math.round(h.amount).toLocaleString("en-US")} to ${inp.names[h.to_id]}`, url: h.url, archive_url: h.archive_url, ref_table: h.ref_table, ref_id: h.ref_id });
  }
  return evs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const started = Date.now();
  const inp = await loadInputs();
  const stats: Record<string, number> = { positions: inp.pos.length, sponsors: inp.sponsors.length, new: 0, exists: 0 };
  if (TYPES.includes(1) || TYPES.includes(2) || TYPES.includes(4)) await detectServer().catch((e) => { console.error(String(e)); });
  let cands: Cand[] = [];
  if (TYPES.includes(1)) cands.push(...await detectType1(inp));
  if (TYPES.includes(2)) cands.push(...detectType2(inp));
  if (TYPES.includes(4)) cands.push(...detectType4(inp));
  if (LIMIT) cands = cands.slice(0, LIMIT);
  for (const c of cands) { const r = await store(c); stats[r]++; stats[c.type] = (stats[c.type] ?? 0) + 1; console.log(`${r}\t${c.type}\t${c.confidence.toFixed(2)}\t${c.description}`); }
  if (!DRY) await pool.query(`INSERT INTO sd_runs (finished_at, stats) VALUES (now(), $1)`, [JSON.stringify({ ...stats, seconds: Math.round((Date.now() - started) / 1000) })]);
  console.log(stats);
  await pool.end();
}
