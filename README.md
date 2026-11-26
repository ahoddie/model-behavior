<p align="center">
  <img src="docs/images/banner.png" alt="Model Behavior" width="460">
</p>

<p align="center"><strong>AI policy influence, on the record.</strong></p>

<p align="center">
  Who funds AI policy in the U.S., who they fund, what they lobby on, and what they say,<br>
  drawn as one connected map, with every line linked to its source.
</p>

<p align="center">
  <a href="#what-you-can-do">What you can do</a> ·
  <a href="#where-the-data-comes-from">Where the data comes from</a> ·
  <a href="#how-it-stays-current">How it stays current</a> ·
  <a href="#run-it-yourself">Run it yourself</a>
</p>

## What you can do

Model Behavior is a guide to U.S. AI policy and the people trying to shape it: frontier labs, investors, tech leaders, foundations, and think tanks. It traces the money they give, the lobbying they file, and the positions they take in public. It takes no sides: it shows what the record says and lets you draw the conclusions.

| | |
|---|---|
| **Network**<br>See the whole landscape as one map: who gives, who receives, and which bills, races, and agencies the money reaches. Scrub the timeline to watch it grow. | **Nodes**<br>Pick any giver and follow each dollar to where it lands, a step at a time. |
| **Policy**<br>Every public AI bill in Congress and the states, sorted by where it stands, with who weighed in on each. Plus the 2026 races that drew the money. | **Statements**<br>Twelve open questions in AI policy, and who agrees or disagrees, each with a quote and a link to where they said it. |

### By the numbers

As of November 26, 2026:

- **1,252** people, groups, lawmakers, agencies, bills, and races
- **11,977** sourced connections between them
- **6,110** lobbying, tax, and campaign filings
- **2,956** AI bills, federal and state
- **656** public statements, word for word

## Where the data comes from

Everything comes from public records, mostly primary sources. Each importer lives in [`web/scripts/importers/`](web/scripts/importers).

| What | Source | Importer |
|---|---|---|
| Campaign contributions and PAC spending | [FEC](https://www.fec.gov/data/) (OpenFEC API) | `fec.ts` |
| Federal lobbying reports (LD-1, LD-2) | [Senate Lobbying Disclosure](https://lda.gov/) | `lda.ts` |
| Nonprofit tax returns (990s) | [ProPublica Nonprofit Explorer](https://projects.propublica.org/nonprofits/) | `propublica.ts` |
| Public comments on federal rules | [Regulations.gov](https://www.regulations.gov/) | `regulations.ts` |
| Federal bills, status, and votes | [GovInfo](https://www.govinfo.gov/bulkdata/BILLSTATUS) bulk data and [Congress.gov](https://www.congress.gov/) | `bills-federal.ts`, `congress.ts` |
| California bills | [California LegInfo](https://leginfo.legislature.ca.gov/) public database exports | `bills-ca.ts` |
| AI bills in every other state | [NCSL](https://www.ncsl.org/) AI legislation database and [Open States](https://open.pluralpolicy.com/) | `bills-ncsl.ts`, `bills-states.ts` |
| State lobbying | [CAL-ACCESS](https://cal-access.sos.ca.gov/) (California) and [data.ny.gov](https://data.ny.gov/) (New York) | `state-lobbying.ts` |
| What people and groups say | Their own blogs and newsrooms, Bluesky posts, and news coverage via [GDELT](https://www.gdeltproject.org/) | `blogs.ts`, `social.ts`, `news.ts` |
| Boards, grants, and background | Hand research from primary sources, one file per topic in [`data/research/`](data/research) | `scripts/load-research.ts` |

A few ground rules hold everywhere:

- **No source, no row.** The database rejects any connection, filing, or quote without a link.
- **Quotes are word for word,** 25 words at most, and checked against the page they link to.
- **Money is credited to whoever gave it.** A founder's donation is theirs, not their company's.
- **Machine work is marked.** Anything an importer finds waits as *pending* until it's reviewed, and a statement reading no person has checked yet says so on the page.
- **Corrections are public.** Edits to published facts are logged on the site's Corrections page.

## How it stays current

Every night a job refreshes the record, step by step, and each step picks up where the last run stopped:

1. **FEC backfill:** donors' contributions, resuming across nights within the free API limit
2. **Importers:** lobbying, bills, rule comments, state lobbying, blogs, Bluesky, and news
3. **Source check:** new links and quotes are fetched and verified
4. **Labeling:** an open model ([Qwen 2.5 7B](https://ollama.com/library/qwen2.5)) sorts new statements by issue and side
5. **Search:** the Postgres full-text index is rebuilt
6. **Refresh:** the site's pages are rebuilt from the new record

It runs from [`web/scripts/daily.sh`](web/scripts/daily.sh) on a local machine, or from [`.github/workflows/nightly.yml`](.github/workflows/nightly.yml) on GitHub Actions.

## Run it yourself

You need [Node](https://nodejs.org/), [pnpm](https://pnpm.io/), and Docker (or [Colima](https://github.com/abiosoft/colima)).

```bash
docker compose up -d              # Postgres on 127.0.0.1:5433
cd web && pnpm install
pnpm load                         # load data/research/ into Postgres
pnpm index                        # build the search table
pnpm build && pnpm start          # the site, at http://localhost:3010
```

Use `pnpm dev` instead of `build` and `start` while editing code. Keys go in `web/.env.local` (see [`web/.env.example`](web/.env.example)). All are optional: importers that need a missing key skip themselves.

| Command | What it does |
|---|---|
| `pnpm import` | Run every importer, or name some: `pnpm import lda fec` |
| `pnpm sources` | Re-check every source link and quote |
| `pnpm analyze` | Label new statements with the local model ([Ollama](https://ollama.com/)) |
| `pnpm index` | Rebuild the search table |

New items from importers wait at http://localhost:3010/review, which only opens on your own machine. To put the site online, follow [`docs/deploy.md`](docs/deploy.md).

## Where things are

```
db/                 Postgres schema and migrations
data/research/      hand-researched records, one JSON file per topic
data/sources/       feeds and accounts the importers follow
docs/               the bill page spec, known data issues, and deploy steps
web/src/app/        the site's pages (Next.js)
web/src/components/ the map, charts, and page pieces
web/src/lib/        database queries and formatting
web/scripts/        importers, the nightly job, and data tools
```
