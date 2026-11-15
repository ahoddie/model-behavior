// The statements pipeline (Workstream A). A Doc comes in from any source; out come pending feed_items plus review-queue entries.
//   1 prefilter (code)  ->  2 relevance + issue tags (model)  ->  3 attribution (own words / quoted / paraphrase)
//   -> 4 quote selection and verbatim check (model proposes, code verifies)  ->  5 stance x2 + attitude (model)
//   -> 6 dedup (earliest primary source wins)  ->  7 insert as pending + enqueue() with significance.
// "Sentiment" here is stance toward a specific policy plus general attitude to regulation, never tone.
import { pool, q } from "../../../src/lib/db.ts";
import { enqueue } from "../../lib/review.ts";
import * as J from "./judge.ts";
import { PROMPT_SET, type Stance } from "./judge.ts";
import { TAXONOMY, detectTargets, targetById, issueById } from "./taxonomy.ts";
import { passesPrefilter, policyTerms, sentences, sha1, similar, topWindows, verifyQuote, words } from "./textutil.ts";

export const PREFILTER_VERSION = "pf1";
export const PRIMARY_STANCE: "A" | "B" = "A";     // which stance prompt supplies the stored label; the other is the cross-check

export type Person = { id: string; name: string; tier: number };
export type Source = "bluesky" | "mastodon" | "threads" | "blog" | "news" | "oped" | "transcript" | "testimony";
export type Doc = {
  source: Source; platform: string; kind: string; url: string; date: string; text: string;
  author?: Person;                                      // own-channel docs (post, blog, testimony): the speaker
  turns?: { person: Person; text: string }[];           // speaker-labeled transcript turns
  people?: Person[];                                    // articles: watchlist people to look for
};
export type Unit = {
  person: Person; attribution: "direct" | "quoted" | "paraphrased"; text: string;        // text = what the model reads
  quoteSource: string;                                                                   // where a quote must be found verbatim
  quote?: string;                                                                        // pre-selected quoted span (news)
  speakerCheck?: boolean;                                                                // news: model + code agreed on who spoke
};

export type Step = { name: string; prompt_version: string; input_hash: string; cached: boolean; attempts: number };
export type Analysis = {
  outcome: "irrelevant" | "no_statement" | "bad_quote" | "ok";
  stage: "prefilter" | "relevance" | "quote" | "done";
  attribution: Unit["attribution"]; relevant: boolean; issues: string[]; target: string | null; primaryIssue: string | null;
  proposition: { kind: "target" | "issue"; id: string } | null;
  quote: string | null; quoteProposed: string | null; quoteStrict: boolean | null;
  stanceA: Stance | null; stanceB: Stance | null; stance: Stance | null; agree: boolean | null;
  regAttitude: number | null; summary: string | null; rationale: string[];
  high: boolean; checks: Record<string, boolean>; steps: Step[];
};
const step = (name: string, m: { prompt_version: string; input_hash: string; cached: boolean; attempts: number }): Step => ({ name, prompt_version: m.prompt_version, input_hash: m.input_hash, cached: m.cached, attempts: m.attempts });

// A statement that hedges ("but", "if", "unless") is the common source of a wrong support/oppose label, so clean support/oppose
// labels on hedged text are not counted as high-confidence (CONTRACTS.md: confidence from checks in code, not model self-report).
const HEDGE = /\b(?:but|however|although|though|unless|provided|as long as|only if|if (?:it|we|they|the|done|Congress|there)|so long as|except|depends?)\b/i;

