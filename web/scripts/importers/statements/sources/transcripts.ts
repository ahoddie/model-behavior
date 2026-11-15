// Podcast and interview transcripts. A quote is attributed to a person ONLY when the transcript itself labels the turn with their name
// (publisher transcripts, podcast:transcript files with speakers, or a human-confirmed speaker map for diarized audio).
//   1. Transcript feeds: shows that publish the full labeled transcript in the post body (data in TRANSCRIPT_FEEDS).
//   2. Name search: iTunes Search finds podcast episodes that name a watchlist person; the show's RSS <podcast:transcript> file is read.
//   3. Audio -> Whisper -> diarization: needs downloads that are an open decision (see data/gaps.md). Without a human-confirmed speaker
//      map (data/raw/transcripts/<id>.speakers.json) unlabeled speech is never attributed to anyone.
//   4. YouTube: episodes found by name need yt-dlp for captions; absent, so skipped and logged.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import Parser from "rss-parser";
import { REPO } from "../../../env.ts";
import { politeFetch, sleep } from "../../../lib/ingest.ts";
import { htmlToText } from "../../../lib/text.ts";
import { loadWatchlist, nameRe, processDoc, type Doc, type Person } from "../pipeline.ts";
import { emptyStats, type Stats } from "./bluesky.ts";
import { FLOOR } from "./bluesky.ts";
import { passesPrefilter, words } from "../textutil.ts";

export const TRANSCRIPT_FEEDS = [{ show: "Dwarkesh Podcast", feed: "https://www.dwarkesh.com/feed", host: "dwarkesh.com" }];
const parser = new Parser({ customFields: { item: [["content:encoded", "contentEncoded"], ["podcast:transcript", "transcripts", { keepArray: true }]] } });

// ---- labeled transcript parsing --------------------------------------------------------------------------------------------------
const NAME = "[A-Z][A-Za-z.'’-]+(?: (?:[A-Z][A-Za-z.'’-]+|de|van|von|da|bin)){0,3}";
const LABELS = [
  new RegExp(`^(${NAME})\\s*$`),                                         // "Dario Amodei" alone on a line (Dwarkesh)
  new RegExp(`^(${NAME}):\\s+(.+)$`),                                    // "Dario Amodei: text"
  new RegExp(`^(${NAME})\\s+\\[?\\(?\\d{1,2}:\\d{2}(?::\\d{2})?\\)?\\]?\\s*(.*)$`),   // "Dario Amodei 00:12:31 text"
  new RegExp(`^\\[?\\(?\\d{1,2}:\\d{2}(?::\\d{2})?\\)?\\]?\\s+(${NAME}):?\\s*(.*)$`),  // "[00:12:31] Dario Amodei: text"
];
export function parseTurns(text: string): { label: string; text: string }[] {
  const turns: { label: string; text: string }[] = [];
  let cur: { label: string; text: string } | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let hit: RegExpMatchArray | null = null;
    for (const [i, re] of LABELS.entries()) { const m = line.match(re); if (m && (i > 0 || words(line) <= 4)) { hit = m; break; } }
    if (hit && !/^(?:Transcript|Timestamps|Sponsors?|Subscribe|Share|Listen|Watch|Introduction|Chapters?)$/i.test(hit[1])) { cur = { label: hit[1], text: hit[2] ?? "" }; turns.push(cur); }
    else if (cur) cur.text += (cur.text ? " " : "") + line;
  }
  return turns.filter((t) => words(t.text) > 20);
}
export function personTurns(text: string, people: Person[]) {
  const byName = new Map(people.map((p) => [p.name.replace(/\s*\(.*?\)/g, "").trim().toLowerCase(), p]));
  return parseTurns(text).flatMap((t) => { const p = byName.get(t.label.trim().toLowerCase()); return p ? [{ person: p, text: t.text }] : []; });
}

// podcast:transcript files: WebVTT/SRT lines may carry "Name:" or "<v Name>" speaker tags; JSON uses {segments:[{speaker, body}]}.
export function transcriptFileToText(body: string, type: string): string {
  if (/json/.test(type) || body.trim().startsWith("{")) {
    try { const j = JSON.parse(body); return (j.segments ?? []).map((s: any) => `${s.speaker ?? ""}: ${s.body ?? s.text ?? ""}`).filter((l: string) => /^[^:]+: .+/.test(l)).join("\n"); } catch { return ""; }
  }
  if (/html/.test(type)) return htmlToText(body);
  return body.replace(/^WEBVTT.*$/m, "").replace(/^\d+\s*$/gm, "").replace(/^\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s+-->.*$/gm, "").replace(/<v\s+([^>]+)>/g, "\n$1: ").replace(/<[^>]+>/g, "");
}

