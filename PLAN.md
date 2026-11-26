# Plan: more data, the analysis, hosting and updates

Written 2026-11-14. The site stays local until you decide to host it.

## 1. The analysis

Nobody else has this. Other trackers list money or quotes. This one connects what each actor says, issue by issue, to where their money goes.

**Done now**
- `issue_areas`: 14 fixed issues. Each one is written as a plain statement, for example "Federal law should override or pause state AI laws." The list covers catastrophic risk, US–China, preemption, frontier-model rules, open models, copyright, kids' safety, jobs, energy, national security, liability, civil rights, elections and innovation.
- `pnpm analyze` sends each verbatim quote, with only the speaker's name, to Qwen 2.5 7B running locally in Ollama. It returns:
  - whether the quote is in the speaker's own voice;
  - up to 3 issues, each answered in words (agrees strongly, agrees, mentions only, disagrees, disagrees strongly), which the code turns into +2 to −2. A 7B model kept flipping signs when asked for numbers directly; words fixed that;
  - the speaker's stance on government rules for AI in general;
  - a confidence score and a one-line reason.

  Results are cached by model, prompt version and a hash of the input, so a re-run only labels quotes that are new or changed.
- **Money by issue:** each gift is split across the issues its recipient talks about, in proportion to how often. This only happens when the recipient has at least 2 labeled quotes. The rest is reported as unassigned.
- **On the site:** the home page has a "What do they care about?" section, and each profile has "Issues they speak on" with every quote and the label it got. The methodology page explains the method.

**Ideas taken from What Washington Says About AI** (its repo has no license, so we adapted the ideas and copied no code or prompts):
1. Count the actor's own words only. Never pass a company's statement down to a person, or the other way round.
2. A described harm isn't a stance on a policy.
3. Missing statements mean "not enough evidence", never zero.
4. Check agreement before trusting the labels. `pnpm validate` compares the model with `data/validation/reference-v3.json` (50 random quotes) and writes `data/validation/report-v3.md`. That reference was labeled by Claude without seeing the model's answers. A person should review it.
5. Send low-confidence labels to the review queue instead of into the charts.

**Next**
- Have a person check the 50 reference labels, then re-run `pnpm validate`.
- A recency rule: when an actor has at least 3 labeled quotes from the last 24 months, use only those.
- A flag for actors whose statements and money point in opposite directions on the same issue. Shown as plain facts, both sides linked.
- More quotes per actor. Most actors have fewer than 5, which is the biggest limit on the analysis. See section 2.

## 2. More data: free APIs

| Source | What it adds | Key | Status |
|---|---|---|---|
| FEC API (api.open.fec.gov) | Contributions, independent expenditures | Free api.data.gov key | Importer exists. Get a personal key: the current one looks like `DEMO_KEY` (30 requests/hour) |
| Senate LDA API (lda.senate.gov/api) | Lobbying filings by issue code | None (a free key raises limits) | Importer exists |
| Congress.gov API | Bills, hearings, witness lists | Free api.data.gov key | Importer exists. `CONGRESS_API_KEY` is empty |
| GovInfo API | Hearing transcripts: testimony is the best source of long own-voice quotes | Free api.data.gov key | New importer worth building |
| Regulations.gov API | Public comments on AI rules (OSTP, NTIA, BIS, Copyright Office) | Free api.data.gov key | Importer exists |
| OpenStates API | State bills, sponsors and status | Free key | Importer exists. `OPENSTATES_API_KEY` is empty |
| ProPublica Nonprofit Explorer | 990 revenue and grants for think tanks and funders | None | Importer exists. Many URLs block bots (403) |
| IRS 990 e-file data (Giving Tuesday 990 data lake) | Grant line items, funder to grantee | None | New, high value for "money by issue" |
| Company and think-tank blogs (RSS) | Own-voice policy posts | None | Importer exists. Add more feeds |
| Substack and Medium RSS | Founders' and investors' essays | None | Add the feeds |
| Bluesky public API | Posts | None | Works today. Only 3 actors have accounts on record |
| YouTube captions (podcasts, interviews) | Own-voice quotes | None for public captions | Possible, but captions need a quote check against the audio page |
| X API | Posts | Paid ($200/month Basic) | Skipped for cost. Handles for 78 actors are saved if you add it later |

Getting keys: one api.data.gov key covers the FEC, Congress.gov, GovInfo and Regulations.gov APIs. Sign up at api.data.gov/signup, then paste the key into `web/.env.local` as both `DATA_GOV_KEY` and `CONGRESS_API_KEY`.

## 3. Keeping it updated without GitHub Actions

Run it on this Mac with launchd, macOS's built-in scheduler. It costs nothing, and the analysis needs the local model anyway.

- `web/scripts/daily.sh` runs these steps in order: import, archive, link check, analyze, search index. It logs to `~/Library/Logs/model-behavior-daily.log`.
- To turn it on, create `~/Library/LaunchAgents/com.model-behavior.daily.plist`, pointing at that script with a daily `StartCalendarInterval`, then run `launchctl load` on it. It only runs while the Mac is awake; if it was asleep, launchd runs the job when it wakes. I haven't installed it, because it's a standing change to your Mac. Say the word and I'll set it up.
- The site picks up new data on its own: every importer calls `/api/revalidate`.

## 4. Hosting, when you want it

Recommended: **Vercel (free) for the site, plus Neon or Supabase (free Postgres)**. Keep importing and analysis on this Mac, writing to the hosted database. Search now runs on Postgres full-text search (db/migrations/220), so it needs nothing extra. See docs/deploy.md.

Alternative: **a $5/month VPS** (for example Hetzner) running the existing `docker-compose.yml`, with cron for updates. That's one box and everything works as it does locally, apart from the model, which still runs on the Mac. You'd handle security updates yourself.

Before any hosting:
- Lock down `/review`. It currently trusts the `Host` header, which a client can set to anything.
- Add `robots.txt`.
- Make sure no `.env.local` values reach the client.

## 5. Bugs found and fixed on 2026-11-14

- Removed 7 gifts that were each counted twice from two sources. They're kept in `links_removed` and logged in corrections.
- Lobbying contacts no longer show as "Political money" on profiles (Microsoft listed 839 of them).
- Position links with no stated stance no longer count as "mixed".
- The money page no longer drops separate gifts that have the same amount ($10M was missing from Leading the Future).
- a16z is now typed as an investor, so its $50M appears on the home page.
- The news importer now requires a speaker's full name. It had credited reporters' sentences to dozens of actors. Its 129 pending items were rejected; none had been published.
- Added indexes. The map's nodes are now reachable by screen reader.
- Filter links now work with statement types that contain spaces.

**Still open**
- 8 duplicate agency nodes to merge (for example `ftc` and `agency-federal-trade-commission-ftc`).
- 5 quotes credited to both a company and its leader.
- 93 links dated the 1st of a month that probably mean the whole month.
- Missing profiles return HTTP 200 instead of 404.
- The conflict-flags heuristics are too loose.