export async function analyzeUnit(u: Unit): Promise<Analysis> {
  const a: Analysis = { outcome: "irrelevant", stage: "prefilter", attribution: u.attribution, relevant: false, issues: [], target: null, primaryIssue: null,
    proposition: null, quote: null, quoteProposed: null, quoteStrict: null, stanceA: null, stanceB: null, stance: null, agree: null, regAttitude: null,
    summary: null, rationale: [], high: false, checks: {}, steps: [] };
  if (!passesPrefilter(u.text)) return a;

  // 2. relevance + issue tags. A named target in the text is itself proof of relevance (and the taxonomy gives its issues), so no call.
  const targets = detectTargets(u.text);
  a.target = targets[0] ?? null;
  a.stage = "relevance";
  if (a.target) { a.relevant = true; a.issues = targetById(a.target)!.issues; a.rationale.push(`Names the target ${targetById(a.target)!.label}.`); }
  else {
    const r = await J.relevanceAndIssues(u.person.name, u.text);
    a.steps.push(step("relevance", r.meta)); a.rationale.push(r.reason);
    a.relevant = r.relevant; a.issues = r.issues;
    if (!r.relevant || !r.issues.length) { a.relevant = r.relevant; return a; }
  }
  a.primaryIssue = a.issues[0] ?? null;
  a.proposition = a.target ? { kind: "target", id: a.target } : a.primaryIssue ? { kind: "issue", id: a.primaryIssue } : null;
  if (!a.proposition) { a.outcome = "no_statement"; return a; }

  // 3/4. the quote. Paraphrases never get one. Own-words text of 25 words or fewer is its own quote.
  a.stage = "quote";
  if (u.attribution !== "paraphrased") {
    let proposed = u.quote ?? null;
    if (!proposed && words(u.quoteSource) <= 25) proposed = u.quoteSource;
    if (!proposed || words(proposed) > 25) {
      const base = proposed ?? u.quoteSource;
      const p = await J.pickQuote(u.person.name, base);
      a.steps.push(step("quote", p.meta)); proposed = p.quote;
    }
    a.quoteProposed = proposed;
    const v = verifyQuote(proposed, u.quoteSource);
    if (!v) { a.outcome = "bad_quote"; return a; }
    a.quote = v.text; a.quoteStrict = v.strict;
  }

  // 5. stance, asked two ways, plus attitude to regulation. The model reads the statement text, not just the quote, so context counts.
  a.stage = "done";
  const sa = await J.stanceA(u.person.name, u.text, a.proposition, u.attribution === "paraphrased");
  const sb = await J.stanceB(u.person.name, u.text, a.proposition);
  const at = await J.attitude(u.person.name, u.text);
  a.steps.push(step("stance_a", sa.meta), step("stance_b", sb.meta), step("attitude", at.meta));
  a.stanceA = sa.stance; a.stanceB = sb.stance; a.stance = PRIMARY_STANCE === "A" ? sa.stance : sb.stance;
  a.agree = sa.stance === sb.stance; a.regAttitude = at.value; a.rationale.push(`A: ${sa.summary}`, `B: ${sb.reason}`, `Attitude: ${at.reason}`);
  a.summary = cleanSummary(sa.summary, u.person.name, u.attribution === "paraphrased", a);

  // Confidence signal = agreement between the two prompts plus checks in code.
  a.checks = {
    prompts_agree: a.agree,
    quote_verified: u.attribution === "paraphrased" ? false : !!a.quote,
    speaker_checked: u.attribution === "direct" || u.speakerCheck === true,
    no_hedge_conflict: !((a.stance === "support" || a.stance === "oppose") && HEDGE.test(a.quote ?? u.text)),
    policy_terms_in_quote: policyTerms(a.quote ?? u.text),
  };
  a.high = a.checks.prompts_agree && a.checks.quote_verified && a.checks.speaker_checked && a.checks.no_hedge_conflict;
  a.outcome = "ok";
  return a;
}

function cleanSummary(s: string, name: string, paraphrased: boolean, a: Analysis): string {
  let t = s.replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "");
  const sur = name.split(" ").at(-1)!;
  if (!t || t.length > 300 || !t.includes(sur) || words(t) > 45) {
    const issue = a.primaryIssue ? issueById(a.primaryIssue)?.label : null;
    t = `${paraphrased ? "According to the article, " : ""}${name} comments on ${a.target ? targetById(a.target)!.label : issue ?? "AI policy"}.`;
  }
  return t;
}

