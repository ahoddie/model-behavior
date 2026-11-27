import InfluenceMap from "@/components/InfluenceMap";
import { getGraph } from "@/lib/data";

// Fully prebuilt: the page reads nothing from the request. The opening view and focus (?view=time, ?focus=id) are applied
// in the browser by InfluenceMap, so every /map link is served the same static file.
export default async function MapPage() {
  const { nodes, links } = await getGraph();
  return (
    <>
      <div className="home-head">
        <h1>Who shapes AI policy?</h1>
        <p>Follow the Valley&apos;s labs, investors, and tech leaders on the left through the PACs, think tanks, and filings in the middle to the elections, bills, and rules they fund.</p>
      </div>
      {links.length === 0 ? (
        <p className="page">No sourced links are loaded yet. Run <code>pnpm load</code> after the research files land in <code>data/research</code>.</p>
      ) : (
        <InfluenceMap nodes={nodes} links={links} />
      )}
    </>
  );
}
