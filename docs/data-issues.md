# Data issues found while writing profile text

Problems in the shared data (nodes, facts, links) found while writing profile text (`data/profiles/`). Each line: entity id, what looks wrong, evidence. The cleanup session (2026-11-24) marked each line with its outcome: **Fixed** (with what changed), **Unverifiable** (left as it was; the sources don't settle it), or **Needs Allegra** (a judgment call). Merges are in merge_log (method 'human'); `pnpm er:revert --ids N` undoes one.

- abundance-institute: descriptor says Salt Lake City; ProPublica lists North Logan, UT. **Unverifiable:** ProPublica's address is a filing address, not necessarily its office. The city was dropped from the descriptor ("Utah nonprofit").
- jack-clark: descriptor says Head of Policy; Anthropic now lists him as Head of Public Benefit. **Unverifiable:** anthropic.com doesn't list his title. The disputed title was dropped; the descriptor now reads "Anthropic co-founder".
- perplexity: typed nonprofit; it is a company. **Fixed:** typed lab, the schema's company type.

## orgs-02
- america-pac: treasurer is Chris Young on FEC but chris-gober per InfluenceWatch. **Unverifiable:** FEC (primary) names Chris Young; no relation on file says Gober is treasurer, so nothing changed.
- a16z: $50M to Leading the Future booked as a16z's, while notes credit half to each co-founder (money-credit rule). **Fixed:** Allegra chose to credit the founders, following the FEC memo attribution. The two a16z rows (links 10 and 12) moved to links_removed, and the filings' memo lines (SA11A.539627, .542040, .603472, .603473) are now four $12.5M rows under Andreessen and Horowitz, so each shows $25M to Leading the Future and $45.4M to Fairshake, and a16z shows none. Its text says the founders gave through the firm. The same rule moved Singleton Schreiber's $50,000 to Abundant Future to Gerald Singleton (memo line A-29). No other partnership or LLC gift on file carries a memo attribution. Two undated Washington Sun rows ($12.5M each) that double-counted this money were removed.
- foundation-for-american-innovation: Coefficient Giving total $1.952M vs two grants on file summing $976K (likely double count). **Fixed:** the two grants were each recorded twice; duplicates removed (links_removed 27802, 27803).
- rand: Good Ventures ($42M) and Coefficient Giving ($45.4M) gifts may overlap. **Fixed in part:** Allegra chose to credit the payer. Where a Coefficient Giving grant matches a Good Ventures 990-PF row exactly, and the 990-PF fiscal year (July to June) covers the grant month or comes after it, the Coefficient Giving row moved to links_removed (reason "recommended: …", kept_id = the Good Ventures row). The Good Ventures row now shows "Recommended by Coefficient Giving", and Coefficient Giving's page lists it under "Grants it recommended", outside its totals. That covers eight pairs: RAND ×3, CAIS ×3, and Epoch AI ×2. **Fixed (orchestrator's rule, 2026-11-24):** the only aim is to avoid double counting, so a Coefficient Giving grant is excluded only when a Good Ventures payment matches it. RAND's $10.5M (Oct. 2023) and $5M (July 2024) grants each equal a Good Ventures 990-PF payment in the fiscal year that ended one to four months before the grant page's date (38001, 38005). They now count once, under Good Ventures, with "Recommended by Coefficient Giving." That makes ten pairs in all. Coefficient Giving grants with no matching payment stay in totals, credited to Coefficient Giving, with the note "Payer not identified in Good Ventures filings." They are RAND $3.4M and $6M (Aug. 2024), CSET $38.92M and $3.33M (Aug. 2021), CNAS $5.15M (July 2022) and $8.32M (June 2025), CAIS $1.43M (Feb. 2023), and Epoch AI's four grants from 2023 to 2025. **Open, may double-count:** Good Ventures' FY2024 (July 2024 to June 2025) 990-PF lists two RAND payments that match no grant page, $666,667 (38008) and $2,000,000 (38007), $2.67M in all. They may be installments of RAND's $3.4M two-year (9142) or $6M (9144) grants from August 2024, so up to $2.67M could be counted twice. Nothing is netted out until a source ties them together. Good Ventures' other unmatched RAND payments ($666,667 a year from FY2022 to FY2024, $2M in FY2023, and $10M in FY2022) match no grant page on file.
- public-first: shows lobbying contacts (House, Energy Dept.), unlikely for a super PAC; likely misattributed. **Fixed:** see agencies-01; the LDA rows were for First Public Hydrogen Authority.
- Duplicate nodes: fli / future-of-life-institute; ostp / agency-office-of-science-and-technology-policy-ostp. **Fixed:** merged into fli (merge_log 38) and agency-office-of-science-and-technology-policy-ostp (35).
- humanity-ai: descriptor names MacArthur and Omidyar as co-chairs; the cited article doesn't. **Fixed:** co-chairs dropped from the descriptor; the profile text never claimed them.
- mozilla: typed lab. **Fixed:** (no change): lab is the schema's type for companies (Amazon, Google, Microsoft), and the node is the browser maker.

## orgs-01
- abundant-future: FEC money row shows $3.5M from Public First Action; a Transformer fact says $500,000. **Fixed (no change):** FEC shows three Public First Action gifts ($500K Apr 13, $1M Aug 10, $2M Sept 16, 2026). Transformer's $500K is the first one only, so $3.5M stands.
- nvidia / jensen-huang: "Leader: Jensen Huang (CEO)" fact and jensen-huang descriptor are stale; a Nov 12, 2026 8-K on file says he resigned as CEO (https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000082/nvidiaannouncesceotransiti.htm). **Fixed, and the premise is out of date:** the 8-K is genuine (EDGAR accession 0001045810-26-000082, Item 5.02), but a second 8-K filed Nov 23, 2026 (0001045810-26-000090) says the board reinstated Huang as President and CEO on Nov 22. The Leader fact and descriptor are correct again; reinstatement facts were added to both nodes, and the nvidia and jensen-huang texts now say he resigned and was reinstated ten days later.
- open-philanthropy: founded 2011 per one fact; the Karnofsky relation says co-founded 2014. Facts' founders differ from the descriptor ("Good Ventures and GiveWell"). **Fixed:** (no change): both are right for different milestones (GiveWell Labs began in 2011 and took the Open Philanthropy name in 2014).
- scale-ai: "Meta took 49%" appears only in the descriptor, with no supporting fact. **Fixed:** Scale's own announcement says only that Meta holds a minority stake (49% is press reporting). The descriptor now says "Meta bought a minority stake in 2025", with a fact citing Scale's post.

