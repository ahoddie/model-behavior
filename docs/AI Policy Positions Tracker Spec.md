# Model Behavior: How Silicon Valley Shapes AI Policy

> This is the original brief the project started from, kept for the record. The site grew from it but does not follow it
> everywhere: some parts were not kept, such as Meilisearch (search runs on Postgres full-text search) and email digests.
> The [README](../README.md) describes the site as it is.

Build **Model Behavior**: an interactive map that traces how frontier labs, investors, tech leaders and think tanks influence U.S. AI policy. It covers who funds whom, who works where, what they say, and what lands on which bills, races and rules. Build all of it in this session: the research, the data, the site and the live importers.

---

## 0. Rules (non-negotiable)

1. **Everything needs a source.** Every link, fact, quote, amount, date and position needs a source URL. If you can't source something, leave it out. Never invent anything.
2. **Sources are hyperlinks, never citations.** Link the claim text, date or item itself to the original. No footnotes, no "(Source: …)", no bracketed numbers, no source labels shown as text.
3. **Research full steam ahead.** Find all the information there is: every filing, statement, donation, position and connection for every actor in §3. Don't stop at a sample.
4. **Verbatim quotes are short:** 25 words or fewer, linked to the original.
5. **Primary sources first:** filings, original posts, transcripts, the actor's own pages. Use news reports only when there's no primary source, and link the article.
6. **Credit money to whoever gave it.** A person's money is never credited to their company unless the company itself gave it.
7. ~~Archive every source URL~~ Dropped on 2026-11-16: new sources are not archived. Existing archive links stay; `archive_url` is optional.
8. **Do not deploy anywhere.** Run locally only.
9. Log anything you looked for but couldn't source in `data/gaps.md`.

## 1. The influence map

Three columns, joined by sourced connections:

**The Valley → Through → Lands on**

- **The Valley:** labs, investors and tech leaders (§3)
- **Through:** super PACs, political nonprofits, think tanks, lobbying, bill-position letters, op-eds and testimony
- **Lands on:** bills, congressional and state races, agency rules, executive actions, and the lawmakers who receive the money or lobbying

Click any node to light up every path it takes. Line styles show the link type: money (solid green), people (solid ink), ideas (dotted grey), positions (dashed blue).

### Keeping it condensed

The map never shows every node at once.

- **Clusters first.** Nodes start grouped, e.g. "Leading the Future network," "Public First network," "a16z & partners," "OpenAI & executives," "Safety-focused funders," "Pro-innovation think tanks." Draw one line per pair of clusters, with thickness scaled to total dollars or number of links. Clicking a cluster expands it in place.
- **Focus mode.** Selecting a node hides everything else and shows only what is one or two steps away from it. The rest of the map fades at the edges.
- **Top-N per column.** Each column shows its 8–12 biggest nodes by money or number of links. The rest fold into a "+43 more" row that expands on click.
- **Bundled lines.** Lines heading the same way merge into one trunk and split apart near their ends.
- **Filters:** link type, issue, date range, minimum amount.
- **Zoom levels:** zoomed out shows clusters only; zoomed in shows individual names and amounts.
- **Mobile:** a stepped list. Pick a node, see where it goes, then keep tapping.

## 2. Profiles

Every node opens a full profile with these tabs:

- **Feed:** a filterable timeline of everything the actor has said and done. This includes posts on X, Bluesky and LinkedIn; quotes in news articles; op-eds; podcast and interview quotes; testimony; blog posts; filings; donations; and policy changes. Each item shows its date, type, and either a short verbatim quote or a plain summary, and links to the original.
- **Positions:** the actor's stance on every bill and issue, how it changed over time, and linked evidence for each change.
- **Money & filings:** every filing, newest first. That means each FEC transaction, each federal lobbying report (with its listed issues), each state lobbying report, 990s, RFI and docket comments, and bill position letters. Each links to the original document.
- **People:** executives, policy staff, board members and former government staff, with where each worked before and after.
- **Connections:** every link in and out, grouped by type. Each one opens on the map.
- **Conflict flags:** places where the feed and the filings disagree. For example, a statement supporting regulation alongside money spent against a bill's sponsor.

Bills, races and rules get **target pages**: everyone who pushed on that target, how they did it, and the money behind each side.

## 3. Actors

- **Labs:** Anthropic, OpenAI, Google DeepMind, Meta, xAI, Microsoft, Amazon, Nvidia, Apple, Perplexity, Scale AI, Palantir, Mistral, Cohere, Safe Superintelligence, Thinking Machines
- **People:** Marc Andreessen, Ben Horowitz, Vinod Khosla, Reid Hoffman, Peter Thiel, Joe Lonsdale, Garry Tan, Chris Larsen, Greg & Anna Brockman, Sam Altman, Dario Amodei, Demis Hassabis, Mark Zuckerberg, Elon Musk, Jensen Huang, Satya Nadella, Sundar Pichai, Mustafa Suleyman, Eric Schmidt, David Sacks, Jaan Tallinn, Dustin Moskovitz. Add anyone else you find funding, testifying or campaigning on AI policy.
- **Think tanks and advocacy groups:** Abundance Institute, R Street, Cato, AEI, Mercatus, Hoover, Foundation for American Innovation, Heritage, American Edge · Americans for Responsible Innovation, Center for AI Policy, Encode, Secure AI Project, FLI, CAIS Action Fund · IFP, CSET, CNAS, RAND, Brookings, CSIS · CDT, AI Now, EPIC, Public Citizen
- **PACs and funders:** Leading the Future (Think Big, American Mission), Public First / Public First Action (Jobs and Democracy, Defending Our Values), Innovation Council Action, Abundant Future, company and executive PACs, Open Philanthropy, a16z
- **Trade groups:** leave out, except two added by hand: Chamber of Progress and CCIA. NetChoice, TechNet, and the U.S. Chamber of Commerce were removed on 2026-11-16.
- **Targets:** every bill, race, rule and lawmaker that an actor's money, lobbying or positions reach. Don't track lawmakers' own positions.

