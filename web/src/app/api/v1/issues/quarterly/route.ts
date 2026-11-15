import { viewIssueQuarterly } from "@/lib/data";
import { envelope } from "../../envelope";
export async function GET(req: Request) {
  const issue = new URL(req.url).searchParams.get("issue") ?? undefined;
  return envelope("issue_quarterly", await viewIssueQuarterly(issue), [
    "Statement counts use approved quotes with machine labels (open-source model); each example carries machine_label: true.",
    "Lobbying filings count LDA reports whose filed text names the issue. Filings list topics, not positions."]);
}
