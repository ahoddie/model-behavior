import { connection } from "next/server";
import InfluenceMap from "@/components/InfluenceMap";
import { getGraph } from "@/lib/data";

export default async function MapPage(props: PageProps<"/map">) {
  await connection();
  const sp = await props.searchParams;
  const { nodes, links } = await getGraph();
  return (
    <>
      <div className="home-head">
        <h1>Who pushes AI policy</h1>
        <p>Labs, investors and tech leaders on the left; the PACs, think tanks and filings they work through in the middle; the elections, bills and rules it reaches on the right. Click a block to open it, or a name to trace it.</p>
      </div>
      {links.length === 0 ? (
        <p className="page">No sourced links are loaded yet. Run <code>pnpm load</code> after the research files land in <code>data/research</code>.</p>
      ) : (
        <InfluenceMap nodes={nodes} links={links} initialMode={sp.view === "time" ? "timeline" : "map"} initialFocus={typeof sp.focus === "string" ? sp.focus : undefined} />
      )}
    </>
  );
}
