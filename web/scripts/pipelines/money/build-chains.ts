// Build money_chains / money_hops from parsed FEC lines (money_x_fec_tx) and existing money links.
//
// Model
//  * An EDGE is one counterparty pair (giver -> receiver). Its amount is the sum of the live, non-memo filing lines between
//    them; the individual lines are kept in money_x_hop_txns, so every hop can be checked back to the filings.
//  * A CHAIN is a path of edges from a source actor to a terminal target (a candidate/race, or the last committee that
//    has no filed downstream spending). Amounts on later hops are the pool-level edge totals, NOT a trace of one donor's
//    dollars: PAC money is fungible, and the filings do not say which receipt funded which spend. The export labels this.
//  * hop_basis: disclosed = a filing line shows exactly this transfer; self_reported = the giver's own statement;
//    undisclosed = money entered an entity whose donors are not public (from_id NULL, "Undisclosed donors", amount NULL).
//  * Inferences (shared officers, LLC formation dates...) never become hops; they are queued as proposed facts.
//   tsx build-chains.ts [--reset]
import "../../env.ts";
import { pool, q } from "../../../src/lib/db.ts";
import { resolve } from "../../lib/resolve.ts";
import { enqueue } from "../../lib/review.ts";
import { TRACKED } from "./tracked.ts";

const MIN_NEW_NODE = 250_000;   // unresolved donors at or above this get a node (named exactly as filed) + a review item
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const displayName = (t: { name: string; entity_type: string | null }) => {
  if (t.entity_type === "IND" && t.name.includes(",")) { const [l, f] = t.name.split(",").map((x) => x.trim()); return titleCase(`${f} ${l}`); }
  return t.name;
};

type Tx = { id: number; committee_id: string; node_id: string; sched: string; line_code: string; entity_type: string | null; name: string; amount: string; tx_date: string | null;
  purpose: string | null; other_committee_id: string | null; candidate_id: string | null; candidate_name: string | null; support_oppose: string | null; source_url: string; file_number: string;
  employer: string | null; city: string | null; state: string | null };
type Edge = { from: string | null; fromLabel: string | null; to: string; basis: "disclosed" | "self_reported" | "undisclosed"; amount: number | null; txs: { tx?: number; link?: number; amount: number | null; date: string | null; url: string; side?: string }[];
  first: string | null; last: string | null; url: string; stance?: string | null };

