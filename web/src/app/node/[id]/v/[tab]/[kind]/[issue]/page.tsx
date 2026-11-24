import { Suspense } from "react";
import NodePage from "../../../../page";
import Loading from "../../../../loading";
import { allNodeIds } from "@/lib/data";

// A profile, with its tab and statement filters (?tab, ?kind, ?issue) moved into the path by src/proxy.ts; the address does
// not change. "_" is a parameter that is not set. Each combination is a prebuilt page: the best-connected profiles are built
// with the site, every other one on its first visit (or by lib/warm), and Next keeps each on disk from then on.
export async function generateStaticParams() {
  return (await allNodeIds()).slice(0, 24).map((id) => ({ id, tab: "_", kind: "_", issue: "_" }));
}

// Every part of a profile depends on the id, so the params are read inside the boundary: the shell that links to any profile
// share (and prefetch) holds only the loading line, as Partial Prefetching requires. A prebuilt profile still arrives whole.
export default function NodeView({ params }: PageProps<"/node/[id]/v/[tab]/[kind]/[issue]">) {
  return <Suspense fallback={<Loading />}><Profile params={params} /></Suspense>;
}

async function Profile({ params }: { params: PageProps<"/node/[id]/v/[tab]/[kind]/[issue]">["params"] }) {
  const { id, tab, kind, issue } = await params;
  const sp: Record<string, string> = {};
  if (tab !== "_") sp.tab = tab;
  if (kind !== "_") sp.kind = kind;
  if (issue !== "_") sp.issue = issue;
  return <NodePage params={Promise.resolve({ id })} searchParams={Promise.resolve(sp)} />;
}
