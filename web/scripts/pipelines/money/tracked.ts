// The committees Workstream D traces. `network` groups them the way the spec (§3) does.
// FEC ids come from nodes.external_ids.fec; a node with no FEC id is traced from other sources only.
export const TRACKED: { node: string; fec: string; network: string; role: "super_pac" | "c4" | "company_pac" | "other" }[] = [
  { node: "leading-the-future", fec: "C00916114", network: "Leading the Future", role: "super_pac" },
  { node: "think-big", fec: "C00923417", network: "Leading the Future", role: "super_pac" },
  { node: "american-mission", fec: "C00916692", network: "Leading the Future", role: "super_pac" },
  { node: "building-the-future", fec: "C00960328", network: "Leading the Future", role: "super_pac" },
  { node: "public-first", fec: "C00930503", network: "Public First", role: "super_pac" },
  { node: "jobs-and-democracy", fec: "C00928374", network: "Public First", role: "super_pac" },
  { node: "defending-our-values", fec: "C00928390", network: "Public First", role: "super_pac" },
  { node: "abundant-future", fec: "C00922229", network: "Public First", role: "super_pac" },
  { node: "innovation-council", fec: "C00922815", network: "Innovation Council", role: "super_pac" },
  { node: "guardrails-alliance", fec: "C00949487", network: "Other AI super PACs", role: "super_pac" },
  { node: "cais-action-fund-pac", fec: "C00905257", network: "Other AI super PACs", role: "super_pac" },
  { node: "anthropic-pac", fec: "C00946111", network: "Company PACs", role: "company_pac" },
  { node: "meta-pac", fec: "C00502906", network: "Company PACs", role: "company_pac" },
  { node: "microsoft-pac", fec: "C00227546", network: "Company PACs", role: "company_pac" },
  { node: "google-netpac", fec: "C00428623", network: "Company PACs", role: "company_pac" },
  { node: "amazon-pac", fec: "C00360354", network: "Company PACs", role: "company_pac" },
  { node: "nvidia-pac", fec: "C00960070", network: "Company PACs", role: "company_pac" },
  { node: "palantir-pac", fec: "C00498691", network: "Company PACs", role: "company_pac" },
];
export const CYCLES = [2024, 2026];
