import { Suspense } from "react";
import InfluenceMap from "@/components/InfluenceMap";
import { getGraph } from "@/lib/data";

type Sp = PageProps<"/map">["searchParams"];

// Only the opening view and focus come from the URL, so only the map itself waits for it.
async function MapFromUrl({ sp }: { sp: Sp }) {
  const { view, focus } = await sp;
  const { nodes, links } = await getGraph();
  return <InfluenceMap nodes={nodes} links={links} initialMode={view === "time" ? "timeline" : "map"} initialFocus={typeof focus === "string" ? focus : undefined} />;
}

export default async function MapPage(props: PageProps<"/map">) {
  // Awaited here, outside the boundary, the cached graph is stored with the prebuilt page; the same call inside the boundary
  // is answered from that copy, so opening the map runs no query. (Passing it down as a prop would send it to the browser twice.)
  const { links } = await getGraph();
  return (
    <>
      <div className="home-head">
        <h1>Who pushes AI policy</h1>
        <p>Left: labs, investors and tech leaders. Middle: the PACs, think tanks and filings they use. Right: the elections, bills and rules reached. Click a block to open it.</p>
      </div>
      {links.length === 0 ? (
        <p className="page">No sourced links are loaded yet. Run <code>pnpm load</code> after the research files land in <code>data/research</code>.</p>
      ) : (
        <Suspense fallback={<p className="page mono muted" role="status">Loading the map…</p>}>
          <MapFromUrl sp={props.searchParams} />
        </Suspense>
      )}
    </>
  );
}
