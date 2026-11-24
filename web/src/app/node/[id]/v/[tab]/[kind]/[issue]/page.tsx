import NodePage from "../../../../page";
import { allNodeIds } from "@/lib/data";

// A profile, with its tab and statement filters (?tab, ?kind, ?issue) moved into the path by src/proxy.ts; the address does
// not change. "_" is a parameter that is not set. Each combination is a prebuilt page: the best-connected profiles are built
// with the site, every other one on its first visit (or by lib/warm), and Next keeps each on disk from then on.
export async function generateStaticParams() {
  return (await allNodeIds()).slice(0, 24).map((id) => ({ id, tab: "_", kind: "_", issue: "_" }));
}

export default async function NodeView({ params }: PageProps<"/node/[id]/v/[tab]/[kind]/[issue]">) {
  const { id, tab, kind, issue } = await params;
  const sp: Record<string, string> = {};
  if (tab !== "_") sp.tab = tab;
  if (kind !== "_") sp.kind = kind;
  if (issue !== "_") sp.issue = issue;
  return <NodePage params={Promise.resolve({ id })} searchParams={Promise.resolve(sp)} />;
}
