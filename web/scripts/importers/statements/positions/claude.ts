// The Claude client for the positions pipeline. The rest of the repo runs on the local model (scripts/lib/llm.ts); this step
// uses Claude because the local 7B read "disagree" with 0.20 precision on the gold set (data/eval/statements/REPORT.md).
// Every call is cached on disk by (prompt version, request), so re-runs and the eval cost nothing twice.
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../../../env.ts";

export const MODEL = process.env.POSITIONS_MODEL ?? "claude-sonnet-5-5";
const CACHE = join(dirname(fileURLToPath(import.meta.url)), "../../../../../data/cache/claude");
let client: Anthropic | null = null;
const api = () => (client ??= new Anthropic({ maxRetries: 4 }));

export const usage = { input: 0, output: 0, searches: 0, calls: 0, cached: 0 };

// One cached call. `key` names the prompt version; the whole request body is hashed with it.
export async function call(version: string, body: Record<string, unknown>): Promise<Anthropic.Message> {
  const hash = createHash("sha256").update(JSON.stringify({ version, MODEL, body })).digest("hex").slice(0, 24);
  const file = join(CACHE, version, `${hash}.json`);
  if (existsSync(file)) { usage.cached++; return JSON.parse(readFileSync(file, "utf8")); }
  const stream = api().beta.messages.stream({ model: MODEL, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", ...body } as any);
  const msg = (await stream.finalMessage()) as unknown as Anthropic.Message;
  usage.calls++; usage.input += msg.usage.input_tokens; usage.output += msg.usage.output_tokens;
  usage.searches += (msg.usage as any).server_tool_use?.web_search_requests ?? 0;
  if (msg.stop_reason === "refusal") throw new Error(`refused (${(msg as any).stop_details?.category ?? "unknown"})`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(msg));
  return msg;
}

export const textOf = (m: Anthropic.Message) => m.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");

// Structured output: the answer is JSON matching `schema`.
export async function json<T>(version: string, system: string, user: string, schema: object, maxTokens = 2000): Promise<T> {
  const m = await call(version, { max_tokens: maxTokens, system, messages: [{ role: "user", content: user }],
    output_config: { effort: "low", format: { type: "json_schema", schema } } });
  return JSON.parse(textOf(m)) as T;
}

// Rough cost so far, at Sonnet 5.5 list prices ($2 in, $10 out per million tokens, $10 per thousand searches).
export const cost = () => (usage.input * 2 + usage.output * 10) / 1e6 + usage.searches * 0.01;