// ---- units from docs -------------------------------------------------------------------------------------------------------------
const nameRe = (n: string) => new RegExp(`\\b${n.replace(/\s*\(.*?\)/g, "").trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")}\\b`);
const QUOTED = /[“"]([^”"\n]{25,600})[”"]/g;
const ATTRIB_VERB = /\b(?:said|says|told|argued|argues|wrote|writes|warned|warns|urged|urges|called|calls|testified|supports?|supported|opposes?|opposed|backs?|backed|favors?|favored|lobbied|pushed|pushing|pledged|criticized|criticizes|praised|endorsed|has said|has argued|believes?|wants?|wanted|proposed|proposes|advocat\w+)\b/;

export async function buildUnits(doc: Doc): Promise<Unit[]> {
  const out: Unit[] = [];
  if (doc.turns) {
    for (const t of doc.turns) for (const w of (words(t.text) > 120 ? topWindows(t.text, 2) : [t.text])) out.push({ person: t.person, attribution: "direct", text: w, quoteSource: w });
    return out;
  }
  if (doc.author) {
    const wins = words(doc.text) > 220 ? topWindows(doc.text, 3) : [doc.text];
    for (const w of wins) out.push({ person: doc.author, attribution: "direct", text: w, quoteSource: w });
    return out;
  }
  // Articles: find each watchlist person's quotes and attributed paraphrases.
  const people = (doc.people ?? []).filter((p) => nameRe(p.name).test(doc.text));
  if (!people.length) return out;
  const sents = sentences(doc.text);
  const mentions = (s: string) => people.filter((p) => nameRe(p.name).test(s) || new RegExp(`\\b${p.name.replace(/\s*\(.*?\)/g, "").trim().split(/\s+/).at(-1)}\\b`).test(s));
  let speakerCalls = 0;
  for (let i = 0; i < sents.length; i++) {
    const s = sents[i];
    const window = sents.slice(Math.max(0, i - 1), i + 2).join(" ");
    const spans = [...s.matchAll(QUOTED)].map((m) => m[1].trim());
    const near = mentions(window);
    if (!near.length) continue;
    if (spans.length) {
      for (const span of spans.slice(0, 2)) {
        if (!passesPrefilter(span + " " + window) || speakerCalls >= 8) continue;
        speakerCalls++;
        const sp = await J.speaker(window, span, near.map((p) => p.name));
        const person = near.find((p) => p.name === sp.name);
        // The model names a speaker; code confirms that person is actually named in the passage.
        if (person && mentions(window).some((p) => p.id === person.id)) out.push({ person, attribution: "quoted", text: window, quoteSource: doc.text, quote: span, speakerCheck: true });
      }
    } else if (ATTRIB_VERB.test(s) && passesPrefilter(s)) {
      for (const p of mentions(s).filter((p) => nameRe(p.name).test(s))) {
        // paraphrase only when the person is the grammatical subject near an attribution verb (name, then verb within 80 chars)
        const at = s.search(nameRe(p.name));
        if (at >= 0 && ATTRIB_VERB.test(s.slice(at, at + 140))) out.push({ person: p, attribution: "paraphrased", text: [sents[i - 1], s].filter(Boolean).join(" ").slice(-900), quoteSource: "" });
      }
    }
  }
  return out;
}

// ---- storage ----------------------------------------------------------------------------------------------------------------------
const clarity = (s: Stance | null) => (s === "support" || s === "oppose" ? 1 : s === "mixed" ? 0.5 : 0.2);
export function recency(date: string, now = Date.now()) {
  const days = Math.max(0, (now - Date.parse(date)) / 864e5);
  return days <= 30 ? 1 : Math.max(0.2, 1 - 0.8 * (days - 30) / (730 - 30));
}
export const significance = (tier: number, stance: Stance | null, date: string) => Math.round(tier * clarity(stance) * recency(date) * 1000) / 1000;
export const confidenceOf = (a: Analysis) => (a.attribution === "paraphrased" ? Math.min(0.6, a.high ? 0.6 : 0.4) : a.high ? 0.9 : a.agree ? 0.7 : 0.4);

export type StoreResult = { outcome: "stored" | "duplicate" | "skipped"; feedId?: number; replaced?: boolean };
export async function store(doc: Doc, u: Unit, a: Analysis): Promise<StoreResult> {
  if (a.outcome !== "ok" || !a.stance || !a.summary || !a.proposition) return { outcome: "skipped" };
  const { person } = u;
  const excerpt = a.attribution === "paraphrased" ? null : a.quote;
  const stanceLegacy = a.stance === "none" ? null : a.stance;
  const target = a.target ? targetById(a.target) : null;
  const targetNode = target ? (await q(`SELECT 1 FROM nodes WHERE id=$1`, [target.node])).length ? target.node : null : null;
  const meta = { pipeline: "statements", prompt_set: PROMPT_SET, prefilter: PREFILTER_VERSION, source: doc.source, extracted_at: new Date().toISOString(),
    steps: a.steps, stance_a: a.stanceA, stance_b: a.stanceB, primary_stance: PRIMARY_STANCE, agree: a.agree, high_confidence: a.high, checks: a.checks,
    proposition: a.proposition, quote_verbatim_strict: a.quoteStrict, speaker_checked: a.checks.speaker_checked };
  const conf = confidenceOf(a);

  // dedup: same person, same quote (or near), within four months. Earliest primary source wins; own-channel beats news.
  if (excerpt) {
    const near = await q<{ id: number; excerpt: string; date: string; origin: string; status: string; attribution: string | null }>(
      `SELECT id, excerpt, date::text, origin, status, attribution FROM feed_items WHERE node_id=$1 AND excerpt IS NOT NULL AND date BETWEEN $2::date - 120 AND $2::date + 120`, [person.id, doc.date]);
    const dupe = near.find((n) => similar(n.excerpt, excerpt));
    if (dupe) {
      const mine = dupe.origin === "statements" && dupe.status === "pending";
      const better = a.attribution === "direct" && dupe.attribution !== "direct" ? true : doc.date < dupe.date && a.attribution === (dupe.attribution ?? a.attribution);
      if (mine && better) {
        await pool.query(`UPDATE feed_items SET url=$2, date=$3, kind=$4, platform=$5, archive_url=NULL, attribution=$6 WHERE id=$1`, [dupe.id, doc.url, doc.date, doc.kind, doc.platform, a.attribution]);
        await enqueueFor(dupe.id, doc, u, a, conf);
        return { outcome: "stored", feedId: dupe.id, replaced: true };
      }
      return { outcome: "duplicate", feedId: dupe.id };
    }
  }
  const r = await pool.query(
    `INSERT INTO feed_items (node_id,date,kind,excerpt,summary,url,platform,issues,stance,target_id,status,origin,stance_target,issue_tags,reg_attitude,confidence,attribution,extraction_meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending','statements',$11,$12,$13,$14,$15,$16)
     ON CONFLICT ON CONSTRAINT feed_uniq DO NOTHING RETURNING id`,
    [person.id, doc.date, doc.kind, excerpt, a.summary, doc.url, doc.platform, a.issues, stanceLegacy, targetNode, a.target, a.issues, a.regAttitude, conf, a.attribution, JSON.stringify(meta)]);
  const id = r.rows[0]?.id as number | undefined;
  if (!id) return { outcome: "duplicate" };
  await enqueueFor(id, doc, u, a, conf);
  return { outcome: "stored", feedId: id };
}

async function enqueueFor(id: number, doc: Doc, u: Unit, a: Analysis, conf: number) {
  const stanceWord = a.stance === "none" ? "no clear stance" : a.stance;
  const subj = a.target ? targetById(a.target)!.label : a.primaryIssue ? issueById(a.primaryIssue)?.label : "AI policy";
  await enqueue({
    workstream: "statements", kind: "feed_item", refTable: "feed_items", refId: id,
    title: `${u.person.name} (${doc.platform}, ${doc.date}): ${stanceWord} on ${subj}`,
    payload: { rationale: a.rationale.join(" | "), summary: a.summary, quote: a.quote, attribution: a.attribution, stance: a.stance, stance_a: a.stanceA, stance_b: a.stanceB,
      prompts_agree: a.agree, high_confidence: a.high, checks: a.checks, stance_target: a.target, issue_tags: a.issues, reg_attitude: a.regAttitude, influence_tier: u.person.tier,
      prompt_set: PROMPT_SET },
    evidence: [{ label: `${doc.platform}`, url: doc.url, date: doc.date }],
    confidence: conf, significance: significance(u.person.tier, a.stance, doc.date),
  });
}

// ---- the doc-level driver ----------------------------------------------------------------------------------------------------------
export type DocResult = { stored: number; duplicates: number; dropped: number; seen: boolean };
const seenKey = (doc: Doc, p: Person) => sha1(`${doc.url}|${p.id}`);
const seenVersion = () => `${PREFILTER_VERSION}:${PROMPT_SET}`;

async function markSeen(key: string, source: string, outcome: string, feedId?: number) {
  await pool.query(`INSERT INTO stmt_seen (item_key, source, outcome, feed_item_id, prompt_versions) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (item_key) DO UPDATE SET outcome=EXCLUDED.outcome, feed_item_id=COALESCE(EXCLUDED.feed_item_id, stmt_seen.feed_item_id), prompt_versions=EXCLUDED.prompt_versions, seen_at=now()`,
    [key, source, outcome, feedId ?? null, seenVersion()]);
}
export async function alreadyDone(doc: Doc, p: Person): Promise<boolean> {
  const [r] = await q<{ outcome: string; prompt_versions: string }>(`SELECT outcome, prompt_versions FROM stmt_seen WHERE item_key=$1`, [seenKey(doc, p)]);
  return !!r && (r.outcome === "stored" || r.outcome === "duplicate" || r.prompt_versions === seenVersion());
}

export async function processDoc(doc: Doc, opts: { dryRun?: boolean } = {}): Promise<DocResult> {
  const res: DocResult = { stored: 0, duplicates: 0, dropped: 0, seen: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.date) || !/^https?:\/\/\S+$/.test(doc.url)) return res;     // no date or URL, no row
  const owners = doc.author ? [doc.author] : doc.turns ? [...new Map(doc.turns.map((t) => [t.person.id, t.person])).values()] : doc.people ?? [];
  // Cheap exit: nothing in the doc passes the prefilter, so record ids only and stop.
  if (!passesPrefilter(doc.text)) {
    if (!opts.dryRun) for (const p of owners) await markSeen(seenKey(doc, p), doc.source, "irrelevant");
    res.dropped = owners.length || 1; return res;
  }
  const fresh: Person[] = [];
  for (const p of owners) if (!(await alreadyDone(doc, p))) fresh.push(p);
  if (!fresh.length) { res.seen = true; return res; }
  const units = (await buildUnits({ ...doc, people: fresh, turns: doc.turns?.filter((t) => fresh.some((f) => f.id === t.person.id)) })).filter((u) => fresh.some((f) => f.id === u.person.id));
  for (const p of fresh) {
    const mine = units.filter((u) => u.person.id === p.id);
    let best: { u: Unit; a: Analysis } | null = null, worst: Analysis["outcome"] = "irrelevant";
    for (const u of mine) {
      const a = await analyzeUnit(u);
      if (a.outcome === "ok") {
        const rank = (x: Analysis) => clarity(x.stance) * 10 + (x.attribution === "direct" ? 2 : x.attribution === "quoted" ? 1 : 0) + (x.high ? 1 : 0);
        if (!best || rank(a) > rank(best.a)) best = { u, a };
      } else if (a.outcome === "bad_quote") worst = "bad_quote";
      else if (a.outcome === "no_statement" && worst === "irrelevant") worst = "no_statement";
    }
    if (!best) { if (!opts.dryRun) await markSeen(seenKey(doc, p), doc.source, worst); res.dropped++; continue; }
    if (opts.dryRun) { res.stored++; continue; }
    const r = await store(doc, best.u, best.a);
    await markSeen(seenKey(doc, p), doc.source, r.outcome === "stored" ? "stored" : r.outcome === "duplicate" ? "duplicate" : "no_statement", r.feedId);
    if (r.outcome === "stored") res.stored++; else res.duplicates++;
  }
  return res;
}

// ---- watchlist access -----------------------------------------------------------------------------------------------------------------
export async function loadWatchlist(): Promise<Person[]> {
  return (await q<{ id: string; name: string; tier: number }>(`SELECT n.id, n.name, w.influence_tier AS tier FROM stmt_watchlist w JOIN nodes n ON n.id=w.node_id ORDER BY w.influence_tier DESC, w.score DESC`));
}
export { TAXONOMY };
