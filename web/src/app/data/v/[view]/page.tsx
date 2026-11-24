import { Suspense } from "react";
import OpenData from "../../page";
import Loading from "../../loading";

// /data?view=…, one prebuilt page per tab (src/proxy.ts moves ?view into the path; the address does not change).
export function generateStaticParams() {
  return ["download", "methodology", "corrections"].map((view) => ({ view }));
}

// The params are read inside the boundary, so the shell every /data?view= link shares holds only the loading line (Partial
// Prefetching requires it). A prebuilt tab still arrives whole.
export default function DataView({ params }: PageProps<"/data/v/[view]">) {
  return <Suspense fallback={<Loading />}><View params={params} /></Suspense>;
}

async function View({ params }: { params: PageProps<"/data/v/[view]">["params"] }) {
  const { view } = await params;
  return <OpenData params={Promise.resolve({})} searchParams={Promise.resolve(view === "_" ? {} : { view })} />;
}
