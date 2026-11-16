// Shared write path for the research loader and every importer.
// Enforces §0: no row without a URL, quotes ≤25 words, no trade groups beyond the two allowed.
import "../env.ts";
import { pool } from "../../src/lib/db.ts";

export const TRADE_GROUPS = [
  "chamber of progress", "netchoice", "technet", "ccia", "computer & communications industry", "bsa", "software alliance",
  "consumer technology association", "information technology industry council", "iti", "chamber of commerce", "california chamber",
  "silicon valley leadership group", "internet association"
];
// American Edge is listed in §3 as an advocacy group, so it is allowed explicitly.
// Chamber of Progress and CCIA were added by hand on 2026-11-16 (cluster trade-associations). NetChoice, TechNet, and the
// U.S. Chamber of Commerce were removed the same day; they and every other trade group are rejected.
const ALLOW = new Set(["american-edge", "american edge project", "chamber-of-progress", "ccia"]);

export function isTradeGroup(name: string, id = ""): boolean {
  if (ALLOW.has(id) || ALLOW.has(name.toLowerCase())) return false;
  const n = name.toLowerCase();
  return TRADE_GROUPS.some((t) => n === t || n.includes(t) && t.length > 4);
}

export const isUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\/\S+$/.test(u.trim());
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const NODE_TYPES = new Set(["lab", "person", "investor", "think_tank", "pac", "nonprofit", "funder", "bill", "race", "rule", "lawmaker", "agency"]);
const TYPE_ALIASES: Record<string, string> = {
  company: "lab", "think tank": "think_tank", thinktank: "think_tank", advocacy: "nonprofit", "super_pac": "pac", "super pac": "pac",
  committee: "pac", executive_action: "rule", "executive action": "rule", executive_order: "rule", "executive order": "rule", rfi: "rule", plan: "rule", eo: "rule", regulation: "rule", candidate: "lawmaker",
  foundation: "funder", fund: "nonprofit", vc: "investor", government: "agency", "trade group": "nonprofit", org: "nonprofit", organization: "nonprofit",
};
export function normType(t: string): string | null {
  const k = (t || "").toLowerCase().trim();
  if (NODE_TYPES.has(k)) return k;
  return TYPE_ALIASES[k] ?? null;
}
const LINK_TYPES = new Set(["money", "person", "idea", "position"]);
const FILING_TYPES: Record<string, string> = {
  fec: "FEC", lda: "LDA", "state lobbying": "state lobbying", state_lobbying: "state lobbying", "990": "990", irs990: "990",
  "docket comment": "docket comment", docket_comment: "docket comment", "rfi comment": "docket comment", "position letter": "position letter", position_letter: "position letter", letter: "position letter",
};
export const normFilingType = (t: string) => {
  const k = (t || "").toLowerCase().trim();
  if (FILING_TYPES[k]) return FILING_TYPES[k];
  for (const [p, v] of [["fec", "FEC"], ["lda", "LDA"], ["ld-", "LDA"], ["990", "990"], ["form 990", "990"], ["state lobby", "state lobbying"], ["cal-access", "state lobbying"], ["docket", "docket comment"], ["rfi", "docket comment"]] as const)
    if (k.startsWith(p)) return v;
  return null;
};

const isoDate = (d: unknown): string | null => {
  if (typeof d !== "string") return null;
  const m = d.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return null;
  return `${m[1]}-${m[2] ?? "01"}-${m[3] ?? "01"}`;
};
// How exact the source's date is. A year-only or month-only date is stored as the 1st but shown only to that precision.
// An explicit date_precision on the row wins. A researched date of Jan 1 with no precision given is treated as year-only:
// research agents padded year-only dates that way, and losing a rare real Jan 1 is better than inventing a day.
type Prec = "day" | "month" | "year";
export const datePrec = (d: unknown, explicit?: unknown, origin = ""): Prec => {
  if (explicit === "day" || explicit === "month" || explicit === "year") return explicit;
  const m = typeof d === "string" ? d.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/) : null;
  if (!m) return "day";
  if (!m[2]) return "year";
  if (!m[3]) return "month";
  return origin === "research" && m[2] === "01" && m[3] === "01" ? "year" : "day";
};
const num = (a: unknown): number | null => {
  if (typeof a === "number" && isFinite(a)) return a;
  if (typeof a === "string" && /^[\d.,]+$/.test(a.replace(/\$/g, ""))) return Number(a.replace(/[$,]/g, ""));
  return null;
};

export type Rejection = { table: string; reason: string; row: unknown };
export const rejections: Rejection[] = [];
const reject = (table: string, reason: string, row: unknown) => { rejections.push({ table, reason, row }); return false; };

