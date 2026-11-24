import Money from "../../page";
import { moneyStarts } from "@/lib/data";

// /money?from=…, one prebuilt page per starting point (src/proxy.ts moves ?from into the path; the address does not change).
// The largest givers are built with the site; any other is built on its first visit and kept on disk from then on.
export async function generateStaticParams() {
  return (await moneyStarts()).slice(0, 12).map((s: { id: string }) => ({ from: s.id }));
}

export default async function MoneyFrom({ params }: PageProps<"/money/v/[from]">) {
  const { from } = await params;
  return <Money params={Promise.resolve({})} searchParams={Promise.resolve(from === "_" ? {} : { from })} />;
}
