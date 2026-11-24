# Data issues found while writing profile text

Problems in the shared data (nodes, facts, links) found while writing profile text (`data/profiles/`). Not fixed here; for a cleanup session. Each line: entity id, what looks wrong, evidence.

- abundance-institute: descriptor says Salt Lake City; ProPublica lists North Logan, UT.
- jack-clark: descriptor says Head of Policy; Anthropic now lists him as Head of Public Benefit.
- perplexity: typed nonprofit; it is a company.

## orgs-02
- america-pac: treasurer is Chris Young on FEC but chris-gober per InfluenceWatch.
- a16z: $50M to Leading the Future booked as a16z's, while notes credit half to each co-founder (money-credit rule).
- foundation-for-american-innovation: Coefficient Giving total $1.952M vs two grants on file summing $976K (likely double count).
- rand: Good Ventures ($42M) and Coefficient Giving ($45.4M) gifts may overlap.
- public-first: shows lobbying contacts (House, Energy Dept.), unlikely for a super PAC; likely misattributed.
- Duplicate nodes: fli / future-of-life-institute; ostp / agency-office-of-science-and-technology-policy-ostp.
- humanity-ai: descriptor names MacArthur and Omidyar as co-chairs; the cited article doesn't.
- mozilla: typed lab.

## orgs-01
- abundant-future: FEC money row shows $3.5M from Public First Action; a Transformer fact says $500,000.
- nvidia / jensen-huang: "Leader: Jensen Huang (CEO)" fact and jensen-huang descriptor are stale; a Nov 12, 2026 8-K on file says he resigned as CEO (https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000082/nvidiaannouncesceotransiti.htm).
- open-philanthropy: founded 2011 per one fact; the Karnofsky relation says co-founded 2014. Facts' founders differ from the descriptor ("Good Ventures and GiveWell").
- scale-ai: "Meta took 49%" appears only in the descriptor, with no supporting fact.

## orgs-03
- lawmaker-mike-rogers: node says AL-3 House, but American Mission/ABF spending in Sept 2026 went to Senate races; likely the Michigan Senate candidate (unconfirmed).
- macarthur-foundation: a GrantedAI fact dates Humanity AI's announcement to Feb 25, 2026; MacArthur's press release says Oct 14, 2025.
- macarthur-foundation money: $9.8M to ai-now and $4M to brookings cite GrantedAI, which says $2M each.
- cset: Open Philanthropy money totals $160.25M; CSET's own page says total funding was just over $100M by 2021; may overlap Good Ventures' $52.9M.
- humanity-ai: "co-chaired by MacArthur and Omidyar" has no supporting fact. dream-nyc: "donors include Anthropic and OpenAI staff" has no supporting fact.

