import OpenData from "../../page";

// /data?view=…, one prebuilt page per tab (src/proxy.ts moves ?view into the path; the address does not change).
export function generateStaticParams() {
  return ["download", "methodology", "corrections"].map((view) => ({ view }));
}

export default async function DataView({ params }: PageProps<"/data/v/[view]">) {
  const { view } = await params;
  return <OpenData params={Promise.resolve({})} searchParams={Promise.resolve(view === "_" ? {} : { view })} />;
}
