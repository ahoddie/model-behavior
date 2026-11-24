# Bill page spec

Approved design: direction A, round 2 ("fact sheet"), https://claude.ai/artifact/W45GToAVEr1ZVszTJMbmCp (CA SB 1047 as the worked example).
It replaces the bill branch of `components/TargetView.tsx` (rendered from `app/node/[id]/page.tsx`). Rules and agencies can use the same
layout; races keep `RaceView`.

Tone: neutral and explanatory, for beginners. No filler copy: no notes under headings, no labels that restate what's on screen, and no
"nothing on record" lines. If a block has no data, leave it out.

## Layout

Two columns on wide screens: a sticky left rail (200px) and the main column, 64px apart, inside the site's 1120px page.

```
| rail (sticky)       | main                                  |
| ← Policy            | SB 1047                               |
| Overview            | Title                                 |
| Trajectory          | [VETOED]                              |
| Positions           | Headline                              |
| People              | Description                           |
| Sources             | Facts grid                            |
| [Map it tile]       | Trajectory                            |
| Cite                | Positions: Support / Conditional / Oppose |
|                     | People                                |
|                     | Sources                               |
```

Generous spacing: about 88px above each section heading, 32px under it, 24px of padding in cards and fact rows.

## Rail (sticky, `top` clears the masthead)

In order:

