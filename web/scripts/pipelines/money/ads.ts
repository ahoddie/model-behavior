// Ad-spend join: which ads each tracked PAC ran, where and when.
// Source today: FEC Schedule E (independent expenditures) as filed: payee/vendor, purpose, expenditure and dissemination dates,
// candidate, race and support/oppose. Medium is read from the filed purpose text by keyword and left null when the filing is vague.
// Meta Ad Library, Google political ads and FCC public inspection files are not joined (see data/gaps.md).
//   tsx ads.ts
import "../../env.ts";
import { pool, q } from "../../../src/lib/db.ts";

const medium = (p: string | null) => {
  const s = (p ?? "").toLowerCase();
  if (/\b(tv|television|broadcast|cable|ctv|connected)\b/.test(s)) return "TV";
  if (/\b(digital|online|social|streaming|web|internet|display|youtube|meta|facebook|google|programmatic)\b/.test(s)) return "digital";
  if (/\b(mail|mailer|postage|print)\b/.test(s)) return "mail";
  if (/\b(radio|audio)\b/.test(s)) return "radio";
  if (/\b(text|sms|phone|call)\b/.test(s)) return "text/phone";
  return null;
};

const nodes = await q<{ id: string; external_ids: any }>(`SELECT id, external_ids FROM nodes WHERE type='lawmaker'`);
const cand = new Map(nodes.filter((n) => n.external_ids?.fec).map((n) => [String(n.external_ids.fec), n.id]));
const nk = (s: string) => { const w = s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((x) => x && !/^(jr|sr|ii|iii|dr|mr|mrs)$/.test(x)); return w.length > 1 ? `${w[0]} ${w.at(-1)}` : w[0] ?? ""; };
const nameMap = new Map<string, string>();
for (const n of await q<{ id: string; name: string }>(`SELECT id, name FROM nodes WHERE type='lawmaker'`)) { const k = nk(n.name); nameMap.set(k, nameMap.has(k) ? "" : n.id); }
const rows = await q<any>(`SELECT id, committee_id, node_id, name, amount::float8 amount, tx_date::text d, dissemination_date::text dd, purpose, candidate_id, candidate_name, candidate_office, candidate_state, candidate_district,
    support_oppose, source_url::text url, city, state FROM money_x_fec_tx WHERE sched='E' AND NOT superseded AND NOT memo AND node_id IS NOT NULL`);
await pool.query(`DELETE FROM money_x_ads WHERE platform='fec_se'`);
let n = 0;
for (const r of rows) {
  const place = [r.candidate_office === "H" ? `${r.candidate_state}-${r.candidate_district}` : r.candidate_office === "S" ? `${r.candidate_state} Senate` : r.candidate_office === "P" ? "President" : null].filter(Boolean)[0] ?? null;
  const desc = [r.purpose, medium(r.purpose) ? `(${medium(r.purpose)})` : null, r.candidate_name ? `${r.support_oppose === "S" ? "supporting" : r.support_oppose === "O" ? "opposing" : "re:"} ${r.candidate_name}` : null, place].filter(Boolean).join(" ");
  await pool.query(`INSERT INTO money_x_ads (node_id, committee_id, platform, external_id, amount, start_date, end_date, placement, target_node, target_label, support_oppose, description, source_url)
    VALUES ($1,$2,'fec_se',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [r.node_id, r.committee_id, String(r.id), r.amount, r.dd ?? r.d, r.dd ?? r.d, `${r.name}${r.state ? ` (${r.state})` : ""}${place ? `; race ${place}` : ""}`.slice(0, 300),
      cand.get(r.candidate_id) ?? (!r.candidate_id && r.candidate_name ? nameMap.get(nk(r.candidate_name.split(",").reverse().join(" "))) || null : null), r.candidate_name, r.support_oppose, desc.slice(0, 400), r.url]);
  n++;
}
console.log("fec_se ads", n);
await pool.end();