async function main() {
  if (process.argv.includes("--reset")) {
    await pool.query(`DELETE FROM money_chains WHERE created_by='money'`);
  }
  const nodes = await q<{ id: string; type: string; name: string; descriptor: string | null; external_ids: any }>(`SELECT id,type,name,descriptor,external_ids FROM nodes`);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nodeByFec = new Map<string, string>();
  for (const n of nodes) for (const c of [n.external_ids?.fec].flat()) if (c) nodeByFec.set(String(c), n.id);
  const candNode = new Map<string, { node: string; race: string | null }>();
  for (const n of nodes) if (n.type === "lawmaker" && n.external_ids?.fec) candNode.set(String(n.external_ids.fec), { node: n.id, race: n.external_ids.race ?? null });
  const nk = (s: string) => { const w = s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((x) => x && !/^(jr|sr|ii|iii|dr|mr|mrs)$/.test(x)); return w.length > 1 ? `${w[0]} ${w.at(-1)}` : w[0] ?? ""; };
  const candByName = new Map<string, string>();   // only unambiguous names
  for (const n of nodes.filter((x) => x.type === "lawmaker")) { const k = nk(n.name); candByName.set(k, candByName.has(k) ? "" : n.id); }
  const links = await q<any>(`SELECT id, from_id, to_id, subtype, amount::float8 amount, date_start::text d, source_url, note FROM links WHERE type='money'`);
  const linkKey = new Map<string, any[]>();
  for (const l of links) { const k = `${l.to_id}|${l.source_url}|${l.amount}`; linkKey.set(k, [...(linkKey.get(k) ?? []), l]); }
  const dayDiff = (a: string | null, b: string | null) => (a && b ? Math.abs(Date.parse(a) - Date.parse(b)) / 864e5 : 999);
  // Organisation names as filed vs node names: compare with legal suffixes and punctuation stripped, and also against any
  // parenthetical in the node name ("Andreessen Horowitz (A16Z Capital Management, LLC)").
  const core = (s: string) => s.toUpperCase().replace(/\(FPPC[^)]*\)/g, "").replace(/[^A-Z0-9 ]/g, " ").replace(/\b(LLC|INC|LP|L P|CORP|CORPORATION|COMPANY|CO|PBC|THE)\b/g, " ").replace(/\s+/g, " ").trim();
  const orgIndex = new Map<string, string>();
  for (const n of nodes) {
    if (n.type === "person" || n.type === "lawmaker") continue;
    orgIndex.set(core(n.name), n.id);
    const par = n.name.match(/\(([^)]+)\)/); if (par) orgIndex.set(core(par[1]), n.id);
    orgIndex.set(core(n.name.replace(/\s*\([^)]*\)\s*$/, "")), n.id);
    for (const a of [n.external_ids?.fec_names ?? []].flat()) orgIndex.set(core(String(a)), n.id);
  }

  const live = await q<Tx>(`SELECT id, committee_id, node_id, sched, line_code, entity_type, name, amount::text, tx_date::text, purpose, other_committee_id, candidate_id, candidate_name, support_oppose, source_url::text, file_number, employer, city, state
    FROM money_x_fec_tx WHERE NOT superseded AND NOT memo AND node_id IS NOT NULL ORDER BY tx_date, id`);

  const edges = new Map<string, Edge>();
  const addTx = (key: string, base: Omit<Edge, "txs" | "first" | "last" | "amount">, t: { tx?: number; link?: number; amount: number | null; date: string | null; url: string; side?: string }) => {
    const e = edges.get(key) ?? { ...base, amount: 0, txs: [], first: null, last: null };
    e.txs.push(t); e.amount = (e.amount ?? 0) + (t.amount ?? 0);
    if (t.date && (!e.first || t.date < e.first)) e.first = t.date;
    if (t.date && (!e.last || t.date > e.last)) e.last = t.date;
    edges.set(key, e);
  };
  const stats = { disclosed_lines: 0, skipped_small: 0, queued: 0, newNodes: 0, unmatched_ie: 0 };
  const seenNew = new Map<string, string>();

  for (const t of live) {
    const amt = Number(t.amount);
    // SA15/SA17 are "offsets" and "other receipts". Super PACs also receive nonprofit money there (Public First Action's gifts to its sister
    // PACs are SA17), so those lines count when they are not interest, refunds, rebates or in-kind staff time, and only when the giver is a known node.
    const otherReceipt = /^SA1[57]/.test(t.line_code) && !/interest|refund|rebate|reimburs|offset|dividend|void|return|in-kind|credit/i.test(t.purpose ?? "");
    if (t.sched === "A" && (/^SA(11|12)/.test(t.line_code) || otherReceipt) && amt > 0) {
      // Who gave? 1) the curated link for this very line, 2) the donor committee's id, 3) resolve(), 4) a new node for large gifts.
      let from: string | null = null;
      const lk = (linkKey.get(`${t.node_id}|${t.source_url}|${amt}`) ?? []).find((l) => dayDiff(l.d, t.tx_date) <= 7);
      if (process.env.DEBUG_EDGE && t.name.toLowerCase().includes(process.env.DEBUG_EDGE)) console.log("DBG", t.name, t.node_id, t.source_url, amt, t.tx_date, !!lk, linkKey.get(`${t.node_id}|${t.source_url}|${amt}`)?.length);
      if (lk) from = lk.from_id;
      else if (t.entity_type !== "IND" && orgIndex.has(core(t.name)) && core(t.name).length > 3) from = orgIndex.get(core(t.name))!;
      else if (t.other_committee_id && nodeByFec.has(t.other_committee_id)) from = nodeByFec.get(t.other_committee_id)!;
      if (!from) {
        const type = t.entity_type === "IND" ? "person" : /PAC|COM|CCM|PTY/.test(t.entity_type ?? "") ? "pac" : "investor";
        const nm = displayName(t);
        const r = await resolve({ type: type as any, name: nm });
        if (r.exists && !r.provisional) from = r.id;
        else if (amt >= MIN_NEW_NODE && !otherReceipt) {
          const id = seenNew.get(nm) ?? (r.exists ? null : r.id);
          if (r.exists && r.provisional) {
            // A person matched on name only: hold in review, make no hop (CONTRACTS §2).
            await enqueue({ workstream: "money", kind: "money_hop", refTable: "money_x_fec_tx", refId: t.id,
              title: `Name-only donor match: "${nm}" gave ${fmt(amt)} to ${byId.get(t.node_id)!.name}`,
              payload: { rationale: `FEC line names "${nm}"; the only node with that name is ${r.id} (${r.matchedBy}). Not enough to credit the gift to that node.`, candidate_node: r.id, employer: t.employer, city: t.city, state: t.state, amount: amt },
              evidence: [{ label: "FEC filing line", url: t.source_url, date: t.tx_date }], confidence: 0.5, significance: Math.min(1, amt / 1e7) });
            stats.queued++; continue;
          }
          if (id) {
            if (!byId.has(id)) {
              await pool.query(`INSERT INTO nodes (id,type,name,descriptor,cluster,source_url) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
                [id, type === "person" ? "person" : type === "pac" ? "pac" : "investor", nm, `Named on FEC filings as a donor to ${byId.get(t.node_id)!.name}. Created by the money pipeline; identity not yet reviewed.`, type === "person" ? "other-investors" : "other-investors", t.source_url]);
              byId.set(id, { id, type: type === "person" ? "person" : type === "pac" ? "pac" : "investor", name: nm, descriptor: null, external_ids: {} });
              stats.newNodes++;
              await enqueue({ workstream: "money", kind: "node", refTable: "nodes", refId: id, title: `New donor node: ${nm} (${fmt(amt)} to ${byId.get(t.node_id)!.name})`,
                payload: { rationale: "Named exactly as filed; created so the hop can be shown. Needs identity review (who is this donor?).", employer: t.employer, state: t.state },
                evidence: [{ label: "FEC filing line", url: t.source_url, date: t.tx_date }], confidence: 0.6, significance: Math.min(1, amt / 1e7) });
            }
            seenNew.set(nm, id); from = id;
          }
        } else { stats.skipped_small++; continue; }
        if (!from && otherReceipt) { stats.skipped_small++; continue; }
      }
      if (!from || from === t.node_id) continue;
      addTx(`${from}|${t.node_id}|d`, { from, fromLabel: null, to: t.node_id, basis: "disclosed", url: t.source_url }, { tx: t.id, link: lk?.id, amount: amt, date: t.tx_date, url: t.source_url, side: "A" });
      stats.disclosed_lines++;
    } else if (t.sched === "B" && /^SB(23|29)/.test(t.line_code) && amt > 0) {
      let to: string | null = null;
      const lk = links.find((l) => l.from_id === t.node_id && l.source_url === t.source_url && Math.abs(l.amount - amt) < 0.01 && dayDiff(l.d, t.tx_date) <= 7);
      if (lk) to = lk.to_id;
      else if (t.entity_type !== "IND" && orgIndex.has(core(t.name)) && core(t.name).length > 3) to = orgIndex.get(core(t.name))!;
      else if (t.other_committee_id && nodeByFec.has(t.other_committee_id)) to = nodeByFec.get(t.other_committee_id)!;
      else { const r = await resolve({ type: "pac", name: t.name }); if (r.exists && !r.provisional) to = r.id; }
      if (!to) {
        if (amt >= 100_000) { await enqueue({ workstream: "money", kind: "money_hop", refTable: "money_x_fec_tx", refId: t.id, title: `Unmatched recipient "${t.name}" got ${fmt(amt)} from ${byId.get(t.node_id)!.name}`,
          payload: { rationale: "Disbursement line with no matching node.", purpose: t.purpose, state: t.state }, evidence: [{ label: "FEC filing line", url: t.source_url, date: t.tx_date }], confidence: 0.5, significance: Math.min(1, amt / 1e7) }); stats.queued++; }
        continue;
      }
      if (to === t.node_id) continue;
      addTx(`${t.node_id}|${to}|d`, { from: t.node_id, fromLabel: null, to, basis: "disclosed", url: t.source_url }, { tx: t.id, link: lk?.id, amount: amt, date: t.tx_date, url: t.source_url, side: "B" });
    } else if (t.sched === "E" && amt > 0) {
      const c = t.candidate_id ? candNode.get(t.candidate_id) : null;
      const lk = links.find((l) => l.from_id === t.node_id && l.source_url === t.source_url && Math.abs(l.amount - amt) < 0.01 && dayDiff(l.d, t.tx_date) <= 7 && byId.get(l.to_id)?.type === "lawmaker");
      const nameHit = t.candidate_name ? candByName.get(nk(t.candidate_name.includes(",") ? t.candidate_name.split(",").reverse().join(" ") : t.candidate_name)) : null;
      const to = lk?.to_id ?? c?.node ?? (!t.candidate_id && nameHit ? nameHit : null);
      if (!to) { stats.unmatched_ie++; continue; }
      addTx(`${t.node_id}|${to}|d|${t.support_oppose ?? ""}`, { from: t.node_id, fromLabel: null, to, basis: "disclosed", url: t.source_url, stance: t.support_oppose === "S" ? "support" : t.support_oppose === "O" ? "oppose" : null },
        { tx: t.id, link: lk?.id, amount: amt, date: t.tx_date, url: t.source_url });
    }
  }

  // Self-reported gifts into tracked committees' networks: the giver's own announcement (company/person site).
  const trackedNodes = new Set(TRACKED.map((t) => t.node).concat(["public-first-action"]));
  for (const l of links) {
    if (!trackedNodes.has(l.to_id) || /docquery\.fec\.gov|lda\.gov/.test(l.source_url) || !l.amount) continue;
    const from = byId.get(l.from_id);
    const host = new URL(l.source_url).hostname.replace(/^www\./, "");
    const ownSite = from && slug(from.name).split("-")[0].length > 2 && host.includes(slug(from.name).split("-")[0]);
    if (ownSite) addTx(`${l.from_id}|${l.to_id}|s`, { from: l.from_id, fromLabel: null, to: l.to_id, basis: "self_reported", url: l.source_url }, { link: l.id, amount: l.amount, date: l.d, url: l.source_url });
    else await enqueue({ workstream: "money", kind: "money_hop", refTable: "links", refId: l.id, title: `Press-reported gift: ${from?.name} → ${byId.get(l.to_id)?.name} ${fmt(l.amount)} (not a filing or the giver's own statement)`,
      payload: { rationale: "Secondary reporting only. hop_basis cannot be 'disclosed' or 'self_reported' without a filing or the giver's own statement; held out of money_hops.", note: l.note }, evidence: [{ label: "Source", url: l.source_url, date: l.d }], confidence: 0.6, significance: Math.min(1, l.amount / 1e8) });
  }
  // Press-reported gifts to the AI PACs from links whose recipient is tracked or a Meta PAC (ATEP, California committees): queue.
  for (const l of links) {
    if (trackedNodes.has(l.to_id)) continue;
    if (!["american-technology-excellence-project", "mobilizing-economic-transformation-across-california", "california-leads"].includes(l.to_id)) continue;
    await enqueue({ workstream: "money", kind: "money_hop", refTable: "links", refId: l.id, title: `Press-reported gift: ${byId.get(l.from_id)?.name} → ${byId.get(l.to_id)?.name} ${fmt(l.amount ?? 0)}`,
      payload: { rationale: "Reported by NYT via GV Wire; ATEP's IRS 8872 and Cal-Access filings not yet retrieved (see data/gaps.md). Not stored as a hop.", note: l.note }, evidence: [{ label: "Source", url: l.source_url, date: l.d }], confidence: 0.6, significance: 0.8 });
    stats.queued++;
  }

  // The same transfer between two tracked committees appears twice: as a disbursement (Schedule B) at the giver and as a receipt (Schedule A)
  // at the receiver. Pair each disbursement line with at most ONE receipt line of the same amount within 7 days and keep the receipt copy.
  // Unpaired lines stay: separate gifts of equal amounts are real and are never merged with each other.
  for (const e of edges.values()) {
    const A = e.txs.filter((t) => t.side === "A"), B = e.txs.filter((t) => t.side === "B");
    if (!A.length || !B.length) continue;
    const used = new Set<number>(); const keep = [...e.txs.filter((t) => t.side !== "B")];
    for (const b of B) {
      const i = A.findIndex((a, k) => !used.has(k) && Math.abs((a.amount ?? 0) - (b.amount ?? 0)) < 0.01 && dayDiff(a.date, b.date) <= 7);
      if (i >= 0) used.add(i); else keep.push(b);
    }
    e.txs = keep; e.amount = keep.reduce((a, t) => a + (t.amount ?? 0), 0);
    const ds = keep.map((t) => t.date).filter(Boolean).sort() as string[]; e.first = ds[0] ?? null; e.last = ds.at(-1) ?? null;
  }

  // Undisclosed upstream: an intermediary that is not a person/company/lab/PAC (a 501(c)(4) or other nonprofit) whose donors are not public.
  // Only entities that are KNOWN to keep donors private get the placeholder (a 501(c)(4)/(c)(3)/(c)(6) per the node's own sourced descriptor).
  // Other nonprofit-typed nodes whose legal status isn't recorded (527s and PACs disclose donors on Form 8872 / FEC) are queued for a status check instead.
  const opaque = (id: string) => /501\(c\)\(\d+\)/.test(nodes.find((n) => n.id === id)?.descriptor ?? "");
  const nonDisc = opaque;
  for (const id of new Set([...edges.values()].map((e) => e.from).filter((x): x is string => !!x))) {
    const n = byId.get(id);
    if (n && (n.type === "nonprofit" || n.type === "funder") && !opaque(id))
      await enqueue({ workstream: "money", kind: "node", refTable: "nodes", refId: `${id}:legal-status`, title: `Check legal status of ${n.name}: donors are public only if it is a PAC or 527`,
        payload: { node: id, rationale: "Gave to a tracked committee. If it files with the FEC (PAC) or the IRS Form 8872 (527), its donors are public and the chain can be traced further; if it is a 501(c)(4)/(c)(3) its donors are undisclosed and a placeholder hop must be added." },
        evidence: [{ label: "Filing that shows the gift", url: [...edges.values()].find((e) => e.from === id)!.url }], confidence: 0.5, significance: 0.4 });
  }
  for (const e of [...edges.values()]) {
    const f = e.from;
    if (!f || !nonDisc(f)) continue;
    const key = `undisclosed|${f}`;
    if (edges.has(key)) continue;
    const t = e.txs.find((x) => x.tx) ?? e.txs[0];
    edges.set(key, { from: null, fromLabel: "Undisclosed donors", to: f, basis: "undisclosed", amount: null, txs: [{ amount: null, date: t.date, url: t.url }], first: t.date, last: t.date, url: t.url });
  }

  console.log("edges", edges.size, stats);
  if (process.env.DEBUG_EDGE) console.log([...edges.keys()].filter((k) => k.includes(process.env.DEBUG_EDGE!))); if (process.env.DEBUG_EDGE) { await pool.end(); return; }
  await persist(edges, byId);
  await pool.end();
}

async function persist(edges: Map<string, Edge>, byId: Map<string, any>) {
  // Adjacency over non-undisclosed edges.
  const all = [...edges.values()];
  const out = new Map<string, Edge[]>(), inn = new Map<string, Edge[]>();
  for (const e of all) { if (e.from) { out.set(e.from, [...(out.get(e.from) ?? []), e]); } inn.set(e.to, [...(inn.get(e.to) ?? []), e]); }
  const isTerminalType = (id: string) => ["lawmaker", "race", "bill"].includes(byId.get(id)?.type);
  const roots = new Set<string>();
  for (const e of all) { if (e.from && !(inn.get(e.from) ?? []).some((x) => x.from !== null || x.basis === "undisclosed")) roots.add(e.from); }
  for (const e of all) if (e.from && inn.get(e.from)?.every((x) => x.basis === "undisclosed")) roots.add(e.from); // c4 whose only upstream is the placeholder
  // Roots that only have undisclosed upstream: start the chain at the placeholder.
  const paths: Edge[][] = [];
  const walk = (node: string, path: Edge[], seen: Set<string>) => {
    const nexts = (out.get(node) ?? []).filter((e) => !seen.has(e.to));
    if (!nexts.length || isTerminalType(node)) { if (path.length) paths.push(path); return; }
    for (const e of nexts) walk(e.to, [...path, e], new Set([...seen, e.to]));
  };
  for (const r of roots) walk(r, [], new Set([r]));
  // Undisclosed-rooted variants: for each root with an undisclosed placeholder, also emit paths starting at the placeholder.
  const undisc = all.filter((e) => e.basis === "undisclosed");
  const full: Edge[][] = [];
  for (const p of paths) {
    const first = p[0].from!;
    const u = undisc.find((x) => x.to === first);
    full.push(p);
    if (u) full.push([u, ...p]);
  }
  // Standalone undisclosed -> c4 chains with no downstream path are impossible here (they exist because of downstream edges).
  const keyOf = (p: Edge[]) => p.map((e) => `${e.from ?? "U"}>${e.to}${e.basis[0]}`).join("|");
  const uniq = new Map(full.map((p) => [keyOf(p), p]));
  console.log("roots", roots.size, "paths", uniq.size);

  const network = (id: string) => TRACKED.find((t) => t.node === id)?.network ?? null;
  const archives = new Map((await q<{ url: string; archive_url: string }>(`SELECT url, archive_url FROM archives WHERE archive_url IS NOT NULL`)).map((r) => [r.url, r.archive_url]));
  let nChains = 0, nHops = 0;
  const hopIdByEdge = new Map<string, number>();
  for (const p of uniq.values()) {
    const src = p[0].from ?? p[0].to, tgt = p[p.length - 1].to;
    const label = p.map((e) => (e.from ? byId.get(e.from)?.name : "Undisclosed donors")).concat(byId.get(tgt)?.name).join(" → ");
    const c = await pool.query(`INSERT INTO money_chains (source_node, target_node, label) VALUES ($1,$2,$3) RETURNING id`, [src, tgt, label.slice(0, 500)]);
    const cid = c.rows[0].id;
    let disc = 0, self = 0, hasU = false;
    for (const [i, e] of p.entries()) {
      const single = e.txs.length === 1;
      const date = single ? e.txs[0].date : e.last;
      const prec = e.basis === "undisclosed" ? "day" : "day";
      const h = await pool.query(`INSERT INTO money_hops (chain_id, seq, from_id, from_label, to_id, amount, date, date_prec, hop_basis, source_url, archive_url, filing_id, link_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [cid, i + 1, e.from, e.from ? null : e.fromLabel, e.to, e.amount, date, prec, e.basis, e.url, archives.get(e.url) ?? null,
          e.url.match(/forms\/C\d+\/(\d+)/)?.[1] ?? null, single ? e.txs[0].link ?? null : null]);
      const hid = h.rows[0].id; nHops++;
      await pool.query(`INSERT INTO money_x_hop_txns (hop_id, tx_id, link_id, amount, tx_date, source_url, archive_url)
        SELECT $1, * FROM unnest($2::bigint[], $3::bigint[], $4::numeric[], $5::date[], $6::text[], $7::text[])`,
        [hid, e.txs.map((t) => t.tx ?? null), e.txs.map((t) => t.link ?? null), e.txs.map((t) => t.amount), e.txs.map((t) => t.date), e.txs.map((t) => t.url), e.txs.map((t) => archives.get(t.url) ?? null)]);
      if (i === 0 && e.basis === "disclosed") disc += e.amount ?? 0;
      if (i === 0 && e.basis === "self_reported") self += e.amount ?? 0;
      if (e.basis === "undisclosed") hasU = true;
    }
    const first = p[0];
    await pool.query(`INSERT INTO money_x_chain_meta (chain_id, network, origin_kind, disclosed_amount, self_reported_amount, undisclosed_amount, has_undisclosed) VALUES ($1,$2,$3,$4,$5,NULL,$6)`,
      [cid, network(p.find((e) => network(e.to))?.to ?? "") ?? network(first.to) ?? null, first.basis === "undisclosed" ? "undisclosed" : byId.get(first.from!)?.type === "person" ? "person" : "organization", disc, self, hasU]);
    nChains++;
  }
  console.log({ nChains, nHops });
}
main();
