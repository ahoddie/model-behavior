// Podcast and YouTube transcripts via Whisper.
// Sources: data/sources/feeds.json → "youtube": [{ node?, channel_id }] and "podcasts": [{ node?, url }] (podcast RSS).
// Needs `yt-dlp` and a Whisper CLI (`whisper` from openai-whisper, or whisper.cpp's `whisper-cli` with WHISPER_MODEL set).
// Each new episode is downloaded as audio to data/raw/audio, transcribed to JSON segments, and scanned for
// statements by tracked people. Quotes link to the episode at the timestamp where they were said.
import { REPO } from "../env.ts";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import Parser from "rss-parser";
import { q } from "../../src/lib/db.ts";
import { startRun, endRun } from "../lib/ingest.ts";
import { ingestDocument, POLICY_TERMS } from "../lib/text.ts";

const cfg = JSON.parse(readFileSync(join(REPO, "data/sources/feeds.json"), "utf8"));
const dir = join(REPO, "data/raw/audio");
const has = (bin: string) => spawnSync("which", [bin]).status === 0;
const parser = new Parser();

function transcribe(audio: string): { start: number; text: string }[] {
  if (has("whisper")) {
    execFileSync("whisper", [audio, "--model", process.env.WHISPER_MODEL_NAME ?? "base.en", "--output_format", "json", "--output_dir", dir], { stdio: "ignore" });
    const j = JSON.parse(readFileSync(audio.replace(/\.[^.]+$/, ".json"), "utf8"));
    return j.segments.map((s: any) => ({ start: Math.floor(s.start), text: s.text }));
  }
  const model = process.env.WHISPER_MODEL;
  if (has("whisper-cli") && model) {
    const wav = audio.replace(/\.[^.]+$/, ".wav");
    execFileSync("ffmpeg", ["-y", "-i", audio, "-ar", "16000", "-ac", "1", wav], { stdio: "ignore" });
    execFileSync("whisper-cli", ["-m", model, "-f", wav, "-oj", "-of", wav.replace(/\.wav$/, "")], { stdio: "ignore" });
    const j = JSON.parse(readFileSync(wav.replace(/\.wav$/, ".json"), "utf8"));
    return j.transcription.map((s: any) => ({ start: Math.floor(s.offsets.from / 1000), text: s.text }));
  }
  throw new Error("no whisper binary");
}

export async function run() {
  if (!has("yt-dlp") || !(has("whisper") || has("whisper-cli"))) {
    console.log("transcripts: needs yt-dlp and whisper (pip install openai-whisper, brew install yt-dlp ffmpeg); skipping");
    return 0;
  }
  if (!cfg.youtube.length && !cfg.podcasts.length) { console.log("transcripts: no channels or podcasts configured in data/sources/feeds.json"); return 0; }
  mkdirSync(dir, { recursive: true });
  const runId = await startRun("transcripts");
  let added = 0;
  try {
    const done = new Set((await q<{ url: string }>(`SELECT DISTINCT split_part(url,'&t=',1) AS url FROM feed_items WHERE origin='importer:transcripts'`)).map((r) => r.url));
    const episodes: { url: string; audio?: string; date: string; node?: string }[] = [];
    for (const y of cfg.youtube) {
      const feed = await parser.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${y.channel_id}`).catch(() => null);
      for (const i of (feed?.items ?? []).slice(0, 5)) episodes.push({ url: i.link!, date: (i.isoDate ?? "").slice(0, 10), node: y.node });
    }
    for (const p of cfg.podcasts) {
      const feed = await parser.parseURL(p.url).catch(() => null);
      for (const i of (feed?.items ?? []).slice(0, 5)) if (i.enclosure?.url) episodes.push({ url: i.link ?? i.enclosure.url, audio: i.enclosure.url, date: (i.isoDate ?? "").slice(0, 10), node: p.node });
    }
    for (const ep of episodes) {
      if (done.has(ep.url) || !ep.date) continue;
      const file = join(dir, `${Buffer.from(ep.url).toString("base64url").slice(0, 40)}.m4a`);
      if (!existsSync(file)) execFileSync("yt-dlp", ["-x", "--audio-format", "m4a", "-o", file, ep.audio ?? ep.url], { stdio: "ignore" });
      const segs = transcribe(file);
      // Scan in ~2-minute windows so each quote links to its own timestamp.
      for (let i = 0; i < segs.length; i += 20) {
        const win = segs.slice(i, i + 20);
        const text = win.map((s) => s.text).join(" ");
        if (!POLICY_TERMS.test(text)) continue;
        const isYt = /youtube\.com|youtu\.be/.test(ep.url);
        const url = isYt ? `${ep.url}${ep.url.includes("?") ? "&" : "?"}t=${win[0].start}s` : ep.url;
        added += await ingestDocument({ text, url, date: ep.date, platform: isYt ? "YouTube" : "Podcast", kind: "interview", only: ep.node ? [ep.node] : undefined, origin: "importer:transcripts" });
      }
    }
    await endRun(runId, true, added);
  } catch (e) { await endRun(runId, false, added, String(e)); throw e; }
  return added;
}
if (import.meta.url === `file://${process.argv[1]}`) { console.log("transcripts added", await run()); process.exit(0); }