1. **Back** (new shared component, `BackButton`, which replaces `BackLink`'s look and keeps its logic). A 32px round outlined arrow
   followed by the destination's name, 15px semibold, in a 44px-tall hit area. The name is where it goes: the previous on-site page's
   title (for example "Anthropic" or "Policy"); opened from outside the site, it falls back to the item's list ("All bills"). On hover the
   arrow slides 3px left and fills with ink. With no name available, it says "Back".
2. **Section links**, one word each: Overview, Trajectory, Positions, People, Sources. No counts. Show only the sections the bill has.
   The section in view gets a 2px carbon bar on the left and semibold text (the existing `SectionNav` behavior and glide).
3. **Map it** tile (`components/MapIt.tsx`, already built). The caption is the counts, for example "18 groups, 9 people".
4. **Cite**: a quiet text button (the existing `CiteButton`, page kind).

Follow by email and RSS are removed from this page.

## Overview

- **Number** as the h1: Archivo 62% width, weight 900, uppercase, `clamp(56px, 9vw, 104px)`. Bills only: "SB 1047", "H.R. 3447".
- **Official title**: 20px, weight 600, max about 34 characters a line, balanced.
- **Status stamp**: an outlined uppercase label in the display face, 24px above and 32px below. It shows the stage label (`STAGE_LABEL`).
  For vetoed or failed bills, add a struck circle in front.
- **Headline**: one sentence, 19px, max 58 characters a line. Says what the bill does and where it ended up.
- **Description**: about 50 words, 16px, muted. Inline links to the site's own pages only.
- **Facts grid**: a `dl` with an ink top rule and rows split by hairlines, `auto-fill, minmax(210px, 1fr)`. Fields, in order, each
  shown only when known:
  - Bill (jurisdiction and number)
  - Session
  - Author (linked to their page)
  - Co-sponsors (linked)
  - Introduced
  - Status (stage and date)
  - Amended (count)
  - Full text (the official page; the only outside link in the top half, marked ↗)

## Trajectory

A horizontal track of five stops at most, evenly spaced: the stage name above, a 24px pip on the line, and the date with any vote
tally below ("May 21 · 32–1"). Example stops: Introduced, Passed Senate, Passed Assembly, Final vote, and Vetoed or Signed.

- Passed stops are filled pips; the last stop is outlined, and a veto or failure gets a slash.
- Committee steps, amendments, chamber group labels, and citations are left off the track. The amendment count lives in the facts grid.
- Motion: on load the ink line fills from the first stop to the current one (about 1.4s, ease in and out), and each pip pops in a
  quarter second after the one before it. Off under `prefers-reduced-motion`.
- For a bill still moving, the line stops at the current stop and the later stops are drawn as hollow, muted pips.

## Positions

One section replaces "Who pushed" and "What they said". Three groups in this order, each with an h3, a muted count, and an ink rule:
**Support**, **Conditional** (support if amended, oppose unless amended, concerns, neutral), and **Oppose**. One quiet
right-aligned label on the first group's rule says "Spending covers all issues".

Cards, two across, 48px gutter, a hairline between rows. Each card:

- **Logo**, 40px (`Mark`; initials box when there's no logo).
- **Name**, bold, ink, linked to the org's Model Behavior page only (never its homepage).
- **Position and date**, 13px muted: "Co-sponsor · Apr 2". When an org changed position, show the latest and list the earlier one
  under its quote.
- **Spending**, 13px, figures in money gold: "$14.2M lobbying · $40.1M giving", omitted when both are zero.
- **Quote** in quotation marks, 16px, under the details. No speaker name. A small grey superscript citation number follows it. If
  there's only a summary and no quote, show the summary in muted text without quotation marks. With neither, show nothing.

Individuals are not cards here; they go under People.

## People

Rows, a hairline between each: a 28px initials circle, the name (semibold) with their role underneath (muted), the quote, and the side
("Support" in carbon, others muted) at the right end. Names link to the person's page.

## Sources

One list at the bottom, numbered, in two columns on wide screens and grouped under three small headings: Legislative record, Group
positions and statements, and Individuals. Each entry is the source's title linked to its URL with ↗. The grey superscripts in the
page are the only citation marks: they are buttons that scroll to their entry and briefly highlight it. There are no blue source
links in the body.

## Data each section needs

| Section | Data | Where it comes from |
| --- | --- | --- |
| Overview | number, title, jurisdiction, session, chamber, sponsor, introduced_date, stage, stage_date, source_url | `bills` via `getBillRecord` |
| Overview | headline, description, and their sources | `profile_text` (`getProfileText`), same as people and org pages |
| Overview | co-sponsors | position links whose note says sponsor or co-source; a structured field later |
| Overview | amendment count | `bill_actions` rows that say amended |
| Trajectory | key stops and tallies | `bill_actions` (kind introduced, passed, governor, enacted, vetoed, failed) plus `bill_votes` floor votes |
| Positions | org, stance, date, note, source | `getTarget(id).pushes`, deduped per org to the latest position (keep earlier ones) |
| Positions | quote or summary | `getTarget(id).statements` for that org: the latest with an excerpt |
| Positions | spending | LDA filings total per org (`filings.filing_type = 'LDA'`) and political giving (money links with contribution, independent expenditure, donation, or transfer) |
| People | person, role, quote, stance | pushes and statements whose actor type is person |
| Map it | link counts by type | count of the bill's links by type |
| Sources | every URL cited above, deduped and numbered in order of first use | collected while rendering |

Stance buckets: `support` goes to Support; `support_if_amended`, `neutral`, `mixed`, and a null stance with an "unless amended" or
"concerns" note go to Conditional; `oppose` goes to Oppose.

## Phone (below 760px)

- One column with 16px gutters. The rail is hidden.
- A sticky bar sits under the masthead: the Back icon (44px round arrow, aria-label "Back to Policy") on the left, the one-word
  section links in a horizontal scroller in the middle (the current one in carbon), and the 44px Map it icon on the right.
- Trajectory turns vertical: the line runs down the left, each stop has its pip, with the name and date beside it.
- Position cards stack one across. People rows put the quote and side under the name.
- Sources are one column.

## Components to share across page types

- `MapIt` (built): tile, chip, and icon.
- `BackButton`: the full button and the icon variant.
- The rail and phone bar: one `ItemRail` that takes sections, back target, and map counts, so org, person, rule, and agency pages use
  the same frame.
