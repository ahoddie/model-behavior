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
