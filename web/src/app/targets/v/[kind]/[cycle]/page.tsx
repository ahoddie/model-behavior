import Targets from "../../../page";

// /targets?kind=…&cycle=…, one prebuilt page per tab and election cycle (src/proxy.ts moves the query into the path; the
// address does not change). "_" is a parameter that is not set. Cycles are built on their first visit and kept on disk.
export function generateStaticParams() {
  return ["bills", "rules", "elections", "lobbied"].map((kind) => ({ kind, cycle: "_" }));
}

export default async function TargetsView({ params }: PageProps<"/targets/v/[kind]/[cycle]">) {
  const { kind, cycle } = await params;
  const sp: Record<string, string> = {};
  if (kind !== "_") sp.kind = kind;
  if (cycle !== "_") sp.cycle = cycle;
  return <Targets params={Promise.resolve({})} searchParams={Promise.resolve(sp)} />;
}
