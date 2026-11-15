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
        <p>Left: labs, investors and tech leaders. Middle: the PACs, think tanks and filings they use. Right: the elections, bills and rules reached. Click a block to open it.</p>
      </div>
      {links.length === 0 ? (
        <p className="page">No sourced links are loaded yet. Run <code>pnpm load</code> after the research files land in <code>data/research</code>.</p>
      ) : (
        <InfluenceMap nodes={nodes} links={links} initialMode={sp.view === "time" ? "timeline" : "map"} initialFocus={typeof sp.focus === "string" ? sp.focus : undefined} />
      )}
    </>
  );
}