## orgs-03
- lawmaker-mike-rogers: node says AL-3 House, but American Mission/ABF spending in Sept 2026 went to Senate races; likely the Michigan Senate candidate (unconfirmed). **Unverifiable:** left for the elections pass (below).
- macarthur-foundation: a GrantedAI fact dates Humanity AI's announcement to Feb 25, 2026; MacArthur's press release says Oct 14, 2025. **Unverifiable:** left for a follow-up; MacArthur's own release is the better date.
- macarthur-foundation money: $9.8M to ai-now and $4M to brookings cite GrantedAI, which says $2M each. **Fixed:** the press-release grants were each recorded two or three times; duplicates removed (29554, 32831, 29555). AI Now now shows $5.8M (two $2M grants, $1.5M in 2017, $300K in 2025) and Brookings $2M. **Unverifiable:** whether the 2025 "general operations" $2M grant from MacArthur's grant search is the same as the Feb 2026 press-release grant.
- cset: Open Philanthropy money totals $160.25M; CSET's own page says total funding was just over $100M by 2021; may overlap Good Ventures' $52.9M. **Fixed in part:** the $55M launch grant was recorded twice; one copy removed (27804), so Coefficient Giving's total is $105.25M and its text now says $105 million. The Good Ventures overlap is resolved under rand: no Good Ventures payment matches the two August 2021 grants, so they stay counted under Coefficient Giving.
- humanity-ai: "co-chaired by MacArthur and Omidyar" has no supporting fact. dream-nyc: "donors include Anthropic and OpenAI staff" has no supporting fact. **Fixed:** dropped from the descriptor. Dream NYC's "donors include Anthropic and OpenAI staff" was dropped too.

