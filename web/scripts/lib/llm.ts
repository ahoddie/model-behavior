// The one client for the open-weights model (CONTRACTS.md §1). Ollama on this Mac is the default; the nightly GitHub
// Actions job runs the same Ollama model on the runner. Talks to any OpenAI-compatible server: Ollama (/v1), vLLM,
// llama.cpp server, LM Studio, or a hosted endpoint that serves open models.
//   LLM_BASE_URL    default http://localhost:11434/v1 (Ollama)
//   LLM_MODEL       default qwen2.5:7b-instruct
//   LLM_API_KEY     optional bearer token, for a hosted endpoint (never needed for Ollama)
//   LLM_CONCURRENCY default 1 (one local GPU; requests queue)
//   LLM_MAX_WAIT_S  default 90: on a rate limit (429, or 503 with Retry-After), wait and retry if the server asks for at
//                   most this long; past that, or after 5 waits, throw LlmRateLimited so the caller can stop cleanly
//                   and pick up next run (the disk cache keeps what is done).
// Every call: temperature 0, fixed seed, JSON-schema-constrained output, validated against the schema, retried on
// malformed or invalid JSON, cached on disk by (prompt version, input hash). Every result carries extraction meta.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LLM_BASE_URL = (process.env.LLM_BASE_URL ?? "http://localhost:11434/v1").replace(/\/$/, "");
export const LLM_MODEL = process.env.LLM_MODEL ?? process.env.ANALYSIS_MODEL ?? "qwen2.5:7b-instruct";
const API_KEY = process.env.LLM_API_KEY || "";
const MAX_WAIT_S = Number(process.env.LLM_MAX_WAIT_S ?? 90);
const headers = (): Record<string, string> => ({ "Content-Type": "application/json", ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) });

