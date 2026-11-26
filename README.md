# Model Behavior

A sourced, local-only map of how frontier labs, investors, tech leaders, and think tanks push on U.S. AI policy. Every node, line, quote, amount, and filing links to its source. Wayback copies stored before 2026-11-16 are kept and shown; new sources are no longer archived.

Nothing here is deployed. Everything runs on this machine and binds to `localhost`.

## Run it

```bash
colima start                      # or any Docker runtime
docker compose up -d              # Postgres on 127.0.0.1:5433, Meilisearch on 127.0.0.1:7700
cd web && pnpm install
pnpm load                         # merge data/research/*.json into Postgres, write data/gaps.md
pnpm index                        # build the search index
pnpm build && pnpm start           # fast local server at http://localhost:3010 (rebuild after code changes)
pnpm dev                          # slower, but reloads as you edit code
```

## Keep it current

| Command | What it does |
|---|---|
| `pnpm import` | Run every importer now (or `pnpm import lda fec` for some) |
| `pnpm scheduler` | Stay running; importers 05:00, source audit 07:00 |
| `pnpm firehose` | Follow tracked Bluesky accounts live through Jetstream |
| `pnpm archive` | Not run since 2026-11-16: look up or create a Wayback copy of every source URL and store it on each row |
| `pnpm sources` | Fetch every source; re-check dead links, then delete rows whose source is gone and has no Wayback copy (logged as corrections); send quotes not found on their page back to review |

Importer-found items arrive as **pending**. Approve, edit or reject them at http://localhost:3010/review (it opens only on localhost).

Keys go in `web/.env.local` (see `web/.env.example`). All are optional; importers that need a missing key skip themselves.

## Layout

- `db/schema.sql`: tables, the URL-required constraint, the 25-word quote check, changelog triggers
- `data/research/`: research slices (one JSON file per slice; contract in `data/research/README.md`)
- `data/gaps.md`: what we looked for and could not source
- `data/sources/feeds.json`: company feeds and newsrooms polled by the blog importer
- `web/scripts/importers/`: FEC, LDA, ProPublica 990s, Regulations.gov, Congress.gov, OpenStates, state lobbying, news (GDELT + Google News RSS), Bluesky/X, company blogs, Whisper transcripts
- `web/src/`: the Next.js site (map, profiles, target pages, money flows, timeline, search, open data, review)
