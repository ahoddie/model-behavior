// Compact profile of the "Start from" actor on /money: name, type and cluster, descriptor and a link to the full
// profile. The written headline stands in for the descriptor when there is one. No money totals (the select above shows them) and no key facts (the profile has them), so the flow sits high.
import Link from "@/components/Link";
import { getNodeSummary } from "@/lib/data";
import { TYPE_LABEL, clusterName } from "@/lib/format";
import Linked from "./Linked";
import { getProfileText } from "@/lib/profile-text";

export default async function ActorSummary({ id }: { id: string }) {
  const [s, text] = await Promise.all([getNodeSummary(id), getProfileText(id)]);
  if (!s) return null;
  const { node } = s;
  const kind = [TYPE_LABEL[node.type] ?? node.type, node.cluster ? clusterName(node.cluster) : null].filter(Boolean).join(" · ");
  return (
    <section className="actor-summary" aria-label={`${node.name} summary`}>
      <div className="actor-summary-id">
        <h2>{node.name}</h2>
        <p className="actor-summary-kind">{kind}</p>
        {text ? <p className="actor-summary-desc">{text.headline}</p>
          : node.descriptor && <p className="actor-summary-desc"><Linked parts={s.descriptorParts} text={node.descriptor} /></p>}
        <p className="panel-open"><Link href={`/node/${node.id}`}>Open the full profile</Link></p>
      </div>
    </section>
  );
}
