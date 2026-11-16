// Shared helpers for the thin-profile enrichers (migration range 220-239, prefix thin_; none needed so far).
// Rows go in through the existing ingest helpers; every URL written is logged so the archive step can find it.
import "../env.ts";
import { appendFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { REPO } from "../env.ts";
import { insertFact, insertFiling, insertLink, politeFetch, sleep, setActor } from "../lib/ingest.ts";
import { q, pool } from "../../src/lib/db.ts";

export { q, pool, politeFetch, sleep };
export const CACHE = resolve(REPO, "data/cache/thin");
mkdirSync(CACHE, { recursive: true });
export const URLS = resolve(CACHE, "urls.txt");
export const ORIGIN = "thin-profiles";
export const today = () => new Date().toISOString().slice(0, 10);

export async function begin() { await setActor(ORIGIN); }
const logUrl = (u: string) => appendFileSync(URLS, u + "\n");
export async function fact(f: { node: string; text: string; url: string; label?: string }) { logUrl(f.url); return insertFact(f); }
export async function filing(f: any) { logUrl(f.url); return insertFiling(f, ORIGIN); }
export async function link(l: any) { logUrl(l.source_url); return insertLink(l, ORIGIN); }

export const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
export const title = (s: string) => s.toLowerCase().replace(/(^|[\s(\/&-])([a-z])/g, (_, a, b) => a + b.toUpperCase()).replace(/\b(Llc|Inc|Pac|Dc|Usa|Us|Ny|Ca|Gop|Dnc|Rnc|Ai|Lp|Llp)\b/g, (m) => m.toUpperCase());
export function readCache(name: string): string | null { const f = resolve(CACHE, name); return existsSync(f) ? readFileSync(f, "utf8") : null; }
export function writeCache(name: string, body: string) { const f = resolve(CACHE, name); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); }

/** Fetch with a disk cache. Returns null on a non-200. Pauses `gap` ms after a live request. */
export async function cachedGet(url: string, name: string, gap = 1200, init: RequestInit = {}): Promise<string | null> {
  const hit = readCache(name);
  if (hit !== null) return hit;
  const r = await politeFetch(url, init);
  await sleep(gap);
  if (r.status !== 200) return null;
  const t = await r.text();
  writeCache(name, t);
  return t;
}

/** Download a zip once and unzip it into data/cache/thin/<dir>. */
export async function zipOnce(url: string, dir: string): Promise<string> {
  const out = resolve(CACHE, dir);
  if (existsSync(resolve(out, ".ok"))) return out;
  mkdirSync(out, { recursive: true });
  const z = resolve(out, "x.zip");
  const r = await fetch(url, { headers: { "User-Agent": "ModelBehavior-local-research/0.1" } });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  writeFileSync(z, Buffer.from(await r.arrayBuffer()));
  execFileSync("unzip", ["-o", "-q", z, "-d", out]);
  writeFileSync(resolve(out, ".ok"), "");
  return out;
}
