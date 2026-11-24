"use server";
import { headers } from "next/headers";
import { revalidatePath, updateTag } from "next/cache";
import { RECORD_TAG } from "@/lib/data";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { pool } from "@/lib/db";
import { warmSite } from "@/lib/warm";

const IMPORTERS = ["lda", "fec", "propublica", "regulations", "congress", "openstates", "state-lobbying", "news", "social", "blogs", "transcripts"];

async function localOnly() {
  const h = await headers();
  const host = (h.get("host") ?? "").split(":")[0];
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) throw new Error("The review screen only works on this machine.");
}

// A decision changes the public record: clear the cache now, so the reviewer sees it at once, then rebuild every page in the
// background once decisions stop coming, so no reader waits on the database for it.
async function cleared() {
  updateTag(RECORD_TAG);
  warmSite(`http://${(await headers()).get("host")}`);
}

async function withActor<T>(fn: (c: import("pg").PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SELECT set_config('mb.actor', 'reviewer', true)`);
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

export async function decide(form: FormData) {
  await localOnly();
  const id = Number(form.get("id"));
  const verdict = String(form.get("verdict"));
  const excerpt = String(form.get("excerpt") ?? "").trim() || null;
  const summary = String(form.get("summary") ?? "").trim() || null;
  const stance = String(form.get("stance") ?? "") || null;
  const issues = String(form.get("issues") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const date = String(form.get("date") ?? "");
  const url = String(form.get("url") ?? "").trim();
  if (excerpt && excerpt.split(/\s+/).length > 25) throw new Error("Quotes must be 25 words or fewer.");
  if (!/^https?:\/\/\S+$/.test(url)) throw new Error("Every item needs a source URL.");
  if (!excerpt && !summary) throw new Error("Add a quote or a summary.");
  await withActor(async (c) => {
    const before = (await c.query(`SELECT status FROM feed_items WHERE id=$1`, [id])).rows[0];
    await c.query(`UPDATE feed_items SET excerpt=$2, summary=$3, stance=$4, issues=$5, date=$6, url=$7, status=$8 WHERE id=$1`,
      [id, excerpt, summary, stance, issues, date, url, verdict === "approve" ? "approved" : verdict === "reject" ? "rejected" : "pending"]);
    if (before?.status === "approved" && verdict !== "approve") // pulling or changing a published item is a public correction
      await c.query(`INSERT INTO corrections (table_name,row_ref,what_changed,url) VALUES ('feed_items',$1,$2,$3)`, [String(id), verdict === "reject" ? "Removed after review." : "Edited after review.", url]);
    if (before?.status === "approved" && verdict === "approve")
      await c.query(`INSERT INTO corrections (table_name,row_ref,what_changed,url) VALUES ('feed_items',$1,'Edited after review.',$2)`, [String(id), url]);
  });
  revalidatePath("/review");
  await cleared();
}

export async function bulk(form: FormData) {
  await localOnly();
  const ids = form.getAll("ids").map(Number).filter(Boolean);
  const verdict = String(form.get("verdict")) === "approve" ? "approved" : "rejected";
  await withActor((c) => c.query(`UPDATE feed_items SET status=$2 WHERE id = ANY($1) AND status='pending'`, [ids, verdict]));
  revalidatePath("/review");
  await cleared();
}

export async function runImporter(form: FormData) {
  await localOnly();
  const name = String(form.get("name"));
  if (!IMPORTERS.includes(name) && name !== "all") throw new Error("Unknown importer");
  const tsx = join(process.cwd(), "node_modules/.bin/tsx");
  const p = spawn(tsx, [join(process.cwd(), "scripts/run-importers.ts"), ...(name === "all" ? [] : [name])], { cwd: process.cwd(), detached: true, stdio: "ignore" });
  p.unref();
  revalidatePath("/review");
  await cleared();
}

// Shared pipeline queue (CONTRACTS.md §5). The referenced feed item or conflict flag follows the decision.
export async function decideQueued(form: FormData) {
  await localOnly();
  const id = Number(form.get("id"));
  const status = form.get("verdict") === "approve" ? "approved" : "rejected";
  const note = String(form.get("note") ?? "") || null;
  await withActor(async (c) => {
    const r = await c.query(`UPDATE review_queue SET status=$2, reviewer_note=$3, decided_at=now() WHERE id=$1 AND status='pending' RETURNING ref_table, ref_id`, [id, status, note]);
    const row = r.rows[0];
    if (row?.ref_table === "feed_items" || row?.ref_table === "conflict_flags") await c.query(`UPDATE ${row.ref_table} SET status=$2 WHERE id=$1`, [row.ref_id, status]);
  });
  await cleared();
  revalidatePath("/review");
}

// A reviewer's check of one machine reading for the Statements page. Confirmed readings appear there with the reviewer's answer.
export async function decideStance(form: FormData) {
  await localOnly();
  const feed = Number(form.get("feed_id"));
  const topic = String(form.get("topic_id"));
  const confirmed = form.get("verdict") === "confirm";
  const answer = Number(form.get("answer"));
  const machine = Number(form.get("machine"));
  const note = String(form.get("note") ?? "").trim() || null;
  if (!feed || !topic) throw new Error("Missing quote or topic.");
  if (confirmed && !(Number.isInteger(answer) && answer >= -2 && answer <= 2)) throw new Error("Pick a reading before confirming.");
  await withActor((c) => c.query(`INSERT INTO stance_checks (feed_id, topic_id, verdict, answer, machine, note) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (feed_id, topic_id) DO UPDATE SET verdict=$3, answer=$4, machine=$5, note=$6, reviewed_at=now()`,
    [feed, topic, confirmed ? "confirmed" : "rejected", confirmed ? answer : null, Number.isInteger(machine) ? machine : null, note]));
  revalidatePath("/review");
  await cleared();
}