## 4. Four ways in (link types and where to find them)

| Type | Examples | Sources |
|---|---|---|
| **Money** | PAC contributions and spending, lobbying, donations, grants to think tanks, investments | FEC API, Senate LDA API, state lobbying sites (CA Cal-Access, NY COELIG, MA Secretary of the Commonwealth, others), IRS 990s via ProPublica Nonprofit Explorer API, funder grant databases, Transformer AI Campaign Finance Tracker |
| **People** | Moves between government and companies, board seats, advisory roles, think tank fellows, former staff | Official bios, LinkedIn, OpenSecrets revolving-door data, board filings, press |
| **Ideas** | Think tank reports, op-eds, podcasts, testimony, model bill language | Think tank sites, GovInfo hearing transcripts, podcast/YouTube transcripts |
| **Positions** | Support or opposition filed on bills; RFI and docket comments | CA LegInfo committee analyses (support/oppose lists), position letters, Regulations.gov API, OSTP RFI responses (IFP aiactionplan.org), Congress.gov API, OpenStates API |

Starting points to mine, then confirm against primary sources: FLI AI Safety Index policy engagement indicator, LessWrong "AI companies' policy advocacy" (Sep 2025), AI Lab Watch, Midas Project Watchtower, Bellingcat and The Intercept's AI super PAC reporting, OpenSecrets.

## 5. Data model

| Table | Fields |
|---|---|
| `nodes` | id, type (lab / person / investor / think_tank / pac / nonprofit / funder / bill / race / rule / lawmaker), name, short descriptor, cluster, external IDs (FEC, LDA, EIN, OpenStates, bioguide) |
| `links` | from, to, type (money / person / idea / position), subtype (contribution, board seat, op-ed, oppose…), amount, date range, stance, source_url (required), archive_url |
| `feed_items` | node, date, kind (post / quote / op-ed / testimony / interview / filing / donation / position / policy change), excerpt (≤25 words) or summary, url (required), archive_url, platform, issue tags, stance, status (pending / approved) |
| `filings` | node, filing type (FEC / LDA / state lobbying / 990 / docket comment / position letter), period, amount, issues listed, document url (required), filing id |
| `facts` | node, plain sentence, url (required): the short summary shown in the map's side panel |

No row may exist without a URL.

## 6. Live data

- Importers that run daily and on demand: FEC API · Senate LDA API · ProPublica 990 API · Regulations.gov API · Congress.gov API · OpenStates API · state lobbying scrapers · GDELT and Google News RSS for article quotes · Bluesky firehose (X API if a key is provided) · podcast/YouTube transcripts via Whisper · company blogs and newsrooms via RSS.
- An LLM pulls out the speaker, a short quote, the stance and issue tags for each item. New items arrive as **pending**.
- A local **review screen** approves, edits or rejects pending items. Only approved items show on the map and profiles.
- Users can follow a profile or target for alerts (RSS feed plus email digest).
- Changelog of every addition and edit; public corrections log.

## 7. Views

1. **Influence map** (home): condensed (§1), click-to-trace, filters, search.
2. **Profiles** (§2).
3. **Target pages** for bills, races and rules (§2).
4. **Follow the money:** pick a starting point and see the dollars end to end (e.g. Brockman → Leading the Future → Think Big → races).
5. **Time slider:** watch the network grow from 2024 to now.
6. **Search** across every node, feed item and filing.
7. **Open data:** CSV/JSON download, methodology page, changelog.

## 8. Design

- **Direction:** an engineering drawing / schematic. A pale drafting-paper background with a faint dot grid, ink-black nodes and routed lines.
- **Colors:** paper `#F0F1EC` · panel `#FBFBF8` · ink `#1A1F1C` · money `#0E7A4D` (solid) · position `#3A47C4` (dashed) · muted `#4A524D` · rule `#D3D7CE`
- **Type:** Archivo Condensed Heavy for display (uppercase titles) · Public Sans for body · JetBrains Mono for labels and data
- **Signature:** the map itself. Nothing else competes with it.
- **Sources:** hyperlinks on the claim or date, in the position blue, underlined on hover. Never footnotes or source labels.
- **Copy:** short, plain, specific. No labels above section titles, no marketing lines. Section titles are descriptive with a twist ("Four ways in," "Lands on").
- **Quality floor:** works on a phone, visible keyboard focus, honors reduced-motion settings.

## 9. Stack

Next.js · D3 · Postgres (local, via Docker or Supabase local) · Meilisearch · Python or Node importers on a local scheduler (cron or a job runner) · Whisper for transcripts. Free API keys: FEC (api.data.gov), Congress.gov, OpenStates. Run everything locally.

## 10. Order of work

1. Set up the repo, database schema (§5) and design tokens (§8).
2. Research every actor in §3 across all four link types (§4). Write each item to the database with its URL and archive link. Log what you couldn't source in `data/gaps.md`.
3. Build the importers and the review screen (§6), and backfill everything they can reach.
4. Build the condensed influence map (§1), profiles and target pages (§2), and the other views (§7).
5. Build search, alerts and the open-data export.
6. Check every page against the rules in §0. Any item without a source URL gets removed.
