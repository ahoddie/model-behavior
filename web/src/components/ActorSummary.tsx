// Compact profile of the "Start from" actor on /money: name, type and cluster, descriptor, sourced key facts
// and a link to the full profile. No money totals: the select above already shows them.
import Link from "@/components/Link";
import { getNodeSummary } from "@/lib/data";
import { TYPE_LABEL, clusterName } from "@/lib/format";
import { KeyFacts } from "./ProfileHead";
import Src from "./Src";

export default async function ActorSummary({ id }: { id: string }) {
  const s = await getNodeSummary(id);
  if (!s) return null;
  const { node, keyFacts } = s;
  const kind = [TYPE_LABEL[node.type] ?? node.type, node.cluster ? clusterName(node.cluster) : null].filter(Boolean).join(" · ");
  return (
    <section className="actor-summary" aria-label={`${node.name} summary`}>
      <div className="actor-summary-id">
        <h2>{node.name}</h2>
        <p className="actor-summary-kind">{kind}</p>
        {node.descriptor && <p className="actor-summary-desc">{node.descriptor} <Src url={node.source_url} /></p>}
        <p className="panel-open"><Link href={`/node/${node.id}`}>Open the full profile →</Link></p>
      </div>
      {keyFacts.length ? <KeyFacts facts={keyFacts} compact /> : <p className="actor-summary-none muted">No sourced key facts recorded yet.</p>}
    </section>
  );
}
