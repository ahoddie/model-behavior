// Writes one finder brief per statement to data/cache/claude/finder/<id>.md, for Claude subagents when no API key is set.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../../env.ts";
import { FINDER_BRIEF, OUTPUT_FORMAT, RESEARCH_DIR } from "./find.ts";
import { STATEMENTS, type Statement } from "./statements.ts";
const dir = join(REPO, "data/cache/claude/finder");
mkdirSync(dir, { recursive: true });
const names = readFileSync(join(REPO, "data/cache/claude/site-names.txt"), "utf8");
// x_risk was on the site before; its letters show only people who agree, so it needs the finder most.
const XRISK: Statement = { id: "x_risk", label: "Extinction risk", sort: 7, keywords: "", positive: "AI could cause human extinction.", description: "Whether advanced AI could kill or permanently disempower humanity." };
for (const s of [...STATEMENTS, XRISK]) writeFileSync(join(dir, `${s.id}.md`), `${FINDER_BRIEF(s, names)}\n\n${OUTPUT_FORMAT.replace("<statement id>", s.id)}\nWrite the lines to ${join(RESEARCH_DIR, s.id + ".jsonl")} (append if it exists).\n`);
console.log(dir, STATEMENTS.length);