## orgs-04
- smp: lobbying row (SMP to the House) is for SMP Automotive Systems Alabama, a Vogel Group client, not the super PAC (https://lda.gov/filings/public/filing/4e4a55d6-06fc-4f87-8291-7e7ec42b1c8c). **Fixed:** both LDA filings and their House links removed; smp, public-first, and alliance-for-a-better-future carry external_ids.lda_skip, which the LDA importer now honors.
- ifp: founding year 2022 (Wikipedia) vs 2021 (descriptor, Caleb Watney's IFP bio). **Unverifiable:** the sources conflict; the year was dropped from the descriptor.
- sarah-stern / sarah-may-stern: likely the same person. **Fixed:** merged into sarah-may-stern (42); her text now cites both the 990 and hudson.org.
- us-ndaa-ai-preemption-2025 / us-ndaa-fy2026-ai-preemption: likely duplicate bill nodes. **Fixed:** merged into us-ndaa-fy2026-ai-preemption (41); the old curated stage entry is gone.
- cindy-cohn: descriptor says Executive Director; Data & Society's Form 990 lists her as a director. **Unverifiable:** the two titles may both hold (EFF staff, Data & Society board); left as is.
- Descriptor claims with no source: IFS "polling 3 to 1", Chamber of Progress member list, AI Futures Project "AI 2040: Plan A". **Fixed:** all three claims dropped from the descriptors.

## orgs-06
- ff-pac: Wikipedia says Future Forward formed in 2020; FEC shows registration Feb 8, 2018. **Fixed:** FEC (primary) shows registration on Feb 8, 2018; the descriptor says so.
- tech-justice-law-project: descriptor mentions suits against OpenAI; the record shows only the Character.AI suit. **Fixed:** a fact now cites TJLP's own release on its suit against OpenAI.
- sag-aftra: "2026 studio contract with AI protections" in the descriptor has no supporting fact. **Fixed:** dropped from the descriptor, and the unsourced NO FAKES claim with it.
- consumer-reports: "active on AI and privacy policy" in the descriptor has no supporting fact. **Fixed:** descriptor now "Consumer advocacy nonprofit".
- craft-ventures: descriptor says founded by David Sacks; Wikipedia says Sacks and Bill Lee. **Fixed:** descriptor and a fact now say Sacks and Bill Lee; the text already did.

## orgs-05
- daniel-castro: descriptor says Vice President; ITIF's about page lists him as president. robert-atkinson's "President" (2024 Form 990) looks stale. **Fixed:** ITIF lists Castro as president and Atkinson as a senior fellow; both descriptors and facts were updated.
- build-american-ai: money row shows $500,000 from Leading the Future (FEC); a Bisnow fact says $5M. Its Leading the Future relation is typed "person". **Unverifiable:** FEC Schedule B for Leading the Future lists only the $500K transfer (Oct 9, 2025); Bisnow's $5M may come from later or unreported transfers. Left as is. The relation typed "person" is the schema's only relation type for organizational ties, so it stays.
- gates-foundation: LawZero money row cites Wikipedia, which gives no amount; the Gates grant page (INV-091193) shows $4,995,896, July 2025 (descriptor says Aug 2025). **Fixed:** the Wikipedia row (no amount) was a duplicate of the grant-page row ($4,995,896) and is removed (29568). The grant page's URL path is 2025/08 but the row and text say July 2025, the commit date; left as is.
- hoover: "oppose SB 1047" is set on the institution but is fellow Lee Ohanian's podcast view. **Fixed:** the quote (feed 1739) and position link (8981) moved to lee-ohanian.
- maga-inc: Taylor Budowich named director in 2022, before this committee's 2024 registration (C00892471). **Unverifiable:** the 2022 MAGA Inc. was an earlier committee under the same name; the relation is marked "former staff" and left as is.
- dccc: name stored as "Dccc". **Fixed:** renamed DCCC.

## orgs-07
- machine-intelligence-research-institute / miri: duplicate nodes. **Fixed:** merged into miri (39).
- ai-safety-fund: website on file (aisafetyfund.org) is a small donor-funded "AI Safety Research Fund"; the Frontier Model Forum's AI Safety Fund is aisfund.org. CDT's donor list doesn't say which gave. **Fixed:** in part: the aisafetyfund.org website fact was removed. **Unverifiable:** which fund CDT's donor list means.
- CDT donor tiers: cdt.org/financials shows only 2025; money rows and the CZI descriptor also claim 2024. **Unverifiable:** left as is.
- perplexity: money row shows $200,000 in 2 gifts to Leading the Future; the fact and FEC PDF say $100,000 (likely double count). **Fixed:** duplicate removed (26411); $100,000.
- new-york-times-company: $1.225M Ford Foundation grant is from Ford's Form 990, unverified. **Unverifiable:** left as is.
- haun-ventures: a16z investment row is doubtful; the cited TechCrunch story is about Haun leaving a16z. **Unverifiable:** left as is.
- Wrong types: new-york-times-company, oracle, amd typed lab; movement-voter-pac typed nonprofit (it's a hybrid PAC). **Fixed:** lab is the schema's company type, so those stay; movement-voter-pac is now pac.
- amd: export-control lobbying in the descriptor has no supporting fact. **Fixed:** dropped from the descriptor.

## orgs-08
- anthony-aguirre / future-of-life-institute: node says Aguirre is FLI President and CEO; Wikipedia's infobox names Max Tegmark as president while its 2025 section calls Aguirre president. **Fixed:** (no change): FLI's people page lists Aguirre as President and CEO and Tegmark as Founder and Chair, matching the node and text.
- forge-the-future-project: descriptor says super PAC; its type fact (Tech Oversight Project) says state-level PAC (527). **Fixed:** descriptor now says state-level political committee (527).
- lonsdale-enterprises: typed nonprofit; the record describes an investment entity. **Fixed:** typed investor.
- defend-american-jobs, protect-progress: descriptors are bare FEC IDs; Wikipedia's Fairshake page says they're Fairshake affiliates (Republican and Democratic, respectively). **Fixed:** descriptors now say crypto-industry super PAC funded by transfers from affiliated committees (FEC). The party split is unverified, so it was left out.
- smart-justice-california-action-fund: descriptor is just "Organization". **Fixed:** "California state political committee (FPPC 1423131)".
- law-ai: couldn't confirm what it does (site blocks fetching; 990 page didn't load). **Unverifiable:** left as is.

## orgs-10
- isomorphic-labs / demis-hassabis: a Fortune fact (2026-08-05) says Hassabis became chairman of Isomorphic Labs; the article says chairman of Google DeepMind and Alphabet chief scientist. **Fixed:** the wrong Isomorphic fact was removed; the correct one and the text remain.
- jane-street: money row credits the firm as a METR funder; metr.org/about names "individuals from Jane Street", not the firm (money-credit rule). **Fixed:** link removed (44834); the text already says the donors were individuals from Jane Street.
- founders-pledge: lawzero.org credits Jaan Tallinn "with Founders Pledge Inc."; the LawZero gift may be Tallinn's, given through Founders Pledge. **Unverifiable:** LawZero's homepage says "made possible by the generosity of Jaan Tallinn and Founders Pledge Inc. (US)", which doesn't say whose money it was. Left as is.

## orgs-09
- humanity-ai: descriptor says formed "to counter AI-industry influence" and co-chaired by MacArthur and Omidyar; the Broadband Breakfast source names no co-chairs and describes the aim as AI that advances "public benefit over private gain." **Fixed:** descriptor now "for AI that serves the public interest", with no co-chairs.
- aft-solidarity: FEC fact calls it an independent-expenditure filer, "not a committee"; City & State calls it a super PAC. **Unverifiable:** left as nonprofit.
- beri: SFF lists four 2021 grants from Jed McCaleb ($250k, $17k, $17k, $14k); the record has only the $250k one, with no date. **Unverifiable:** left for a money follow-up.
- wadhwani-foundation: the $5M CSIS commitment was Romesh Wadhwani's own, not the foundation's (money-credit rule). **Fixed (no change):** the money row and both texts already credit the $5M to Romesh Wadhwani; the foundation's only row is its CSIS donor-tier listing.
- Generic descriptors ("Organization"): way-to-win-action-fund, elevate-america, aaup, and others. **Fixed:** in part: all 64 such nodes have written headlines, which the profile page shows; lists and search still use the descriptor.

## orgs-11
- rutan-tucker-llp, singleton-schreiber-llp: typed nonprofit; both are law-firm LLPs. **Fixed:** typed lab (company); Rutan & Tucker renamed from all caps.
- stronger-together-pa: typed nonprofit; FEC lists it as a super PAC (https://www.fec.gov/data/committee/C00936153/). **Fixed:** typed pac; FEC lists it as a super PAC.
- openai-foundation: descriptor's "$25B long-term pledge", "$1B planned for 2026", and "controlling OpenAI Group" have no supporting fact. **Fixed:** descriptor now "OpenAI's nonprofit parent; holds a 26% equity stake in OpenAI" (Chronicle of Philanthropy fact).

## orgs-12
- social-media-victims-law-center: typed lab. Descriptor says it represents families suing Character.AI and Google and that five cases settled in Jan 2026; the bgov source doesn't name the firm or give a count, and the firm's page doesn't name Character.AI. **Fixed:** descriptor trimmed to what SMVLC's site says; lab (company) stays.
- Duplicate nodes: ent_pac_smart-justice-california-action-fund_8cfde2 / smart-justice-california-action-fund. **Fixed:** merged into smart-justice-california-action-fund (40), now typed pac (a California state committee, FPPC 1423131).
- workers-vote, working-families-party-pac, wfw-action-fund: typed nonprofit; FEC lists them as a super PAC or hybrid PACs. **Fixed:** all typed pac.
- shaunna-thomas: descriptor reads "Principle, SLT Strategies" (Principal). UltraViolet's text links her as its co-founder on name match only; confirm it's the same person as the Guardrails Alliance co-founder. **Fixed:** "Principal". **Unverifiable:** the UltraViolet name match.

## people-02
- eliezer-yudkowsky: a statement credited to him (supports an IPCC-like body for AI) is ITIF's Hodan Omaar's, crediting the idea to Eric Schmidt and Mustafa Suleyman (https://itif.org/publications/2023/12/06/statement-to-the-us-senate-ai-insight-forum-on-risk-alignment-and-doomsday-scenarios/). **Fixed:** rejected (feed 8135; it was pending).
- jensen-huang: descriptor "Nvidia founder and CEO" is stale (8-K: resigned Nov 12, 2026). **Fixed:** not stale after all; he was reinstated Nov 22, 2026 (see orgs-01). His text now says "co-founded" (NVIDIA had three founders).
- Duplicate agency nodes: ftc / agency-federal-trade-commission-ftc; national-security-council / agency-natl-security-council-nsc; commerce-department / agency-commerce-dept-of-doc. **Fixed:** merged (33, 34, 32). These were first merged on 2026-11-15; the research loader re-created the old ids on 2026-11-17. Ingest now follows applied merges (`canonicalId` in scripts/lib/ingest.ts), so a reload can't bring them back.
- ron-conway: a Verge statement summary says he "regrets funding pro-AI efforts and now opposes federal AI regulation"; looks unreliable, check against the article. **Unverifiable:** the Verge blocks fetching; the item stays pending for review.

## people-01
- marc-andreessen: money rows show $11.9M to Fairshake; FEC Schedule A (C00835959) lists five personal gifts totaling $45.4M (2023–2025). **Fixed:** FEC Schedule A (memo attributions of AH Capital Management gifts) shows five for him, matching Horowitz's; the four missing rows were added ($45.4M). The Fairshake, Andreessen, and Horowitz texts now say "FEC filings attribute" these sums, which holds whichever way the a16z question goes.
- joe-lonsdale: Leading the Future row has no amount, and the cited article gives none for him; the $250K it reports was from Lonsdale Enterprises to American Mission. **Fixed:** FEC Schedule A for Leading the Future has no Lonsdale gift. The row was removed (44972), and his text now names the $250K from Lonsdale Enterprises to American Mission (FEC-1939888).
- daniel-ziegler: node name reversed ("Ziegler Daniel"). **Fixed:** renamed Daniel Ziegler.

## people-04
- ned-finkle: NVIDIA's blog says vice president of government affairs; CNAS (https://www.cnas.org/people/ned-finkle) says vice president of external affairs. **Fixed:** the descriptor names both titles and their sources.
- alex-karp: descriptor's "~$1.9M to Trump's super PAC (per Forbes)" has no source or money row. **Fixed:** dropped.
- anna-brockman / greg-brockman: FEC row gives $12.5M under her name; The Next Web says the couple jointly gave $25M (likely half of a joint gift, recorded per spouse). **Fixed (no change):** FEC itemizes $12.5M under each spouse's name, so each row follows the filing.
- richard-fontaine: a relation typed "revolving door" is an Anthropic advisory council seat, not a government post. **Fixed:** subtype now "advisor".

## people-03
- yann-lecun: the AMI Labs co-founder relation appears three times; one is dated 2026-03-10 (funding date per tech.eu), not the founding (Dec 2025 per Wikipedia). **Fixed:** two duplicates removed (26238, 29564).
- elizabeth-wirsching: descriptor "Retired, Not Employed"; the Transformer tracker says only "not employed". **Fixed:** "Not employed".

## people-05
- donovan-liam: node name "Liam Donavan"; the Transformer tracker (https://elections.transformernews.ai/pacs/C00928390) lists "Donovan Liam". Spelling and order unconfirmed. **Fixed:** FEC itemizes him as "LIAM, DONOVAN"; renamed Donovan Liam in node and text.
- brian-rice: a Wired statement says he "opposes federal binding rules on AI, favoring state regulation"; looks doubtful, not backed by the Verge statement. **Fixed:** the summary contradicted its own excerpt; rewritten to the excerpt (feed 8024, pending).
- duncan-crabtree-ireland: SAG-AFTRA's NO FAKES Act support is only in the descriptor. **Fixed:** the SAG-AFTRA descriptor no longer claims it.

## people-06
- justin-maturo: a fact names "Rep. Kelly Tran"; the LDA filing says only "RepTran" (https://lda.gov/filings/public/filing/90cc74f3-1bd5-40c1-bba0-8d6e00fbb200/print/). **Fixed:** the fact now says the filing lists only "RepTran"; the text already did.
- palmer-luckey: descriptor's "$5.9M to Republicans" is unverified (inkl source blocked). **Fixed:** dropped.
- paul-nakasone: fact says "Vanderbilt Institute of National Defense"; node is "Vanderbilt Institute of National Security"; Vanderbilt's URL says Institute for National Defense and Global Security. **Fixed:** fact and node renamed to the Vanderbilt Institute for National Defense and Global Security.
- santi-ruiz: descriptor stresses his IFP fellowship; facts show his current role is at Anthropic. **Fixed:** descriptor now leads with his Anthropic role.

## people-07
- sunny-gandhi: descriptor says Gandhi "filed Encode's LDA registration"; no fact supports it. **Fixed:** dropped.
- todor-markov: descriptor says "Research Scientist, Meta Superintelligence Labs"; no fact supports it, and his site names no employer. **Fixed:** now "AI researcher".
- stewart-barber: descriptor says "White House legislative affairs"; NVIDIA's LD-1 lists only "White House (2019–2021)". **Fixed:** now "White House (2019–2021)".
- linkify false match: "White House Office" (a node name) matches inside "White House Office of Management and Budget". **Unverifiable:** a code issue in lib/linkify.ts, left for a follow-up.

## people-08
- brian-singerman: descriptor "Managing Partner, Quiet Capital" is wrong; TechCrunch says Lee Linden is managing partner and Singerman is raising a new fund, GPx, with him. **Fixed:** now "Venture investor; former Founders Fund general partner".
- brad-smith: a statement about Lord Booth-Smith and AISI (Transformer, 2026-10-16) is credited to him by mistake. **Fixed:** rejected (feed 8019, pending).
- edward-fenster: descriptor stale; Sunrun's bio says co-executive chair only until July 2026, now vice-chair. **Unverifiable:** Sunrun's leadership pages 404; left as is.
- clark-minor: a fact lists his HHS CIO job as past; FedScoop says his exit is unconfirmed and HHS still lists him as CIO. **Unverifiable:** left as is.
- holmes-wilson: "Co-Founder, Quiet" has no support. **Fixed:** now "Co-founder of Fight for the Future" (its team page).
- chris-hyams: "Not Employed" is stale; Fortune says he teaches at Huston-Tillotson University. **Fixed:** "Former Indeed CEO; teaches at Huston-Tillotson University".
- carlos-trujillo: one fact says "2025 filing"; the others say 2026. **Fixed:** the LDA API dates that filing to 2026 Q1; the fact now says 2026.

## people-10
- gary-marcus: descriptor says he "testified to the Senate in 2023"; no fact on file supports it. **Fixed:** a fact now cites the May 16, 2023 Senate Judiciary hearing.
- zane-grube: descriptor says "Trader"; the source gives only his employer (Jane Street). **Fixed:** "Jane Street employee".

## people-09
- nicholas-joseph: descriptor "Member Of Technical Staff" (FEC occupation); TechCrunch and 80,000 Hours say he's an Anthropic co-founder and head of pretraining. **Fixed:** "Anthropic co-founder and head of pretraining".
- jeremy-liew: descriptor "Venture Capital Consultant, Self Employed"; Wikipedia says he's still a Lightspeed partner, though his Lightspeed fact is labeled "Previously". **Unverifiable:** left as is.
- joel-kaplan: Meta's page says Chief Global Affairs Officer; Fortune says president of global affairs. **Fixed:** Meta's title used.
- More duplicate agency nodes: white-house / agency-executive-office-of-the-president-eop. **Fixed:** merged (36).

## Bills (public bill records)
- us-ndaa-ai-preemption-2025 / us-ndaa-fy2026-ai-preemption: two nodes for the same FY2026 NDAA preemption push; both carry stage failed from data/bills/curated-stages.json. **Fixed:** merged (41).
- AI relevance for federal and California bills is matched on the title (and, for California, NCSL's AI list), so bills with generic titles, such as omnibus or appropriations bills carrying AI provisions, are only included when they're on the map. CRS legislative subjects in GovInfo matched no bills. **Fixed (no change):** a coverage note, not an error.
- State bills other than California's come from NCSL's AI database, which starts in 2025. State bills from 2023–24 are only present when they're on the map (for example, the Colorado AI Act, SB24-205, has a research stage). **Fixed (no change):** a coverage note, not an error.
- NCSL counts some loosely related bills as AI legislation (budget bills with an AI line, STEM councils); they're kept, with ai_match 'ncsl'. **Fixed (no change):** a coverage note, not an error.
- State bill links (source_url) point to the public State Net bill text NCSL links, not to the legislature's own page; map bills keep their official link on the node. **Fixed (no change):** a coverage note, not an error.
- ny-a3283-2025 (gene synthesis screening) isn't on NCSL's AI list, so it has no bill record or stage. **Fixed (no change):** a coverage note, not an error.
- Thin states (under 15 AI bills for 2025–26): Wyoming 7; Alaska, DC, and South Dakota 9; Nebraska and New Hampshire 13. They look like small legislatures rather than gaps. **Fixed (no change):** a coverage note, not an error.

## thin-people-01
- anne-marie-slaughter: descriptor "CEO" looks stale; New America's staff page lists her as Senior Advisor. **Fixed:** New America: Senior Advisor; CEO 2013 to June 2026.
- anil-dash ("CEO of Glitch"), jane-hartley ("former ambassador to the UK"), adam-green ("PCCC cofounder"): descriptor claims with no supporting relation or source. **Fixed:** the three claims dropped from the descriptors.
- romesh-wadhwani / wadhwani-foundation: the writers disagree on whether the $5M CSIS gift was his own or the foundation's; check the CSIS release. **Fixed (no change):** CSIS's release credits him; see orgs-09.
- Descriptor typos: "Principle" (shaunna-thomas), "Quantitive" (dylan-mavrides). **Fixed:** both fixed.

## thin-people-02
- avril-haines: descriptor says "Incoming" president; the Sept 28 start date has passed (no year on file). **Fixed:** "President of the Carnegie Endowment" (Carnegie's page).
- cameron-winklevoss: $250,000 America PAC gift dated 2024-01-01 (looks like a placeholder date). **Fixed:** (no change): the date already carries year precision, so it shows as 2024.
- cody-venzke: date_start 2025-01-01, but the source is a December 2025 release (placeholder date). **Fixed:** start date cleared; the note keeps the source date.
- california-leads: a relation note says "Meta-funded"; its profile record shows Google and Meta. **Unverifiable:** left as is.
- connor-leahy: descriptor says he founded EleutherAI and Conjecture; no supporting fact. **Fixed:** a fact now cites Wikipedia.

## thin-people-03
- Descriptor claims with no supporting fact: des-browne ("former UK Defence Secretary"), deven-parekh ("Managing Director, Insight Partners"), eric-horvitz ("Microsoft Chief Scientific Officer"; his one source is Rebecca Finlay's PAI page), gabriel-alfour ("co-founded Conjecture"; the fact says he helped found ControlAI), jill-barclay ("former Targeted Victory managing director"). **Fixed:** sourced facts were added for Browne and Horvitz; Parekh's and Barclay's claims were dropped; Alfour's descriptor now follows his fact (ControlAI).
- jina-john: date_start 2026-01-01, but the source is a June 2026 release (placeholder date). **Fixed:** start date cleared.

## thin-people-04
- karthik-ganapathy ("former Sanders aide"; elsewhere a Semafor source calls him a former Bernie Sanders spokesman, so check), kemba-walden ("President, Paladin Global Institute"): descriptor claims with no supporting fact on their own nodes. **Fixed:** both claims dropped.
- m-liss-hadley: node source is an FEC API URL with api_key=DEMO_KEY; the committee page is https://www.fec.gov/data/committee/C00930503/?cycle=2026&tab=about-committee. **Fixed:** source now the FEC committee page.

## thin-people-05
- sarah-may-stern / sarah-stern: likely the same Hudson Institute board chair (990 "Chair" vs hudson.org "President of the Board of Trustees"). **Fixed:** merged (42).
- nathan-click ("longtime adviser to Gov. Gavin Newsom"), rob-flaherty ("Democratic campaign veteran"): descriptor claims with no supporting fact. **Fixed:** both dropped.
- phil-cox: only source is InfluenceWatch citing the New York Times. **Unverifiable:** left as is.

## thin-people-06
- tyler-winklevoss: America PAC gift dated 2024-01-01 (placeholder); InfluenceWatch is the only source. **Fixed:** (no change): year precision.
- taylor-barkley: relation typed "executive"; the 2024 Form 990 lists him as "Director". **Unverifiable:** the 990's "Director" may be a staff title; left as is.

## lawmakers-02
- lawmaker-rich-mccormick: American Mission's two Oct 15 filings (2028668, 2039451) may double-count ($402,780 total vs at least $195,000). **Fixed:** 2028668 is a 24-hour notice and 2039451 the F3X that re-reports it. The F3X row (251, $195,140) was removed; the notice row ($207,640, two items) stays. The text's "at least $195,000" still holds.
- lawmaker-susan-collins: two Form 9 filings on the same date (2013889, 2015422) may overlap ($810,294 vs at least $686,000). **Unverifiable:** the two Form 9s cover different periods, so they may be separate ads; left as is.
- lawmaker-blake-moore: descriptor "Recipient of Anthropic PAC contribution" is a placeholder; Clerk lists UT-1, FEC lists UT-2 for 2026. (Districts: the Clerk gives the current seat and FEC the 2026 race.) **Fixed:** descriptor now "U.S. representative from Utah (R)". The district question is below.
- lawmaker-amerish-bera: Clerk lists CA-6, FEC lists CA-3 for 2026. **Fixed (no change):** the Clerk gives the current seat and FEC the 2026 race, so both are right; race links follow FEC.
- lawmaker-cindy-hyde-smith: node name "Hyde Smith" lacks the hyphen. **Fixed:** renamed Cindy Hyde-Smith.
- lawmaker-mike-rounds, -jerry-moran, -patty-murray, -ritchie-torres (ids approximate): no Party fact; party only in the descriptor. **Unverifiable:** left for a follow-up; adding Party facts needs each FEC page.
- Money rows don't carry support/oppose for super PAC spending in the dossier; it's only in links.stance. **Fixed (no change):** a coverage note, not an error.

## lawmakers-01
- lawmaker-darline-graham: facts give "Role: U.S. Senator, SC" and website dgraham.senate.gov, apparently copied from Lindsey Graham; FEC S6SC04437 is a challenger. Building the Future and American Mission report ~$4.6M of general-election spending supporting her, and the FEC API records the candidate as "GRAHAM, DARLINE" (S6SC04437). A fact on lindsey-graham (Ballotpedia, 2026-07-13) says he died in office on July 11, 2026, so she is likely the replacement candidate; her node's "Role: U.S. Senator" and Senate website facts still look copied and should be checked. **Fixed:** verified. senate.gov lists Darline Graham (R) as South Carolina's senator, and her official site (dgraham.senate.gov) says she was appointed on July 13, 2026, to fill the vacancy caused by Lindsey O. Graham's death, and took the oath on July 14. The Role and Website facts are correct, not copied. Her descriptor and text now say she was appointed, and an appointment fact was added.
- lawmaker-celeste-maloy: House Clerk lists UT-2; FEC lists her 2026 race in UT-3. **Fixed (no change):** the Clerk gives the current seat and FEC the 2026 race, so both are right; race links follow FEC.
- lawmaker-roger-marshall: node source_url uses old House ID H6KS01179; facts use S0KS00315. **Fixed:** (no change): the House ID is his earlier candidacy and still valid.
- lawmaker-colin-allred: node source_url H6TX33082 differs from facts' H8TX32098. **Fixed:** (no change): as above.
- lawmaker-thomas-feely: campaigns as "Jay Feely". **Unverifiable:** FEC lists "FEELY, THOMAS JAMES"; no source on file gives the nickname, so the name stays.

## lawmakers-03
- lawmaker-lindsey-graham: descriptor calls him an "incumbent" 2026 candidate; a fact (Ballotpedia, 2026-07-13) says he died in office on July 11, 2026. **Fixed:** confirmed by his Senate office's July 12 statement, senate.gov (which no longer lists him), and Wikipedia. The descriptor now reads "Former U.S. senator from South Carolina (R, 2003–2026); died in office July 11, 2026". FEC still shows him as an incumbent candidate, since FEC doesn't update for deaths.
- lawmaker-jared-moskowitz: House Clerk lists FL-23 (https://clerk.house.gov/members/M001217); FEC and descriptor list FL-25 for 2026. **Fixed (no change):** the Clerk gives the current seat and FEC the 2026 race, so both are right; race links follow FEC.
- lawmaker-nikki-budzinski: stance blank for Public First Action's ~$105,000 independent expenditure (https://docquery.fec.gov/cgi-bin/forms/C30003586/1952561/). **Fixed (no change):** it's a Form 9 electioneering communication, which doesn't designate support or oppose.

## agencies-02
- Duplicate agency pairs (lobbying rows sit on the second id): ftc / agency-federal-trade-commission-ftc; ostp / agency-office-of-science-and-technology-policy-ostp; national-security-council / agency-natl-security-council-nsc; white-house / agency-executive-office-of-the-president-eop; commerce-department / agency-commerce-dept-of-doc; osd / agency-office-of-the-secretary-of-defense. **Fixed:** all six merged into the agency-* ids (32-37); the agencies-02 texts for the old ids were dropped, keeping agencies-01's.
- commerce-department: descriptor says it runs CAISI; its source (ifp.org/author/saif-khan) doesn't say so. **Fixed:** that node was merged into agency-commerce-dept-of-doc, whose descriptor makes no CAISI claim.
- nscai: descriptor gives 2018–2021; Wikidata Q66087960 says founded 2019. **Fixed (no change):** the FY2019 NDAA created it in August 2018, and it began work in 2019.
- white-house (David Sacks stepped down March 2026) and ostp (Sriram Krishnan left June 2026): the sources cited for these relations predate the events. **Fixed (no change):** both relations already carry end dates (2026-03-26, 2026-06-30), and Sacks's departure has a fact.

## agencies-01
- public-first: the LDA filing naming Energy and the Air Force (lda.gov …/303b23e4…) is for First Public Hydrogen Authority, not the super PAC (wrong client match). **Fixed:** 3 links and 3 filings removed; lda_skip set.
- alliance-for-a-better-future: the LDA filing naming OMB and Interior (lda.gov …/5d998492…) is for Fund for a Better Future / Alliance for Wildfire Resilience (wrong client match). **Fixed:** 13 links and 5 filings removed; lda_skip set. Its text no longer says it lobbied Congress and OMB.
- Agency lobbying counts in profile text for the House, Senate, White House Office, and Commerce are minimums: the money list behind them was capped at 15 counterparties.

## Bill profile text (bills-01)

- ca-sb813-2025: a fact gives the Senate concurrence vote as 37–0; the vote and action records say 39–0. **Fixed:** fact 13472 now gives 39–0 from the Senate floor vote record and notes that the history line reads 37–0; the quoted history fact is left as quoted.
- ca-ab1018-2025: a fact says the bill went to the inactive file Sept. 13, 2025; the bill record shows it came off that file Aug. 21, 2026 and awaited a Senate vote as of Aug. 30, 2026. **Fixed:** the stale "latest action" fact (13531) was deleted; fact 24924 has the current status.
- ca-ab1864-2026: descriptor calls it a "California AI bill" backed by Secure AI Project; its official title is about gene synthesis equipment manufacturers and providers. Its "latest action" fact (March 2026) is stale; it was signed Sept. 30, 2026. **Fixed:** descriptor now calls it a gene synthesis bill and says it was signed Sept. 30, 2026 (Chapter 852 per the bill record); the stale fact (13539) was deleted.
- ca-ab2023-2026, ca-ab2583-2026, ca-ab412-2025, ca-sb1119-2026: "latest action" facts are older than the bill records. **Fixed:** the four stale facts (13540, 13542, 13547, 13557) were deleted; the bill records carry the current status.
- ca-sb7-2025: descriptor says the California Labor Federation sponsored it; the only relation on file has it urging a signature. **Fixed:** the sponsorship claim was dropped; the descriptor now says it was vetoed Oct. 13, 2025.

## Bill profile text (bills-02)

- il-sb315-2026: bill record names Sen. Harmon as sponsor; a Secure AI Project fact names Rep. Daniel Didech and Sen. Mary Edly-Allen. **Unverifiable:** ilga.gov wasn't checked here, so neither name was confirmed. Both are left as they are.
- ma-h5576-2026: stage is passed_legislature, but the latest action (July 30, 2026) sends it to a conference committee. **Fixed:** stage set to passed_one_chamber, and the NCSL importer now maps a conference status to that stage so a re-import won't undo it.
- us-119-s3062: stage is in_committee, but it was reported and placed on the Senate calendar May 11, 2026. **Fixed (no change):** the schema has no "reported" stage between in_committee and passed_one_chamber; the status line already shows the calendar placement.
- us-119-hr2385, hr3447, hr6875: "latest action" facts show the referral; votes show later committee approvals. **Fixed:** the three facts now give the latest action from the bill records (committee approvals on June 25, 2026, March 26, 2026, and Jan. 21, 2026).
- tn-hb1898-2026: a fact names the sponsor "Zachary Cochran"; the bill record says Rep. Jason Zachary. **Fixed:** the page lists "Zachary, Cochran" (two sponsors); the fact now reads "Reps. Zachary, Cochran, and others".
- ny-a3283-2025: no bill record is linked to the node. **Unverifiable:** the state importers hold no NY A3283 record to link; it needs a NY bill import, not a data fix.
- us-119-s1792: node source_url is an Encode lobbying filing, not the bill page. **Fixed:** source_url is now the congress.gov bill page.
- Agency lobbying counts in profile text for the House, Senate, White House Office, and Commerce are minimums: the money list behind them was capped at 15 counterparties. **Fixed (no change):** a coverage note, not an error.

## Race profile text (races-01)

- race-2026-ks-sen: Alliance for a Better Future's $80,832 independent expenditure has no support/oppose stance. **Fixed (no change needed):** the $80,832 comes from Form 9 electioneering communications, which report no support or oppose stance, so none is shown.
- race-2026-ca-11: Saikat Chakrabarti is on the site as a candidate but missing from the race's FEC candidate facts and has no fundraising fact. **Unverifiable:** he placed third in the June 2 top-two primary, so he was not in the general; the FEC API was rate-limited, so his committee totals could not be checked. His result now shows "Lost primary."
- FEC candidate facts label some challengers "open seat" where an incumbent is listed (e.g. Rhett Marques, AL-2). **Fixed:** race pages now take the seat status from the general-election result and add "not on the November ballot" when the incumbent was not a nominee.
- race-2026-ky-sen, race-2026-mt-1: no incumbent in the dossier. **Fixed:** both were open seats (the results confirm no incumbent ran), and the race pages say so.
- lawmaker-manny-rutinel, lawmaker-melissa-bean: descriptors lack a party. **Fixed:** both descriptors now carry (DEM).

## Race profile text (races-02)

- race-2026-nj-8: two FEC candidate records for Menendez (H2NJ08232, H2NJ13075) with identical figures. **Fixed:** the duplicate fact was deleted and the kept one notes both FEC records.
- race-2026-tn-6, tx-10, tx-19, wa-4, wy-sen: FEC facts call these open seats yet list the incumbent (Rose, McCaul, Arrington, Newhouse, Lummis) as a candidate. **Fixed:** the results show none of them on the November ballot, and the race pages now mark the incumbent "not on the November ballot."
- race-2026-tx-33: Colin Allred tagged "open seat" while Marc Veasey is tagged incumbent. **Fixed:** same display rule; the result shows Allred as the Democratic nominee after the May 26 runoff.
- Duplicate nodes for Chris Gober: chris-gober (person) and lawmaker-chris-gober. **Fixed:** merged into lawmaker-chris-gober (merge_log 44).
- race-2026-sc-sen: Russell Fry (lawmaker-russell-fry) is in the race's FEC facts but not linked to the race via external_ids. **Fixed (left unlinked on purpose):** Fry entered the Senate special primary in July 2026 and endorsed Darline Graham in the Aug 25 runoff, but on Nov 3 he was the SC-7 nominee and won with 56.7% (AP, certified). Each node holds one result, so he stays tied to his House seat. Whether he left the Senate primary or lost it is unverifiable here.

- lawmaker-mike-rogers: a $1.07M Form 9 electioneering link (495) from Alliance for a Better Future named "Michael J Rogers," the Michigan Senate nominee; the site's node is Alabama Rep. Michael D. Rogers (AL-3). News reports put the Alliance's ads in Michigan's Senate race. **Fixed:** link moved to links_removed, and both profile texts updated. **Fixed (Allegra, 2026-11-24):** new nodes lawmaker-mike-rogers-mi (FEC S4MI00595) and race-2026-mi-sen. Link 495 now points to him, and the race carries Michigan's certified result (El-Sayed 52.6%, Rogers 45.4%). Both have profile text.
- race-2026-ms-sen: published margins differ (AP via Mississippi Today: 4,669 votes; Wikipedia: about 8,000). **Fixed:** the race shows Colom as winner with no vote shares, citing Mississippi Today, until certified totals are out.

## Profile text audit (2026-11-24)

135 full entries (about 1 in 5, more for big names) were checked against their cited sources. 30 had at least one substantive error (38 in all), a 22% entry error rate; each was fixed in its profile text. Three causes recurred: annual lobbying totals cited to a single quarterly report, Survival and Flourishing Fund totals larger than the cited round pages, and claims with no cited source. The data problems behind them:

- Survival and Flourishing Fund grants loaded twice, once from each round page and once from the combined recommendations page. **Fixed:** 24 duplicate rows ($8.1M, mostly Jaan Tallinn's) moved to links_removed with kept_id; the round-page row is kept and takes the year from its copy.
- metr: SFF 2026 shows $2,201,000 credited to Jaan Tallinn on the round page and $775,000 on the combined page, and the 2026 round names "Jaan Tallinn & Dustin Moskovitz" as funders. **Unverifiable:** they may overlap or split one grant between two funders; both rows stay.
- apple: 20 LDA filings from the US Apple Association (apple growers) were matched to Apple Inc. by the name match, adding 89 lobbying links to agencies (USDA, Labor, USTR, White House Office, and others). **Fixed:** filings deleted, links moved to links_removed, external_ids.lda_not added and honored by the LDA importer; four agency texts recounted.
- Lobbying totals for 2025 (google, meta, openai) rest on outside tallies or the four quarterly reports; each text now cites only what its source shows.
- Systematic check of every lobbying and SFF dollar figure (45 entries). **Lobbying:** each annual 2025 total (Amazon, Apple, Microsoft, Palantir, NVIDIA, Scale AI, Anthropic, and Cohere's outside firm) equals the sum of the company's four quarterly reports in the filings table. Anthropic and Microsoft cited one quarterly report for an annual figure; both now cite all four. a16z's two-quarter comparison now cites both quarters. Per-report figures on lobbyists' pages are labeled "for the period" and match single reports. **SFF:** the per-grant and multi-year figures match the de-duplicated links. One more duplicate turned up: the combined page's $420,000 2023-H2 Action Fund row (38057) is the round page's $397,875 from Jaan Tallinn plus $22,125 from Lightspeed. **Fixed:** it moved to links_removed (kept_id 2333), and Jaan Tallinn's text now says $2.04 million and $2.02 million, as the cited pages show (it had said $2.06 million and $2.22 million). **Unverifiable:** for CAIS 2026, GovAI 2025 and 2026, and METR 2025 and 2026, the combined page shows a smaller amount than the round page for the same funder and round. It may be a part of the same grant, as with metr above, so both rows stay.
- Extended audit, batch 9 (17 entries): 6 substantive errors in 6 entries (35%). Batch 10 (17 entries): 11 errors in 8 entries (47%). All are **fixed** in the profile text. The new recurring pattern: counts and totals drawn from this site's own records, each citing one sample filing. The fix either cites a source that covers the whole figure (FEC's independent-expenditure search for Alex Bores's three PACs, every Ford and Good Ventures return behind a multi-year total, the five FEC filings behind a16z's founders' $45.4 million each to Fairshake) or names the filers without the count (four agency entries). Other fixes: the order's defender is Kratsios alone (eo-14365), Fairplay's opposition is now sourced, ARI's support for the AI diffusion rule was dropped as unsourced, the registration date is corrected (secure-ai-project), and Heritage's comment wording now matches what it asked for.
- Extended audit, batch 8 (17 entries): 9 substantive errors in 9 entries (53%). Batch 11 (17 entries): 12 errors in 9 entries (53%). All are **fixed**. Most errors were again single-filing citations for multi-filing totals. Those totals match the database, so each now cites every filing or FEC's independent-expenditure search (Think Big, You Can Push Back, Scott Wiener, Senate Leadership Fund, Omidyar, Bipartisan Policy Center). Wrong facts corrected: Atlantic Council's 2025 revenue ($78.3 million), IFP's leadership (Stapp is CEO, Fist is president), Defending Our Values' largest outlays, and GovAI's fiscal year. Unsourced claims removed: YC's SB 1074 co-sponsorship, the CAIS Action Fund comment, and Hammond's title. **Data fix:** link 9153 (Jaan Tallinn, $20,000 to Mercatus, SFF-2019-Q4) is not on the SFF page it cites and moved to links_removed, so Mercatus shows $136,000.
- Error types, batches 8–11 (68 entries, 38 errors). **Factual** (wrong fact, person, or number): 6, in 6 entries (9%). They are Defending Our Values' largest outlays, Secure AI Project's registration date, Heritage's position, Atlantic Council's revenue year, Mercatus's Tallinn total, and IFP's leader. **Unsupported, truth unknown, removed:** 5, in 5 entries: the CAIS Action Fund's comment, Hammond's title, Y Combinator's SB 1074 co-sponsorship, ARI's support for the AI diffusion rule, and Sacks defending EO 14365. **Sourcing or wording** (true but under-cited, or imprecise): 27. One flagged claim was in fact true: Mozilla has lobbied Congress since April 2024, so the original wording is restored with that filing cited. Per batch, factual errors were 1, 2, 0, and 3 of 17 entries.
- Extended audit, batch 13 (17 entries): 11 substantive errors in 6 entries (35%). All are **fixed**. **Factual:** 4, in 4 entries (24%): Barrett's Anthropic PAC gift ($2,500, not $5,000), the Algorithmic Justice League's origin (founded 2016; Coded Bias is a 2020 film about it), ITIF's funders (it publishes a list of donors over $10,000), and Darline Graham's race (U.S. Senate, not the South Carolina Senate). **Unsupported, removed:** 1: that Prusik Partners is Leading the Future's main vendor (no filing or the CLC complaint says so; fact 80 corrected too). **Sourcing:** 6, all true per the database and now cited in full: Tomorrow Together's $1.10 million against Barrett and Building the Future's $2.51 million for Graham (FEC independent-expenditure search), Khosla's four $1 million gifts to SMP, Gonzalez as treasurer of all three PACs, Graham's party, and World Labs' founding year (dropped). **Data fix:** six AnthroPAC gifts of June 29, 2026 were stored twice, once from the PAC's FEC Schedule B and once from Anthropic's mid-year LD-203, which reports the same gifts. The LD-203 rows (1050, 1051, 1053–1056) moved to links_removed with kept_id set to the FEC rows. That halves the gifts shown and in the text for Barrett, Huizenga ($3,500 in two gifts), Meeks ($2,500), Obernolte ($3,500), Murray ($3,500), and Yakym ($1,000). No other LD-203 row has an FEC twin.
- Extended audit, batch 12 (17 entries): 14 substantive errors in 10 entries. **Factual:** 2, in 1 entry (6%): Jed McCaleb's SFF grants ran into 2021 (the $250,000 BERI grant is SFF-2021-H2), and his MIRI grant is $40,000, not $80,000. **Unsupported, removed:** 2: Alliance for a Better Future's shared compliance firm with Leading the Future, and Schmidt's 2023 testimony as SCSP chair. **Sourcing:** 10, all true per the database or a cited page and now fully cited: Alliance's $2.1 million and $810,000 on Collins (a third Form 9, FEC-2015422, amends FEC-2012270, which is not stored, so nothing is double counted), Ford's grants to CFR, Good Ventures' $11.79 million to Redwood, Guardrails Action's $1.89 million, both PAC totals for Darline Graham, the ballot measure's failure to qualify, Gebru's Google role, and the Open Philanthropy Action Fund's lobbying topics. The NTIA counts were flagged, but they already follow the agency-count policy (labeled as the site's records, with example filings), so they are not counted as errors.
- Extended audit, batch 14 (17 entries): 9 substantive errors in 8 entries. **Factual:** 2, in 2 entries (12%): the DCCC's $60.9 million is party coordinated spending, not independent expenditures, and the Center for Humane Technology consults on one Character.AI suit, not several. **Sourcing:** 7, now cited in full or trimmed: Hoffman's DCCC gifts and Ziegler's Dream NYC gifts (FEC contribution search), Ford's ACLU grants (each year's 990-PF), the Hoover overseers' firms, the Coefficient Giving rename, Project Blueprint's launch, and Tan's start year at YC (dropped).
- Extended audit, batch 15 (17 entries): 10 substantive errors in 8 entries. **Factual:** 3, in 2 entries (12%): the DSCC's $38 million is party coordinated spending, not independent ads, and World Labs was out of date (in September 2026 AMD agreed to buy it for $8.2 billion, and Li became AMD's chief scientist). **Sourcing:** 7: Hoffman's totals at the DNC, DSCC, FF PAC, and HMP (FEC contribution search), American Mission's $474,000 against Hern (FEC independent-expenditure search), and the SB 11 veto wording. **Unverifiable:** Khosla's June 2024 DNC and October 2024 FF PAC gifts cite filing images numbered as filed in mid-2025, which may be amended reports; the gift dates are kept, but they need checking once docquery can be reached.
- **Guard against reloads:** `insertLink` (web/scripts/lib/ingest.ts, used by the research loader and every importer) now skips a row that matches one in links_removed, unless an identical row is still live (a kept twin). It also skips a money row from an LD-203 contribution report that matches an FEC row on the same giver, recipient, date, and amount, or the reverse. Before this, any removed row whose source JSON still listed it would have come back the next time `load-research` ran. **Fixed.**
- Money links with no stated amount (for example, the Future of Life Institute, Jaan Tallinn, and others named as LawZero backers, with no amount given) were drawn on /money as $0 flows. The trace and its list of starting points now leave them out; they still show on both profiles as "amount not stated". The DB has no money link with an amount of exactly 0, and 171 research links have no amount (113 donations, 33 grants, 14 investments, 7 lobbying, and 4 transfers). **Fixed.**
- Party committees: the DCCC and DSCC errors were in profile text only. No DCCC, DSCC, NRCC, DNC, or RNC money row exists in links or money_hops, and nothing reaching a candidate is typed as coordinated spending. Money to candidates is only `independent expenditure` (201 rows) or `contribution` (89), so the Elections panels' outside-spending totals count no coordinated party money. **No change needed.**
- Agency filing counts (orchestrator's policy A, 2026-11-24): every count and per-group figure in the 66 agency entries was checked against the database. All 229 checks match after one fix: DHS had 70 filings from nine groups, and the database has 66 from eight, the gap being the removed US Apple Association filings. The text now says the counts are this site's records ("named in 131 lobbying filings on this site"), and sample sources are labeled "Example filing (…)". The four counts dropped in e897486 (SBA, Federal Reserve, CPSC, and OSD) are restored from the database.
