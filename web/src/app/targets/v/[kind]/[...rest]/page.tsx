import Targets from "../../../page";

// /targets?kind=…&cycle=…&stage=…, one prebuilt page per combination (src/proxy.ts moves the query into the path; the
// address does not change). The segments after the tab follow FILTERS in order; "_" is a parameter that is not set.
// Each tab with no filter is built ahead of time; filtered views are built on their first visit and kept on disk.
const FILTERS = ["cycle", "stage", "show", "state", "office", "money"];

export function generateStaticParams() {
  return ["bills", "rules", "elections", "lobbied"].map((kind) => ({ kind, rest: FILTERS.map(() => "_") }));
}

export default async function TargetsView({ params }: PageProps<"/targets/v/[kind]/[...rest]">) {
  const { kind, rest } = await params;
  const sp: Record<string, string> = {};
  if (kind !== "_") sp.kind = kind;
  FILTERS.forEach((k, i) => { const v = rest[i]; if (v && v !== "_") sp[k] = decodeURIComponent(v); });
  return <Targets params={Promise.resolve({})} searchParams={Promise.resolve(sp)} />;
}