export async function setActor(actor: string) { await pool.query(`SELECT set_config('mb.actor', $1, false)`, [actor]); }

export async function nodeExists(id: string): Promise<boolean> {
  const r = await pool.query("SELECT 1 FROM nodes WHERE id=$1", [id]);
  return r.rowCount! > 0;
}

export async function upsertNode(n: any): Promise<boolean> {
  const type = normType(n.type);
  if (!n.id || !n.name) return reject("nodes", "missing id/name", n);
  if (!type) return reject("nodes", `bad type ${n.type}`, n);
  if (!isUrl(n.source_url)) return reject("nodes", "no source_url", n);
  if (isTradeGroup(n.name, n.id)) return reject("nodes", "trade group (out of scope)", n);
  await pool.query(
    `INSERT INTO nodes (id,type,name,descriptor,cluster,external_ids,source_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET
       descriptor = COALESCE(nodes.descriptor, EXCLUDED.descriptor),
       external_ids = EXCLUDED.external_ids || nodes.external_ids,
       updated_at = now()`,
    [n.id, type, n.name, n.descriptor ?? null, n.cluster || defaultCluster(type), JSON.stringify(n.external_ids ?? {}), n.source_url.trim()],
  );
  return true;
}

export function defaultCluster(type: string): string {
  return ({ bill: "bills", race: "races", rule: "rules", lawmaker: "lawmakers", agency: "government", lab: "ai-labs", investor: "other-investors",
    person: "other-investors", think_tank: "pro-innovation-think-tanks", pac: "leading-the-future-network", nonprofit: "civil-society", funder: "safety-funders" } as Record<string, string>)[type] ?? "other";
}

export async function insertLink(l: any, origin = "research"): Promise<boolean> {
  const type = (l.type || "").toLowerCase();
  if (!LINK_TYPES.has(type)) return reject("links", `bad type ${l.type}`, l);
  if (!isUrl(l.source_url)) return reject("links", "no source_url", l);
  for (const k of ["from", "to"]) if (!(await nodeExists(l[k]))) return reject("links", `unknown node ${l[k]}`, l);
  if (l.from === l.to) return reject("links", "self link", l);
  const r = await pool.query(
    `INSERT INTO links (from_id,to_id,type,subtype,amount,date_start,date_end,stance,note,source_url,origin,date_start_prec,date_end_prec)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT ON CONSTRAINT links_uniq DO UPDATE
     SET date_start_prec=EXCLUDED.date_start_prec, date_end_prec=EXCLUDED.date_end_prec
     WHERE (links.date_start_prec, links.date_end_prec) IS DISTINCT FROM (EXCLUDED.date_start_prec, EXCLUDED.date_end_prec)
     RETURNING (xmax = 0) AS inserted`,
    [l.from, l.to, type, l.subtype ?? null, num(l.amount), isoDate(l.date_start ?? l.date), isoDate(l.date_end), l.stance ?? null, l.note ?? null, l.source_url.trim(), origin,
     datePrec(l.date_start ?? l.date, l.date_precision ?? l.date_start_precision, origin), datePrec(l.date_end, l.date_end_precision, origin)],
  );
  return r.rows[0]?.inserted === true;
}

