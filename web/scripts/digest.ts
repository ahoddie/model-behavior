// Email digests for followers. For each follower, gather approved feed items, filings and links added since their
// last digest on the nodes they follow. Sends through SMTP_URL if set; otherwise writes .eml files to data/outbox.
import { REPO } from "./env.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { pool, q } from "../src/lib/db.ts";
import { indexAll } from "./index-search.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const BASE = process.env.SITE_URL ?? "http://localhost:3000";

export async function sendDigests() {
  const followers = await q<{ email: string }>(`SELECT DISTINCT email FROM follows`);
  const transport = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : nodemailer.createTransport({ streamTransport: true, buffer: true });
  const outbox = join(REPO, "data/outbox");
  let sent = 0;
  for (const { email } of followers) {
    const items = await q<any>(`
      SELECT n.name, n.id AS node_id, x.* FROM follows fo JOIN nodes n ON n.id=fo.node_id
      JOIN LATERAL (
        SELECT 'feed' AS t, f.date::text AS date, coalesce(f.excerpt, f.summary) AS text, f.url FROM feed_items f
          WHERE f.node_id=fo.node_id AND f.status='approved' AND f.created_at > coalesce(fo.last_sent_at, fo.created_at)
        UNION ALL
        SELECT 'filing', coalesce(fi.filed_date::text, fi.period), fi.filing_type || ' ' || coalesce(fi.period,'') || coalesce(': ' || left(fi.description, 160), ''), fi.url FROM filings fi
          WHERE fi.node_id=fo.node_id AND fi.created_at > coalesce(fo.last_sent_at, fo.created_at)
      ) x ON true WHERE fo.email=$1 ORDER BY n.name, x.date DESC LIMIT 200`, [email]);
    if (!items.length) continue;
    const html = `<h2>Model Behavior: what changed</h2>` + Object.entries(Object.groupBy(items, (i: any) => i.name)).map(([name, list]) =>
      `<h3><a href="${BASE}/node/${list![0].node_id}">${esc(name)}</a></h3><ul>${list!.map((i: any) => `<li><a href="${esc(i.url)}">${esc(i.date ?? "")}</a> ${esc(i.text ?? "")}</li>`).join("")}</ul>`).join("");
    const info = await transport.sendMail({ from: process.env.DIGEST_FROM || "model-behavior@localhost", to: email, subject: `Model Behavior digest: ${items.length} new items`, html });
    if (!process.env.SMTP_URL) { mkdirSync(outbox, { recursive: true }); writeFileSync(join(outbox, `${Date.now()}-${email.replace(/[^a-z0-9]/gi, "_")}.eml`), (info as any).message); }
    await pool.query(`UPDATE follows SET last_sent_at=now() WHERE email=$1`, [email]);
    sent++;
  }
  return sent;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  await indexAll().catch((e) => console.warn("search index:", e.message));
  console.log("digests", await sendDigests());
  await pool.end();
}
