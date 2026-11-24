import { Suspense } from "react";
import Money from "../../page";
import Loading from "../../loading";
import { moneyStarts } from "@/lib/data";

// /money?from=…, one prebuilt page per starting point (src/proxy.ts moves ?from into the path; the address does not change).
// The largest givers are built with the site; any other is built on its first visit and kept on disk from then on.
export async function generateStaticParams() {
  return (await moneyStarts()).slice(0, 12).map((s: { id: string }) => ({ from: s.id }));
}

// The params are read inside the boundary, so the shell every /money?from= link shares holds only the loading line (Partial
// Prefetching requires it). A prebuilt trace still arrives whole.
export default function MoneyFrom({ params }: PageProps<"/money/v/[from]">) {
  return <Suspense fallback={<Loading />}><Trace params={params} /></Suspense>;
}

async function Trace({ params }: { params: PageProps<"/money/v/[from]">["params"] }) {
  const { from } = await params;
  return <Money params={Promise.resolve({})} searchParams={Promise.resolve(from === "_" ? {} : { from })} />;
}
