# Putting Model Behavior in the cloud

Nothing here has been done yet. These are the steps to take when you're ready. Everything below is free:

| Piece | Where | Free limit that matters |
|---|---|---|
| Site | Vercel, Hobby plan | Non-commercial use only |
| Database | Neon, free plan (through the Vercel Marketplace or neon.tech) | 0.5 GB storage per project; the database is about 100 MB |
| Nightly refresh | GitHub Actions, `.github/workflows/nightly.yml` | Unlimited minutes on a **public** repository; 2,000 minutes a month on a private one |
| Search | Postgres full-text search, in the same database | None |
| Statement labeling | Ollama (qwen2.5:7b-instruct) on the Actions runner | None, but slow: about 45 minutes of labeling a night |

The local setup keeps working as before. `daily.sh` still runs on the Mac, against the local database, unless you
point `DATABASE_URL` in `web/.env.local` at Neon. Don't run both against Neon on the same night.

## Before you start

- **Keep the repository public, or change the schedule.** A typical night takes 2.5 to 3 hours (5.5 at most). On a
  private repository that uses up the 2,000 free minutes in under two weeks. If it has to stay private, change the cron
  line in `nightly.yml` to run twice a week, and lower `NEWS_BUDGET_MIN` to 15. Even then it's close to the limit.
- **Check the history for secrets** before the repository goes public. `.env.local` was never committed, but run
  `git log -p | grep -iE "api[_-]?key|secret|token|password"` and read what comes back.
- **GitHub Models is no longer an option.** GitHub retired it on July 30, 2026, so the nightly job runs the same Ollama
  model as the Mac on the runner's CPU. `web/scripts/lib/llm.ts` also accepts any hosted OpenAI-compatible endpoint
  (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`), but that needs an account and a key, so it isn't set up.

## 1. Create the GitHub repository

```bash
cd ~/model-behavior
gh repo create model-behavior --public --source . --remote origin
git push -u origin master
```

The nightly workflow is on from the first push, but it does nothing until `DATABASE_URL` is set (it logs a notice and
stops).

## 2. Create the Neon database

The simplest route is through Vercel (step 4): on the Vercel project, open **Storage**, choose **Neon**, and create a
database in **US East (Washington, D.C.)**, which is where `web/vercel.json` runs the site. Choose **Postgres 16** if it
asks, to match the local one. Vercel then adds `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) to the
project for you.

Or sign up at neon.tech directly and create a project there. Either way, copy two connection strings from the Neon
dashboard (**Connect**):

- the **pooled** one (its host contains `-pooler`), for the site;
- the **direct** one (no `-pooler`), for loading the data and for the nightly job.

Both end in `?sslmode=require`.

## 3. Load the local database into Neon

On the Mac, with Colima running. `pg_dump` and `pg_restore` run inside Docker, so nothing needs installing. Put the
direct connection string in a shell variable first (it isn't saved anywhere):

```bash
read -s "NEON?Direct Neon connection string: " && export NEON
```

```bash
docker exec model-behavior-db-1 pg_dump -U mb -d model_behavior -Fc --no-owner --no-privileges > ~/model_behavior.dump
```

```bash
docker run --rm -i postgres:16-alpine pg_restore --no-owner --no-privileges -d "$NEON" < ~/model_behavior.dump
```

A few "must be owner of extension" or "role does not exist" messages are normal and harmless. Then turn off JIT on Neon.
It slows this database's queries down, and the pooled connection can't turn it off per session:

```bash
docker run --rm postgres:16-alpine psql "$NEON" -c "ALTER DATABASE neondb SET jit = off" -c "SELECT count(*) FROM search_docs"
```

(Use your database's name if it isn't `neondb`.) The count should be about 8,000.

Later schema changes are new files in `db/migrations/`. Apply each to Neon once, from the repository folder:

```bash
docker run --rm -v "$PWD:/repo" -w /repo postgres:16-alpine psql "$NEON" -f db/migrations/<file>.sql
```

## 4. Import the project in Vercel

1. vercel.com → **Add New… → Project** → import the `model-behavior` repository.
2. **Root Directory**: `web`. Framework: Next.js (detected). Leave the build and install commands alone;
   `web/vercel.json` sets them, including the pnpm version.
3. **Environment variables** (Production and Preview):
   - `DATABASE_URL`: the **pooled** Neon string (already there if you added Neon through Vercel).
   - `PG_POOL_MAX`: `3` (each serverless instance keeps a small pool; Neon's pooler handles the rest).
   - `REVALIDATE_SECRET`: a long random string. Make one with `openssl rand -hex 32` and keep it for step 5.
4. **Deploy.** The build reads from Neon, so the database must be loaded first (step 3).

The review screen (`/review`) never opens on the hosted site; reviewing stays on the Mac at http://localhost:3010/review,
against whichever database `web/.env.local` points at.

## 5. Set the GitHub secrets

```bash
gh secret set DATABASE_URL        # paste the DIRECT Neon string (no -pooler)
gh secret set REVALIDATE_SECRET   # the same value as on Vercel
gh variable set SITE_URL --body "https://<your-project>.vercel.app"
```

Optional; each importer skips or falls back without one: `DATA_GOV_KEY` (FEC and Regulations.gov, else DEMO_KEY),
`CONGRESS_API_KEY`, `OPENSTATES_API_KEY`.

## 6. Run it once by hand

```bash
gh workflow run nightly && gh run watch
```

Each step logs and carries on if it fails. The last step tells the site its cached pages are stale; each page is then
rebuilt from Neon on its next visit.

## What the nightly job does, and its caps

Same order as `daily.sh`: FEC donor backfill, the other importers, the source check, statement labeling, the search
table, then the site refresh. The caps (in `nightly.yml`, under `env`):

- `NEWS_BUDGET_MIN: 45`. News took up to 9 hours for all ~600 people and labs. Now it runs 45 minutes a night, picking up
  where the last night stopped (`data/cache/news-cursor.json`), so everyone is covered about every 6 nights. It searches
  the last 7 days, not 2, to cover the gap.
- `REGULATIONS_BUDGET_MIN: 20`, and it resumes at the org where it stopped.
- `ANALYZE_BUDGET_MIN: 45`. On the runner's CPU a statement takes a minute or two, so a night labels a few dozen. The
  rest wait for the next night.
- DEMO_KEY (FEC and Regulations.gov) allows about 10 calls a day **per IP**, and runner IPs are shared with other
  users, so the allowance may already be gone when the job starts. Both importers stop at the first 429 without
  failing and continue the next night. A free key from api.data.gov (`DATA_GOV_KEY`) avoids this, if you ever want one.
- Every step also has its own timeout, and the whole job stops at 5 hours 40 minutes.

Resume state (`data/cache`: FEC donor progress, the news rotation, the Regulations.gov cursor, and the model's answer
cache) is carried between nights with the Actions cache. If it's ever lost, the importers start over from the top,
which only costs time.

Not run in the cloud: podcast and YouTube transcripts (they need yt-dlp and Whisper) and the CAL-ACCESS bulk download
for California lobbying (about 1.5 GB; `--ca-download`). Both still run on the Mac if you ask for them.