const UNDATED_PAGE = /^https?:\/\/[^/]+\/(?:[a-z-]+\/)?(about(-us)?|mission|team|our-team|who-we-are|funding|supporters|donors|issues\/[^?#]*)\/?(?:[?#].*)?$/i;

export async function insertFeed(f: any, origin = "research", status: "pending" | "approved" = "approved"): Promise<boolean> {
  const node = f.node ?? f.node_id;
  if (!isUrl(f.url)) return reject("feed_items", "no url", f);
  if (!(await nodeExists(node))) return reject("feed_items", `unknown node ${node}`, f);
  const date = isoDate(f.date);
  if (!date) return reject("feed_items", "no date", f);
  // Standing pages (about, mission, team) and Wayback copies carry no publish date, so any date on them is when we
  // looked, not when they said it. Those belong in facts, not the dated feed.
  if (UNDATED_PAGE.test(f.url) || /^https?:\/\/web\.archive\.org\//.test(f.url))
    return reject("feed_items", "undated page; use a fact or the dated original", f);
  const excerpt: string | null = f.excerpt ? String(f.excerpt).trim().replace(/^["“]|["”]$/g, "") : null;
  if (excerpt && wordCount(excerpt) > 25) return reject("feed_items", "excerpt over 25 words", f);
  if (!excerpt && !f.summary) return reject("feed_items", "no excerpt or summary", f);
  const target = f.target && (await nodeExists(f.target)) ? f.target : null;
  const r = await pool.query(
    `INSERT INTO feed_items (node_id,date,kind,excerpt,summary,url,platform,issues,stance,target_id,status,origin,date_prec)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT ON CONSTRAINT feed_uniq DO UPDATE SET date_prec=EXCLUDED.date_prec
     WHERE feed_items.date_prec IS DISTINCT FROM EXCLUDED.date_prec RETURNING (xmax = 0) AS inserted`,
    [node, date, (f.kind || "quote").toLowerCase(), excerpt, f.summary ?? null, f.url.trim(), f.platform ?? null,
     Array.isArray(f.issues) ? f.issues.map(String) : [], f.stance ?? null, target, status, origin, datePrec(f.date, f.date_precision, origin)],
  );
  return r.rows[0]?.inserted === true;
}

export async function insertFiling(f: any, origin = "research"): Promise<boolean> {
  const node = f.node ?? f.node_id;
  const ft = normFilingType(f.filing_type);
  if (!ft) return reject("filings", `bad filing_type ${f.filing_type}`, f);
  if (!isUrl(f.url)) return reject("filings", "no url", f);
  if (!(await nodeExists(node))) return reject("filings", `unknown node ${node}`, f);
  const r = await pool.query(
    `INSERT INTO filings (node_id,filing_type,period,filed_date,amount,issues,description,url,filing_id,origin,filed_prec)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (node_id,filing_type,url) DO UPDATE SET filed_prec=EXCLUDED.filed_prec
     WHERE filings.filed_prec IS DISTINCT FROM EXCLUDED.filed_prec RETURNING (xmax = 0) AS inserted`,
    [node, ft, f.period ?? null, isoDate(f.filed_date ?? f.date), num(f.amount), Array.isArray(f.issues) ? f.issues.map(String) : [],
     [ft !== f.filing_type ? String(f.filing_type) : null, f.description ?? f.note ?? null].filter(Boolean).join(". ") || null, f.url.trim(), f.filing_id ?? null, origin, datePrec(f.filed_date ?? f.date, f.date_precision, origin)],
  );
  return r.rows[0]?.inserted === true;
}

export const FACT_ORDER = ["Type", "Legal form", "Founded", "Founders", "Leader", "Role", "Party", "Office", "Headquarters", "Affiliated with",
  "Parent", "Previously", "Education", "Funding", "Valuation", "Revenue", "Employees", "Website", "FEC ID", "EIN", "Social"];

export async function insertFact(f: any): Promise<boolean> {
  const node = f.node ?? f.node_id;
  if (!isUrl(f.url)) return reject("facts", "no url", f);
  if (!f.text) return reject("facts", "no text", f);
  if (!(await nodeExists(node))) return reject("facts", `unknown node ${node}`, f);
  const label = f.label ? String(f.label).trim() : null;
  const r = await pool.query(
    `INSERT INTO facts (node_id,text,url,label,sort) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (node_id,text) DO UPDATE SET label=COALESCE(EXCLUDED.label, facts.label), sort=COALESCE(EXCLUDED.sort, facts.sort)`,
    [node, String(f.text).trim(), f.url.trim(), label, label ? (FACT_ORDER.indexOf(label) + 1 || 99) : null]);
  return r.rowCount! > 0;
}

export async function startRun(importer: string) {
  const r = await pool.query(`INSERT INTO import_runs (importer) VALUES ($1) RETURNING id`, [importer]);
  await setActor(`importer:${importer}`);
  return r.rows[0].id as number;
}
export async function endRun(id: number, ok: boolean, added: number, message = "") {
  await pool.query(`UPDATE import_runs SET finished_at=now(), ok=$2, added=$3, message=$4 WHERE id=$1`, [id, ok, added, message.slice(0, 2000)]);
}

export async function politeFetch(url: string, init: RequestInit = {}, tries = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers: { "User-Agent": "ModelBehavior-local-research/0.1", ...(init.headers ?? {}) } });
    } catch (e) {
      // Network failures (DNS, reset, timeout) retry, then come back as a 599 so one bad request can't end a whole import run.
      if (i < tries) { await new Promise((r) => setTimeout(r, 3000 * (i + 1))); continue; }
      return new Response(null, { status: 599, statusText: (e as Error).message });
    }
    if (res.status === 429 && i < tries) { await new Promise((r) => setTimeout(r, 4000 * (i + 1))); continue; }
    return res;
  }
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Tell the running site its cached record is stale. Silent if the site isn't running.
export async function notifySite() {
  try { await fetch("http://127.0.0.1:3000/api/revalidate", { method: "POST", signal: AbortSignal.timeout(3000) }); } catch { /* site not running */ }
}
