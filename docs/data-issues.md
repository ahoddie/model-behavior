# Data issues found while writing profile text

Problems in the shared data (nodes, facts, links) found while writing profile text (`data/profiles/`). Each line: entity id, what looks wrong, evidence. The cleanup session (2026-11-24) marked each line with its outcome: **Fixed** (with what changed), **Unverifiable** (left as it was; the sources don't settle it), or **Needs Allegra** (a judgment call). Merges are in merge_log (method 'human'); `pnpm er:revert --ids N` undoes one.

- abundance-institute: descriptor says Salt Lake City; ProPublica lists North Logan, UT.
- jack-clark: descriptor says Head of Policy; Anthropic now lists him as Head of Public Benefit.
- perplexity: typed nonprofit; it is a company.

## orgs-02
- america-pac: treasurer is Chris Young on FEC but chris-gober per InfluenceWatch.
- a16z: $50M to Leading the Future booked as a16z's, while notes credit half to each co-founder (money-credit rule).
- foundation-for-american-innovation: Coefficient Giving total $1.952M vs two grants on file summing $976K (likely double count).
- rand: Good Ventures ($42M) and Coefficient Giving ($45.4M) gifts may overlap.
- public-first: shows lobbying contacts (House, Energy Dept.), unlikely for a super PAC; likely misattributed.
- Duplicate nodes: fli / future-of-life-institute; ostp / agency-office-of-science-and-technology-policy-ostp. **Fixed:** merged into fli (merge_log 38) and agency-office-of-science-and-technology-policy-ostp (35).
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
- sarah-stern / sarah-may-stern: likely the same person. **Fixed:** merged into sarah-may-stern (42); her text now cites both the 990 and hudson.org.
- us-ndaa-ai-preemption-2025 / us-ndaa-fy2026-ai-preemption: likely duplicate bill nodes. **Fixed:** merged into us-ndaa-fy2026-ai-preemption (41); the old curated stage entry is gone.
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
- machine-intelligence-research-institute / miri: duplicate nodes. **Fixed:** merged into miri (39).
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

## orgs-12
- social-media-victims-law-center: typed lab. Descriptor says it represents families suing Character.AI and Google and that five cases settled in Jan 2026; the bgov source doesn't name the firm or give a count, and the firm's page doesn't name Character.AI.
- Duplicate nodes: ent_pac_smart-justice-california-action-fund_8cfde2 / smart-justice-california-action-fund. **Fixed:** merged into smart-justice-california-action-fund (40), now typed pac (a California state committee, FPPC 1423131).
- workers-vote, working-families-party-pac, wfw-action-fund: typed nonprofit; FEC lists them as a super PAC or hybrid PACs.
- shaunna-thomas: descriptor reads "Principle, SLT Strategies" (Principal). UltraViolet's text links her as its co-founder on name match only; confirm it's the same person as the Guardrails Alliance co-founder.

## people-02
- eliezer-yudkowsky: a statement credited to him (supports an IPCC-like body for AI) is ITIF's Hodan Omaar's, crediting the idea to Eric Schmidt and Mustafa Suleyman (https://itif.org/publications/2023/12/06/statement-to-the-us-senate-ai-insight-forum-on-risk-alignment-and-doomsday-scenarios/).
- jensen-huang: descriptor "Nvidia founder and CEO" is stale (8-K: resigned Nov 12, 2026).
- Duplicate agency nodes: ftc / agency-federal-trade-commission-ftc; national-security-council / agency-natl-security-council-nsc; commerce-department / agency-commerce-dept-of-doc. **Fixed:** merged (33, 34, 32). These were first merged on 2026-11-15; the research loader re-created the old ids on 2026-11-17. Ingest now follows applied merges (`canonicalId` in scripts/lib/ingest.ts), so a reload can't bring them back.
- ron-conway: a Verge statement summary says he "regrets funding pro-AI efforts and now opposes federal AI regulation"; looks unreliable, check against the article.

## people-01
- marc-andreessen: money rows show $11.9M to Fairshake; FEC Schedule A (C00835959) lists five personal gifts totaling $45.4M (2023–2025).
- joe-lonsdale: Leading the Future row has no amount, and the cited article gives none for him; the $250K it reports was from Lonsdale Enterprises to American Mission.
- daniel-ziegler: node name reversed ("Ziegler Daniel").

## people-04
- ned-finkle: NVIDIA's blog says vice president of government affairs; CNAS (https://www.cnas.org/people/ned-finkle) says vice president of external affairs.
- alex-karp: descriptor's "~$1.9M to Trump's super PAC (per Forbes)" has no source or money row.
- anna-brockman / greg-brockman: FEC row gives $12.5M under her name; The Next Web says the couple jointly gave $25M (likely half of a joint gift, recorded per spouse).
- richard-fontaine: a relation typed "revolving door" is an Anthropic advisory council seat, not a government post.

## people-03
- yann-lecun: the AMI Labs co-founder relation appears three times; one is dated 2026-03-10 (funding date per tech.eu), not the founding (Dec 2025 per Wikipedia).
- elizabeth-wirsching: descriptor "Retired, Not Employed"; the Transformer tracker says only "not employed".

## people-05
- donovan-liam: node name "Liam Donavan"; the Transformer tracker (https://elections.transformernews.ai/pacs/C00928390) lists "Donovan Liam". Spelling and order unconfirmed.
- brian-rice: a Wired statement says he "opposes federal binding rules on AI, favoring state regulation"; looks doubtful, not backed by the Verge statement.
- duncan-crabtree-ireland: SAG-AFTRA's NO FAKES Act support is only in the descriptor.

## people-06
- justin-maturo: a fact names "Rep. Kelly Tran"; the LDA filing says only "RepTran" (https://lda.gov/filings/public/filing/90cc74f3-1bd5-40c1-bba0-8d6e00fbb200/print/).
- palmer-luckey: descriptor's "$5.9M to Republicans" is unverified (inkl source blocked).
- paul-nakasone: fact says "Vanderbilt Institute of National Defense"; node is "Vanderbilt Institute of National Security"; Vanderbilt's URL says Institute for National Defense and Global Security.
- santi-ruiz: descriptor stresses his IFP fellowship; facts show his current role is at Anthropic.

## people-07
- sunny-gandhi: descriptor says Gandhi "filed Encode's LDA registration"; no fact supports it.
- todor-markov: descriptor says "Research Scientist, Meta Superintelligence Labs"; no fact supports it, and his site names no employer.
- stewart-barber: descriptor says "White House legislative affairs"; NVIDIA's LD-1 lists only "White House (2019–2021)".
- linkify false match: "White House Office" (a node name) matches inside "White House Office of Management and Budget".

## people-08
- brian-singerman: descriptor "Managing Partner, Quiet Capital" is wrong; TechCrunch says Lee Linden is managing partner and Singerman is raising a new fund, GPx, with him.
- brad-smith: a statement about Lord Booth-Smith and AISI (Transformer, 2026-10-16) is credited to him by mistake.
- edward-fenster: descriptor stale; Sunrun's bio says co-executive chair only until July 2026, now vice-chair.
- clark-minor: a fact lists his HHS CIO job as past; FedScoop says his exit is unconfirmed and HHS still lists him as CIO.
- holmes-wilson: "Co-Founder, Quiet" has no support.
- chris-hyams: "Not Employed" is stale; Fortune says he teaches at Huston-Tillotson University.
- carlos-trujillo: one fact says "2025 filing"; the others say 2026.

## people-10
- gary-marcus: descriptor says he "testified to the Senate in 2023"; no fact on file supports it.
- zane-grube: descriptor says "Trader"; the source gives only his employer (Jane Street).

## people-09
- nicholas-joseph: descriptor "Member Of Technical Staff" (FEC occupation); TechCrunch and 80,000 Hours say he's an Anthropic co-founder and head of pretraining.
- jeremy-liew: descriptor "Venture Capital Consultant, Self Employed"; Wikipedia says he's still a Lightspeed partner, though his Lightspeed fact is labeled "Previously".
- joel-kaplan: Meta's page says Chief Global Affairs Officer; Fortune says president of global affairs.
- More duplicate agency nodes: white-house / agency-executive-office-of-the-president-eop. **Fixed:** merged (36).

## Bills (public bill records)
- us-ndaa-ai-preemption-2025 / us-ndaa-fy2026-ai-preemption: two nodes for the same FY2026 NDAA preemption push; both carry stage failed from data/bills/curated-stages.json. **Fixed:** merged (41).
- AI relevance for federal and California bills is matched on the title (and, for California, NCSL's AI list), so bills with generic titles, such as omnibus or appropriations bills carrying AI provisions, are only included when they're on the map. CRS legislative subjects in GovInfo matched no bills.
- State bills other than California's come from NCSL's AI database, which starts in 2025. State bills from 2023–24 are only present when they're on the map (for example, the Colorado AI Act, SB24-205, has a research stage).
- NCSL counts some loosely related bills as AI legislation (budget bills with an AI line, STEM councils); they're kept, with ai_match 'ncsl'.
- State bill links (source_url) point to the public State Net bill text NCSL links, not to the legislature's own page; map bills keep their official link on the node.
- ny-a3283-2025 (gene synthesis screening) isn't on NCSL's AI list, so it has no bill record or stage.
- Thin states (under 15 AI bills for 2025–26): Wyoming 7; Alaska, DC, and South Dakota 9; Nebraska and New Hampshire 13. They look like small legislatures rather than gaps.

## thin-people-01
- anne-marie-slaughter: descriptor "CEO" looks stale; New America's staff page lists her as Senior Advisor.
- anil-dash ("CEO of Glitch"), jane-hartley ("former ambassador to the UK"), adam-green ("PCCC cofounder"): descriptor claims with no supporting relation or source.
- romesh-wadhwani / wadhwani-foundation: the writers disagree on whether the $5M CSIS gift was his own or the foundation's; check the CSIS release.
- Descriptor typos: "Principle" (shaunna-thomas), "Quantitive" (dylan-mavrides).

## thin-people-02
- avril-haines: descriptor says "Incoming" president; the Sept 28 start date has passed (no year on file).
- cameron-winklevoss: $250,000 America PAC gift dated 2024-01-01 (looks like a placeholder date).
- cody-venzke: date_start 2025-01-01, but the source is a December 2025 release (placeholder date).
- california-leads: a relation note says "Meta-funded"; its profile record shows Google and Meta.
- connor-leahy: descriptor says he founded EleutherAI and Conjecture; no supporting fact.

## thin-people-03
- Descriptor claims with no supporting fact: des-browne ("former UK Defence Secretary"), deven-parekh ("Managing Director, Insight Partners"), eric-horvitz ("Microsoft Chief Scientific Officer"; his one source is Rebecca Finlay's PAI page), gabriel-alfour ("co-founded Conjecture"; the fact says he helped found ControlAI), jill-barclay ("former Targeted Victory managing director").
- jina-john: date_start 2026-01-01, but the source is a June 2026 release (placeholder date).

## thin-people-04
- karthik-ganapathy ("former Sanders aide"; elsewhere a Semafor source calls him a former Bernie Sanders spokesman, so check), kemba-walden ("President, Paladin Global Institute"): descriptor claims with no supporting fact on their own nodes.
- m-liss-hadley: node source is an FEC API URL with api_key=DEMO_KEY; the committee page is https://www.fec.gov/data/committee/C00930503/?cycle=2026&tab=about-committee.

## thin-people-05
- sarah-may-stern / sarah-stern: likely the same Hudson Institute board chair (990 "Chair" vs hudson.org "President of the Board of Trustees"). **Fixed:** merged (42).
- nathan-click ("longtime adviser to Gov. Gavin Newsom"), rob-flaherty ("Democratic campaign veteran"): descriptor claims with no supporting fact.
- phil-cox: only source is InfluenceWatch citing the New York Times.

## thin-people-06
- tyler-winklevoss: America PAC gift dated 2024-01-01 (placeholder); InfluenceWatch is the only source.
- taylor-barkley: relation typed "executive"; the 2024 Form 990 lists him as "Director".

## lawmakers-02
- lawmaker-rich-mccormick: American Mission's two Oct 15 filings (2028668, 2039451) may double-count ($402,780 total vs at least $195,000).
- lawmaker-susan-collins: two Form 9 filings on the same date (2013889, 2015422) may overlap ($810,294 vs at least $686,000).
- lawmaker-blake-moore: descriptor "Recipient of Anthropic PAC contribution" is a placeholder; Clerk lists UT-1, FEC lists UT-2 for 2026.
- lawmaker-amerish-bera: Clerk lists CA-6, FEC lists CA-3 for 2026.
- lawmaker-cindy-hyde-smith: node name "Hyde Smith" lacks the hyphen.
- lawmaker-mike-rounds, -jerry-moran, -patty-murray, -ritchie-torres (ids approximate): no Party fact; party only in the descriptor.
- Money rows don't carry support/oppose for super PAC spending in the dossier; it's only in links.stance.

## lawmakers-01
- lawmaker-darline-graham: facts give "Role: U.S. Senator, SC" and website dgraham.senate.gov, apparently copied from Lindsey Graham; FEC S6SC04437 is a challenger. Building the Future and American Mission report ~$4.6M of general-election spending supporting her, and the FEC API records the candidate as "GRAHAM, DARLINE" (S6SC04437). A fact on lindsey-graham (Ballotpedia, 2026-07-13) says he died in office on July 11, 2026, so she is likely the replacement candidate; her node's "Role: U.S. Senator" and Senate website facts still look copied and should be checked.
- lawmaker-celeste-maloy: House Clerk lists UT-2; FEC lists her 2026 race in UT-3.
- lawmaker-roger-marshall: node source_url uses old House ID H6KS01179; facts use S0KS00315.
- lawmaker-colin-allred: node source_url H6TX33082 differs from facts' H8TX32098.
- lawmaker-thomas-feely: campaigns as "Jay Feely".

## lawmakers-03
- lawmaker-lindsey-graham: descriptor calls him an "incumbent" 2026 candidate; a fact (Ballotpedia, 2026-07-13) says he died in office on July 11, 2026.
- lawmaker-jared-moskowitz: House Clerk lists FL-23 (https://clerk.house.gov/members/M001217); FEC and descriptor list FL-25 for 2026.
- lawmaker-nikki-budzinski: stance blank for Public First Action's ~$105,000 independent expenditure (https://docquery.fec.gov/cgi-bin/forms/C30003586/1952561/).

## agencies-02
- Duplicate agency pairs (lobbying rows sit on the second id): ftc / agency-federal-trade-commission-ftc; ostp / agency-office-of-science-and-technology-policy-ostp; national-security-council / agency-natl-security-council-nsc; white-house / agency-executive-office-of-the-president-eop; commerce-department / agency-commerce-dept-of-doc; osd / agency-office-of-the-secretary-of-defense. **Fixed:** all six merged into the agency-* ids (32-37); the agencies-02 texts for the old ids were dropped, keeping agencies-01's.
- commerce-department: descriptor says it runs CAISI; its source (ifp.org/author/saif-khan) doesn't say so.
- nscai: descriptor gives 2018–2021; Wikidata Q66087960 says founded 2019.
- white-house (David Sacks stepped down March 2026) and ostp (Sriram Krishnan left June 2026): the sources cited for these relations predate the events.

## agencies-01
- public-first: the LDA filing naming Energy and the Air Force (lda.gov …/303b23e4…) is for First Public Hydrogen Authority, not the super PAC (wrong client match).
- alliance-for-a-better-future: the LDA filing naming OMB and Interior (lda.gov …/5d998492…) is for Fund for a Better Future / Alliance for Wildfire Resilience (wrong client match).
- Agency lobbying counts in profile text for the House, Senate, White House Office, and Commerce are minimums: the money list behind them was capped at 15 counterparties.