const add = (st: Stats, r: { stored: number; duplicates: number; dropped: number }) => { st.docs++; st.stored += r.stored; st.duplicates += r.duplicates; st.dropped += r.dropped; };

async function turnsDocs(people: Person[], text: string, url: string, date: string, platform: string, st: Stats) {
  const mine = personTurns(text, people);
  for (const person of new Map(mine.map((t) => [t.person.id, t.person])).values()) {
    const turns = mine.filter((t) => t.person.id === person.id && passesPrefilter(t.text));
    if (!turns.length) continue;
    const doc: Doc = { source: "transcript", platform, kind: "interview", url, date, text: turns.map((t) => t.text).join("\n"), turns };
    add(st, await processDoc(doc));
  }
}

export async function pollTranscripts(opts: { days?: number } = {}): Promise<Stats> {
  const st = emptyStats();
  const people = await loadWatchlist();
  const cutoff = opts.days ? new Date(Date.now() - opts.days * 864e5).toISOString().slice(0, 10) : FLOOR;
  // 1. publisher transcripts in the feed body
  for (const f of TRANSCRIPT_FEEDS) {
    const r = await politeFetch(f.feed);
    const feed = r.ok ? await parser.parseString(await r.text()).catch(() => null) : null;
    for (const i of feed?.items ?? []) {
      const date = (i.isoDate ?? "").slice(0, 10);
      if (!i.link || date < cutoff) continue;
      const html = (i as any).contentEncoded ?? i.content ?? "";
      const text = html.replace(/<\/(p|div|h\d|li)>|<br\s*\/?>/gi, "\n");
      const plain = htmlToText(text);
      if (!people.some((p) => nameRe(p.name).test(`${i.title} ${plain.slice(0, 3000)}`))) continue;    // the guest must be named up front
      await turnsDocs(people, plain, i.link, date, f.host, st);
    }
  }
  // 2. name search through iTunes, then the show's own transcript file
  for (const p of people.filter((x) => x.tier >= 3)) {
    const r = await politeFetch(`https://itunes.apple.com/search?term=${encodeURIComponent(p.name)}&media=podcast&entity=podcastEpisode&limit=25`);
    if (!r.ok) continue;
    for (const ep of ((await r.json()).results ?? []) as any[]) {
      const date = (ep.releaseDate ?? "").slice(0, 10);
      if (date < cutoff || !nameRe(p.name).test(`${ep.trackName} ${ep.description ?? ""}`) || !ep.feedUrl) continue;
      const fr = await politeFetch(ep.feedUrl);
      const feed = fr.ok ? await parser.parseString(await fr.text()).catch(() => null) : null;
      const item = feed?.items.find((i) => i.guid === ep.episodeGuid || i.title === ep.trackName);
      const t = (item as any)?.transcripts?.[0]?.$;
      if (!t?.url) continue;
      const tr = await politeFetch(t.url);
      if (!tr.ok) continue;
      await turnsDocs(people, transcriptFileToText(await tr.text(), t.type ?? ""), ep.trackViewUrl ?? item!.link ?? ep.episodeUrl, date, new URL(ep.trackViewUrl ?? ep.feedUrl).hostname.replace(/^www\./, ""), st);
      await sleep(500);
    }
    await sleep(600);
  }
  return st;
}

// ---- audio path: Whisper + diarization, only with a human-confirmed speaker map ----------------------------------------------------------
export function audioToolsAvailable() {
  const has = (b: string) => spawnSync("which", [b]).status === 0;
  return { ytdlp: has("yt-dlp"), whisper: has("whisper") || has("whisper-cli"), ffmpeg: has("ffmpeg"), diarize: has("pyannote-audio") || existsSync(join(REPO, "data/raw/diarize.py")) };
}
/** A diarized transcript as [{speaker:"SPEAKER_01", text}] plus a speaker map written by a reviewer: {"SPEAKER_01":"dario-amodei"}. */
export async function ingestDiarized(id: string, url: string, date: string, platform: string, segments: { speaker: string; text: string }[], people: Person[]): Promise<Stats> {
  const st = emptyStats();
  const mapFile = join(REPO, `data/raw/transcripts/${id}.speakers.json`);
  if (!existsSync(mapFile)) return st;                           // unlabeled speech is never attributed
  const map: Record<string, string> = JSON.parse(readFileSync(mapFile, "utf8"));
  const turns = segments.flatMap((s) => { const p = people.find((x) => x.id === map[s.speaker]); return p ? [{ person: p, text: s.text }] : []; });
  await turnsDocs(people, turns.map((t) => `${t.person.name}: ${t.text}`).join("\n"), url, date, platform, st);
  return st;
}