// Thrown when the server's rate limit would make us wait too long. Callers should stop the run, not skip the item.
export class LlmRateLimited extends Error {
  constructor(public waitSeconds: number, detail: string) { super(`LLM rate limit: retry in ${Math.round(waitSeconds)} s (${detail})`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Seconds to wait, from Retry-After or the x-ratelimit reset headers; default 20 s when the server gives none.
function retryAfter(r: Response): number {
  const ra = r.headers.get("retry-after");
  if (ra) { const n = Number(ra); if (Number.isFinite(n)) return n; const t = Date.parse(ra); if (t) return Math.max(0, (t - Date.now()) / 1000); }
  for (const h of ["x-ratelimit-reset-requests", "x-ratelimit-reset-tokens", "x-ratelimit-reset"]) {
    const v = r.headers.get(h); if (!v) continue;
    const m = v.match(/^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?$/);
    if (m && (m[1] || m[2] || m[3])) return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
    const n = Number(v); if (Number.isFinite(n)) return n > 1e9 ? Math.max(0, n - Date.now() / 1000) : n;
  }
  return 20;
}
// One HTTP call with rate-limit backoff.
async function post(path: string, body: unknown): Promise<Response> {
  for (let wait = 0; ; wait++) {
    const r = await fetch(`${LLM_BASE_URL}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
    if (r.status !== 429 && !(r.status === 503 && r.headers.has("retry-after"))) return r;
    const s = retryAfter(r);
    const detail = `${r.status} ${(await r.text()).slice(0, 160)}`;
    if (s > MAX_WAIT_S || wait >= 5) throw new LlmRateLimited(s, detail);
    console.warn(`LLM rate limited; waiting ${Math.ceil(s)} s`);
    await sleep(Math.ceil(s * 1000) + Math.random() * 1000);
  }
}
const CONCURRENCY = Math.max(1, Number(process.env.LLM_CONCURRENCY ?? 1));
const CACHE_DIR = process.env.LLM_CACHE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "../../../data/cache/llm");

export type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema>; required?: string[]; enum?: unknown[];
  items?: JsonSchema; minimum?: number; maximum?: number; maxItems?: number; additionalProperties?: boolean | JsonSchema; [k: string]: unknown };

export type ExtractionMeta = { model: string; prompt_version: string; extracted_at: string; input_hash: string; cached: boolean; attempts: number };
export type LlmResult<T> = { data: T; meta: ExtractionMeta };

export type LlmRequest = {
  promptVersion: string;          // bump whenever the system prompt, schema or rules change, e.g. "stance-v3"
  system: string;
  user: string;
  schema: JsonSchema;
  maxTokens?: number;
  noCache?: boolean;
};

// ---- server detection -------------------------------------------------------------------------------------------
let detected: Promise<{ kind: string; models: string[] }> | null = null;
export function detectServer() {
  detected ??= (async () => {
    try {
      const r = await fetch(`${LLM_BASE_URL}/models`, { headers: headers(), signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        const j: any = await r.json();
        const models = (j.data ?? []).map((m: any) => m.id);
        const kind = LLM_BASE_URL.includes(":11434") ? "ollama" : LLM_BASE_URL.includes(":8000") ? "vllm" : LLM_BASE_URL.includes(":8080") ? "llama.cpp" : "openai-compatible";
        return { kind, models };
      }
    } catch { /* fall through */ }
    throw new Error(`No model server at ${LLM_BASE_URL}. Start one (for Ollama: \`ollama serve\`) or set LLM_BASE_URL (and LLM_API_KEY for a hosted one).`);
  })();
  return detected;
}

// ---- validation (small, dependency-free subset of JSON Schema) ---------------------------------------------------
export function validate(v: unknown, s: JsonSchema, path = "$"): string | null {
  const types = s.type ? (Array.isArray(s.type) ? s.type : [s.type]) : null;
  const t = v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;
  if (types && !types.includes(t) && !(t === "integer" && types.includes("number"))) return `${path}: expected ${types.join("|")}, got ${t}`;
  if (s.enum && !s.enum.includes(v)) return `${path}: ${JSON.stringify(v)} not in enum`;
  if (typeof v === "number") {
    if (s.minimum != null && v < s.minimum) return `${path}: below ${s.minimum}`;
    if (s.maximum != null && v > s.maximum) return `${path}: above ${s.maximum}`;
  }
  if (t === "array" && s.items) {
    if (s.maxItems != null && (v as unknown[]).length > s.maxItems) return `${path}: more than ${s.maxItems} items`;
    for (const [i, x] of (v as unknown[]).entries()) { const e = validate(x, s.items, `${path}[${i}]`); if (e) return e; }
  }
  if (t === "object" && v) {
    for (const k of s.required ?? []) if (!(k in (v as object))) return `${path}.${k}: missing`;
    for (const [k, x] of Object.entries(v as object)) {
      const ps = s.properties?.[k];
      if (ps) { const e = validate(x, ps, `${path}.${k}`); if (e) return e; }
      else if (s.additionalProperties === false) return `${path}.${k}: not allowed`;
      else if (typeof s.additionalProperties === "object") { const e = validate(x, s.additionalProperties, `${path}.${k}`); if (e) return e; }
    }
  }
  return null;
}

// ---- concurrency gate --------------------------------------------------------------------------------------------
let active = 0;
const waiting: (() => void)[] = [];
async function gate<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

export const inputHash = (req: Pick<LlmRequest, "promptVersion" | "system" | "user" | "schema">) =>
  createHash("sha256").update(JSON.stringify([LLM_MODEL, req.promptVersion, req.system, req.user, req.schema])).digest("hex").slice(0, 24);

// ---- the call ----------------------------------------------------------------------------------------------------
export async function llmJson<T = any>(req: LlmRequest): Promise<LlmResult<T>> {
  const hash = inputHash(req);
  const file = join(CACHE_DIR, req.promptVersion.replace(/[^\w.-]/g, "_"), `${hash}.json`);
  if (!req.noCache && existsSync(file)) {
    const c = JSON.parse(readFileSync(file, "utf8"));
    return { data: c.data, meta: { ...c.meta, cached: true } };
  }
  await detectServer();
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const out = await gate(async () => {
      const r = await post("/chat/completions", {
        model: LLM_MODEL, temperature: 0, seed: 7 + attempt - 1, max_tokens: req.maxTokens ?? 1024,
        response_format: { type: "json_schema", json_schema: { name: "out", strict: true, schema: req.schema } },
        messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
      });
      if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 300)}`);
      return ((await r.json()) as any).choices?.[0]?.message?.content ?? "";
    });
    let data: unknown;
    try { data = JSON.parse(out); } catch { lastErr = `malformed JSON: ${String(out).slice(0, 120)}`; continue; }
    const err = validate(data, req.schema);
    if (err) { lastErr = err; continue; }
    const meta: ExtractionMeta = { model: LLM_MODEL, prompt_version: req.promptVersion, extracted_at: new Date().toISOString(), input_hash: hash, cached: false, attempts: attempt };
    if (!req.noCache) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify({ data, meta })); }
    return { data: data as T, meta };
  }
  throw new Error(`LLM gave no valid output after 3 attempts (${req.promptVersion}): ${lastErr}`);
}

// Run many requests through the gate; failures come back as errors instead of throwing. A rate limit still throws
// (LlmRateLimited), so a batch job stops instead of marking every remaining item as failed.
export async function llmBatch<T = any>(reqs: LlmRequest[]): Promise<(LlmResult<T> | { error: string })[]> {
  return Promise.all(reqs.map((r) => llmJson<T>(r).catch((e: Error) => { if (e instanceof LlmRateLimited) throw e; return { error: e.message }; })));
}