## orgs-04
- smp: lobbying row (SMP to the House) is for SMP Automotive Systems Alabama, a Vogel Group client, not the super PAC (https://lda.gov/filings/public/filing/4e4a55d6-06fc-4f87-8291-7e7ec42b1c8c).
- ifp: founding year 2022 (Wikipedia) vs 2021 (descriptor, Caleb Watney's IFP bio).
- sarah-stern / sarah-may-stern: likely the same person.
- us-ndaa-ai-preemption-2025 / us-ndaa-fy2026-ai-preemption: likely duplicate bill nodes.
- cindy-cohn: descriptor says Executive Director; Data & Society's Form 990 lists her as a director.
- Descriptor claims with no source: IFS "polling 3 to 1", Chamber of Progress member list, AI Futures Project "AI 2040: Plan A".

## orgs-06
- ff-pac: Wikipedia says Future Forward formed in 2020; FEC shows registration Feb 8, 2018.
- tech-justice-law-project: descriptor mentions suits against OpenAI; the record shows only the Character.AI suit.
- sag-aftra: "2026 studio contract with AI protections" in the descriptor has no supporting fact.
- consumer-reports: "active on AI and privacy policy" in the descriptor has no supporting fact.
- craft-ventures: descriptor says founded by David Sacks; Wikipedia says Sacks and Bill Lee.

## orgs-05
- daniel-castro: descriptor says Vice President; ITIF's about page lists him as president. robert-atkinson's "President" (2024 Form 990) looks stale.
- build-american-ai: money row shows $500,000 from Leading the Future (FEC); a Bisnow fact says $5M. Its Leading the Future relation is typed "person".
- gates-foundation: LawZero money row cites Wikipedia, which gives no amount; the Gates grant page (INV-091193) shows $4,995,896, July 2025 (descriptor says Aug 2025).
- hoover: "oppose SB 1047" is set on the institution but is fellow Lee Ohanian's podcast view.
- maga-inc: Taylor Budowich named director in 2022, before this committee's 2024 registration (C00892471).
- dccc: name stored as "Dccc".

## orgs-07
- machine-intelligence-research-institute / miri: duplicate nodes.
- ai-safety-fund: website on file (aisafetyfund.org) is a small donor-funded "AI Safety Research Fund"; the Frontier Model Forum's AI Safety Fund is aisfund.org. CDT's donor list doesn't say which gave.
- CDT donor tiers: cdt.org/financials shows only 2025; money rows and the CZI descriptor also claim 2024.
- perplexity: money row shows $200,000 in 2 gifts to Leading the Future; the fact and FEC PDF say $100,000 (likely double count).
- new-york-times-company: $1.225M Ford Foundation grant is from Ford's Form 990, unverified.
- haun-ventures: a16z investment row is doubtful; the cited TechCrunch story is about Haun leaving a16z.
- Wrong types: new-york-times-company, oracle, amd typed lab; movement-voter-pac typed nonprofit (it's a hybrid PAC).
- amd: export-control lobbying in the descriptor has no supporting fact.

## orgs-08
- anthony-aguirre / future-of-life-institute: node says Aguirre is FLI President and CEO; Wikipedia's infobox names Max Tegmark as president while its 2025 section calls Aguirre president.
- forge-the-future-project: descriptor says super PAC; its type fact (Tech Oversight Project) says state-level PAC (527).
- lonsdale-enterprises: typed nonprofit; the record describes an investment entity.
- defend-american-jobs, protect-progress: descriptors are bare FEC IDs; Wikipedia's Fairshake page says they're Fairshake affiliates (Republican and Democratic, respectively).
- smart-justice-california-action-fund: descriptor is just "Organization".
- law-ai: couldn't confirm what it does (site blocks fetching; 990 page didn't load).

## orgs-10
- isomorphic-labs / demis-hassabis: a Fortune fact (2026-08-05) says Hassabis became chairman of Isomorphic Labs; the article says chairman of Google DeepMind and Alphabet chief scientist.
- jane-street: money row credits the firm as a METR funder; metr.org/about names "individuals from Jane Street", not the firm (money-credit rule).
- founders-pledge: lawzero.org credits Jaan Tallinn "with Founders Pledge Inc."; the LawZero gift may be Tallinn's, given through Founders Pledge.

## orgs-09
- humanity-ai: descriptor says formed "to counter AI-industry influence" and co-chaired by MacArthur and Omidyar; the Broadband Breakfast source names no co-chairs and describes the aim as AI that advances "public benefit over private gain."
- aft-solidarity: FEC fact calls it an independent-expenditure filer, "not a committee"; City & State calls it a super PAC.
- beri: SFF lists four 2021 grants from Jed McCaleb ($250k, $17k, $17k, $14k); the record has only the $250k one, with no date.
- wadhwani-foundation: the $5M CSIS commitment was Romesh Wadhwani's own, not the foundation's (money-credit rule).
- Generic descriptors ("Organization"): way-to-win-action-fund, elevate-america, aaup, and others.

## orgs-11
- rutan-tucker-llp, singleton-schreiber-llp: typed nonprofit; both are law-firm LLPs.
- stronger-together-pa: typed nonprofit; FEC lists it as a super PAC (https://www.fec.gov/data/committee/C00936153/).
- openai-foundation: descriptor's "$25B long-term pledge", "$1B planned for 2026", and "controlling OpenAI Group" have no supporting fact.
